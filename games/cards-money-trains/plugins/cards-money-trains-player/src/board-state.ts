/**
 * Public-snapshot projection for the Cards Money Trains Phaser scene.
 *
 * This module deliberately contains no gameplay validation. Runtime provides
 * authoritative nodes, edges, highlights, controls and canonical action
 * availability; the plugin only combines those public values into a safe view.
 */

import { readCountryId } from "./country-presentation.ts";

export type CanonicalPoint = Readonly<{ x: number; y: number }>;

export interface BoardNodeView {
  readonly id: string;
  readonly label: string;
  readonly objectType: string;
  readonly position: CanonicalPoint;
  readonly visualState: string;
  /** Public immutable-content reference used only by the information panel. */
  readonly countryId: string | null;
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
  /** Public relation used only to arrange an already confirmed train. */
  readonly attachedVehicleId?: string | null;
  /** Public cargo relation used only to show load and delivery transitions. */
  readonly cargoId?: string | null;
  /**
   * Runtime-owned draft target for refresh-safe group train formation.
   *
   * The client uses it only to paint the marker and choose between the explicit
   * select and unselect intents. It never derives wagon eligibility from it.
   */
  readonly formationTargetLocomotiveId?: string | null;
}

/**
 * Minimal visible cargo facts needed by accessible controls and map animation.
 *
 * Hidden deck records are deliberately absent from this view. The renderer
 * must not turn an authoritative server-side deck into a browser-readable list.
 */
export interface BoardCargoView {
  readonly id: string;
  readonly status: "offered" | "available" | "in_transit" | "delivered";
  readonly fromNodeId: string | null;
  readonly toNodeId: string | null;
  readonly payout: number | null;
}

export interface TeamSummaryView {
  readonly id: string;
  readonly label: string;
  readonly type: string;
  readonly coins: number | null;
  /** Closed game palette id used only for persistent ownership color. */
  readonly colorId?: string;
}

/** Human-readable facts for the single news card revealed by runtime. */
export interface BoardNewsView {
  readonly id: string;
  readonly number: number | null;
  readonly text: string | null;
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
  /**
   * Canonical Runtime verdict for this action in the current snapshot.
   *
   * It is kept separate from the authored `disabled` flag so the accessible
   * controls can hide only actions that Runtime has proven unavailable while
   * retaining authored disabled hints and parameter-dependent actions. Older
   * cached snapshots legitimately omit this value.
   */
  readonly availabilityStatus?:
    | "available"
    | "unavailable"
    | "parameter-dependent";
}

export interface BoardProjection {
  readonly nodes: readonly BoardNodeView[];
  readonly edges: readonly BoardEdgeView[];
  readonly vehicles: readonly BoardVehicleView[];
  /** Optional for compatibility with projection fixtures created before cargo animation. */
  readonly cargos?: readonly BoardCargoView[];
  readonly teams: readonly TeamSummaryView[];
  readonly highlights: readonly BoardHighlightView[];
  readonly availableActions: readonly ProjectedBoardAction[];
  readonly bounds: Readonly<{ minX: number; minY: number; maxX: number; maxY: number }> | null;
  readonly phase: string;
  readonly turnNumber: number;
  /**
   * Runtime-owned locomotive order for the current movement phase.
   *
   * The client only sanitizes this bounded public value for rendering. It must
   * never recalculate ordering from positions, balances or team resources,
   * because those rules are authoritative on the server.
   */
  readonly locomotiveOrder: readonly string[];
  /** Current server-selected locomotive, or `null` when no safe match exists. */
  readonly currentLocomotiveId: string | null;
  /** Currently revealed news card, if the public game state exposes one. */
  readonly currentNewsId?: string | null;
  readonly currentNews?: BoardNewsView | null;
}

type JsonRecord = Record<string, unknown>;

type SessionAvailabilityEntry = {
  readonly status?: unknown;
  readonly reasonCode?: unknown;
};

type SessionAvailabilityStatus =
  NonNullable<ProjectedBoardAction["availabilityStatus"]>;

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

/** Keep the UI parser aligned with the manifest's bounded locomotive-order type. */
const MAX_LOCOMOTIVE_ORDER_ITEMS = 64;

/**
 * Sanitize only the server-published movement view.
 *
 * De-duplication is defensive rendering, not game logic: the first occurrence
 * keeps the authoritative order while malformed repeats cannot create several
 * badges for one locomotive.
 */
