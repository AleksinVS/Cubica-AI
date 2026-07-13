/**
 * Safe public-snapshot projection for the Estate Race field.
 *
 * Projection means a read-only view prepared for drawing. The functions below
 * deliberately do not decide whether buying, paying or finishing is legal.
 * Runtime API publishes both board controls and canonical action availability;
 * the plugin only combines and displays those server-owned declarations.
 */

export interface EstateCellView {
  readonly id: string;
  readonly index: number;
  readonly label: string;
  readonly shortLabel: string;
  readonly kind: "start" | "estate" | "landmark";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly price: number | null;
  readonly rent: number | null;
  readonly ownerPlayerId: string | null;
}

export interface EstatePlayerView {
  readonly id: string;
  readonly label: string;
  readonly cash: number;
  readonly position: number;
  readonly active: boolean;
}

export interface EstateActionView {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly actionId: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly disabled?: boolean;
}

export interface EstateBoardProjection {
  readonly cells: readonly EstateCellView[];
  readonly players: readonly EstatePlayerView[];
  readonly availableActions: readonly EstateActionView[];
  readonly activePlayerId: string | null;
  readonly phase: string;
  readonly turnNumber: number;
  readonly lastRoll: Readonly<{ values: readonly number[]; total: number; isDouble: boolean }> | null;
}

type JsonRecord = Record<string, unknown>;

type SessionAvailabilityEntry = {
  readonly status?: unknown;
  readonly reasonCode?: unknown;
};

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const finiteNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const text = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim().length > 0 ? value : fallback;

const readCells = (publicState: JsonRecord): EstateCellView[] => {
  const objects = isRecord(publicState.objects) ? publicState.objects : {};
  const cells = isRecord(objects.boardCells) ? objects.boardCells : {};
  return Object.entries(cells).flatMap(([id, raw]) => {
    if (!isRecord(raw)) return [];
    const attributes = isRecord(raw.attributes) ? raw.attributes : {};
    const kind: EstateCellView["kind"] = attributes.kind === "start" || attributes.kind === "estate" || attributes.kind === "landmark"
      ? attributes.kind
      : "landmark";
    return [{
      id,
      index: finiteNumber(attributes.index),
      label: text(attributes.label, id),
      shortLabel: text(attributes.shortLabel, text(attributes.label, id)),
      kind,
      x: finiteNumber(attributes.x),
      y: finiteNumber(attributes.y),
      width: finiteNumber(attributes.width, 220),
      height: finiteNumber(attributes.height, 140),
      price: typeof attributes.price === "number" ? attributes.price : null,
      rent: typeof attributes.rent === "number" ? attributes.rent : null,
      ownerPlayerId: typeof attributes.ownerPlayerId === "string" ? attributes.ownerPlayerId : null
    }];
  }).sort((left, right) => left.index - right.index);
};

const readPlayers = (state: JsonRecord, activePlayerId: string | null): EstatePlayerView[] => {
  const players = isRecord(state.players) ? state.players : {};
  return Object.entries(players).flatMap(([id, raw], index) => {
    if (!isRecord(raw)) return [];
    const metrics = isRecord(raw.metrics) ? raw.metrics : {};
    return [{
      id,
      label: `Игрок ${index + 1}`,
      cash: finiteNumber(metrics.cash),
      position: finiteNumber(metrics.position),
      active: id === activePlayerId
    }];
  });
};

const serverUnavailableReason = (reasonCode: unknown): string => {
  if (reasonCode === "role_not_allowed") return "Действие недоступно для текущей роли.";
  if (reasonCode === "runtime_unsupported") return "Действие не поддерживается игровой системой.";
  return "Действие недоступно в текущем состоянии игры.";
};

const readActionAvailability = (value: unknown): Map<string, SessionAvailabilityEntry> => {
  const entries = Array.isArray(value) ? value : [];
  return new Map(entries.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.actionId !== "string") return [];
    return [[entry.actionId, entry] as const];
  }));
};

const readActions = (
  board: JsonRecord,
  availability: ReadonlyMap<string, SessionAvailabilityEntry>
): EstateActionView[] => {
  if (!Array.isArray(board.availableActions)) return [];
  return board.availableActions.flatMap((raw, index) => {
    if (!isRecord(raw) || typeof raw.actionId !== "string" || typeof raw.label !== "string") return [];
    const projectedAvailability = availability.get(raw.actionId);
    const serverDisabled = projectedAvailability?.status === "unavailable";
    const authoredDisabledReason = typeof raw.disabledReason === "string"
      ? raw.disabledReason
      : typeof raw.reason === "string" ? raw.reason : undefined;
    return [{
      id: text(raw.id, `action-${index}`),
      label: raw.label,
      description: serverDisabled
        ? authoredDisabledReason ?? serverUnavailableReason(projectedAvailability?.reasonCode)
        : typeof raw.description === "string" ? raw.description : undefined,
      actionId: raw.actionId,
      params: isRecord(raw.params) ? raw.params : undefined,
      disabled: raw.disabled === true || serverDisabled
    }];
  });
};

const readRoll = (board: JsonRecord): EstateBoardProjection["lastRoll"] => {
  if (!isRecord(board.lastRoll) || !Array.isArray(board.lastRoll.values)) return null;
  const values = board.lastRoll.values.filter((value): value is number =>
    typeof value === "number" && Number.isSafeInteger(value)
  );
  const total = finiteNumber(board.lastRoll.total, values.reduce((sum, value) => sum + value, 0));
  return { values, total, isDouble: board.lastRoll.isDouble === true };
};

/** Convert a player-facing session snapshot to deterministic drawing data. */
export function projectEstateRaceSession(
  session: { state?: unknown; actionAvailability?: unknown }
): EstateBoardProjection {
  const state = isRecord(session.state) ? session.state : {};
  const publicState = isRecord(state.public) ? state.public : {};
  const board = isRecord(publicState.board) ? publicState.board : {};
  const turn = isRecord(publicState.turn) ? publicState.turn : {};
  const activePlayerId = typeof turn.activePlayerId === "string" ? turn.activePlayerId : null;
  return {
    cells: readCells(publicState),
    players: readPlayers(state, activePlayerId),
    availableActions: readActions(board, readActionAvailability(session.actionAvailability)),
    activePlayerId,
    phase: text(turn.phase, "setup"),
    turnNumber: finiteNumber(turn.turnNumber),
    lastRoll: readRoll(board)
  };
}
