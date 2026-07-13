/**
 * Public-snapshot projection for the Cards Money Trains Phaser scene.
 *
 * This module deliberately contains no gameplay validation. Runtime provides
 * authoritative nodes, edges, highlights, controls and canonical action
 * availability; the plugin only combines those public values into a safe view.
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
  /**
   * Complete runtime-planned road geometry in canonical map coordinates.
   * `from` and `to` remain below as compatibility aliases for consumers that
   * only understand a straight road.
   */
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

export interface TeamSummaryView {
  readonly id: string;
  readonly label: string;
  readonly type: string;
  readonly coins: number | null;
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
}

export interface BoardProjection {
  readonly nodes: readonly BoardNodeView[];
  readonly edges: readonly BoardEdgeView[];
  readonly vehicles: readonly BoardVehicleView[];
  readonly teams: readonly TeamSummaryView[];
  readonly highlights: readonly BoardHighlightView[];
  readonly availableActions: readonly ProjectedBoardAction[];
  readonly bounds: Readonly<{ minX: number; minY: number; maxX: number; maxY: number }> | null;
  readonly phase: string;
  readonly turnNumber: number;
}

type JsonRecord = Record<string, unknown>;

type SessionAvailabilityEntry = {
  readonly status?: unknown;
  readonly reasonCode?: unknown;
};

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

/**
 * Read one complete polyline only when every coordinate is finite.
 * Falling back as a whole avoids drawing a partly corrupted server route.
 */
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
    // New server-planned roads publish a polyline. Older snapshots publish
    // only explicit endpoints, and the oldest ones rely on node positions.
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
      return [{
        id,
        kind,
        nodeId: text(attributes.nodeId),
        ownerTeamId: text(attributes.ownerTeamId)
      }];
    });
  return [...read("locomotives", "locomotive"), ...read("wagons", "wagon")];
};

const readTeams = (publicState: JsonRecord): TeamSummaryView[] => {
  if (!isRecord(publicState.teams)) return [];
  return Object.entries(publicState.teams).flatMap(([id, raw]) => {
    if (!isRecord(raw)) return [];
    return [{
      id,
      label: text(raw.label) ?? id,
      type: text(raw.type) ?? "team",
      coins: finiteNumber(raw.coins)
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
    return [{
      id: text(raw.id) ?? `board-action-${index}`,
      label,
      description: serverDisabled
        ? authoredDisabledReason ?? serverUnavailableReason(projectedAvailability?.reasonCode)
        : text(raw.description) ?? undefined,
      actionId,
      params: isRecord(raw.params) ? raw.params : undefined,
      disabled: raw.disabled === true || serverDisabled
    }];
  });
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

/** Convert a player-facing session snapshot into a deterministic board view. */
export function projectBoardSession(
  session: { state?: unknown; actionAvailability?: unknown }
): BoardProjection {
  const state = isRecord(session.state) ? session.state : {};
  const publicState = isRecord(state.public) ? state.public : {};
  const board = isRecord(publicState.board) ? publicState.board : {};
  const sessionState = isRecord(publicState.session) ? publicState.session : {};
  const nodes = readNodes(publicState);
  return {
    nodes,
    edges: readEdges(publicState, nodes),
    vehicles: readVehicles(publicState),
    teams: readTeams(publicState),
    highlights: readHighlights(board),
    availableActions: readActions(board, readActionAvailability(session.actionAvailability)),
    bounds: readBounds(board, nodes),
    phase: text(sessionState.phase) ?? "unknown",
    turnNumber: finiteNumber(sessionState.turnNumber) ?? 0
  };
}
