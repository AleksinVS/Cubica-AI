/**
 * Public-snapshot projection for the Cards Money Trains Phaser scene.
 *
 * This module deliberately contains no gameplay validation. Runtime provides
 * authoritative nodes, edges, highlights, and accessible actions; the plugin
 * only normalizes those public values into a safe rendering model.
 */

export type CanonicalPoint = Readonly<{ x: number; y: number }>;

export interface BoardNodeView {
  readonly id: string;
  readonly label: string;
  readonly objectType: string;
  readonly position: CanonicalPoint;
  readonly visualState: string;
}

export interface BoardEdgeView {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  /** Complete route plus straight-road compatibility endpoints. */
  readonly points: readonly CanonicalPoint[];
  readonly from: CanonicalPoint;
  readonly to: CanonicalPoint;
  readonly visualState: string;
}

export interface BoardVehicleView {
  readonly id: string;
  readonly kind: "locomotive" | "wagon";
  readonly nodeId: string | null;
  readonly ownerTeamId: string | null;
}

/** Public cargo facts needed to label facilitator choices without deciding legality. */
export interface BoardCargoOrderView {
  readonly id: string;
  readonly fromNodeId: string | null;
  readonly toNodeId: string | null;
  readonly status: string | null;
  readonly payout: number | null;
}

export interface TeamSummaryView {
  readonly id: string;
  readonly label: string;
  readonly type: string;
  readonly coins: number | null;
  readonly locomotives: number;
  readonly wagons: number;
}

/** One server-calculated locomotive slot shown to the facilitator. */
export interface LocomotiveOrderEntryView {
  readonly id: string;
  readonly ownerLabel: string;
  readonly nodeLabel: string;
}

export interface BoardLogEntryView {
  readonly id: string;
  readonly kind: string;
  readonly summary: string;
}

export interface BoardHighlightView {
  readonly id: string;
  readonly targetType: "node" | "edge";
  readonly targetId: string;
  readonly actionId: string | null;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface ProjectedBoardAction {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly actionId: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly section?: string;
  readonly phases?: readonly string[];
}

export interface BoardActionSectionView {
  readonly id: string;
  readonly actions: readonly ProjectedBoardAction[];
}

export interface BoardProjection {
  readonly nodes: readonly BoardNodeView[];
  readonly edges: readonly BoardEdgeView[];
  readonly vehicles: readonly BoardVehicleView[];
  readonly cargoOrders: readonly BoardCargoOrderView[];
  readonly cargoOfferIds: readonly string[];
  readonly teams: readonly TeamSummaryView[];
  readonly locomotiveOrder: readonly LocomotiveOrderEntryView[];
  readonly highlights: readonly BoardHighlightView[];
  readonly availableActions: readonly ProjectedBoardAction[];
  readonly actionSections: readonly BoardActionSectionView[];
  readonly log: readonly BoardLogEntryView[];
  readonly bounds: Readonly<{ minX: number; minY: number; maxX: number; maxY: number }> | null;
  readonly phase: string;
  readonly status: string;
  readonly constructionMode: string | null;
  readonly contentMode: string;
  readonly currentNewsSummary: string | null;
  readonly cargoOfferLabels: readonly string[];
  readonly turnNumber: number;
}

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const point = (value: unknown): CanonicalPoint | null => {
  if (!isRecord(value)) return null;
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  return x === null || y === null ? null : { x, y };
};

/** Reject a planned route as a whole when any coordinate is unsafe. */
const polyline = (value: unknown): readonly CanonicalPoint[] | null => {
  if (!Array.isArray(value) || value.length < 2) return null;
  const points = value.map(point);
  return points.every((item): item is CanonicalPoint => item !== null) ? points : null;
};

const objectCollection = (publicState: JsonRecord, collectionId: string): JsonRecord => {
  const objects = isRecord(publicState.objects) ? publicState.objects : {};
  return isRecord(objects[collectionId]) ? objects[collectionId] : {};
};

const readNodes = (publicState: JsonRecord): BoardNodeView[] =>
  Object.entries(objectCollection(publicState, "networkNodes")).flatMap(([id, raw]) => {
    if (!isRecord(raw)) return [];
    const attributes = isRecord(raw.attributes) ? raw.attributes : {};
    const position = point(attributes.position);
    if (!position) return [];
    const facets = isRecord(raw.facets) ? raw.facets : {};
    return [{
      id,
      label: text(attributes.label) ?? id,
      objectType: text(raw.objectType) ?? "transport.node",
      position,
      visualState: text(facets.availability) ?? "open"
    }];
  });

const readEdges = (publicState: JsonRecord, nodes: readonly BoardNodeView[]): BoardEdgeView[] => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return Object.entries(objectCollection(publicState, "networkEdges")).flatMap(([id, raw]) => {
    if (!isRecord(raw)) return [];
    const attributes = isRecord(raw.attributes) ? raw.attributes : {};
    const fromNodeId = text(attributes.fromNodeId);
    const toNodeId = text(attributes.toNodeId);
    if (!fromNodeId || !toNodeId) return [];
    const geometry = isRecord(attributes.geometry) ? attributes.geometry : {};
    const plannedPoints = polyline(geometry.polyline);
    const legacyFrom = point(geometry.from) ?? byId.get(fromNodeId)?.position ?? null;
    const legacyTo = point(geometry.to) ?? byId.get(toNodeId)?.position ?? null;
    const fallbackPoints: readonly CanonicalPoint[] | null =
      legacyFrom && legacyTo ? [legacyFrom, legacyTo] : null;
    const points = plannedPoints ?? fallbackPoints;
    if (!points) return [];
    const from = points[0];
    const to = points.at(-1);
    if (!from || !to) return [];
    const facets = isRecord(raw.facets) ? raw.facets : {};
    return [{
      id,
      fromNodeId,
      toNodeId,
      points,
      from,
      to,
      visualState: text(facets.state) ?? "open"
    }];
  });
};

