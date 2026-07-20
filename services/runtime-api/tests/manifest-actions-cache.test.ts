/** Focused regression coverage for the immutable per-bundle action catalog. */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { GameBundle } from "../src/modules/content/manifestLoader.ts";
import {
  getManifestActionDefinition,
  listManifestActionDefinitions
} from "../src/modules/runtime/manifestActions.ts";

test("the sorted action catalog is cached without mutating its manifest or shared result", () => {
  const actions = {
    "z.action": createAction("plan.z"),
    "a.action": createAction("plan.a", ["facilitator"])
  };
  const bundle = Object.freeze({
    gameId: "action-cache-fixture",
    bundleHash: `cubica-bundle-v1:sha256:${"a".repeat(64)}`,
    manifest: Object.freeze({ actions: Object.freeze(actions) })
  }) as unknown as GameBundle;

  const first = listManifestActionDefinitions(bundle);
  const second = listManifestActionDefinitions(bundle);

  assert.notStrictEqual(second, first);
  assert.strictEqual(second[0], first[0]);
  assert.deepEqual(first.map(({ actionId }) => actionId), ["a.action", "z.action"]);
  assert.deepEqual(
    Object.keys(actions),
    ["z.action", "a.action"],
    "sorting the runtime projection must not reorder the manifest object"
  );
  assert.equal(Object.isFrozen(first), false);
  assert.equal(Object.isFrozen(first[0]), true);
  assert.equal(Object.isFrozen(first[0]?.allowedSessionRoles), true);
  first.reverse();
  assert.deepEqual(
    second.map(({ actionId }) => actionId),
    ["a.action", "z.action"],
    "mutating a caller-owned array must not alter the cached catalog"
  );
  assert.equal(getManifestActionDefinition(bundle, "a.action"), second[0]);
});

function createAction(
  planRef: string,
  allowedSessionRoles?: Array<"facilitator">
): Record<string, unknown> {
  return {
    invocation: "external",
    definitionHash: `sha256:${"b".repeat(64)}`,
    binding: {
      kind: "mechanics-plan",
      planRef
    },
    allowedSessionRoles
  };
}
