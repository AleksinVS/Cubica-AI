/** Focused cache and catalog coverage for runtime action handler registration. */

import assert from "node:assert/strict";
import test from "node:test";

import type { GameBundle } from "../src/modules/content/manifestLoader.ts";
import { createRuntimeActionRegistry } from "../src/modules/runtime/actionRegistry.ts";

const HASH = `sha256:${"a".repeat(64)}`;

test("the default registry is reused per immutable bundle without crossing bundle identity", () => {
  const firstBundle = createBundle();
  const equalButDistinctBundle = createBundle();

  const first = createRuntimeActionRegistry(firstBundle);
  const repeated = createRuntimeActionRegistry(firstBundle);
  const distinct = createRuntimeActionRegistry(equalButDistinctBundle);

  assert.strictEqual(repeated, first, "the normal dispatch path must reuse its derived handler map");
  assert.notStrictEqual(distinct, first, "historic bundles with equal JSON must retain separate handlers");
  assert.deepEqual(first.list(), ["fixture.apply"]);
  assert.equal(first.has("fixture.missing-plan"), false);
});

test("an injected random source receives a fresh registry and cannot poison the default cache", () => {
  const bundle = createBundle();
  const defaultRegistry = createRuntimeActionRegistry(bundle);
  const injected = { sampleRange: () => 0 };

  const firstInjected = createRuntimeActionRegistry(bundle, injected);
  const secondInjected = createRuntimeActionRegistry(bundle, injected);

  // A custom source is command-local. Reusing a closure that captured it in a
  // later command would couple otherwise independent random executions.
  assert.notStrictEqual(firstInjected, defaultRegistry);
  assert.notStrictEqual(secondInjected, firstInjected);
  assert.strictEqual(createRuntimeActionRegistry(bundle), defaultRegistry);
});

function createBundle(): GameBundle {
  return Object.freeze({
    gameId: "runtime-registry-fixture",
    bundleHash: `cubica-bundle-v1:sha256:${"b".repeat(64)}`,
    manifest: Object.freeze({
      actions: Object.freeze({
        "fixture.apply": Object.freeze({
          invocation: "external",
          definitionHash: HASH,
          binding: Object.freeze({ kind: "mechanics-plan", planRef: "fixture.apply" })
        }),
        "fixture.missing-plan": Object.freeze({
          invocation: "external",
          definitionHash: HASH,
          binding: Object.freeze({ kind: "mechanics-plan", planRef: "fixture.missing-plan" })
        })
      }),
      mechanics: Object.freeze({
        plans: Object.freeze({
          "fixture.apply": Object.freeze({
            planHash: HASH,
            transaction: Object.freeze({ steps: Object.freeze([]) })
          })
        })
      })
    })
  }) as unknown as GameBundle;
}
