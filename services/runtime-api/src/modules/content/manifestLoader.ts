import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface GameBundle {
  gameId: string;
  manifest: Record<string, unknown>;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");

const resolveGameManifestPath = (gameId: string) =>
  path.resolve(repoRoot, "games", gameId, "game.manifest.json");

export async function loadGameBundle(gameId: string): Promise<GameBundle> {
  const manifestPath = resolveGameManifestPath(gameId);
  const raw = await readFile(manifestPath, "utf-8");
  const manifest = JSON.parse(raw) as Record<string, unknown>;

  return {
    gameId,
    manifest
  };
}

export function extractInitialState(bundle: GameBundle): unknown {
  return (bundle.manifest.state as Record<string, unknown> | undefined) ?? null;
}
