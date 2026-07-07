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
import { formatPreviewBlockedMessage } from "@/components/workspace/workspace-helpers";

/**
 * The broken-compile plate model (ADR-057 §4.12; §9.6; design-spec §3.5). When a
 * last valid snapshot is on screen and compilation is blocked by errors, the plate
 * renders over it: «Показана последняя рабочая версия — N правок назад. M ошибок…»
 * plus «К первой ошибке». `undefined` means the compile is fine (no plate).
 */
export interface PreviewBlockedPlateModel {
  /** Number of edits made since the last valid compiled snapshot (N). */
  readonly editsSincePreview: number;
  /** Number of error-severity diagnostics blocking the compile (M). */
  readonly blockingErrorCount: number;
  /** Whether there is a first blocking diagnostic to jump to. */
  readonly canNavigateToError: boolean;
  /** Jumps to the first blocking diagnostic (reuses §8.1 Checks navigation). */
  readonly onNavigateToError: () => void;
}

export function PreviewModeBanner({
  editorMode,
  stepLabel,
  playthroughRunning,
  canApply,
  onApply,
  fixtures = [],
  selectedFixtureId,
  onSelectFixture = () => {},
  blockedPlate
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
  /** Broken-compile plate over the last valid snapshot, or `undefined`. */
  readonly blockedPlate?: PreviewBlockedPlateModel | undefined;
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
      {/* Broken compile does NOT blank the preview (ADR-057 §4.12; §9.6): the last
          valid snapshot stays mounted below, and this red plate explains why the
          preview is frozen and links straight to the first blocking error. */}
      {blockedPlate !== undefined ? (
        <span className="preview-blocked-plate" data-testid="preview-blocked-plate">
          {formatPreviewBlockedMessage(blockedPlate.editsSincePreview, blockedPlate.blockingErrorCount)}
          {blockedPlate.canNavigateToError ? (
            <button
              type="button"
              data-testid="preview-blocked-first-error"
              onClick={blockedPlate.onNavigateToError}
            >
              К первой ошибке
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
