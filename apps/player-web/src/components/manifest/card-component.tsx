import type {
  GameUiComponent,
  GameUiCardComponentProps
} from "@cubica/contracts-manifest";
import { resolveExpression, resolveExpressions, resolvePayloadExpressions } from "@/lib/expression-resolver";
import { useLocale } from "@/components/locale-context";
import type { PreviewElementAttributes } from "./preview-metadata";

/**
 * Рендерит cardComponent (интерактивная карточка в UI манифеста).
 *
 * Режимы рендеринга:
 * - Простой (только text): совместимый с существующими манифестами
 * - Multi-field (title/summary/chips/selectLabel/visualState):
 *   полный рендеринг с заголовком, описанием, метками и кнопкой выбора
 */
export function CardComponent({
  component,
  onAction,
  localContext,
  gameState,
  previewAttributes,
}: {
  component: GameUiComponent<GameUiCardComponentProps>;
  onAction: (command: string, payload: Record<string, unknown>) => void;
  localContext?: Record<string, unknown>;
  gameState?: Record<string, unknown>;
  previewAttributes?: PreviewElementAttributes;
}) {
  const t = useLocale();
  const { text, title, summary, chips, selectLabel, visualState, visible, interactive } = component.props;
  const command = (component as GameUiComponent).actions?.onClick?.command;
  const componentId = (component as GameUiComponent).id ?? "";
  const cardIdMatch = componentId.match(/^card-(\d+)$/);
  const cardIdFromComponent = cardIdMatch ? cardIdMatch[1] : undefined;

  const basePayload = (component as GameUiComponent).actions?.onClick?.payload ?? {};
  const isPayloadEmpty = Object.keys(basePayload).length === 0;
  // Resolve {{...}} expressions in payload values (e.g. {{card.selectActionId}})
  const resolvedPayload = resolvePayloadExpressions(basePayload, gameState, localContext);
  const actionPayload: Record<string, unknown> = isPayloadEmpty && cardIdFromComponent
    ? { cardId: cardIdFromComponent }
    : resolvedPayload;
  const resolvedVisible = resolveBooleanProp(visible, true, gameState, localContext);
  const resolvedInteractive = resolveBooleanProp(interactive, true, gameState, localContext);
  const resolvedVisualState = resolveStringProp(visualState, gameState, localContext) ?? "default";
  const isDisabled = resolvedInteractive === false || resolvedVisualState === "locked";

  if (!resolvedVisible) {
    return null;
  }

  const handleCardClick = () => {
    if (command && !isDisabled) {
      onAction(command, actionPayload);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (command && !isDisabled && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onAction(command, actionPayload);
    }
  };

  // Простой режим: только text (backward compatible)
  const isSimple = !title && !summary && !chips?.length;

  if (isSimple) {
    // Разрешаем выражения в text если есть gameState/localContext
    const resolvedText = (text && (localContext || gameState))
      ? resolveExpression(text, gameState ?? {}, localContext)
      : text;

    return (
      <article
        {...previewAttributes}
        className="game-card"
        onClick={command ? handleCardClick : undefined}
        onKeyDown={command ? handleKeyDown : undefined}
        role={command ? "button" : undefined}
        tabIndex={command && !isDisabled ? 0 : undefined}
        aria-disabled={isDisabled || undefined}
        aria-label={resolvedText ?? undefined}
      >
        <p className="game-card-text">{resolvedText}</p>
        {command && (
          <button
            className="action-button"
            type="button"
            onClick={(e) => { e.stopPropagation(); if (!isDisabled) onAction(command, actionPayload); }}
            disabled={isDisabled}
            tabIndex={-1}
          >
            {t.selectCard}
          </button>
        )}
      </article>
    );
  }

  // Multi-field режим: title + summary + chips + visual state
  const resolvedTitle = title && (localContext || gameState)
    ? resolveExpression(title, gameState ?? {}, localContext)
    : title;
  const resolvedSummary = summary && (localContext || gameState)
    ? resolveExpression(summary, gameState ?? {}, localContext)
    : summary;
  const resolvedSelectLabel = selectLabel && (localContext || gameState)
    ? resolveExpression(selectLabel, gameState ?? {}, localContext)
    : selectLabel;

  const visualStateClass = resolvedVisualState && resolvedVisualState !== "default"
    ? ` fallback-card-${resolvedVisualState}`
    : "";

  return (
    <article
      {...previewAttributes}
      className={`game-card fallback-card${visualStateClass}`}
      onClick={command && !isDisabled ? handleCardClick : undefined}
      onKeyDown={command && !isDisabled ? handleKeyDown : undefined}
      role={command ? "button" : undefined}
      tabIndex={command && !isDisabled ? 0 : undefined}
      aria-disabled={isDisabled || undefined}
    >
      <div className="fallback-card-head">
        {resolvedTitle ? <strong>{resolvedTitle}</strong> : null}
        {componentId ? <span className="chip">#{componentId}</span> : null}
      </div>
      {resolvedSummary ? <p className="game-card-text">{resolvedSummary}</p> : null}
      {resolvedTitle && !resolvedSummary && text ? <p className="game-card-text">{text}</p> : null}
      {chips && chips.length > 0 ? (
        <div className="fallback-card-meta">
          {chips.map((chip) => <span key={chip} className="chip">{chip}</span>)}
        </div>
      ) : null}
      {command && (
        <button
          className="action-button"
          type="button"
          onClick={(e) => { e.stopPropagation(); if (!isDisabled) onAction(command, actionPayload); }}
          disabled={isDisabled}
          tabIndex={-1}
        >
          {resolvedSelectLabel ?? t.selectCard}
        </button>
      )}
    </article>
  );
}

function resolveStringProp(
  value: string | undefined,
  gameState: Record<string, unknown> | undefined,
  localContext: Record<string, unknown> | undefined
): string | undefined {
  if (!value) {
    return value;
  }
  if (!value.includes("{{")) {
    return value;
  }
  return String(resolveExpressions(value, gameState ?? {}, localContext));
}

function resolveBooleanProp(
  value: boolean | string | undefined,
  fallback: boolean,
  gameState: Record<string, unknown> | undefined,
  localContext: Record<string, unknown> | undefined
): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const resolved = value.includes("{{")
    ? resolveExpressions(value, gameState ?? {}, localContext)
    : value;
  if (typeof resolved === "boolean") {
    return resolved;
  }
  if (typeof resolved === "string") {
    return resolved !== "false";
  }
  return Boolean(resolved);
}
