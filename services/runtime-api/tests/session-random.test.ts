/** Contract tests for the replay-stable session pseudo-random generator. */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chooseSessionValue,
  createSessionRandomStreamsState,
  createSessionRandomState,
  MAX_SESSION_RANDOM_ADVANCE_WORK,
  readSessionRandomStream,
  rollSessionDice,
  SESSION_RANDOM_ALGORITHM,
  SESSION_RANDOM_STREAMS_ALGORITHM,
  sessionRandomAdvanceWork,
  shuffleSessionValues,
  writeSessionRandomStream
} from "../src/modules/runtime/sessionRandom.ts";

const FIXED_SEED = "0123456789abcdeffedcba9876543210";

const rotateLeft = (value: number, shift: number): number =>
  ((value << shift) | (value >>> (32 - shift))) >>> 0;

/**
 * Test-only copy of the former linear reconstruction.
 *
 * It intentionally does not share the production jump-table implementation:
 * agreement therefore proves that the optimized state after N transitions is
 * still the state produced by N normative xoshiro steps.
 */
const referenceNextUint32 = (words: Array<number>): number => {
  const result = Math.imul(rotateLeft(Math.imul(words[1], 5) >>> 0, 7), 9) >>> 0;
  const shifted = (words[1] << 9) >>> 0;
  words[2] = (words[2] ^ words[0]) >>> 0;
  words[3] = (words[3] ^ words[1]) >>> 0;
  words[1] = (words[1] ^ words[2]) >>> 0;
  words[0] = (words[0] ^ words[3]) >>> 0;
  words[2] = (words[2] ^ shifted) >>> 0;
  words[3] = rotateLeft(words[3], 11);
  return result;
};

const referenceRollAt = (seed: string, counter: number, sides: number): {
  value: number;
  counter: number;
} => {
  let words = [0, 8, 16, 24].map((offset) =>
    Number.parseInt(seed.slice(offset, offset + 8), 16) >>> 0);
  if (words.every((word) => word === 0)) words = [1, 2, 3, 4];
  for (let index = 0; index < counter; index += 1) referenceNextUint32(words);
  const limit = Math.floor(0x1_0000_0000 / sides) * sides;
  let nextCounter = counter;
  while (true) {
    const value = referenceNextUint32(words);
    nextCounter += 1;
    if (value < limit) return { value: value % sides + 1, counter: nextCounter };
  }
};

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

test("logarithmic reconstruction is bit-identical to the former linear replay", () => {
  const seeds = [
    FIXED_SEED,
    "00000000000000000000000000000000",
    "ffffffffffffffffffffffffffffffff"
  ];
  for (const seed of seeds) {
    for (const counter of [0, 1, 2, 31, 32, 33, 255, 4_096, 65_535]) {
      const rolled = rollSessionDice({
        alg: SESSION_RANDOM_ALGORITHM,
        seed,
        counter
      }, "1d1000");
      const expected = referenceRollAt(seed, counter, 1000);
      assert.equal(rolled.result.values[0], expected.value, `${seed} at counter ${counter}`);
      assert.equal(rolled.random.counter, expected.counter);
    }
  }
});

test("safe-integer replay has a fixed 53-level work ceiling charged before sampling", () => {
  const charges: Array<number> = [];
  const shuffled = shuffleSessionValues({
    alg: SESSION_RANDOM_ALGORITHM,
    seed: FIXED_SEED,
    counter: Number.MAX_SAFE_INTEGER
  }, ["only"], {
    charge: (units) => charges.push(units)
  });

  assert.deepEqual(charges, [MAX_SESSION_RANDOM_ADVANCE_WORK]);
  assert.equal(sessionRandomAdvanceWork(Number.MAX_SAFE_INTEGER), 53 * 128);
  assert.equal(shuffled.random.counter, Number.MAX_SAFE_INTEGER);
});

test("a stream at the safe-integer boundary cannot consume another word", () => {
  const state = {
    alg: SESSION_RANDOM_ALGORITHM,
    seed: FIXED_SEED,
    counter: Number.MAX_SAFE_INTEGER
  } as const;

  assert.throws(
    () => chooseSessionValue(state, ["left", "right"]),
    /cannot advance beyond the safe integer limit/u
  );
});

test("a rejected reconstruction budget aborts before random state can advance", () => {
  const state = {
    alg: SESSION_RANDOM_ALGORITHM,
    seed: FIXED_SEED,
    counter: 4_096
  } as const;
  assert.throws(
    () => rollSessionDice(state, "1d6", {
      charge: () => {
        throw new Error("test budget rejected");
      }
    }),
    /test budget rejected/u
  );
  assert.equal(state.counter, 4_096);
});

test("singleton selection consumes neither a word nor reconstruction work", () => {
  const state = {
    alg: SESSION_RANDOM_ALGORITHM,
    seed: FIXED_SEED,
    counter: 123
  } as const;
  const charges: Array<number> = [];
  const selected = chooseSessionValue(state, ["only"], {
    charge: (units) => charges.push(units)
  });

  // `equal(length, 0)` avoids narrowing this mutable array to `never[]`
  // through Node's assertion signature before the shuffle charge is recorded.
  assert.equal(charges.length, 0);
  assert.deepEqual(selected.random, state);

  const shuffled = shuffleSessionValues(state, ["only"], {
    charge: (units) => charges.push(units)
  });
  assert.deepEqual(charges, [sessionRandomAdvanceWork(state.counter)]);
  assert.deepEqual(shuffled.random, state);
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

test("named streams derive independently and persist only their own counters", () => {
  const root = createSessionRandomStreamsState(FIXED_SEED);
  const newsBefore = readSessionRandomStream(root, "deck.news");
  const cargoBefore = readSessionRandomStream(root, "deck.cargo");
  const consumedNews = rollSessionDice(newsBefore, "3d10").random;
  const afterNews = writeSessionRandomStream(root, "deck.news", consumedNews);

  assert.equal(afterNews.alg, SESSION_RANDOM_STREAMS_ALGORITHM);
  assert.notEqual(newsBefore.seed, cargoBefore.seed, "domain-separated stream ids need distinct generator seeds");
  assert.deepEqual(
    readSessionRandomStream(afterNews, "deck.cargo"),
    cargoBefore,
    "consuming one stream must not move another stream's replay position"
  );
  assert.equal(afterNews.counters["deck.news"], consumedNews.counter);
  assert.equal(afterNews.counters["deck.cargo"], undefined);
});

test("named streams reject unsafe keys and cross-stream generator state", () => {
  const root = createSessionRandomStreamsState(FIXED_SEED);
  assert.throws(() => readSessionRandomStream(root, "__proto__"), /stream id/u);
  assert.throws(
    () => writeSessionRandomStream(root, "deck.news", readSessionRandomStream(root, "deck.cargo")),
    /unrelated or rewound/u
  );
});
