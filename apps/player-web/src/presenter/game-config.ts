import type {
  GameManifestObjectModel,
  GameManifestObjectModelMap,
  GameManifestObjectState,
  GameManifestObjectViewRule,
  GamePlayerUiContent,
  PlayerFacingContent,
  GameState,
  MetricConfigSpec
} from "@cubica/contracts-manifest";

import type { MetricsSnapshot } from "@/types/game-state";
import type { GameSession } from "@/types/game-state";
import type { PlayerLayoutMode } from "@/lib/player-layout-mode";

/**
 * Спецификация одной fallback-метрики.
 * Используется, когда UI-манифест не предоставляет собственные описания метрик.
 *
 * @deprecated Смысл и подписи метрик должны приходить из game manifest metric
 * catalog. FallbackMetricSpec остается только для legacy fallback-экранов.
 */
export interface FallbackMetricSpec {
  id: string;
  caption: string;
  description?: string;
  aliases: Array<string>;
  sidebarImage: string;
  topbarImage: string;
}

/**
 * Сериализуемая часть конфигурации игры.
 * Содержит только данные, которые можно безопасно передать
 * через границу Server → Client Component в Next.js.
 *
 * Функциональные свойства (резолверы) не сериализуемы и
 * предоставляются клиентской стороной через реестр (game-config-registry).
 * topbarScreenKeys — Array вместо Set для совместимости с JSON.
 */
export interface GameConfigData {
  /** Идентификатор игры в runtime-api */
  gameId: string;

  /** Ключ localStorage для сохранения sessionId */
  storageKey: string;

  /** Fallback-спецификации метрик */
  fallbackMetrics: ReadonlyArray<FallbackMetricSpec>;

  /** Ключи экранов, использующих topbar-раскладку (массив для JSON-сериализации) */
  topbarScreenKeys: Array<string>;

  /** Фоновые изображения метрик в topbar-режиме */
  metricBackgroundImages: Record<string, string>;

  /**
   * Optional game-owned background used by shared player layouts.
   *
   * The generic player deliberately has no product-specific fallback image.
   * A game plugin may opt in to its own visual identity without making that
   * identity an unconditional part of every game rendered by player-web.
   */
  themeBackgroundImage?: string;
}

/**
 * Функциональные резолверы конфигурации игры.
 * Не могут быть сериализованы и должны быть зарегистрированы
 * на клиентской стороне через реестр (game-config-registry).
 *
 * Generic параметры:
 * - TGameState: game-specific состояние (по умолчанию GameState — generic Record)
 * - TUiContent: тип UI-контента манифеста (по умолчанию GamePlayerUiContent)
 */
export interface GameConfigResolvers<TGameState = GameState, TUiContent = GamePlayerUiContent> {
  /**
   * Maps stepIndex to a manifest screen key for board screens.
   * Optional — games without boards can omit this (defaults to null).
   * Board-centric games (Antarctica) override this with step-to-screen mappings.
   */
  resolveBoardScreenKey?: (stepIndex: number | null) => string | null;

  /**
   * Resolves a manifest screen key from the current timeline state.
   * Optional — when omitted, the data-driven screen router is used
   * (matching against screenRouting entries from the UI manifest,
   * then direct screenId lookup, then activeInfoId disambiguation).
   * Board-centric games (Antarctica) override this for step-to-screen mappings.
   *
   * Layout is a design-time choice declared in the UI manifest
   * (`defaultLayoutMode`, ADR-093), so this resolver reads it from `uiContent`
   * rather than from server-side UI state.
   */
  resolveScreenKey?: (
    screenId: string | null,
    stepIndex: number | null,
    infoId: string | null,
    uiContent: TUiContent | undefined
  ) => string | null;

  /**
   * Determines the screen layout mode: topbar or leftsidebar.
   * Optional — when omitted, defaults to the data-driven layout resolver
   * (the design-time `defaultLayoutMode` from the UI manifest, ADR-093).
   */
  resolveLayoutMode?: (
    screenKey: string | null,
    gameState: TGameState
  ) => PlayerLayoutMode;

  /**
   * Разрешает PlayerFacingContent + session snapshot в game-specific состояние.
   * Вызывается Presenter-ом при каждом syncView.
   */
  resolveGameState: (content: PlayerFacingContent, session: GameSession | null) => TGameState;

