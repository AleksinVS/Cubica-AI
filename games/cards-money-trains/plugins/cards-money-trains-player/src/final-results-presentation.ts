/**
 * Fail-closed presentation of server-calculated final game results.
 *
 * Runtime is the only authority that calculates capital, places and winners.
 * This module merely validates a small public snapshot, joins standings with
 * public team names and keeps the explainable score components available for a
 * future educational breakdown. Any malformed, contradictory or oversized
 * result is rejected as a whole instead of being repaired in the browser.
 */

import type { TeamSummaryView } from "./board-state.ts";

export type FinalRankingId = "logistics-companies" | "locomotive-guilds";

export interface FinalRelatedItemView {
  readonly entityId: string;
  readonly value: number;
}

export interface FinalStandingView {
  readonly entityId: string;
  readonly label: string;
  readonly colorId?: string;
  /** Team balance minus its outstanding loan at the moment of completion. */
  readonly baseValue: number;
  /** Value of the team's active equipment at the fixed final prices. */
  readonly relatedValue: number;
  readonly score: number;
  /**
   * Preserved server explanation. It is intentionally not expanded in the
   * compact panel, but remains available for a later educational explanation.
   */
  readonly relatedItems: readonly FinalRelatedItemView[];
  readonly rank: number;
  readonly winner: boolean;
}

export interface FinalRankingView {
  readonly id: FinalRankingId;
  readonly title: string;
  readonly standings: readonly FinalStandingView[];
  readonly winners: readonly string[];
  readonly tiedForFirst: boolean;
}

export interface FinalResultsView {
  readonly status: "calculated";
  readonly completedTurn: number;
  readonly purchasePrice: Readonly<{
    wagon: number;
    locomotive: number;
  }>;
  readonly rankings: Readonly<{
    "logistics-companies": FinalRankingView;
    "locomotive-guilds": FinalRankingView;
  }>;
}

type JsonRecord = Record<string, unknown>;

type RankingDefinition = Readonly<{
  id: FinalRankingId;
  title: string;
  teamType: "logistics_company" | "locomotive_guild";
}>;

const RANKING_DEFINITIONS: readonly RankingDefinition[] = Object.freeze([
  Object.freeze({
    id: "logistics-companies",
    title: "Перевозчики",
    teamType: "logistics_company"
  }),
  Object.freeze({
    id: "locomotive-guilds",
    title: "Паровозные гильдии",
    teamType: "locomotive_guild"
  })
]);

// These limits mirror the game's supported 4–12 team session and 64-item
// equipment collections. They prevent a stale or hostile snapshot from asking
// Phaser to allocate unbounded text or explanation data.
const MAX_TEAMS = 12;
const MAX_RELATED_ITEMS_PER_TEAM = 64;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_TEAM_LABEL_LENGTH = 96;
const MAX_ABSOLUTE_SCORE_COMPONENT = 1_000_000_000;
const MAX_COMPLETED_TURN = 1_000_000;
const MAX_PURCHASE_PRICE = 1_000_000;

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const boundedText = (value: unknown, maximumLength: number): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximumLength
    ? normalized
    : null;
};

/** Team names are rendered as one ranking row and may not inject extra lines. */
const boundedSingleLineText = (
  value: unknown,
  maximumLength: number
): string | null => {
  if (typeof value !== "string") return null;
  return boundedText(value.replace(/\s+/gu, " "), maximumLength);
};

const boundedSafeInteger = (
  value: unknown,
  minimum: number,
  maximum: number
): number | null =>
  Number.isSafeInteger(value)
  && (value as number) >= minimum
  && (value as number) <= maximum
    ? value as number
    : null;

