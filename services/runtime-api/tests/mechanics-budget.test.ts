/**
 * Neutral safety tests for bounded JSON resource measurement.
 *
 * Primitive measurement may be memoized within one call, but object identity,
 * aliases, accessors and branches beyond the cache cap must still be visited.
 * These cases protect the fail-closed state boundary independently of any game.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  createJsonPrimitiveMeasurementCache,
  measureBoundedJson,
  type JsonPrimitiveMeasurementCache,
  type JsonResourceLimits
} from "../src/modules/mechanics/budget.ts";
import { MechanicsExecutionError } from "../src/modules/mechanics/errors.ts";

const permissiveLimits: JsonResourceLimits = {
  maxBytes: 1_000_000,
  maxDepth: 32,
  maxNodes: 10_000,
  maxStringUtf8Bytes: 16_384
};

test("repeated primitives and aliased objects retain exact JSON resource usage", () => {
  const shared = { status: "ready", count: 7 };
  const value = {
    first: shared,
    second: shared,
    repeated: ["ready", "ready", 7, 7]
  };

  const usage = measureBoundedJson(value, permissiveLimits);

  // JSON serialization duplicates aliased object content, and the bounded walk
  // must charge it in the same way even though primitive byte lengths are
  // reused internally.
  assert.equal(usage.bytes, Buffer.byteLength(JSON.stringify(value), "utf8"));
  assert.deepEqual(usage, {
    bytes: Buffer.byteLength(JSON.stringify(value), "utf8"),
    nodes: 12,
    depth: 2
  });
});

test("an accessor is reread through each alias and cannot inherit an object verdict", () => {
  let reads = 0;
  const shared: Record<string, unknown> = {};
  Object.defineProperty(shared, "status", {
    enumerable: true,
    get: () => {
      reads += 1;
      return reads === 1 ? "ok" : "x".repeat(33);
    }
  });

  assert.throws(
    () => measureBoundedJson(
      { first: shared, second: shared },
      { ...permissiveLimits, maxStringUtf8Bytes: 32 }
    ),
    (error: unknown) =>
      error instanceof MechanicsExecutionError &&
      error.code === "MECHANICS_VALUE_RESOURCE_LIMIT"
  );
  assert.equal(reads, 2);
});

test("branches after the primitive cache cap are still fully validated", () => {
  const value = Object.fromEntries([
    ...Array.from({ length: 1_025 }, (_, index) => [
      `key-${index}`,
      `value-${index}`
    ]),
    ["oversized", "x".repeat(33)]
  ]);

  assert.throws(
    () => measureBoundedJson(
      value,
      { ...permissiveLimits, maxStringUtf8Bytes: 32 }
    ),
    (error: unknown) =>
      error instanceof MechanicsExecutionError &&
      error.code === "MECHANICS_VALUE_RESOURCE_LIMIT"
  );
});

test("shared primitive measurements never become a resource-limit verdict", () => {
  const primitiveMeasurements = createJsonPrimitiveMeasurementCache();
  assert.doesNotThrow(() => measureBoundedJson(
    { status: "ready" },
    permissiveLimits,
    "MECHANICS_VALUE_RESOURCE_LIMIT",
    primitiveMeasurements
  ));

  // The encoding cost may be reused, but the current call's stricter limit is
  // checked again. Retaining this primitive-only memo cannot admit the value.
  assert.throws(
    () => measureBoundedJson(
      { status: "ready" },
      { ...permissiveLimits, maxStringUtf8Bytes: 4 },
      "MECHANICS_VALUE_RESOURCE_LIMIT",
      primitiveMeasurements
    ),
    (error: unknown) =>
      error instanceof MechanicsExecutionError &&
      error.code === "MECHANICS_VALUE_RESOURCE_LIMIT"
  );

  // A direct caller cannot inject made-up byte lengths. Only the opaque object
  // minted by the module has an entry in the private WeakMap.
  const forged = {
    strings: new Map([["ready", { utf8Bytes: 1, jsonBytes: 1 }]]),
    numbers: new Map()
  } as unknown as JsonPrimitiveMeasurementCache;
  assert.throws(
    () => measureBoundedJson(
      { status: "ready" },
      { ...permissiveLimits, maxStringUtf8Bytes: 4 },
      "MECHANICS_VALUE_RESOURCE_LIMIT",
      forged
    ),
    (error: unknown) =>
      error instanceof MechanicsExecutionError &&
      error.code === "MECHANICS_VALUE_RESOURCE_LIMIT"
  );
});
