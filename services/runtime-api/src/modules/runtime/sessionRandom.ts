/**
 * Replay-stable pseudo-random numbers for deterministic game sessions.
 *
 * `SessionRandomState` is the low-level state of one xoshiro128** generator.
 * Runtime snapshots persist `SessionRandomStreamsState`: one cryptographic
 * master seed plus a counter per named stream. A stream seed is derived only
 * from the master seed and its stable id, so consuming one mechanic's stream
 * cannot perturb dice, decks or route tie-breaking owned by another mechanic.
 */
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const mechanicsLimits = require("../../../../../scripts/manifest-tools/mechanics-modules.cjs") as {
  MAX_SESSION_RANDOM_STREAMS: number;
};

export const SESSION_RANDOM_ALGORITHM = "xoshiro128ss-v1" as const;
export const SESSION_RANDOM_STREAMS_ALGORITHM = "xoshiro128ss-streams-v1" as const;
/** Shared publication/runtime capacity of the persisted named-stream map. */
export const MAX_SESSION_RANDOM_STREAMS = mechanicsLimits.MAX_SESSION_RANDOM_STREAMS;

export interface SessionRandomState {
  alg: typeof SESSION_RANDOM_ALGORITHM;
  seed: string;
  counter: number;
}

/** Persisted root for independently advancing, replay-stable named streams. */
export interface SessionRandomStreamsState {
  alg: typeof SESSION_RANDOM_STREAMS_ALGORITHM;
  seed: string;
  counters: Record<string, number>;
}

export interface DiceRollResult {
  values: Array<number>;
  total: number;
  isDouble: boolean;
}

interface ParsedDice {
  count: number;
  sides: number;
}

const UINT32_RANGE = 0x1_0000_0000;
const SEED_PATTERN = /^[0-9a-f]{32}$/u;
const DICE_PATTERN = /^([1-9][0-9]?)d([1-9][0-9]{0,3})$/u;
const STREAM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const FORBIDDEN_RECORD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const STREAM_DERIVATION_DOMAIN = Buffer.from("cubica.random-stream/v1", "utf8");

const rotateLeft = (value: number, shift: number): number =>
  ((value << shift) | (value >>> (32 - shift))) >>> 0;

/** One normative xoshiro128** step; mutates the four-word working state. */
const nextUint32 = (words: Array<number>): number => {
  const result = Math.imul(rotateLeft(Math.imul(words[1], 5) >>> 0, 7), 9) >>> 0;
  const t = (words[1] << 9) >>> 0;

  words[2] = (words[2] ^ words[0]) >>> 0;
  words[3] = (words[3] ^ words[1]) >>> 0;
  words[1] = (words[1] ^ words[2]) >>> 0;
  words[0] = (words[0] ^ words[3]) >>> 0;
  words[2] = (words[2] ^ t) >>> 0;
  words[3] = rotateLeft(words[3], 11);

  return result;
};

const parseSeed = (seed: string): Array<number> => {
  if (!SEED_PATTERN.test(seed)) {
    throw new Error("Session random seed must contain exactly 32 lowercase hexadecimal characters");
  }

  const words = [0, 8, 16, 24].map((offset) => Number.parseInt(seed.slice(offset, offset + 8), 16) >>> 0);
  // xoshiro has one forbidden all-zero state. The fixed replacement is part of
  // the public replay contract, so changing it would require a new algorithm id.
  return words.every((word) => word === 0) ? [1, 2, 3, 4] : words;
};

const parseDice = (dice: string): ParsedDice => {
  const match = DICE_PATTERN.exec(dice);
  if (!match) {
    throw new Error(`Dice notation "${dice}" must use NdM`);
  }

  const count = Number(match[1]);
  const sides = Number(match[2]);
  if (!Number.isSafeInteger(count) || count < 1 || count > 99) {
    throw new Error("Dice count must be an integer from 1 to 99");
  }
  if (!Number.isSafeInteger(sides) || sides < 2 || sides > 1000) {
    throw new Error("Dice side count must be an integer from 2 to 1000");
  }

  return { count, sides };
};

