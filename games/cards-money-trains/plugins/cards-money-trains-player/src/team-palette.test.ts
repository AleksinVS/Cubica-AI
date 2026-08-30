/** Focused tests for the closed game-owned transport ownership palette. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  TEAM_MARKER_COLOR_IDS,
  teamMarkerColor
} from "./team-palette.ts";

test("maps all twelve accepted setup colors to distinct marker colors", () => {
  assert.equal(TEAM_MARKER_COLOR_IDS.length, 12);
  const resolved = TEAM_MARKER_COLOR_IDS.map((colorId) =>
    teamMarkerColor(colorId, "#000000"));
  assert.equal(new Set(resolved).size, 12);
  assert.ok(resolved.every((color) => /^#[0-9a-f]{6}$/u.test(color)));
});

test("uses a safe vehicle-kind fallback for unknown or missing ids", () => {
  assert.equal(teamMarkerColor("untrusted-css", "#273f8f"), "#273f8f");
  assert.equal(teamMarkerColor(undefined, "#8f5a27"), "#8f5a27");
});
