/**
 * Agent Turn execution boundary for AI-driven games.
 *
 * Agent Runtime is the server-side boundary that executes one AI agent turn.
 * This module keeps that boundary explicit: the agent receives a validated
 * `CubicaAgentTurnInput` and may return only one published Game Intent. The
 * selected intent then runs through the same Mechanics IR candidate executor
 * as a human action, inside the existing command transaction.
 */
import {
  defaultCubicaSurfaceChannelActionPolicies,
  defaultCubicaSurfaceCatalog,
  validateAgentTurnInput,
  validateAgentTurnResult,
  type CubicaPublishedGameIntent,
  type CubicaAgentTurnInput,
  type CubicaAgentTurnResult,
  type CubicaJsonValue
} from "@cubica/contracts-ai";
import type {
  GameManifest,
  GameManifestAgentRuntimeConfig,
  GameManifestExecutionMode
} from "@cubica/contracts-manifest";
import type {
  DispatchActionInput,
  PublicSessionCommandReceipt,
  SessionActionAvailability,
  SessionEventRecord,
  SessionPrincipal,
  SessionRecord,
  SessionStorePort
} from "@cubica/contracts-session";
import {
  loadImmutableGameBundle,
  loadImmutableGameBundleForReceipt,
  type GameBundle
} from "../content/manifestLoader.ts";
import { HttpError, RequestValidationError } from "../errors.ts";
import { projectSessionActionAvailability } from "../runtime/actionAvailability.ts";
import {
  BoundedInMemoryCommandAdmissionController,
  type CommandAdmissionController
} from "../runtime/commandAdmission.ts";
import {
  executePublishedGameIntentCandidate,
  materializeSystemScheduleMutations,
  validatePublishedGameIntentEntryAdmission
} from "../runtime/actionDispatcher.ts";
import { processPendingSystemSchedules } from "../runtime/systemScheduler.ts";
import { listManifestActionDefinitions } from "../runtime/manifestActions.ts";
import {
  buildPlayerSessionProjection,
  projectPlayerSessionState
} from "../session/playerSessionProjection.ts";
import {
  createActionDefinitionHash,
  createAppliedCommandReceipt,
  createDurableCommandResult,
  createExternalCommandFingerprint,
  createRejectedCommandReceipt,
  requireDurableCommandResult
} from "../session/commandIdentity.ts";
import {
  resolveSessionActor,
  resolveSessionViewerActor
} from "../session/sessionAuthentication.ts";
import {
  CommandIdReusedError,
  SessionStoreUnavailableError,
  SessionVersionConflictError
} from "../session/sessionStoreErrors.ts";
import {
  buildAgentRuntimeUnavailableMessage,
  checkAgentRuntimeReadiness,
  MOCK_AGENT_RUNTIME_ID
} from "./agentRuntimeReadiness.ts";

type RuntimeState = Record<string, unknown>;
type JsonRecord = Record<string, CubicaJsonValue>;
const SELECT_PUBLISHED_INTENT_CAPABILITY = "selectPublishedIntent";

export type AgentTurnRequest = DispatchActionInput;

export interface AgentTurnServiceInput {
  readonly sessionStore: SessionStorePort<RuntimeState>;
  readonly credentialSha256: string;
  readonly request: AgentTurnRequest;
}

export interface AgentTurnServiceResponse {
  readonly sessionId: string;
  readonly version: SessionRecord<RuntimeState>["version"];
  readonly state: RuntimeState;
  readonly actionAvailability: ReadonlyArray<SessionActionAvailability>;
  readonly agentTurn: CubicaAgentTurnResult;
  readonly receipt: PublicSessionCommandReceipt;
}

interface AgentTurnTransactionOutcome {
  readonly committedState: boolean;
  readonly response: AgentTurnServiceResponse;
  /** Protected context used only to re-project a post-scheduler snapshot. */
  readonly refreshContext?: {
    readonly bundle: GameBundle;
    readonly principal: SessionPrincipal;
  };
}

/**
 * Runs one Agent Turn and commits its selected published intent atomically.
 */
export class AgentTurnService {
  private readonly admissionController: CommandAdmissionController;

  constructor(
    admissionController: CommandAdmissionController = new BoundedInMemoryCommandAdmissionController()
  ) {
    this.admissionController = admissionController;
  }

