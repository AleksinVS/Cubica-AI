import type {
  GameUiComponent,
  GameUiRichTextComponentProps
} from "@cubica/contracts-manifest";
import { resolveExpression } from "@/lib/expression-resolver";

/**
 * Рендерит richTextComponent — HTML или plain-text тело.
 *
 * Если html содержит HTML-теги, рендерит через dangerouslySetInnerHTML.
 * Иначе оборачивает в <p>.
 * Поддерживает {{...}} выражения с разрешением против gameState и localContext.
 */
export function RichTextComponent({
  component,
  localContext,
  gameState,
}: {
  component: GameUiComponent<GameUiRichTextComponentProps>;
  localContext?: Record<string, unknown>;
  gameState?: Record<string, unknown>;
}) {
  const { html, cssClass } = component.props;
  const resolvedHtml = resolveExpression(html, gameState ?? {}, localContext);
  const normalized = resolvedHtml.trim();

  if (!normalized) {
    return null;
  }

  if (normalized.includes("<")) {
    return <div className={cssClass} dangerouslySetInnerHTML={{ __html: normalized }} />;
  }

  return <p className={cssClass}>{normalized}</p>;
}