import type { GameManifest } from "@cubica/contracts-manifest";
import type { ImmutableGameBundle } from "@cubica/contracts-session";
import { ManifestValidationError } from "../errors.ts";
import { validateGameManifest } from "./manifestValidation.ts";
import type { IGameRepository } from "./repository.ts";
import { createImmutableBundleContent, verifyImmutableBundleContent } from "./immutableBundle.ts";
import {
  currentExecutableBundleCache,
  historicReceiptBundleCache
} from "./verifiedBundleCache.ts";

export interface GameBundle {
  gameId: string;
  /** SHA-256 of the complete canonical bundle persisted for session replay. */
  bundleHash: string;
  manifest: GameManifest;
}

export async function loadGameBundle(gameId: string, repository: IGameRepository): Promise<GameBundle> {
  let raw: string;
  try {
    raw = await repository.getManifestRaw(gameId);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "ENOENT") {
      throw error; // Will be mapped to NotFoundError upstream
    }
    throw new ManifestValidationError(`Failed to read game manifest for "${gameId}": ${error instanceof Error ? error.message : String(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new ManifestValidationError(`Invalid game manifest JSON for "${gameId}": ${message}`);
  }

  let manifest: GameManifest;
  try {
    manifest = validateGameManifest(parsed);
  } catch (error) {
    if (error instanceof ManifestValidationError) {
      throw new ManifestValidationError(`${error.message} in game "${gameId}"`);
    }
    throw error;
  }

  return createGameBundle(gameId, manifest);
}

/** Rebuild and verify a typed runtime bundle from the immutable session store. */
export function loadImmutableGameBundle(stored: ImmutableGameBundle): GameBundle {
  const cached = readCachedBundle(currentExecutableBundleCache, stored);
  if (cached) {
    return cached;
  }

  const verified = loadIntegrityCheckedGameBundle(stored);
  const manifest = validateGameManifest(verified.bundle.manifest);
  const bundle = freezeGameBundle({ ...verified.bundle, manifest });
  currentExecutableBundleCache.set(stored, verified.canonicalBundle, bundle);
  return bundle;
}

/**
 * Read a pinned bundle solely to return an already committed command receipt.
 *
 * Exact retry is a ledger read, not a new rule execution. It must remain
 * available when the current runtime no longer has the pinned executor or its
 * newer schema rejects that historic manifest. This narrow loader therefore
 * verifies the immutable bundle hash and game identity but deliberately skips
 * current schema/module admission. Callers must never use its result to execute
 * a new command.
 */
export function loadImmutableGameBundleForReceipt(stored: ImmutableGameBundle): GameBundle {
  const cached = readCachedBundle(historicReceiptBundleCache, stored);
  if (cached) {
    return cached;
  }

  const verified = loadIntegrityCheckedGameBundle(stored);
  const bundle = freezeGameBundle(verified.bundle, verified.canonicalBundle);
  historicReceiptBundleCache.set(stored, verified.canonicalBundle, bundle);
  return bundle;
}

interface IntegrityCheckedGameBundle {
  bundle: GameBundle;
  canonicalBundle: Record<string, unknown>;
}

function loadIntegrityCheckedGameBundle(stored: ImmutableGameBundle): IntegrityCheckedGameBundle {
  try {
    const verified = verifyImmutableBundleContent(stored);
    return {
      bundle: {
        gameId: verified.gameId,
        bundleHash: stored.bundleHash,
        // Receipt-only replay intentionally admits a historic, integrity-checked
        // manifest without current schema admission. Keep that exceptional
        // unknown-to-current-contract bridge explicit and isolated here.
        manifest: verified.manifest as unknown as GameManifest
      },
      canonicalBundle: verified.canonicalBundle
    };
  } catch (error) {
    throw storedBundleIntegrityError(stored.bundleHash, error);
  }
}

function readCachedBundle(
  cache: typeof currentExecutableBundleCache,
  stored: ImmutableGameBundle
): GameBundle | undefined {
  try {
    return cache.get(stored);
  } catch (error) {
    throw storedBundleIntegrityError(stored.bundleHash, error);
  }
}

function storedBundleIntegrityError(bundleHash: string, error: unknown): ManifestValidationError {
  const detail = error instanceof Error ? error.message : String(error);
  return new ManifestValidationError(
    `Stored bundle "${bundleHash}" failed integrity validation: ${detail}`
  );
}

/** Produce the exact JSON object that durable stores address by `bundleHash`. */
export function toImmutableGameBundle(bundle: GameBundle): Omit<ImmutableGameBundle, "createdAt"> {
  const immutable = createImmutableBundleContent(
    bundle.gameId,
    bundle.manifest as unknown as Record<string, unknown>
  );
  if (immutable.bundleHash !== bundle.bundleHash) {
    throw new ManifestValidationError(`Bundle "${bundle.gameId}" changed while it was being pinned.`);
  }
  // Session creation has already completed current schema, module and semantic
  // admission through `loadGameBundle`. Seed the execution cache with the
  // exact bytes about to be persisted so the facilitator's first action does
  // not repeat that full validation. Every later store read must still match
  // these independent bytes and this canonical envelope.
  currentExecutableBundleCache.set(
    immutable,
    immutable.canonicalBundle as Record<string, unknown>,
    bundle
  );
  return immutable;
}

export function extractInitialState(bundle: GameBundle): unknown {
  return bundle.manifest.state ? structuredClone(bundle.manifest.state) : null;
}

function createGameBundle(gameId: string, manifest: GameManifest): GameBundle {
  const immutable = createImmutableBundleContent(gameId, manifest as unknown as Record<string, unknown>);
  return freezeGameBundle({
    gameId,
    bundleHash: immutable.bundleHash,
    manifest
  });
}

/**
 * Cache entries are shared between requests, so every JSON descendant must be
 * read-only—not merely the top-level bundle. Manifests are parsed JSON trees;
 * recursively freezing once at admission is substantially cheaper than cloning
 * the whole manifest on every cache hit and makes accidental runtime mutation
 * fail immediately in strict-mode modules.
 */
function freezeGameBundle(
  bundle: GameBundle,
  canonicalBundle?: Record<string, unknown>
): GameBundle {
  if (canonicalBundle) {
    deepFreezeJson(canonicalBundle);
  } else {
    deepFreezeJson(bundle.manifest);
  }
  return Object.freeze(bundle);
}

function deepFreezeJson<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreezeJson(child, seen);
  }
  return Object.freeze(value);
}
