import type { GameManifest } from "@cubica/contracts-manifest";
import type { ImmutableGameBundle } from "@cubica/contracts-session";
import { ManifestValidationError } from "../errors.ts";
import { validateGameManifest } from "./manifestValidation.ts";
import type { IGameRepository } from "./repository.ts";
import { createImmutableBundleContent, verifyImmutableBundleContent } from "./immutableBundle.ts";

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
  const bundle = loadIntegrityCheckedGameBundle(stored);
  const manifest = validateGameManifest(bundle.manifest);
  return { ...bundle, manifest };
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
  return loadIntegrityCheckedGameBundle(stored);
}

function loadIntegrityCheckedGameBundle(stored: ImmutableGameBundle): GameBundle {
  try {
    const verified = verifyImmutableBundleContent(stored);
    return {
      gameId: verified.gameId,
      bundleHash: stored.bundleHash,
      // Receipt-only replay intentionally admits a historic, integrity-checked
      // manifest without current schema admission. Keep that exceptional
      // unknown-to-current-contract bridge explicit and isolated here.
      manifest: verified.manifest as unknown as GameManifest
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ManifestValidationError(`Stored bundle "${stored.bundleHash}" failed integrity validation: ${detail}`);
  }
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
  return immutable;
}

export function extractInitialState(bundle: GameBundle): unknown {
  return bundle.manifest.state ? structuredClone(bundle.manifest.state) : null;
}

function createGameBundle(gameId: string, manifest: GameManifest): GameBundle {
  const immutable = createImmutableBundleContent(gameId, manifest as unknown as Record<string, unknown>);
  return {
    gameId,
    bundleHash: immutable.bundleHash,
    manifest
  };
}
