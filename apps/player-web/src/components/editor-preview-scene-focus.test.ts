import { describe, expect, it, vi } from "vitest";
import { scrollPreviewSceneFocus } from "./editor-preview-scene-focus";

describe("scrollPreviewSceneFocus", () => {
  it("scrolls the card with the exact game-content origin, not another rendered card", () => {
    const root = document.createElement("main");
    const other = document.createElement("article");
    other.dataset.previewRuntimePointer = "/screens/board/root/children/0";
    other.dataset.previewContentRuntimePointer = "/content/data/cards/2";
    other.textContent = "Same card title";
    const selected = document.createElement("article");
    selected.dataset.previewRuntimePointer = "/screens/board/root/children/0";
    selected.dataset.previewContentRuntimePointer = "/content/data/cards/3";
    selected.textContent = "Same card title";
    const otherScroll = vi.fn();
    const selectedScroll = vi.fn();
    other.scrollIntoView = otherScroll;
    selected.scrollIntoView = selectedScroll;
    root.append(other, selected);

    expect(scrollPreviewSceneFocus(root, "/content/data/cards/3")).toBe(true);
    expect(selectedScroll).toHaveBeenCalledOnce();
    expect(selectedScroll).toHaveBeenCalledWith({ block: "center", inline: "center" });
    expect(otherScroll).not.toHaveBeenCalled();
  });

  it("also accepts an exact compiled UI pointer and ignores unknown targets", () => {
    const root = document.createElement("main");
    const button = document.createElement("button");
    button.dataset.previewRuntimePointer = "/screens/board/root/children/4";
    button.scrollIntoView = vi.fn();
    root.append(button);

    expect(scrollPreviewSceneFocus(root, "/screens/board/root/children/4")).toBe(true);
    expect(button.scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollPreviewSceneFocus(root, "/content/data/cards/4")).toBe(false);
    expect(button.scrollIntoView).toHaveBeenCalledOnce();
  });
});
