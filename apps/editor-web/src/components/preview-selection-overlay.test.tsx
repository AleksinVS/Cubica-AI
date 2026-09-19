import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PreviewEntityDescriptor } from "@cubica/editor-engine";

import { PreviewSelectionOverlay, type PreviewAiIntent, type PreviewPromptContext } from "./preview-selection-overlay";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  if (Element.prototype.setPointerCapture === undefined) {
    Object.defineProperty(Element.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn()
    });
  }

  if (Element.prototype.hasPointerCapture === undefined) {
    Object.defineProperty(Element.prototype, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => false)
    });
  }

  if (Element.prototype.releasePointerCapture === undefined) {
    Object.defineProperty(Element.prototype, "releasePointerCapture", {
      configurable: true,
      value: vi.fn()
    });
  }
});

const entities: readonly PreviewEntityDescriptor[] = [
  {
    entityId: "back",
    runtimePointer: "/screens/S1/root",
    authoringPointer: "/root/screens/0/root",
    label: "Screen",
    semanticRole: "screenComponent",
    renderOrder: 0,
    bounds: { x: 0, y: 0, width: 300, height: 200 },
    visible: true,
    selectable: true
  },
  {
    entityId: "front",
    runtimePointer: "/screens/S1/root/children/0",
    authoringPointer: "/root/screens/0/root/children/0",
    label: "Button",
    semanticRole: "buttonComponent",
    renderOrder: 1,
    bounds: { x: 20, y: 30, width: 120, height: 40 },
    visible: true,
    selectable: true
  }
];

