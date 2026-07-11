/** Contract tests for the replay-stable session pseudo-random generator. */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createSessionRandomState,
  rollSessionDice,
  SESSION_RANDOM_ALGORITHM
} from "../src/modules/runtime/sessionRandom.ts";

const FIXED_SEED = "0123456789abcdeffedcba9876543210";

test("xoshiro128ss-v1 keeps the published dice vector stable", () => {
  const first = rollSessionDice(createSessionRandomState(FIXED_SEED), "2d6");
  const second = rollSessionDice(first.random, "2d6");
  const third = rollSessionDice(second.random, "3d10");

  assert.deepEqual(first.result, { values: [3, 6], total: 9, isDouble: false });
  assert.deepEqual(second.result, { values: [5, 6], total: 11, isDouble: false });
  assert.deepEqual(third.result, { values: [7, 4, 6], total: 17, isDouble: false });
  assert.deepEqual(third.random, {
    alg: SESSION_RANDOM_ALGORITHM,
    seed: FIXED_SEED,
    counter: 7
  });
});

test("the persisted seed and counter are sufficient to resume the sequence", () => {
  const initial = createSessionRandomState(FIXED_SEED);
  const first = rollSessionDice(initial, "2d6");
  const resumed = rollSessionDice(structuredClone(first.random), "2d6");

  const replayFirst = rollSessionDice(createSessionRandomState(FIXED_SEED), "2d6");
  const replaySecond = rollSessionDice(replayFirst.random, "2d6");

  assert.deepEqual(resumed, replaySecond);
});

test("the forbidden all-zero seed uses the documented fixed non-zero state", () => {
  const roll = rollSessionDice(createSessionRandomState("00000000000000000000000000000000"), "1d6");
  assert.equal(roll.result.values.length, 1);
  assert.equal(roll.result.isDouble, false);
  assert.equal(roll.random.counter, 1);
});

test("invalid dice notation and persisted state fail explicitly", () => {
  assert.throws(() => rollSessionDice(createSessionRandomState(FIXED_SEED), "0d6"), /NdM|count/u);
  assert.throws(() => rollSessionDice(createSessionRandomState(FIXED_SEED), "2d1"), /side count/u);
  assert.throws(
    () => rollSessionDice({ alg: SESSION_RANDOM_ALGORITHM, seed: FIXED_SEED, counter: -1 }, "2d6"),
    /counter/u
  );
});
