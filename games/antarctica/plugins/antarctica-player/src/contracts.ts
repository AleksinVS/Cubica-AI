/**
 * Antarctica player plugin contracts.
 *
 * These types describe the game-specific content projection used by the
 * Antarctica presentation layer. They intentionally live inside the game plugin
 * because the shared player only needs generic manifest/session contracts.
 */

import type { ActionEntry } from "@cubica/player-web/plugin-api";

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
  /** Back face text shown after the card is selected. */
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
 *
 * The platform treats this as opaque plugin state. Only the Antarctica plugin
 * knows about boards, info screens and team-selection scenes.
 */
export interface AntarcticaGameState {
  currentInfo: GamePlayerInfoEntry | null;
  currentBoard: GamePlayerBoard | null;
  currentTeamSelection: GamePlayerTeamSelectionScene | null;
  cardObjects: Record<string, { facets?: { selection?: string; resolution?: string; availability?: string; face?: string } }>;
  selectedCardId: string | null;
  selectedCard: GamePlayerBoardCard | null;
  boardCards: Array<GamePlayerBoardCard>;
  teamFlags: Record<string, { selected?: boolean }>;
  selectedMemberIds: Array<string>;
  pickCount: number;
  canAdvance: boolean;
  fallbackActions: Array<ActionEntry>;
}
