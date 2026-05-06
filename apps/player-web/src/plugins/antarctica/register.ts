import { registerGameResolvers } from "@/presenter/game-config-registry";
import type { GameConfigData, GameConfig, ResolverFactory } from "@/presenter/game-config";
import type { AntarcticaGameState } from "@/presenter/game-config";
import type { GamePlayerUiContent, PlayerFacingContent } from "@cubica/contracts-manifest";
import type { RuntimeUiState, GameSession } from "@/types/game-state";
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
 * Фабрика резолверов для игры Антарктида.
 *
 * Получает сериализуемые данные (GameConfigData), создаёт полный
 * GameConfig с работающими this-ссылками между методами.
 * this-ссылки корректны, потому что все методы определены
 * на одном объекте, который возвращается из фабрики.
 */
const createAntarcticaConfig: ResolverFactory<AntarcticaGameState, GamePlayerUiContent> = (
  data: GameConfigData
): GameConfig<AntarcticaGameState, GamePlayerUiContent> => {
  const topbarScreenKeys = new Set(data.topbarScreenKeys);

  return {
    gameId: data.gameId,
    playerId: data.playerId,
    storageKey: data.storageKey,
    fallbackMetrics: data.fallbackMetrics,
    topbarScreenKeys,
    metricBackgroundImages: data.metricBackgroundImages,

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
        if (infoId && gameUi?.screens[infoId]) {
          return infoId;
        }
        if (infoId) {
          return null;
        }
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
};

/**
 * Регистрация фабрики резолверов Антарктиды в глобальном реестре.
 * Выполняется при импорте модуля (побочный эффект).
 */
registerGameResolvers<AntarcticaGameState, GamePlayerUiContent>(
  "antarctica",
  createAntarcticaConfig
);