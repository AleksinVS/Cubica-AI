import type {
  GameUiComponent,
  GameUiImageComponentProps
} from "@cubica/contracts-manifest";
import { resolveExpressions } from "@/lib/expression-resolver";
import { resolveGameAssetReference, type GameAssetResolver } from "@/lib/game-asset-resolver";
import type { PreviewElementAttributes } from "./preview-metadata";

/**
 * Рендерит imageComponent — иллюстрации и декоративные изображения.
 *
 * Если cssClass содержит "illustration" или "decoration",
 * рендерит как div с background-image (для интеграции в layout).
 * Иначе рендерит как семантический <img>.
 *
 * `src` may be an ordinary URL, a `{{...}}` template (resolved against game
 * state/local context), or an `asset:<id>` marker (ADR-063). TSK-20260719
 * R4b: template substitution always runs FIRST, then the resulting string is
 * checked for the `asset:` marker — this lets a manifest author write a
 * templated asset reference such as `asset:info-{{currentInfo.id}}` and have
 * the concrete id resolved through the game's asset index. An unknown id
 * fails closed (`resolveGameAssetReference` returns `undefined` and logs a
 * console warning in dev): the component renders without a broken image
 * instead of guessing a URL.
 */
export function ImageComponent({
  component,
  localContext,
  gameState,
  previewAttributes,
  assetResolver
}: {
  component: GameUiComponent<GameUiImageComponentProps>;
  localContext?: Record<string, unknown>;
  gameState?: Record<string, unknown>;
  previewAttributes?: PreviewElementAttributes;
  /** Optional game asset index (ADR-063); `asset:<id>` values fail closed while absent. */
  assetResolver?: GameAssetResolver | null;
}) {
  const props: Partial<GameUiImageComponentProps> = component.props ?? {};
  const { src, alt, cssClass } = props;
  const templatedSrc = resolveStringProp(src, gameState, localContext);
  const resolvedSrc = resolveGameAssetReference(templatedSrc, assetResolver);
  const resolvedAlt = resolveStringProp(alt, gameState, localContext);
  const resolvedCssClass = resolveStringProp(cssClass, gameState, localContext);
  const isDecorative = resolvedCssClass?.includes("illustration") || resolvedCssClass?.includes("decoration");

  if (isDecorative) {
    return (
      <div
        {...previewAttributes}
        className={resolvedCssClass}
        // Fail closed: omit the style entirely when there is no resolved
        // image (missing asset id, or an asset reference the index does not
        // yet contain) instead of emitting a broken `url(undefined)`.
        style={resolvedSrc ? { backgroundImage: `url(${resolvedSrc})` } : undefined}
        role="img"
        aria-label={resolvedAlt}
      />
    );
  }

  // Fail closed: omit the `src` attribute rather than pointing the browser at
  // an empty/undefined URL, which would otherwise trigger a spurious request.
  return (
    <img
      {...previewAttributes}
      src={resolvedSrc}
      alt={resolvedAlt ?? ""}
      className={resolvedCssClass}
    />
  );
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