const readMovement = (
  publicState: JsonRecord
): Pick<BoardProjection, "locomotiveOrder" | "currentLocomotiveId"> => {
  const movement = isRecord(publicState.movement) ? publicState.movement : {};
  const rawOrder = Array.isArray(movement.locomotiveOrder) ? movement.locomotiveOrder : [];
  const seen = new Set<string>();
  const locomotiveOrder: string[] = [];

  for (const rawId of rawOrder) {
    const id = text(rawId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    locomotiveOrder.push(id);
    if (locomotiveOrder.length === MAX_LOCOMOTIVE_ORDER_ITEMS) break;
  }

  const candidateCurrent = text(movement.currentLocomotiveId);
  return {
    locomotiveOrder,
    currentLocomotiveId:
      candidateCurrent && seen.has(candidateCurrent) ? candidateCurrent : null
  };
};

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
      visualState: text(facets.availability) ?? "open",
      countryId: readCountryId(attributes.countryId)
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
        ownerTeamId: text(attributes.ownerTeamId),
        attachedVehicleId: text(attributes.attachedVehicleId),
        cargoId: text(attributes.cargoId),
        formationTargetLocomotiveId: text(attributes.formationTargetLocomotiveId)
      }];
    });
  return [...read("locomotives", "locomotive"), ...read("wagons", "wagon")];
};

const VISIBLE_CARGO_STATUSES: ReadonlySet<string> = new Set([
  "offered",
  "available",
  "in_transit",
  "delivered"
]);

const isVisibleCargoStatus = (
  value: string
): value is BoardCargoView["status"] => VISIBLE_CARGO_STATUSES.has(value);

/**
 * Publish only cargo that the game model marks visible.
 *
 * This is a presentation boundary, not a legality check. In particular, the
 * `available` subset is used only to keep the load selector useful; Runtime
 * still decides whether a chosen wagon/order pair is legal in the current turn.
 */
const readCargo = (publicState: JsonRecord): BoardCargoView[] =>
  Object.entries(objectCollection(publicState, "cargoOrders")).flatMap(([id, raw]) => {
    if (!isRecord(raw)) return [];
    const facets = isRecord(raw.facets) ? raw.facets : {};
    const status = text(facets.status);
    if (!status || !isVisibleCargoStatus(status)) return [];
    const attributes = isRecord(raw.attributes) ? raw.attributes : {};
    return [{
      id,
      status,
      fromNodeId: text(attributes.fromNodeId),
      toNodeId: text(attributes.toNodeId),
      payout: finiteNumber(attributes.payout)
    }];
  });

const readTeams = (publicState: JsonRecord): TeamSummaryView[] => {
  return Object.entries(objectCollection(publicState, "teams")).flatMap(([id, raw]) => {
    if (!isRecord(raw)) return [];
    const attributes = isRecord(raw.attributes) ? raw.attributes : {};
    const colorId = text(attributes.colorId);
    return [{
      id,
      label: text(attributes.label) ?? id,
      type: text(attributes.type) ?? "team",
      coins: finiteNumber(attributes.coins),
      ...(colorId ? { colorId } : {})
    }];
  });
};

/** Read only the currently revealed card; absent content safely falls back to its id. */
const readCurrentNews = (
  publicState: JsonRecord,
  currentNewsId: string | null
): BoardNewsView | null => {
  if (!currentNewsId) return null;
  const raw = objectCollection(publicState, "newsCards")[currentNewsId];
  if (!isRecord(raw)) {
    return { id: currentNewsId, number: null, text: null };
  }
  const attributes = isRecord(raw.attributes) ? raw.attributes : {};
  return {
    id: currentNewsId,
    number: finiteNumber(attributes.number),
    text: text(attributes.text)
  };
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

/** Accept only the three statuses defined by the public session contract. */
const readAvailabilityStatus = (
  value: unknown
): SessionAvailabilityStatus | undefined =>
  value === "available"
  || value === "unavailable"
  || value === "parameter-dependent"
    ? value
    : undefined;

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
    const availabilityStatus = readAvailabilityStatus(
      projectedAvailability?.status
    );
    const serverDisabled = availabilityStatus === "unavailable";
    const authoredDisabledReason = text(raw.disabledReason) ?? text(raw.reason) ?? undefined;
    return [{
      id: text(raw.id) ?? `board-action-${index}`,
      label,
      description: serverDisabled
        ? authoredDisabledReason ?? serverUnavailableReason(projectedAvailability?.reasonCode)
        : text(raw.description) ?? undefined,
      actionId,
      params: isRecord(raw.params) ? raw.params : undefined,
      disabled: raw.disabled === true || serverDisabled,
      ...(availabilityStatus === undefined ? {} : { availabilityStatus })
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
  const newsState = isRecord(publicState.news) ? publicState.news : {};
  const currentNewsId = text(newsState.currentCardId);
  const nodes = readNodes(publicState);
  const movement = readMovement(publicState);
  return {
    nodes,
    edges: readEdges(publicState, nodes),
    vehicles: readVehicles(publicState),
    cargos: readCargo(publicState),
    teams: readTeams(publicState),
    highlights: readHighlights(board),
    availableActions: readActions(board, readActionAvailability(session.actionAvailability)),
    bounds: readBounds(board, nodes),
    phase: text(sessionState.phase) ?? "unknown",
    turnNumber: finiteNumber(sessionState.turnNumber) ?? 0,
    ...movement,
    currentNewsId,
    currentNews: readCurrentNews(publicState, currentNewsId)
  };
}
