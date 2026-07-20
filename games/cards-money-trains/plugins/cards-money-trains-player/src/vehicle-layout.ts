/**
 * Pure layout for transport markers sharing one station.
 *
 * Attached wagons are kept visually close to their locomotive. Independent
 * vehicles receive a larger gap, so coupling and uncoupling remain visible in
 * the final confirmed state even when animation is disabled.
 */

import type { BoardVehicleView, CanonicalPoint } from "./board-state.ts";

const TRAIN_MEMBER_GAP = 18;
const INDEPENDENT_GROUP_GAP = 40;

type VehiclePositionInput = Readonly<{
  vehicles: readonly BoardVehicleView[];
  nodePositions: ReadonlyMap<string, CanonicalPoint>;
}>;

/** Return deterministic marker positions without deriving any gameplay rule. */
export function layoutVehiclePositions({
  vehicles,
  nodePositions
}: VehiclePositionInput): ReadonlyMap<string, CanonicalPoint> {
  const vehiclesByNode = new Map<string, BoardVehicleView[]>();
  for (const vehicle of vehicles) {
    if (!vehicle.nodeId || !nodePositions.has(vehicle.nodeId)) continue;
    const current = vehiclesByNode.get(vehicle.nodeId) ?? [];
    current.push(vehicle);
    vehiclesByNode.set(vehicle.nodeId, current);
  }

  const positions = new Map<string, CanonicalPoint>();
  for (const [nodeId, colocated] of vehiclesByNode) {
    const node = nodePositions.get(nodeId);
    if (!node) continue;
    const byId = new Map(colocated.map((vehicle) => [vehicle.id, vehicle]));
    const attachedByTarget = new Map<string, BoardVehicleView[]>();
    for (const vehicle of colocated) {
      const targetId = vehicle.attachedVehicleId ?? null;
      if (!targetId || !byId.has(targetId)) continue;
      const attached = attachedByTarget.get(targetId) ?? [];
      attached.push(vehicle);
      attachedByTarget.set(targetId, attached);
    }

    const groupedIds = new Set<string>();
    const groups: BoardVehicleView[][] = [];
    for (const vehicle of colocated) {
      if (groupedIds.has(vehicle.id) || byId.has(vehicle.attachedVehicleId ?? "")) continue;
      const group = [vehicle, ...(attachedByTarget.get(vehicle.id) ?? [])];
      for (const member of group) groupedIds.add(member.id);
      groups.push(group);
    }
    // Malformed cycles or chains are still rendered deterministically instead
    // of disappearing. Runtime remains responsible for relation validity.
    for (const vehicle of colocated) {
      if (!groupedIds.has(vehicle.id)) {
        groupedIds.add(vehicle.id);
        groups.push([vehicle]);
      }
    }

    const totalWidth = groups.reduce((sum, group, index) =>
      sum
      + Math.max(0, group.length - 1) * TRAIN_MEMBER_GAP
      + (index === groups.length - 1 ? 0 : INDEPENDENT_GROUP_GAP), 0);
    let cursor = node.x - totalWidth / 2;
    for (const [groupIndex, group] of groups.entries()) {
      for (const [memberIndex, vehicle] of group.entries()) {
        positions.set(vehicle.id, {
          x: cursor + memberIndex * TRAIN_MEMBER_GAP,
          y: node.y + 22
        });
      }
      cursor += Math.max(0, group.length - 1) * TRAIN_MEMBER_GAP;
      if (groupIndex < groups.length - 1) cursor += INDEPENDENT_GROUP_GAP;
    }
  }
  return positions;
}
