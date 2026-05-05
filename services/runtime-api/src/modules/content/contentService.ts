import type {
  PlayerFacingAction,
  PlayerFacingContent,
  PlayerFacingMockup,
  GameManifestActionDefinition,
  GamePlayerUiContent,
  GameUiScreenDefinition
} from "@cubica/contracts-manifest";
import { loadGameBundle, type GameBundle, extractInitialState } from "./manifestLoader.ts";
import { NotFoundError } from "../errors.ts";
import type { IGameRepository } from "./repository.ts";
import { LocalFileGameRepository } from "./localFileRepository.ts";

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

  const id = typeof parsed.id === "string" ? parsed.id : filename.replace(".design.json", "");
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

const loadMockupsForGame = async (gameId: string, repository: IGameRepository): Promise<Array<PlayerFacingMockup>> => {
  const mockupFiles = await repository.getMockupFiles(gameId);
  return mockupFiles.map(f => parseMockupFile(f.raw, f.filename));
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

const loadGameUiManifest = async (gameId: string, repository: IGameRepository): Promise<RawUiManifest | undefined> => {
  const raw = await repository.getUiManifestRaw(gameId);
  if (!raw) return undefined;

  try {
    return JSON.parse(raw) as RawUiManifest;
  } catch {
    return undefined;
  }
};

const transformScreen = (
  rawScreen: Record<string, unknown>
): GameUiScreenDefinition => {
  return {
    type: "screen",
    title: typeof rawScreen.title === "string" ? rawScreen.title : "Game",
    layoutId: typeof rawScreen.layout_id === "string" ? rawScreen.layout_id : undefined,
    root: structuredClone(rawScreen.root) as GameUiScreenDefinition["root"]
  };
};

const projectGameUiContent = (
  rawManifest: RawUiManifest
): GamePlayerUiContent | undefined => {
  const meta = rawManifest.meta ?? {};
  const entryPoint = rawManifest.entry_point ?? "S1";
  const rawScreens = rawManifest.screens;

  if (!rawScreens || typeof rawScreens !== "object") {
    return undefined;
  }

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

  const screens: Record<string, GameUiScreenDefinition> = {};
  for (const [screenId, rawScreen] of Object.entries(rawScreens)) {
    if (rawScreen && typeof rawScreen === "object") {
      screens[screenId] = transformScreen(rawScreen as Record<string, unknown>);
    }
  }

  if (Object.keys(screens).length === 0) {
    return undefined;
  }

  return {
    id: typeof meta.id === "string" ? meta.id : "game.ui.web",
    version: typeof meta.version === "string" ? meta.version : "1.0.0",
    gameId: typeof meta.game_id === "string" ? meta.game_id : "game",
    entryPoint,
    screens,
    designArtifacts: Object.keys(designArtifacts).length > 0 ? designArtifacts : undefined
  };
};

const projectManifestToPlayerContent = async (bundle: GameBundle, repository: IGameRepository): Promise<PlayerFacingContent> => {
  const { manifest } = bundle;

  const actions: Array<PlayerFacingAction> = Object.entries(
    manifest.actions as Record<string, GameManifestActionDefinition>
  ).map(([actionId, definition]) => ({
    actionId,
    displayName: definition.displayName ?? actionId,
    capabilityFamily: definition.capabilityFamily ?? null,
    capability: definition.capability ?? null
  }));

  const gameSpecificContent = manifest.content?.[manifest.meta.id];
  const rawUiManifest = await loadGameUiManifest(manifest.meta.id, repository);
  const gameUi = rawUiManifest ? projectGameUiContent(rawUiManifest) : undefined;

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
    content: gameSpecificContent ? { [manifest.meta.id]: structuredClone(gameSpecificContent) } : undefined,
    ui: gameUi
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
  private readonly repository: IGameRepository;
  
  constructor(repository: IGameRepository) {
    this.repository = repository;
  }

  async getBundle(gameId: string): Promise<GameBundle> {
    const cached = this.bundleCache.get(gameId);
    if (cached) {
      return cached;
    }

    const bundle = await loadGameBundle(gameId, this.repository);
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
    const mockups = await loadMockupsForGame(options.gameId, this.repository);

    const content = await projectManifestToPlayerContent(bundle, this.repository);
    content.mockups = mockups;

    return { content };
  }
}

export const contentService = new ContentService(new LocalFileGameRepository());

export async function loadPlayerFacingContent(
  options: ContentServiceOptions
): Promise<ContentServiceResult> {
  return contentService.getPlayerFacingContent(options);
}
