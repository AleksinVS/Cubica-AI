import type { GamePlayerUiContent, PlayerFacingContent } from "@cubica/contracts-manifest";
import type { GamePlayerBoard, GamePlayerBoardCard, GamePlayerInfoEntry, GamePlayerTeamSelectionScene } from "@/plugins/antarctica/contracts";

import type { RuntimeUiState } from "@/types/game-state";
import type { GameSession } from "@/types/game-state";
import type { ActionEntry } from "@/lib/game-content-resolvers";

/**
 * Спецификация одной fallback-метрики.
 * Используется, когда UI-манифест не предоставляет собственные описания метрик.
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
 * Game-specific состояние для игры Антарктида.
 * Этот тип живёт внутри game-config.ts, потому что он часть
 * конфигурации конкретной игры, а не generic слоя платформы.
 *
 * TODO: перенести в plugins/antarctica/contracts.ts при следующей
 * итерации выноса game-specific типов из platform-модулей.
 */
export interface AntarcticaGameState {
  currentInfo: GamePlayerInfoEntry | null;
  currentBoard: GamePlayerBoard | null;
  currentTeamSelection: GamePlayerTeamSelectionScene | null;
  cardFlags: Record<string, { selected?: boolean; resolved?: boolean; locked?: boolean; available?: boolean }>;
  selectedCardId: string | null;
  selectedCard: GamePlayerBoardCard | null;
  boardCards: Array<GamePlayerBoardCard>;
  teamFlags: Record<string, { selected?: boolean }>;
  selectedMemberIds: Array<string>;
  pickCount: number;
  canAdvance: boolean;
  fallbackActions: Array<ActionEntry>;
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
 */
export interface GameConfigResolvers<TGameState, TUiContent> {
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
}

/**
 * Полная конфигурация конкретной игры для Presenter и View.
 *
 * Объединяет сериализуемые данные (GameConfigData) и
 * клиентские резолверы (GameConfigResolvers).
 * topbarScreenKeys в полном конфиге — Set для O(1) поиска.
 *
 * Generic параметры:
 * - TGameState: разрешённое game-specific состояние (currentBoard, boardCards и т.д.)
 * - TUiContent: тип UI-контента манифеста (screens, entryPoint)
 */
export interface GameConfig<TGameState, TUiContent> extends GameConfigResolvers<TGameState, TUiContent> {
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
export type ResolverFactory<TGameState, TUiContent> = (
  data: GameConfigData
) => GameConfig<TGameState, TUiContent>;