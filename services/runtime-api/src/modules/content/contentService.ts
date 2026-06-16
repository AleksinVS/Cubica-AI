import type {
  PlayerFacingAction,
  PlayerFacingContent,
  PlayerWebPluginBundleReference,
  PlayerFacingMockup,
  GameManifestActionDefinition,
  GamePlayerUiContent,
  GameUiPanelDefinition,
  GameUiScreenDefinition,
  ScreenRoutingEntry,
  MetricConfigSpec
} from "@cubica/contracts-manifest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AjvLib from "ajv";
import { loadGameBundle, type GameBundle, extractInitialState } from "./manifestLoader.ts";
import { NotFoundError } from "../errors.ts";
import type { IGameRepository } from "./repository.ts";
import { LocalFileGameRepository } from "./localFileRepository.ts";

const Ajv = (AjvLib as any).default || AjvLib;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");
const publishedBundleSchema = JSON.parse(readFileSync(
  path.join(repoRoot, "docs", "architecture", "schemas", "player-web-plugin-bundles.schema.json"),
  "utf8"
)) as object;
const publishedBundleSchemaId = "https://cubica.platform/schemas/player-web-plugin-bundles.schema.json";
const publishedBundleAjv = new Ajv({ allErrors: true, strict: false });
publishedBundleAjv.addSchema(publishedBundleSchema, publishedBundleSchemaId);
const validatePublishedBundleMetadata = publishedBundleAjv.getSchema(publishedBundleSchemaId);

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
  panels?: Record<string, unknown>;
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
    layoutMode: typeof rawScreen.layout_mode === "string"
      ? rawScreen.layout_mode as GameUiScreenDefinition["layoutMode"]
      : undefined,
    designRegions: Array.isArray(rawScreen.design_regions)
      ? rawScreen.design_regions as GameUiScreenDefinition["designRegions"]
      : undefined,
    root: structuredClone(rawScreen.root) as GameUiScreenDefinition["root"]
  };
};

const transformPanel = (
  rawPanel: Record<string, unknown>
): GameUiPanelDefinition => {
  return {
    type: "panel",
    title: typeof rawPanel.title === "string" ? rawPanel.title : undefined,
    mode: typeof rawPanel.mode === "string"
      ? rawPanel.mode as GameUiPanelDefinition["mode"]
      : "overlay",
    layoutId: typeof rawPanel.layout_id === "string" ? rawPanel.layout_id : undefined,
    layoutMode: typeof rawPanel.layout_mode === "string"
      ? rawPanel.layout_mode as GameUiPanelDefinition["layoutMode"]
      : undefined,
    designRegions: Array.isArray(rawPanel.design_regions)
      ? rawPanel.design_regions as GameUiPanelDefinition["designRegions"]
      : undefined,
    root: structuredClone(rawPanel.root) as GameUiPanelDefinition["root"]
  };
};

