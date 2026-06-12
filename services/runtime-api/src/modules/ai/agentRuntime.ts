/**
 * Agent Turn execution boundary for AI-driven games.
 *
 * Agent Runtime is the server-side boundary that executes one AI agent turn.
 * This module keeps that boundary explicit: the agent receives a validated
 * `CubicaAgentTurnInput`, returns a validated `CubicaAgentTurnResult`, and the
 * runtime applies only a small allowlisted set of state effects before writing
 * the next session snapshot.
 */
import {
  defaultCubicaSurfaceChannelActionPolicies,
  defaultCubicaSurfaceCatalog,
  validateAgentTurnCapabilities,
  validateAgentTurnInput,
  validateAgentTurnResult,
  type CubicaAgentStateEffect,
  type CubicaAgentTurnInput,
  type CubicaAgentTurnResult,
  type CubicaJsonValue
} from "@cubica/contracts-ai";
import type {
  GameManifest,
  GameManifestAgentRuntimeConfig,
  GameManifestExecutionMode
} from "@cubica/contracts-manifest";
import type { SessionRecord, SessionStorePort } from "@cubica/contracts-session";
import { contentService } from "../content/contentService.ts";
import { HttpError, NotFoundError, RequestValidationError } from "../errors.ts";
import {
  buildAgentRuntimeUnavailableMessage,
  checkAgentRuntimeReadiness,
  MOCK_AGENT_RUNTIME_ID
} from "./agentRuntimeReadiness.ts";

type RuntimeState = Record<string, unknown>;
type JsonRecord = Record<string, CubicaJsonValue>;

export interface AgentTurnRequest {
  readonly sessionId: string;
  readonly playerId?: string;
  readonly actionId?: string;
  readonly payload?: unknown;
}

export interface AgentTurnServiceInput {
  readonly sessionStore: SessionStorePort<RuntimeState>;
  readonly contentSourceId?: string;
  readonly request: AgentTurnRequest;
}

export interface AgentTurnServiceResponse {
  readonly sessionId: string;
  readonly version: SessionRecord<RuntimeState>["version"];
  readonly state: RuntimeState;
  readonly agentTurn: CubicaAgentTurnResult;
}

/**
 * Runs one Agent Turn and persists accepted state effects.
 */
export class AgentTurnService {
  async runTurn(input: AgentTurnServiceInput): Promise<AgentTurnServiceResponse> {
    const current = await input.sessionStore.getSession(input.request.sessionId);
    if (current === null) {
      throw new NotFoundError(`Session "${input.request.sessionId}" was not found`);
    }

    const manifest = await contentService.getGameManifest(current.gameId, input.contentSourceId);
    const executionMode = manifest.executionMode ?? "deterministic";
    if (executionMode === "deterministic") {
      throw new RequestValidationError("Agent turns are available only for hybrid or AI-driven games.");
    }

    const agentRuntime = requireAgentRuntimeConfig(manifest.agentRuntime, current.gameId);
    const readiness = checkAgentRuntimeReadiness(agentRuntime);
    if (readiness.status !== "ok") {
      throw new HttpError(503, buildAgentRuntimeUnavailableMessage(current.gameId, readiness));
    }

    const turnInput = buildAgentTurnInput({
      request: input.request,
      current,
      manifest,
      agentRuntime,
      executionMode
    });
    const inputValidation = validateAgentTurnInput(turnInput);
    if (!inputValidation.ok) {
      throw new HttpError(500, `Runtime built invalid Agent Turn input: ${formatDiagnostics(inputValidation.diagnostics)}`);
    }

    const agentTurn = await runConfiguredAgentRuntime(turnInput, agentRuntime);
    const resultValidation = validateAgentTurnResult(agentTurn, {
      catalog: defaultCubicaSurfaceCatalog,
      targetChannel: "web",
      channelActionPolicy: defaultCubicaSurfaceChannelActionPolicies.webPlayerPrimaryGameplay
    });
    if (!resultValidation.ok) {
      throw new HttpError(502, `Agent Runtime returned invalid Agent Turn result: ${formatDiagnostics(resultValidation.diagnostics)}`);
    }

    const capabilityDiagnostics = validateAgentTurnCapabilities(agentTurn, agentRuntime.allowedCapabilities);
    if (capabilityDiagnostics.length > 0) {
      throw new HttpError(502, `Agent Runtime exceeded manifest allowedCapabilities: ${formatDiagnostics(capabilityDiagnostics)}`);
    }

    assertSurfaceCatalogAllowed(agentTurn, agentRuntime);

    if (agentTurn.ok !== true) {
      return {
        sessionId: current.sessionId,
        version: current.version,
        state: current.state,
        agentTurn
      };
    }

    const nextState = applyAgentEffects(current.state, agentTurn.effects ?? []);
    const nextSnapshot: SessionRecord<RuntimeState> = {
      ...current,
      state: nextState,
      version: createNextVersion(current),
      updatedAt: new Date()
    };

    const persisted = await input.sessionStore.updateSession(nextSnapshot);
    return {
      sessionId: persisted.sessionId,
      version: persisted.version,
      state: persisted.state,
      agentTurn
    };
  }
}

