/** Focused state tests for renderer channel and preview orientation controls. */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { usePreviewRuntimeState } from "./use-editor-workspace-state.ts";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | undefined;
let root: Root | undefined;

function OrientationHarness() {
  const {
    previewChannel,
    setPreviewChannel,
    previewViewportOrientation,
    setPreviewViewportOrientation
  } = usePreviewRuntimeState();
  return (
    <>
      <button type="button" onClick={() => setPreviewViewportOrientation("portrait")}>
        {previewViewportOrientation}
      </button>
      <button type="button" onClick={() => setPreviewChannel("telegram")}>
        {previewChannel}
      </button>
    </>
  );
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

describe("usePreviewRuntimeState orientation", () => {
  it("starts landscape and updates independently to portrait", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<OrientationHarness />));

    const [orientation, channel] = Array.from(container.querySelectorAll("button"));
    expect(orientation?.textContent).toBe("landscape");
    expect(channel?.textContent).toBe("web");
    act(() => {
      orientation?.click();
      channel?.click();
    });
    expect(orientation?.textContent).toBe("portrait");
    expect(channel?.textContent).toBe("telegram");
  });
});