  async runTurn(input: AgentTurnServiceInput): Promise<AgentTurnServiceResponse> {
    const transaction = await input.sessionStore.withCommandTransaction<AgentTurnTransactionOutcome>({
      sessionId: input.request.sessionId,
      credentialSha256: input.credentialSha256,
      commandId: input.request.commandId
    }, async ({ currentSession: current, principal, bundle: storedBundle, existingReceipt }) => {
    const bundle = existingReceipt === undefined
      ? loadImmutableGameBundle(storedBundle)
      : loadImmutableGameBundleForReceipt(storedBundle);
    const manifest = bundle.manifest;
    const triggerDefinition = existingReceipt === undefined
      ? manifest.actions[input.request.actionId]
      : undefined;
    const definitionHash = existingReceipt?.definitionHash ?? createActionDefinitionHash({
      action: triggerDefinition ?? null,
      agentRuntime: manifest.agentRuntime ?? null
    });
    const agentTurnPlanHash = createActionDefinitionHash({
      actionId: input.request.actionId,
      runtimeId: manifest.agentRuntime?.runtimeId ?? null,
      execution: "agent-turn"
    });
    const fingerprint = createExternalCommandFingerprint({
      command: input.request,
      bundleHash: current.bundleHash,
      definitionHash
    });
    if (existingReceipt !== undefined) {
      if (existingReceipt.fingerprint !== fingerprint) {
        throw new CommandIdReusedError(input.request.commandId);
      }
      const agentTurn = requireStoredAgentTurn(existingReceipt.result);
      const viewerActorId = resolveSessionViewerActor(current, principal);
      return {
        result: {
          committedState: false,
          response: {
            sessionId: current.sessionId,
            version: current.version,
            state: projectActorState(current.state, bundle, viewerActorId),
            actionAvailability: projectSessionActionAvailability(current, bundle, {
              ...(viewerActorId === undefined ? {} : { actorPlayerId: viewerActorId }),
              sessionRole: principal.role
            }),
            agentTurn,
            receipt: existingReceipt.publicReceipt
          }
        }
      };
    }

    const actorId = resolveSessionActor(current, principal);
    const viewerActorId = resolveSessionViewerActor(current, principal);
    const sessionRole = principal.role;
    if (current.version.stateVersion !== input.request.expectedStateVersion) {
      throw new SessionVersionConflictError(current.sessionId, input.request.expectedStateVersion);
    }
    const executionMode = manifest.executionMode ?? "deterministic";
    if (executionMode === "deterministic") {
      throw new RequestValidationError("Agent turns are available only for hybrid or AI-driven games.");
    }

    const agentRuntime = requireAgentRuntimeConfig(manifest.agentRuntime, current.gameId);
    if (input.request.actionId !== agentRuntime.initialActionId || triggerDefinition === undefined) {
      throw new RequestValidationError(
        `Action "${input.request.actionId}" is not the published Agent Turn entry intent for this game.`
      );
    }
    validatePublishedGameIntentEntryAdmission({
      bundle,
      state: current.state,
      sessionId: current.sessionId,
      actionId: input.request.actionId,
      params: input.request.params,
      ...(actorId === undefined ? {} : { actorPlayerId: actorId }),
      sessionRole,
      now: new Date()
    });
    const readiness = checkAgentRuntimeReadiness(agentRuntime);
    if (readiness.status !== "ok") {
      throw new HttpError(503, buildAgentRuntimeUnavailableMessage(current.gameId, readiness));
    }

    const turnInput = buildAgentTurnInput({
      request: input.request,
      current,
      manifest,
      bundle,
      agentRuntime,
      executionMode,
      actorId,
      sessionRole
    });
    const inputValidation = validateAgentTurnInput(turnInput);
    if (!inputValidation.ok) {
      throw new HttpError(500, `Runtime built invalid Agent Turn input: ${formatDiagnostics(inputValidation.diagnostics)}`);
    }

    await this.admissionController.assertNewCommandAdmitted({
      sessionId: current.sessionId,
      principalId: principal.principalId,
      commandId: input.request.commandId,
      kind: "agent-turn",
      // The current mock adapter has one bounded call. A real provider adapter
      // can replace this with a reviewed pre-call estimate through this seam.
      costUnits: 1
    });
    const agentTurn = await runConfiguredAgentRuntime(turnInput, agentRuntime);
    const resultValidation = validateAgentTurnResult(agentTurn, {
      catalog: defaultCubicaSurfaceCatalog,
      targetChannel: "web",
      channelActionPolicy: defaultCubicaSurfaceChannelActionPolicies.webPlayerPrimaryGameplay,
      availableIntents: turnInput.availableIntents,
      agentTurnEntryActionId: agentRuntime.initialActionId
    });
    if (!resultValidation.ok) {
      throw new HttpError(502, `Agent Runtime returned invalid Agent Turn result: ${formatDiagnostics(resultValidation.diagnostics)}`);
    }

    assertSurfaceCatalogAllowed(agentTurn, agentRuntime);

    if (agentTurn.ok !== true) {
      const receipt = createRejectedCommandReceipt({
        command: input.request,
        principal,
        ...(actorId === undefined ? {} : { actorId }),
        current,
        fingerprint,
        definitionHash,
        planHash: agentTurnPlanHash,
        rejectionCode: "AGENT_TURN_REJECTED",
        commandKind: "agent-turn",
        durableResult: createDurableCommandResult("agent-turn", agentTurn)
      });
      return {
        receipt,
        result: {
          committedState: false,
          response: {
            sessionId: current.sessionId,
            version: current.version,
            state: projectActorState(current.state, bundle, viewerActorId),
            actionAvailability: projectSessionActionAvailability(current, bundle, {
              ...(viewerActorId === undefined ? {} : { actorPlayerId: viewerActorId }),
              sessionRole
            }),
            agentTurn,
            receipt: receipt.publicReceipt
          }
        }
      };
    }

    const selectedIntent = agentTurn.selectedIntent;
    if (selectedIntent === undefined) {
      // Schema/semantic validation above already enforces this. This branch is
      // retained as a defensive type boundary before authoritative execution.
      throw new HttpError(502, "Agent Runtime did not select a published Game Intent.");
    }
    let executed: Awaited<ReturnType<typeof executePublishedGameIntentCandidate>>;
    try {
      executed = await executePublishedGameIntentCandidate({
        bundle,
        state: current.state,
        sessionId: current.sessionId,
        actionId: selectedIntent.actionId,
        params: selectedIntent.params,
        ...(actorId === undefined ? {} : { actorPlayerId: actorId }),
        sessionRole,
        now: new Date()
      });
    } catch (error) {
      if (!(error instanceof RequestValidationError)) {
        throw error;
      }

      // The provider has already produced a schema-valid selected intent. A
      // live reference, role, or action-parameter rejection is therefore a
      // terminal result of this logical Agent Turn—not permission to call the
      // non-deterministic provider again on an exact transport retry.
      const selectedDefinition = manifest.actions[selectedIntent.actionId];
      const selectedPlan = selectedDefinition === undefined
        ? undefined
        : manifest.mechanics.plans[selectedDefinition.binding.planRef];
      const receipt = createRejectedCommandReceipt({
        command: input.request,
        principal,
        ...(actorId === undefined ? {} : { actorId }),
        current,
        fingerprint,
        definitionHash,
        ...(selectedPlan === undefined ? {} : { planHash: selectedPlan.planHash }),
        rejectionCode: "AGENT_SELECTED_INTENT_INVALID",
        commandKind: "agent-turn",
        durableResult: createDurableCommandResult("agent-turn", agentTurn),
        selectedActionId: selectedIntent.actionId
      });
      return {
        receipt,
        result: {
          committedState: false,
          response: {
            sessionId: current.sessionId,
            version: current.version,
            state: projectActorState(current.state, bundle, viewerActorId),
            actionAvailability: projectSessionActionAvailability(current, bundle, {
              ...(viewerActorId === undefined ? {} : { actorPlayerId: viewerActorId }),
              sessionRole
            }),
            agentTurn,
            receipt: receipt.publicReceipt
          }
        }
      };
    }
    if (!executed.result.ok || executed.candidateState === undefined) {
      const receipt = createRejectedCommandReceipt({
        command: input.request,
        principal,
        ...(actorId === undefined ? {} : { actorId }),
        current,
        fingerprint,
        definitionHash,
        planHash: executed.planHash,
        rejectionCode: executed.result.error?.code ?? "AGENT_SELECTED_INTENT_REJECTED",
        commandKind: "agent-turn",
        durableResult: createDurableCommandResult("agent-turn", agentTurn),
        selectedActionId: selectedIntent.actionId
      });
      return {
        receipt,
        result: {
          committedState: false,
          response: {
            sessionId: current.sessionId,
            version: current.version,
            state: projectActorState(current.state, bundle, viewerActorId),
            actionAvailability: projectSessionActionAvailability(current, bundle, {
              ...(viewerActorId === undefined ? {} : { actorPlayerId: viewerActorId }),
              sessionRole
            }),
            agentTurn,
            receipt: receipt.publicReceipt
          }
        }
      };
    }

    const eventRefs = executed.events.map((_, index) =>
      `${current.sessionId}:${current.version.lastEventSequence + index + 1}`
    );
    const nextSnapshot: SessionRecord<RuntimeState> = {
      ...current,
      state: executed.candidateState,
      version: {
        sessionId: current.sessionId,
        stateVersion: current.version.stateVersion + 1,
        lastEventSequence: current.version.lastEventSequence + executed.events.length
      },
      updatedAt: new Date()
    };
    const receipt = createAppliedCommandReceipt({
      command: input.request,
      principal,
      ...(actorId === undefined ? {} : { actorId }),
      before: current,
      after: nextSnapshot,
      fingerprint,
      definitionHash,
      planHash: executed.planHash,
      eventRefs,
      ...(executed.result.mechanicsAudit === undefined
        ? {}
        : { mechanicsAudit: executed.result.mechanicsAudit }),
      commandKind: "agent-turn",
      durableResult: createDurableCommandResult("agent-turn", agentTurn),
      selectedActionId: selectedIntent.actionId
    });
    const events: SessionEventRecord[] = executed.events.map((event, index) => ({
      eventId: eventRefs[index],
      sessionId: current.sessionId,
      sequence: current.version.lastEventSequence + index + 1,
      receiptId: receipt.receiptId,
      commandId: input.request.commandId,
      // Gameplay events describe the selected intent that actually changed
      // state. The trigger remains explicit in the receipt audit.
      actionId: selectedIntent.actionId,
      principalId: principal.principalId,
      ...(actorId === undefined ? {} : { actorId }),
      audience: event.audience,
      eventType: event.eventType,
      summary: structuredClone(event.summary),
      data: structuredClone(event.data),
      ...(event.metricChanges === undefined
        ? {}
        : { metricChanges: structuredClone(event.metricChanges) }),
      createdAt: nextSnapshot.updatedAt
    }));
    const nextViewerActorId = resolveSessionViewerActor(nextSnapshot, principal);
    const scheduleMutations = materializeSystemScheduleMutations({
      mutations: executed.result.systemScheduleMutations ?? [],
      bundle,
      sessionId: current.sessionId,
      bundleHash: current.bundleHash,
      now: nextSnapshot.updatedAt
    });

    return {
      updatedSession: nextSnapshot,
      receipt,
      events,
      ...(scheduleMutations.length === 0 ? {} : { scheduleMutations }),
      result: {
        committedState: true,
        refreshContext: { bundle, principal },
        response: {
          sessionId: nextSnapshot.sessionId,
          version: nextSnapshot.version,
          state: projectActorState(nextSnapshot.state, bundle, nextViewerActorId),
          actionAvailability: projectSessionActionAvailability(nextSnapshot, bundle, {
            ...(nextViewerActorId === undefined ? {} : { actorPlayerId: nextViewerActorId }),
            sessionRole
          }),
          agentTurn,
          receipt: receipt.publicReceipt
        }
      }
    };
    });

    if (!transaction) throw new SessionStoreUnavailableError();
    if (transaction.committedState) {
      try {
        // Agent-selected intents share the same post-commit scheduler boundary
        // as human commands. The pass is deliberately outside the external
        // command transaction so a scheduler fault cannot roll back or mask an
        // Agent Turn that already has a durable receipt.
        await processPendingSystemSchedules(input.sessionStore, input.request.sessionId);
      } catch (error) {
        console.error(
          `[system-scheduler] bounded pass failed after Agent Turn for session ${input.request.sessionId}:`,
          error instanceof Error ? error.message : String(error)
        );
      }

      try {
        // Reload even after a failed bounded pass: an earlier schedule may
        // already have committed. The active actor is resolved again so a
        // system-driven turn advance cannot expose the previous hot-seat
        // participant's actor-scoped state.
        const latest = await input.sessionStore.getSession(input.request.sessionId);
        const refreshContext = transaction.refreshContext;
        if (latest !== null && refreshContext !== undefined) {
          const latestViewerActorId = resolveSessionViewerActor(latest, refreshContext.principal);
          return {
            ...transaction.response,
            version: latest.version,
            state: projectActorState(latest.state, refreshContext.bundle, latestViewerActorId),
            actionAvailability: projectSessionActionAvailability(latest, refreshContext.bundle, {
              ...(latestViewerActorId === undefined ? {} : { actorPlayerId: latestViewerActorId }),
              sessionRole: refreshContext.principal.role
            })
          };
        }
      } catch (error) {
        console.error(
          `[system-scheduler] current Agent Turn snapshot reload failed for session ${input.request.sessionId}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
    return transaction.response;
  }
}

function requireStoredAgentTurn(value: unknown): CubicaAgentTurnResult {
  try {
    const stored = requireDurableCommandResult(value, "agent-turn").value;
    if (
      typeof stored !== "object" || stored === null || Array.isArray(stored) ||
      typeof (stored as { ok?: unknown }).ok !== "boolean"
    ) {
      throw new Error("invalid stored Agent Turn result");
    }
    // The result was fully validated before it entered the receipt. Exact
    // retry reads that pinned format, not today's catalog or provider policy;
    // otherwise a compatible platform upgrade could make an applied command
    // impossible to replay without risking a second model invocation.
    return structuredClone(stored) as CubicaAgentTurnResult;
  } catch {
    throw new SessionStoreUnavailableError();
  }
}

function requireAgentRuntimeConfig(
  agentRuntime: GameManifestAgentRuntimeConfig | undefined,
  gameId: string
): GameManifestAgentRuntimeConfig {
  if (agentRuntime?.required !== true) {
    throw new RequestValidationError(`Game "${gameId}" does not declare a required Agent Runtime.`);
  }
  if (!agentRuntime.allowedCapabilities.includes(SELECT_PUBLISHED_INTENT_CAPABILITY)) {
    throw new RequestValidationError(
      `Game "${gameId}" does not allow Agent Runtime to select a published Game Intent.`
    );
  }
  return agentRuntime;
}

function buildAgentTurnInput(input: {
  readonly request: AgentTurnRequest;
  readonly current: SessionRecord<RuntimeState>;
  readonly manifest: GameManifest;
  readonly bundle: GameBundle;
  readonly agentRuntime: GameManifestAgentRuntimeConfig;
  readonly executionMode: Exclude<GameManifestExecutionMode, "deterministic">;
  readonly actorId?: string;
  readonly sessionRole: "player" | "facilitator" | "assistant" | "observer";
}): CubicaAgentTurnInput {
  const { current, manifest, agentRuntime, request } = input;
  const playerProjection = buildPlayerSessionProjection({
    state: current.state,
    stateModel: input.bundle.manifest.mechanics.stateModel,
    ...(input.actorId === undefined ? {} : { actorPlayerId: input.actorId })
  });
  const publicState = buildAgentPublicStateScope(playerProjection.publicAudienceState);
  const actorState = input.actorId === undefined
    ? undefined
    : buildAgentActorStateScope(playerProjection.actorAudienceState, input.actorId);
  const triggerPayload = optionalJsonValue(request.params, "params");
  const trigger = {
    kind: "playerAction" as const,
    actionId: request.actionId,
    ...(triggerPayload === undefined ? {} : { payload: triggerPayload })
  };
  const availableIntents = buildAvailableGameIntents(
    current,
    input.bundle,
    agentRuntime.initialActionId,
    input.actorId,
    input.sessionRole
  );

  return {
    schemaVersion: "1.0.0",
    turnId: createId("turn"),
    sessionId: current.sessionId,
    gameId: current.gameId,
    ...(input.actorId === undefined ? {} : { playerId: input.actorId }),
    agentId: agentRuntime.agentId,
    executionMode: input.executionMode,
    trigger,
    // The model receives the same state-model projection as a human viewer:
    // public symbols plus, when present, this actor's isolated branch. The
    // server-only `secret` channel remains empty under the current policy.
    stateScope: {
      public: publicState,
      ...(actorState === undefined ? {} : { actor: actorState })
    },
    manifestProjection: buildManifestProjection(manifest, agentRuntime, input.executionMode, availableIntents),
    availableIntents,
    surfaceCatalog: agentRuntime.surfaceCatalog,
    correlationId: createId("correlation")
  };
}

function buildManifestProjection(
  manifest: GameManifest,
  agentRuntime: GameManifestAgentRuntimeConfig,
  executionMode: Exclude<GameManifestExecutionMode, "deterministic">,
  availableIntents: readonly CubicaPublishedGameIntent[]
): JsonRecord {
  return {
    gameId: manifest.meta.id,
    version: manifest.meta.version,
    name: manifest.meta.name,
    executionMode,
    surfaceCatalog: agentRuntime.surfaceCatalog,
    actions: toJsonValue(availableIntents, "manifestProjection.actions")
  };
}

/**
 * Projects the trusted action catalog into the exact choices an agent may
 * make for this actor and snapshot. The Agent Turn entry action is excluded so
 * a selected intent can never recursively start another Agent Turn.
 */
function buildAvailableGameIntents(
  current: SessionRecord<RuntimeState>,
  bundle: GameBundle,
  initialActionId: string,
  actorPlayerId: string | undefined,
  sessionRole: "player" | "facilitator" | "assistant" | "observer"
): CubicaPublishedGameIntent[] {
  const availability = new Map(
    projectSessionActionAvailability(current, bundle, {
      ...(actorPlayerId === undefined ? {} : { actorPlayerId }),
      sessionRole
    }).map((item) => [item.actionId, item.status])
  );

  return listManifestActionDefinitions(bundle)
    .filter((definition) => definition.invocation === "external")
    .filter((definition) => definition.actionId !== initialActionId)
    .filter((definition) => availability.get(definition.actionId) !== "unavailable")
    .map((definition) => {
      const displayName = definition.raw.displayName;
      return {
        actionId: definition.actionId,
        label: typeof displayName === "string" && displayName.trim() !== ""
          ? displayName
          : definition.actionId,
        ...(definition.paramsSchema === undefined
          ? {}
          : { paramsSchema: toJsonRecord(definition.paramsSchema, `actions.${definition.actionId}.paramsSchema`) })
      };
    });
}

async function runConfiguredAgentRuntime(
  input: CubicaAgentTurnInput,
  agentRuntime: GameManifestAgentRuntimeConfig
): Promise<CubicaAgentTurnResult> {
  if (agentRuntime.runtimeId === MOCK_AGENT_RUNTIME_ID) {
    return runMockAgentRuntime(input);
  }

  throw new HttpError(503, `Agent Runtime "${agentRuntime.runtimeId ?? "default"}" is not configured.`);
}

function runMockAgentRuntime(input: CubicaAgentTurnInput): CubicaAgentTurnResult {
  const canRenderChoiceList = input.surfaceCatalog.includes("cubica.choiceList");
  const narration = input.trigger.actionId === undefined
    ? "Agent Runtime prepared the next AI-driven turn."
    : `Agent Runtime accepted player action "${input.trigger.actionId}".`;
  const selectedIntent = input.availableIntents[0];
  const initialActionId = input.trigger.actionId;
  if (selectedIntent === undefined || initialActionId === undefined) {
    return {
      schemaVersion: "1.0.0",
      turnId: input.turnId,
      agentId: input.agentId,
      ok: false,
      narration: "No published Game Intent is available for this Agent Turn.",
      audit: {
        source: "mock",
        createdAt: new Date().toISOString(),
        runId: createId("mock-run")
      },
      error: {
        code: "no_available_intent",
        message: "Agent Runtime received no entry action or actor-scoped Game Intent."
      }
    };
  }

  return {
    schemaVersion: "1.0.0",
    turnId: input.turnId,
    agentId: input.agentId,
    ok: true,
    narration,
    selectedIntent: {
      actionId: selectedIntent.actionId,
      params: {}
    },
    surface: canRenderChoiceList
      ? {
          schemaVersion: "1.0.0",
          surfaceId: `surface-${input.turnId}`,
          catalogVersion: "2026-06-11",
          mode: "primary-gameplay",
          title: "Agent turn",
          dataModel: {
            narration
          },
          root: {
            id: "root",
            kind: "cubica.choiceList",
            props: {
              label: narration,
              choices: [
                {
                  id: "continue",
                  label: "Continue"
                }
              ]
            },
            actions: [
              {
                id: "agent.request-next-choice",
                kind: "agentTurn",
                label: "Continue",
                target: initialActionId,
                payload: {
                  choiceId: "continue"
                },
                sideEffectPolicy: "system-approved"
              }
            ]
          }
        }
      : undefined,
    audit: {
      source: "mock",
      createdAt: new Date().toISOString(),
      runId: createId("mock-run")
    }
  };
}

function assertSurfaceCatalogAllowed(
  result: CubicaAgentTurnResult,
  agentRuntime: GameManifestAgentRuntimeConfig
): void {
  if (result.surface === undefined) {
    return;
  }
  const allowed = new Set(agentRuntime.surfaceCatalog);
  for (const component of flattenSurfaceComponents(result.surface.root)) {
    if (!allowed.has(component.kind)) {
      throw new HttpError(502, `Agent Runtime returned component outside manifest surfaceCatalog: ${component.kind}`);
    }
  }
}

function flattenSurfaceComponents(
  component: NonNullable<CubicaAgentTurnResult["surface"]>["root"]
): Array<NonNullable<CubicaAgentTurnResult["surface"]>["root"]> {
  return [component, ...(component.children ?? []).flatMap((child) => flattenSurfaceComponents(child))];
}

/**
 * Keep the established direct `state.public` shape while namespacing public
 * values physically stored per player under `stateScope.public.players`.
 */
function buildAgentPublicStateScope(state: RuntimeState): JsonRecord {
  const scope = stateSectionToJsonRecord(state.public, "playerView.public");
  if (isUnknownRecord(state.players) && Object.keys(state.players).length > 0) {
    addScopeProperty(scope, "players", toJsonValue(state.players, "playerView.public.players"));
  }
  return scope;
}

/** Build the actor channel from actor-labelled values, independent of storage root. */
function buildAgentActorStateScope(state: RuntimeState, actorPlayerId: string): JsonRecord | undefined {
  const scope = stateSectionToJsonRecord(state.public, "playerView.actor.public");
  const players = isUnknownRecord(state.players) ? state.players : {};
  const ownPlayerState = players[actorPlayerId];
  if (isUnknownRecord(ownPlayerState)) {
    for (const [key, value] of Object.entries(toJsonRecord(ownPlayerState, "playerView.actor.players.actor"))) {
      addScopeProperty(scope, key, value);
    }
  }
  return Object.keys(scope).length === 0 ? undefined : scope;
}

function addScopeProperty(scope: JsonRecord, key: string, value: CubicaJsonValue): void {
  if (Object.prototype.hasOwnProperty.call(scope, key)) {
    // Two physical roots cannot silently collapse into one model field. A
    // manifest with this ambiguity must be corrected before an Agent Turn.
    throw new HttpError(500, `Player projection has conflicting Agent Turn field "${key}".`);
  }
  scope[key] = value;
}

/** Apply the pinned state-model visibility policy for HTTP and model views. */
function projectActorState(
  state: RuntimeState,
  bundle: GameBundle,
  actorPlayerId: string | undefined
): RuntimeState {
  return projectPlayerSessionState({
    state,
    stateModel: bundle.manifest.mechanics.stateModel,
    ...(actorPlayerId === undefined ? {} : { actorPlayerId })
  });
}

function stateSectionToJsonRecord(value: unknown, pathLabel: string): JsonRecord {
  if (value === undefined) {
    return {};
  }
  if (!isUnknownRecord(value)) {
    throw new HttpError(500, `${pathLabel} must be an object before it can be sent to Agent Runtime.`);
  }
  return toJsonRecord(value, pathLabel);
}

function toJsonRecord(value: Record<string, unknown>, pathLabel: string): JsonRecord {
  const result: Record<string, CubicaJsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = toJsonValue(item, `${pathLabel}.${key}`);
  }
  return result;
}

function optionalJsonValue(value: unknown, pathLabel: string): CubicaJsonValue | undefined {
  return value === undefined ? undefined : toJsonValue(value, pathLabel);
}

function toJsonValue(value: unknown, pathLabel: string): CubicaJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RequestValidationError(`${pathLabel} must be a finite JSON number.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => toJsonValue(item, `${pathLabel}[${index}]`));
  }
  if (isUnknownRecord(value)) {
    return toJsonRecord(value, pathLabel);
  }

  throw new RequestValidationError(`${pathLabel} must be JSON-compatible.`);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDiagnostics(diagnostics: readonly { readonly pointer: string; readonly message: string }[]): string {
  return diagnostics.map((diagnostic) => `${diagnostic.pointer} ${diagnostic.message}`).join("; ");
}
