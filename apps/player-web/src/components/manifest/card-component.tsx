import type {
  GameUiComponent,
  GameUiCardComponentProps
} from "@cubica/contracts-manifest";
import { resolveExpression, resolveExpressions, resolvePayloadExpressions } from "@/lib/expression-resolver";
import { useLocale } from "@/components/locale-context";
import type { PreviewElementAttributes } from "./preview-metadata";
import flipStyles from "./card-component.module.css";

/**
 * Рендерит cardComponent (интерактивная карточка в UI манифеста).
 *
 * Режимы рендеринга:
 * - Простой (только text): совместимый с существующими манифестами
 * - Multi-field (title/summary/chips/selectLabel/visualState):
 *   полный рендеринг с заголовком, описанием, метками и кнопкой выбора
 *
 * Переворот (front/back flip, ADR-094):
 * - Если у карточки задан `backText`, карточка получает ДВЕ грани: лицо (обычное
 *   содержимое выше) и оборот (`backText` — последствие/результат выбора).
 * - Карточка переворачивается на оборот, когда её презентационный
 *   `visualState === "resolved"` (это поле уже есть в контракте и означает «результат
 *   карточки показан»). Сигнал приходит из игрового состояния через view-правило —
 *   рендерер НЕ выводит переворот из id игры или произвольного состояния (ADR-055).
 * - Карточки без `backText` рендерятся как раньше — полная обратная совместимость.
 * - Сам 3D-механизм переворота — в scoped CSS-модуле `card-component.module.css`
 *   (общий, игро-агностичный); оформление граней — в стилях игры (ADR-091).
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
  const props: GameUiCardComponentProps = component.props ?? {};
  const { text, title, summary, backText, chips, selectLabel, visualState, visible, interactive } = props;
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

  // Оборотный текст (последствие выбора). Наличие backText включает двустороннюю
  // структуру карточки; его отсутствие оставляет прежний односторонний рендер.
  const resolvedBackText = backText && (localContext || gameState)
    ? resolveExpression(backText, gameState ?? {}, localContext)
    : backText;
  const hasBack = typeof resolvedBackText === "string" && resolvedBackText.length > 0;
  // Карточка перевёрнута, когда её результат показан (`resolved`) и есть что показать.
  const isFlipped = hasBack && resolvedVisualState === "resolved";
  // Разрешённая (перевёрнутая) карточка больше не выбирается повторно, поэтому она
  // неинтерактивна — как и заблокированная.
  const isDisabled = resolvedInteractive === false
    || resolvedVisualState === "locked"
    || resolvedVisualState === "resolved";

  if (!resolvedVisible) {
    return null;
  }

  // Оборотная грань. Общий scoped-механизм переворота (grid-стек граней, скрытие
  // изнанки) — в CSS-модуле; классы `game-card-back*` — точки для оформления игрой.
  const backFace = hasBack ? (
    <div
      className={`${flipStyles.face} ${flipStyles.faceBack} game-card-back`}
      aria-hidden={!isFlipped || undefined}
    >
      <p className="game-card-text game-card-back-text">{resolvedBackText}</p>
    </div>
  ) : null;

  /**
   * Оборачивает содержимое лицевой стороны в двустороннюю структуру, если у
   * карточки есть оборот. Без оборота возвращает содержимое как есть (обратная
   * совместимость с односторонними карточками).
   */
  const withFlip = (frontContent: React.ReactNode): React.ReactNode => {
    if (!hasBack) {
      return frontContent;
    }
    return (
      <div className={flipStyles.flipScene}>
        <div className={`${flipStyles.flipInner} ${isFlipped ? flipStyles.flipped : ""}`}>
          <div
            className={`${flipStyles.face} ${flipStyles.faceFront} game-card-front`}
            aria-hidden={isFlipped || undefined}
          >
            {frontContent}
          </div>
          {backFace}
        </div>
      </div>
    );
  };

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
        {withFlip(
          <>
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
          </>
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
      {withFlip(
        <>
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
        </>
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
