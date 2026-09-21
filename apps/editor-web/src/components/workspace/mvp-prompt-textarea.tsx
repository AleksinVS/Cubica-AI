"use client";

import React, { forwardRef, useLayoutEffect, useRef } from "react";
import { MVP_PROMPT_SEPARATOR } from "./mvp-prompt-document";
import styles from "./mvp-prompt-textarea.module.css";

export interface MvpPromptTextareaProps {
  readonly value: string;
  readonly onChange: (raw: string) => void;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly "aria-label"?: string;
  readonly onHeightChange?: (height: number) => void;
}

/** A plain textarea: selection, paste, composition, and undo stay browser-native. */
export const MvpPromptTextarea = forwardRef<HTMLTextAreaElement, MvpPromptTextareaProps>(function MvpPromptTextarea(
  { value, onChange, disabled, className, onHeightChange, "aria-label": ariaLabel }, ref
) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const mirrorRef = useRef<HTMLPreElement | null>(null);
  const lines = value.replace(/\r\n?/gu, "\n").split("\n");
  const boundaries = lines.flatMap((line, index) => line === MVP_PROMPT_SEPARATOR ? [index] : []);
  const hints = new Map<number, string>();
  if (boundaries.length === 2) {
    const starts = [0, boundaries[0] + 1, boundaries[1] + 1];
    const ends = [boundaries[0], boundaries[1], lines.length];
    const labels = ["Разовый запрос: что изменить сейчас?", "Авторское описание: замысел и назначение", "Структурированный промт: свойства элемента"];
    starts.forEach((start, index) => {
      if (lines.slice(start, ends[index]).join("\n").trim() === "") hints.set(start, labels[index]);
    });
  }

  useLayoutEffect(() => {
    const textarea = localRef.current;
    if (textarea === null) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
    onHeightChange?.(textarea.scrollHeight);
  }, [value, onHeightChange]);

  return <div className={styles.document}><textarea
    ref={(textarea) => {
      localRef.current = textarea;
      if (typeof ref === "function") ref(textarea);
      else if (ref !== null) ref.current = textarea;
    }}
    className={className}
    aria-label={ariaLabel ?? "Единый текст элемента"}
    aria-description="Три раздела: разовый запрос, авторское описание и структурированный промт. Разделяются двумя строками знаков равенства."
    value={value}
    disabled={disabled}
    onChange={(event) => onChange(event.currentTarget.value)}
    onScroll={(event) => { if (mirrorRef.current) mirrorRef.current.scrollTop = event.currentTarget.scrollTop; }}
  />
    <pre ref={mirrorRef} className={`${styles.mirror} ${className ?? ""}`} aria-hidden="true">
      {lines.map((line, index) => <React.Fragment key={index}>
        {hints.has(index) ? <span className={styles.hint}>{hints.get(index)}</span> : null}
        {line}{index < lines.length - 1 ? "\n" : ""}
      </React.Fragment>)}
    </pre>
  </div>;
});
