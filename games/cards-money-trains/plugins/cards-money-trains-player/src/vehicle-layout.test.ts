/** Focused tests for persistent, relation-aware vehicle marker placement. */

import assert from "node:assert/strict";
import test from "node:test";

import type { BoardVehicleView } from "./board-state.ts";
import { layoutVehiclePositions } from "./vehicle-layout.ts";

const vehicle = (
  id: string,
  kind: BoardVehicleView["kind"],
  attachedVehicleId: string | null = null
): BoardVehicleView => ({
  id,
  kind,
  nodeId: "station",
  ownerTeamId: "team",
  attachedVehicleId
});

test("keeps attached wagons closer than independent vehicles", () => {
  const positions = layoutVehiclePositions({
    vehicles: [
      vehicle("loco", "locomotive"),
      vehicle("attached", "wagon", "loco"),
      vehicle("independent", "wagon")
    ],
    nodePositions: new Map([["station", { x: 100, y: 50 }]])
  });

  const loco = positions.get("loco")!;
  const attached = positions.get("attached")!;
  const independent = positions.get("independent")!;
  assert.equal(attached.x - loco.x, 18);
  assert.equal(independent.x - attached.x, 40);
  assert.equal(loco.y, 72);
});

test("renders malformed attachment cycles instead of dropping markers", () => {
  const positions = layoutVehiclePositions({
    vehicles: [
      vehicle("a", "wagon", "b"),
      vehicle("b", "wagon", "a")
    ],
    nodePositions: new Map([["station", { x: 0, y: 0 }]])
  });

  assert.deepEqual([...positions.keys()], ["a", "b"]);
});
