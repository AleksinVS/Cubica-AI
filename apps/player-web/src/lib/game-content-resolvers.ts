import type { PlayerFacingContent, PlayerFacingMockup } from "@cubica/contracts-manifest";
import type { GamePlayerBoard, GamePlayerBoardCard, GamePlayerContent, GamePlayerInfoEntry, GamePlayerTeamSelectionScene } from "@/plugins/antarctica/contracts";

import type { CreateSessionResponse, DispatchActionResponse } from "@cubica/contracts-session";

export type { PlayerFacingMockup as GameMockup };

export interface GamePlayerSourceData {
  content: PlayerFacingContent;
  runtimeApiUrl: string;
}

export interface ActionEntry {
  actionId: string;
  displayName: string;
  capabilityFamily: string | null;
  capability: string | null;
}

export type SessionSnapshot = CreateSessionResponse<Record<string, unknown>>;
export type ActionSnapshot = DispatchActionResponse<Record<string, unknown>>;

type TimelineState = {
  stepIndex?: number;
  step_index?: number;
  screenId?: string;
  screen_id?: string;
  activeInfoId?: string;
  canAdvance?: boolean;
};

type CardFlagState = {
  selected?: boolean;
  resolved?: boolean;
  locked?: boolean;
  available?: boolean;
};

type TeamFlagState = {
  selected?: boolean;
};

type TeamSelectionState = {
  pickCount?: number;
  selectedMemberIds?: Array<string>;
};

type PublicState = {
  timeline?: TimelineState;
  flags?: {
    cards?: Record<string, CardFlagState>;
    team?: Record<string, TeamFlagState>;
  };
  teamSelection?: TeamSelectionState;
  ui?: {
    activePanel?: string;
    activeScreen?: string;
    lastCapabilityFamily?: string;
    lastCapability?: string;
    serverRequested?: boolean;
  };
};

type SecretState = {
  opening?: {
    selectedCardId?: string;
  };
};

const runtimeApiUrl = process.env.RUNTIME_API_URL ?? "http://127.0.0.1:3001";
const playerWebUrl = process.env.PLAYER_WEB_URL ?? "http://localhost:3009";

const parseJson = <TValue,>(raw: string): TValue => JSON.parse(raw) as TValue;

const readStepIndex = (timeline: TimelineState | undefined) =>
  typeof timeline?.stepIndex === "number"
    ? timeline.stepIndex
    : typeof timeline?.step_index === "number"
      ? timeline.step_index
      : null;

const readScreenId = (timeline: TimelineState | undefined) =>
  typeof timeline?.screenId === "string"
    ? timeline.screenId
    : typeof timeline?.screen_id === "string"
      ? timeline.screen_id
      : null;

export async function loadGamePlayerContent(
  gameId: string,
  retries = 3,
  delay = 1000
): Promise<PlayerFacingContent> {
  let lastError: Error | null = null;

  for (let i = 0; i < retries; i++) {
    try {
      const url = playerWebUrl
        ? `${playerWebUrl}/api/runtime/player-content/${gameId}`
        : `/api/runtime/player-content/${gameId}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load player content: ${response.status} ${response.statusText}`);
      }
      const text = await response.text();
      return parseJson<PlayerFacingContent>(text);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (i < retries - 1) {
        // eslint-disable-next-line no-console
        console.warn(`Attempt ${i + 1} to load player content failed, retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error("Unknown error loading player content");
}

export function getRuntimeApiUrl() {
  return runtimeApiUrl;
}

export function getFallbackActionEntries(content: PlayerFacingContent): Array<ActionEntry> {
  return content.actions.map((action) => ({
    actionId: action.actionId,
    displayName: action.displayName,
    capabilityFamily: action.capabilityFamily,
    capability: action.capability
  }));
}

export function resolveGameContent(content: PlayerFacingContent): GamePlayerContent | null {
  return (content.content?.[content.gameId] as GamePlayerContent) ?? null;
}

export function resolveCurrentInfoEntry(
  gameContent: GamePlayerContent | null,
  publicState: PublicState | undefined
): GamePlayerInfoEntry | null {
  if (!gameContent) {
    return null;
  }

  const timeline = publicState?.timeline;
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

export function resolveCurrentBoard(
  gameContent: GamePlayerContent | null,
  publicState: PublicState | undefined
): GamePlayerBoard | null {
  if (!gameContent) {
    return null;
  }

  const timeline = publicState?.timeline;
  const stepIndex = readStepIndex(timeline);
  const screenId = readScreenId(timeline);

  if (stepIndex === null || !screenId) {
    return null;
  }

  return gameContent.boards.find((board) => board.stepIndex === stepIndex && board.screenId === screenId) ?? null;
}

export function resolveCurrentTeamSelectionScene(
  gameContent: GamePlayerContent | null,
  publicState: PublicState | undefined
): GamePlayerTeamSelectionScene | null {
  if (!gameContent?.teamSelections) {
    return null;
  }

  const timeline = publicState?.timeline;
  const stepIndex = readStepIndex(timeline);
  const screenId = readScreenId(timeline);

  if (stepIndex === null || !screenId) {
    return null;
  }

  return (
    gameContent.teamSelections.find((scene) => scene.stepIndex === stepIndex && scene.screenId === screenId) ?? null
  );
}

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

export function readSelectedCardId(session: SessionSnapshot | null): string | null {
  const secretState = session?.state?.secret as SecretState | undefined;
  return secretState?.opening?.selectedCardId ?? null;
}

export function readCardFlags(session: SessionSnapshot | null): Record<string, CardFlagState> {
  const publicState = session?.state?.public as PublicState | undefined;
  return publicState?.flags?.cards ?? {};
}

export function readTeamFlags(session: SessionSnapshot | null): Record<string, TeamFlagState> {
  const publicState = session?.state?.public as PublicState | undefined;
  return publicState?.flags?.team ?? {};
}

export function readTeamSelection(session: SessionSnapshot | null): TeamSelectionState {
  const publicState = session?.state?.public as PublicState | undefined;
  return publicState?.teamSelection ?? {};
}

export function readCanAdvance(session: SessionSnapshot | null): boolean {
  const publicState = session?.state?.public as PublicState | undefined;
  return Boolean(publicState?.timeline?.canAdvance);
}
