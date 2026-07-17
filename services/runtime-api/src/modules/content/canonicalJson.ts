/**
 * Deterministic JSON serialization for content hashes and command fingerprints.
 *
 * Object keys are sorted by ECMAScript UTF-16 code-unit order at every depth while
 * arrays keep their declared order. Values are first constrained to ordinary
 * JSON, so hashes never depend on JavaScript-only values such as `undefined`,
 * `BigInt`, custom prototypes, or non-finite numbers.
 */

import { createHash } from "node:crypto";

export function canonicalizeJson(value: unknown): string {
  return serializeJson(value, "$", new Set<object>());
}

/** SHA-256 content address for one canonical JSON value. */
export function hashCanonicalJson(value: unknown): string {
  return createHash("sha256").update(canonicalizeJson(value)).digest("hex");
}

function serializeJson(value: unknown, path: string, ancestors: Set<object>): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} contains a non-finite number.`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return withCycleGuard(value, path, ancestors, () =>
      `[${value.map((entry, index) => serializeJson(entry, `${path}[${index}]`, ancestors)).join(",")}]`
    );
  }
  if (isPlainJsonObject(value)) {
    return withCycleGuard(value, path, ancestors, () => {
      const entries = Object.keys(value)
        .sort(compareUtf16CodeUnits)
        .map((key) => `${JSON.stringify(key)}:${serializeJson(value[key], `${path}.${key}`, ancestors)}`);
      return `{${entries.join(",")}}`;
    });
  }
  throw new TypeError(`${path} contains a value that cannot be represented as canonical JSON.`);
}

function withCycleGuard<T extends object>(
  value: T,
  path: string,
  ancestors: Set<object>,
  serialize: () => string
): string {
  if (ancestors.has(value)) {
    throw new TypeError(`${path} contains a cyclic JSON value.`);
  }
  ancestors.add(value);
  try {
    return serialize();
  } finally {
    ancestors.delete(value);
  }
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareUtf16CodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
