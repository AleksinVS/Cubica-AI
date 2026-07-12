/** Focused tests for optional, non-modal Save metadata. */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { SaveVersionControl } from "./save-version-control.tsx";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SaveVersionControl", () => {
  it("keeps ordinary Save one click and exposes the deterministic summary optionally", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSave = vi.fn();
    await act(async () => root.render(
      <SaveVersionControl
        disabled={false}
        saving={false}
        proposedSummary="Изменений: 2 · файлов: 1"
        authorComment=""
        onAuthorCommentChange={vi.fn()}
        onSave={onSave}
      />
    ));
    await act(async () => (container.querySelector("[data-testid='save-version-action']") as HTMLButtonElement).click());
    expect(onSave).toHaveBeenCalledOnce();
    expect(container.querySelector("[role='dialog']")).toBeNull();
    expect(container.textContent).toContain("Изменений: 2");
    await act(async () => root.unmount());
    container.remove();
  });

  it("reports comment changes through the controlled input", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();
    await act(async () => root.render(
      <SaveVersionControl disabled={false} saving={false} proposedSummary="Обновлён файл" authorComment="черновик" onAuthorCommentChange={onChange} onSave={vi.fn()} />
    ));
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(textarea, "готово");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("готово");
    await act(async () => root.unmount());
    container.remove();
  });

  it("supports Ctrl+Enter from the optional comment field", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onSave = vi.fn();
    await act(async () => root.render(
      <SaveVersionControl disabled={false} saving={false} proposedSummary="Обновлён файл" authorComment="готово" onAuthorCommentChange={vi.fn()} onSave={onSave} />
    ));
    await act(async () => (container.querySelector("textarea") as HTMLTextAreaElement).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })));
    expect(onSave).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });
});
