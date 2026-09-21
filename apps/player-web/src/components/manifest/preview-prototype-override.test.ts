import { describe, expect, it } from "vitest";
import type { GameUiScreenDefinition } from "@cubica/contracts-manifest";
import { withPreviewPrototypeOverride } from "./preview-prototype-override";

const original = {
  type: "screen",
  root: {
    type: "screenComponent",
    props: {},
    children: [
      { type: "richTextComponent", props: { html: "instance override" } },
      { type: "buttonComponent", props: { caption: "surrounding control" } }
    ]
  }
} as GameUiScreenDefinition;

describe("temporary prototype subtree", () => {
  it("shows prototype defaults at only the selected subtree without mutating the compiled screen", () => {
    const replacement = { type: "richTextComponent", props: { html: "prototype default" } } as const;
    const result = withPreviewPrototypeOverride(original, "/screens/scene/root",
      "/screens/scene/root/children/0", replacement);
    expect(result?.root.children?.[0].props).toEqual({ html: "prototype default" });
    expect(result?.root.children?.[1]).toBe(original.root.children?.[1]);
    expect(original.root.children?.[0].props).toEqual({ html: "instance override" });
  });

  it("rejects stale, malformed, or type-changing targets", () => {
    const replacement = { type: "richTextComponent", props: { html: "default" } } as const;
    for (const pointer of [
      "/screens/other/root/children/0",
      "/screens/scene/root/children/01",
      "/screens/scene/root/children/5",
      "/screens/scene/root/props/html"
    ]) {
      expect(withPreviewPrototypeOverride(original, "/screens/scene/root", pointer, replacement)).toBeUndefined();
    }
    expect(withPreviewPrototypeOverride(original, "/screens/scene/root",
      "/screens/scene/root/children/0", { type: "buttonComponent", props: { caption: "wrong type" } }))
      .toBeUndefined();
  });
});
