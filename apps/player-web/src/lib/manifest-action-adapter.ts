import type { GamePlayerBoardCard, GamePlayerContent } from "@/plugins/antarctica/contracts";


/**
 * Создаёт адаптер, который преобразует UI-команды из манифеста
 * в runtime action IDs для dispatch.
 */
export function createManifestActionAdapter(options: {
  gameContent: GamePlayerContent | null;
  boardCards: Array<GamePlayerBoardCard>;
  dispatchAction: (actionId: string, payload?: Record<string, unknown>) => void;
  onError: (message: string) => void;
}): (command: string, payload: Record<string, unknown>) => void {
  const { gameContent, boardCards, dispatchAction, onError } = options;

  return (command: string, payload: Record<string, unknown>) => {
    if (command === "requestServer") {
      const cardId = payload?.cardId as string | undefined;
      if (cardId && boardCards.length > 0) {
        const card = boardCards.find((c) => c.cardId === cardId);
        if (card) {
          dispatchAction(card.selectActionId);
          return;
        }
      }
      dispatchAction("requestServer", payload);
      return;
    }

    if (command === "showHistory") {
      dispatchAction("showHistory");
      return;
    }
    if (command === "showHint") {
      dispatchAction("showHint");
      return;
    }
    if (command === "showScreenWithLeftSideBar") {
      dispatchAction("showScreenWithLeftSideBar");
      return;
    }

    onError(`Unknown manifest command: ${command}`);
  };
}
