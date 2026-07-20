/**
 * Read-only presentation helpers for the facilitator heads-up display.
 *
 * A heads-up display (HUD) is a small viewport-fixed layer above the map. The
 * helpers below consume only the already public board projection and immutable
 * game content. They never decide ownership, calculate game rules, or dispatch
 * an action.
 */

import type { BoardProjection } from "./board-state.ts";

export interface FacilitatorTeamSummary {
  readonly id: string;
  readonly label: string;
  readonly coins: number | null;
  readonly locomotives: number;
  readonly wagons: number;
}

export interface FinalReflectionGuide {
  readonly workflowStatus: "pending-author-answers";
  readonly preparationMinutes: Readonly<{ min: number; max: number }>;
  readonly presentationMinutesMax: number;
  readonly conclusionCount: Readonly<{ min: number; max: number }>;
  readonly questions: readonly string[];
}

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const boundedText = (value: unknown, maximumLength: number): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximumLength
    ? normalized
    : null;
};

/**
 * The facilitator summary exists only at safe discussion boundaries.
 *
 * This is a visibility rule for the game-owned renderer, not a legality rule:
 * Runtime remains the sole authority for actions available in either phase.
 */
export function isFacilitatorHudPhase(phase: string): boolean {
  return phase === "reporting" || phase === "methodology-pause";
}

/**
 * Count only vehicles whose current public owner is an existing team.
 *
 * Equipment returned to the market has `ownerTeamId = null` and is therefore
 * deliberately absent. Unknown owner ids are also ignored rather than being
 * silently assigned to a team by the browser.
 */
export function buildFacilitatorTeamSummaries(
  projection: Pick<BoardProjection, "teams" | "vehicles">
): readonly FacilitatorTeamSummary[] {
  const counts = new Map<string, { locomotives: number; wagons: number }>(
    projection.teams.map((team) => [
      team.id,
      { locomotives: 0, wagons: 0 }
    ])
  );

  for (const vehicle of projection.vehicles) {
    if (!vehicle.ownerTeamId) continue;
    const teamCounts = counts.get(vehicle.ownerTeamId);
    if (!teamCounts) continue;
    if (vehicle.kind === "locomotive") teamCounts.locomotives += 1;
    if (vehicle.kind === "wagon") teamCounts.wagons += 1;
  }

  return Object.freeze(projection.teams.map((team) => {
    const teamCounts = counts.get(team.id) ?? { locomotives: 0, wagons: 0 };
    return Object.freeze({
      id: team.id,
      label: team.label,
      coins: team.coins,
      locomotives: teamCounts.locomotives,
      wagons: teamCounts.wagons
    });
  }));
}

/**
 * Defensively read the confirmed final-reflection material from immutable
 * `facilitatedSession` content. The manifest schema remains the publication
 * source of truth; this bounded parser protects a browser using stale content.
 */
export function readFinalReflectionGuide(
  facilitatedSessionContent: unknown
): FinalReflectionGuide | null {
  if (!isRecord(facilitatedSessionContent)) return null;
  const raw = facilitatedSessionContent.finalReflectionGuide;
  if (!isRecord(raw) || raw.workflowStatus !== "pending-author-answers") {
    return null;
  }

  const preparation = raw.preparationMinutes;
  const conclusions = raw.conclusionCount;
  const presentationMinutesMax = raw.presentationMinutesMax;
  if (
    !isRecord(preparation)
    || preparation.min !== 5
    || preparation.max !== 15
    || presentationMinutesMax !== 2
    || !isRecord(conclusions)
    || conclusions.min !== 2
    || conclusions.max !== 3
    || !Array.isArray(raw.questions)
    || raw.questions.length !== 5
  ) {
    return null;
  }

  const questions = raw.questions.map((question) => boundedText(question, 240));
  if (questions.some((question) => question === null)) return null;

  return Object.freeze({
    workflowStatus: "pending-author-answers",
    preparationMinutes: Object.freeze({ min: 5, max: 15 }),
    presentationMinutesMax: 2,
    conclusionCount: Object.freeze({ min: 2, max: 3 }),
    questions: Object.freeze(questions as string[])
  });
}

/** Format compact utility copy without turning an absent balance into zero. */
export function facilitatorTeamSummaryLabel(
  summary: FacilitatorTeamSummary
): string {
  const coins = summary.coins === null ? "—" : String(summary.coins);
  return `${summary.label} · ${coins} мон. · Л ${summary.locomotives} · В ${summary.wagons}`;
}
