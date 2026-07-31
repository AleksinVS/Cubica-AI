/**
 * Contract tests for command-local live randomness.
 *
 * Production uses server entropy. These tests inject a bounded sampler only
 * to prove the neutral provider contract without introducing persisted random
 * state or making gameplay depend on a test seed.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertSessionRandomPurposeId,
  createSessionRandomProvider
} from "../src/modules/runtime/sessionRandom.ts";

test("bounded choose, dice and shuffle forward exact exclusive ranges", () => {
  const requestedRanges: Array<number> = [];
  const samples = [1, 4, 0, 0, 0];
  let sampleIndex = 0;
  const provider = createSessionRandomProvider({
    sampleRange: (range) => {
      requestedRanges.push(range);
      return samples[sampleIndex++]!;
    }
  });

  assert.deepEqual(provider.choose("fixture.choice", ["north", "south", "west"]), {
    value: "south",
    index: 1
  });
  assert.deepEqual(provider.rollDice("fixture.dice", "2d6"), {
    values: [5, 1],
    total: 6,
    isDouble: false
  });
  assert.deepEqual(provider.shuffle("fixture.deck", ["a", "b", "c"]), ["b", "c", "a"]);
  assert.deepEqual(requestedRanges, [3, 6, 6, 3, 2]);
});

test("singleton choice and zero-work shuffles do not call the sampler", () => {
  let calls = 0;
  const provider = createSessionRandomProvider({
    sampleRange: () => {
      calls += 1;
      return 0;
    }
  });

  assert.deepEqual(provider.choose("fixture.singleton", ["only"]), {
    value: "only",
    index: 0
  });
  assert.deepEqual(provider.shuffle("fixture.empty", []), []);
  assert.deepEqual(provider.shuffle("fixture.singleton-shuffle", ["only"]), ["only"]);
  assert.equal(calls, 0);
});

test("the live provider exposes no snapshot or generator-restoration API", () => {
  const provider = createSessionRandomProvider({ sampleRange: () => 0 });

  assert.equal("snapshot" in provider, false);
  assert.equal("restore" in provider, false);
  assert.equal("state" in provider, false);
});

test("invalid purpose identifiers and empty choices are rejected", () => {
  const provider = createSessionRandomProvider({ sampleRange: () => 0 });

  assert.throws(() => assertSessionRandomPurposeId("__proto__"), /purpose id is invalid/u);
  assert.throws(() => provider.choose("fixture choice", ["a"]), /purpose id is invalid/u);
  assert.throws(() => provider.choose("fixture.empty", []), /empty list/u);
});

test("invalid dice notation and bounds are rejected before sampling", () => {
  let calls = 0;
  const provider = createSessionRandomProvider({
    sampleRange: () => {
      calls += 1;
      return 0;
    }
  });

  assert.throws(() => provider.rollDice("fixture.dice", "0d6"), /NdM/u);
  assert.throws(() => provider.rollDice("fixture.dice", "2d1"), /side count/u);
  assert.throws(() => provider.rollDice("fixture.dice", "100d6"), /NdM|count/u);
  assert.throws(() => provider.rollDice("fixture.dice", "1d1001"), /side count/u);
  assert.equal(calls, 0);
});

test("an injected sampler must return an integer inside the requested range", () => {
  for (const invalidSample of [-1, 2, 0.5, Number.NaN]) {
    const provider = createSessionRandomProvider({
      sampleRange: () => invalidSample
    });
    assert.throws(
      () => provider.choose("fixture.choice", ["left", "right"]),
      /outside its requested range/u
    );
  }
});
