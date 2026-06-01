import type {
  GameUiComponent,
  GameUiImageComponentProps
} from "@cubica/contracts-manifest";
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
  previewAttributes,
}: {
  component: GameUiComponent<GameUiImageComponentProps>;
  previewAttributes?: PreviewElementAttributes;
}) {
  const { src, alt, cssClass } = component.props;
  const isDecorative = cssClass?.includes("illustration") || cssClass?.includes("decoration");

  if (isDecorative) {
    return (
      <div
        {...previewAttributes}
        className={cssClass}
        style={{ backgroundImage: `url(${src})` }}
        role="img"
        aria-label={alt}
      />
    );
  }

  return <img {...previewAttributes} src={src} alt={alt ?? ""} className={cssClass} />;
}
