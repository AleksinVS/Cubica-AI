/**
 * Session lifecycle boundary for credential handoff and safe player views.
 *
 * Creation captures immutable rules and returns a raw credential exactly once.
 * Every later read authenticates that credential and loads rules exclusively
 * through the `bundleHash` pinned into the durable session record.
 */

import type {
  ArchivedSessionAudit,
  CreateSessionRequest,
  CreateSessionResponse,
  GetSessionResponse,
  PortablePublicGameplayJournal,
  RestorePreviewSessionRequest,
  RestorePreviewSessionResponse,
  SessionId,
  SessionPrincipal,
  SessionRecord,
  SessionStorePort
} from "@cubica/contracts-session";
import { assertGameLaunchReady } from "../admin/health.ts";
import { AgentSeatDriver, projectAgentControl } from "../ai/agentSeatDriver.ts";
import { contentService } from "../content/contentService.ts";
import {
  extractInitialState,
  loadImmutableGameBundle,
  toImmutableGameBundle,
  type GameBundle
} from "../content/manifestLoader.ts";
import { HttpError, NotFoundError, RequestValidationError } from "../errors.ts";
import { RUNTIME_BUDGETS, assertMechanicsStateWithinBudget } from "../mechanics/budget.ts";
import { assertStateMatchesModel } from "../mechanics/stateModel.ts";
import { projectSessionActionAvailability } from "../runtime/actionAvailability.ts";
import { projectPlayerSessionState } from "./playerSessionProjection.ts";
import {
  createLocalSessionAccess,
  createParticipantSessionAccess,
  hashSessionCredential,
  resolveSessionViewerActor
} from "./sessionAuthentication.ts";
import {
  SessionAuthenticationError,
  SessionAuthorizationError,
  SessionStoreUnavailableError
} from "./sessionStoreErrors.ts";
import {
  initializeTurnBasedSessionState,
  ParticipantCountValidationError,
  resolveParticipantCount
} from "./turnBasedSessionState.ts";
import {
  buildPublicGameplayJournal,
  MAX_PUBLIC_JOURNAL_ENTRIES
} from "./publicGameplayJournal.ts";
import {
  materializeLocalSessionParticipants,
  materializePrivateSessionParticipants
} from "./sessionParticipants.ts";

type RuntimeState = Record<string, unknown>;

interface SessionServiceOptions {
  sessionStore: SessionStorePort<RuntimeState>;
  agentSeatDriver?: AgentSeatDriver;
}

export interface AuthenticatedSessionAccess {
  snapshot: SessionRecord<RuntimeState>;
  principal: SessionPrincipal;
  bundle: GameBundle;
}

/**
 * Let an authenticated facilitator close a session at its exact audit boundary.
 *
 * This application-service method deliberately returns the protected archive
 * object only to trusted server callers. The public journal endpoint uses the
 * separate bounded source method below and never exposes this audit object.
 */
export type AuthenticatedArchivedSessionAccess = ArchivedSessionAudit<RuntimeState>;

export class SessionService {
  private readonly sessionStore: SessionStorePort<RuntimeState>;
  private readonly agentSeatDriver?: AgentSeatDriver;

  constructor(options: SessionServiceOptions) {
    this.sessionStore = options.sessionStore;
    this.agentSeatDriver = options.agentSeatDriver;
  }

