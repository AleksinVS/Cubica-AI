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
  MetricConfigSpec,
  RootGameAssets
} from "@cubica/contracts-manifest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AjvLib from "ajv";
import addFormatsLib from "ajv-formats";
import { loadGameBundle, type GameBundle, extractInitialState } from "./manifestLoader.ts";
import { NotFoundError } from "../errors.ts";
import type { IGameRepository } from "./repository.ts";
import { LocalFileGameRepository } from "./localFileRepository.ts";

const Ajv = (AjvLib as any).default || AjvLib;
const addFormats = (addFormatsLib as any).default || addFormatsLib;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");
const publishedBundleSchema = JSON.parse(readFileSync(
  path.join(repoRoot, "docs", "architecture", "schemas", "player-web-plugin-bundles.schema.json"),
  "utf8"
)) as object;
const gameAssetsSchema = JSON.parse(readFileSync(
  path.join(repoRoot, "docs", "architecture", "schemas", "game-assets.schema.json"),
  "utf8"
)) as object;
const gameStylesheetsSchema = JSON.parse(readFileSync(
  path.join(repoRoot, "docs", "architecture", "schemas", "game-stylesheets.schema.json"),
  "utf8"
)) as object;
const publishedBundleSchemaId = "https://cubica.platform/schemas/player-web-plugin-bundles.schema.json";
// Strict Ajv mode keeps JSON Schema the single source of truth (ADR-025):
// unknown keywords/formats and malformed schemas fail fast. allowUnionTypes and
// ajv-formats are the same principled relaxations used by the manifest validator
// (union `type` arrays are valid JSON Schema; ajv-formats registers standard
// formats like uri/date-time so `format` keywords are recognised, not rejected).
const publishedBundleAjv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(publishedBundleAjv);
publishedBundleAjv.addSchema(publishedBundleSchema, publishedBundleSchemaId);
const validatePublishedBundleMetadata = publishedBundleAjv.getSchema(publishedBundleSchemaId);
const gameAssetsAjv = new Ajv({ allErrors: true, strict: true });
addFormats(gameAssetsAjv);
const validateGameAssetsRegistry = gameAssetsAjv.compile(gameAssetsSchema);
const validateGameStylesheetsMetadata = gameAssetsAjv.compile(gameStylesheetsSchema);

const GAME_ASSET_CONTENT_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml"
};

