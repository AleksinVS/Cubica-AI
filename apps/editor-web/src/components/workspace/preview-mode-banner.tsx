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

import type { StateFixtureSummary } from "@/components/workspace/types";

export function PreviewModeBanner({
  editorMode,
  stepLabel,
  playthroughRunning,
  canApply,
  onApply,
  fixtures = [],
  selectedFixtureId,
  onSelectFixture = () => {}
}: {
  readonly editorMode: "design" | "preview";
  readonly stepLabel: string | undefined;
  readonly playthroughRunning: boolean;
  readonly canApply: boolean;
  readonly onApply: () => void;
  /** Pinned fixtures for the Design-mode state selector (ADR-057 §9.3). */
  readonly fixtures?: readonly StateFixtureSummary[];
  /** The effective selected fixture id (author pick or §9.3 default), if any. */
  readonly selectedFixtureId?: string | undefined;
  readonly onSelectFixture?: (fixtureId: string) => void;
}) {
  // Whether the currently selected fixture carries the `fixture-stale` verdict —
  // drives the «устарела» badge next to the selector (design-spec §4).
  const selectedFixture = fixtures.find((fixture) => fixture.id === selectedFixtureId);
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
      {editorMode === "design" ? (
        <span className="preview-state-selector">
          Состояние:{" "}
          <select
            aria-label="Состояние: фикстура"
            value={selectedFixtureId ?? ""}
            onChange={(event) => {
              if (event.target.value !== "") {
                onSelectFixture(event.target.value);
              }
            }}
          >
            <option value="">синтетическое состояние</option>
            {fixtures.map((fixture) => (
              <option key={fixture.id} value={fixture.id}>
                фикстура «{fixture._label}»{fixture.stale ? " — устарела" : ""}
              </option>
            ))}
          </select>
          {selectedFixture?.stale === true ? <b className="preview-state-stale-badge">устарела</b> : null}
        </span>
      ) : null}
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
