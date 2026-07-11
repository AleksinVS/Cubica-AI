/**
 * Replay-stable pseudo-random numbers for deterministic game sessions.
 *
 * The session stores only the algorithm id, a 128-bit seed and the number of
 * consumed 32-bit values. Rebuilding the internal words from that tuple makes
 * a saved snapshot sufficient for exact replay and avoids hidden process state.
 */
import { randomBytes } from "node:crypto";

export const SESSION_RANDOM_ALGORITHM = "xoshiro128ss-v1" as const;

export interface SessionRandomState {
  alg: typeof SESSION_RANDOM_ALGORITHM;
  seed: string;
  counter: number;
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

/** Create a fresh session state; tests may pass a seed to obtain a fixed replay. */
export const createSessionRandomState = (seed = randomBytes(16).toString("hex")): SessionRandomState => {
  parseSeed(seed);
  return {
    alg: SESSION_RANDOM_ALGORITHM,
    seed,
    counter: 0
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
  assertRandomState(state);
  const parsed = parseDice(dice);
  const words = parseSeed(state.seed);

  for (let index = 0; index < state.counter; index += 1) {
    nextUint32(words);
  }

  let counter = state.counter;
  const sampleSide = (): number => {
    const limit = Math.floor(UINT32_RANGE / parsed.sides) * parsed.sides;
    while (true) {
      const sample = nextUint32(words);
      counter += 1;
      if (sample < limit) {
        return (sample % parsed.sides) + 1;
      }
    }
  };

  const values = Array.from({ length: parsed.count }, sampleSide);
  return {
    random: {
      alg: state.alg,
      seed: state.seed,
      counter
    },
    result: {
      values,
      total: values.reduce((sum, value) => sum + value, 0),
      isDouble: values.length === 2 && values[0] === values[1]
    }
  };
};
