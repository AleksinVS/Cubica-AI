import type { GameManifest } from "@cubica/contracts-manifest";
import { ManifestValidationError } from "../errors.ts";
import { validateGameManifest } from "./manifestValidation.ts";
import type { IGameRepository } from "./repository.ts";

export interface GameBundle {
  gameId: string;
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
    manifest = validateGameManifest(parsed) as GameManifest;
  } catch (error) {
    if (error instanceof ManifestValidationError) {
      throw new ManifestValidationError(`${error.message} in game "${gameId}"`);
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