  /**
   * Опциональный builder для fallback-экранов.
   * Вызывается SafeModeRenderer, когда манифест не описывает экран.
   * Плагин может предоставить кастомный builder для генерации
   * GameUiScreenDefinition из game-specific состояния.
   */
  /**
   * Опциональный hook для деривации (производных) метрик.
   * Вызывается Presenter-ом при каждом syncView.
   * Позволяет игре добавлять legacy-проекции, пока вычисляемые метрики
   * переносятся в game manifest metric catalog.
   */
  resolveMetrics?: (metrics: MetricsSnapshot) => MetricsSnapshot;

  /**
   * Опциональный builder для fallback-экранов.
   * Вызывается SafeModeRenderer, когда манифест не описывает экран.
   * Плагин может предоставить кастомный builder для генерации
   * GameUiScreenDefinition из game-specific состояния.
   */
  fallbackScreenBuilder?: (
    gameState: Record<string, unknown>,
    content: PlayerFacingContent,
    layoutMode: "leftsidebar" | "topbar",
    fallbackMetrics: ReadonlyArray<FallbackMetricSpec>,
    metrics: Record<string, unknown>,
    onAction: (actionId: string) => void
  ) => import("@cubica/contracts-manifest").GameUiScreenDefinition | null;
}

/**
 * Полная конфигурация конкретной игры для Presenter и View.
 *
 * Объединяет сериализуемые данные (GameConfigData) и
 * клиентские резолверы (GameConfigResolvers).
 * topbarScreenKeys в полном конфиге — Set для O(1) поиска.
 *
 * Generic параметры:
 * - TGameState: разрешённое game-specific состояние (по умолчанию GameState)
 * - TUiContent: тип UI-контента манифеста (по умолчанию GamePlayerUiContent)
 */
export interface GameConfig<TGameState = GameState, TUiContent = GamePlayerUiContent> extends GameConfigResolvers<TGameState, TUiContent> {
  /** Идентификатор игры в runtime-api */
  gameId: string;

  /** Ключ localStorage для сохранения sessionId */
  storageKey: string;

  /** Fallback-спецификации метрик */
  fallbackMetrics: ReadonlyArray<FallbackMetricSpec>;

  /** Набор ключей экранов, которые используют topbar-раскладку (Set для O(1) поиска) */
  topbarScreenKeys: Set<string>;

  /** Фоновые изображения метрик в topbar-режиме */
  metricBackgroundImages: Record<string, string>;

  /** Optional game-owned background exposed to shared layout styles. */
  themeBackgroundImage?: string;
}

/**
 * Фабрика, создающая полный GameConfig из сериализуемых данных.
 * Регистрируется в реестре (game-config-registry) для каждой игры.
 * Получает GameConfigData, возвращает объект с работающими this-ссылками.
 */
export type ResolverFactory<TGameState = GameState, TUiContent = GamePlayerUiContent> = (
  data: GameConfigData
) => GameConfig<TGameState, TUiContent>;

/**
 * Converts MetricConfigSpec from the UI manifest to FallbackMetricSpec
 * for backward compatibility with SafeModeRenderer and GamePlayer.
 *
 * When metric_specs are available in the UI manifest, games can skip
 * defining fallbackMetrics in GameConfigData and derive them from the manifest instead.
 */
export function metricSpecsToFallbackMetrics(specs: Array<MetricConfigSpec>): Array<FallbackMetricSpec> {
  return specs.map((spec) => ({
    id: spec.id,
    caption: spec.caption,
    description: spec.description,
    aliases: spec.aliases ?? [spec.id],
    sidebarImage: spec.images?.sidebar ?? "",
    topbarImage: spec.images?.topbar ?? "",
  }));
}

const SAFE_STORAGE_ID = /[^a-zA-Z0-9_-]+/g;

const toMetricBackgroundImages = (
  specs: ReadonlyArray<FallbackMetricSpec>
): Record<string, string> => {
  const images: Record<string, string> = {};

  for (const spec of specs) {
    const image = spec.topbarImage || spec.sidebarImage;
    if (!image) {
      continue;
    }

    images[spec.id] = image;
    for (const alias of spec.aliases) {
      images[alias] = image;
    }
  }

  return images;
};