const readVehicles = (publicState: JsonRecord): BoardVehicleView[] => {
  const read = (collectionId: string, kind: BoardVehicleView["kind"]) =>
    Object.entries(objectCollection(publicState, collectionId)).flatMap(([id, raw]) => {
      if (!isRecord(raw)) return [];
      const attributes = isRecord(raw.attributes) ? raw.attributes : {};
      const facets = isRecord(raw.facets) ? raw.facets : {};
      const availability = text(facets.availability);
      // The scene and its DOM alternative may offer only objects which the
      // public snapshot explicitly marks active. Missing or unfamiliar facet
      // values fail closed instead of becoming selectable by browser guesswork.
      if (availability !== "active") return [];
      return [{
        id,
        kind,
        nodeId: text(attributes.nodeId),
        ownerTeamId: text(attributes.ownerTeamId)
      }];
    });
  return [...read("locomotives", "locomotive"), ...read("wagons", "wagon")];
};

/**
 * Project every public cargo order without filtering by gameplay status.
 *
 * Availability, route and delivery checks belong to the authoritative
 * Mechanics plan. The browser needs only public facts for understandable
 * labels and therefore never inspects a secret deck or guesses legality.
 */
const readCargoOrders = (publicState: JsonRecord): BoardCargoOrderView[] =>
  Object.entries(objectCollection(publicState, "cargoOrders")).flatMap(([id, raw]) => {
    if (!isRecord(raw)) return [];
    const attributes = isRecord(raw.attributes) ? raw.attributes : {};
    const facets = isRecord(raw.facets) ? raw.facets : {};
    return [{
      id,
      fromNodeId: text(attributes.fromNodeId),
      toNodeId: text(attributes.toNodeId),
      status: text(facets.status),
      payout: finiteNumber(attributes.payout)
    }];
  });

/** Read only the two IDs which the public deck projection explicitly offers. */
const readCargoOfferIds = (publicState: JsonRecord): string[] => {
  const decks = isRecord(publicState.decks) ? publicState.decks : {};
  const cargo = isRecord(decks.cargo) ? decks.cargo : {};
  const offer = isRecord(cargo.offer) ? cargo.offer : {};
  return [offer.firstCardId, offer.secondCardId].flatMap((value) => text(value) ?? []);
};

const readTeams = (
  publicState: JsonRecord,
  vehicles: readonly BoardVehicleView[]
): TeamSummaryView[] => {
  if (!isRecord(publicState.teams)) return [];
  return Object.entries(publicState.teams).flatMap(([id, raw]) => {
    if (!isRecord(raw)) return [];
    return [{
      id,
      label: text(raw.label) ?? id,
      type: text(raw.type) ?? "team",
      coins: finiteNumber(raw.coins),
      // Counts are a presentation-only aggregation over objects already
      // present in the public snapshot. They do not decide ownership or rules.
      locomotives: vehicles.filter((vehicle) =>
        vehicle.ownerTeamId === id && vehicle.kind === "locomotive").length,
      wagons: vehicles.filter((vehicle) =>
        vehicle.ownerTeamId === id && vehicle.kind === "wagon").length
    }];
  });
};

/**
 * Present the saved runtime order without recalculating any tie-break in UI.
 *
 * Missing labels fall back to stable ids so an incomplete mock snapshot stays
 * diagnosable, while malformed list entries are ignored rather than guessed.
 */
