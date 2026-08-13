/** Server-owned driver for immutable local agent participants. */
import {
  defaultCubicaSurfaceCatalog,
  defaultCubicaSurfaceChannelActionPolicies,
  validateAgentTurnInput,
  validateAgentTurnResult,
  type CubicaAgentTurnResult,
  type CubicaContractDiagnostic
} from "@cubica/contracts-ai";
import type { GameManifestAgentRuntimeConfig } from "@cubica/contracts-manifest";
import type {
  AgentControl,
  DispatchActionInput,
  SessionCommandReceipt,
  SessionEventRecord,
  SessionRecord,
  SessionStorePort
} from "@cubica/contracts-session";
import { loadImmutableGameBundle, loadImmutableGameBundleForReceipt } from "../content/manifestLoader.ts";
import { HttpError, RequestValidationError } from "../errors.ts";
import {
  executePublishedGameIntentCandidate,
  materializeSystemScheduleMutations
} from "../runtime/actionDispatcher.ts";
import { processPendingSystemSchedules } from "../runtime/systemScheduler.ts";
import { CommandAdmissionRejectedError } from "../runtime/commandAdmission.ts";
import {
  createActionDefinitionHash,
  createAgentSeatCommandId,
  createAppliedCommandReceipt,
  createDurableCommandResult,
  createExternalCommandFingerprint,
  createRejectedCommandReceipt,
  readAgentSeatControl,
  requireDurableCommandResult
} from "../session/commandIdentity.ts";
import { SessionStoreUnavailableError } from "../session/sessionStoreErrors.ts";
import {
  AgentTurnService,
  buildAgentSeatTurnInput,
  requireStoredAgentTurnResult
} from "./agentRuntime.ts";

type RuntimeState = Record<string, unknown>;
const AGENT_SEAT_TRIGGER_ACTION_ID = "system.agent-seat-turn";
// Must not exceed the existing per-principal Agent Turn admission window.
export const MAX_AGENT_SEAT_DRIVER_STEPS = 6;

interface DurableAgentSeatOutcome {
  agentTurn: CubicaAgentTurnResult;
  attempts: ReadonlyArray<CubicaContractDiagnostic>;
  control?: AgentControl;
}

interface SeatTransactionResult {
  kind: "progressed" | "blocked" | "not-active" | "stale";
  control?: AgentControl;
  committedState: boolean;
}

export interface AgentSeatDriveResult {
  snapshot: SessionRecord<RuntimeState>;
  agentControl?: AgentControl;
  steps: number;
}

export class AgentSeatDriver {
  private readonly agentTurnService: AgentTurnService;

  constructor(agentTurnService: AgentTurnService) {
    this.agentTurnService = agentTurnService;
  }

