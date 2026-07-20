/**
 * Derives visual transition facts between two confirmed board projections.
 *
 * The runtime remains the only source of gameplay truth. This module neither
 * validates actions nor changes game state: it compares public snapshots by
 * stable entity IDs and describes what a renderer may animate. Keeping that
 * boundary explicit prevents animation timing from affecting game rules.
 */

import type {
  BoardEdgeView,
  BoardNodeView,
  BoardProjection,
  BoardVehicleView,
  CanonicalPoint
} from "./board-state.ts";

export interface VehicleMovedTransition {
  readonly kind: "vehicle-moved";
  readonly vehicleId: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  /**
   * Exact confirmed road geometry, oriented in the direction of movement.
   *
   * `null` means that the public topology cannot prove one unique road. The
   * renderer must then place the vehicle at its final position without
   * inventing a route.
   */
  readonly path: readonly CanonicalPoint[] | null;
}

export interface VehicleAddedTransition {
  readonly kind: "vehicle-added";
  readonly vehicleId: string;
  readonly vehicle: BoardVehicleView;
}

export interface VehicleRemovedTransition {
  readonly kind: "vehicle-removed";
  readonly vehicleId: string;
  readonly vehicle: BoardVehicleView;
}

export interface VehicleAttachmentChangedTransition {
  readonly kind: "vehicle-attachment-changed";
  readonly vehicleId: string;
  readonly fromVehicleId: string | null;
  readonly toVehicleId: string | null;
}

export interface VehicleCargoChangedTransition {
  readonly kind: "vehicle-cargo-changed";
  readonly vehicleId: string;
  readonly fromCargoId: string | null;
  readonly toCargoId: string | null;
}

export interface EdgeAddedTransition {
  readonly kind: "edge-added";
  readonly edgeId: string;
  readonly edge: BoardEdgeView;
}

export interface EdgeVisualStateChangedTransition {
  readonly kind: "edge-visual-state-changed";
  readonly edgeId: string;
  readonly fromVisualState: string;
  readonly toVisualState: string;
}

export interface NodeAddedTransition {
  readonly kind: "node-added";
  readonly nodeId: string;
  readonly node: BoardNodeView;
}

export interface NodeVisualStateChangedTransition {
  readonly kind: "node-visual-state-changed";
  readonly nodeId: string;
  readonly fromVisualState: string;
  readonly toVisualState: string;
}

export interface TeamCoinsChangedTransition {
  readonly kind: "team-coins-changed";
  readonly teamId: string;
  readonly fromCoins: number;
  readonly toCoins: number;
  readonly delta: number;
}

export interface NewsChangedTransition {
  readonly kind: "news-changed";
  readonly fromNewsId: string | null;
  readonly toNewsId: string;
}

/**
 * A discriminated union is used so the scene can handle every visual fact
 * explicitly while TypeScript narrows each event by its `kind`.
 */
export type BoardTransition =
  | VehicleMovedTransition
  | VehicleAddedTransition
  | VehicleRemovedTransition
  | VehicleAttachmentChangedTransition
  | VehicleCargoChangedTransition
  | EdgeAddedTransition
  | EdgeVisualStateChangedTransition
  | NodeAddedTransition
  | NodeVisualStateChangedTransition
  | TeamCoinsChangedTransition
  | NewsChangedTransition;

const byId = <T extends { readonly id: string }>(
  items: readonly T[]
): ReadonlyMap<string, T> => new Map(items.map((item) => [item.id, item]));

const clonePoints = (points: readonly CanonicalPoint[]): readonly CanonicalPoint[] =>
  points.map(({ x, y }) => ({ x, y }));

/**
 * Find a path only when the final confirmed topology contains exactly one
 * road between the old and new nodes. Roads in this game are bidirectional,
 * therefore a reverse movement receives the reversed edge polyline.
 */
const uniqueMovementPath = (
  edges: readonly BoardEdgeView[],
  fromNodeId: string,
  toNodeId: string
): readonly CanonicalPoint[] | null => {
  const candidates = edges.filter((edge) =>
    (edge.fromNodeId === fromNodeId && edge.toNodeId === toNodeId)
    || (edge.fromNodeId === toNodeId && edge.toNodeId === fromNodeId));

  if (candidates.length !== 1) return null;

  const [edge] = candidates;
  if (!edge) return null;
  const points = clonePoints(edge.points);
  return edge.fromNodeId === fromNodeId ? points : [...points].reverse();
};

const transitionEntityId = (transition: BoardTransition): string => {
  switch (transition.kind) {
    case "vehicle-moved":
    case "vehicle-added":
    case "vehicle-removed":
    case "vehicle-attachment-changed":
    case "vehicle-cargo-changed":
      return transition.vehicleId;
    case "edge-added":
    case "edge-visual-state-changed":
      return transition.edgeId;
    case "node-added":
    case "node-visual-state-changed":
      return transition.nodeId;
    case "team-coins-changed":
      return transition.teamId;
    case "news-changed":
      return transition.toNewsId;
  }
};

