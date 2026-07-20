/** Focused regression tests for durable vehicle markers after animations end. */

import assert from "node:assert/strict";
import test from "node:test";

import type { BoardVehicleView } from "./board-state.ts";
import { vehicleGlyph } from "./vehicle-presentation.ts";

const vehicle = (
  kind: BoardVehicleView["kind"],
  cargoId: string | null = null
): BoardVehicleView => ({
  id: `${kind}-1`,
  kind,
  nodeId: "terminal-1",
  ownerTeamId: "team-1",
  cargoId
});

test("keeps locomotives, empty wagons and loaded wagons visually distinct", () => {
  assert.equal(vehicleGlyph(vehicle("locomotive")), "◆");
  assert.equal(vehicleGlyph(vehicle("wagon")), "■");
  assert.equal(vehicleGlyph(vehicle("wagon", "cargo-1")), "▣");
});