const readRelatedItems = (value: unknown): readonly FinalRelatedItemView[] | null => {
  if (
    !Array.isArray(value)
    || value.length > MAX_RELATED_ITEMS_PER_TEAM
  ) {
    return null;
  }

  const seen = new Set<string>();
  const items: FinalRelatedItemView[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) return null;
    const entityId = boundedText(raw.entityId, MAX_IDENTIFIER_LENGTH);
    const itemValue = boundedSafeInteger(
      raw.value,
      0,
      MAX_ABSOLUTE_SCORE_COMPONENT
    );
    if (!entityId || itemValue === null || seen.has(entityId)) return null;
    seen.add(entityId);
    items.push(Object.freeze({ entityId, value: itemValue }));
  }
  return Object.freeze(items);
};

const readRanking = (
  raw: unknown,
  definition: RankingDefinition,
  teamsById: ReadonlyMap<string, TeamSummaryView>
): FinalRankingView | null => {
  if (
    !isRecord(raw)
    || !Array.isArray(raw.standings)
    || raw.standings.length > MAX_TEAMS
    || !Array.isArray(raw.winners)
    || raw.winners.length > MAX_TEAMS
    || typeof raw.tiedForFirst !== "boolean"
  ) {
    return null;
  }

  const winnerIds: string[] = [];
  const uniqueWinners = new Set<string>();
  for (const rawWinner of raw.winners) {
    const winnerId = boundedText(rawWinner, MAX_IDENTIFIER_LENGTH);
    if (!winnerId || uniqueWinners.has(winnerId)) return null;
    uniqueWinners.add(winnerId);
    winnerIds.push(winnerId);
  }

  const standings: FinalStandingView[] = [];
  const uniqueTeams = new Set<string>();
  let previousRank = 0;
  let previousScore: number | null = null;
  for (const rawStanding of raw.standings) {
    if (!isRecord(rawStanding)) return null;
    const entityId = boundedText(
      rawStanding.entityId,
      MAX_IDENTIFIER_LENGTH
    );
    const team = entityId ? teamsById.get(entityId) : undefined;
    const label = boundedSingleLineText(team?.label, MAX_TEAM_LABEL_LENGTH);
    const baseValue = boundedSafeInteger(
      rawStanding.baseValue,
      -MAX_ABSOLUTE_SCORE_COMPONENT,
      MAX_ABSOLUTE_SCORE_COMPONENT
    );
    const relatedValue = boundedSafeInteger(
      rawStanding.relatedValue,
      0,
      MAX_ABSOLUTE_SCORE_COMPONENT
    );
    const score = boundedSafeInteger(
      rawStanding.score,
      -MAX_ABSOLUTE_SCORE_COMPONENT,
      MAX_ABSOLUTE_SCORE_COMPONENT
    );
    const rank = boundedSafeInteger(rawStanding.rank, 1, MAX_TEAMS);
    const relatedItems = readRelatedItems(rawStanding.relatedItems);
    if (
      !entityId
      || !team
      || !label
      || team.type !== definition.teamType
      || team.placementStatus !== "placed"
      || baseValue === null
      || relatedValue === null
      || score === null
      || rank === null
      || relatedItems === null
      || uniqueTeams.has(entityId)
      || score !== baseValue + relatedValue
      || rank < previousRank
      || (previousScore !== null && score > previousScore)
    ) {
      return null;
    }

    // Equal scores share a place; a lower score receives its one-based list
    // position. This is validation of Runtime output, never a client ranking.
    const expectedRank = previousScore === score
      ? previousRank
      : standings.length + 1;
    if (rank !== expectedRank) return null;

    uniqueTeams.add(entityId);
    previousRank = rank;
    previousScore = score;
    standings.push(Object.freeze({
      entityId,
      label,
      ...(team.colorId ? { colorId: team.colorId } : {}),
      baseValue,
      relatedValue,
      score,
      relatedItems,
      rank,
      winner: uniqueWinners.has(entityId)
    }));
  }

  if (
    winnerIds.some((winnerId) => !uniqueTeams.has(winnerId))
    || standings.some((standing) =>
      (standing.rank === 1) !== uniqueWinners.has(standing.entityId)
    )
    || raw.tiedForFirst !== (winnerIds.length > 1)
    || (standings.length === 0 && winnerIds.length !== 0)
  ) {
    return null;
  }

  return Object.freeze({
    id: definition.id,
    title: definition.title,
    standings: Object.freeze(standings),
    winners: Object.freeze(winnerIds),
    tiedForFirst: raw.tiedForFirst
  });
};

