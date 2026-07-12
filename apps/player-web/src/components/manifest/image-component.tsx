import type {
  GameUiComponent,
  GameUiImageComponentProps
} from "@cubica/contracts-manifest";
import { resolveExpressions } from "@/lib/expression-resolver";
import type { PreviewElementAttributes } from "./preview-metadata";

/**
 * Рендерит imageComponent — иллюстрации и декоративные изображения.
 *
 * Если cssClass содержит "illustration" или "decoration",
 * рендерит как div с background-image (для интеграции в layout).
 * Иначе рендерит как семантический <img>.
 */
export function ImageComponent({
  component,
  localContext,
  gameState,
  previewAttributes,
}: {
  component: GameUiComponent<GameUiImageComponentProps>;
  localContext?: Record<string, unknown>;
  gameState?: Record<string, unknown>;
  previewAttributes?: PreviewElementAttributes;
}) {
  const props: Partial<GameUiImageComponentProps> = component.props ?? {};
  const { src, alt, cssClass } = props;
  const resolvedSrc = resolveStringProp(src, gameState, localContext);
  const resolvedAlt = resolveStringProp(alt, gameState, localContext);
  const resolvedCssClass = resolveStringProp(cssClass, gameState, localContext);
  const isDecorative = resolvedCssClass?.includes("illustration") || resolvedCssClass?.includes("decoration");

  if (isDecorative) {
    return (
      <div
        {...previewAttributes}
        className={resolvedCssClass}
        style={{ backgroundImage: `url(${resolvedSrc})` }}
        role="img"
        aria-label={resolvedAlt}
      />
    );
  }

  return <img {...previewAttributes} src={resolvedSrc} alt={resolvedAlt ?? ""} className={resolvedCssClass} />;
}

function resolveStringProp(
  value: string | undefined,
  gameState: Record<string, unknown> | undefined,
  localContext: Record<string, unknown> | undefined
): string | undefined {
  if (!value || !value.includes("{{")) {
    return value;
  }
  return String(resolveExpressions(value, gameState ?? {}, localContext));
}
