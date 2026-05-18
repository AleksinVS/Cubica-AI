/**
 * Antarctica-specific state resolvers.
 *
 * Эти функции знают о структуре данных Антарктики (boards, infos, cards, teamSelections)
 * и используются только в Antarctica plugin (register.ts).
 * Платформенный слой (game-content-resolvers.ts) предоставляет обобщённые утилиты,
 * а эти функции — конкретные реализации для Антарктики.
 */

import type { PlayerFacingContent } from "@cubica/contracts-manifest";
import type { AntarcticaGameState, GamePlayerContent, GamePlayerBoardCard, GamePlayerBoard, GamePlayerInfoEntry, GamePlayerTeamSelectionScene } from "./contracts";
import type { SessionSnapshot } from "@/lib/game-content-resolvers";
import {
  resolveGameContent,
  readPublicState,
  readCardFlags as readCardFlagsGeneric,
  readTeamFlags as readTeamFlagsGeneric,
  readTeamSelection as readTeamSelectionGeneric,
  readCanAdvance as readCanAdvanceGeneric,
  readSelectedCardId as readSelectedCardIdGeneric,
  readStepIndex,
  readScreenId,
  getFallbackActionEntries,
} from "@/lib/game-content-resolvers";

type CardFlagState = {
  selected?: boolean;
  resolved?: boolean;
  locked?: boolean;
  available?: boolean;
};

/**
 * Извлекает Antarctica-специфичный контент из PlayerFacingContent.
 */
export function resolveAntarcticaContent(content: PlayerFacingContent): GamePlayerContent | null {
  return resolveGameContent(content) as GamePlayerContent | null;
}

/**
 * Находит текущий info-экран по timeline-состоянию.
 */
export function resolveCurrentInfoEntry(
  gameContent: GamePlayerContent | null,
  publicState: Record<string, unknown> | undefined
): GamePlayerInfoEntry | null {
  if (!gameContent) {
    return null;
  }

  const timeline = (publicState as { timeline?: unknown })?.timeline as
    | { stepIndex?: number; step_index?: number; screenId?: string; screen_id?: string; activeInfoId?: string }
    | undefined;
  const stepIndex = readStepIndex(timeline);
  const screenId = readScreenId(timeline);
  const activeInfoId = timeline?.activeInfoId;

  if (stepIndex === null || !screenId || !activeInfoId) {
    if (stepIndex === null || !screenId) {
      return null;
    }

    const entriesForStep = gameContent.infos.filter(
      (entry) => entry.stepIndex === stepIndex && entry.screenId === screenId
    );
    return entriesForStep.length === 1 ? entriesForStep[0] : null;
  }

  const explicitMatch =
    gameContent.infos.find(
      (entry) =>
        entry.id === activeInfoId && entry.stepIndex === stepIndex && entry.screenId === screenId
    ) ?? null;

  if (explicitMatch) {
    return explicitMatch;
  }

  const entriesForStep = gameContent.infos.filter(
    (entry) => entry.stepIndex === stepIndex && entry.screenId === screenId
  );
  return entriesForStep.length === 1 ? entriesForStep[0] : null;
}

/**
 * Находит текущий board по timeline-состоянию.
 */
export function resolveCurrentBoard(
  gameContent: GamePlayerContent | null,
  publicState: Record<string, unknown> | undefined
): GamePlayerBoard | null {
  if (!gameContent) {
    return null;
  }

  const timeline = (publicState as { timeline?: unknown })?.timeline as
    | { stepIndex?: number; step_index?: number; screenId?: string; screen_id?: string }
    | undefined;
  const stepIndex = readStepIndex(timeline);
  const screenId = readScreenId(timeline);

  if (stepIndex === null || !screenId) {
    return null;
  }

  return gameContent.boards.find((board) => board.stepIndex === stepIndex && board.screenId === screenId) ?? null;
}

/**
 * Находит текущий team selection scene по timeline-состоянию.
 */
export function resolveCurrentTeamSelectionScene(
  gameContent: GamePlayerContent | null,
  publicState: Record<string, unknown> | undefined
): GamePlayerTeamSelectionScene | null {
  if (!gameContent?.teamSelections) {
    return null;
  }

  const timeline = (publicState as { timeline?: unknown })?.timeline as
    | { stepIndex?: number; step_index?: number; screenId?: string; screen_id?: string }
    | undefined;
  const stepIndex = readStepIndex(timeline);
  const screenId = readScreenId(timeline);

  if (stepIndex === null || !screenId) {
    return null;
  }

  return (
    gameContent.teamSelections.find((scene) => scene.stepIndex === stepIndex && scene.screenId === screenId) ?? null
  );
}

/**
 * Разрешает карточки текущего board по cardIds и флагам.
 */
export function resolveBoardCards(
  gameContent: GamePlayerContent | null,
  board: GamePlayerBoard | null,
  cardFlags?: Record<string, CardFlagState>
): Array<GamePlayerBoardCard> {
  if (!gameContent || !board) {
    return [];
  }

  const cardsById = new Map(gameContent.cards.map((card) => [card.cardId, card]));
  return board.cardIds
    .map((cardId) => cardsById.get(cardId))
    .filter((card): card is GamePlayerBoardCard => {
      if (!card) {
        return false;
      }

      const contentAvailable = (card as GamePlayerBoardCard & { available?: boolean }).available;
      const cardState = cardFlags?.[card.cardId];
      return contentAvailable !== false && cardState?.available !== false;
    });
}

/**
 * Antarctica hint fallback: when no dedicated hint is available, show the
 * last story info screen the player has reached. This is a game-specific
 * mechanic, not a platform-wide player rule.
 */
export function resolveLastInfoHintText(
  gameContent: GamePlayerContent | null,
  gameState: AntarcticaGameState
): string | null {
  if (gameState.currentInfo?.body || gameState.currentInfo?.title) {
    return [gameState.currentInfo.title, gameState.currentInfo.body].filter(Boolean).join("\n\n");
  }

  const currentStepIndex = gameState.currentBoard?.stepIndex ?? gameState.currentTeamSelection?.stepIndex;
  if (!gameContent || typeof currentStepIndex !== "number") {
    return null;
  }

  const lastInfo = gameContent.infos
    .filter((entry) => entry.stepIndex <= currentStepIndex)
    .sort((left, right) => left.stepIndex - right.stepIndex)
    .at(-1);

  if (!lastInfo?.body && !lastInfo?.title) {
    return null;
  }

  return [lastInfo.title, lastInfo.body].filter(Boolean).join("\n\n");
}

/**
 * Прокси к обобщённой утилите — для удобства плагина.
 */
export function readCardFlags(session: SessionSnapshot | null): Record<string, CardFlagState> {
  return readCardFlagsGeneric(session) as Record<string, CardFlagState>;
}

/**
 * Прокси к обобщённой утилите — для удобства плагина.
 */
export function readTeamFlags(session: SessionSnapshot | null) {
  return readTeamFlagsGeneric(session);
}

/**
 * Прокси к обобщённой утилите — для удобства плагина.
 */
export function readTeamSelection(session: SessionSnapshot | null) {
  return readTeamSelectionGeneric(session);
}

/**
 * Прокси к обобщённой утилите — для удобства плагина.
 */
export function readCanAdvance(session: SessionSnapshot | null): boolean {
  return readCanAdvanceGeneric(session);
}

/**
 * Прокси к обобщённой утилите — для удобства плагина.
 */
export function readSelectedCardId(session: SessionSnapshot | null): string | null {
  return readSelectedCardIdGeneric(session);
}

export { getFallbackActionEntries };