  async createSession(request: CreateSessionRequest): Promise<CreateSessionResponse<RuntimeState>> {
    const gameId = request.gameId;
    if (!gameId) {
      throw new RequestValidationError("gameId is required to create a session");
    }

    const privateInvite = request.accessMode === "private-invite";
    if (privateInvite && request.contentSourceId !== undefined) {
      throw new RequestValidationError("Private-invite sessions cannot use editor preview content");
    }
    if (privateInvite && (request.agentSeatCount ?? 0) > 0) {
      throw new RequestValidationError("Private-invite sessions cannot contain agent seats");
    }

    await assertGameLaunchReady({
      gameId,
      contentSourceId: request.contentSourceId,
      participantCount: request.participantCount,
      agentSeatCount: request.agentSeatCount
    });
    const bundle = await contentService.getBundle(gameId, request.contentSourceId);
    const declaredState = extractInitialState(bundle) as RuntimeState;
    let initialState: RuntimeState;
    let participantCount: number;
    try {
      participantCount = resolveParticipantCount(bundle.manifest, request.participantCount);
      initialState = initializeTurnBasedSessionState(bundle.manifest, declaredState, { participantCount });
    } catch (error) {
      if (error instanceof ParticipantCountValidationError) {
        throw new RequestValidationError(error.message);
      }
      throw error;
    }
    if (privateInvite && participantCount < 2) {
      throw new RequestValidationError("Private-invite sessions require at least one guest participant");
    }
    const participants = privateInvite
      ? materializePrivateSessionParticipants(initialState, participantCount)
      : materializeLocalSessionParticipants(
          initialState,
          participantCount,
          request.agentSeatCount ?? 0
        );
    // A client never chooses its own trusted role. Facilitated mode is the one
    // current manifest rule that creates a facilitator controller.
    const sessionRole = bundle.manifest.config.sessionMode === "facilitated"
      ? "facilitator"
      : "player";
    const participantAccess = privateInvite
      ? participants.map(({ playerId }, index) => createParticipantSessionAccess(
          playerId,
          index === 0 ? sessionRole : "player"
        ))
      : [];
    const localAccess = privateInvite
      ? participantAccess[0]
      : createLocalSessionAccess(sessionRole);
    const created = await this.sessionStore.createSession({
      gameId,
      ...(request.contentSourceId === undefined ? {} : { contentSourceId: request.contentSourceId }),
      initialState,
      participants,
      sessionRole,
      immutableBundle: toImmutableGameBundle(bundle),
      principal: localAccess.principal,
      ...(privateInvite ? { additionalPrincipals: participantAccess.slice(1).map(({ principal }) => principal) } : {})
    });
    let driven: Awaited<ReturnType<AgentSeatDriver["drive"]>> | undefined;
    let recovered: {
      snapshot: SessionRecord<RuntimeState>;
      agentControl?: Awaited<ReturnType<typeof projectAgentControl>>;
    } | undefined;
    if (this.agentSeatDriver !== undefined) {
      try {
        driven = await this.agentSeatDriver.drive({
          sessionStore: this.sessionStore,
          credentialSha256: localAccess.principal.credentialSha256,
          sessionId: created.session.sessionId
        });
      } catch (error) {
        // Session creation and one-time credential handoff already committed.
        // A post-commit driver fault must not strand that credential.
        console.error(
          `[agent-seat] initial bounded driver failed for session ${created.session.sessionId}:`,
          error instanceof Error ? error.message : String(error)
        );
        try {
          const authoritative = await this.sessionStore.getSession(created.session.sessionId);
          if (authoritative !== null) {
            recovered = { snapshot: authoritative };
            try {
              const agentControl = await projectAgentControl({
                sessionStore: this.sessionStore,
                credentialSha256: localAccess.principal.credentialSha256,
                snapshot: authoritative
              });
              if (agentControl !== undefined) recovered.agentControl = agentControl;
            } catch (projectionError) {
              console.error(
                `[agent-seat] receipt-derived control projection failed for session ${created.session.sessionId}:`,
                projectionError instanceof Error ? projectionError.message : String(projectionError)
              );
            }
          }
        } catch (reloadError) {
          console.error(
            `[agent-seat] authoritative reload failed for session ${created.session.sessionId}:`,
            reloadError instanceof Error ? reloadError.message : String(reloadError)
          );
        }
      }
    }
    const snapshot = driven?.snapshot ?? recovered?.snapshot ?? created.session;
    const actorPlayerId = resolveSessionViewerActor(snapshot, created.principal);

    return {
      sessionId: snapshot.sessionId,
      gameId: snapshot.gameId,
      participants: snapshot.participants,
      version: snapshot.version,
      state: projectPlayerSessionState({
        state: snapshot.state,
        stateModel: bundle.manifest.mechanics.stateModel,
        ...(actorPlayerId === undefined ? {} : { actorPlayerId })
      }),
      actionAvailability: projectSessionActionAvailability(snapshot, bundle, {
        ...(actorPlayerId === undefined ? {} : { actorPlayerId }),
        sessionRole: created.principal.role
      }),
      ...((driven?.agentControl ?? recovered?.agentControl) === undefined
        ? {}
        : { agentControl: driven?.agentControl ?? recovered?.agentControl }),
      credential: localAccess.accessToken,
      ...(privateInvite ? {
        privateInvites: participantAccess.slice(1).map(({ accessToken }) => ({ credential: accessToken }))
      } : {})
    };
  }