const collectTopbarScreenKeys = (
  uiContent: GamePlayerUiContent | undefined
): Array<string> => {
  if (!uiContent) {
    return [];
  }

  const keys = new Set<string>();
  for (const [screenKey, screen] of Object.entries(uiContent.screens)) {
    if (screen.layoutMode === "topbar") {
      keys.add(screenKey);
    }
  }

  for (const entry of uiContent.screenRouting ?? []) {
    if (entry.conditions.layoutMode === "topbar") {
      keys.add(entry.screenKey);
    }
  }

  return [...keys];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * View projection rules may shape presentation, but they must not derive a
 * gameplay command from mutable object state. The explicit allowlist keeps a
 * removed command-derivation field out of production code even while an older
 * generated contract may still expose it during the repository-wide cutover.
 */
type PlayerObjectViewRule = Pick<
  GameManifestObjectViewRule,
  | "fields"
  | "interactive"
  | "selectLabelFrom"
  | "summaryFrom"
  | "textFrom"
  | "titleFrom"
  | "visible"
  | "visualState"
>;

const splitJsonPointer = (path: string): Array<string> =>
  path.startsWith("/")
    ? path.slice(1).split("/").map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"))
    : [];

const readProjectedSource = (source: Record<string, unknown>, path: string): unknown => {
  if (path.startsWith("/")) {
    let current: unknown = source;
    for (const segment of splitJsonPointer(path)) {
      if (!isRecord(current)) {
        return undefined;
      }
      current = current[segment];
    }
    return current;
  }

  let current: unknown = source;
  for (const segment of path.split(".")) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
};

const modelForCollection = (
  objectModels: GameManifestObjectModelMap,
  collection: string
): GameManifestObjectModel | undefined =>
  Object.values(objectModels).find((model) => model.collection === collection);

const objectTypeForCollection = (
  objectModels: GameManifestObjectModelMap,
  collection: string
): string | undefined =>
  Object.entries(objectModels).find(([, model]) => model.collection === collection)?.[0];

const defaultObjectFacets = (model: GameManifestObjectModel | undefined): Record<string, unknown> => {
  const facets: Record<string, unknown> = {};
  for (const [facetId, facet] of Object.entries(model?.facets ?? {})) {
    facets[facetId] = facet.initial;
  }
  return facets;
};

const applyObjectViewRule = (
  view: Record<string, unknown>,
  source: Record<string, unknown>,
  rule: PlayerObjectViewRule
) => {
  if (rule.visible !== undefined) {
    view.visible = rule.visible;
  }
  if (rule.interactive !== undefined) {
    view.interactive = rule.interactive;
  }
  if (rule.visualState !== undefined) {
    view.visualState = rule.visualState;
  }

  const mappedFields: Array<[string, string | undefined]> = [
    ["title", rule.titleFrom],
    ["summary", rule.summaryFrom],
    ["text", rule.textFrom],
    ["selectLabel", rule.selectLabelFrom],
  ];

  for (const [targetField, sourceField] of mappedFields) {
    if (!sourceField) {
      continue;
    }
    const value = readProjectedSource(source, sourceField);
    if (value !== undefined) {
      view[targetField] = value;
    }
  }

  for (const [targetField, sourceField] of Object.entries(rule.fields ?? {})) {
    // `fields` remains available for game-specific presentation data, but it
    // must not act as a second spelling of the removed action-derivation route.
    // Command identity comes only from trusted published content or explicit
    // validated UI action payloads, never from mutable session attributes.
    if (targetField === "actionId") {
      continue;
    }
    const value = readProjectedSource(source, sourceField);
    if (value !== undefined) {
      view[targetField] = value;
    }
  }
};

const projectObjectViews = (
  objectModels: GameManifestObjectModelMap | undefined,
  contentData: unknown,
  publicState: Record<string, unknown>
): Record<string, Array<Record<string, unknown>>> => {
  if (!objectModels || Object.keys(objectModels).length === 0) {
    return {};
  }

  const contentCollections = isRecord(contentData) ? contentData : {};
  const stateObjects = isRecord(publicState.objects) ? publicState.objects : {};
  const collections = new Set<string>([
    ...Object.values(objectModels).map((model) => model.collection),
    ...Object.keys(stateObjects)
  ]);
  const projected: Record<string, Array<Record<string, unknown>>> = {};

  for (const collectionId of collections) {
    const staticItems = Array.isArray(contentCollections[collectionId])
      ? contentCollections[collectionId] as Array<unknown>
      : [];
    const staticById = new Map<string, Record<string, unknown>>();
    const fallbackModel = modelForCollection(objectModels, collectionId);
    const idField = fallbackModel?.idField ?? "id";

    for (const item of staticItems) {
      if (!isRecord(item)) {
        continue;
      }
      const itemId = item[idField] ?? item.id;
      if (typeof itemId === "string" || typeof itemId === "number") {
        staticById.set(String(itemId), item);
      }
    }

    const stateCollection = isRecord(stateObjects[collectionId]) ? stateObjects[collectionId] : {};
    const objectIds = new Set<string>([
      ...staticById.keys(),
      ...Object.keys(stateCollection)
    ]);
    const collectionViews: Array<Record<string, unknown>> = [];

    for (const objectId of objectIds) {
      const rawInstance = isRecord(stateCollection[objectId])
        ? stateCollection[objectId] as unknown as GameManifestObjectState
        : undefined;
      const staticData = staticById.get(objectId) ?? {};
      const objectType = rawInstance?.objectType ?? objectTypeForCollection(objectModels, collectionId);
      const model = objectType ? objectModels[objectType] : fallbackModel;
      const facets = {
        ...defaultObjectFacets(model),
        ...(isRecord(rawInstance?.facets) ? rawInstance?.facets : {})
      };
      const attributes = isRecord(rawInstance?.attributes) ? rawInstance.attributes : {};
      const source: Record<string, unknown> = {
        ...staticData,
        ...attributes,
        collection: collectionId,
        objectId,
        objectType,
        facets,
        attributes,
        data: staticData
      };
      const view: Record<string, unknown> = {
        collection: collectionId,
        objectId,
        objectType,
        facets,
        attributes,
        data: staticData,
        visible: true,
        interactive: true,
        title: source.title,
        summary: source.summary,
        text: source.text,
        backText: source.backText,
        actionId: source.actionId,
        selectLabel: source.selectLabel,
        chips: source.chips,
        visualState: "default"
      };

      for (const [facetId, value] of Object.entries(facets)) {
        const rule = model?.view?.facets?.[`${facetId}.${String(value)}`];
        if (rule) {
          applyObjectViewRule(view, source, rule);
        }
      }

      if (view.visible !== false) {
        collectionViews.push(view);
      }
    }

    projected[collectionId] = collectionViews;
  }

  return projected;
};

/**
 * Builds the serializable player config for games that do not need a custom
 * web plugin. The source of truth is player-facing content projected by
 * runtime-api; the resulting config contains only values that can cross the
 * Next.js Server Component to Client Component boundary.
 */
export function createDefaultGameConfigData(
  content: PlayerFacingContent,
  uiContent: GamePlayerUiContent | undefined = content.ui
): GameConfigData {
  const fallbackMetrics = uiContent?.metricSpecs
    ? metricSpecsToFallbackMetrics(uiContent.metricSpecs)
    : [];
  const safeGameId = content.gameId.replace(SAFE_STORAGE_ID, "-");

  return {
    gameId: content.gameId,
    storageKey: `cubica-${safeGameId}-session-id`,
    fallbackMetrics,
    topbarScreenKeys: collectTopbarScreenKeys(uiContent),
    metricBackgroundImages: toMetricBackgroundImages(fallbackMetrics),
  };
}

/**
 * Default game config used when no game plugin is registered.
 *
 * It deliberately contains only generic behavior: session state is exposed to
 * the manifest renderer, screen routing stays data-driven through the UI
 * manifest, and UI commands dispatch explicit action IDs from payload data.
 */
export function createDefaultGameConfig(data: GameConfigData): GameConfig {
  return {
    gameId: data.gameId,
    storageKey: data.storageKey,
    fallbackMetrics: data.fallbackMetrics,
    topbarScreenKeys: new Set(data.topbarScreenKeys),
    metricBackgroundImages: data.metricBackgroundImages,
    themeBackgroundImage: data.themeBackgroundImage,

    resolveGameState(content, session) {
      const state = session?.state as Record<string, unknown> | undefined;
      const publicState = (state?.public ?? {}) as Record<string, unknown>;
      const secretState = (state?.secret ?? {}) as Record<string, unknown>;
      // Turn-based manifests materialize participant metrics beside `public`
      // rather than inside it. Expose that player-facing branch to declarative
      // UI templates so generic hotseat panels can render balances and
      // positions without a game-specific config plugin.
      const playersState = (state?.players ?? {}) as Record<string, unknown>;
      const contentData = content.content?.data ?? content.content ?? null;

      return {
        public: publicState,
        secret: secretState,
        players: playersState,
        content: contentData,
        objectModels: content.objectModels ?? {},
        objectViews: projectObjectViews(content.objectModels, contentData, publicState),
        actions: content.actions,
      };
    },
  };
}