function requireAgentRuntimeConfig(
  agentRuntime: GameManifestAgentRuntimeConfig | undefined,
  gameId: string
): GameManifestAgentRuntimeConfig {
  if (agentRuntime?.required !== true) {
    throw new RequestValidationError(`Game "${gameId}" does not declare a required Agent Runtime.`);
  }
  return agentRuntime;
}

function buildAgentTurnInput(input: {
  readonly request: AgentTurnRequest;
  readonly current: SessionRecord<RuntimeState>;
  readonly manifest: GameManifest;
  readonly agentRuntime: GameManifestAgentRuntimeConfig;
  readonly executionMode: Exclude<GameManifestExecutionMode, "deterministic">;
}): CubicaAgentTurnInput {
  const { current, manifest, agentRuntime, request } = input;
  const publicState = stateSectionToJsonRecord(current.state.public, "state.public");
  const secretState = agentRuntime.contextExposurePolicy?.secretState === "role-scoped"
    ? stateSectionToJsonRecord(current.state.secret, "state.secret")
    : undefined;
  const triggerPayload = optionalJsonValue(request.payload, "payload");
  const trigger = request.actionId === undefined
    ? {
        kind: "systemEvent" as const,
        eventType: "agent.turn",
        ...(triggerPayload === undefined ? {} : { payload: triggerPayload })
      }
    : {
        kind: "playerAction" as const,
        actionId: request.actionId,
        ...(triggerPayload === undefined ? {} : { payload: triggerPayload })
      };

  return {
    schemaVersion: "1.0.0",
    turnId: createId("turn"),
    sessionId: current.sessionId,
    gameId: current.gameId,
    ...(request.playerId === undefined ? {} : { playerId: request.playerId }),
    agentId: agentRuntime.agentId,
    executionMode: input.executionMode,
    trigger,
    stateScope: secretState === undefined
      ? { public: publicState }
      : { public: publicState, secret: secretState },
    manifestProjection: buildManifestProjection(manifest, agentRuntime, input.executionMode),
    allowedCapabilities: agentRuntime.allowedCapabilities,
    surfaceCatalog: agentRuntime.surfaceCatalog,
    correlationId: createId("correlation")
  };
}

