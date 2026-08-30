/** Prove that the executable mock stays isolated and enables transport actions. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readJson = (relativePath: string) =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as Record<string, unknown>;

test("compiled mock manifest has its own identity and an executable network", () => {
  const manifest = readJson("../../../game.manifest.json");
  const meta = manifest.meta as Record<string, unknown>;
  const content = manifest.content as Record<string, any>;
  const actions = manifest.actions as Record<string, Record<string, unknown>>;

  assert.equal(meta.id, "cards-money-trains-mock");
  assert.match(String(meta.name), /MOCK/);
  assert.equal(content.data.mockNotice.normativeGameId, "cards-money-trains");
  assert.equal(content.data.mockNotice.replaceBeforePublication, true);
  assert.ok((manifest.networkModels as Record<string, unknown>).main);
  assert.ok(actions["construction.road.build"]);
  assert.ok(actions["construction.waypoint.build"]);

  const state = manifest.state as Record<string, any>;
  const dynamicBoardActionIds = [
    "mock.cargo.load.white",
    "mock.operations.attach.white",
    "mock.operations.detach.white",
    "mock.locomotive.move",
    "mock.cargo.deliver"
  ];
  for (const actionId of dynamicBoardActionIds) {
    const boardAction = state.public.board.availableActions.find(
      (candidate: Record<string, unknown>) => candidate.actionId === actionId
    );
    assert.ok(boardAction, `${actionId} must remain visible on the facilitator board`);
    assert.equal(
      Object.prototype.hasOwnProperty.call(boardAction, "params"),
      false,
      `${actionId} must collect object IDs dynamically`
    );
  }

  for (const actionId of [
    "mock.cargo.load.white",
    "mock.operations.attach.white",
    "mock.operations.detach.white",
    "mock.cargo.deliver"
  ]) {
    const paramsSchema = actions[actionId]?.paramsSchema as Record<string, any>;
    for (const [parameterName, parameterSchema] of Object.entries(paramsSchema.properties)) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(parameterSchema, "enum"),
        false,
        `${actionId}.${parameterName} must not pin a fixture object ID`
      );
    }
  }
});

test("mock annotation produces connected references and explicitly closed regions", () => {
  const annotation = readJson("../../../annotations/map-annotation.mock.json");
  const nodes = new Set((annotation.nodes as Array<Record<string, string>>).map((node) => node.id));
  for (const edge of annotation.edges as Array<Record<string, string>>) {
    assert.equal(nodes.has(edge.fromNodeId), true);
    assert.equal(nodes.has(edge.toNodeId), true);
  }
  for (const region of annotation.regions as Array<Record<string, any>>) {
    assert.deepEqual(region.polygon[0], region.polygon.at(-1));
  }
});
