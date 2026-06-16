/**
 * Antarctica-specific state resolvers.
 *
 * These functions know the shape of Antarctica content: boards, info entries,
 * cards and team-selection scenes. Generic helpers still come from the public
 * player plugin API facade.
 */

import type { PlayerFacingContent } from "@cubica/contracts-manifest";

import type {
  AntarcticaGameState,
  GamePlayerBoard,
  GamePlayerBoardCard,
  GamePlayerContent,
  GamePlayerInfoEntry,
  GamePlayerJournalEntry,
  GamePlayerTeamSelectionScene
} from "./contracts";
import type { FallbackMetricSpec, SessionSnapshot } from "@cubica/player-web/plugin-api";
import {
  getFallbackActionEntries,
  readCanAdvance as readCanAdvanceGeneric,
  readCardObjects as readCardObjectsGeneric,
  readScreenId,
  readSelectedCardId as readSelectedCardIdGeneric,
  readStepIndex,
  readTeamFlags as readTeamFlagsGeneric,
  readTeamSelection as readTeamSelectionGeneric,
  resolveGameContent
} from "@cubica/player-web/plugin-api";

type CardObjectState = {
  objectType: string;
  facets: {
    selection?: "idle" | "selected";
    resolution?: "idle" | "resolved";
    availability?: "available" | "locked" | "hidden";
    face?: "front" | "back";
  };
};

type RuntimeLogLike = Record<string, unknown> & {
  at?: string;
  cardId?: string;
  displayMode?: string;
  entityType?: string;
  frontText?: string;
  backText?: string;
  metricsBefore?: Record<string, unknown>;
  metricsAfter?: Record<string, unknown>;
  metricChanges?: Array<{ metricId?: string; delta?: number }>;
  summary?: string;
};

type HintSourceState = Pick<AntarcticaGameState, "currentInfo" | "currentBoard" | "currentTeamSelection">;

/**
 * Extracts Antarctica-specific content from the generic player DTO.
 */
export function resolveAntarcticaContent(content: PlayerFacingContent): GamePlayerContent | null {
  return resolveGameContent(content) as GamePlayerContent | null;
}

/**
 * Resolves the current info screen from timeline state.
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
 * Resolves the current board from timeline state.
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
 * Resolves the current team-selection scene from timeline state.
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
 * Resolves visible cards for the current board by card ids and session object state.
 */
export function resolveBoardCards(
  gameContent: GamePlayerContent | null,
  board: GamePlayerBoard | null,
  cardObjects?: Record<string, CardObjectState>
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
      const cardState = cardObjects?.[card.cardId];

      // Hidden cards are not visible
      if (cardState?.facets?.availability === "hidden") {
        return false;
      }

      return contentAvailable !== false;
    });
}

function isCardJournalEntry(entry: RuntimeLogLike): boolean {
  const hasVisibleCardText = Boolean(entry.frontText || entry.backText || entry.summary);
  const isCardEntry = entry.displayMode === "card" || entry.entityType === "card";
  return Boolean(entry.cardId && (isCardEntry || hasVisibleCardText));
}

function metricValue(metrics: Record<string, unknown> | undefined, spec: FallbackMetricSpec): number | null {
  if (!metrics) {
    return null;
  }

  for (const key of [spec.id, ...spec.aliases]) {
    const value = metrics[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function formatSignedDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta);
}

function resolveMetricSummary(entry: RuntimeLogLike, metricSpecs: ReadonlyArray<FallbackMetricSpec>): string {
  if (Array.isArray(entry.metricChanges) && entry.metricChanges.length > 0) {
    const captions = new Map<string, string>();
    for (const spec of metricSpecs) {
      captions.set(spec.id, spec.caption);
      for (const alias of spec.aliases) {
        captions.set(alias, spec.caption);
      }
    }

    return entry.metricChanges
      .filter((change): change is { metricId: string; delta: number } =>
        typeof change.metricId === "string" && typeof change.delta === "number"
      )
      .map((change) => `${captions.get(change.metricId) ?? change.metricId}: ${formatSignedDelta(change.delta)}`)
      .join(" · ");
  }

  const parts: Array<string> = [];
  for (const spec of metricSpecs) {
    const before = metricValue(entry.metricsBefore, spec);
    const after = metricValue(entry.metricsAfter, spec);
    if (before === null || after === null || before === after) {
      continue;
    }
    parts.push(`${spec.caption}: ${formatSignedDelta(after - before)}`);
  }
  return parts.join(" · ");
}

/**
 * Builds the game-defined journal projection used by the UI manifest panel.
 *
 * The platform should not know Antarctica journal semantics. This projection
 * keeps only visible card choices and resolves card texts from game content.
 */
export function resolveJournalEntries(
  gameContent: GamePlayerContent | null,
  publicState: Record<string, unknown> | undefined,
  metricSpecs: ReadonlyArray<FallbackMetricSpec>
): Array<GamePlayerJournalEntry> {
  if (!gameContent || !Array.isArray(publicState?.log)) {
    return [];
  }

  const cardsById = new Map(gameContent.cards.map((card) => [card.cardId, card]));
  return publicState.log
    .filter((entry): entry is RuntimeLogLike => !!entry && typeof entry === "object")
    .filter(isCardJournalEntry)
    .map((entry) => {
      const cardId = typeof entry.cardId === "string" ? entry.cardId : "";
      const card = cardsById.get(cardId);
      const frontText = entry.frontText ?? card?.summary ?? "";
      const backText = entry.backText ?? entry.summary ?? card?.backText ?? "";
      const metricSummary = resolveMetricSummary(entry, metricSpecs);

      if (!frontText && !backText) {
        return null;
      }

      return {
        frontText,
        backText,
        metricSummary,
        hasMetricSummary: metricSummary.length > 0,
        at: entry.at ?? ""
      };
    })
    .filter((entry): entry is GamePlayerJournalEntry => entry !== null);
}

/**
 * Antarctica hint fallback: when no dedicated hint is open, show the last story
 * info screen the player has reached. This is game-specific presentation logic.
 */
export function resolveLastInfoHintText(
  gameContent: GamePlayerContent | null,
  gameState: HintSourceState
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

export function readCardObjects(session: SessionSnapshot | null): Record<string, CardObjectState> {
  return readCardObjectsGeneric(session) as Record<string, CardObjectState>;
}

export function readTeamFlags(session: SessionSnapshot | null) {
  return readTeamFlagsGeneric(session);
}

export function readTeamSelection(session: SessionSnapshot | null) {
  return readTeamSelectionGeneric(session);
}

export function readCanAdvance(session: SessionSnapshot | null): boolean {
  return readCanAdvanceGeneric(session);
}

export function readSelectedCardId(session: SessionSnapshot | null): string | null {
  return readSelectedCardIdGeneric(session);
}

export { getFallbackActionEntries };