const assertRandomState = (state: SessionRandomState) => {
  if (state.alg !== SESSION_RANDOM_ALGORITHM) {
    throw new Error(`Unsupported session random algorithm "${String(state.alg)}"`);
  }
  if (!Number.isSafeInteger(state.counter) || state.counter < 0) {
    throw new Error("Session random counter must be a non-negative safe integer");
  }
};

/** Validate one static stream id before it is used as a persisted map key. */
export const assertSessionRandomStreamId = (streamId: string): void => {
  if (!STREAM_ID_PATTERN.test(streamId) || FORBIDDEN_RECORD_KEYS.has(streamId)) {
    throw new Error(`Session random stream id "${streamId}" is invalid`);
  }
};

/** Fail closed when a snapshot carries malformed or unsupported stream state. */
const assertRandomStreamsState = (state: SessionRandomStreamsState): void => {
  if (state.alg !== SESSION_RANDOM_STREAMS_ALGORITHM) {
    throw new Error(`Unsupported session random streams algorithm "${String(state.alg)}"`);
  }
  parseSeed(state.seed);
  if (typeof state.counters !== "object" || state.counters === null || Array.isArray(state.counters)) {
    throw new Error("Session random stream counters must be an object");
  }
  const counters = Object.entries(state.counters);
  if (counters.length > MAX_SESSION_RANDOM_STREAMS) {
    throw new Error(`Session random state exceeds the ${MAX_SESSION_RANDOM_STREAMS} stream limit`);
  }
  for (const [streamId, counter] of counters) {
    assertSessionRandomStreamId(streamId);
    if (!Number.isSafeInteger(counter) || counter < 0) {
      throw new Error(`Session random stream "${streamId}" counter must be a non-negative safe integer`);
    }
  }
};

/**
 * Add an unambiguous length-prefixed field to the derivation hash.
 *
 * Explicit buffers avoid environment-dependent string encodings. Length
 * framing prevents two differently split fields from producing the same hash
 * input, while the fixed domain keeps this derivation separate from every
 * other SHA-256 use in the platform.
 */
const updateFramedHash = (
  hash: ReturnType<typeof createHash>,
  bytes: Uint8Array
): void => {
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.byteLength, 0);
  hash.update(length);
  hash.update(bytes);
};

/** Derive the private 128-bit xoshiro seed for exactly one named stream. */
const deriveSessionRandomStreamSeed = (masterSeed: string, streamId: string): string => {
  parseSeed(masterSeed);
  assertSessionRandomStreamId(streamId);
  const hash = createHash("sha256");
  updateFramedHash(hash, STREAM_DERIVATION_DOMAIN);
  updateFramedHash(hash, Buffer.from(masterSeed, "hex"));
  updateFramedHash(hash, Buffer.from(streamId, "utf8"));
  return hash.digest("hex").slice(0, 32);
};

/**
 * Rebuild the deterministic generator at the persisted counter and expose one
 * unbiased integer sampler. Keeping this logic shared prevents dice and deck
 * operations from advancing the replay counter differently.
 */
const createRangeSampler = (state: SessionRandomState) => {
  assertRandomState(state);
  const words = parseSeed(state.seed);
  for (let index = 0; index < state.counter; index += 1) {
    nextUint32(words);
  }

  let counter = state.counter;
  const sample = (range: number): number => {
    if (!Number.isSafeInteger(range) || range < 1 || range > UINT32_RANGE) {
      throw new Error("Random range must be a positive safe integer no larger than 2^32");
    }
    const limit = Math.floor(UINT32_RANGE / range) * range;
    while (true) {
      const value = nextUint32(words);
      counter += 1;
      if (value < limit) return value % range;
    }
  };

  return {
    sample,
    snapshot: (): SessionRandomState => ({ alg: state.alg, seed: state.seed, counter })
  };
};

/** Create a fresh session state; tests may pass a seed to obtain a fixed replay. */
export const createSessionRandomState = (seed = randomBytes(16).toString("hex")): SessionRandomState => {
  parseSeed(seed);
  return {
    alg: SESSION_RANDOM_ALGORITHM,
    seed,
    counter: 0
  };
};

