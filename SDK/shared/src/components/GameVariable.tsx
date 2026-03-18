'use client';

import { motion, useAnimation } from "framer-motion";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
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

export interface GameVariableProps {
  id?: string;
  cssClass?: string;
  cssInline?: CSSProperties;
  style?: CSSProperties;
  caption?: string;
  value?: string | number;
  description?: string;
  backgroundImage?: string;
  actions?: ActionBinding;
  onAction?: ActionDispatcher;
}

/**
 * Виджет переменной (метрики) сценария. Визуально подсвечивает изменения и показывает описание при наведении.
 */
function GameVariableComponent({
  id,
  cssClass,
  cssInline,
  style,
  caption,
  value,
  description,
  backgroundImage,
  actions,
  onAction
}: GameVariableProps) {
  const [showDescription, setShowDescription] = useState(false);
  const controls = useAnimation();

  useEffect(() => {
    controls.start({
      x: [0, -5, 5, -5, 5, 0],
      transition: { type: "spring", stiffness: 500, damping: 10 }
    });
  }, [value, controls]);

  const btnStyle = useMemo(() => {
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

  const handleMouseEnter = useCallback(() => {
    if (actions?.onHover) {
      onAction?.(actions.onHover, { componentId: id, event: "hover" });
    }
    setShowDescription(true);
  }, [actions, id, onAction]);

  const handleMouseLeave = useCallback(() => {
    setShowDescription(false);
  }, []);

  return (
    <div className={`default-game-variable ${cssClass || ""}`.trim()}>
      <motion.button
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={btnStyle}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
      >
        <motion.span animate={controls} initial={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }}>
          {value}
        </motion.span>
      </motion.button>

      <div>
        <span>{caption}</span>
      </div>

      {showDescription && description && (
        <div className="description-div">
          <span>{description}</span>
        </div>
      )}
    </div>
  );
}

export const GameVariable = memo(
  GameVariableComponent,
  (prev, next) =>
    prev.id === next.id &&
    prev.value === next.value &&
    prev.caption === next.caption &&
    prev.description === next.description &&
    prev.backgroundImage === next.backgroundImage &&
    prev.cssClass === next.cssClass &&
    shallowEqual(prev.cssInline as Record<string, unknown>, next.cssInline as Record<string, unknown>) &&
    shallowEqual(prev.style as Record<string, unknown>, next.style as Record<string, unknown>)
);
