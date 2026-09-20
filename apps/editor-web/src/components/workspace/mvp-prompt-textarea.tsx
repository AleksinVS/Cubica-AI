"use client";

import React, { forwardRef, useLayoutEffect, useRef } from "react";

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
  const localRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = localRef.current;
    if (textarea === null) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
    onHeightChange?.(textarea.scrollHeight);
  }, [value, onHeightChange]);

  return <textarea
    ref={(textarea) => {
      localRef.current = textarea;
      if (typeof ref === "function") ref(textarea);
      else if (ref !== null) ref.current = textarea;
    }}
    className={className}
    aria-label={ariaLabel ?? "Единый текст элемента"}
    value={value}
    disabled={disabled}
    onChange={(event) => onChange(event.currentTarget.value)}
  />;
});
