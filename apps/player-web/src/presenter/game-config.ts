import type { GamePlayerUiContent, PlayerFacingContent, GameState } from "@cubica/contracts-manifest";

import type { RuntimeUiState, MetricsSnapshot } from "@/types/game-state";
import type { GameSession } from "@/types/game-state";

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
  /** Сопоставляет stepIndex с ключом экрана манифеста для S2-досок */
  resolveBoardScreenKey: (stepIndex: number | null) => string | null;

  /** Выбирает ключ экрана из манифеста UI по текущему состоянию timeline */
  resolveScreenKey: (
    screenId: string | null,
    stepIndex: number | null,
    infoId: string | null,
    runtimeUi: RuntimeUiState,
    uiContent: TUiContent | undefined
  ) => string | null;

  /** Определяет раскладку экрана: topbar или leftsidebar */
  resolveLayoutMode: (
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