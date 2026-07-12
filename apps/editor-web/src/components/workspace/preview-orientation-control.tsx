/**
 * Compact orientation selector for the preview toolbar.
 *
 * The component owns no state and knows nothing about the preview iframe. That
 * separation keeps orientation a visual concern: callers update the frame
 * dimensions while the running game and authoring document remain untouched.
 */
import React from "react";

import { editorRu as t } from "@/lib/locale";

import type { PreviewViewportOrientation } from "./types.ts";

export interface PreviewOrientationControlProps {
  readonly orientation: PreviewViewportOrientation;
  readonly onOrientationChange: (orientation: PreviewViewportOrientation) => void;
}

export function PreviewOrientationControl({
  orientation,
  onOrientationChange
}: PreviewOrientationControlProps) {
  return (
    <div className="segmented-control orientation-control" role="group" aria-label={t.toolbar.orientationAria}>
      {(["landscape", "portrait"] as const).map((option) => (
        <button
          key={option}
          type="button"
          className={orientation === option ? "is-active" : ""}
          aria-pressed={orientation === option}
          onClick={() => onOrientationChange(option)}
        >
          {option === "landscape" ? t.toolbar.orientationLandscape : t.toolbar.orientationPortrait}
        </button>
      ))}
    </div>
  );
}
