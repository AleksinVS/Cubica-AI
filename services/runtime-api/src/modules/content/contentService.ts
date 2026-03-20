import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  PlayerFacingAction,
  PlayerFacingContent,
  PlayerFacingMockup,
  GameManifestActionDefinition
} from "@cubica/contracts-manifest";
import { loadGameBundle, type GameBundle, extractInitialState } from "./manifestLoader.ts";
import { NotFoundError } from "../errors.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");

const resolveGameMockupsDir = (gameId: string) =>
  path.resolve(repoRoot, "games", gameId, "design", "mockups");

interface RawMockupDesign {
  id?: string;
  name?: string;
  description?: string;
  type?: string;
  image?: {
    path?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const parseMockupFile = (raw: string, filename: string): PlayerFacingMockup => {
  let parsed: RawMockupDesign = {};

  try {
    parsed = JSON.parse(raw) as RawMockupDesign;
  } catch {
    // If JSON parsing fails, use defaults based on filename
  }

  const id = typeof parsed.id === "string" ? parsed.id : path.basename(filename, ".design.json");
  const name = typeof parsed.name === "string" ? parsed.name : id;
  const description = typeof parsed.description === "string" ? parsed.description : "";
  const type = typeof parsed.type === "string" ? parsed.type : "mockup";

  let imagePath = "";
  if (
    parsed.image &&
    typeof parsed.image === "object" &&
    !Array.isArray(parsed.image) &&
    typeof (parsed.image as Record<string, unknown>).path === "string"
  ) {
    imagePath = String((parsed.image as Record<string, unknown>).path);
  }

  return {
    id,
    name,
    description,
    type,
    imagePath
  };
};

const loadMockupsForGame = async (gameId: string): Promise<Array<PlayerFacingMockup>> => {
  const mockupsDir = resolveGameMockupsDir(gameId);

  let files: string[] = [];

  try {
    files = (await readdir(mockupsDir)).filter((file) => file.endsWith(".design.json")).sort();
  } catch {
    return [];
  }

  const mockups = await Promise.all(
    files.map(async (file) => {
      const raw = await readFile(path.resolve(mockupsDir, file), "utf-8");
      return parseMockupFile(raw, file);
    })
  );

  return mockups;
};

const projectManifestToPlayerContent = (bundle: GameBundle): PlayerFacingContent => {
  const { manifest } = bundle;

  const actions: Array<PlayerFacingAction> = Object.entries(
    manifest.actions as Record<string, GameManifestActionDefinition>
  ).map(([actionId, definition]) => ({
    actionId,
    displayName: definition.displayName ?? actionId,
    capabilityFamily: definition.capabilityFamily ?? null,
    capability: definition.capability ?? null
  }));

  return {
    gameId: manifest.meta.id,
    version: manifest.meta.version,
    name: manifest.meta.name,
    description: manifest.meta.description,
    locale: manifest.config.settings.locale,
    playerConfig: manifest.config.players,
    training: manifest.meta.training,
    actions,
    mockups: []
  };
};

export interface ContentServiceOptions {
  gameId: string;
}

export interface ContentServiceResult {
  content: PlayerFacingContent;
}

export class ContentService {
  private readonly bundleCache = new Map<string, GameBundle>();

  async getBundle(gameId: string): Promise<GameBundle> {
    const cached = this.bundleCache.get(gameId);
    if (cached) {
      return cached;
    }

    const bundle = await loadGameBundle(gameId);
    this.bundleCache.set(gameId, bundle);
    return bundle;
  }

  async getInitialState(gameId: string): Promise<unknown> {
    let bundle: GameBundle;
    try {
      bundle = await this.getBundle(gameId);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: string }).code === "ENOENT"
      ) {
        throw new NotFoundError(`Game "${gameId}" was not found`);
      }
      throw error;
    }
    return extractInitialState(bundle);
  }

  async getPlayerFacingContent(options: ContentServiceOptions): Promise<ContentServiceResult> {
    let bundle: GameBundle;
    try {
      bundle = await this.getBundle(options.gameId);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: string }).code === "ENOENT"
      ) {
        throw new NotFoundError(`Game "${options.gameId}" was not found`);
      }
      throw error;
    }
    const mockups = await loadMockupsForGame(options.gameId);

    const content = projectManifestToPlayerContent(bundle);
    content.mockups = mockups;

    return { content };
  }
}

export const contentService = new ContentService();

export async function loadPlayerFacingContent(
  options: ContentServiceOptions
): Promise<ContentServiceResult> {
  return contentService.getPlayerFacingContent(options);
}