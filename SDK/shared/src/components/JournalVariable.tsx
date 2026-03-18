'use client';

import { memo, useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";

export interface JournalVariableProps {
  cssClass?: string;
  value?: number | string;
  previousValue?: number | string;
  caption?: string;
  cssInline?: CSSProperties;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * Отображает значение метрики и её изменение (для журналов событий или логов хода).
 */
function JournalVariableComponent({
  cssClass = "",
  value = 0,
  previousValue = 0,
  caption,
  cssInline,
  style,
  children,
  ...rest
}: JournalVariableProps) {
  const safeValue = Number(value ?? 0);
  const safePrev = Number(previousValue ?? 0);
  const diff = Number.isFinite(safeValue - safePrev) ? safeValue - safePrev : null;

  const mergedStyle = useMemo(() => ({ ...(cssInline || {}), ...(style || {}) } as CSSProperties), [cssInline, style]);

  return (
    <div className={`default-journal-variable-component ${cssClass}`.trim()} style={mergedStyle} {...rest}>
      <div className="journal-variable__row">
        <div className="journal-variable__value">{safeValue}</div>
        {diff ? (
          <div className="journal-variable__diff">
            <sup>
              {diff > 0 ? "+" : ""}
              {diff}
            </sup>
          </div>
        ) : null}
      </div>
      <div className="journal-variable__caption">{caption}</div>
      {children}
    </div>
  );
}

export const JournalVariable = memo(JournalVariableComponent);
