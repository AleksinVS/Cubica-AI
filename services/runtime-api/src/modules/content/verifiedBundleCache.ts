/**
 * Bounded process-local cache for immutable game bundles that have already
 * crossed a complete trust boundary.
 *
 * The durable SessionStore remains the source of truth. A cache hit is allowed
 * only when the caller-provided store record still matches the independently
 * verified bytes, game id and parsed JSON envelope retained by this cache.
 * This deliberately keeps a cheap identity check on every hit: trusting only
 * the claimed content hash would let a mutated in-memory store object bypass
 * the integrity checks that protected the original admission.
 */

import { isDeepStrictEqual } from "node:util";
import type { ImmutableGameBundle } from "@cubica/contracts-session";
import type { GameBundle } from "./manifestLoader.ts";

export const VERIFIED_BUNDLE_CACHE_MAX_ENTRIES = 32;
export const VERIFIED_BUNDLE_CACHE_MAX_CANONICAL_BYTES = 16 * 1024 * 1024;

type StoredBundleIdentity = Pick<
  ImmutableGameBundle,
  "bundleHash" | "gameId" | "canonicalBytes" | "canonicalBundle"
>;

interface VerifiedBundleCacheEntry {
  /** Independent byte copy: later mutation of the store object cannot alter the baseline. */
  canonicalBytes: Uint8Array;
  /** Parsed from verified bytes, rather than borrowed from the mutable store record. */
  canonicalBundle: Record<string, unknown>;
  gameId: string;
  bundle: GameBundle;
}

/**
 * A small least-recently-used cache.
 *
 * JavaScript `Map` preserves insertion order. Hits are moved to the end and
 * capacity eviction removes the first key, which is therefore the least
 * recently used entry. Entry count and canonical-byte limits are independent:
 * the former bounds bookkeeping overhead while the latter prevents a handful
 * of unusually large bundles from consuming unbounded process memory.
 */
class VerifiedBundleCache {
  readonly #entries = new Map<string, VerifiedBundleCacheEntry>();
  #canonicalBytesTotal = 0;

  get(stored: StoredBundleIdentity): GameBundle | undefined {
    const entry = this.#entries.get(stored.bundleHash);
    if (!entry) {
      return undefined;
    }

    if (
      entry.gameId !== stored.gameId ||
      !bytesEqual(entry.canonicalBytes, stored.canonicalBytes) ||
      !isDeepStrictEqual(entry.canonicalBundle, stored.canonicalBundle)
    ) {
      throw new TypeError(
        "Immutable bundle store record changed after the same content address was verified."
      );
    }

    // Refresh insertion order so the oldest remaining key is the LRU victim.
    this.#entries.delete(stored.bundleHash);
    this.#entries.set(stored.bundleHash, entry);
    return entry.bundle;
  }

  set(
    stored: StoredBundleIdentity,
    canonicalBundle: Record<string, unknown>,
    bundle: GameBundle
  ): void {
    this.#delete(stored.bundleHash);

    // Admission and cacheability are separate decisions. A valid bundle that
    // exceeds the process-local acceleration budget remains usable; the
    // caller simply performs full verification again on its next access.
    if (stored.canonicalBytes.byteLength > VERIFIED_BUNDLE_CACHE_MAX_CANONICAL_BYTES) {
      return;
    }

    const canonicalBytes = stored.canonicalBytes.slice();
    this.#entries.set(stored.bundleHash, {
      canonicalBytes,
      // `toImmutableGameBundle` returns its envelope to the durable store
      // after seeding this cache. Retaining the same object would let a later
      // store-adapter mutation also rewrite the cache baseline, making two
      // aliases appear equal even though neither matches the protected bytes.
      canonicalBundle: structuredClone(canonicalBundle),
      gameId: stored.gameId,
      bundle
    });
    this.#canonicalBytesTotal += canonicalBytes.byteLength;

    while (
      this.#entries.size > VERIFIED_BUNDLE_CACHE_MAX_ENTRIES ||
      this.#canonicalBytesTotal > VERIFIED_BUNDLE_CACHE_MAX_CANONICAL_BYTES
    ) {
      const leastRecentlyUsedKey = this.#entries.keys().next().value as string | undefined;
      if (leastRecentlyUsedKey !== undefined) {
        this.#delete(leastRecentlyUsedKey);
      }
    }
  }

  clear(): void {
    this.#entries.clear();
    this.#canonicalBytesTotal = 0;
  }

  #delete(bundleHash: string): void {
    const entry = this.#entries.get(bundleHash);
    if (!entry) {
      return;
    }
    this.#entries.delete(bundleHash);
    this.#canonicalBytesTotal -= entry.canonicalBytes.byteLength;
  }
}

/**
 * Receipt replay and current execution intentionally have separate admission
 * domains. Integrity-valid historic content may enter the former, but only a
 * bundle admitted by today's schema/module/semantic validation enters the
 * latter.
 */
export const currentExecutableBundleCache = new VerifiedBundleCache();
export const historicReceiptBundleCache = new VerifiedBundleCache();

/**
 * Internal test seam. This module is not re-exported by the runtime package
 * root, so production callers receive no cache-management API.
 */
export function clearVerifiedBundleCachesForTesting(): void {
  currentExecutableBundleCache.clear();
  historicReceiptBundleCache.clear();
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (!(right instanceof Uint8Array) || left.byteLength !== right.byteLength) {
    return false;
  }
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}
