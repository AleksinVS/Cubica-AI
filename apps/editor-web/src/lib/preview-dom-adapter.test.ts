import { describe, expect, it, vi } from "vitest";

import { collectDomPreviewEntities, createDomPreviewAdapter } from "./preview-dom-adapter";

describe("preview DOM adapter", () => {
  it("maps explicit data attributes to renderer-neutral preview descriptors", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <section
        data-editor-entity-id="screen-root"
        data-authoring-pointer="/root/screens/0"
        data-runtime-pointer="/screens/S1"
        data-editor-label="Главный экран"
        data-editor-semantic-role="ui-screen"
        data-editor-layer="screen"
        data-editor-z-index="1"
      ></section>
      <button
        data-editor-entity-id="next-button"
        data-authoring-pointer="/root/screens/0/root/children/0"
        data-editor-layer="controls"
        aria-label="Кнопка далее"
      >Далее</button>
    `;
    setRect(root.children[0] as Element, { x: 0, y: 0, width: 320, height: 240 });
    setRect(root.children[1] as Element, { x: 24, y: 180, width: 120, height: 32 });

    const entities = collectDomPreviewEntities(root);

    expect(entities[0]).toMatchObject({
      entityId: "screen-root",
      authoringPointer: "/root/screens/0",
      runtimePointer: "/screens/S1",
      label: "Главный экран",
      semanticRole: "ui-screen",
      layer: "screen",
      zIndex: 1,
      visible: true,
      selectable: true,
      bounds: { x: 0, y: 0, width: 320, height: 240 }
    });
    expect(entities[1]?.label).toBe("Кнопка далее");
  });

  it("hit-tests DOM entities through editor-engine geometry helpers", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-editor-entity-id="back" data-authoring-pointer="/root/back" data-editor-z-index="1"></div>
      <div data-editor-entity-id="front" data-authoring-pointer="/root/front" data-editor-z-index="5"></div>
      <div data-editor-entity-id="hidden" data-authoring-pointer="/root/hidden" data-editor-z-index="10" data-editor-visible="false"></div>
      <div data-editor-entity-id="locked" data-authoring-pointer="/root/locked" data-editor-z-index="9" data-editor-selectable="false"></div>
    `;
    for (const child of [...root.children]) {
      setRect(child, { x: 10, y: 10, width: 100, height: 100 });
    }

    const adapter = createDomPreviewAdapter(root);

    expect(adapter.hitTestPoint({ x: 20, y: 20 }).entities.map((entity) => entity.entityId)).toEqual(["front", "back"]);
    expect(
      adapter
        .hitTestRect({ x: 0, y: 0, width: 50, height: 50 }, { includeHidden: true, includeNonSelectable: true })
        .entities.map((entity) => entity.entityId)
    ).toEqual(["hidden", "locked", "front", "back"]);
  });

  it("applies highlight commands without mutating authoring data", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-editor-entity-id="one" data-authoring-pointer="/root/one"></div>
      <div data-editor-entity-id="two" data-authoring-pointer="/root/two"></div>
    `;
    setRect(root.children[0] as Element, { x: 0, y: 0, width: 10, height: 10 });
    setRect(root.children[1] as Element, { x: 20, y: 0, width: 10, height: 10 });

    const adapter = createDomPreviewAdapter(root);
    adapter.highlight({ type: "highlightEntities", entityIds: ["two"], reason: "selection" });

    expect(root.children[0]?.getAttribute("data-editor-highlighted")).toBeNull();
    expect(root.children[1]?.getAttribute("data-editor-highlighted")).toBe("true");
    expect(root.children[1]?.getAttribute("data-editor-highlight-reason")).toBe("selection");

    adapter.highlight({ type: "clearHighlight" });
    expect(root.children[1]?.getAttribute("data-editor-highlighted")).toBeNull();
  });

  // Optional "region snapshot" capability (ADR-057 §4.7; design-spec §2.7).
  describe("captureRegionSnapshot", () => {
    it("exposes the optional capability on the adapter", () => {
      const adapter = createDomPreviewAdapter(document.createElement("div"));
      expect(typeof adapter.captureRegionSnapshot).toBe("function");
    });

    it("degrades to null when the root has no canvas raster source (plain DOM / iframe)", async () => {
      const root = document.createElement("div");
      root.innerHTML = `<div data-editor-entity-id="a" data-authoring-pointer="/root/a"></div>`;
      const adapter = createDomPreviewAdapter(root);
      await expect(adapter.captureRegionSnapshot?.({ x: 0, y: 0, width: 20, height: 10 })).resolves.toBeNull();
    });

    it("degrades to null for a zero-sized region", async () => {
      const source = document.createElement("canvas");
      source.width = 100;
      source.height = 100;
      setRect(source, { x: 0, y: 0, width: 100, height: 100 });
      const adapter = createDomPreviewAdapter(document.createElement("div"), { snapshotCanvas: source });
      await expect(adapter.captureRegionSnapshot?.({ x: 0, y: 0, width: 0, height: 0 })).resolves.toBeNull();
    });

    it("captures a region snapshot from a same-origin canvas raster source", async () => {
      const source = document.createElement("canvas");
      source.width = 200;
      source.height = 100;
      setRect(source, { x: 0, y: 0, width: 200, height: 100 });

      // happy-dom does not rasterize; stub the TARGET canvas the adapter creates
      // so the browser-native drawImage/toDataURL path is deterministic here.
      const realCreateElement = document.createElement.bind(document);
      const createSpy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
        if (tag === "canvas") {
          return {
            width: 0,
            height: 0,
            getContext: () => ({ drawImage: () => undefined }),
            toDataURL: () => "data:image/png;base64,SNAPSHOT"
          } as unknown as HTMLCanvasElement;
        }
        return realCreateElement(tag) as HTMLElement;
      });

      try {
        const adapter = createDomPreviewAdapter(document.createElement("div"), { snapshotCanvas: source });
        const snapshot = await adapter.captureRegionSnapshot?.({ x: 10, y: 10, width: 40, height: 20 });
        expect(snapshot).toMatchObject({
          mediaType: "image/png",
          width: 40,
          height: 20,
          rect: { x: 10, y: 10, width: 40, height: 20 },
          dataUrl: "data:image/png;base64,SNAPSHOT"
        });
      } finally {
        createSpy.mockRestore();
      }
    });

    it("degrades to null when the canvas is tainted (toDataURL throws)", async () => {
      const source = document.createElement("canvas");
      source.width = 200;
      source.height = 100;
      setRect(source, { x: 0, y: 0, width: 200, height: 100 });

      const realCreateElement = document.createElement.bind(document);
      const createSpy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
        if (tag === "canvas") {
          return {
            width: 0,
            height: 0,
            getContext: () => ({ drawImage: () => undefined }),
            toDataURL: () => {
              throw new Error("SecurityError");
            }
          } as unknown as HTMLCanvasElement;
        }
        return realCreateElement(tag) as HTMLElement;
      });

      try {
        const adapter = createDomPreviewAdapter(document.createElement("div"), { snapshotCanvas: source });
        await expect(adapter.captureRegionSnapshot?.({ x: 10, y: 10, width: 40, height: 20 })).resolves.toBeNull();
      } finally {
        createSpy.mockRestore();
      }
    });
  });
});

function setRect(element: Element, rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () =>
      ({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.y,
        left: rect.x,
        right: rect.x + rect.width,
        bottom: rect.y + rect.height,
        toJSON: () => rect
      }) as DOMRect
  });
}