function buildManifestProjection(
  manifest: GameManifest,
  agentRuntime: GameManifestAgentRuntimeConfig,
  executionMode: Exclude<GameManifestExecutionMode, "deterministic">
): JsonRecord {
  return {
    gameId: manifest.meta.id,
    version: manifest.meta.version,
    name: manifest.meta.name,
    executionMode,
    allowedCapabilities: agentRuntime.allowedCapabilities,
    surfaceCatalog: agentRuntime.surfaceCatalog,
    actions: Object.entries(manifest.actions).map(([actionId, definition]) => ({
      actionId,
      displayName: definition.displayName ?? actionId,
      capabilityFamily: definition.capabilityFamily ?? null,
      capability: definition.capability ?? null
    }))
  };
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
  const availableActions = [
    {
      actionId: "agent.continue",
      label: "Continue",
      kind: "agentTurn" as const,
      sideEffectPolicy: "system-approved" as const
    }
  ];

  return {
    schemaVersion: "1.0.0",
    turnId: input.turnId,
    agentId: input.agentId,
    ok: true,
    narration,
    effects: [
      {
        kind: "appendLog",
        target: "public.log",
        data: {
          kind: "agent-turn",
          summary: narration,
          turnId: input.turnId,
          source: "mock",
          actionId: input.trigger.actionId ?? null
        }
      }
    ],
    availableActions,
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
                id: "agent.continue",
                kind: "agentTurn",
                label: "Continue",
                target: "agent.nextTurn",
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

function applyAgentEffects(state: RuntimeState, effects: readonly CubicaAgentStateEffect[]): RuntimeState {
  const nextState = structuredClone(state);
  const publicState = ensureMutableRecord(nextState, "public");

  for (const effect of effects) {
    switch (effect.kind) {
      case "appendLog":
        applyAppendLogEffect(publicState, effect);
        break;
      case "setMetric":
        applySetMetricEffect(publicState, effect);
        break;
      case "setFlag":
        applySetFlagEffect(publicState, effect);
        break;
      case "replaceStep":
        applyReplaceStepEffect(publicState, effect);
        break;
      case "grantCapability":
      case "custom":
        throw new HttpError(502, `Agent effect kind "${effect.kind}" is not supported by runtime-api yet.`);
      default:
        assertNever(effect.kind);
    }
  }

  return nextState;
}

function applyAppendLogEffect(publicState: Record<string, unknown>, effect: CubicaAgentStateEffect): void {
  if (effect.target !== "public.log") {
    throw new HttpError(502, `appendLog effect target must be "public.log", received "${effect.target}".`);
  }
  const log = Array.isArray(publicState.log) ? publicState.log : [];
  publicState.log = log;
  log.push(effect.data ?? {});
}

function applySetMetricEffect(publicState: Record<string, unknown>, effect: CubicaAgentStateEffect): void {
  const metricId = parseLeafTarget(effect.target, "public.metrics");
  if (typeof effect.value !== "number") {
    throw new HttpError(502, `setMetric effect for "${metricId}" must provide a numeric value.`);
  }
  const metrics = ensureMutableRecord(publicState, "metrics");
  metrics[metricId] = effect.value;
}

function applySetFlagEffect(publicState: Record<string, unknown>, effect: CubicaAgentStateEffect): void {
  const flagPath = parseNestedTarget(effect.target, "public.flags");
  if (typeof effect.value !== "boolean") {
    throw new HttpError(502, `setFlag effect for "${flagPath.join(".")}" must provide a boolean value.`);
  }
  const flags = ensureMutableRecord(publicState, "flags");
  setNestedValue(flags, flagPath, effect.value);
}

function applyReplaceStepEffect(publicState: Record<string, unknown>, effect: CubicaAgentStateEffect): void {
  if (effect.target !== "public.timeline") {
    throw new HttpError(502, `replaceStep effect target must be "public.timeline", received "${effect.target}".`);
  }
  if (!isUnknownRecord(effect.value)) {
    throw new HttpError(502, "replaceStep effect must provide an object value.");
  }
  const timeline = isUnknownRecord(publicState.timeline) ? publicState.timeline : {};
  publicState.timeline = {
    ...timeline,
    ...effect.value
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

function ensureMutableRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  if (isUnknownRecord(value)) {
    return value;
  }
  const nextValue: Record<string, unknown> = {};
  parent[key] = nextValue;
  return nextValue;
}

function parseLeafTarget(target: string, prefix: string): string {
  const parts = parseNestedTarget(target, prefix);
  if (parts.length !== 1) {
    throw new HttpError(502, `Effect target "${target}" must name a single ${prefix} entry.`);
  }
  return parts[0];
}

function parseNestedTarget(target: string, prefix: string): string[] {
  const fullPrefix = `${prefix}.`;
  if (!target.startsWith(fullPrefix)) {
    throw new HttpError(502, `Effect target "${target}" must start with "${fullPrefix}".`);
  }
  const parts = target.slice(fullPrefix.length).split(".");
  if (parts.some((part) => !/^[a-zA-Z0-9_-]+$/u.test(part))) {
    throw new HttpError(502, `Effect target "${target}" contains an unsafe path segment.`);
  }
  return parts;
}

function setNestedValue(target: Record<string, unknown>, pathParts: readonly string[], value: unknown): void {
  const [head, ...tail] = pathParts;
  if (head === undefined) {
    throw new HttpError(502, "Effect target path must not be empty.");
  }
  if (tail.length === 0) {
    target[head] = value;
    return;
  }
  setNestedValue(ensureMutableRecord(target, head), tail, value);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createNextVersion(current: SessionRecord<RuntimeState>): SessionRecord<RuntimeState>["version"] {
  return {
    sessionId: current.sessionId,
    stateVersion: current.version.stateVersion + 1,
    lastEventSequence: current.version.lastEventSequence + 1
  };
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDiagnostics(diagnostics: readonly { readonly pointer: string; readonly message: string }[]): string {
  return diagnostics.map((diagnostic) => `${diagnostic.pointer} ${diagnostic.message}`).join("; ");
}

function assertNever(value: never): never {
  throw new HttpError(500, `Unsupported Agent effect kind: ${String(value)}`);
}
