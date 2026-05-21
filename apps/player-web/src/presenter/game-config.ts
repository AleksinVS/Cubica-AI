import type { GamePlayerUiContent, PlayerFacingContent, GameState, MetricConfigSpec } from "@cubica/contracts-manifest";

import type { RuntimeUiState, MetricsSnapshot } from "@/types/game-state";
import type { GameSession } from "@/types/game-state";
import { createManifestActionAdapter as createGenericManifestActionAdapter } from "@/lib/manifest-action-adapter";

/**
 * Спецификация одной fallback-метрики.
 * Используется, когда UI-манифест не предоставляет собственные описания метрик.
 *
 * @deprecated Метрики должны описываться в UI-манифесте через gameVariableComponent.
 * FallbackMetricSpec останется до полного покрытия всех экранов манифестом.
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

  /** Идентификатор игрока для runtime-api */
  playerId: string;

  /** Ключ localStorage для сохранения sessionId */
  storageKey: string;

  /** Fallback-спецификации метрик */
  fallbackMetrics: ReadonlyArray<FallbackMetricSpec>;

  /** Ключи экранов, использующих topbar-раскладку (массив для JSON-сериализации) */
  topbarScreenKeys: Array<string>;

  /** Фоновые изображения метрик в topbar-режиме */
  metricBackgroundImages: Record<string, string>;
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
   */
  resolveScreenKey?: (
    screenId: string | null,
    stepIndex: number | null,
    infoId: string | null,
    runtimeUi: RuntimeUiState,
    uiContent: TUiContent | undefined
  ) => string | null;

  /**
   * Determines the screen layout mode: topbar or leftsidebar.
   * Optional — when omitted, defaults to the data-driven layout resolver
   * (checking screenRouting entries and runtimeUi.activeScreen).
   */
  resolveLayoutMode?: (
    screenKey: string | null,
    runtimeUi: RuntimeUiState,
    gameState: TGameState
  ) => "leftsidebar" | "topbar";

  /**
   * Разрешает PlayerFacingContent + session snapshot в game-specific состояние.
   * Вызывается Presenter-ом при каждом syncView.
   */
  resolveGameState: (content: PlayerFacingContent, session: GameSession | null) => TGameState;

  /**
   * Создаёт адаптер для UI-команд манифеста.
   * Вызывается View при получении onClick из ManifestRenderer.
   */
  createManifestActionAdapter: (
    content: PlayerFacingContent,
    gameState: TGameState,
    dispatchAction: (actionId: string, payload?: Record<string, unknown>) => void,
    onError: (message: string) => void
  ) => (command: string, payload: Record<string, unknown>) => void;

  /**
   * Опциональный builder для fallback-экранов.
   * Вызывается SafeModeRenderer, когда манифест не описывает экран.
   * Плагин может предоставить кастомный builder для генерации
   * GameUiScreenDefinition из game-specific состояния.
   */
  /**
   * Опциональный hook для деривации (производных) метрик.
   * Вызывается Presenter-ом при каждом syncView.
   * Позволяет игре вычислять производные метрики (например, score = 60 - time).
   */
  resolveMetrics?: (metrics: MetricsSnapshot) => MetricsSnapshot;

  /**
   * Опционально задаёт текст подсказки по умолчанию для конкретной игры.
   * Используется только когда нет явно открытого hint-контента.
   */
  resolveHintText?: (
    content: PlayerFacingContent,
    gameState: TGameState
  ) => string | null;

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

  /** Идентификатор игрока для runtime-api */
  playerId: string;

  /** Ключ localStorage для сохранения sessionId */
  storageKey: string;

  /** Fallback-спецификации метрик */
  fallbackMetrics: ReadonlyArray<FallbackMetricSpec>;

  /** Набор ключей экранов, которые используют topbar-раскладку (Set для O(1) поиска) */
  topbarScreenKeys: Set<string>;

  /** Фоновые изображения метрик в topbar-режиме */
  metricBackgroundImages: Record<string, string>;
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

const DEFAULT_PLAYER_ID = "player-web";
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

/**
 * Builds the serializable player config for games that do not need a custom
 * web plugin. The source of truth is player-facing content projected by
 * runtime-api; the resulting config contains only values that can cross the
 * Next.js Server Component to Client Component boundary.
 */
export function createDefaultGameConfigData(
  content: PlayerFacingContent,
  uiContent: GamePlayerUiContent | undefined = content.ui,
  options: { playerId?: string } = {}
): GameConfigData {
  const fallbackMetrics = uiContent?.metricSpecs
    ? metricSpecsToFallbackMetrics(uiContent.metricSpecs)
    : [];
  const safeGameId = content.gameId.replace(SAFE_STORAGE_ID, "-");

  return {
    gameId: content.gameId,
    playerId: options.playerId ?? DEFAULT_PLAYER_ID,
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
    playerId: data.playerId,
    storageKey: data.storageKey,
    fallbackMetrics: data.fallbackMetrics,
    topbarScreenKeys: new Set(data.topbarScreenKeys),
    metricBackgroundImages: data.metricBackgroundImages,

    resolveGameState(content, session) {
      const state = session?.state as Record<string, unknown> | undefined;
      const publicState = (state?.public ?? {}) as Record<string, unknown>;
      const secretState = (state?.secret ?? {}) as Record<string, unknown>;

      return {
        public: publicState,
        secret: secretState,
        content: content.content?.data ?? content.content ?? null,
        actions: content.actions,
      };
    },

    createManifestActionAdapter(_content, _gameState, dispatchAction, onError) {
      return createGenericManifestActionAdapter({
        gameContent: null,
        dispatchAction,
        onError,
      });
    },
  };
}
