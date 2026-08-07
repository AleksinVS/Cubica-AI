import type {
  GameUiComponent,
  GameUiRichTextComponentProps
} from "@cubica/contracts-manifest";
import { sanitizeManifestRichText } from "@cubica/contracts-manifest/rich-text-sanitizer";
import { resolveExpressions } from "@/lib/expression-resolver";
import type { PreviewElementAttributes } from "./preview-metadata";

/**
 * Рендерит richTextComponent — безопасное HTML-подмножество или plain-text тело.
 *
 * HTML очищается общим с публикацией белым списком непосредственно перед
 * вставкой. Это повторная защита после подстановки выражений, значения которых
 * ещё не известны во время публикации манифеста.
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
  const props: Partial<GameUiRichTextComponentProps> = component.props ?? {};
  const { html, cssClass } = props;
  const resolvedHtml = resolveExpressions(html ?? "", gameState ?? {}, localContext);
  const normalized = String(resolvedHtml).trim();

  if (!normalized) {
    return null;
  }

  if (normalized.includes("<")) {
    const sanitized = sanitizeManifestRichText(normalized).trim();
    if (!sanitized) {
      return null;
    }
    return <div {...previewAttributes} className={cssClass} dangerouslySetInnerHTML={{ __html: sanitized }} />;
  }

  return <p {...previewAttributes} className={cssClass}>{normalized}</p>;
}
