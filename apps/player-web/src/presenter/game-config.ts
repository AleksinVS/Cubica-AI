import type { GamePlayerUiContent, PlayerFacingContent } from "@cubica/contracts-manifest";
import type { GamePlayerBoard, GamePlayerBoardCard, GamePlayerInfoEntry, GamePlayerTeamSelectionScene } from "@/plugins/antarctica/contracts";

import type { RuntimeUiState } from "@/types/game-state";
import type { GameSession } from "@/types/game-state";
import type { ActionEntry } from "@/lib/game-content-resolvers";
import {
  resolveGameContent,
  resolveCurrentBoard,
  resolveCurrentInfoEntry,
  resolveCurrentTeamSelectionScene,
  resolveBoardCards,
  readSelectedCardId,
  readCardFlags,
  readTeamFlags,
  readTeamSelection,
  readCanAdvance,
  getFallbackActionEntries
} from "@/lib/game-content-resolvers";
import { createManifestActionAdapter } from "@/lib/manifest-action-adapter";

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
 * Конфигурация конкретной игры для Presenter и View.
 *
 * Все game-specific параметры (gameId, storageKey, fallback метрики,
 * правила маршрутизации экранов, фоновые изображения) живут здесь,
 * а не в generic слоях платформы.
 *
 * Generic параметры:
 * - TGameState: разрешённое game-specific состояние (currentBoard, boardCards и т.д.)
 * - TUiContent: тип UI-контента манифеста (screens, entryPoint)
 */
export interface GameConfig<TGameState, TUiContent> {
  /** Идентификатор игры в runtime-api */
  gameId: string;

  /** Идентификатор игрока для runtime-api */
  playerId: string;

  /** Ключ localStorage для сохранения sessionId */
  storageKey: string;

  /** Fallback-спецификации метрик */
  fallbackMetrics: ReadonlyArray<FallbackMetricSpec>;

  /** Набор ключей экранов, которые используют topbar-раскладку */
  topbarScreenKeys: Set<string>;

