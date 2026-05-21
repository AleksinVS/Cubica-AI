import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IGameRepository } from "./repository.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");
const SAFE_GAME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

const assertSafeGameId = (gameId: string) => {
  if (!SAFE_GAME_ID_PATTERN.test(gameId)) {
    throw new Error(`Unsafe gameId "${gameId}"`);
  }
};

export class LocalFileGameRepository implements IGameRepository {
  async getManifestRaw(gameId: string): Promise<string> {
    assertSafeGameId(gameId);
    const manifestPath = path.resolve(repoRoot, "games", gameId, "game.manifest.json");
    return readFile(manifestPath, "utf-8");
  }

  async getUiManifestRaw(gameId: string): Promise<string | undefined> {
    assertSafeGameId(gameId);
    const manifestPath = path.resolve(repoRoot, "games", gameId, "ui", "web", "ui.manifest.json");
    try {
      return await readFile(manifestPath, "utf-8");
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async getMockupFiles(gameId: string): Promise<Array<{ filename: string; raw: string }>> {
    assertSafeGameId(gameId);
    const mockupsDir = path.resolve(repoRoot, "games", gameId, "design", "mockups");
    let files: string[] = [];
    try {
      files = (await readdir(mockupsDir)).filter((file) => file.endsWith(".design.json")).sort();
    } catch {
      return [];
    }

    return Promise.all(
      files.map(async (filename) => {
        const raw = await readFile(path.resolve(mockupsDir, filename), "utf-8");
        return { filename, raw };
      })
    );
  }
}
