/**
 * Versioned, byte-exact identity for immutable game-rule bundles.
 *
 * JSONB is convenient for database inspection, but it is not a byte-preserving
 * format: key order and number spelling may change. Receipts therefore pin a
 * self-describing hash of the exact canonical UTF-8 bytes stored beside the
 * parsed JSON copy. Historical receipt reads verify those bytes directly and
 * never ask the current canonicalizer to recreate them.
 */

import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { CreateImmutableGameBundleInput, ImmutableGameBundle } from "@cubica/contracts-session";
import { canonicalizeJson, hashCanonicalJson } from "./canonicalJson.ts";

export const BUNDLE_FORMAT_VERSION = "cubica-bundle-v1" as const;
export const BUNDLE_CANONICALIZATION_ID = "cubica-json-utf16-v1" as const;
export const BUNDLE_HASH_ALGORITHM = "sha256" as const;
export const BUNDLE_HASH_PATTERN = /^cubica-bundle-v1:sha256:[a-f0-9]{64}$/u;

const BUNDLE_COMPILER_CONTRACT = Object.freeze({
  id: "cubica.runtime-bundle-compiler",
  version: "1.0.0",
  envelopeFields: [
    "bundleFormatVersion",
    "canonicalizationId",
    "hashAlgorithm",
    "compilerLock",
    "gameId",
    "manifest"
  ],
  canonicalizationId: BUNDLE_CANONICALIZATION_ID
});

/** Exact compiler contract used when a new session bundle is materialized. */
export const CURRENT_BUNDLE_COMPILER_LOCK = Object.freeze({
  id: BUNDLE_COMPILER_CONTRACT.id,
  version: BUNDLE_COMPILER_CONTRACT.version,
  artifactHash: `sha256:${hashCanonicalJson(BUNDLE_COMPILER_CONTRACT)}`
});

export interface VerifiedImmutableBundleContent {
  gameId: string;
  manifest: Record<string, unknown>;
}

/** Create the immutable store payload for newly published content. */
export function createImmutableBundleContent(
  gameId: string,
  manifest: Record<string, unknown>
): CreateImmutableGameBundleInput {
  const canonicalBundle = {
    bundleFormatVersion: BUNDLE_FORMAT_VERSION,
    canonicalizationId: BUNDLE_CANONICALIZATION_ID,
    hashAlgorithm: BUNDLE_HASH_ALGORITHM,
    compilerLock: CURRENT_BUNDLE_COMPILER_LOCK,
    gameId,
    manifest: structuredClone(manifest)
  };
  const canonicalBytes = new TextEncoder().encode(canonicalizeJson(canonicalBundle));
  return {
    bundleHash: hashBundleBytes(canonicalBytes),
    gameId,
    canonicalBytes,
    canonicalBundle
  };
}

/**
 * Verify stored identity and recover its parsed content.
 *
 * `requireCurrentCanonicalForm` is used only at insertion. Historical reads
 * deliberately leave it false: the stored bytes are authoritative after their
 * hash and envelope have been verified, so a future canonicalizer change does
 * not invalidate an old receipt.
 */
export function verifyImmutableBundleContent(
  stored: Pick<ImmutableGameBundle, "bundleHash" | "gameId" | "canonicalBytes" | "canonicalBundle">,
  requireCurrentCanonicalForm = false
): VerifiedImmutableBundleContent {
  if (!BUNDLE_HASH_PATTERN.test(stored.bundleHash) || !(stored.canonicalBytes instanceof Uint8Array)) {
    throw new TypeError("Immutable bundle identity is malformed.");
  }
  if (hashBundleBytes(stored.canonicalBytes) !== stored.bundleHash) {
    throw new TypeError("Immutable bundle bytes do not match their content address.");
  }

  let canonicalText: string;
  let parsed: unknown;
  try {
    canonicalText = new TextDecoder("utf-8", { fatal: true }).decode(stored.canonicalBytes);
    parsed = JSON.parse(canonicalText) as unknown;
  } catch {
    throw new TypeError("Immutable bundle bytes are not valid UTF-8 JSON.");
  }
  if (!isRecord(parsed) || !isDeepStrictEqual(parsed, stored.canonicalBundle)) {
    throw new TypeError("Immutable bundle JSON copy differs from its canonical bytes.");
  }
  if (requireCurrentCanonicalForm && canonicalizeJson(parsed) !== canonicalText) {
    throw new TypeError("Immutable bundle bytes do not use the declared canonical form.");
  }

  if (
    parsed.bundleFormatVersion !== BUNDLE_FORMAT_VERSION ||
    parsed.canonicalizationId !== BUNDLE_CANONICALIZATION_ID ||
    parsed.hashAlgorithm !== BUNDLE_HASH_ALGORITHM ||
    parsed.gameId !== stored.gameId ||
    !isCompilerLock(parsed.compilerLock) ||
    !isRecord(parsed.manifest)
  ) {
    throw new TypeError("Immutable bundle envelope is unsupported or inconsistent.");
  }
  return { gameId: parsed.gameId, manifest: parsed.manifest };
}

export function isValidImmutableBundleInput(
  stored: Pick<ImmutableGameBundle, "bundleHash" | "gameId" | "canonicalBytes" | "canonicalBundle">
): boolean {
  try {
    verifyImmutableBundleContent(stored, true);
    return true;
  } catch {
    return false;
  }
}

function hashBundleBytes(bytes: Uint8Array): string {
  const digest = createHash(BUNDLE_HASH_ALGORITHM).update(bytes).digest("hex");
  return `${BUNDLE_FORMAT_VERSION}:${BUNDLE_HASH_ALGORITHM}:${digest}`;
}

function isCompilerLock(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.id === "string" && value.id.length > 0 &&
    typeof value.version === "string" && /^\d+\.\d+\.\d+$/u.test(value.version) &&
    typeof value.artifactHash === "string" && /^sha256:[a-f0-9]{64}$/u.test(value.artifactHash);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
