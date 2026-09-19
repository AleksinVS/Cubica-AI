import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditorWireframe, type EditorWireframeSelection } from "./editor-wireframe";
import type { EditorWireframeProjection } from "@/lib/editor-wireframe-projection";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

const projection: EditorWireframeProjection = {
  title: "Нейтральный UI",
  entryScreenId: "intro",
  truncated: false,
  screens: [
    {
      id: "intro",
      label: "Вступление",
      sourcePointer: "/root/screens/0",
      nodes: [{
        id: "shell",
        label: "Контейнер",
        kind: "container",
        sourcePointer: "/root/screens/0/root",
        sourceFilePath: "ui.json",
        children: [{
          id: "choose",
          label: "Выбрать",
          kind: "button",
          sourcePointer: "/root/screens/0/root/children/0",
          sourceFilePath: "ui.json",
          children: []
        }]
      }]
    },
    {
      id: "result",
      label: "Результат",
      sourcePointer: "/root/screens/1",
      nodes: [{
        id: "result-text",
        label: "Готово",
        kind: "text",
        sourcePointer: "/root/screens/1/root",
        sourceFilePath: "ui.json",
        children: []
      }]
    }
  ]
};

function render(element: React.ReactElement): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(element));
}

describe("EditorWireframe", () => {
  it("selects a nested child exactly once and exposes its source pointer", () => {
    const onSelect = vi.fn<(selection: EditorWireframeSelection) => void>();
    render(<EditorWireframe projection={projection} onSelect={onSelect} />);

    const child = container?.querySelector<HTMLButtonElement>("[data-wireframe-source-pointer='/root/screens/0/root/children/0']");
    expect(child).not.toBeNull();
    act(() => child?.click());
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({ sourceFilePath: "ui.json", sourcePointer: "/root/screens/0/root/children/0" });

    act(() => child?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith({ sourceFilePath: "ui.json", sourcePointer: "/root/screens/0/root/children/0" });
  });

  it("supports keyboard selection without executing authored actions", () => {
    const onSelect = vi.fn<(selection: EditorWireframeSelection) => void>();
    render(<EditorWireframe projection={projection} onSelect={onSelect} />);

    const shell = container?.querySelector<HTMLDivElement>("[data-wireframe-source-pointer='/root/screens/0/root']");
    act(() => shell?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({ sourceFilePath: "ui.json", sourcePointer: "/root/screens/0/root" });
  });

  it("changes the visible screen through local selection only", () => {
    const onScreenChange = vi.fn();
    const onSelect = vi.fn();
    render(<EditorWireframe projection={projection} onSelect={onSelect} onScreenChange={onScreenChange} />);

    const picker = container?.querySelector<HTMLSelectElement>("select[aria-label='Выбрать экран']");
    expect(container?.textContent).toContain("Выбрать");
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set?.call(picker, "result");
      picker?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onScreenChange).toHaveBeenCalledWith("result");
    expect(container?.textContent).toContain("Готово");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("falls back when a controlled screen disappears with a replacement projection", () => {
    const onScreenChange = vi.fn();
    render(<EditorWireframe projection={projection} selectedScreenId="intro" onScreenChange={onScreenChange} onSelect={vi.fn()} />);

    const replacement: EditorWireframeProjection = {
      ...projection,
      entryScreenId: "result",
      screens: [projection.screens[1] as NonNullable<typeof projection.screens[number]>]
    };
    act(() => root?.render(
      <EditorWireframe
        projection={replacement}
        selectedScreenId="intro"
        onScreenChange={onScreenChange}
        onSelect={vi.fn()}
      />
    ));

    expect(container?.textContent).toContain("Готово");
    expect(container?.textContent).not.toContain("В документе нет доступного экрана");
    expect(onScreenChange).toHaveBeenCalledWith("result");
  });

  it("shows a friendly empty state when no authoring projection exists", () => {
    render(<EditorWireframe projection={null} onSelect={vi.fn()} />);
    expect(container?.textContent).toContain("Структура интерфейса пока не определена");
  });
});