describe("PreviewSelectionOverlay", () => {
  it("renders selected frame and AI prompt context", async () => {
    const onSelectEntity = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    const promptContext: PreviewPromptContext = {
      kind: "entity",
      point: { x: 20, y: 30 },
      entities,
      draft: "Сделай кнопку крупнее"
    };
    const intent: PreviewAiIntent = {
      id: "intent-1",
      kind: "entity",
      prompt: promptContext.draft,
      targetPointers: [entities[1]?.authoringPointer ?? ""],
      createdAt: "2026-05-28T00:00:00.000Z"
    };

    let root: Root | undefined;
    await act(async () => {
      root = createRoot(container);
      root.render(
        <PreviewSelectionOverlay
          entities={entities}
          selectedEntityId="front"
          promptContext={promptContext}
          proposedIntent={intent}
          unresolvedCount={2}
          onSelectEntity={onSelectEntity}
          onSelectRegion={vi.fn()}
          onClearContext={vi.fn()}
          onPromptDraftChange={vi.fn()}
          onPromptSubmit={vi.fn()}
          onPromptClose={vi.fn()}
        />
      );
    });

    expect(container.querySelector(".preview-highlight-frame")?.textContent).toContain("Button");
    expect(container.querySelector(".preview-overlay-warning")?.textContent).toContain("2 unmapped");
    expect((container.querySelector("textarea") as HTMLTextAreaElement | null)?.value).toBe("Сделай кнопку крупнее");
    expect(container.querySelector(".preview-ai-intent")?.textContent).toContain("целевых указателей: 1");

    const layerButtons = [...container.querySelectorAll<HTMLButtonElement>(".preview-object-picker-menu button")];
    await act(async () => {
      layerButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSelectEntity).toHaveBeenCalledWith(entities[0], promptContext.point, entities);

    await act(async () => {
      root?.unmount();
    });
  });

  it("reports prompt draft changes and submit requests", async () => {
    const onPromptDraftChange = vi.fn();
    const onPromptSubmit = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    function Harness() {
      const [context, setContext] = useState<PreviewPromptContext>({
        kind: "region",
        point: { x: 0, y: 0 },
        entities: [entities[1] ?? entities[0]],
        rect: { x: 1, y: 2, width: 3, height: 4 },
        draft: ""
      });

      return (
        <PreviewSelectionOverlay
          entities={entities}
          selectedEntityId={undefined}
          promptContext={context}
          proposedIntent={null}
          unresolvedCount={0}
          onSelectEntity={vi.fn()}
          onSelectRegion={vi.fn()}
          onClearContext={vi.fn()}
          onPromptDraftChange={(draft) => {
            onPromptDraftChange(draft);
            setContext((current) => ({ ...current, draft }));
          }}
          onPromptSubmit={onPromptSubmit}
          onPromptClose={vi.fn()}
        />
      );
    }

    let root: Root | undefined;
    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });

    const textArea = container.querySelector("textarea");
    expect(textArea).not.toBeNull();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textArea, "Измени область");
      textArea?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".preview-ai-submit")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onPromptDraftChange).toHaveBeenCalledWith("Измени область");
    expect(onPromptSubmit).toHaveBeenCalled();

    await act(async () => {
      root?.unmount();
    });
  });

  it("selects objects with short clicks and keeps Ctrl selection from pointer down", async () => {
    const onSelectEntity = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | undefined;
    await act(async () => {
      root = createRoot(container);
      root.render(
        <PreviewSelectionOverlay
          entities={entities}
          selectedEntityId={undefined}
          promptContext={null}
          proposedIntent={null}
          unresolvedCount={0}
          onSelectEntity={onSelectEntity}
          onSelectRegion={vi.fn()}
          onClearContext={vi.fn()}
          onPromptDraftChange={vi.fn()}
          onPromptSubmit={vi.fn()}
          onPromptClose={vi.fn()}
        />
      );
    });

    const hitLayer = container.querySelector<HTMLDivElement>("[data-testid='preview-selection-overlay']");
    expect(hitLayer).not.toBeNull();
    mockLayerRect(hitLayer);

    await act(async () => {
      dispatchPointer(hitLayer, "pointerdown", { clientX: 260, clientY: 160 });
      dispatchPointer(hitLayer, "pointerup", { clientX: 260, clientY: 160 });
    });

    expect(onSelectEntity).toHaveBeenCalledWith(entities[0], { x: 260, y: 160 }, [entities[0]]);

    await act(async () => {
      dispatchPointer(hitLayer, "pointerdown", { clientX: 30, clientY: 40, ctrlKey: true });
      dispatchPointer(hitLayer, "pointerup", { clientX: 30, clientY: 40 });
    });

    expect(onSelectEntity).toHaveBeenCalledWith(entities[1], { x: 30, y: 40 }, [entities[1], entities[0]]);

    await act(async () => {
      root?.unmount();
    });
  });

  it("clears context when a short click hits no object", async () => {
    const onClearContext = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | undefined;
    await act(async () => {
      root = createRoot(container);
      root.render(
        <PreviewSelectionOverlay
          entities={[entities[1] ?? entities[0]]}
          selectedEntityId={undefined}
          promptContext={null}
          proposedIntent={null}
          unresolvedCount={0}
          onSelectEntity={vi.fn()}
          onSelectRegion={vi.fn()}
          onClearContext={onClearContext}
          onPromptDraftChange={vi.fn()}
          onPromptSubmit={vi.fn()}
          onPromptClose={vi.fn()}
        />
      );
    });

    const hitLayer = container.querySelector<HTMLDivElement>("[data-testid='preview-selection-overlay']");
    expect(hitLayer).not.toBeNull();
    mockLayerRect(hitLayer);

    await act(async () => {
      dispatchPointer(hitLayer, "pointerdown", { clientX: 260, clientY: 160 });
      dispatchPointer(hitLayer, "pointerup", { clientX: 260, clientY: 160 });
    });

    expect(onClearContext).toHaveBeenCalled();

    await act(async () => {
      root?.unmount();
    });
  });

  it("opens a layered object menu from right click", async () => {
    const onSelectEntity = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | undefined;
    await act(async () => {
      root = createRoot(container);
      root.render(
        <PreviewSelectionOverlay
          entities={entities}
          selectedEntityId={undefined}
          promptContext={null}
          proposedIntent={null}
          unresolvedCount={0}
          onSelectEntity={onSelectEntity}
          onSelectRegion={vi.fn()}
          onClearContext={vi.fn()}
          onPromptDraftChange={vi.fn()}
          onPromptSubmit={vi.fn()}
          onPromptClose={vi.fn()}
        />
      );
    });

    const hitLayer = container.querySelector<HTMLDivElement>("[data-testid='preview-selection-overlay']");
    expect(hitLayer).not.toBeNull();
    mockLayerRect(hitLayer);

    await act(async () => {
      hitLayer?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 30,
          clientY: 40
        })
      );
    });

    const menu = container.querySelector(".preview-object-context-menu");
    expect(menu?.textContent).toContain("Screen");
    expect(menu?.textContent).toContain("Button");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".preview-object-context-menu button[role='menuitem']")?.click();
    });

    expect(onSelectEntity).toHaveBeenCalledWith(entities[1], { x: 30, y: 40 }, [entities[1], entities[0]]);

    await act(async () => {
      root?.unmount();
    });
  });

  it("treats Ctrl context menu events as single-object selection", async () => {
    const onSelectEntity = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | undefined;
    await act(async () => {
      root = createRoot(container);
      root.render(
        <PreviewSelectionOverlay
          entities={entities}
          selectedEntityId={undefined}
          promptContext={null}
          proposedIntent={null}
          unresolvedCount={0}
          onSelectEntity={onSelectEntity}
          onSelectRegion={vi.fn()}
          onClearContext={vi.fn()}
          onPromptDraftChange={vi.fn()}
          onPromptSubmit={vi.fn()}
          onPromptClose={vi.fn()}
        />
      );
    });

    const hitLayer = container.querySelector<HTMLDivElement>("[data-testid='preview-selection-overlay']");
    expect(hitLayer).not.toBeNull();
    mockLayerRect(hitLayer);

    await act(async () => {
      hitLayer?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 30,
          clientY: 40,
          ctrlKey: true
        })
      );
    });

    expect(container.querySelector(".preview-object-context-menu")).toBeNull();
    expect(onSelectEntity).toHaveBeenCalledWith(entities[1], { x: 30, y: 40 }, [entities[1], entities[0]]);

    await act(async () => {
      root?.unmount();
    });
  });

  it("reports Alt-assisted temporary play mode", async () => {
    const onTemporaryPlayChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | undefined;
    await act(async () => {
      root = createRoot(container);
      root.render(
        <PreviewSelectionOverlay
          entities={entities}
          selectedEntityId={undefined}
          promptContext={null}
          proposedIntent={null}
          unresolvedCount={0}
          onSelectEntity={vi.fn()}
          onSelectRegion={vi.fn()}
          onClearContext={vi.fn()}
          onPromptDraftChange={vi.fn()}
          onPromptSubmit={vi.fn()}
          onPromptClose={vi.fn()}
          onTemporaryPlayChange={onTemporaryPlayChange}
        />
      );
    });

    const hitLayer = container.querySelector<HTMLDivElement>("[data-testid='preview-selection-overlay']");
    expect(hitLayer).not.toBeNull();
    mockLayerRect(hitLayer);

    await act(async () => {
      dispatchPointer(hitLayer, "pointerdown", { clientX: 30, clientY: 40, altKey: true });
    });

    expect(onTemporaryPlayChange).toHaveBeenCalledWith(true);

    await act(async () => {
      dispatchPointer(hitLayer, "pointermove", { clientX: 32, clientY: 42 });
    });

    expect(onTemporaryPlayChange).toHaveBeenCalledWith(false);

    await act(async () => {
      root?.unmount();
    });
  });

  it("cycles stacked MVP elements on repeated clicks within five pixels", async () => {
    const onSelectEntity = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | undefined;
    await act(async () => {
      root = createRoot(container);
      root.render(<PreviewSelectionOverlay mvp entities={entities} selectedEntityId={undefined} promptContext={null}
        proposedIntent={null} unresolvedCount={0} onSelectEntity={onSelectEntity} onSelectRegion={vi.fn()}
        onClearContext={vi.fn()} onPromptDraftChange={vi.fn()} onPromptSubmit={vi.fn()} onPromptClose={vi.fn()} />);
    });
    const layer = container.querySelector<HTMLElement>("[data-testid='preview-selection-overlay']");
    mockLayerRect(layer);
    await act(async () => {
      dispatchPointer(layer, "pointerdown", { clientX: 30, clientY: 40 });
      dispatchPointer(layer, "pointerup", { clientX: 30, clientY: 40 });
      dispatchPointer(layer, "pointerdown", { clientX: 34, clientY: 42 });
      dispatchPointer(layer, "pointerup", { clientX: 34, clientY: 42 });
    });
    expect(onSelectEntity.mock.calls.map(([entity]) => entity.entityId)).toEqual(["front", "back"]);
    expect(container.querySelector("[aria-label='Слои под указателем']")?.textContent).toContain("Screen");
    await act(async () => root?.unmount());
  });

  it("moves a selected region locally and never commits element geometry", async () => {
    const onGeometryCommit = vi.fn();
    const onRegionRectChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | undefined;
    await act(async () => {
      root = createRoot(container);
      root.render(<PreviewSelectionOverlay mvp entities={entities} selectedEntityId={undefined}
        promptContext={{ kind: "region", point: { x: 10, y: 10 }, rect: { x: 10, y: 10, width: 50, height: 50 }, entities, draft: "" }}
        proposedIntent={null} unresolvedCount={0} onSelectEntity={vi.fn()} onSelectRegion={vi.fn()}
        onClearContext={vi.fn()} onPromptDraftChange={vi.fn()} onPromptSubmit={vi.fn()} onPromptClose={vi.fn()}
        onGeometryCommit={onGeometryCommit} onRegionRectChange={onRegionRectChange} />);
    });
    const move = container.querySelector<HTMLButtonElement>("[aria-label='Переместить область']");
    await act(async () => {
      dispatchPointer(move, "pointerdown", { clientX: 20, clientY: 20 });
      dispatchPointer(move, "pointermove", { clientX: 30, clientY: 25 });
      dispatchPointer(move, "pointerup", { clientX: 30, clientY: 25 });
    });
    expect(onRegionRectChange).toHaveBeenCalledWith({ x: 20, y: 15, width: 50, height: 50 });
    expect(onGeometryCommit).not.toHaveBeenCalled();
    await act(async () => root?.unmount());
  });

  it("cancels an interrupted element gesture without mutation", async () => {
    const onGeometryCommit = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | undefined;
    await act(async () => {
      root = createRoot(container);
      root.render(<PreviewSelectionOverlay mvp entities={entities} selectedEntityId="front" promptContext={null}
        proposedIntent={null} unresolvedCount={0} onSelectEntity={vi.fn()} onSelectRegion={vi.fn()}
        onClearContext={vi.fn()} onPromptDraftChange={vi.fn()} onPromptSubmit={vi.fn()} onPromptClose={vi.fn()}
        onGeometryCommit={onGeometryCommit} />);
    });
    const move = container.querySelector<HTMLButtonElement>("[aria-label='Переместить элемент']");
    await act(async () => {
      dispatchPointer(move, "pointerdown", { clientX: 30, clientY: 30 });
      dispatchPointer(move, "pointermove", { clientX: 80, clientY: 40 });
      dispatchPointer(move, "pointercancel", { clientX: 80, clientY: 40 });
    });
    expect(onGeometryCommit).not.toHaveBeenCalled();
    await act(async () => root?.unmount());
  });

  it("starts temporary drawing from selected element bounds without authoring mutation", async () => {
    const onStartDrawing = vi.fn();
    const onGeometryCommit = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | undefined;
    await act(async () => {
      root = createRoot(container);
      root.render(<PreviewSelectionOverlay mvp entities={entities} selectedEntityId="front" promptContext={null}
        proposedIntent={null} unresolvedCount={0} onSelectEntity={vi.fn()} onSelectRegion={vi.fn()}
        onClearContext={vi.fn()} onPromptDraftChange={vi.fn()} onPromptSubmit={vi.fn()} onPromptClose={vi.fn()}
        onGeometryCommit={onGeometryCommit} onStartDrawing={onStartDrawing} />);
    });
    await act(async () => { container.querySelector<HTMLButtonElement>("[aria-label='Рисовать в выделенной области']")?.click(); });
    expect(onStartDrawing).toHaveBeenCalledWith(entities[1]?.bounds);
    expect(onGeometryCommit).not.toHaveBeenCalled();
    await act(async () => root?.unmount());
  });

  it("starts temporary drawing from region bounds and hides the pencil when no callback exists", async () => {
    const onStartDrawing = vi.fn();
    const rect = { x: 8, y: 12, width: 95, height: 70 };
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | undefined;
    const base = {
      mvp: true, entities, selectedEntityId: undefined, proposedIntent: null, unresolvedCount: 0,
      promptContext: { kind: "region" as const, point: { x: 8, y: 12 }, rect, entities, draft: "" },
      onSelectEntity: vi.fn(), onSelectRegion: vi.fn(), onClearContext: vi.fn(), onPromptDraftChange: vi.fn(),
      onPromptSubmit: vi.fn(), onPromptClose: vi.fn()
    };
    await act(async () => { root = createRoot(container); root.render(<PreviewSelectionOverlay {...base} onStartDrawing={onStartDrawing} />); });
    await act(async () => { container.querySelector<HTMLButtonElement>("[aria-label='Рисовать в выделенной области']")?.click(); });
    expect(onStartDrawing).toHaveBeenCalledWith(rect);
    await act(async () => { root?.render(<PreviewSelectionOverlay {...base} />); });
    expect(container.querySelector("[aria-label='Рисовать в выделенной области']")).toBeNull();
    await act(async () => root?.unmount());
  });
});

function mockLayerRect(element: HTMLElement | null) {
  if (element === null) {
    return;
  }

  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 200,
      width: 300,
      height: 200,
      toJSON: () => ({})
    })
  });
}

function dispatchPointer(
  element: HTMLElement | null,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  init: MouseEventInit
) {
  element?.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      ...init
    })
  );
}
