import { readFile } from "node:fs/promises";
import path from "node:path";

export interface GameBundle {
  gameId: string;
  manifest: Record<string, unknown>;
}

const resolveGameManifestPath = (gameId: string) =>
  path.resolve(process.cwd(), "games", gameId, "game.manifest.json");

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
