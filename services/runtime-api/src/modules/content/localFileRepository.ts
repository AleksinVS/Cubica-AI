import { access, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GameAssetFileMetadata, IGameRepository } from "./repository.ts";

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");
const SAFE_GAME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

const assertSafeGameId = (gameId: string) => {
  if (!SAFE_GAME_ID_PATTERN.test(gameId)) {
    throw new Error(`Unsafe gameId "${gameId}"`);
  }
};

export class LocalFileGameRepository implements IGameRepository {
  private readonly repoRoot: string;

  constructor(repoRoot: string = defaultRepoRoot) {
    this.repoRoot = path.resolve(repoRoot);
  }

  async listGameIds(): Promise<readonly string[]> {
    // Discover games by scanning the `games/` directory for entries that expose
    // a `game.manifest.json`. Returned sorted so readiness probes pick a stable,
    // deterministic "first" game rather than relying on filesystem order.
    const gamesRoot = path.resolve(this.repoRoot, "games");
    let entries: import("node:fs").Dirent[] = [];
    try {
      entries = await readdir(gamesRoot, { withFileTypes: true });
    } catch {
      // No games directory (or unreadable) => no games available to probe.
      return [];
    }

    const candidates = entries
      .filter((entry) => entry.isDirectory() && SAFE_GAME_ID_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort();

    // Keep only directories that actually contain a manifest file so the probe
    // does not fail on scaffold/support folders that are not real games.
    const withManifest = await Promise.all(
      candidates.map(async (gameId) => {
        try {
          await access(path.resolve(gamesRoot, gameId, "game.manifest.json"));
          return gameId;
        } catch {
          return undefined;
        }
      })
    );

    return withManifest.filter((gameId): gameId is string => gameId !== undefined);
  }

  async getManifestRaw(gameId: string): Promise<string> {
    assertSafeGameId(gameId);
    const manifestPath = path.resolve(this.repoRoot, "games", gameId, "game.manifest.json");
    return readFile(manifestPath, "utf-8");
  }

  async getUiManifestRaw(gameId: string): Promise<string | undefined> {
    assertSafeGameId(gameId);
    const manifestPath = path.resolve(this.repoRoot, "games", gameId, "ui", "web", "ui.manifest.json");
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
    const mockupsDir = path.resolve(this.repoRoot, "games", gameId, "design", "mockups");
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

  async getPublishedPlayerWebPluginBundlesRaw(gameId: string): Promise<string | undefined> {
    assertSafeGameId(gameId);
    const metadataPath = path.resolve(this.repoRoot, "games", gameId, "published", "player-web-plugin-bundles.json");
    try {
      return await readFile(metadataPath, "utf-8");
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async getPublishedPlayerWebPluginBundleRaw(gameId: string, gameRootRelativeFilePath: string): Promise<string> {
    assertSafeGameId(gameId);
    if (
      path.isAbsolute(gameRootRelativeFilePath) ||
      gameRootRelativeFilePath.includes("\0") ||
      !gameRootRelativeFilePath.startsWith("published/")
    ) {
      throw new Error("Published plugin bundle path must be relative to the game published artifact root.");
    }

    const gameRoot = path.resolve(this.repoRoot, "games", gameId);
    const resolved = path.resolve(gameRoot, gameRootRelativeFilePath);
    if (resolved === gameRoot || !resolved.startsWith(`${gameRoot}${path.sep}`)) {
      throw new Error("Published plugin bundle path must stay inside the game root.");
    }
    return readFile(resolved, "utf-8");
  }

  async getGameAssetsRegistryRaw(gameId: string): Promise<string | undefined> {
    assertSafeGameId(gameId);
    const registryPath = path.resolve(this.repoRoot, "games", gameId, "assets", "assets.json");
    try {
      return await readFile(registryPath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async getGameAssetFileMetadata(gameId: string, relativeFilePath: string): Promise<GameAssetFileMetadata> {
    const resolved = await this.resolveGameAssetFile(gameId, relativeFilePath);
    const fileStat = await stat(resolved);
    if (!fileStat.isFile()) {
      throw new Error("Game asset registry entry must resolve to a regular file.");
    }
    return {
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      extension: path.extname(resolved).slice(1).toLowerCase()
    };
  }

  async getGameAssetFileBytes(gameId: string, relativeFilePath: string): Promise<Buffer> {
    return readFile(await this.resolveGameAssetFile(gameId, relativeFilePath));
  }

  private async resolveGameAssetFile(gameId: string, relativeFilePath: string): Promise<string> {
    assertSafeGameId(gameId);
    if (
      path.isAbsolute(relativeFilePath) ||
      relativeFilePath.includes("\0") ||
      relativeFilePath.includes("..")
    ) {
      throw new Error("Game asset file path must be a safe relative path.");
    }

    const assetsRoot = path.resolve(this.repoRoot, "games", gameId, "assets");
    const resolved = path.resolve(assetsRoot, relativeFilePath);
    if (resolved === assetsRoot || !resolved.startsWith(`${assetsRoot}${path.sep}`)) {
      throw new Error("Game asset file path must stay inside the game's assets directory.");
    }

    // Lexical containment blocks `..`; realpath containment also blocks a
    // registered symlink inside assets/ from targeting an arbitrary host file.
    const [realAssetsRoot, realResolved] = await Promise.all([realpath(assetsRoot), realpath(resolved)]);
    if (realResolved === realAssetsRoot || !realResolved.startsWith(`${realAssetsRoot}${path.sep}`)) {
      throw new Error("Game asset file path must not escape through a symbolic link.");
    }
    return realResolved;
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "ENOENT";
}
