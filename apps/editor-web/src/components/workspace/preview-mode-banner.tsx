/**
 * Preview mode banner over the game canvas (design-spec §3.3, mockup zone 3).
 *
 * Renders the loud, colour-coded mode plate ("Дизайн"/"Превью") and, in "Превью"
 * when the preview lags behind valid edits, the stale plate carrying the manual
 * «Применить» action. It is purely presentational: the apply POLICY (when the
 * stale plate may show) is decided upstream and passed as `canApply`.
 *
 * The bar is click-through (`pointer-events: none` in CSS) except its own
 * controls, so it never blocks pointer input aimed at the game or the inspect
 * overlay beneath it.
 */
import React from "react";

export function PreviewModeBanner({
  editorMode,
  stepLabel,
  playthroughRunning,
  canApply,
  onApply
}: {
  readonly editorMode: "design" | "preview";
  readonly stepLabel: string | undefined;
  readonly playthroughRunning: boolean;
  readonly canApply: boolean;
  readonly onApply: () => void;
}) {
  return (
    <div className="preview-modebar" aria-label="Preview mode banner">
      {editorMode === "design" ? (
        <span className="preview-mode-plate preview-mode-plate-design">
          Дизайн{stepLabel !== undefined ? ` · шаг ${stepLabel}` : ""}
        </span>
      ) : (
        <span className="preview-mode-plate preview-mode-plate-preview">
          Превью{playthroughRunning ? " · идёт прохождение" : ""}
        </span>
      )}
      {canApply ? (
        <span className="preview-stale-plate">
          Предпросмотр отстаёт от правок —{" "}
          <button type="button" onClick={onApply}>
            Применить
          </button>
        </span>
      ) : null}
    </div>
  );
}
