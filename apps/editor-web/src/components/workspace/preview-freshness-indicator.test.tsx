import React, { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { PreviewFreshnessIndicator } from "./preview-freshness-indicator.tsx";
import { describePreviewFreshness } from "./workspace-helpers.ts";

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

describe("PreviewFreshnessIndicator (editor-preview-first-ux §9.6, mockup zone 7)", () => {
  it("renders the fresh state as an «актуален» green marker with no registry code", () => {
    render(<PreviewFreshnessIndicator descriptor={describePreviewFreshness("fresh")} />);
    const marker = container?.querySelector(".preview-freshness");
    expect(marker?.textContent).toContain("предпросмотр актуален");
    expect(marker?.classList.contains("preview-freshness-ok")).toBe(true);
    expect(marker?.getAttribute("data-diagnostic-code")).toBeNull();
    expect(container?.querySelector(".preview-freshness-dot")).not.toBeNull();
  });

  it("renders the stale state as an «отстаёт» amber marker carrying preview-stale", () => {
    render(<PreviewFreshnessIndicator descriptor={describePreviewFreshness("stale")} />);
    const marker = container?.querySelector(".preview-freshness");
    expect(marker?.textContent).toContain("предпросмотр отстаёт");
    expect(marker?.classList.contains("preview-freshness-warn")).toBe(true);
    expect(marker?.getAttribute("data-diagnostic-code")).toBe("preview-stale");
  });

  it("renders the blocked state as a «заблокирован ошибками» red marker carrying preview-blocked", () => {
    render(<PreviewFreshnessIndicator descriptor={describePreviewFreshness("blocked")} />);
    const marker = container?.querySelector(".preview-freshness");
    expect(marker?.textContent).toContain("заблокирован ошибками");
    expect(marker?.classList.contains("preview-freshness-err")).toBe(true);
    expect(marker?.getAttribute("data-diagnostic-code")).toBe("preview-blocked");
  });
});