const readLocomotiveOrder = (
  publicState: JsonRecord,
  nodes: readonly BoardNodeView[],
  teams: readonly TeamSummaryView[]
): LocomotiveOrderEntryView[] => {
  const session = isRecord(publicState.session) ? publicState.session : {};
  if (!Array.isArray(session.locomotiveOrder)) return [];
  const locomotives = objectCollection(publicState, "locomotives");
  const nodeLabels = new Map(nodes.map((node) => [node.id, node.label]));
  const teamLabels = new Map(teams.map((team) => [team.id, team.label]));

  return session.locomotiveOrder.flatMap((rawId) => {
    const id = text(rawId);
    if (!id) return [];
    const locomotive = isRecord(locomotives[id]) ? locomotives[id] : {};
    const attributes = isRecord(locomotive.attributes) ? locomotive.attributes : {};
    const ownerTeamId = text(attributes.ownerTeamId);
    const nodeId = text(attributes.nodeId);
    return [{
      id,
      ownerLabel: ownerTeamId ? teamLabels.get(ownerTeamId) ?? ownerTeamId : "команда не указана",
      nodeLabel: nodeId ? nodeLabels.get(nodeId) ?? nodeId : "станция не указана"
    }];
  });
};

const readLog = (publicState: JsonRecord): BoardLogEntryView[] => {
  if (!Array.isArray(publicState.log)) return [];
  return publicState.log.flatMap((raw, index) => {
    if (!isRecord(raw)) return [];
    const summary = text(raw.summary);
    if (!summary) return [];
    return [{
      id: text(raw.id) ?? `log-entry-${index}`,
      kind: text(raw.kind) ?? "event",
      summary
    }];
  });
};

const readHighlights = (board: JsonRecord): BoardHighlightView[] => {
  if (!Array.isArray(board.highlights)) return [];
  return board.highlights.flatMap((raw, index) => {
    if (!isRecord(raw)) return [];
    const targetType = raw.targetType === "node" || raw.targetType === "edge" ? raw.targetType : null;
    const targetId = text(raw.targetId);
    if (!targetType || !targetId) return [];
    return [{
      id: text(raw.id) ?? `highlight-${index}`,
      targetType,
      targetId,
      actionId: text(raw.actionId),
      params: isRecord(raw.params) ? raw.params : {}
    }];
  });
};

const readActionPhases = (value: unknown): readonly string[] | undefined => {
  if (typeof value === "string") {
    return text(value) ? [value] : undefined;
  }
  if (!Array.isArray(value)) return undefined;
  const phases = value.flatMap((item) => text(item) ?? []);
  return phases.length > 0 ? phases : undefined;
};

type SessionAvailabilityEntry = {
  readonly actionId?: unknown;
  readonly status?: unknown;
  readonly reasonCode?: unknown;
};

const serverUnavailableReason = (reasonCode: unknown): string => {
  if (reasonCode === "role_not_allowed") return "Действие недоступно для роли ведущего.";
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
  currentPhase: string,
  availability: ReadonlyMap<string, SessionAvailabilityEntry>
): ProjectedBoardAction[] => {
  if (!Array.isArray(board.availableActions)) return [];
  return board.availableActions.flatMap((raw, index) => {
    if (!isRecord(raw)) return [];
    const actionId = text(raw.actionId);
    const label = text(raw.label);
    if (!actionId || !label) return [];
    const projectedAvailability = availability.get(actionId);
    const serverDisabled = projectedAvailability?.status === "unavailable";
    const authoredDisabledReason = text(raw.disabledReason) ?? text(raw.reason) ?? undefined;
    const disabledReason = serverDisabled
      ? authoredDisabledReason ?? serverUnavailableReason(projectedAvailability?.reasonCode)
      : raw.disabled === true ? authoredDisabledReason : undefined;
    const phases = readActionPhases(raw.phase);
    // `phase` is authored by the server-side manifest. The client only applies
    // that explicit presentation filter; it never derives phase eligibility.
    if (phases && !phases.includes(currentPhase)) return [];
    return [{
      id: text(raw.id) ?? `board-action-${index}`,
      label,
      description: text(raw.description) ?? disabledReason,
      actionId,
      params: isRecord(raw.params) ? raw.params : undefined,
      disabled: raw.disabled === true || serverDisabled,
      disabledReason,
      section: text(raw.section) ?? undefined,
      phases
    }];
  });
};