  async getSession(sessionId: SessionId, accessToken: string): Promise<GetSessionResponse<RuntimeState>> {
    const { snapshot, principal, bundle } = await this.authenticateSessionAccess(sessionId, accessToken);
    const actorPlayerId = resolveSessionViewerActor(snapshot, principal);
    const agentControl = await projectAgentControl({
      sessionStore: this.sessionStore,
      credentialSha256: hashSessionCredential(accessToken),
      snapshot
    });
    return {
      sessionId: snapshot.sessionId,
      gameId: snapshot.gameId,
      participants: snapshot.participants,
      version: snapshot.version,
      state: projectPlayerSessionState({
        state: snapshot.state,
        stateModel: bundle.manifest.mechanics.stateModel,
        ...(actorPlayerId === undefined ? {} : { actorPlayerId })
      }),
      actionAvailability: projectSessionActionAvailability(snapshot, bundle, {
        ...(actorPlayerId === undefined ? {} : { actorPlayerId }),
        sessionRole: principal.role
      }),
      ...(agentControl === undefined ? {} : { agentControl })
    };
  }

  async archiveSession(
    sessionId: SessionId,
    accessToken: string
  ): Promise<AuthenticatedArchivedSessionAccess> {
    const archived = await this.sessionStore.archiveSession({
      sessionId,
      credentialSha256: hashSessionCredential(accessToken)
    });
    if (archived === null) throw new SessionAuthenticationError();
    return archived;
  }

  async readArchivedSession(
    sessionId: SessionId,
    accessToken: string
  ): Promise<AuthenticatedArchivedSessionAccess> {
    const archived = await this.sessionStore.readArchivedSession({
      sessionId,
      credentialSha256: hashSessionCredential(accessToken)
    });
    if (archived === null) throw new SessionAuthenticationError();
    return archived;
  }

  /**
   * Read only public durable events. A live session accepts any authenticated
   * principal; an archived session is available only through the store's
   * facilitator-checked archive boundary. If archiving wins a live-read race,
   * returning no journal is safer than exposing a partially assembled view.
   */
  async getPublicGameplayJournal(
    sessionId: SessionId,
    accessToken: string
  ): Promise<PortablePublicGameplayJournal> {
    const source = await this.sessionStore.readPublicJournalSource(
      { sessionId, credentialSha256: hashSessionCredential(accessToken) },
      MAX_PUBLIC_JOURNAL_ENTRIES + 1
    );
    if (source === null) throw new SessionAuthenticationError();
    return buildPublicGameplayJournal(source);
  }

