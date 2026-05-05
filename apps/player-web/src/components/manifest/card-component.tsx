import type {
  GameUiComponent,
  GameUiCardComponentProps
} from "@cubica/contracts-manifest";

/**
 * Рендерит cardComponent (интерактивная карточка в UI манифеста).
 * Сама карточка является основным элементом взаимодействия (доступность).
 * Внутренняя кнопка скрыта визуально, но остаётся в DOM для тестирования.
 */
export function CardComponent({
  component,
  onAction
}: {
  component: GameUiComponent<GameUiCardComponentProps>;
  onAction: (command: string, payload: Record<string, unknown>) => void;
}) {
  const { text } = component.props;
  const command = (component as GameUiComponent).actions?.onClick?.command;
  const componentId = (component as GameUiComponent).id ?? "";
  const cardIdMatch = componentId.match(/^card-(\d+)$/);
  const cardIdFromComponent = cardIdMatch ? cardIdMatch[1] : undefined;

  const basePayload = (component as GameUiComponent).actions?.onClick?.payload ?? {};
  const isPayloadEmpty = Object.keys(basePayload).length === 0;
  const actionPayload: Record<string, unknown> = isPayloadEmpty && cardIdFromComponent
    ? { cardId: cardIdFromComponent }
    : { ...basePayload };

  const handleCardClick = () => {
    if (command) {
      onAction(command, actionPayload);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (command && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onAction(command, actionPayload);
    }
  };

  return (
    <article
      className="game-card"
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={command ? 0 : -1}
      aria-label={text}
    >
      <p className="game-card-text">{text}</p>
      {command && (
        <button
          className="action-button"
          type="button"
          onClick={(e) => { e.stopPropagation(); onAction(command, actionPayload); }}
          tabIndex={-1}
        >
          Выбрать
        </button>
      )}
    </article>
  );
}