/**
 * Compare Unicode code units instead of relying on the host locale. Locale
 * collation may differ between browsers and servers, while this ordering must
 * remain identical for the same pair of snapshots.
 */
const compareStableText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/**
 * Compare two confirmed projections and return deterministic visual facts.
 *
 * The first snapshot is rendered directly: replaying its accumulated history
 * would produce misleading animations after loading or reconnecting. Events
 * are sorted by `kind`, then stable entity ID, so the same snapshots always
 * yield the same sequence regardless of collection insertion order.
 */
export function deriveBoardTransitions(
  previous: BoardProjection | null,
  next: BoardProjection
): readonly BoardTransition[] {
  if (previous === null) return [];

  const transitions: BoardTransition[] = [];
  const previousVehicles = byId(previous.vehicles);
  const nextVehicles = byId(next.vehicles);
  const previousEdges = byId(previous.edges);
  const previousNodes = byId(previous.nodes);
  const previousTeams = byId(previous.teams);

  for (const vehicle of next.vehicles) {
    const before = previousVehicles.get(vehicle.id);
    if (!before) {
      transitions.push({
        kind: "vehicle-added",
        vehicleId: vehicle.id,
        vehicle
      });
      continue;
    }

    // A route is meaningful only between two actual nodes. Appearing on or
    // leaving the map is a placement change, not a guessed movement animation.
    if (before.nodeId && vehicle.nodeId && before.nodeId !== vehicle.nodeId) {
      transitions.push({
        kind: "vehicle-moved",
        vehicleId: vehicle.id,
        fromNodeId: before.nodeId,
        toNodeId: vehicle.nodeId,
        path: uniqueMovementPath(next.edges, before.nodeId, vehicle.nodeId)
      });
    }
    const beforeAttachment = before.attachedVehicleId ?? null;
    const nextAttachment = vehicle.attachedVehicleId ?? null;
    if (beforeAttachment !== nextAttachment) {
      transitions.push({
        kind: "vehicle-attachment-changed",
        vehicleId: vehicle.id,
        fromVehicleId: beforeAttachment,
        toVehicleId: nextAttachment
      });
    }
    const beforeCargo = before.cargoId ?? null;
    const nextCargo = vehicle.cargoId ?? null;
    if (beforeCargo !== nextCargo) {
      transitions.push({
        kind: "vehicle-cargo-changed",
        vehicleId: vehicle.id,
        fromCargoId: beforeCargo,
        toCargoId: nextCargo
      });
    }
  }

  for (const vehicle of previous.vehicles) {
    if (!nextVehicles.has(vehicle.id)) {
      transitions.push({
        kind: "vehicle-removed",
        vehicleId: vehicle.id,
        vehicle
      });
    }
  }

  for (const edge of next.edges) {
    const before = previousEdges.get(edge.id);
    if (!before) {
      transitions.push({
        kind: "edge-added",
        edgeId: edge.id,
        edge
      });
    } else if (before.visualState !== edge.visualState) {
      transitions.push({
        kind: "edge-visual-state-changed",
        edgeId: edge.id,
        fromVisualState: before.visualState,
        toVisualState: edge.visualState
      });
    }
  }

  for (const node of next.nodes) {
    const before = previousNodes.get(node.id);
    if (!before) {
      transitions.push({
        kind: "node-added",
        nodeId: node.id,
        node
      });
    } else if (before.visualState !== node.visualState) {
      transitions.push({
        kind: "node-visual-state-changed",
        nodeId: node.id,
        fromVisualState: before.visualState,
        toVisualState: node.visualState
      });
    }
  }

  for (const team of next.teams) {
    const before = previousTeams.get(team.id);
    if (before && before.coins !== null && team.coins !== null && before.coins !== team.coins) {
      transitions.push({
        kind: "team-coins-changed",
        teamId: team.id,
        fromCoins: before.coins,
        toCoins: team.coins,
        delta: team.coins - before.coins
      });
    }
  }
  const previousNewsId = previous.currentNewsId ?? null;
  const nextNewsId = next.currentNewsId ?? null;
  if (nextNewsId !== null && previousNewsId !== nextNewsId) {
    transitions.push({
      kind: "news-changed",
      fromNewsId: previousNewsId,
      toNewsId: nextNewsId
    });
  }

  return transitions.sort((left, right) => {
    const byKind = compareStableText(left.kind, right.kind);
    return byKind !== 0
      ? byKind
      : compareStableText(transitionEntityId(left), transitionEntityId(right));
  });
}
