/** Focused interaction tests for the preview orientation selector. */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { editorRu as t } from "@/lib/locale";

import { PreviewOrientationControl } from "./preview-orientation-control.tsx";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

describe("PreviewOrientationControl", () => {
  it("marks the current orientation and reports a portrait selection", () => {
    const onOrientationChange = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <PreviewOrientationControl
          orientation="landscape"
          onOrientationChange={onOrientationChange}
        />
      );
    });

    const landscape = container.querySelector<HTMLButtonElement>("button[aria-pressed='true']");
    const portrait = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Книжная"
    );

    expect(container.querySelector("[role='group']")?.getAttribute("aria-label")).toBe("Ориентация экрана");
    expect(landscape?.textContent).toBe("Альбомная");
    act(() => portrait?.click());
    expect(onOrientationChange).toHaveBeenCalledWith("portrait");
    expect(t.statusBar.viewportValue("tablet", "portrait")).toBe("планшет · книжная");
  });
});
