/**
 * UI tests for the state-fixture surfaces (ADR-057 §9.3; design-spec §3.3):
 *   - the Design-mode state selector in the preview modebar (mockup zone 3), and
 *   - the "Закрепить как фикстуру" control in the timeline panel (mockup zone 6).
 *
 * Rendered with react-dom/client + act, matching the other workspace panel tests.
 */
import React, { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PreviewModeBanner } from "./preview-mode-banner.tsx";
import { TimelineSidebarPanel } from "./timeline-sidebar-panel.tsx";
import type { StateFixtureSummary } from "./types.ts";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | undefined;
let root: Root | undefined;

function render(element: ReactElement): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(element);
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = undefined;
  root = undefined;
});

/** Drives a controlled form element so React's onChange fires (native value setter). */
function setControlledValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const prototype = element instanceof HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
}

const fixtures: readonly StateFixtureSummary[] = [
  { id: "day4", _label: "День 4", state: { stage: "day4" }, manifestHash: "sha256-a", stale: false },
  { id: "old-day", _label: "Старый день", state: { stage: "x" }, manifestHash: "sha256-b", stale: true }
];

describe("Design-mode state (fixture) selector", () => {
  it("lists pinned fixtures and reports selection through onSelectFixture", () => {
    const onSelectFixture = vi.fn();
    render(
      <PreviewModeBanner
        editorMode="design"
        stepLabel="T2"
        playthroughRunning={false}
        canApply={false}
        onApply={vi.fn()}
        fixtures={fixtures}
        selectedFixtureId={undefined}
        onSelectFixture={onSelectFixture}
      />
    );
    const select = container?.querySelector<HTMLSelectElement>(".preview-state-selector select");
    expect(select).not.toBeNull();
    // Synthetic option + one option per fixture.
    expect(select?.querySelectorAll("option").length).toBe(1 + fixtures.length);
    expect(container?.querySelector(".preview-state-selector")?.textContent).toContain("Состояние:");

    act(() => {
      setControlledValue(select!, "day4");
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onSelectFixture).toHaveBeenCalledWith("day4");
  });

  it("shows the «устарела» badge when the selected fixture is stale", () => {
    render(
      <PreviewModeBanner
        editorMode="design"
        stepLabel={undefined}
        playthroughRunning={false}
        canApply={false}
        onApply={vi.fn()}
        fixtures={fixtures}
        selectedFixtureId="old-day"
        onSelectFixture={vi.fn()}
      />
    );
    expect(container?.querySelector(".preview-state-stale-badge")?.textContent).toBe("устарела");
  });

  it("does not render the state selector in Превью mode", () => {
    render(
      <PreviewModeBanner
        editorMode="preview"
        stepLabel={undefined}
        playthroughRunning={false}
        canApply={false}
        onApply={vi.fn()}
        fixtures={fixtures}
        selectedFixtureId={undefined}
        onSelectFixture={vi.fn()}
      />
    );
    expect(container?.querySelector(".preview-state-selector")).toBeNull();
  });
});

describe("«Закрепить как фикстуру» timeline control", () => {
  function renderPanel(canPinFixture: boolean, onPinFixture = vi.fn()) {
    render(
      <TimelineSidebarPanel
        traceEntries={[]}
        selectedTraceEvent={undefined}
        selectedTraceSnapshot={undefined}
        selectedTraceSequence={undefined}
        currentTraceSequence={undefined}
        rollbackState="idle"
        onCollapse={vi.fn()}
        onSelectTraceSequence={vi.fn()}
        onRestoreSelectedTrace={vi.fn()}
        onReset={vi.fn()}
        onReplayCurrent={vi.fn()}
        canPinFixture={canPinFixture}
        onPinFixture={onPinFixture}
      />
    );
    return onPinFixture;
  }

  it("opens the name dialog and pins with the entered label", () => {
    const onPinFixture = renderPanel(true);
    const openButton = container?.querySelector<HTMLButtonElement>(".timeline-pin-fixture-open");
    expect(openButton?.textContent).toBe("Закрепить как фикстуру");
    expect(openButton?.disabled).toBe(false);

    act(() => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const input = container?.querySelector<HTMLInputElement>(".timeline-pin-fixture-dialog input");
    expect(input).not.toBeNull();
    act(() => {
      setControlledValue(input!, "День 4");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = container?.querySelector<HTMLButtonElement>(".timeline-pin-fixture-actions button");
    act(() => {
      submit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onPinFixture).toHaveBeenCalledWith({ label: "День 4" });
  });

  it("disables the control when pinning is not available", () => {
    renderPanel(false);
    const openButton = container?.querySelector<HTMLButtonElement>(".timeline-pin-fixture-open");
    expect(openButton?.disabled).toBe(true);
  });
});
