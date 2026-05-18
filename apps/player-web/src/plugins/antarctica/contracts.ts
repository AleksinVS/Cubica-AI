import type { ActionEntry } from "@/lib/game-content-resolvers";

export interface GamePlayerInfoEntry {
  id: string;
  stepIndex: number;
  screenId: string;
  title: string;
  body: string;
  advanceActionId: string;
  advanceLabel?: string;
}

export interface GamePlayerTeamSelectionMember {
  memberId: string;
  name: string;
  summary: string;
  selectActionId: string;
  selectLabel?: string;
}

export interface GamePlayerTeamSelectionScene {
  id: string;
  stepIndex: number;
  screenId: string;
  title: string;
  body: string;
  requiredPickCount: number;
  confirmActionId: string;
  confirmLabel?: string;
  members: Array<GamePlayerTeamSelectionMember>;
}

export interface GamePlayerBoardCard {
  cardId: string;
  title: string;
  /** Front face text of the card. */
  summary: string;
  /** Back (flipped/result) text shown after the card is selected. */
  backText?: string;
  selectActionId: string;
  selectLabel?: string;
  advanceActionId?: string;
  advanceLabel?: string;
}

export interface GamePlayerBoard {
  id: string;
  title?: string;
  body?: string;
  stepIndex: number;
  screenId: string;
  cardIds: Array<string>;
}

export interface GamePlayerContent {
  infos: Array<GamePlayerInfoEntry>;
  boards: Array<GamePlayerBoard>;
  teamSelections?: Array<GamePlayerTeamSelectionScene>;
  cards: Array<GamePlayerBoardCard>;
}

/**
 * Game-specific state for Antarctica.
 * Moved from platform (game-config.ts) to the plugin where it belongs.
 * The platform layer uses the generic GameState type instead.
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
