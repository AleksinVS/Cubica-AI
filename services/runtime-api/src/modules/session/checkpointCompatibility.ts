import type { DebugCheckpointMetadata, DebugCheckpointSnapshot } from "@cubica/contracts-session";
import type { GameBundle } from "../content/manifestLoader.ts";
import { canonicalizeJson } from "../content/canonicalJson.ts";
import { HttpError } from "../errors.ts";
import { RUNTIME_BUDGETS, assertMechanicsStateWithinBudget } from "../mechanics/budget.ts";
import { assertStateMatchesModel } from "../mechanics/stateModel.ts";
import { getRegisteredActionDefinition } from "../runtime/actionRegistry.ts";
import { assertSessionParticipantsMatchState } from "./sessionParticipants.ts";
import { resolveParticipantCount } from "./turnBasedSessionState.ts";

export type Compatibility = Pick<DebugCheckpointMetadata, "compatibility" | "compatibilityReason">;
type Reason = NonNullable<Compatibility["compatibilityReason"]>;

export class CheckpointCompatibilityError extends HttpError {
  readonly reason: Reason;
  constructor(reason: Reason) {
    super(409, "Saved state is incompatible with the current preview game model.");
    this.reason = reason;
  }
}

/** No historical execution: admit exact saved values under today's declared model. */
export function assessCheckpointCompatibility(
  checkpoint: DebugCheckpointSnapshot<Record<string, unknown>>,
  oldBundle: GameBundle,
  currentBundle: GameBundle
): Compatibility {
  if (checkpoint.gameId !== currentBundle.gameId || checkpoint.bundleHash !== oldBundle.bundleHash) {
    return { compatibility: "incompatible", compatibilityReason: "rules-unavailable" };
  }
  const currentRole = currentBundle.manifest.config.sessionMode === "facilitated" ? "facilitator" : "player";
  if ((checkpoint.sessionRole ?? "player") !== currentRole) {
    return { compatibility: "incompatible", compatibilityReason: "runtime-policy" };
  }
  if (currentBundle.manifest.config.runtimeReady === false) {
    return { compatibility: "unavailable", compatibilityReason: "runtime-policy" };
  }
  if (!sameStoredBindings(oldBundle.manifest.mechanics.stateModel, currentBundle.manifest.mechanics.stateModel)) {
    return { compatibility: "incompatible", compatibilityReason: "storage-bindings" };
  }
  try {
    assertSessionParticipantsMatchState(checkpoint.participants, checkpoint.state, { allowAgents: true });
    resolveParticipantCount(currentBundle.manifest, checkpoint.participants.length);
    const agents = checkpoint.participants.filter((participant) => participant.kind === "agent").length;
    if (agents > 0 && (currentBundle.manifest.config.players.agentSeats === undefined ||
        agents > currentBundle.manifest.config.players.agentSeats.max ||
        currentBundle.manifest.agentRuntime === undefined)) {
      return { compatibility: "incompatible", compatibilityReason: "participants" };
    }
  } catch {
    return { compatibility: "incompatible", compatibilityReason: "participants" };
  }
  const limits = RUNTIME_BUDGETS[currentBundle.manifest.mechanics.budgetProfile];
  if (!limits) return { compatibility: "unavailable", compatibilityReason: "runtime-policy" };
  try {
    assertMechanicsStateWithinBudget(checkpoint.state, limits, "candidate");
    const actors = checkpoint.participants.length ? checkpoint.participants : [undefined];
    for (const participant of actors) {
      assertStateMatchesModel({
        stateModel: currentBundle.manifest.mechanics.stateModel,
        state: checkpoint.state,
        preActionState: checkpoint.state,
        params: {},
        actor: {
          ...(participant === undefined ? {} : { actorPlayerId: participant.playerId }),
          sessionRole: checkpoint.sessionRole ?? "player"
        },
        limits
      });
    }
  } catch {
    return { compatibility: "incompatible", compatibilityReason: "state-model" };
  }
  const phases = currentBundle.manifest.config.turnModel?.phases;
  const publicState = checkpoint.state.public;
  const turn = publicState && typeof publicState === "object" && !Array.isArray(publicState)
    ? (publicState as Record<string, unknown>).turn : undefined;
  const phase = turn && typeof turn === "object" && !Array.isArray(turn)
    ? (turn as Record<string, unknown>).phase : undefined;
  if (phases && phases.length && (typeof phase !== "string" || !phases.includes(phase))) {
    return { compatibility: "incompatible", compatibilityReason: "state-model" };
  }
  for (const schedule of checkpoint.schedules) {
    const definition = getRegisteredActionDefinition(currentBundle, schedule.actionId);
    const oldDefinition = getRegisteredActionDefinition(oldBundle, schedule.actionId);
    const currentPlan = definition && currentBundle.manifest.mechanics.plans[definition.binding.planRef];
    const oldPlan = oldDefinition && oldBundle.manifest.mechanics.plans[oldDefinition.binding.planRef];
    if (!definition || definition.invocation !== "system" ||
        !oldDefinition || oldDefinition.invocation !== "system" ||
        definition.definitionHash !== schedule.definitionHash ||
        !currentPlan || !oldPlan || currentPlan.planHash !== oldPlan.planHash ||
        schedule.bundleHash !== checkpoint.bundleHash ||
        schedule.sessionId !== checkpoint.sourceSessionId ||
        !Number.isSafeInteger(schedule.nextOccurrence) || schedule.nextOccurrence < 1 ||
        !Number.isSafeInteger(schedule.maxOccurrences) || schedule.maxOccurrences < 1 ||
        schedule.maxOccurrences > 64 || schedule.nextOccurrence > schedule.maxOccurrences + 1 ||
        !["pending", "cancelled", "completed"].includes(schedule.status) ||
        (schedule.status === "pending" && schedule.nextOccurrence > schedule.maxOccurrences)) {
      return { compatibility: "incompatible", compatibilityReason: "schedule" };
    }
  }
  return { compatibility: "compatible" };
}

export function requireCheckpointCompatibility(
  checkpoint: DebugCheckpointSnapshot<Record<string, unknown>>,
  oldBundle: GameBundle,
  currentBundle: GameBundle
): void {
  const assessment = assessCheckpointCompatibility(checkpoint, oldBundle, currentBundle);
  if (assessment.compatibility !== "compatible") {
    throw new CheckpointCompatibilityError(assessment.compatibilityReason ?? "state-model");
  }
}

function sameStoredBindings(oldModel: GameBundle["manifest"]["mechanics"]["stateModel"],
  currentModel: GameBundle["manifest"]["mechanics"]["stateModel"]): boolean {
  for (const [id, endpoint] of Object.entries(oldModel.endpoints)) {
    const next = currentModel.endpoints[id];
    if (!next || canonicalizeJson(endpoint.storage) !== canonicalizeJson(next.storage)) return false;
  }
  for (const [id, collection] of Object.entries(oldModel.collections)) {
    const next = currentModel.collections[id];
    if (!next || canonicalizeJson(collection.storage) !== canonicalizeJson(next.storage)) return false;
    const oldFields = "fields" in collection ? collection.fields : undefined;
    const nextFields = "fields" in next ? next.fields : undefined;
    if (!oldFields) continue;
    for (const [fieldId, field] of Object.entries(oldFields)) {
      if (!("storage" in field)) continue;
      const nextField = nextFields?.[fieldId];
      if (!nextField || !("storage" in nextField) ||
          canonicalizeJson(field.storage) !== canonicalizeJson(nextField.storage)) return false;
    }
  }
  return true;
}
