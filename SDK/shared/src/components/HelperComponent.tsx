'use client';

import { memo, useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";

const safeBackground = (source?: string) => {
  if (!source) return undefined;
  return source.startsWith("url(") ? source : `url(${source})`;
};

const shallowEqual = (a?: Record<string, unknown>, b?: Record<string, unknown>) => {
  if (a === b) return true;
  if (!a || !b) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const key of ak) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
};

export interface HelperComponentProps {
  text?: string;
  caption?: string;
  cssClass?: string;
  src?: string;
  alt?: string;
  cssInline?: CSSProperties;
  style?: CSSProperties;
  backgroundImage?: string;
  children?: ReactNode;
}

/**
 * Универсальный вспомогательный блок (подсказка, иллюстрация, подпись).
 */
function HelperComponent({
  text,
  caption,
  cssClass = "",
  src,
  alt = "",
  cssInline,
  style,
  backgroundImage,
  children,
  ...rest
}: HelperComponentProps) {
  const hasImage = typeof src === "string" && src.length > 0;

  const mergedStyle = useMemo(() => {
    const next = { ...(cssInline || {}), ...(style || {}) } as CSSProperties;
    const bg = safeBackground(backgroundImage);
    if (bg && !next.background && !next.backgroundImage) {
      next.backgroundImage = bg;
      next.backgroundSize ??= "contain";
      next.backgroundRepeat ??= "no-repeat";
      next.backgroundPosition ??= "center";
    }
    return next;
  }, [cssInline, style, backgroundImage]);

  return (
    <div className={`default-helper ${cssClass}`.trim()} style={mergedStyle} {...rest}>
      {hasImage ? (
        <img src={src} alt={alt || caption || text || ""} loading="lazy" decoding="async" draggable="false" />
      ) : (
        <span>{text && text.trim() ? text : caption ?? children}</span>
      )}
    </div>
  );
}

export default memo(
  HelperComponent,
  (a, b) =>
    a.text === b.text &&
    a.caption === b.caption &&
    a.cssClass === b.cssClass &&
    a.src === b.src &&
    a.alt === b.alt &&
    a.backgroundImage === b.backgroundImage &&
    shallowEqual(a.cssInline as Record<string, unknown>, b.cssInline as Record<string, unknown>) &&
    shallowEqual(a.style as Record<string, unknown>, b.style as Record<string, unknown>) &&
    a.children === b.children
);
