/**
 * Создаёт адаптер, который преобразует UI-команды из манифеста
 * в runtime action IDs для dispatch.
 *
 * Поддерживает два уровня настройки:
 * 1. commandMap — статический маппинг команд на actionId
 * 2. resolveActionId — динамическая резолюция (например, поиск cardId в boardCards)
 *
 * Если ни commandMap, ни resolveActionId не указаны, используется
 * дефолтный набор из 4 команд (showHistory, showHint, showScreenWithLeftSideBar).
 */
export function createManifestActionAdapter(options: {
  /** Game-specific контент (тип unknown — плагин кастует к своему типу) */
  gameContent: unknown;
  /** Маппинг манифестных команд на runtime action IDs */
  commandMap?: Record<string, string>;
  /** Динамическая резолюция команд. Вызывается перед commandMap lookup. */
  resolveActionId?: (command: string, payload: Record<string, unknown>) => string | null;
  /** Dispatch action callback */
  dispatchAction: (actionId: string, payload?: Record<string, unknown>) => void;
  /** Error callback */
  onError: (message: string) => void;
}): (command: string, payload: Record<string, unknown>) => void {
  const { commandMap, resolveActionId, dispatchAction, onError } = options;

  return (command: string, payload: Record<string, unknown>) => {
    // 1. Попробовать динамическую резолюцию (плагин может искать cardId и т.д.)
    if (resolveActionId) {
      const actionId = resolveActionId(command, payload);
      if (actionId) {
        dispatchAction(actionId, payload);
        return;
      }
    }

    // 2. Попробовать статический маппинг
    if (commandMap && command in commandMap) {
      dispatchAction(commandMap[command], payload);
      return;
    }

    // 3. Дефолтные команды (backward compatibility)
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

    // 4. Fallback: передать команду как actionId
    if (command === "requestServer") {
      dispatchAction("requestServer", payload);
      return;
    }

    onError(`Unknown manifest command: ${command}`);
  };
}