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
  readonly kind:
    | "start"
    | "estate"
    | "transit"
    | "utility"
    | "event"
    | "fund"
    | "tax"
    | "neutral"
    | "jail"
    | "go-to-jail";
  readonly group: string | null;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly price: number | null;
  readonly rent: number | null;
  readonly rentScale: readonly number[];
  /** Server-owned S4 representation: 1..4 houses, 5 one hotel. */
  readonly improvementTier: number;
  readonly mortgaged: boolean;
  readonly tradeSide: string | null;
  readonly liquidationPending: boolean;
  readonly taxAmount: number | null;
  readonly ownerPlayerId: string | null;
}

export interface EstatePlayerView {
  readonly id: string;
  readonly label: string;
  readonly cash: number;
  readonly position: number;
  readonly active: boolean;
  /** Public server flag; the client only presents the authoritative status. */
  readonly inJail: boolean;
  readonly jailAttempts: number;
  /** Present only in the authenticated owner's actor projection. */
  readonly heldExitCardId: string | null;
  /** Actor-private second held-card slot; never copied from another actor. */
  readonly heldExitCardId2: string | null;
  /** Public participant projection; absent when the endpoint is not exposed. */
  readonly bidderStatus: string | null;
  readonly buildingRequestCellId: string | null;
  readonly buildingRequestUnitKind: string | null;
}

export interface EstateActionView {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly actionId: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly disabled?: boolean;
}

export interface EstateAuctionView {
  /** Public auction state is display-only; an empty id means no active value. */
  readonly resumePlayerId: string | null;
  readonly cellId: string | null;
  readonly currentBid: number;
  readonly minimumIncrement: number;
  /** Optional only when the server explicitly publishes this value. */
  readonly minimumNextBid: number | null;
  readonly leaderPlayerId: string | null;
}

export interface EstateBuildingBankView {
  readonly housesAvailable: number;
  readonly hotelsAvailable: number;
}

export interface EstateBuildingWindowView {
  readonly resumePlayerId: string | null;
  readonly unitKind: string | null;
}

export interface EstateTradeView {
  readonly status: string;
  readonly proposerPlayerId: string | null;
  readonly targetPlayerId: string | null;
  readonly resumePlayerId: string | null;
  readonly offeredCash: number;
  readonly requestedCash: number;
  readonly offeredCardId: string | null;
  readonly requestedCardId: string | null;
  readonly claimCardId: string | null;
  readonly claimPlayerId: string | null;
}

export interface EstateObligationView {
  readonly status: string;
  readonly debtorPlayerId: string | null;
  readonly creditorKind: string | null;
  readonly creditorPlayerId: string | null;
  readonly amount: number;
  readonly perPartyAmount: number;
  readonly reason: string | null;
  readonly resumePlayerId: string | null;
}

export interface EstateLiquidationView {
  readonly status: string;
  readonly resumePlayerId: string | null;
  readonly debtorPlayerId: string | null;
  readonly creditorPlayerId: string | null;
  readonly pendingCellId: string | null;
  readonly claimCardId: string | null;
  readonly claimCardId2: string | null;
}

export interface EstateOutcomeView {
  readonly status: "active" | "terminal";
  readonly winnerPlayerId: string | null;
  readonly reason: "none" | "last-active-player";
}

