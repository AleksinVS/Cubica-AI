/**
 * Command-local server randomness for neutral Mechanics operations.
 *
 * Production uses Node's cryptographic integer source and deliberately keeps
 * no generator state in the game session. Tests may inject a bounded sampler
 * through the internal input object; this is a process-local test seam, not a
 * session profile or a public gameplay capability.
 */
import { randomInt as cryptoRandomInt } from "node:crypto";

export interface DiceRollResult {
  values: Array<number>;
  total: number;
  isDouble: boolean;
}

/** Result of one unbiased choice from a bounded list. */
export interface SessionRandomChoice<T> {
  value: T;
  index: number;
}

/** Internal source used by every neutral random Mechanics operation. */
export interface SessionRandomProvider {
  rollDice(purposeId: string, dice: string): DiceRollResult;
  shuffle<T>(purposeId: string, input: ReadonlyArray<T>): Array<T>;
  choose<T>(purposeId: string, input: ReadonlyArray<T>): SessionRandomChoice<T>;
}

export interface SessionRandomProviderInput {
  /**
   * Internal test seam. Production omits it and uses `node:crypto.randomInt`.
   * The callback must return an integer in `[0, exclusiveUpperBound)`.
   */
  sampleRange?: (exclusiveUpperBound: number) => number;
}

interface ParsedDice {
  count: number;
  sides: number;
}

const UINT32_RANGE = 0x1_0000_0000;
const DICE_PATTERN = /^([1-9][0-9]?)d([1-9][0-9]{0,3})$/u;
const PURPOSE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const FORBIDDEN_RECORD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Validate the authored purpose identifier without giving it persistence semantics. */
export const assertSessionRandomPurposeId = (purposeId: string): void => {
  if (
    !PURPOSE_ID_PATTERN.test(purposeId) ||
    FORBIDDEN_RECORD_KEYS.has(purposeId)
  ) {
    throw new Error("Session random purpose id is invalid");
  }
};

const parseDice = (dice: string): ParsedDice => {
  const match = DICE_PATTERN.exec(dice);
  if (!match) throw new Error(`Invalid dice notation "${dice}"; expected NdM`);
  const count = Number(match[1]);
  const sides = Number(match[2]);
  if (count < 1 || count > 99) throw new Error("Dice count must be between 1 and 99");
  if (sides < 2 || sides > 1000) throw new Error("Dice side count must be between 2 and 1000");
  return { count, sides };
};

/**
 * Build a fresh command-local provider.
 *
 * `crypto.randomInt(max)` performs unbiased bounded sampling. A failed command
 * may consume system entropy, but it leaves no accepted game result; a retry
 * is therefore allowed to choose another value until one transaction commits.
 */
export const createSessionRandomProvider = (
  input: SessionRandomProviderInput = {}
): SessionRandomProvider => {
  const sampleRange = input.sampleRange ?? ((range: number) => cryptoRandomInt(range));

  const sample = (purposeId: string, range: number): number => {
    assertSessionRandomPurposeId(purposeId);
    if (!Number.isSafeInteger(range) || range < 1 || range > UINT32_RANGE) {
      throw new Error("Random range must be a positive safe integer no larger than 2^32");
    }
    const value = sampleRange(range);
    if (!Number.isSafeInteger(value) || value < 0 || value >= range) {
      throw new Error("Server random source returned a value outside its requested range");
    }
    return value;
  };

  return {
    rollDice(purposeId, dice) {
      const parsed = parseDice(dice);
      const values = Array.from(
        { length: parsed.count },
        () => sample(purposeId, parsed.sides) + 1
      );
      return {
        values,
        total: values.reduce((sum, value) => sum + value, 0),
        isDouble: values.length === 2 && values[0] === values[1]
      };
    },
    shuffle<T>(purposeId: string, inputValues: ReadonlyArray<T>): Array<T> {
      assertSessionRandomPurposeId(purposeId);
      const values = [...inputValues];
      for (let index = values.length - 1; index > 0; index -= 1) {
        const swapIndex = sample(purposeId, index + 1);
        [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
      }
      return values;
    },
    choose<T>(purposeId: string, inputValues: ReadonlyArray<T>): SessionRandomChoice<T> {
      assertSessionRandomPurposeId(purposeId);
      if (inputValues.length === 0) {
        throw new Error("Cannot choose a server-random value from an empty list");
      }
      const index = inputValues.length === 1 ? 0 : sample(purposeId, inputValues.length);
      return { value: inputValues[index], index };
    }
  };
};