  /** Фоновые изображения метрик в topbar-режиме */
  metricBackgroundImages: Record<string, string>;

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
 * Конфигурация игры Антарктида.
 * Централизует все game-specific знания, которые раньше были
 * размазаны по lib/ и presenter/.
 */
export const ANTARCTICA_GAME_CONFIG: GameConfig<AntarcticaGameState, GamePlayerUiContent> = {
  gameId: "antarctica",
  playerId: "player-web",
  storageKey: "cubica-antarctica-session-id",

  fallbackMetrics: [
    { id: "score", caption: "Остаток дней", aliases: ["score", "days", "time"], sidebarImage: "/images/left-sidebar/days.png", topbarImage: "/images/top-sidebar/days-top.png" },
    { id: "pro", caption: "Знания", aliases: ["pro", "knowledge"], sidebarImage: "/images/left-sidebar/znania.png", topbarImage: "/images/top-sidebar/znaniya.png" },
    { id: "rep", caption: "Доверие", aliases: ["rep", "trust"], sidebarImage: "/images/left-sidebar/doverie.png", topbarImage: "/images/top-sidebar/doverie.png" },
    { id: "energy", caption: "Энергия", aliases: ["energy", "lid"], sidebarImage: "/images/left-sidebar/energia.png", topbarImage: "/images/top-sidebar/energia.png" },
    { id: "control", caption: "Контроль", aliases: ["control", "man"], sidebarImage: "/images/left-sidebar/kontrol.png", topbarImage: "/images/top-sidebar/kontrol.png" },
    { id: "status", caption: "Статус", aliases: ["status", "stat"], sidebarImage: "/images/left-sidebar/status.png", topbarImage: "/images/top-sidebar/status.png" },
    { id: "contact", caption: "Контакт", aliases: ["contact", "cont"], sidebarImage: "/images/left-sidebar/kontakt.png", topbarImage: "/images/top-sidebar/kontakt.png" },
    { id: "constructive", caption: "Конструктив", aliases: ["constructive", "constr"], sidebarImage: "/images/left-sidebar/konstruktiv.png", topbarImage: "/images/top-sidebar/konstruktiv.png" }
  ],

  topbarScreenKeys: new Set([
    "55..60",
    "61..66",
    "67..68",
    "69..70"
  ]),

  metricBackgroundImages: {
    score: "/images/top-sidebar/days-top.png",
    pro: "/images/top-sidebar/znaniya.png",
    rep: "/images/top-sidebar/doverie.png",
    energy: "/images/top-sidebar/energia.png",
    lid: "/images/top-sidebar/energia.png",
    control: "/images/top-sidebar/kontrol.png",
    man: "/images/top-sidebar/kontrol.png",
    status: "/images/top-sidebar/status.png",
    stat: "/images/top-sidebar/status.png",
    contact: "/images/top-sidebar/kontakt.png",
    cont: "/images/top-sidebar/kontakt.png",
    constructive: "/images/top-sidebar/konstruktiv.png",
    constr: "/images/top-sidebar/konstruktiv.png"
  },

  resolveBoardScreenKey(stepIndex) {
    if (stepIndex === null) return null;
    if (stepIndex === 30) return "55..60";
    if (stepIndex === 32) return "61..66";
    if (stepIndex === 34) return "67..68";
    if (stepIndex === 36) return "69..70";
    return null;
  },

  resolveScreenKey(screenId, stepIndex, infoId, runtimeUi, gameUi) {
    if (screenId === "S2") {
      const boardKey = this.resolveBoardScreenKey(stepIndex);
      if (boardKey && gameUi?.screens[boardKey]) {
        return boardKey;
      }
      return null;
    }

    if (screenId === "S1") {
      if (runtimeUi.activeScreen === "left-sidebar" && gameUi?.screens["S1_LEFT"]) {
        return "S1_LEFT";
      }
      // Info screens: use activeInfoId for variant disambiguation (i19 vs i19_1).
      // If the info has a dedicated UI screen, use that screen.
      if (infoId && gameUi?.screens[infoId]) {
        return infoId;
      }
      // If activeInfoId is set but has no dedicated UI screen (e.g. i0, i7),
      // return null so the FallbackRenderer shows the info content.
      if (infoId) {
        return null;
      }
      // No activeInfoId set — use the generic S1 placeholder screen if available.
      if (gameUi?.screens["S1"]) {
        return "S1";
      }
      return null;
    }

    if (screenId && gameUi?.screens[screenId]) {
      return screenId;
    }

    return null;
  },

  resolveLayoutMode(screenKey, runtimeUi, gameState) {
    const { currentBoard, currentInfo } = gameState;
    if (runtimeUi.activeScreen === "topbar") {
      return "topbar";
    }
    if (runtimeUi.activeScreen === "left-sidebar") {
      return "leftsidebar";
    }
    if (screenKey && this.topbarScreenKeys.has(screenKey)) {
      return "topbar";
    }
    if (currentBoard) {
      return "topbar";
    }
    if (currentInfo && currentInfo.id !== "i0") {
      return "topbar";
    }
    return "topbar";
  },

  resolveGameState(content, session) {
    const publicState = session?.state?.public as Record<string, unknown> | undefined;
    const gameContent = resolveGameContent(content);
    const currentInfo = resolveCurrentInfoEntry(gameContent, publicState);
    const currentBoard = resolveCurrentBoard(gameContent, publicState);
    const currentTeamSelection = resolveCurrentTeamSelectionScene(gameContent, publicState);
    const cardFlags = readCardFlags(session);
    const selectedCardId = readSelectedCardId(session);
    const boardCards = resolveBoardCards(gameContent, currentBoard, cardFlags);
    const teamFlags = readTeamFlags(session);
    const teamSelectionState = readTeamSelection(session);
    const canAdvance = readCanAdvance(session);
    const fallbackActions = getFallbackActionEntries(content);
    const selectedMemberIds = teamSelectionState.selectedMemberIds ?? [];
    const pickCount = teamSelectionState.pickCount ?? 0;
    const selectedTeamMemberIds =
      selectedMemberIds.length > 0
        ? selectedMemberIds
        : Object.keys(teamFlags).filter((memberId) => teamFlags[memberId]?.selected);
    const selectedCard =
      selectedCardId && boardCards.length > 0
        ? boardCards.find((card) => card.cardId === selectedCardId) ?? null
        : null;

    return {
      currentInfo,
      currentBoard,
      currentTeamSelection,
      cardFlags,
      selectedCardId,
      selectedCard,
      boardCards,
      teamFlags,
      selectedMemberIds: selectedTeamMemberIds,
      pickCount,
      canAdvance,
      fallbackActions
    };
  },

  createManifestActionAdapter(content, gameState, dispatchAction, onError) {
    return createManifestActionAdapter({
      gameContent: resolveGameContent(content),
      boardCards: gameState.boardCards,
      dispatchAction,
      onError
    });
  }
};