export interface EstateBoardProjection {
  readonly cells: readonly EstateCellView[];
  readonly players: readonly EstatePlayerView[];
  readonly availableActions: readonly EstateActionView[];
  readonly activePlayerId: string | null;
  readonly phase: string;
  readonly turnNumber: number;
  readonly lastRoll: Readonly<{ values: readonly number[]; total: number; isDouble: boolean }> | null;
  /** Public result of the latest resolved draw; never used to infer ownership. */
  readonly lastCardId: string | null;
  readonly auction: EstateAuctionView;
  readonly bankBuildings: EstateBuildingBankView;
  readonly buildingWindow: EstateBuildingWindowView;
  readonly buildingAuction: EstateAuctionView;
  readonly trade: EstateTradeView;
  readonly obligation: EstateObligationView;
  readonly liquidation: EstateLiquidationView;
  /** Server-owned terminal result; the player layer only presents it. */
  readonly outcome: EstateOutcomeView;
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

const optionalText = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const readOutcome = (
  publicState: JsonRecord,
  state: JsonRecord,
  phase: string
): EstateOutcomeView => {
  const outcome = isRecord(publicState.outcome) ? publicState.outcome : null;
  if (outcome?.status === "active") return { status: "active", winnerPlayerId: null, reason: "none" };
  const winnerPlayerId = optionalText(outcome?.winnerPlayerId);
  const rawPlayers = isRecord(state.players) ? state.players : {};
  const activePlayerIds = Object.entries(rawPlayers).flatMap(([playerId, rawPlayer]) =>
    isRecord(rawPlayer) && rawPlayer.status === "active" ? [playerId] : []
  );
  if (
    phase === "terminal"
    && outcome?.status === "terminal"
    && outcome.reason === "last-active-player"
    && winnerPlayerId !== null
    && activePlayerIds.length === 1
    && activePlayerIds[0] === winnerPlayerId
  ) {
    return {
      status: "terminal",
      winnerPlayerId,
      reason: outcome.reason
    };
  }
  // Malformed terminal data must not become a client-side result or winner.
  return { status: "active", winnerPlayerId: null, reason: "none" };
};

const improvementTier = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 5 ? value : 0;

const bankCount = (value: unknown, maximum: number): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : 0;

const readCells = (publicState: JsonRecord): EstateCellView[] => {
  const objects = isRecord(publicState.objects) ? publicState.objects : {};
  const cells = isRecord(objects.boardCells) ? objects.boardCells : {};
  return Object.entries(cells).flatMap(([id, raw]) => {
    if (!isRecord(raw)) return [];
    const attributes = isRecord(raw.attributes) ? raw.attributes : {};
    const supportedKinds = new Set<EstateCellView["kind"]>([
      "start", "estate", "transit", "utility", "event", "fund", "tax", "neutral", "jail", "go-to-jail"
    ]);
    const kind = typeof attributes.kind === "string" && supportedKinds.has(attributes.kind as EstateCellView["kind"])
      ? attributes.kind as EstateCellView["kind"]
      : "neutral";
    return [{
      id,
      index: finiteNumber(attributes.index),
      label: text(attributes.label, id),
      shortLabel: text(attributes.shortLabel, text(attributes.label, id)),
      kind,
      group: typeof attributes.group === "string" ? attributes.group : null,
      x: finiteNumber(attributes.x),
      y: finiteNumber(attributes.y),
      width: finiteNumber(attributes.width, 220),
      height: finiteNumber(attributes.height, 140),
      price: typeof attributes.price === "number" ? attributes.price : null,
      rent: typeof attributes.rent === "number" ? attributes.rent : null,
      rentScale: Array.isArray(attributes.rentScale)
        ? attributes.rentScale.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
        : [],
      improvementTier: improvementTier(attributes.improvementTier),
      mortgaged: attributes.mortgaged === true,
      tradeSide: optionalText(attributes.tradeSide),
      liquidationPending: attributes.liquidationPending === true,
      taxAmount: typeof attributes.taxAmount === "number" ? attributes.taxAmount : null,
      ownerPlayerId: typeof attributes.ownerPlayerId === "string" ? attributes.ownerPlayerId : null
    }];
  }).sort((left, right) => left.index - right.index);
};

const readPlayers = (
  state: JsonRecord,
  activePlayerId: string | null,
  actorPlayerId: string | null
): EstatePlayerView[] => {
  const players = isRecord(state.players) ? state.players : {};
  return Object.entries(players).flatMap(([id, raw], index) => {
    if (!isRecord(raw)) return [];
    const metrics = isRecord(raw.metrics) ? raw.metrics : {};
    const objects = isRecord(raw.objects) ? raw.objects : {};
    const flags = isRecord(raw.flags) ? raw.flags : {};
    const canReadPrivate = actorPlayerId === id;
    return [{
      id,
      label: `Игрок ${index + 1}`,
      cash: finiteNumber(metrics.cash),
      position: finiteNumber(metrics.position),
      active: id === activePlayerId,
      inJail: isRecord(raw.flags) && raw.flags.inJail === true,
      jailAttempts: finiteNumber(metrics.jailAttempts),
      heldExitCardId: canReadPrivate ? optionalText(objects.heldExitCardId) : null,
      heldExitCardId2: canReadPrivate ? optionalText(objects.heldExitCardId2) : null,
      bidderStatus: optionalText(objects.bidderStatus) ?? optionalText(flags.bidderStatus),
      buildingRequestCellId: optionalText(objects.buildingRequestCellId),
      buildingRequestUnitKind: optionalText(objects.buildingRequestUnitKind)
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

const readAuction = (publicState: JsonRecord): EstateAuctionView => {
  const auction = isRecord(publicState.auction) ? publicState.auction : {};
  return {
    resumePlayerId: optionalText(auction.resumePlayerId),
    cellId: optionalText(auction.cellId),
    currentBid: finiteNumber(auction.currentBid),
    minimumIncrement: finiteNumber(auction.minimumIncrement),
    // Do not derive a minimum from currentBid/minimumIncrement. The runtime
    // remains the only authority for a next-bid threshold.
    minimumNextBid: typeof auction.minimumNextBid === "number" && Number.isFinite(auction.minimumNextBid)
      ? auction.minimumNextBid
      : null,
    leaderPlayerId: optionalText(auction.leaderPlayerId)
  };
};

const readBuildingBank = (publicState: JsonRecord): EstateBuildingBankView => {
  const bank = isRecord(publicState.bankBuildings) ? publicState.bankBuildings : {};
  return {
    housesAvailable: bankCount(bank.housesAvailable, 32),
    hotelsAvailable: bankCount(bank.hotelsAvailable, 12)
  };
};

const readBuildingWindow = (publicState: JsonRecord): EstateBuildingWindowView => {
  const window = isRecord(publicState.buildingWindow) ? publicState.buildingWindow : {};
  return {
    resumePlayerId: optionalText(window.resumePlayerId),
    unitKind: optionalText(window.unitKind)
  };
};

const readTrade = (publicState: JsonRecord): EstateTradeView => {
  const trade = isRecord(publicState.trade) ? publicState.trade : {};
  return {
    status: text(trade.status, "idle"),
    proposerPlayerId: optionalText(trade.proposerPlayerId),
    targetPlayerId: optionalText(trade.targetPlayerId),
    resumePlayerId: optionalText(trade.resumePlayerId),
    offeredCash: finiteNumber(trade.offeredCash),
    requestedCash: finiteNumber(trade.requestedCash),
    offeredCardId: optionalText(trade.offeredCardId),
    requestedCardId: optionalText(trade.requestedCardId),
    claimCardId: optionalText(trade.claimCardId),
    claimPlayerId: optionalText(trade.claimPlayerId)
  };
};

const readObligation = (publicState: JsonRecord): EstateObligationView => {
  const obligation = isRecord(publicState.obligation) ? publicState.obligation : {};
  return {
    status: text(obligation.status, "idle"),
    debtorPlayerId: optionalText(obligation.debtorPlayerId),
    creditorKind: optionalText(obligation.creditorKind),
    creditorPlayerId: optionalText(obligation.creditorPlayerId),
    amount: finiteNumber(obligation.amount),
    perPartyAmount: finiteNumber(obligation.perPartyAmount),
    reason: optionalText(obligation.reason),
    resumePlayerId: optionalText(obligation.resumePlayerId)
  };
};

const readLiquidation = (publicState: JsonRecord): EstateLiquidationView => {
  const liquidation = isRecord(publicState.liquidation) ? publicState.liquidation : {};
  return {
    status: text(liquidation.status, "idle"),
    resumePlayerId: optionalText(liquidation.resumePlayerId),
    debtorPlayerId: optionalText(liquidation.debtorPlayerId),
    creditorPlayerId: optionalText(liquidation.creditorPlayerId),
    pendingCellId: optionalText(liquidation.pendingCellId),
    claimCardId: optionalText(liquidation.claimCardId),
    claimCardId2: optionalText(liquidation.claimCardId2)
  };
};

/**
 * Build the shortest display-only route between two confirmed positions.
 * Snapshots do not carry movement direction, so choosing the shorter arc
 * avoids presenting a backward card as a long forward lap without inferring
 * or changing any gameplay result.
 */
export function traceEstateTokenPath(
  cells: readonly EstateCellView[],
  fromPosition: number,
  toPosition: number
): EstateCellView[] {
  if (cells.length === 0 || fromPosition === toPosition) return [];
  const byIndex = new Map(cells.map((cell) => [cell.index, cell] as const));
  const forwardSteps = (toPosition - fromPosition + cells.length) % cells.length;
  const backwardSteps = (fromPosition - toPosition + cells.length) % cells.length;
  const direction = backwardSteps < forwardSteps ? -1 : 1;
  const stepCount = Math.min(forwardSteps, backwardSteps);
  return Array.from({ length: stepCount }, (_, step) => {
    const index = (fromPosition + direction * (step + 1) + cells.length) % cells.length;
    return byIndex.get(index);
  }).filter((cell): cell is EstateCellView => cell !== undefined);
}

/** Convert a player-facing session snapshot to deterministic drawing data. */
export function projectEstateRaceSession(
  session: { state?: unknown; actionAvailability?: unknown; actorPlayerId?: unknown }
): EstateBoardProjection {
  const state = isRecord(session.state) ? session.state : {};
  const publicState = isRecord(state.public) ? state.public : {};
  const board = isRecord(publicState.board) ? publicState.board : {};
  const turn = isRecord(publicState.turn) ? publicState.turn : {};
  const activePlayerId = typeof turn.activePlayerId === "string" ? turn.activePlayerId : null;
  const phase = text(turn.phase, "setup");
  const actorPlayerId = typeof session.actorPlayerId === "string"
    ? session.actorPlayerId
    : typeof state.actorPlayerId === "string" ? state.actorPlayerId : null;
  const players = readPlayers(state, activePlayerId, actorPlayerId);
  return {
    cells: readCells(publicState),
    players,
    // A terminal snapshot is actionless even if a stale board payload still
    // contains controls. The client never manufactures a terminal action.
    availableActions: phase === "terminal"
      ? []
      : readActions(board, readActionAvailability(session.actionAvailability)),
    activePlayerId,
    phase,
    turnNumber: finiteNumber(turn.turnNumber),
    lastRoll: readRoll(board),
    lastCardId: optionalText(board.lastCardId),
    auction: readAuction(publicState),
    bankBuildings: readBuildingBank(publicState),
    buildingWindow: readBuildingWindow(publicState),
    buildingAuction: (() => {
      const auction = isRecord(publicState.buildingAuction) ? publicState.buildingAuction : {};
      return {
        resumePlayerId: null,
        cellId: null,
        currentBid: finiteNumber(auction.currentBid),
        minimumIncrement: finiteNumber(auction.minimumIncrement),
        minimumNextBid: null,
        leaderPlayerId: optionalText(auction.leaderPlayerId)
      };
    })(),
    trade: readTrade(publicState),
    obligation: readObligation(publicState),
    liquidation: readLiquidation(publicState),
    outcome: readOutcome(publicState, state, phase)
  };
}