/**
 * Project final results only for the authoritative terminal phase.
 *
 * Requiring both `phase = finished` and `status = calculated` prevents stale
 * pre-finish state from displaying provisional standings.
 */
export function readFinalResults(
  rawFinalResults: unknown,
  teams: readonly TeamSummaryView[],
  phase: string
): FinalResultsView | null {
  if (
    phase !== "finished"
    || !isRecord(rawFinalResults)
    || rawFinalResults.status !== "calculated"
    || !isRecord(rawFinalResults.purchasePrice)
    || !isRecord(rawFinalResults.rankings)
    || Object.keys(rawFinalResults.rankings).length !== RANKING_DEFINITIONS.length
    || teams.length > MAX_TEAMS
  ) {
    return null;
  }

  // Keep the validated nested record in a local constant. TypeScript cannot
  // preserve narrowing of a mutable record property across the callback below,
  // while this stable reference accurately reflects the snapshot we validate.
  const rankings = rawFinalResults.rankings;
  const completedTurn = boundedSafeInteger(
    rawFinalResults.completedTurn,
    0,
    MAX_COMPLETED_TURN
  );
  const wagonPrice = boundedSafeInteger(
    rawFinalResults.purchasePrice.wagon,
    0,
    MAX_PURCHASE_PRICE
  );
  const locomotivePrice = boundedSafeInteger(
    rawFinalResults.purchasePrice.locomotive,
    0,
    MAX_PURCHASE_PRICE
  );
  if (
    completedTurn === null
    || wagonPrice === null
    || locomotivePrice === null
  ) {
    return null;
  }

  const teamsById = new Map<string, TeamSummaryView>();
  for (const team of teams) {
    const id = boundedText(team.id, MAX_IDENTIFIER_LENGTH);
    if (!id || teamsById.has(id)) return null;
    teamsById.set(id, team);
  }

  const projected = RANKING_DEFINITIONS.map((definition) =>
    readRanking(rankings[definition.id], definition, teamsById)
  );
  if (projected.some((ranking) => ranking === null)) return null;
  const [logistics, guilds] = projected as [FinalRankingView, FinalRankingView];
  if (logistics.standings.length + guilds.standings.length > MAX_TEAMS) {
    return null;
  }
  const expectedTeamIds = new Set(
    teams
      .filter((team) =>
        team.placementStatus === "placed"
        && (
          team.type === "logistics_company"
          || team.type === "locomotive_guild"
        )
      )
      .map((team) => team.id)
  );
  const publishedTeamIds = [
    ...logistics.standings,
    ...guilds.standings
  ].map((standing) => standing.entityId);
  if (
    new Set(publishedTeamIds).size !== publishedTeamIds.length
    || expectedTeamIds.size !== publishedTeamIds.length
    || publishedTeamIds.some((teamId) => !expectedTeamIds.has(teamId))
  ) {
    return null;
  }

  return Object.freeze({
    status: "calculated",
    completedTurn,
    purchasePrice: Object.freeze({
      wagon: wagonPrice,
      locomotive: locomotivePrice
    }),
    rankings: Object.freeze({
      "logistics-companies": logistics,
      "locomotive-guilds": guilds
    })
  });
}

/** Compact panel copy; the winner flag is supplied by Runtime and only styled here. */
export function finalStandingLabel(standing: FinalStandingView): string {
  const winner = standing.winner ? "★ " : "";
  return `${winner}${standing.rank}. ${standing.label} — ${standing.score}`;
}
