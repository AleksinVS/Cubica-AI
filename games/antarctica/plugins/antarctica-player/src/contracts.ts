/**
 * Antarctica player plugin contracts.
 *
 * These types describe the game-specific content projection used by the
 * Antarctica presentation layer. They intentionally live inside the game plugin
 * because the shared player only needs generic manifest/session contracts.
 */

import type { GameManifestMetricDefinition } from "@cubica/contracts-manifest";
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
  /**
   * Presentation state projected from the card's state facets (ADR-094). The UI
   * template binds it, and the renderer flips a `resolved` card to its back.
   * `resolved | selected | locked | default`.
   */
  visualState?: string;
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
  /** Game-owned metric catalog projected from game manifest content.data. */
  metrics?: Array<GameManifestMetricDefinition>;
  /** Game-owned rule constants such as the day limit for computed metrics. */
  rules?: Record<string, unknown>;
  infos: Array<GamePlayerInfoEntry>;
  boards: Array<GamePlayerBoard>;
  teamSelections?: Array<GamePlayerTeamSelectionScene>;
  cards: Array<GamePlayerBoardCard>;
}

/**
 * One metric badge under a journal entry (ADR-092): caption, the value after the
 * turn, and the signed delta. `hasDelta` is false when the metric did not change
 * this turn, so the template can hide the delta superscript (matching the
 * reference journal, which shows a delta only for changed metrics).
 */
export interface GamePlayerJournalMetricRow {
  caption: string;
  value: number;
  previousValue: number;
  delta: string;
  hasDelta: boolean;
}

export interface GamePlayerJournalEntry {
  frontText: string;
  backText: string;
  metricSummary: string;
  hasMetricSummary: boolean;
  /** Per-metric badges rendered under the entry (value + delta on each metric). */
  metricRows: Array<GamePlayerJournalMetricRow>;
  hasMetricRows: boolean;
  at: string;
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
  /**
   * Published action id the forward navigation arrow dispatches on card/board
   * screens. Empty string when the game cannot advance yet (no resolved card
   * with an advance plan). The manifest binds the arrow's payload.actionId to
   * this value; an empty id keeps the arrow disabled via forwardNavDisabled.
   */
  forwardAdvanceActionId: string;
  /**
   * Whether the forward navigation arrow is disabled on card/board screens.
   * True until the current board step can advance (mirrors the "continue"
   * button that opens after the required board cards are played). The expression
   * language has no negation, so the plugin projects this ready-to-bind boolean.
   */
  forwardNavDisabled: boolean;
  journalEntries: Array<GamePlayerJournalEntry>;
  hasJournalEntries: boolean;
  journalIsEmpty: boolean;
  journalEmptyMessage: string;
  hintText: string;
  hasHintText: boolean;
  fallbackActions: Array<ActionEntry>;
}
