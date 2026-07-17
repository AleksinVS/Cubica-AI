/** Contract tests for the replay-stable session pseudo-random generator. */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createSessionRandomStreamsState,
  createSessionRandomState,
  readSessionRandomStream,
  rollSessionDice,
  SESSION_RANDOM_ALGORITHM,
  SESSION_RANDOM_STREAMS_ALGORITHM,
  writeSessionRandomStream
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
