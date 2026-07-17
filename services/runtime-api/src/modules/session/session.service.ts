/**
 * Session lifecycle boundary for credential handoff and safe player views.
 *
 * Creation captures immutable rules and returns a raw credential exactly once.
 * Every later read authenticates that credential and loads rules exclusively
 * through the `bundleHash` pinned into the durable session record.
 */

import type {
  CreateSessionRequest,
  CreateSessionResponse,
  GetSessionResponse,
  RestorePreviewSessionRequest,
  RestorePreviewSessionResponse,
  SessionId,
  SessionPrincipal,
  SessionRecord,
  SessionStorePort
} from "@cubica/contracts-session";
import { assertGameLaunchReady } from "../admin/health.ts";
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
  hashSessionCredential,
  resolveSessionViewerActor
} from "./sessionAuthentication.ts";
import { SessionAuthenticationError, SessionStoreUnavailableError } from "./sessionStoreErrors.ts";
import { initializeTurnBasedSessionState } from "./turnBasedSessionState.ts";

type RuntimeState = Record<string, unknown>;

interface SessionServiceOptions {
  sessionStore: SessionStorePort<RuntimeState>;
  /** Internal deterministic-test seam; HTTP callers can never select a seed. */
  createSessionRandomSeed?: () => string;
}

export interface AuthenticatedSessionAccess {
  snapshot: SessionRecord<RuntimeState>;
  principal: SessionPrincipal;
  bundle: GameBundle;
}

export class SessionService {
  private readonly sessionStore: SessionStorePort<RuntimeState>;
  private readonly createSessionRandomSeed?: () => string;

  constructor(options: SessionServiceOptions) {
    this.sessionStore = options.sessionStore;
    this.createSessionRandomSeed = options.createSessionRandomSeed;
  }

  async createSession(request: CreateSessionRequest): Promise<CreateSessionResponse<RuntimeState>> {
    const gameId = request.gameId;
    if (!gameId) {
      throw new RequestValidationError("gameId is required to create a session");
    }

    await assertGameLaunchReady({ gameId, contentSourceId: request.contentSourceId });
    const bundle = await contentService.getBundle(gameId, request.contentSourceId);
    const declaredState = extractInitialState(bundle) as RuntimeState;
    const initialState = initializeTurnBasedSessionState(bundle.manifest, declaredState, {
      randomSeed: this.createSessionRandomSeed?.()
    });
    // A client never chooses its own trusted role. Facilitated mode is the one
    // current manifest rule that creates a facilitator controller.
    const sessionRole = bundle.manifest.config.sessionMode === "facilitated"
      ? "facilitator"
      : "player";
    const localAccess = createLocalSessionAccess(sessionRole);
    const created = await this.sessionStore.createSession({
      gameId,
      ...(request.contentSourceId === undefined ? {} : { contentSourceId: request.contentSourceId }),
      initialState,
      sessionRole,
      immutableBundle: toImmutableGameBundle(bundle),
      principal: localAccess.principal
    });
    const snapshot = created.session;
    const actorPlayerId = resolveSessionViewerActor(snapshot, created.principal);

    return {
      sessionId: snapshot.sessionId,
      gameId: snapshot.gameId,
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
      credential: localAccess.accessToken
    };
  }

  async getSession(sessionId: SessionId, accessToken: string): Promise<GetSessionResponse<RuntimeState>> {
    const { snapshot, principal, bundle } = await this.authenticateSessionAccess(sessionId, accessToken);
    const actorPlayerId = resolveSessionViewerActor(snapshot, principal);
    return {
      sessionId: snapshot.sessionId,
      gameId: snapshot.gameId,
      version: snapshot.version,
      state: projectPlayerSessionState({
        state: snapshot.state,
        stateModel: bundle.manifest.mechanics.stateModel,
        ...(actorPlayerId === undefined ? {} : { actorPlayerId })
      }),
      actionAvailability: projectSessionActionAvailability(snapshot, bundle, {
        ...(actorPlayerId === undefined ? {} : { actorPlayerId }),
        sessionRole: principal.role
      })
    };
  }

  async restorePreviewSession(
    sessionId: SessionId,
    accessToken: string,
    request: RestorePreviewSessionRequest<RuntimeState>
  ): Promise<RestorePreviewSessionResponse<RuntimeState>> {
    // Preview restore is a trusted editor operation, not a gameplay command,
    // but it still requires current session membership before taking the lock.
    const access = await this.authenticateSessionAccess(sessionId, accessToken);
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
    const [snapshot, principal] = await Promise.all([
      this.sessionStore.getSession(sessionId),
      this.sessionStore.authenticateSession({ sessionId, credentialSha256 })
    ]);
    if (snapshot === null || principal === null) {
      throw new SessionAuthenticationError();
    }
    return { snapshot, principal, bundle: await this.getPinnedBundle(snapshot) };
  }

  private async getPinnedBundle(snapshot: SessionRecord<RuntimeState>): Promise<GameBundle> {
    const storedBundle = await this.sessionStore.getImmutableBundle(snapshot.bundleHash);
    if (storedBundle === null) {
      throw new SessionStoreUnavailableError();
    }
    return loadImmutableGameBundle(storedBundle);
  }
}