/** Create the persisted root used by all named random consumers in a session. */
export const createSessionRandomStreamsState = (
  seed = randomBytes(16).toString("hex")
): SessionRandomStreamsState => {
  parseSeed(seed);
  return {
    alg: SESSION_RANDOM_STREAMS_ALGORITHM,
    seed,
    counters: {}
  };
};

/** Reconstruct one low-level generator without mutating the persisted root. */
export const readSessionRandomStream = (
  state: SessionRandomStreamsState,
  streamId: string
): SessionRandomState => {
  assertRandomStreamsState(state);
  assertSessionRandomStreamId(streamId);
  const counter = Object.prototype.hasOwnProperty.call(state.counters, streamId)
    ? state.counters[streamId]
    : 0;
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new Error(`Session random stream "${streamId}" counter must be a non-negative safe integer`);
  }
  return {
    alg: SESSION_RANDOM_ALGORITHM,
    seed: deriveSessionRandomStreamSeed(state.seed, streamId),
    counter
  };
};

/**
 * Persist the next counter for one stream and leave every other stream intact.
 * The derived seed is verified as well as the counter so callers cannot write
 * a generator from another stream into this stream's replay history.
 */
export const writeSessionRandomStream = (
  state: SessionRandomStreamsState,
  streamId: string,
  random: SessionRandomState
): SessionRandomStreamsState => {
  const current = readSessionRandomStream(state, streamId);
  assertRandomState(random);
  if (random.seed !== current.seed || random.counter < current.counter) {
    throw new Error(`Session random stream "${streamId}" cannot accept unrelated or rewound state`);
  }
  if (!Object.prototype.hasOwnProperty.call(state.counters, streamId) &&
      Object.keys(state.counters).length >= MAX_SESSION_RANDOM_STREAMS) {
    throw new Error(`Session random state exceeds the ${MAX_SESSION_RANDOM_STREAMS} stream limit`);
  }
  return {
    alg: state.alg,
    seed: state.seed,
    counters: { ...state.counters, [streamId]: random.counter }
  };
};

/**
 * Roll dice without modulo bias and return the next persisted random state.
 * Every rejected sample still advances `counter`, which is essential for replay.
 */
export const rollSessionDice = (
  state: SessionRandomState,
  dice: string
): { random: SessionRandomState; result: DiceRollResult } => {
  const parsed = parseDice(dice);
  const sampler = createRangeSampler(state);
  const sampleSide = (): number => {
    return sampler.sample(parsed.sides) + 1;
  };

  const values = Array.from({ length: parsed.count }, sampleSide);
  return {
    random: sampler.snapshot(),
    result: {
      values,
      total: values.reduce((sum, value) => sum + value, 0),
      isDouble: values.length === 2 && values[0] === values[1]
    }
  };
};

/**
 * Fisher–Yates shuffle backed by the persisted session PRNG. The input is not
 * mutated, and every chosen index advances the same replay counter as dice.
 */
export const shuffleSessionValues = <T>(
  state: SessionRandomState,
  input: ReadonlyArray<T>
): { random: SessionRandomState; values: Array<T> } => {
  const sampler = createRangeSampler(state);
  const values = [...input];
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = sampler.sample(index + 1);
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
  return { random: sampler.snapshot(), values };
};

/**
 * Choose one value with the same persisted, unbiased generator used by dice
 * and decks. A singleton deliberately consumes no random word: deterministic
 * operations must not perturb later replay merely because they used this
 * generic helper.
 */
export const chooseSessionValue = <T>(
  state: SessionRandomState,
  input: ReadonlyArray<T>
): { random: SessionRandomState; value: T; index: number } => {
  assertRandomState(state);
  if (input.length === 0) throw new Error("Cannot choose a session-random value from an empty list");
  if (input.length === 1) return { random: { ...state }, value: input[0], index: 0 };
  const sampler = createRangeSampler(state);
  const index = sampler.sample(input.length);
  return { random: sampler.snapshot(), value: input[index], index };
};
