/**
 * Antarctica player-web resolver factory.
 *
 * The factory turns serializable game config data into a full runtime config
 * with functions. It is exported for the plugin entrypoint and tests; it does
 * not register itself by module side effect.
 */

import type { GamePlayerUiContent } from "@cubica/contracts-manifest";
import type {
  GameConfig,
  GameConfigData,
  ResolverFactory
} from "@cubica/player-web/plugin-api";

import type { AntarcticaGameState } from "./contracts";
import {
  getFallbackActionEntries,
  readCanAdvance,
  readCardObjects,
  readSelectedCardId,
  readTeamFlags,
  readTeamSelection,
  resolveAntarcticaContent,
  resolveBoardCards,
  resolveCurrentBoard,
  resolveCurrentInfoEntry,
  resolveCurrentTeamSelectionScene,
  resolveJournalEntries,
  resolveJournalMetricSpecs,
  resolveLastInfoHintText
} from "./state-resolvers";

const BOARD_TOPBAR_SCREEN_KEY = "board-topbar";
const INFO_TOPBAR_SCREEN_KEY = "info-topbar";
const LEFT_SIDEBAR_SCREEN_KEY = "S1_LEFT";
const ENTRY_SCREEN_KEY = "S1";
// Antarctica uses S2 for several scenario scenes. Only these step indexes are
// board scenes, so the shared board UI variant must not capture team selection.
const ANTARCTICA_BOARD_STEP_INDEXES = new Set([9, 11, 13, 17, 19, 21, 23, 26, 28, 30, 32, 34, 36]);

export const createAntarcticaConfig: ResolverFactory<AntarcticaGameState, GamePlayerUiContent> = (
  data: GameConfigData
): GameConfig<AntarcticaGameState, GamePlayerUiContent> => {
  const topbarScreenKeys = new Set(data.topbarScreenKeys);

  return {
    gameId: data.gameId,
    storageKey: data.storageKey,
    fallbackMetrics: data.fallbackMetrics,
    topbarScreenKeys,
    metricBackgroundImages: data.metricBackgroundImages,
    themeBackgroundImage: data.themeBackgroundImage,

    resolveBoardScreenKey(stepIndex) {
      return stepIndex !== null && ANTARCTICA_BOARD_STEP_INDEXES.has(stepIndex) ? BOARD_TOPBAR_SCREEN_KEY : null;
    },

    resolveScreenKey(screenId, stepIndex, infoId, gameUi) {
      if (screenId === "S2") {
        const boardKey = this.resolveBoardScreenKey?.(stepIndex) ?? null;
        if (boardKey && gameUi?.screens[boardKey]) {
          return boardKey;
        }
        return null;
      }

      if (screenId === "S1") {
        // ADR-093: the leftsidebar variant is a design-time choice declared in
        // the UI manifest (default_layout_mode), not a server-side UI flag.
        if (gameUi?.defaultLayoutMode === "leftsidebar" && gameUi?.screens[LEFT_SIDEBAR_SCREEN_KEY]) {
          return LEFT_SIDEBAR_SCREEN_KEY;
        }
        if (infoId && gameUi?.screens[INFO_TOPBAR_SCREEN_KEY]) {
          return INFO_TOPBAR_SCREEN_KEY;
        }
        if (infoId) {
          return null;
        }
        if (gameUi?.screens[ENTRY_SCREEN_KEY]) {
          return ENTRY_SCREEN_KEY;
        }
        return null;
      }

      if (screenId && gameUi?.screens[screenId]) {
        return screenId;
      }

      return null;
    },

    resolveLayoutMode(screenKey) {
      // Every Antarctica screen declares its own layout_mode, so the presenter
      // uses that directly (ADR-093); this remains only as a safety fallback.
      // The leftsidebar design variant maps to the leftsidebar layout, every
      // other screen uses topbar.
      if (screenKey === LEFT_SIDEBAR_SCREEN_KEY) {
        return "leftsidebar";
      }
      return "topbar";
    },

    resolveGameState(content, session) {
      const publicState = session?.state?.public as Record<string, unknown> | undefined;
      const gameContent = resolveAntarcticaContent(content);
      const currentInfo = resolveCurrentInfoEntry(gameContent, publicState);
      const currentBoard = resolveCurrentBoard(gameContent, publicState);
      const currentTeamSelection = resolveCurrentTeamSelectionScene(gameContent, publicState);
      const cardObjects = readCardObjects(session);
      const selectedCardId = readSelectedCardId(session);
      const boardCards = resolveBoardCards(gameContent, currentBoard, cardObjects);
      const teamFlags = readTeamFlags(session);
      const teamSelectionState = readTeamSelection(session);
      const canAdvance = readCanAdvance(session);
      const fallbackActions = getFallbackActionEntries(content);
      const journalMetricSpecs = resolveJournalMetricSpecs(content, data.fallbackMetrics);
      const journalEntries = resolveJournalEntries(gameContent, publicState, journalMetricSpecs);
      const resolvedHintText =
        resolveLastInfoHintText(gameContent, { currentInfo, currentBoard, currentTeamSelection }) ??
        content.description ??
        "Подсказка пока не загружена";
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

      // Forward navigation arrow on card/board screens (W2-B / ADR-055): the
      // arrow advances the current board step when the game allows it. The
      // advance plan is the resolved card's advanceActionId — the same action
      // the "Продолжить" continue button carries once the board can advance.
      // We gate on both canAdvance (timeline flag) and the presence of that
      // action so a click never dispatches an empty action id.
      const forwardAdvanceActionId =
        canAdvance && selectedCard?.advanceActionId ? selectedCard.advanceActionId : "";
      const forwardNavDisabled = forwardAdvanceActionId.length === 0;

      return {
        currentInfo,
        currentBoard,
        currentTeamSelection,
        cardObjects,
        selectedCardId,
        selectedCard,
        boardCards,
        teamFlags,
        selectedMemberIds: selectedTeamMemberIds,
        pickCount,
        canAdvance,
        forwardAdvanceActionId,
        forwardNavDisabled,
        journalEntries,
        hasJournalEntries: journalEntries.length > 0,
        journalIsEmpty: journalEntries.length === 0,
        journalEmptyMessage: "Пока нет записей о выбранных карточках.",
        hintText: resolvedHintText,
        hasHintText: resolvedHintText.trim().length > 0,
        fallbackActions
      };
    }
  };
};
