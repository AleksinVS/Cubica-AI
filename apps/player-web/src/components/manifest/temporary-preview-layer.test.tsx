import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PlayerFacingContent } from "@cubica/contracts-manifest";
import { withPreviewContentOrigin } from "@/lib/preview-content-origin";
import { UiComponentNode } from "./ui-component-node";
import { TemporaryPreviewLayerProvider, type TemporaryPreviewPatch } from "./temporary-preview-layer";
import { isValidTemporaryPatch } from "../game-player";

const content: PlayerFacingContent = {
  gameId: "neutral-preview", version: "1.0.0", name: "Neutral preview", description: "Fixture",
  locale: "en-US", playerConfig: { min: 1, max: 1 }, actions: [], mockups: []
};

describe("temporary preview renderer layer", () => {
  it("checks exact runtime owner and rejects nonvisual or malformed values before rendering", () => {
    const root = document.createElement("main");
    root.innerHTML = '<p data-preview-runtime-pointer="/screens/scene/root/children/0" data-preview-semantic-role="richTextComponent"></p>';
    const patch: TemporaryPreviewPatch = { operationId: "op-1", runtimePointer: "/screens/scene/root/children/0",
      ownerRuntimePointer: "/screens/scene/root/children/0/style/width", property: "width", value: 180 };
    expect(isValidTemporaryPatch(patch, root)).toBe(true);
    expect(isValidTemporaryPatch({ ...patch, ownerRuntimePointer: "/other/style/width" }, root)).toBe(false);
    expect(isValidTemporaryPatch({ ...patch, value: "180px" }, root)).toBe(false);
    expect(isValidTemporaryPatch({ ...patch, property: "html", value: "Safe",
      ownerRuntimePointer: "/screens/scene/root/children/0/props/html" }, root)).toBe(true);
    expect(isValidTemporaryPatch({ ...patch, property: "html", value: "Safe",
      ownerRuntimePointer: "/screens/scene/root/children/0/props/text" }, root)).toBe(false);
    expect(isValidTemporaryPatch({ ...patch, property: "html", value: "{{game.state.public.secret}}",
      ownerRuntimePointer: "/screens/scene/root/children/0/props/html" }, root)).toBe(false);
  });

  it("updates the actual rich text component only for the proven content owner", () => {
    const first = withPreviewContentOrigin({ title: "First" }, { runtimePointer: "/content/data/infos/0", fields: ["title"] });
    const second = withPreviewContentOrigin({ title: "Second" }, { runtimePointer: "/content/data/infos/1", fields: ["title"] });
    const patch: TemporaryPreviewPatch = { operationId: "op-1", runtimePointer: "/screens/scene/root/children/0",
      ownerRuntimePointer: "/content/data/infos/0/title", property: "html", value: "Draft title" };
    const node = (value: typeof first) => <UiComponentNode
      component={{ type: "richTextComponent", props: { html: "{{currentInfo.title}}" } }}
      metrics={{}} onAction={() => undefined} editorPreviewMode
      runtimePointer="/screens/scene/root/children/0" gameState={{ currentInfo: value }} content={content}
    />;
    const mounted = render(<TemporaryPreviewLayerProvider patches={[patch]}>{node(first)}{node(second)}</TemporaryPreviewLayerProvider>);
    expect(screen.getByText("Draft title")).toBeTruthy();
    expect(screen.getByText("Second")).toBeTruthy();
    expect(screen.queryByText("First")).toBeNull();
    mounted.rerender(<TemporaryPreviewLayerProvider patches={[]}>{node(first)}{node(second)}</TemporaryPreviewLayerProvider>);
    expect(screen.getByText("First")).toBeTruthy();
  });

  it("keeps a dynamic text binding and content owner through successive temporary values", () => {
    const info = withPreviewContentOrigin({ title: "Original" }, { runtimePointer: "/content/data/infos/0", fields: ["title"] });
    const component = { type: "richTextComponent" as const, props: { html: "{{currentInfo.title}}" } };
    const patch: TemporaryPreviewPatch = { operationId: "first-edit", runtimePointer: "/screens/scene/root/children/0",
      ownerRuntimePointer: "/content/data/infos/0/title", property: "html", value: "First draft" };
    const view = (patches: readonly TemporaryPreviewPatch[]) => <TemporaryPreviewLayerProvider patches={patches}>
      <UiComponentNode component={component} metrics={{}} onAction={() => undefined} editorPreviewMode
        runtimePointer="/screens/scene/root/children/0" gameState={{ currentInfo: info }} content={content} />
    </TemporaryPreviewLayerProvider>;
    const expectBoundTitle = (text: string) => {
      const element = screen.getByText(text);
      expect(element.getAttribute("data-preview-content-runtime-pointer")).toBe("/content/data/infos/0");
      expect(JSON.parse(element.getAttribute("data-preview-text-binding") ?? "null")).toEqual({
        prop: "html", expression: "{{currentInfo.title}}", contentRuntimePointer: "/content/data/infos/0/title"
      });
    };
    const mounted = render(view([patch]));
    expectBoundTitle("First draft");
    mounted.rerender(view([{ ...patch, operationId: "second-edit", value: "Second draft" }]));
    expectBoundTitle("Second draft");
    mounted.rerender(view([]));
    expectBoundTitle("Original");
  });

  it("uses the existing renderer geometry path and clears without mutating the source component", () => {
    const component = { type: "richTextComponent" as const, props: { html: "Fixture" }, style: { width: 80 } };
    const patch: TemporaryPreviewPatch = { operationId: "op-2", runtimePointer: "/screens/scene/root/children/0",
      ownerRuntimePointer: "/screens/scene/root/children/0/style/width", property: "width", value: 180 };
    const view = (patches: readonly TemporaryPreviewPatch[]) => <TemporaryPreviewLayerProvider patches={patches}>
      <UiComponentNode component={component} metrics={{}} onAction={() => undefined}
        editorPreviewMode runtimePointer="/screens/scene/root/children/0" />
    </TemporaryPreviewLayerProvider>;
    const mounted = render(view([patch]));
    expect(screen.getByText("Fixture").style.getPropertyValue("width")).toBe("180px");
    mounted.rerender(view([]));
    expect(screen.getByText("Fixture").style.getPropertyValue("width")).toBe("80px");
    expect(component.style.width).toBe(80);
  });
});