// Content-addressable game-owned stylesheets are served as CSS (ADR-091). The
// published bytes are immutable, so the same immutable cache policy as images
// applies at the route layer.
const GAME_STYLESHEET_CONTENT_TYPE = "text/css; charset=utf-8";

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
  default_layout_mode?: unknown;
  stylesheets?: unknown;
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

  // Carry the ADR-091 game-owned stylesheet references (asset:<id> forms) as
  // plain strings. The renderer resolves them through the game asset index and
  // injects <link> elements game-agnostically; unknown ids fail closed there.
  const stylesheets = Array.isArray(rawManifest.stylesheets)
    ? rawManifest.stylesheets.filter((value): value is string => typeof value === "string")
    : undefined;

  return {
    id: typeof meta.id === "string" ? meta.id : "game.ui.web",
    version: typeof meta.version === "string" ? meta.version : "1.0.0",
    gameId: typeof meta.game_id === "string" ? meta.game_id : "game",
    entryPoint,
    // ADR-093: design-time layout selector. Carried through so the screen router
    // matches routing conditions against this value instead of server UI state.
    defaultLayoutMode: typeof rawManifest.default_layout_mode === "string"
      ? rawManifest.default_layout_mode as GamePlayerUiContent["defaultLayoutMode"]
      : undefined,
    stylesheets: stylesheets && stylesheets.length > 0 ? stylesheets : undefined,
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
  ).filter(([, definition]) => (definition.invocation ?? "external") === "external")
    .map(([actionId, definition]) => ({
    actionId,
    displayName: definition.displayName ?? actionId,
    capabilityFamily: definition.capabilityFamily ?? null,
    capability: definition.capability ?? null,
    paramsSchema: definition.paramsSchema === undefined ? undefined : structuredClone(definition.paramsSchema),
    allowedSessionRoles: definition.allowedSessionRoles === undefined
      ? undefined
      : [...definition.allowedSessionRoles]
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
          initialActionId: manifest.agentRuntime.initialActionId,
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

export interface GameAssetIndex {
  readonly gameId: string;
  // Images (ADR-063) and game-owned stylesheets (ADR-091) share one asset-id
  // namespace and one resolver form (asset:<id>). The client resolver only reads
  // `url`, so adding the `css` kind is additive for existing consumers.
  readonly assets: Readonly<Record<string, { readonly url: string; readonly kind: "image" | "css" }>>;
}

export interface GameAssetFileDelivery {
  readonly bytes: Buffer;
  readonly contentType: string;
  readonly extension: string;
}

export interface GameStylesheetDelivery {
  readonly text: string;
  readonly contentType: string;
}

interface PublishedGameStylesheet {
  readonly stylesheetId: string;
  readonly gameId: string;
  readonly contentHash: string;
  readonly integrity: string;
  readonly filePath: string;
  readonly url: string;
}

interface PublishedGameStylesheetMetadata {
  readonly schemaVersion: "1.0";
  readonly stylesheets: readonly PublishedGameStylesheet[];
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
  private readonly gameAssetHashCache = new Map<string, { readonly mtimeMs: number; readonly sha256: string }>();
  
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

  /**
   * Lists ids of games available in the default (published) repository.
   *
   * Used by the runtime readiness probe to discover a game to load without
   * hardcoding a concrete game id in core layers.
   */
  async listGameIds(): Promise<readonly string[]> {
    return this.repository.listGameIds();
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

  /**
   * Builds the public id-to-content-addressed-URL index for one game.
   *
   * The index unifies two delivery paths behind one `asset:<id>` namespace:
   * images are hashed from their source files on the fly (ADR-063), while
   * game-owned stylesheets point at their pre-published content-addressable URLs
   * (ADR-091). The player-web renderer and Phaser scenes resolve both through
   * this single index; an unknown id fails closed on the client.
   */
  async getGameAssetIndex(gameId: string): Promise<GameAssetIndex> {
    const registry = await this.loadGameAssetsRegistry(gameId);
    const imageEntries = await Promise.all(registry.assets.map(async (asset) => {
      const sha256 = await this.getGameAssetHash(gameId, asset.file);
      const extension = path.extname(asset.file).slice(1).toLowerCase();
      return [asset.id, {
        url: `/game-assets/${encodeURIComponent(gameId)}/${encodeURIComponent(asset.id)}/${sha256}.${extension}`,
        kind: asset.kind
      }] as const;
    }));

    const stylesheetMetadata = await this.loadPublishedGameStylesheets(gameId);
    const stylesheetEntries = stylesheetMetadata.map((stylesheet) => [
      stylesheet.stylesheetId,
      { url: stylesheet.url, kind: "css" as const }
    ] as const);

    return { gameId, assets: Object.fromEntries([...imageEntries, ...stylesheetEntries]) };
  }

  /** Resolves and verifies one immutable published stylesheet request. */
  async getGameStylesheetSource(input: {
    readonly gameId: string;
    readonly stylesheetId: string;
    readonly contentHash: string;
  }): Promise<GameStylesheetDelivery> {
    const stylesheets = await this.loadPublishedGameStylesheets(input.gameId);
    const stylesheet = stylesheets.find((candidate) =>
      candidate.stylesheetId === input.stylesheetId &&
      candidate.gameId === input.gameId &&
      candidate.contentHash === input.contentHash
    );
    if (stylesheet === undefined) {
      throw new NotFoundError("Game stylesheet was not found");
    }

    const text = await this.repository.getPublishedGameStylesheetRaw(input.gameId, stylesheet.filePath);
    const actualHash = createHash("sha256").update(text, "utf8").digest("hex");
    if (actualHash !== stylesheet.contentHash) {
      throw new Error(`Published stylesheet "${input.stylesheetId}" failed contentHash verification.`);
    }
    return { text, contentType: GAME_STYLESHEET_CONTENT_TYPE };
  }

  /** Loads and validates the optional ADR-091 published stylesheet index. */
  private async loadPublishedGameStylesheets(gameId: string): Promise<readonly PublishedGameStylesheet[]> {
    const raw = await this.repository.getPublishedGameStylesheetsRaw(gameId);
    if (raw === undefined) {
      return [];
    }

    let parsed: PublishedGameStylesheetMetadata;
    try {
      parsed = JSON.parse(raw) as PublishedGameStylesheetMetadata;
    } catch {
      throw new Error(`Published game stylesheet metadata for "${gameId}" must be valid JSON.`);
    }
    if (!validateGameStylesheetsMetadata(parsed)) {
      const errors = (validateGameStylesheetsMetadata.errors ?? [])
        .map((error: any) => `${error.instancePath || "/"} ${error.message}`)
        .join("; ");
      throw new Error(`Published game stylesheet metadata for "${gameId}" is invalid: ${errors}`);
    }
    for (const stylesheet of parsed.stylesheets) {
      if (stylesheet.gameId !== gameId) {
        throw new Error(`Published game stylesheet metadata for "${gameId}" contains a foreign gameId.`);
      }
    }
    return parsed.stylesheets;
  }

  /** Resolves and verifies one immutable asset request against the registry. */
  async getGameAssetFile(input: {
    readonly gameId: string;
    readonly assetId: string;
    readonly contentHash: string;
    readonly extension: string;
  }): Promise<GameAssetFileDelivery> {
    const registry = await this.loadGameAssetsRegistry(input.gameId);
    const asset = registry.assets.find((candidate) => candidate.id === input.assetId);
    if (asset === undefined) {
      throw new NotFoundError("Game asset was not found");
    }

    const registeredExtension = path.extname(asset.file).slice(1).toLowerCase();
    if (registeredExtension !== input.extension || GAME_ASSET_CONTENT_TYPES[registeredExtension] === undefined) {
      throw new NotFoundError("Game asset was not found");
    }

    const metadataBefore = await this.getGameAssetMetadataOrNotFound(input.gameId, asset.file);
    const expectedHash = await this.getGameAssetHash(input.gameId, asset.file, metadataBefore.mtimeMs);
    if (expectedHash !== input.contentHash) {
      throw new NotFoundError("Game asset was not found");
    }

    const bytes = await this.getGameAssetBytesOrNotFound(input.gameId, asset.file);
    const metadataAfter = await this.getGameAssetMetadataOrNotFound(input.gameId, asset.file);
    if (metadataAfter.mtimeMs !== metadataBefore.mtimeMs) {
      const actualHash = createHash("sha256").update(bytes).digest("hex");
      this.gameAssetHashCache.set(`${input.gameId}:${asset.file}`, {
        mtimeMs: metadataAfter.mtimeMs,
        sha256: actualHash
      });
      if (actualHash !== input.contentHash) {
        throw new NotFoundError("Game asset was not found");
      }
    }

    return {
      bytes,
      contentType: GAME_ASSET_CONTENT_TYPES[registeredExtension],
      extension: registeredExtension
    };
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

  private async loadGameAssetsRegistry(gameId: string): Promise<RootGameAssets> {
    const raw = await this.repository.getGameAssetsRegistryRaw(gameId);
    if (raw === undefined) {
      throw new NotFoundError(`Game assets for "${gameId}" were not found`);
    }

    let registry: unknown;
    try {
      registry = JSON.parse(raw);
    } catch {
      throw new Error(`Game asset registry for "${gameId}" must be valid JSON.`);
    }
    if (!validateGameAssetsRegistry(registry)) {
      const errors = (validateGameAssetsRegistry.errors ?? [])
        .map((error: any) => `${error.instancePath || "/"} ${error.message}`)
        .join("; ");
      throw new Error(`Game asset registry for "${gameId}" is invalid: ${errors}`);
    }
    const typedRegistry = registry as RootGameAssets;
    if (typedRegistry.gameId !== gameId) {
      throw new Error(`Game asset registry gameId must equal "${gameId}".`);
    }
    return typedRegistry;
  }

  private async getGameAssetHash(gameId: string, file: string, knownMtimeMs?: number): Promise<string> {
    const metadata = knownMtimeMs === undefined
      ? await this.getGameAssetMetadataOrNotFound(gameId, file)
      : { mtimeMs: knownMtimeMs };
    const cacheKey = `${gameId}:${file}`;
    const cached = this.gameAssetHashCache.get(cacheKey);
    if (cached?.mtimeMs === metadata.mtimeMs) {
      return cached.sha256;
    }

    const bytes = await this.getGameAssetBytesOrNotFound(gameId, file);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    this.gameAssetHashCache.set(cacheKey, { mtimeMs: metadata.mtimeMs, sha256 });
    return sha256;
  }

  private async getGameAssetMetadataOrNotFound(gameId: string, file: string) {
    try {
      return await this.repository.getGameAssetFileMetadata(gameId, file);
    } catch (error) {
      if (isMissingFileError(error)) {
        throw new NotFoundError("Game asset was not found");
      }
      throw error;
    }
  }

  private async getGameAssetBytesOrNotFound(gameId: string, file: string): Promise<Buffer> {
    try {
      return await this.repository.getGameAssetFileBytes(gameId, file);
    } catch (error) {
      if (isMissingFileError(error)) {
        throw new NotFoundError("Game asset was not found");
      }
      throw error;
    }
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

/**
 * Lists ids of games available in the default (published) repository.
 *
 * Thin module-level wrapper over {@link ContentService.listGameIds} for callers
 * (like the readiness probe) that use the shared singleton.
 */
export async function listAvailableGameIds(): Promise<readonly string[]> {
  return contentService.listGameIds();
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

export async function getGameAssetIndex(gameId: string): Promise<GameAssetIndex> {
  return contentService.getGameAssetIndex(gameId);
}

export async function getGameAssetFile(input: {
  readonly gameId: string;
  readonly assetId: string;
  readonly contentHash: string;
  readonly extension: string;
}): Promise<GameAssetFileDelivery> {
  return contentService.getGameAssetFile(input);
}

export async function getGameStylesheetSource(input: {
  readonly gameId: string;
  readonly stylesheetId: string;
  readonly contentHash: string;
}): Promise<GameStylesheetDelivery> {
  return contentService.getGameStylesheetSource(input);
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "ENOENT";
}