const groupActions = (
  actions: readonly ProjectedBoardAction[]
): readonly BoardActionSectionView[] => {
  const groups = new Map<string, ProjectedBoardAction[]>();
  for (const action of actions) {
    // Missing metadata stays in one neutral bucket. The client does not infer a
    // gameplay category from action ids or labels.
    const section = action.section ?? "actions";
    const group = groups.get(section) ?? [];
    group.push(action);
    groups.set(section, group);
  }
  return [...groups].map(([id, groupedActions]) => ({ id, actions: groupedActions }));
};

const readBounds = (board: JsonRecord, nodes: readonly BoardNodeView[]): BoardProjection["bounds"] => {
  if (isRecord(board.canonicalBounds)) {
    const minX = finiteNumber(board.canonicalBounds.minX);
    const minY = finiteNumber(board.canonicalBounds.minY);
    const maxX = finiteNumber(board.canonicalBounds.maxX);
    const maxY = finiteNumber(board.canonicalBounds.maxY);
    if (minX !== null && minY !== null && maxX !== null && maxY !== null && maxX > minX && maxY > minY) {
      return { minX, minY, maxX, maxY };
    }
  }
  if (nodes.length === 0) return null;
  const xs = nodes.map((node) => node.position.x);
  const ys = nodes.map((node) => node.position.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    minX,
    minY,
    maxX: maxX === minX ? minX + 1 : maxX,
    maxY: maxY === minY ? minY + 1 : maxY
  };
};

const readDeckPresentation = (
  publicState: JsonRecord,
  nodes: readonly BoardNodeView[]
): Pick<BoardProjection, "currentNewsSummary" | "cargoOfferLabels"> => {
  const decks = isRecord(publicState.decks) ? publicState.decks : {};
  const news = isRecord(decks.news) ? decks.news : {};
  const cargo = isRecord(decks.cargo) ? decks.cargo : {};
  const offer = isRecord(cargo.offer) ? cargo.offer : {};
  const newsCards = objectCollection(publicState, "newsCards");
  const cargoCards = objectCollection(publicState, "cargoCards");
  const nodeLabels = new Map(nodes.map((node) => [node.id, node.label]));

  const newsId = text(news.currentCardId);
  const newsCard = newsId && isRecord(newsCards[newsId]) ? newsCards[newsId] : {};
  const newsAttributes = isRecord(newsCard.attributes) ? newsCard.attributes : {};

  const cargoOfferLabels = [offer.firstCardId, offer.secondCardId].flatMap((rawId) => {
    const id = text(rawId);
    if (!id || !isRecord(cargoCards[id])) return [];
    const attributes = isRecord(cargoCards[id].attributes) ? cargoCards[id].attributes : {};
    const fromId = text(attributes.fromNodeId);
    const toId = text(attributes.toNodeId);
    if (!fromId || !toId) return [id];
    return [`${nodeLabels.get(fromId) ?? fromId} → ${nodeLabels.get(toId) ?? toId}`];
  });

  return {
    currentNewsSummary: text(newsAttributes.summary),
    cargoOfferLabels
  };
};

/** Convert a player-facing session snapshot into a deterministic board view. */
export function projectBoardSession(session: { state?: unknown; actionAvailability?: unknown }): BoardProjection {
  const state = isRecord(session.state) ? session.state : {};
  const publicState = isRecord(state.public) ? state.public : {};
  const board = isRecord(publicState.board) ? publicState.board : {};
  const sessionState = isRecord(publicState.session) ? publicState.session : {};
  const constructionState = isRecord(publicState.construction) ? publicState.construction : {};
  const phase = text(sessionState.phase) ?? "unknown";
  const nodes = readNodes(publicState);
  const vehicles = readVehicles(publicState);
  const teams = readTeams(publicState, vehicles);
  const cargoOrders = readCargoOrders(publicState);
  const availableActions = readActions(
    board,
    phase,
    readActionAvailability(session.actionAvailability)
  );
  const deckPresentation = readDeckPresentation(publicState, nodes);
  return {
    nodes,
    edges: readEdges(publicState, nodes),
    vehicles,
    cargoOrders,
    cargoOfferIds: readCargoOfferIds(publicState),
    teams,
    locomotiveOrder: readLocomotiveOrder(publicState, nodes, teams),
    highlights: readHighlights(board),
    availableActions,
    actionSections: groupActions(availableActions),
    log: readLog(publicState),
    bounds: readBounds(board, nodes),
    phase,
    status: text(sessionState.status) ?? "unknown",
    constructionMode: text(constructionState.mode),
    contentMode: text(sessionState.contentMode) ?? "unknown",
    ...deckPresentation,
    turnNumber: finiteNumber(sessionState.turnNumber) ?? 0
  };
}
