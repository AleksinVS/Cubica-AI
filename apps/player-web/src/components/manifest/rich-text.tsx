import type { CSSProperties } from "react";
import type { RichTextProps } from "@/types/game-state";

/**
 * Рендерит HTML-строку из манифеста.
 * Если строка содержит HTML-теги — рендерит через dangerouslySetInnerHTML,
 * иначе оборачивает в <p>.
 */
export function RichText({ html, className }: RichTextProps) {
  const normalized = html.trim();

  if (!normalized) {
    return null;
  }

  if (normalized.includes("<")) {
    return <div className={className} dangerouslySetInnerHTML={{ __html: normalized }} />;
  }

  return <p className={className}>{normalized}</p>;
}