  async drive(input: {
    sessionStore: SessionStorePort<RuntimeState>;
    credentialSha256: string;
    sessionId: string;
  }): Promise<AgentSeatDriveResult> {
    let steps = 0;
    while (steps < MAX_AGENT_SEAT_DRIVER_STEPS) {
      const snapshot = await input.sessionStore.getSession(input.sessionId);
      if (snapshot === null) throw new SessionStoreUnavailableError();
      const active = activeAgentParticipant(snapshot);
      if (active === undefined) return { snapshot, steps };

      const outcome = await this.runOne({ ...input, snapshot, playerId: active.playerId });
      if (outcome.kind === "stale") continue;
      if (outcome.kind === "not-active") {
        const latest = await requireSnapshot(input.sessionStore, input.sessionId);
        return { snapshot: latest, steps };
      }
      if (outcome.kind === "blocked") {
        return {
          snapshot: await requireSnapshot(input.sessionStore, input.sessionId),
          agentControl: outcome.control,
          steps
        };
      }
      steps += 1;
      if (outcome.committedState) {
        try {
          await processPendingSystemSchedules(input.sessionStore, input.sessionId);
        } catch (error) {
          console.error(
            `[agent-seat] bounded scheduler pass failed for session ${input.sessionId}:`,
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    }

    const snapshot = await requireSnapshot(input.sessionStore, input.sessionId);
    const active = activeAgentParticipant(snapshot);
    if (active === undefined) return { snapshot, steps };
    const blocked = await this.persistStepLimit({ ...input, snapshot, playerId: active.playerId });
    return {
      snapshot: await requireSnapshot(input.sessionStore, input.sessionId),
      ...(blocked.control === undefined ? {} : { agentControl: blocked.control }),
      steps
    };
  }

  private async runOne(input: {
    sessionStore: SessionStorePort<RuntimeState>;
    credentialSha256: string;
    sessionId: string;
    snapshot: SessionRecord<RuntimeState>;
    playerId: string;
  }): Promise<SeatTransactionResult> {
    const command = seatCommand(input.snapshot, input.playerId);
    return input.sessionStore.withCommandTransaction<SeatTransactionResult>({
      sessionId: input.sessionId,
      credentialSha256: input.credentialSha256,
      commandId: command.commandId
    }, async ({ currentSession: current, principal, bundle: storedBundle, existingReceipt }) => {
      const bundle = existingReceipt === undefined
        ? loadImmutableGameBundle(storedBundle)
        : loadImmutableGameBundleForReceipt(storedBundle);
      const definitionHash = existingReceipt?.definitionHash ?? seatDefinitionHash(bundle.manifest);
      const fingerprint = createExternalCommandFingerprint({
        command,
        bundleHash: current.bundleHash,
        definitionHash
      });
      if (existingReceipt !== undefined) {
        if (existingReceipt.fingerprint !== fingerprint) throw new SessionStoreUnavailableError();
        const durable = readDurableSeatOutcome(existingReceipt);
        return { result: {
          kind: durable.control === undefined ? "progressed" : "blocked",
          ...(durable.control === undefined ? {} : { control: durable.control }),
          committedState: false
        } };
      }
      if (current.version.stateVersion !== input.snapshot.version.stateVersion) {
        return { result: { kind: "stale", committedState: false } };
      }
      const participant = activeAgentParticipant(current);
      if (participant?.playerId !== input.playerId) {
        return { result: { kind: "not-active", committedState: false } };
      }
      const agentRuntime = requireSeatRuntime(bundle.manifest.agentRuntime, current.gameId);
      const agentSeats = bundle.manifest.config.players.agentSeats;
      if (agentSeats === undefined) throw new SessionStoreUnavailableError();
      const turnInput = buildAgentSeatTurnInput({
        current,
        manifest: bundle.manifest,
        bundle,
        agentRuntime,
        actorId: participant.playerId
      });
      const inputValidation = validateAgentTurnInput(turnInput);
      if (!inputValidation.ok) {
        throw new HttpError(
          500,
          `Runtime built invalid agent-seat input: ${inputValidation.diagnostics
            .map((item) => `${item.code}@${item.pointer}`)
            .join(", ")}`
        );
      }

      if (!this.agentTurnService.isSeatRuntimeConfigured(agentRuntime)) {
        return blockedReceipt({
          command, current, principal, definitionHash, fingerprint,
          playerId: participant.playerId,
          agentRuntime,
          reasonCode: "runtimeUnavailable",
          attempts: []
        });
      }

      const attempts: CubicaContractDiagnostic[] = [];
      try {
        await this.agentTurnService.getAdmissionController().assertNewCommandAdmitted({
          sessionId: current.sessionId,
          principalId: principal.principalId,
          commandId: command.commandId,
          kind: "agent-turn",
          costUnits: agentSeats.invalidAttemptLimit
        });
      } catch (error) {
        if (!(error instanceof CommandAdmissionRejectedError)) throw error;
        attempts.push(attemptDiagnostic(0, error.code ?? "agentAdmissionRejected", error));
        return blockedReceipt({
          command, current, principal, definitionHash, fingerprint,
          playerId: participant.playerId,
          agentRuntime,
          reasonCode: "stepLimit",
          attempts
        });
      }
      let lastResult: CubicaAgentTurnResult | undefined;
      let providerUnavailable = false;
      for (let attempt = 0; attempt < agentSeats.invalidAttemptLimit; attempt += 1) {
        let result: CubicaAgentTurnResult;
        try {
          // The local S9 mock is deliberately called under the session lock.
          // A real provider requires a separately measured two-phase stale-version design.
          result = await this.agentTurnService.selectSeatIntent(turnInput, agentRuntime);
        } catch (error) {
          attempts.push(attemptDiagnostic(attempt, "runtimeUnavailable", error));
          providerUnavailable = true;
          if (agentRuntime.failurePolicy !== "retry") break;
          continue;
        }
        lastResult = result;
        const validation = validateAgentTurnResult(result, {
          catalog: defaultCubicaSurfaceCatalog,
          targetChannel: "web",
          channelActionPolicy: defaultCubicaSurfaceChannelActionPolicies.webPlayerPrimaryGameplay,
          availableIntents: turnInput.availableIntents
        });
        if (!validation.ok || result.ok !== true || result.selectedIntent === undefined) {
          attempts.push(...compactDiagnostics(attempt, validation.diagnostics, result.error?.code));
          continue;
        }
        const executed = await tryCandidate({
          bundle,
          current,
          playerId: participant.playerId,
          actionId: result.selectedIntent.actionId,
          params: result.selectedIntent.params
        });
        if (executed === undefined) {
          attempts.push(attemptDiagnostic(attempt, "selectedIntentRejected"));
          continue;
        }
        return appliedReceipt({
          command, current, principal, definitionHash, fingerprint,
          playerId: participant.playerId,
          executed,
          agentTurn: withDiagnostics(result, attempts),
          attempts,
          bundle
        });
      }

      if (providerUnavailable) {
        return blockedReceipt({
          command, current, principal, definitionHash, fingerprint,
          playerId: participant.playerId,
          agentRuntime,
          reasonCode: "runtimeUnavailable",
          attempts,
          agentTurn: lastResult
        });
      }

      for (const candidate of agentSeats.deterministicFallbackCandidates) {
        const executed = await tryCandidate({
          bundle,
          current,
          playerId: participant.playerId,
          actionId: candidate.actionId,
          params: candidate.params
        });
        if (executed === undefined) continue;
        const fallbackTurn = syntheticTurn(
          turnInput.turnId,
          agentRuntime.agentId,
          true,
          attempts,
          candidate
        );
        return appliedReceipt({
          command, current, principal, definitionHash, fingerprint,
          playerId: participant.playerId,
          executed,
          agentTurn: fallbackTurn,
          attempts,
          bundle
        });
      }

      return blockedReceipt({
        command, current, principal, definitionHash, fingerprint,
        playerId: participant.playerId,
        agentRuntime,
        reasonCode: "fallbackUnavailable",
        attempts,
        agentTurn: lastResult
      });
    });
  }

  private async persistStepLimit(input: {
    sessionStore: SessionStorePort<RuntimeState>;
    credentialSha256: string;
    sessionId: string;
    snapshot: SessionRecord<RuntimeState>;
    playerId: string;
  }): Promise<SeatTransactionResult> {
    const command = seatCommand(input.snapshot, input.playerId);
    return input.sessionStore.withCommandTransaction<SeatTransactionResult>({
      sessionId: input.sessionId,
      credentialSha256: input.credentialSha256,
      commandId: command.commandId
    }, async ({ currentSession: current, principal, bundle: storedBundle, existingReceipt }) => {
      const bundle = existingReceipt === undefined
        ? loadImmutableGameBundle(storedBundle)
        : loadImmutableGameBundleForReceipt(storedBundle);
      const definitionHash = existingReceipt?.definitionHash ?? seatDefinitionHash(bundle.manifest);
      const fingerprint = createExternalCommandFingerprint({ command, bundleHash: current.bundleHash, definitionHash });
      if (existingReceipt !== undefined) {
        const durable = readDurableSeatOutcome(existingReceipt);
        return { result: {
          kind: durable.control === undefined ? "progressed" : "blocked",
          ...(durable.control === undefined ? {} : { control: durable.control }),
          committedState: false
        } };
      }
      if (
        current.version.stateVersion !== input.snapshot.version.stateVersion ||
        activeAgentParticipant(current)?.playerId !== input.playerId
      ) return { result: { kind: "stale", committedState: false } };
      const agentRuntime = requireSeatRuntime(bundle.manifest.agentRuntime, current.gameId);
      return blockedReceipt({
        command, current, principal, definitionHash, fingerprint,
        playerId: input.playerId,
        agentRuntime,
        reasonCode: "stepLimit",
        attempts: []
      });
    });
  }
}

export async function projectAgentControl(input: {
  sessionStore: SessionStorePort<RuntimeState>;
  credentialSha256: string;
  snapshot: SessionRecord<RuntimeState>;
}): Promise<AgentControl | undefined> {
  const participant = activeAgentParticipant(input.snapshot);
  if (participant === undefined) return undefined;
  const receipt = await input.sessionStore.getCommandReceipt({
    sessionId: input.snapshot.sessionId,
    credentialSha256: input.credentialSha256,
    commandId: createAgentSeatCommandId(
      input.snapshot.sessionId,
      participant.playerId,
      input.snapshot.version.stateVersion
    )
  });
  if (receipt === null || receipt.stateVersionBefore !== input.snapshot.version.stateVersion) return undefined;
  return readDurableSeatOutcome(receipt).control;
}

function seatCommand(snapshot: SessionRecord<RuntimeState>, playerId: string): DispatchActionInput {
  return {
    sessionId: snapshot.sessionId,
    expectedStateVersion: snapshot.version.stateVersion,
    actionId: AGENT_SEAT_TRIGGER_ACTION_ID,
    commandId: createAgentSeatCommandId(snapshot.sessionId, playerId, snapshot.version.stateVersion),
    params: {}
  };
}

function activeAgentParticipant(snapshot: SessionRecord<RuntimeState>) {
  const activePlayerId = readActivePlayerId(snapshot.state);
  if (activePlayerId === undefined) return undefined;
  return snapshot.participants.find(
    (participant) => participant.playerId === activePlayerId && participant.kind === "agent"
  );
}

function readActivePlayerId(state: unknown): string | undefined {
  if (!record(state) || !record(state.public) || !record(state.public.turn)) return undefined;
  return typeof state.public.turn.activePlayerId === "string" ? state.public.turn.activePlayerId : undefined;
}

function requireSeatRuntime(
  value: GameManifestAgentRuntimeConfig | undefined,
  gameId: string
): GameManifestAgentRuntimeConfig {
  if (value === undefined || !value.allowedCapabilities.includes("selectPublishedIntent")) {
    throw new HttpError(409, `Game "${gameId}" does not declare an agent-seat selection runtime.`);
  }
  return value;
}

async function tryCandidate(input: {
  bundle: ReturnType<typeof loadImmutableGameBundle>;
  current: SessionRecord<RuntimeState>;
  playerId: string;
  actionId: string;
  params: Record<string, unknown>;
}) {
  try {
    const executed = await executePublishedGameIntentCandidate({
      bundle: input.bundle,
      state: input.current.state,
      sessionId: input.current.sessionId,
      actionId: input.actionId,
      params: input.params,
      actorPlayerId: input.playerId,
      sessionRole: "player",
      now: new Date()
    });
    return executed.result.ok && executed.candidateState !== undefined ? executed : undefined;
  } catch (error) {
    if (error instanceof RequestValidationError) return undefined;
    throw error;
  }
}

function appliedReceipt(input: {
  command: DispatchActionInput;
  current: SessionRecord<RuntimeState>;
  principal: Parameters<typeof createAppliedCommandReceipt>[0]["principal"];
  definitionHash: string;
  fingerprint: string;
  playerId: string;
  executed: NonNullable<Awaited<ReturnType<typeof tryCandidate>>>;
  agentTurn: CubicaAgentTurnResult;
  attempts: ReadonlyArray<CubicaContractDiagnostic>;
  bundle: ReturnType<typeof loadImmutableGameBundle>;
}) {
  const eventRefs = input.executed.events.map((_, index) =>
    `${input.current.sessionId}:${input.current.version.lastEventSequence + index + 1}`
  );
  const next: SessionRecord<RuntimeState> = {
    ...input.current,
    state: input.executed.candidateState!,
    version: {
      sessionId: input.current.sessionId,
      stateVersion: input.current.version.stateVersion + 1,
      lastEventSequence: input.current.version.lastEventSequence + input.executed.events.length
    },
    updatedAt: new Date()
  };
  const receipt = createAppliedCommandReceipt({
    command: input.command,
    principal: input.principal,
    actorId: input.playerId,
    before: input.current,
    after: next,
    fingerprint: input.fingerprint,
    definitionHash: input.definitionHash,
    planHash: input.executed.planHash,
    eventRefs,
    commandKind: "agent-turn",
    selectedActionId: input.agentTurn.selectedIntent?.actionId,
    durableResult: createDurableCommandResult("agent-turn", {
      agentTurn: input.agentTurn,
      attempts: input.attempts
    }),
    ...(input.executed.result.mechanicsAudit === undefined
      ? {}
      : { mechanicsAudit: input.executed.result.mechanicsAudit })
  });
  const events: SessionEventRecord[] = input.executed.events.map((event, index) => ({
    eventId: eventRefs[index]!,
    sessionId: input.current.sessionId,
    sequence: input.current.version.lastEventSequence + index + 1,
    receiptId: receipt.receiptId,
    commandId: input.command.commandId,
    actionId: input.agentTurn.selectedIntent!.actionId,
    principalId: input.principal.principalId,
    actorId: input.playerId,
    audience: event.audience,
    eventType: event.eventType,
    summary: structuredClone(event.summary),
    data: structuredClone(event.data),
    ...(event.metricChanges === undefined ? {} : { metricChanges: structuredClone(event.metricChanges) }),
    createdAt: next.updatedAt
  }));
  const scheduleMutations = materializeSystemScheduleMutations({
    mutations: input.executed.result.systemScheduleMutations ?? [],
    bundle: input.bundle,
    sessionId: input.current.sessionId,
    bundleHash: input.current.bundleHash,
    now: next.updatedAt
  });
  return {
    updatedSession: next,
    receipt,
    events,
    ...(scheduleMutations.length === 0 ? {} : { scheduleMutations }),
    result: { kind: "progressed" as const, committedState: true }
  };
}

function blockedReceipt(input: {
  command: DispatchActionInput;
  current: SessionRecord<RuntimeState>;
  principal: Parameters<typeof createRejectedCommandReceipt>[0]["principal"];
  definitionHash: string;
  fingerprint: string;
  playerId: string;
  agentRuntime: GameManifestAgentRuntimeConfig;
  reasonCode: AgentControl["reasonCode"];
  attempts: ReadonlyArray<CubicaContractDiagnostic>;
  agentTurn?: CubicaAgentTurnResult;
}) {
  const control: AgentControl = {
    playerId: input.playerId,
    status: input.agentRuntime.failurePolicy === "facilitatorTakeover"
      ? "facilitatorTakeover"
      : "paused",
    reasonCode: input.reasonCode
  };
  const agentTurn = input.agentTurn ?? syntheticTurn(
    `seat-${input.current.version.stateVersion}`,
    input.agentRuntime.agentId,
    false,
    input.attempts
  );
  const receipt = createRejectedCommandReceipt({
    command: input.command,
    principal: input.principal,
    actorId: input.playerId,
    current: input.current,
    fingerprint: input.fingerprint,
    definitionHash: input.definitionHash,
    planHash: seatPlanHash(input.current, input.playerId),
    rejectionCode: `AGENT_SEAT_${input.reasonCode}`,
    commandKind: "agent-turn",
    durableResult: createDurableCommandResult("agent-turn", {
      agentTurn: withDiagnostics(agentTurn, input.attempts),
      attempts: input.attempts,
      control
    })
  });
  return {
    receipt,
    result: { kind: "blocked" as const, control, committedState: false }
  };
}

function readDurableSeatOutcome(receipt: SessionCommandReceipt): DurableAgentSeatOutcome {
  try {
    const value = requireDurableCommandResult(receipt.result, "agent-turn").value;
    if (!record(value) || !Array.isArray(value.attempts)) throw new Error();
    const control = readAgentSeatControl(receipt);
    return {
      agentTurn: requireStoredAgentTurnResult(value.agentTurn),
      attempts: structuredClone(value.attempts) as CubicaContractDiagnostic[],
      ...(control === undefined ? {} : { control })
    };
  } catch {
    throw new SessionStoreUnavailableError();
  }
}

function syntheticTurn(
  turnId: string,
  agentId: string,
  ok: boolean,
  diagnostics: ReadonlyArray<CubicaContractDiagnostic>,
  selectedIntent?: { actionId: string; params: Record<string, unknown> }
): CubicaAgentTurnResult {
  return {
    schemaVersion: "1.0.0",
    turnId,
    agentId,
    ok,
    ...(selectedIntent === undefined ? {} : { selectedIntent: selectedIntent as CubicaAgentTurnResult["selectedIntent"] }),
    ...(diagnostics.length === 0 ? {} : { diagnostics }),
    audit: { source: "local", createdAt: new Date().toISOString() },
    ...(ok ? {} : { error: { code: "agent_seat_blocked", message: "Agent seat could not commit a valid intent." } })
  };
}

function withDiagnostics(
  result: CubicaAgentTurnResult,
  diagnostics: ReadonlyArray<CubicaContractDiagnostic>
): CubicaAgentTurnResult {
  return diagnostics.length === 0 ? result : { ...result, diagnostics: [...diagnostics] };
}

function compactDiagnostics(
  attempt: number,
  diagnostics: ReadonlyArray<CubicaContractDiagnostic>,
  fallbackCode?: string
): CubicaContractDiagnostic[] {
  if (diagnostics.length === 0) return [attemptDiagnostic(attempt, fallbackCode ?? "invalidResult")];
  return diagnostics.slice(0, 4).map((diagnostic) => ({
    ...diagnostic,
    pointer: `/attempts/${attempt}${diagnostic.pointer}`,
    message: diagnostic.message.slice(0, 256)
  }));
}

function attemptDiagnostic(attempt: number, code: string, error?: unknown): CubicaContractDiagnostic {
  return {
    severity: "error",
    source: "semantic",
    code,
    pointer: `/attempts/${attempt}`,
    message: (error instanceof Error ? error.message : code).slice(0, 256)
  };
}

function seatDefinitionHash(manifest: ReturnType<typeof loadImmutableGameBundle>["manifest"]): string {
  return createActionDefinitionHash({
    profile: "cubica.agent-seat-turn/v1",
    agentRuntime: manifest.agentRuntime ?? null,
    agentSeats: manifest.config.players.agentSeats ?? null
  });
}

function seatPlanHash(current: SessionRecord<RuntimeState>, playerId: string): string {
  return createActionDefinitionHash({
    profile: "cubica.agent-seat-turn/v1",
    sessionId: current.sessionId,
    playerId,
    stateVersion: current.version.stateVersion
  });
}

async function requireSnapshot(store: SessionStorePort<RuntimeState>, sessionId: string) {
  const snapshot = await store.getSession(sessionId);
  if (snapshot === null) throw new SessionStoreUnavailableError();
  return snapshot;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
