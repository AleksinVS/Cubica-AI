/**
 * Canonical replay fingerprints for deterministic gameplay verification.
 *
 * Runtime keeps real wall-clock audit timestamps in session state. They are
 * useful to a facilitator, but two otherwise identical replays naturally run
 * at different moments. This module removes only the two architecture-approved
 * audit paths and serializes every remaining JSON value with sorted object keys
 * before hashing it.
 */

import { createHash } from "node:crypto";

type PathSegment = string | number;

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const shouldOmitAuditField = (path: readonly PathSegment[], key: string): boolean => {
  if (key === "lastUpdatedAt" && path.length === 1 && path[0] === "runtime") {
    return true;
  }

  return key === "at" &&
    path.length === 3 &&
    path[0] === "public" &&
    path[1] === "log" &&
    typeof path[2] === "number";
};

function canonicalize(value: unknown, path: readonly PathSegment[], seen: WeakSet<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Replay state must contain only finite JSON numbers.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new TypeError("Replay state must not contain circular references.");
    }
    seen.add(value);
    const result = value.map((item, index) => canonicalize(item, [...path, index], seen));
    seen.delete(value);
    return result;
  }
  if (isPlainRecord(value)) {
    if (seen.has(value)) {
      throw new TypeError("Replay state must not contain circular references.");
    }
    seen.add(value);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (shouldOmitAuditField(path, key)) {
        continue;
      }
      const child = value[key];
      result[key] = canonicalize(child, [...path, key], seen);
    }
    seen.delete(value);
    return result;
  }

  throw new TypeError(`Replay state contains a non-JSON value at ${path.join(".") || "<root>"}.`);
}

/** Return a detached, key-sorted state with only approved audit timestamps omitted. */
export function canonicalizeReplayState(state: unknown): unknown {
  return canonicalize(state, [], new WeakSet<object>());
}

/** Serialize the replay state deterministically for diagnostics and hashing. */
export function serializeCanonicalReplayState(state: unknown): string {
  return JSON.stringify(canonicalizeReplayState(state));
}

/** Build the architecture-approved SHA-256 fingerprint of gameplay state. */
export function createCanonicalReplayFingerprint(state: unknown): string {
  const digest = createHash("sha256")
    .update(serializeCanonicalReplayState(state), "utf8")
    .digest("hex");
  // The prefix makes future canonicalization changes explicit instead of
  // silently comparing fingerprints produced by different algorithms.
  return `cubica-replay-state-v1:sha256:${digest}`;
}
