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
  summary: string;
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
