import type {
  GameUiComponent,
  GameUiRichTextComponentProps
} from "@cubica/contracts-manifest";
import { resolveExpressions } from "@/lib/expression-resolver";
import type { PreviewElementAttributes } from "./preview-metadata";

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
  previewAttributes,
}: {
  component: GameUiComponent<GameUiRichTextComponentProps>;
  localContext?: Record<string, unknown>;
  gameState?: Record<string, unknown>;
  previewAttributes?: PreviewElementAttributes;
}) {
  const { html, cssClass } = component.props;
  const resolvedHtml = resolveExpressions(html, gameState ?? {}, localContext);
  const normalized = String(resolvedHtml).trim();

  if (!normalized) {
    return null;
  }

  if (normalized.includes("<")) {
    return <div {...previewAttributes} className={cssClass} dangerouslySetInnerHTML={{ __html: normalized }} />;
  }

  return <p {...previewAttributes} className={cssClass}>{normalized}</p>;
}
