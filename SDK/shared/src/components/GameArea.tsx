'use client';

import { memo, useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";

export interface GameAreaProps {
  cssClass?: string;
  style?: CSSProperties;
  cssInline?: CSSProperties;
  backgroundImage?: string;
  children?: ReactNode;
}

/**
 * Область экрана, в которой размещаются карточки и переменные.
 */
function GameAreaComponent({ cssClass = "", style, cssInline, backgroundImage, children, ...divProps }: GameAreaProps) {
  const mergedStyle = useMemo(() => {
    const next = { ...(cssInline || {}), ...(style || {}) } as React.CSSProperties;
    if (!next.background && !next.backgroundImage && backgroundImage) {
      const bg = backgroundImage.startsWith("url(") ? backgroundImage : `url(${backgroundImage})`;
      next.backgroundImage = bg;
      next.backgroundSize ||= "cover";
      next.backgroundRepeat ||= "no-repeat";
      next.backgroundPosition ||= "center";
    }
    return next;
  }, [cssInline, style, backgroundImage]);

  return (
    <div className={`default-area-component ${cssClass}`.trim()} style={mergedStyle} {...divProps}>
      {children}
    </div>
  );
}

export const GameArea = memo(GameAreaComponent);
