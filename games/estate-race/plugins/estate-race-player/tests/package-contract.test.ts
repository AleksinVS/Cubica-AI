/** Package-level invariants for original content and the bounded first slice. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readJson = (relativePath: string) =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as Record<string, unknown>;

test("manifest owns a twelve-cell original board and exactly two hotseat participants", () => {
  const manifest = readJson("../../../game.manifest.json");
  const config = manifest.config as Record<string, any>;
  const state = manifest.state as Record<string, any>;
  const cells = state.public.objects.boardCells as Record<string, any>;

  assert.deepEqual(config.players, { min: 2, max: 2 });
  assert.equal(config.settings.mode, "local-hotseat");
  assert.equal(Object.keys(cells).length, 12);
  assert.deepEqual(Object.values(cells).map((cell) => cell.attributes.index),
    Array.from({ length: 12 }, (_, index) => index));
  assert.deepEqual(state.playersTemplate.metrics, { cash: 900, position: 0 });
});

test("economy uses typed participant endpoints and trusted object references", () => {
  const manifest = readJson("../../../game.manifest.json");
  const actions = manifest.actions as Record<string, any>;
  const buy = actions["property.buy.cell-02"];
  const rent = actions["property.rent.cell-02"];
  const buyTransfer = buy.deterministic.effects.find((effect: any) => effect.op === "metric.transfer");
  const rentTransfer = rent.deterministic.effects.find((effect: any) => effect.op === "metric.transfer");

  assert.equal(buy.paramsSchema.properties.cellId["x-cubica-ref"].collection, "boardCells");
  assert.deepEqual(buyTransfer.from, { scope: "player", playerId: "{{actor}}", metricId: "cash" });
  assert.deepEqual(buyTransfer.to, { scope: "bank" });
  assert.equal(buyTransfer.onInsufficient, "fail");
  assert.deepEqual(rentTransfer.to.playerId, {
    fromPath: "/public/objects/boardCells/cell-02/attributes/ownerPlayerId"
  });
});

test("package text contains no protected classic board names or trade dress claims", () => {
  const manifestText = readFileSync(new URL("../../../game.manifest.json", import.meta.url), "utf8");
  for (const forbidden of ["Monopoly", "Монополия", "Boardwalk", "Park Place", "GO TO JAIL", "Chance"]) {
    assert.equal(manifestText.includes(forbidden), false, `unexpected protected marker: ${forbidden}`);
  }
  assert.match(manifestText, /Липовая аллея/);
  assert.match(manifestText, /Оранжерейный проезд/);
});
