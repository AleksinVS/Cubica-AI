'use client';

import { memo, useCallback, useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ActionBinding, ActionDispatcher } from "../actions";

const safeBackground = (source?: string) => {
  if (!source) return undefined;
  return source.startsWith("url(") ? source : `url(${source})`;
};

export interface GameButtonProps {
  id?: string;
  cssClass?: string;
  caption?: string;
  backgroundImage?: string;
  actions?: ActionBinding;
  style?: CSSProperties;
  cssInline?: CSSProperties;
  children?: ReactNode;
  onAction?: ActionDispatcher;
}

/**
 * Кнопка игрового экрана. Делегирует обработку кликов презентеру через onAction.
 */
function GameButtonComponent({
  id,
  cssClass,
  caption,
  backgroundImage,
  actions,
  style,
  cssInline,
  children,
  onAction,
  ...rest
}: GameButtonProps) {
  const mergedStyle = useMemo(() => {
    const next = { ...(cssInline || {}), ...(style || {}) } as CSSProperties;
    const bg = safeBackground(backgroundImage);
    if (bg && !next.background && !next.backgroundImage) {
      next.backgroundImage = bg;
      next.backgroundSize ||= "cover";
      next.backgroundRepeat ||= "no-repeat";
      next.backgroundPosition ||= "center";
    }
    return next;
  }, [cssInline, style, backgroundImage]);

  const handleClick = useCallback(() => {
    if (actions?.onClick) {
      onAction?.(actions.onClick, { componentId: id, event: "click" });
    }
  }, [actions, id, onAction]);

  return (
    <button
      type="button"
      className={`default-game-button ${cssClass || ""}`.trim()}
      style={mergedStyle}
      onClick={actions?.onClick ? handleClick : undefined}
      aria-disabled={!actions?.onClick || undefined}
      {...rest}
    >
      {caption ?? children}
    </button>
  );
}

export const GameButton = memo(GameButtonComponent);
