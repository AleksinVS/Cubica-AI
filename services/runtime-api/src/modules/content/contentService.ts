import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  PlayerFacingAction,
  PlayerFacingContent,
  PlayerFacingMockup,
  GameManifestActionDefinition,
  AntarcticaPlayerS1UiContent
} from "@cubica/contracts-manifest";
import { loadGameBundle, type GameBundle, extractInitialState } from "./manifestLoader.ts";
import { NotFoundError } from "../errors.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");

const resolveGameMockupsDir = (gameId: string) =>
  path.resolve(repoRoot, "games", gameId, "design", "mockups");

const resolveGameUiManifestPath = (gameId: string) =>
  path.resolve(repoRoot, "games", gameId, "ui", "web", "ui.manifest.json");

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

const projectAntarcticaContent = (bundle: GameBundle): PlayerFacingContent["antarctica"] => {
  const antarctica = bundle.manifest.content?.antarctica;
  if (!antarctica) {
    return undefined;
  }

  return structuredClone(antarctica);
};

interface RawUiManifest {
  meta?: {
    id?: string;
    version?: string;
    game_id?: string;
    [key: string]: unknown;
  };
  entry_point?: string;
  screens?: Record<string, unknown>;
  design_artifacts?: {
    registry?: Record<string, { type?: string; source_ref?: { file?: string } }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Loads the Antarctica UI manifest (ui.manifest.json) for the bounded S1 screen.
 * Returns undefined if the file does not exist or cannot be parsed.
 * This is an additive read-only projection; no manifest validation is performed here.
 */
const loadAntarcticaUiManifest = async (gameId: string): Promise<RawUiManifest | undefined> => {
  if (gameId !== "antarctica") {
    // S1 UI manifest is currently Antarctica-specific; return undefined for other games.
    return undefined;
  }

  const manifestPath = resolveGameUiManifestPath(gameId);

  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf-8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "ENOENT"
    ) {
      // UI manifest does not exist for this game; this is non-fatal for the content API.
      return undefined;
    }
    throw error;
  }

  try {
    return JSON.parse(raw) as RawUiManifest;
  } catch {
    // Malformed UI manifest; return undefined to avoid breaking the content API.
    return undefined;
  }
};

/**
 * Projects the bounded S1 UI content from the raw UI manifest.
 * Returns only the S1 screen definition needed for manifest-driven opening screen rendering.
 * Asset references (image paths) are preserved as data strings, not resolved URLs.
 */
const projectAntarcticaS1UiContent = (
  rawManifest: RawUiManifest
): AntarcticaPlayerS1UiContent | undefined => {
  const meta = rawManifest.meta ?? {};
  const entryPoint = rawManifest.entry_point ?? "S1";
  const screen = rawManifest.screens?.[entryPoint];

  if (!screen || typeof screen !== "object") {
    // No S1 screen defined in the UI manifest.
    return undefined;
  }

  // Project design artifact registry for reference/metadata purposes.
  const designArtifacts: Record<string, { id: string; type: string; sourceRef?: { file?: string } }> = {};
  const registry = rawManifest.design_artifacts?.registry;
  if (registry && typeof registry === "object") {
    for (const [key, value] of Object.entries(registry)) {
      if (value && typeof value === "object") {
        designArtifacts[key] = {
          id: key,
          type: (value as { type?: string }).type ?? "unknown",
          sourceRef: (value as { source_ref?: { file?: string } }).source_ref
        };
      }
    }
  }

  // Transform snake_case fields to camelCase for the typed screen definition.
  // The raw ui.manifest.json uses snake_case (layout_id, entry_point), but the
  // typed interface uses camelCase (layoutId, entryPoint).
  const rawScreen = screen as Record<string, unknown>;
  const transformedScreen: AntarcticaPlayerS1UiContent["screen"] = {
    type: "screen",
    title: typeof rawScreen.title === "string" ? rawScreen.title : "Antarctica",
    layoutId: typeof rawScreen.layout_id === "string" ? rawScreen.layout_id : undefined,
    // Deep clone the root component tree, preserving all children and props.
    root: structuredClone(rawScreen.root) as AntarcticaPlayerS1UiContent["screen"]["root"]
  };

  return {
    id: typeof meta.id === "string" ? meta.id : "antarctica.ui.web",
    version: typeof meta.version === "string" ? meta.version : "1.0.0",
    gameId: typeof meta.game_id === "string" ? meta.game_id : "antarctica",
    entryPoint,
    screen: transformedScreen,
    designArtifacts: Object.keys(designArtifacts).length > 0 ? designArtifacts : undefined
  };
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
    mockups: [],
    antarctica: projectAntarcticaContent(bundle)
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

    // Load and project the bounded S1 UI manifest for Antarctica.
    // This is additive: if the UI manifest is missing or malformed, we still return
    // the gameplay content (antarctica) without breaking the API contract.
    const rawUiManifest = await loadAntarcticaUiManifest(options.gameId);
    const antarcticaUi = rawUiManifest ? projectAntarcticaS1UiContent(rawUiManifest) : undefined;

    const content = projectManifestToPlayerContent(bundle);
    content.mockups = mockups;
    content.antarcticaUi = antarcticaUi;

    return { content };
  }
}

export const contentService = new ContentService();

export async function loadPlayerFacingContent(
  options: ContentServiceOptions
): Promise<ContentServiceResult> {
  return contentService.getPlayerFacingContent(options);
}
