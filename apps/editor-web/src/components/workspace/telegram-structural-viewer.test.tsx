/** Focused rendering and selection tests for the Telegram viewer. */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreviewRendererAdapter } from "@cubica/editor-engine";

import { TelegramStructuralViewer } from "./telegram-structural-viewer.tsx";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

describe("TelegramStructuralViewer", () => {
  it("always labels the limited viewer and reports source-backed selections", () => {
    const onSelect = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<TelegramStructuralViewer projection={{
      title: "Нейтральный экран",
      messages: [{
        id: "help", kind: "helper", label: "Подсказка", text: "Выберите вариант",
        componentType: "helperComponent", sourcePointer: "/root/screens/0/root/children/0", sourceFilePath: "authoring/ui/telegram.authoring.json",
        actions: [{ id: "next", label: "Далее", command: "advance", sourcePointer: "/root/screens/0/root/children/1", sourceFilePath: "authoring/ui/telegram.authoring.json" }]
      }]
    }} onSelect={onSelect} />));

    expect(container.textContent).toContain("Структурный просмотр, не эмуляция клиента");
    const action = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Далее");
    act(() => action?.click());
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "next", sourcePointer: "/root/screens/0/root/children/1" }));
  });

  it("explains that the channel document is missing", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<TelegramStructuralViewer projection={null} onSelect={() => undefined} />));
    expect(container.textContent).toContain("не найден вид Telegram");
  });

  it("exposes source-aware bounds, point/rect hit-tests and adapter highlights", () => {
    let adapter: PreviewRendererAdapter | null = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<TelegramStructuralViewer projection={{
      title: "Экран",
      messages: [{
        id: "m1", kind: "message", label: "Сообщение", text: "Текст",
        componentType: "message", sourcePointer: "/root/screens/0/root/children/0", sourceFilePath: "authoring/ui/telegram.authoring.json",
        actions: []
      }]
    }} resolveEditorEntityId={() => "game:step:one"} onSelect={() => undefined} onAdapterChange={(value) => { adapter = value; }} />));

    const viewer = container.querySelector("[data-testid='telegram-structural-viewer']") as HTMLElement;
    const target = container.querySelector("[data-authoring-file]") as HTMLElement;
    setRect(viewer, { x: 100, y: 50, width: 500, height: 700 });
    setRect(target, { x: 124, y: 90, width: 220, height: 80 });

    expect(adapter).not.toBeNull();
    expect(adapter!.getEntities()[0]).toMatchObject({
      authoringPointer: "/root/screens/0/root/children/0",
      bounds: { x: 24, y: 40, width: 220, height: 80 },
      metadata: {
        sourceFilePath: "authoring/ui/telegram.authoring.json",
        editorEntityId: "game:step:one"
      }
    });
    expect(adapter!.hitTestPoint({ x: 30, y: 45 }).entities).toHaveLength(1);
    expect(adapter!.hitTestRect({ x: 20, y: 35, width: 30, height: 30 }).entities).toHaveLength(1);

    adapter!.highlight({ type: "highlightEntities", entityIds: ["telegram:/root/screens/0/root/children/0"], reason: "selection" });
    expect(target.getAttribute("data-editor-highlighted")).toBe("true");
    adapter!.highlight({ type: "clearHighlight" });
    expect(target.getAttribute("data-editor-highlighted")).toBeNull();
  });

  it("shows a channel diagnostic callout without inventing a create action", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(
      <TelegramStructuralViewer
        projection={null}
        onSelect={() => undefined}
        missingViewCallout={{ entityId: "game:card", label: "Карточка маршрута" }}
      />
    ));
    expect(container.querySelector("[data-testid='telegram-missing-view-callout']")?.textContent).toContain("Карточка маршрута");
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent?.includes("Создать вид"))).toBe(false);
  });
});

function setRect(element: Element, rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      ...rect,
      top: rect.y,
      left: rect.x,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON: () => rect
    }) as DOMRect
  });
}