  async restorePreviewSession(
    sessionId: SessionId,
    accessToken: string,
    request: RestorePreviewSessionRequest<RuntimeState>
  ): Promise<RestorePreviewSessionResponse<RuntimeState>> {
    // Preview restore mutates the complete trusted preview state. Session
    // membership alone is insufficient: an invite-scoped participant must
    // never gain the local editor controller's authority.
    const access = await this.authenticateSessionIdentity(sessionId, accessToken);
    if (access.principal.kind !== "local-controller") {
      throw new SessionAuthorizationError();
    }
    return this.sessionStore.withLockedSession(sessionId, async (current) => {
      if (!current) {
        throw new NotFoundError(`Session "${sessionId}" was not found`);
      }
      if (current.contentSourceId === undefined) {
        throw new HttpError(403, "Preview session restore is available only for editor preview sessions.");
      }

      const bundle = await this.getPinnedBundle(current);
      const actorPlayerId = resolveSessionViewerActor(current, access.principal);
      const limits = RUNTIME_BUDGETS[bundle.manifest.mechanics.budgetProfile];
      if (!limits) {
        throw new RequestValidationError("Preview state uses an unsupported Mechanics budget profile.");
      }
      try {
        assertMechanicsStateWithinBudget(request.state, limits, "candidate");
        assertStateMatchesModel({
          stateModel: bundle.manifest.mechanics.stateModel,
          state: request.state,
          preActionState: request.state,
          params: {},
          actor: {
            ...(actorPlayerId === undefined ? {} : { actorPlayerId }),
            sessionRole: access.principal.role
          },
          limits
        });
      } catch {
        // A trusted editor may supply old or hand-edited trace data, but it may
        // not bypass the immutable session's typed state contract. Do not echo
        // protected state paths or values into the public error.
        throw new RequestValidationError(
          "Preview state does not match the Mechanics state model pinned to this session."
        );
      }

      const restored: SessionRecord<RuntimeState> = {
        ...current,
        state: request.state,
        version: {
          sessionId,
          // A preview rewind creates a new durable state snapshot, but it must
          // never rewind the protected event ledger. Keeping this sequence
          // monotonic prevents later commands from reusing an existing
          // session_events id after the editor restores an older game state.
          stateVersion: current.version.stateVersion + 1,
          lastEventSequence: current.version.lastEventSequence
        },
        updatedAt: new Date()
      };
      return {
        updatedSession: restored,
        result: {
          sessionId: restored.sessionId,
          gameId: restored.gameId,
          participants: restored.participants,
          version: restored.version,
          state: projectPlayerSessionState({
            state: restored.state,
            stateModel: bundle.manifest.mechanics.stateModel,
            ...(actorPlayerId === undefined ? {} : { actorPlayerId })
          }),
          actionAvailability: projectSessionActionAvailability(restored, bundle, {
            ...(actorPlayerId === undefined ? {} : { actorPlayerId }),
            sessionRole: access.principal.role
          }),
          restored: true
        }
      };
    });
  }

  getSessionStore(): SessionStorePort<RuntimeState> {
    return this.sessionStore;
  }

  /** Authenticate and load the exact immutable rules pinned into this session. */
  async authenticateSessionAccess(
    sessionId: SessionId,
    accessToken: string
  ): Promise<AuthenticatedSessionAccess> {
    const credentialSha256 = hashSessionCredential(accessToken);
    const { snapshot, principal } = await this.authenticateSessionIdentityByDigest(sessionId, credentialSha256);
    return { snapshot, principal, bundle: await this.getPinnedBundle(snapshot) };
  }

  /** Authenticate an SSE cursor stream without constructing a player projection. */
  async authenticateSessionVersionAccess(
    sessionId: SessionId,
    accessToken: string
  ): Promise<{ version: SessionRecord<RuntimeState>["version"]; principalId: string }> {
    const { snapshot, principal } = await this.authenticateSessionIdentity(sessionId, accessToken);
    return { version: snapshot.version, principalId: principal.principalId };
  }

  private authenticateSessionIdentity(
    sessionId: SessionId,
    accessToken: string
  ): Promise<{ snapshot: SessionRecord<RuntimeState>; principal: SessionPrincipal }> {
    return this.authenticateSessionIdentityByDigest(sessionId, hashSessionCredential(accessToken));
  }

  private async authenticateSessionIdentityByDigest(
    sessionId: SessionId,
    credentialSha256: string
  ): Promise<{ snapshot: SessionRecord<RuntimeState>; principal: SessionPrincipal }> {
    const [snapshot, principal] = await Promise.all([
      this.sessionStore.getSession(sessionId),
      this.sessionStore.authenticateSession({ sessionId, credentialSha256 })
    ]);
    if (snapshot === null || principal === null) throw new SessionAuthenticationError();
    return { snapshot, principal };
  }

  private async getPinnedBundle(snapshot: SessionRecord<RuntimeState>): Promise<GameBundle> {
    const storedBundle = await this.sessionStore.getImmutableBundle(snapshot.bundleHash);
    if (storedBundle === null) {
      throw new SessionStoreUnavailableError();
    }
    return loadImmutableGameBundle(storedBundle);
  }
}
