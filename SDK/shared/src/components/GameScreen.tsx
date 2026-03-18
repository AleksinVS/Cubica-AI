'use client';

import { memo, useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";

export interface GameScreenProps {
  cssClass?: string;
  style?: CSSProperties;
  cssInline?: CSSProperties;
  backgroundImage?: string;
  children?: ReactNode;
}

/**
 * Корневой контейнер экрана игры.
 */
function GameScreenComponent({ cssClass = "", style, cssInline, backgroundImage, children, ...divProps }: GameScreenProps) {
  const mergedStyle = useMemo(() => {
    const next = { ...(cssInline || {}), ...(style || {}) } as React.CSSProperties;
    if (backgroundImage && !next.background && !next.backgroundImage) {
      const bg = backgroundImage.startsWith("url(") ? backgroundImage : `url(${backgroundImage})`;
      next.backgroundImage = bg;
      next.backgroundSize ||= "cover";
      next.backgroundRepeat ||= "no-repeat";
      next.backgroundPosition ||= "center";
    }
    return next;
  }, [cssInline, style, backgroundImage]);

  return (
    <div className={`default-main-screen ${cssClass}`.trim()} style={mergedStyle} {...divProps}>
      {children}
    </div>
  );
}

export const GameScreen = memo(GameScreenComponent);
