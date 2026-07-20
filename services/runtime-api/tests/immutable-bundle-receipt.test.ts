/** Regression coverage for receipt replay across runtime module upgrades. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, test } from "node:test";

import type { ImmutableGameBundle } from "@cubica/contracts-session";
import { createImmutableBundleContent } from "../src/modules/content/immutableBundle.ts";
import type { GameBundle } from "../src/modules/content/manifestLoader.ts";
import {
  loadImmutableGameBundle,
  loadImmutableGameBundleForReceipt,
  toImmutableGameBundle
} from "../src/modules/content/manifestLoader.ts";
import {
  clearVerifiedBundleCachesForTesting,
  currentExecutableBundleCache,
  historicReceiptBundleCache,
  VERIFIED_BUNDLE_CACHE_MAX_CANONICAL_BYTES,
  VERIFIED_BUNDLE_CACHE_MAX_ENTRIES
} from "../src/modules/content/verifiedBundleCache.ts";

beforeEach(() => {
  clearVerifiedBundleCachesForTesting();
});

test("an integrity-valid historic bundle remains readable for an exact receipt retry", async () => {
  const manifest = JSON.parse(await readFile(
    new URL("../../../games/simple-choice/game.manifest.json", import.meta.url),
    "utf8"
  )) as Record<string, any>;

  // Model a real historic bundle whose exact module artifact is no longer in
  // the active registry. Its own content hash remains valid and immutable.
  manifest.mechanics.moduleLock["cubica.core"].artifactHash = `sha256:${"0".repeat(64)}`;
  const immutable = createImmutableBundleContent("simple-choice", manifest);
  const stored: ImmutableGameBundle = {
    ...immutable,
    createdAt: new Date()
  };

  assert.throws(
    () => loadImmutableGameBundle(stored),
    /module|artifact|hash/iu,
    "new commands must not run when their exact executor artifact is unavailable"
  );
  const replayBundle = loadImmutableGameBundleForReceipt(stored);
  const cachedReplayBundle = loadImmutableGameBundleForReceipt({
    ...stored,
    canonicalBytes: stored.canonicalBytes.slice(),
    canonicalBundle: structuredClone(stored.canonicalBundle)
  });
  assert.equal(replayBundle.bundleHash, stored.bundleHash);
  assert.equal(replayBundle.manifest.meta.id, "simple-choice");
  assert.strictEqual(cachedReplayBundle, replayBundle);

  // Receipt admission is deliberately not execution admission. Even after a
  // historic bundle is cached for ledger replay, current module validation
  // still runs and rejects it for a new command.
  assert.throws(
    () => loadImmutableGameBundle(stored),
    /module|artifact|hash/iu
  );
});

test("receipt replay never bypasses immutable bundle integrity", async () => {
  const manifest = JSON.parse(await readFile(
    new URL("../../../games/simple-choice/game.manifest.json", import.meta.url),
    "utf8"
  )) as Record<string, any>;
  const immutable = createImmutableBundleContent("simple-choice", manifest);
  const stored: ImmutableGameBundle = {
    ...immutable,
    createdAt: new Date()
  };
  (stored.canonicalBundle as any).manifest.meta.name = "tampered after hashing";

  assert.throws(
    () => loadImmutableGameBundleForReceipt(stored),
    /integrity|canonical bytes/iu
  );
});

test("a cached receipt bundle still rejects a changed store record", async () => {
  const stored = await loadStoredSimpleChoiceBundle();
  loadImmutableGameBundleForReceipt(stored);
  const canonicalBundle = structuredClone(stored.canonicalBundle) as any;
  canonicalBundle.manifest.meta.name = "tampered after receipt cache admission";

  assert.throws(
    () => loadImmutableGameBundleForReceipt({ ...stored, canonicalBundle }),
    /integrity|changed after.*verified/iu
  );
});

test("a fully admitted current bundle is reused without exposing mutable shared state", async () => {
  const stored = await loadStoredSimpleChoiceBundle();
  const first = loadImmutableGameBundle(stored);
  const second = loadImmutableGameBundle({
    ...stored,
    canonicalBytes: stored.canonicalBytes.slice(),
    canonicalBundle: structuredClone(stored.canonicalBundle)
  });

  // Returning the same frozen object proves the second call took the verified
  // cache path rather than parsing and validating a new manifest object.
  assert.strictEqual(second, first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.manifest), true);
  assert.equal(Object.isFrozen(first.manifest.actions), true);
  assert.throws(() => {
    (first.manifest.meta as { name: string }).name = "mutated";
  }, TypeError);
});

test("session materialization seeds the current cache for the first action", async () => {
  const admitted = loadImmutableGameBundle(await loadStoredSimpleChoiceBundle());
  clearVerifiedBundleCachesForTesting();
  const stored: ImmutableGameBundle = {
    ...toImmutableGameBundle(admitted),
    createdAt: new Date()
  };

  assert.strictEqual(
    loadImmutableGameBundle(stored),
    admitted,
    "the exact bundle persisted for a new session was already fully admitted"
  );
});

test("a prewarmed cache keeps an independent JSON baseline", async () => {
  const admitted = loadImmutableGameBundle(await loadStoredSimpleChoiceBundle());
  clearVerifiedBundleCachesForTesting();
  const stored: ImmutableGameBundle = {
    ...toImmutableGameBundle(admitted),
    createdAt: new Date()
  };

  (stored.canonicalBundle as any).manifest.meta.name = "mutated after prewarm";

  assert.throws(
    () => loadImmutableGameBundle(stored),
    /integrity|changed after.*verified/iu,
    "mutating the store-owned JSON copy must not mutate the cache baseline"
  );
});

test("a cache hit rejects changed bytes under the same claimed bundle hash", async () => {
  const stored = await loadStoredSimpleChoiceBundle();
  loadImmutableGameBundle(stored);
  const tamperedBytes = stored.canonicalBytes.slice();
  tamperedBytes[tamperedBytes.byteLength - 1] ^= 1;

  assert.throws(
    () => loadImmutableGameBundle({ ...stored, canonicalBytes: tamperedBytes }),
    /integrity|changed after.*verified/iu
  );
});

test("a cache hit rejects a changed JSON copy under the same claimed bundle hash", async () => {
  const stored = await loadStoredSimpleChoiceBundle();
  loadImmutableGameBundle(stored);
  const canonicalBundle = structuredClone(stored.canonicalBundle) as any;
  canonicalBundle.manifest.meta.name = "tampered cached copy";

  assert.throws(
    () => loadImmutableGameBundle({ ...stored, canonicalBundle }),
    /integrity|changed after.*verified/iu
  );
});

test("a cache hit rejects a changed game id under the same claimed bundle hash", async () => {
  const stored = await loadStoredSimpleChoiceBundle();
  loadImmutableGameBundle(stored);

  assert.throws(
    () => loadImmutableGameBundle({ ...stored, gameId: "other-game" }),
    /integrity|changed after.*verified/iu
  );
});

test("the receipt cache evicts the least recently used bundle at its fixed bound", async () => {
  const manifest = await readSimpleChoiceManifest();
  const storedBundles = Array.from(
    { length: VERIFIED_BUNDLE_CACHE_MAX_ENTRIES + 1 },
    (_, index) => toStoredBundle(`cache-fixture-${index}`, manifest)
  );
  const loaded = storedBundles
    .slice(0, VERIFIED_BUNDLE_CACHE_MAX_ENTRIES)
    .map((stored) => loadImmutableGameBundleForReceipt(stored));

  // Refresh zero so bundle one becomes the least recently used entry.
  assert.strictEqual(
    loadImmutableGameBundleForReceipt(storedBundles[0]!),
    loaded[0]
  );
  loadImmutableGameBundleForReceipt(storedBundles.at(-1)!);

  assert.strictEqual(
    loadImmutableGameBundleForReceipt(storedBundles[0]!),
    loaded[0],
    "a recently hit entry should remain cached"
  );
  assert.notStrictEqual(
    loadImmutableGameBundleForReceipt(storedBundles[1]!),
    loaded[1],
    "the least recently used entry should be fully reloaded after eviction"
  );
});

test("each verified bundle cache evicts least-recently-used entries to stay within its byte budget", async () => {
  const bundle = syntheticGameBundle();
  const entryBytes = Math.floor(VERIFIED_BUNDLE_CACHE_MAX_CANONICAL_BYTES / 2) + 1;

  for (const cache of [currentExecutableBundleCache, historicReceiptBundleCache]) {
    const first = syntheticStoredIdentity("byte-budget-first", entryBytes);
    const second = syntheticStoredIdentity("byte-budget-second", entryBytes);

    cache.set(first, first.canonicalBundle, bundle);
    cache.set(second, second.canonicalBundle, bundle);

    assert.equal(cache.get(first), undefined, "the oldest entry must be evicted by bytes");
    assert.strictEqual(cache.get(second), bundle);
    cache.clear();
  }
});

test("an oversized verified bundle remains usable but is not cached", async () => {
  const bundle = syntheticGameBundle();
  const oversized = syntheticStoredIdentity(
    "oversized-bundle",
    VERIFIED_BUNDLE_CACHE_MAX_CANONICAL_BYTES + 1
  );

  assert.doesNotThrow(() => {
    currentExecutableBundleCache.set(oversized, oversized.canonicalBundle, bundle);
  });
  assert.equal(
    currentExecutableBundleCache.get(oversized),
    undefined,
    "cache pressure must not turn a valid bundle into an admission failure"
  );
});

test("cache replacement accounting and clear preserve the byte budget invariant", async () => {
  const bundle = syntheticGameBundle();
  const replacement = syntheticStoredIdentity(
    "replacement",
    Math.floor(VERIFIED_BUNDLE_CACHE_MAX_CANONICAL_BYTES / 4)
  );
  const original = syntheticStoredIdentity(
    "replacement",
    Math.floor(VERIFIED_BUNDLE_CACHE_MAX_CANONICAL_BYTES * 3 / 4)
  );
  const companion = syntheticStoredIdentity(
    "companion",
    VERIFIED_BUNDLE_CACHE_MAX_CANONICAL_BYTES - replacement.canonicalBytes.byteLength
  );

  currentExecutableBundleCache.set(original, original.canonicalBundle, bundle);
  currentExecutableBundleCache.set(replacement, replacement.canonicalBundle, bundle);
  currentExecutableBundleCache.set(companion, companion.canonicalBundle, bundle);

  assert.strictEqual(
    currentExecutableBundleCache.get(replacement),
    bundle,
    "replacement must subtract the old entry before charging the new bytes"
  );
  assert.strictEqual(currentExecutableBundleCache.get(companion), bundle);

  currentExecutableBundleCache.clear();
  assert.equal(currentExecutableBundleCache.get(replacement), undefined);
  assert.equal(currentExecutableBundleCache.get(companion), undefined);

  // A fresh full-budget entry proves clear reset both storage and accounting.
  const afterClear = syntheticStoredIdentity(
    "after-clear",
    VERIFIED_BUNDLE_CACHE_MAX_CANONICAL_BYTES
  );
  currentExecutableBundleCache.set(afterClear, afterClear.canonicalBundle, bundle);
  assert.strictEqual(currentExecutableBundleCache.get(afterClear), bundle);
});

async function loadStoredSimpleChoiceBundle(): Promise<ImmutableGameBundle> {
  return toStoredBundle("simple-choice", await readSimpleChoiceManifest());
}

async function readSimpleChoiceManifest(): Promise<Record<string, any>> {
  return JSON.parse(await readFile(
    new URL("../../../games/simple-choice/game.manifest.json", import.meta.url),
    "utf8"
  )) as Record<string, any>;
}

function toStoredBundle(
  gameId: string,
  manifest: Record<string, any>
): ImmutableGameBundle {
  return {
    ...createImmutableBundleContent(gameId, manifest),
    createdAt: new Date()
  };
}

function syntheticStoredIdentity(
  bundleHash: string,
  canonicalByteLength: number
): Pick<ImmutableGameBundle, "bundleHash" | "gameId" | "canonicalBytes"> & {
  canonicalBundle: Record<string, unknown>;
} {
  return {
    bundleHash,
    gameId: "cache-test",
    canonicalBytes: new Uint8Array(canonicalByteLength),
    canonicalBundle: { bundleHash }
  };
}

function syntheticGameBundle(): GameBundle {
  return {
    gameId: "cache-test",
    bundleHash: "synthetic-cache-test-bundle",
    // The cache is below manifest admission and treats an admitted GameBundle
    // as opaque. A minimal typed placeholder keeps these accounting tests
    // independent of whichever Mechanics artifacts the concurrent worktree has
    // installed.
    manifest: {} as GameBundle["manifest"]
  };
}
