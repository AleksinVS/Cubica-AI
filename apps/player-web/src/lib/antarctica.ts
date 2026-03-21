import type {
  AntarcticaPlayerBoard,
  AntarcticaPlayerBoardCard,
  AntarcticaPlayerContent,
  AntarcticaPlayerInfoEntry,
  AntarcticaPlayerTeamSelectionScene,
  PlayerFacingContent,
  PlayerFacingMockup
} from "@cubica/contracts-manifest";
import type { CreateSessionResponse, DispatchActionResponse } from "@cubica/contracts-session";

export type { PlayerFacingMockup as AntarcticaMockup };

export interface AntarcticaPlayerSourceData {
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
};

type SecretState = {
  opening?: {
    selectedCardId?: string;
  };
};

const runtimeApiUrl = process.env.RUNTIME_API_URL ?? "http://127.0.0.1:3001";
const playerWebUrl = process.env.PLAYER_WEB_URL ?? "http://localhost:3000";

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

export async function loadAntarcticaPlayerContent(): Promise<PlayerFacingContent> {
  const response = await fetch(`${playerWebUrl}/api/runtime/player-content/antarctica`);
  if (!response.ok) {
    throw new Error(`Failed to load player content: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  return parseJson<PlayerFacingContent>(text);
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

export function resolveAntarcticaContent(content: PlayerFacingContent): AntarcticaPlayerContent | null {
  return content.antarctica ?? null;
}

export function resolveCurrentInfoEntry(
  antarctica: AntarcticaPlayerContent | null,
  publicState: PublicState | undefined
): AntarcticaPlayerInfoEntry | null {
  if (!antarctica) {
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

    const entriesForStep = antarctica.infos.filter(
      (entry) => entry.stepIndex === stepIndex && entry.screenId === screenId
    );
    return entriesForStep.length === 1 ? entriesForStep[0] : null;
  }

  const explicitMatch =
    antarctica.infos.find(
      (entry) =>
        entry.id === activeInfoId && entry.stepIndex === stepIndex && entry.screenId === screenId
    ) ?? null;

  if (explicitMatch) {
    return explicitMatch;
  }

  const entriesForStep = antarctica.infos.filter(
    (entry) => entry.stepIndex === stepIndex && entry.screenId === screenId
  );
  return entriesForStep.length === 1 ? entriesForStep[0] : null;
}

export function resolveCurrentBoard(
  antarctica: AntarcticaPlayerContent | null,
  publicState: PublicState | undefined
): AntarcticaPlayerBoard | null {
  if (!antarctica) {
    return null;
  }

  const timeline = publicState?.timeline;
  const stepIndex = readStepIndex(timeline);
  const screenId = readScreenId(timeline);

  if (stepIndex === null || !screenId) {
    return null;
  }

  return antarctica.boards.find((board) => board.stepIndex === stepIndex && board.screenId === screenId) ?? null;
}

export function resolveCurrentTeamSelectionScene(
  antarctica: AntarcticaPlayerContent | null,
  publicState: PublicState | undefined
): AntarcticaPlayerTeamSelectionScene | null {
  if (!antarctica?.teamSelections) {
    return null;
  }

  const timeline = publicState?.timeline;
  const stepIndex = readStepIndex(timeline);
  const screenId = readScreenId(timeline);

  if (stepIndex === null || !screenId) {
    return null;
  }

  return (
    antarctica.teamSelections.find((scene) => scene.stepIndex === stepIndex && scene.screenId === screenId) ?? null
  );
}

export function resolveBoardCards(
  antarctica: AntarcticaPlayerContent | null,
  board: AntarcticaPlayerBoard | null
): Array<AntarcticaPlayerBoardCard> {
  if (!antarctica || !board) {
    return [];
  }

  const cardsById = new Map(antarctica.cards.map((card) => [card.cardId, card]));
  return board.cardIds
    .map((cardId) => cardsById.get(cardId))
    .filter((card): card is AntarcticaPlayerBoardCard => Boolean(card));
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
