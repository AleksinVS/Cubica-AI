import React, { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PreviewModeBanner } from "./preview-mode-banner.tsx";

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

describe("PreviewModeBanner (design-spec §3.3, mockup zone 3)", () => {
  it("shows the blue «Дизайн» plate and no stale plate in design mode", () => {
    render(
      <PreviewModeBanner editorMode="design" stepLabel="T2" playthroughRunning={false} canApply={false} onApply={vi.fn()} />
    );
    const plate = container?.querySelector(".preview-mode-plate-design");
    expect(plate?.textContent).toContain("Дизайн");
    expect(plate?.textContent).toContain("T2");
    expect(container?.querySelector(".preview-stale-plate")).toBeNull();
  });

  it("shows the «Предпросмотр отстаёт от правок — Применить» plate in Превью when edits are unapplied", () => {
    const onApply = vi.fn();
    render(
      <PreviewModeBanner editorMode="preview" stepLabel="T3" playthroughRunning canApply onApply={onApply} />
    );
    const stale = container?.querySelector(".preview-stale-plate");
    expect(stale?.textContent).toContain("Предпросмотр отстаёт от правок");
    const applyButton = stale?.querySelector("button");
    expect(applyButton?.textContent).toBe("Применить");
    act(() => {
      applyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onApply).toHaveBeenCalledTimes(1);
    // The Превью plate goes green and announces a running playthrough.
    expect(container?.querySelector(".preview-mode-plate-preview")?.textContent).toContain("идёт прохождение");
  });

  it("hides the stale plate in Превью once the preview is fresh", () => {
    render(
      <PreviewModeBanner editorMode="preview" stepLabel={undefined} playthroughRunning={false} canApply={false} onApply={vi.fn()} />
    );
    expect(container?.querySelector(".preview-stale-plate")).toBeNull();
  });

  it("renders the broken-compile plate with N/M and «К первой ошибке» navigating (ADR-057 §4.12; §9.6)", () => {
    const onNavigateToError = vi.fn();
    render(
      <PreviewModeBanner
        editorMode="design"
        stepLabel="T2"
        playthroughRunning={false}
        canApply={false}
        onApply={vi.fn()}
        blockedPlate={{ editsSincePreview: 3, blockingErrorCount: 2, canNavigateToError: true, onNavigateToError }}
      />
    );
    const plate = container?.querySelector(".preview-blocked-plate");
    expect(plate?.textContent).toContain("Показана последняя рабочая версия");
    expect(plate?.textContent).toContain("3 правки назад");
    expect(plate?.textContent).toContain("2 ошибки");
    const button = container?.querySelector("[data-testid='preview-blocked-first-error']");
    expect(button?.textContent).toBe("К первой ошибке");
    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onNavigateToError).toHaveBeenCalledTimes(1);
  });

  it("omits the broken-compile plate when the compile is fine", () => {
    render(
      <PreviewModeBanner editorMode="design" stepLabel="T2" playthroughRunning={false} canApply={false} onApply={vi.fn()} />
    );
    expect(container?.querySelector(".preview-blocked-plate")).toBeNull();
  });

  it("hides «К первой ошибке» when no first blocking error resolves", () => {
    render(
      <PreviewModeBanner
        editorMode="design"
        stepLabel={undefined}
        playthroughRunning={false}
        canApply={false}
        onApply={vi.fn()}
        blockedPlate={{ editsSincePreview: 1, blockingErrorCount: 1, canNavigateToError: false, onNavigateToError: vi.fn() }}
      />
    );
    expect(container?.querySelector(".preview-blocked-plate")).not.toBeNull();
    expect(container?.querySelector("[data-testid='preview-blocked-first-error']")).toBeNull();
  });
});
