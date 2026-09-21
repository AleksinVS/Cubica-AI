import { describe, expect, it } from "vitest";
import type { GameUiComponent } from "@cubica/contracts-manifest";
import { createPreviewElementAttributes } from "./preview-metadata";

describe("preview entity identity", () => {
  it("separates repeated source instances without depending on DOM order", () => {
    const component = { type: "richTextComponent", id: "card-title", props: { html: "{{card.title}}" } } as GameUiComponent;
    const base = { enabled: true, component, runtimePointer: "/screens/board/root/children/0" };
    const first = createPreviewElementAttributes({ ...base, instanceKey: "source:/content/data/cards/1:occurrence:0",
      contentRuntimePointer: "/content/data/cards/1" });
    const second = createPreviewElementAttributes({ ...base, instanceKey: "source:/content/data/cards/2:occurrence:0" });
    const repeated = createPreviewElementAttributes({ ...base, instanceKey: "source:/content/data/cards/1:occurrence:0" });
    expect(first["data-preview-entity-id"]).not.toBe(second["data-preview-entity-id"]);
    expect(first["data-preview-entity-id"]).toBe(repeated["data-preview-entity-id"]);
    expect(first["data-preview-content-runtime-pointer"]).toBe("/content/data/cards/1");
  });
});