const projectGameUiContent = (
  rawManifest: RawUiManifest
): GamePlayerUiContent | undefined => {
  const meta = rawManifest.meta ?? {};
  const entryPoint = rawManifest.entry_point ?? "S1";
  const rawScreens = rawManifest.screens;
  const rawPanels = rawManifest.panels;

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

  const panels: Record<string, GameUiPanelDefinition> = {};
  if (rawPanels && typeof rawPanels === "object") {
    for (const [panelId, rawPanel] of Object.entries(rawPanels)) {
      if (rawPanel && typeof rawPanel === "object") {
        panels[panelId] = transformPanel(rawPanel as Record<string, unknown>);
      }
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
    panels: Object.keys(panels).length > 0 ? panels : undefined,
    screenRouting: (rawManifest.screen_routing ?? rawManifest.screenRouting) as ScreenRoutingEntry[] | undefined,
    metricSpecs: Array.isArray(rawManifest.metric_specs ?? rawManifest.metricSpecs) ? (rawManifest.metric_specs ?? rawManifest.metricSpecs) as MetricConfigSpec[] : undefined,
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

  // Platform purity: prefer agnostic 'data' or 'collections' over legacy game-specific key.
  const gameSpecificContent = manifest.content?.data ?? 
                             manifest.content?.collections ?? 
                             manifest.content?.[manifest.meta.id];

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
    executionMode: manifest.executionMode,
    agentRuntime: manifest.agentRuntime === undefined
      ? undefined
      : {
          agentId: manifest.agentRuntime.agentId,
          runtimeId: manifest.agentRuntime.runtimeId,
          required: manifest.agentRuntime.required,
          failurePolicy: manifest.agentRuntime.failurePolicy,
          deterministicFallbackActionId: manifest.agentRuntime.deterministicFallbackActionId,
          surfaceCatalog: [...manifest.agentRuntime.surfaceCatalog]
        },
    actions,
    mockups: [],
    objectModels: manifest.objectModels ? structuredClone(manifest.objectModels) : undefined,
    // Return content under the same key it was found, or default to 'data' for the projection
    content: gameSpecificContent ? { data: structuredClone(gameSpecificContent) } : undefined,
    ui: gameUi
  };
};

export interface ContentServiceOptions {
  gameId: string;
  contentSourceId?: string;
}

export interface ContentServiceResult {
  content: PlayerFacingContent;
}

export interface LocalPlayerWebPluginBundle {
  readonly pluginId: string;
  readonly gameId: string;
  readonly apiVersion: string;
  readonly target: "player-web";
  readonly scope?: "preview";
  readonly contentHash: string;
  readonly filePath: string;
}

interface PublishedPlayerWebPluginBundle {
  readonly pluginId: string;
  readonly gameId: string;
  readonly apiVersion: string;
  readonly target: "player-web";
  readonly scope: "published";
  readonly contentHash: string;
  readonly integrity: string;
  readonly filePath: string;
  readonly url: string;
}

interface PublishedPlayerWebPluginBundleMetadata {
  readonly schemaVersion: "1.0";
  readonly bundles: readonly PublishedPlayerWebPluginBundle[];
}

export class ContentService {
  private readonly bundleCache = new Map<string, GameBundle>();
  private readonly repository: IGameRepository;
  private readonly repositoriesBySourceId = new Map<string, IGameRepository>();
  private readonly playerWebPluginBundlesBySourceId = new Map<string, readonly LocalPlayerWebPluginBundle[]>();
  
  constructor(repository: IGameRepository) {
    this.repository = repository;
  }

  /**
   * Registers an alternate generated-content root for a local editor preview.
   *
   * A content source is a named repository view. Normal players use the
   * default published repository; editor preview sessions can point to an
   * isolated Git worktree after the authoring compiler wrote generated
   * manifests there.
   */
  registerLocalContentRoot(
    sourceId: string,
    contentRoot: string,
    pluginBundles: readonly LocalPlayerWebPluginBundle[] = []
  ): void {
    this.repositoriesBySourceId.set(sourceId, new LocalFileGameRepository(contentRoot));
    this.playerWebPluginBundlesBySourceId.set(sourceId, pluginBundles);
    this.clearBundleCache(undefined, sourceId);
  }

  async getBundle(gameId: string, contentSourceId?: string): Promise<GameBundle> {
    const cacheKey = this.bundleCacheKey(gameId, contentSourceId);
    const cached = this.bundleCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const bundle = await loadGameBundle(gameId, this.repositoryForSource(contentSourceId));
    this.bundleCache.set(cacheKey, bundle);
    return bundle;
  }

  async getGameManifest(gameId: string, contentSourceId?: string): Promise<GameBundle["manifest"]> {
    try {
      return (await this.getBundle(gameId, contentSourceId)).manifest;
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
  }

  /**
   * Clears cached game content after tooling regenerates runtime manifests.
   *
   * Cache reload is a generic authoring/preview boundary: callers name a game
   * id, and runtime-api will reload the next session/content request from the
   * repository. Runtime still consumes only generated manifests.
   */
  clearBundleCache(gameId?: string, contentSourceId?: string): readonly string[] {
    if (contentSourceId !== undefined) {
      return this.clearBundleCacheForSource(contentSourceId, gameId);
    }

    if (gameId !== undefined) {
      const defaultKey = this.bundleCacheKey(gameId, undefined);
      const hadGame = this.bundleCache.delete(defaultKey);
      return hadGame ? [gameId] : [];
    }

    const cleared = [...this.bundleCache.keys()];
    this.bundleCache.clear();
    return cleared;
  }

  async getInitialState(gameId: string, contentSourceId?: string): Promise<unknown> {
    let bundle: GameBundle;
    try {
      bundle = await this.getBundle(gameId, contentSourceId);
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
      bundle = await this.getBundle(options.gameId, options.contentSourceId);
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
    const repository = this.repositoryForSource(options.contentSourceId);
    const mockups = await loadMockupsForGame(options.gameId, repository);

    const content = await projectManifestToPlayerContent(bundle, repository);
    content.mockups = mockups;
    content.pluginBundles = await this.playerWebPluginBundleReferences(options.contentSourceId, options.gameId, repository);

    return { content };
  }

  getPlayerWebPluginBundleFile(input: {
    readonly contentSourceId: string;
    readonly pluginId: string;
    readonly contentHash: string;
  }): string {
    const bundle = this.playerWebPluginBundlesBySourceId
      .get(input.contentSourceId)
      ?.find((candidate) =>
        candidate.pluginId === input.pluginId &&
        candidate.contentHash === input.contentHash &&
        candidate.target === "player-web"
      );

    if (bundle === undefined) {
      throw new NotFoundError(`Plugin bundle "${input.pluginId}" was not found for content source "${input.contentSourceId}"`);
    }

    return bundle.filePath;
  }

  async getPublishedPlayerWebPluginBundleSource(input: {
    readonly gameId: string;
    readonly pluginId: string;
    readonly contentHash: string;
  }): Promise<string> {
    const bundles = await this.loadPublishedPlayerWebPluginBundles(this.repository, input.gameId);
    const bundle = bundles.find((candidate) =>
      candidate.pluginId === input.pluginId &&
      candidate.gameId === input.gameId &&
      candidate.target === "player-web" &&
      candidate.scope === "published" &&
      candidate.contentHash === input.contentHash
    );

    if (bundle === undefined) {
      throw new NotFoundError(`Published plugin bundle "${input.pluginId}" was not found for game "${input.gameId}"`);
    }

    const source = await this.repository.getPublishedPlayerWebPluginBundleRaw(input.gameId, bundle.filePath);
    const actualHash = createHash("sha256").update(source, "utf8").digest("hex");
    if (actualHash !== bundle.contentHash) {
      throw new Error(`Published plugin bundle "${input.pluginId}" failed contentHash verification.`);
    }
    return source;
  }

  private repositoryForSource(contentSourceId: string | undefined): IGameRepository {
    if (contentSourceId === undefined) {
      return this.repository;
    }

    const repository = this.repositoriesBySourceId.get(contentSourceId);
    if (repository === undefined) {
      throw new NotFoundError(`Content source "${contentSourceId}" was not found`);
    }
    return repository;
  }

  private bundleCacheKey(gameId: string, contentSourceId: string | undefined): string {
    return `${contentSourceId ?? "default"}:${gameId}`;
  }

  private async playerWebPluginBundleReferences(
    contentSourceId: string | undefined,
    gameId: string,
    repository: IGameRepository
  ): Promise<Array<PlayerWebPluginBundleReference> | undefined> {
    if (contentSourceId === undefined) {
      const bundles = await this.loadPublishedPlayerWebPluginBundles(repository, gameId);
      const references = bundles
        .filter((bundle) => bundle.gameId === gameId && bundle.target === "player-web")
        .map((bundle) => ({
          pluginId: bundle.pluginId,
          gameId: bundle.gameId,
          apiVersion: bundle.apiVersion,
          target: bundle.target,
          scope: bundle.scope,
          contentHash: bundle.contentHash,
          integrity: bundle.integrity,
          url: bundle.url
        }));

      return references.length > 0 ? references : undefined;
    }

    const bundles = this.playerWebPluginBundlesBySourceId.get(contentSourceId) ?? [];
    const references = bundles
      .filter((bundle) => bundle.gameId === gameId && bundle.target === "player-web")
      .map((bundle) => ({
        pluginId: bundle.pluginId,
        gameId: bundle.gameId,
        apiVersion: bundle.apiVersion,
        target: bundle.target,
        scope: "preview" as const,
        contentHash: bundle.contentHash,
        url: `/content-sources/${encodeURIComponent(contentSourceId)}/plugin-bundles/${encodeURIComponent(bundle.pluginId)}/${encodeURIComponent(bundle.contentHash)}.mjs`
      }));

    return references.length > 0 ? references : undefined;
  }

  private async loadPublishedPlayerWebPluginBundles(
    repository: IGameRepository,
    gameId: string
  ): Promise<readonly PublishedPlayerWebPluginBundle[]> {
    const raw = await repository.getPublishedPlayerWebPluginBundlesRaw(gameId);
    if (raw === undefined) {
      return [];
    }

    let parsed: PublishedPlayerWebPluginBundleMetadata;
    try {
      parsed = JSON.parse(raw) as PublishedPlayerWebPluginBundleMetadata;
    } catch {
      throw new Error(`Published player-web plugin bundle metadata for "${gameId}" must be valid JSON.`);
    }

    if (!validatePublishedBundleMetadata?.(parsed)) {
      const errors = (validatePublishedBundleMetadata?.errors ?? [])
        .map((error: any) => `${error.instancePath || "/"} ${error.message}`)
        .join("; ");
      throw new Error(`Published player-web plugin bundle metadata for "${gameId}" is invalid: ${errors}`);
    }

    return parsed.bundles;
  }

  private clearBundleCacheForSource(contentSourceId: string, gameId: string | undefined): readonly string[] {
    if (gameId !== undefined) {
      const hadGame = this.bundleCache.delete(this.bundleCacheKey(gameId, contentSourceId));
      return hadGame ? [gameId] : [];
    }

    const prefix = `${contentSourceId}:`;
    const cleared: string[] = [];
    for (const key of [...this.bundleCache.keys()]) {
      if (key.startsWith(prefix)) {
        this.bundleCache.delete(key);
        cleared.push(key.slice(prefix.length));
      }
    }
    return cleared;
  }
}

export const contentService = new ContentService(new LocalFileGameRepository());

export async function loadPlayerFacingContent(
  options: ContentServiceOptions
): Promise<ContentServiceResult> {
  return contentService.getPlayerFacingContent(options);
}

export function clearPlayerFacingContentCache(gameId?: string, contentSourceId?: string): readonly string[] {
  return contentService.clearBundleCache(gameId, contentSourceId);
}

export function registerLocalPlayerFacingContentSource(sourceId: string, contentRoot: string): void {
  contentService.registerLocalContentRoot(sourceId, contentRoot);
}

export function registerLocalPlayerFacingContentSourceWithPlugins(
  sourceId: string,
  contentRoot: string,
  pluginBundles: readonly LocalPlayerWebPluginBundle[]
): void {
  contentService.registerLocalContentRoot(sourceId, contentRoot, pluginBundles);
}

export async function loadGameManifest(gameId: string, contentSourceId?: string): Promise<GameBundle["manifest"]> {
  return contentService.getGameManifest(gameId, contentSourceId);
}

export function getPlayerWebPluginBundleFile(input: {
  readonly contentSourceId: string;
  readonly pluginId: string;
  readonly contentHash: string;
}): string {
  return contentService.getPlayerWebPluginBundleFile(input);
}

export async function getPublishedPlayerWebPluginBundleSource(input: {
  readonly gameId: string;
  readonly pluginId: string;
  readonly contentHash: string;
}): Promise<string> {
  return contentService.getPublishedPlayerWebPluginBundleSource(input);
}
