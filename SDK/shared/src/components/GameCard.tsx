'use client';

import { memo, useCallback, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ActionBinding, ActionDispatcher } from "../actions";

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

export interface GameCardProps {
  id?: string;
  cssClass?: string;
  text?: string;
  backgroundImage?: string;
  actions?: ActionBinding;
  style?: CSSProperties;
  cssInline?: CSSProperties;
  children?: ReactNode;
  onAction?: ActionDispatcher;
}

/**
 * Карточка действия или события. Может переворачиваться при клике.
 */
function GameCardComponent({
  id,
  cssClass,
  text,
  backgroundImage,
  actions,
  style,
  cssInline,
  children,
  onAction,
  ...rest
}: GameCardProps) {
  const [isFlipped, setIsFlipped] = useState(false);

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
    if (!actions?.onClick) return;
    onAction?.(actions.onClick, { componentId: id, event: "click" });
    setIsFlipped((flag) => !flag);
  }, [actions, id, onAction]);

  return (
    <div
      className={`default-game-card ${cssClass || ""} ${isFlipped ? "flipped" : ""}`.trim()}
      style={mergedStyle}
      onClick={actions?.onClick ? handleClick : undefined}
      {...rest}
    >
      {text}
      {children}
    </div>
  );
}

export const GameCard = memo(
  GameCardComponent,
  (prev, next) =>
    prev.id === next.id &&
    prev.text === next.text &&
    prev.cssClass === next.cssClass &&
    prev.backgroundImage === next.backgroundImage &&
    prev.actions === next.actions &&
    shallowEqual(prev.style as Record<string, unknown>, next.style as Record<string, unknown>) &&
    shallowEqual(prev.cssInline as Record<string, unknown>, next.cssInline as Record<string, unknown>) &&
    prev.children === next.children
);
