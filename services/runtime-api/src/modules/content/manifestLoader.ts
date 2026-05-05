import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GameManifest } from "@cubica/contracts-manifest";
import { ManifestValidationError } from "../errors.ts";
import { validateGameManifest } from "./manifestValidation.ts";

export interface GameBundle {
  gameId: string;
  manifest: GameManifest;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");

const resolveGameManifestPath = (gameId: string) =>
  path.resolve(repoRoot, "games", gameId, "game.manifest.json");

export async function loadGameBundle(gameId: string): Promise<GameBundle> {
  const manifestPath = resolveGameManifestPath(gameId);
  const raw = await readFile(manifestPath, "utf-8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new ManifestValidationError(`Invalid game manifest JSON at "${manifestPath}": ${message}`);
  }

  let manifest: GameManifest;

  try {
    manifest = validateGameManifest(parsed) as GameManifest;
  } catch (error) {
    if (error instanceof ManifestValidationError) {
      throw new ManifestValidationError(`${error.message} in "${manifestPath}"`);
    }

    throw error;
  }

  return {
    gameId,
    manifest
  };
}

export function extractInitialState(bundle: GameBundle): unknown {
  return bundle.manifest.state ? structuredClone(bundle.manifest.state) : null;
}
