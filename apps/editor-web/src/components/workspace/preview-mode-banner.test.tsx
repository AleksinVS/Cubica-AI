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
});
