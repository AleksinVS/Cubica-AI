import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { PreviewEntityDescriptor } from "@cubica/editor-engine";

import { PreviewSelectionOverlay, type PreviewAiIntent, type PreviewPromptContext } from "./preview-selection-overlay";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    expect(container.querySelector(".preview-ai-intent")?.textContent).toContain("1 target");

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
});
