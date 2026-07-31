/**
 * Pure, game-local presentation helpers for the facilitator money corrector.
 *
 * The helper does not decide whether money may be changed and never applies a
 * balance locally. It exposes only placed teams and actions already published
 * as available by Runtime, while keeping typed draft parsing bounded.
 */

import type {
  BoardProjection,
  ProjectedBoardAction
} from "./board-state.ts";

export const ECONOMY_CREDIT_ACTION_ID =
  "facilitator.economy.adjust.credit";
export const ECONOMY_DEBIT_ACTION_ID =
  "facilitator.economy.adjust.debit";

export interface EconomyCorrectorRow {
  readonly teamId: string;
  readonly label: string;
  readonly coins: number | null;
  readonly outstandingDebt: number | null;
}

export interface EconomyCorrectorView {
  readonly rows: readonly EconomyCorrectorRow[];
  readonly creditAvailable: boolean;
  readonly debitAvailable: boolean;
}

export type EconomyDraftParseResult =
  | Readonly<{ kind: "cancel" }>
  | Readonly<{ kind: "clear" }>
  | Readonly<{ kind: "valid"; amount: number }>
  | Readonly<{ kind: "invalid"; message: string }>;

const MAX_TEAMS = 12;
const MAX_AMOUNT = 1_000_000;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_TEAM_LABEL_LENGTH = 96;

const boundedText = (value: unknown, maximumLength: number): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximumLength
    ? normalized
    : null;
};

const boundedSingleLineText = (
  value: unknown,
  maximumLength: number
): string | null => {
  if (typeof value !== "string") return null;
  return boundedText(value.replace(/\s+/gu, " "), maximumLength);
};

const actionIsAvailable = (
  actions: readonly ProjectedBoardAction[],
  actionId: string
): boolean => actions.some((action) =>
  action.actionId === actionId && action.disabled !== true
);

/**
 * Build table rows only when at least one authoritative adjustment action is
 * available. More than twelve placed teams invalidates the complete surface.
 */
export function projectEconomyCorrector(
  projection: Pick<BoardProjection, "teams" | "availableActions">
): EconomyCorrectorView | null {
  const creditAvailable = actionIsAvailable(
    projection.availableActions,
    ECONOMY_CREDIT_ACTION_ID
  );
  const debitAvailable = actionIsAvailable(
    projection.availableActions,
    ECONOMY_DEBIT_ACTION_ID
  );
  if (!creditAvailable && !debitAvailable) return null;

  const placedTeams = projection.teams.filter(
    (team) => team.placementStatus === "placed"
  );
  if (placedTeams.length === 0 || placedTeams.length > MAX_TEAMS) return null;

  const ids = new Set<string>();
  const rows: EconomyCorrectorRow[] = [];
  for (const team of placedTeams) {
    const teamId = boundedText(team.id, MAX_IDENTIFIER_LENGTH);
    const label = boundedSingleLineText(team.label, MAX_TEAM_LABEL_LENGTH);
    if (!teamId || !label || ids.has(teamId)) return null;
    ids.add(teamId);
    rows.push(Object.freeze({
      teamId,
      label,
      coins:
        typeof team.coins === "number" && Number.isSafeInteger(team.coins)
          ? team.coins
          : null,
      outstandingDebt:
        typeof team.outstandingDebt === "number"
        && Number.isSafeInteger(team.outstandingDebt)
          ? team.outstandingDebt
          : null
    }));
  }

  return Object.freeze({
    rows: Object.freeze(rows),
    creditAvailable,
    debitAvailable
  });
}

/**
 * Parse one native input prompt without accepting signs, fractions or
 * exponential notation. Empty input clears the local cell; Cancel changes
 * nothing.
 */
export function parseEconomyDraftInput(
  input: string | null
): EconomyDraftParseResult {
  if (input === null) return Object.freeze({ kind: "cancel" });
  const normalized = input.trim();
  if (normalized.length === 0) return Object.freeze({ kind: "clear" });
  if (!/^\d{1,7}$/u.test(normalized)) {
    return Object.freeze({
      kind: "invalid",
      message: "Введите целое число от 0 до 1 000 000."
    });
  }
  const amount = Number(normalized);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_AMOUNT) {
    return Object.freeze({
      kind: "invalid",
      message: "Сумма должна быть от 0 до 1 000 000."
    });
  }
  return Object.freeze({ kind: "valid", amount });
}

/** Keep long authored names on one compact table row. */
export function economyTeamLabel(label: string, maximumLength = 28): string {
  if (label.length <= maximumLength) return label;
  return `${label.slice(0, Math.max(1, maximumLength - 1))}…`;
}

/** Empty cells are visually distinct from an intentional zero adjustment. */
export function economyDraftLabel(amount: number | null): string {
  return amount === null ? "—" : String(amount);
}
