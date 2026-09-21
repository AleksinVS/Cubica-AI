import { describe, expect, it } from "vitest";
import type { EditorChangeSet, PreviewEntityDescriptor } from "@cubica/editor-engine";
import { projectMvpVisualChange } from "./mvp-visual-preview";
const file = "ui/web/manifest.authoring.json";
const documents = new Map([[file, JSON.stringify({ root: { item: { id: "title", props: { html: "Old" }, style: { width: 100, color: "red" } } } })]]);
const entity: PreviewEntityDescriptor = { entityId: "title", authoringPointer: "/root/item", runtimePointer: "/screens/0/components/0",
  label: "title", semanticRole: "ui", bounds: { x: 0, y: 0, width: 100, height: 30 }, visible: true, selectable: true,
  metadata: { sourceFile: `games/sample/authoring/${file}` } };
function edit(path: string, value: unknown): EditorChangeSet {
  return { id: "edit", summary: "test", jsonPatches: [{ filePath: file, operations: [{ op: "replace", path, value: value as never }] }] };
}
describe("exact temporary visual projection", () => {
  it("projects static text with exact source and renderer property", () => {
    expect(projectMvpVisualChange(edit("/root/item/props/html", "New"), documents, [entity], "sample")).toEqual([
      { operationId: "edit", runtimePointer: entity.runtimePointer, ownerRuntimePointer: `${entity.runtimePointer}/props/html`, property: "html", value: "New" }
    ]);
  });
  it("does not forward existing unrelated style properties, but refuses changed unsupported ones", () => {
    const patches = projectMvpVisualChange(edit("/root/item/style", { width: 150, color: "red" }), documents, [entity], "sample");
    expect(patches?.map(patch => [patch.property, patch.value])).toEqual([["width", 150]]);
    expect(projectMvpVisualChange(edit("/root/item/style", { width: 150, color: "blue" }), documents, [entity], "sample")).toBeUndefined();
  });
  it("updates every proven instance of shared content, without leaking authoring binding syntax", () => {
    const content = "manifest.authoring.json";
    const bound = { ...entity, metadata: { ...entity.metadata, textBinding: { prop: "html", expression: "{{currentInfo.title}}",
      contentSourceFile: `games/sample/authoring/${content}`, contentSourcePointer: "/root/content/title", contentRuntimePointer: "/content/title" } } };
    const change: EditorChangeSet = { id: "title", summary: "Title", jsonPatches: [{ filePath: content, operations: [{ op: "replace", path: "/root/content/title", value: "New title" }] }] };
    const patches = projectMvpVisualChange(change, new Map([[content, '{"root":{"content":{"title":"Old"}}}']]), [bound, { ...bound, runtimePointer: "/screens/1/components/0" }], "sample");
    expect(patches).toHaveLength(2);
    expect(patches?.every(patch => patch.ownerRuntimePointer === "/content/title" && patch.property === "html")).toBe(true);
  });
  it("does not display a candidate whose source guard is stale", () => {
    const change = edit("/root/item/props/html", "New");
    const stale: EditorChangeSet = { ...change, jsonPatches: [{ filePath: file, operations: [
      { op: "test", path: "/root/item/id", value: "old-target" }, ...change.jsonPatches[0].operations
    ] }] };
    expect(projectMvpVisualChange(stale, documents, [entity], "sample")).toBeUndefined();
  });
  it("fails closed for a mixed unsupported edit and executable values", () => {
    expect(projectMvpVisualChange(edit("/root/item/props/html", "{{secret}}"), documents, [entity], "sample")).toBeUndefined();
    expect(projectMvpVisualChange(edit("/root/item/style/transform", "url(https://example.com)"), documents, [entity], "sample")).toBeUndefined();
    expect(projectMvpVisualChange(edit("/root/item/style/width", -1), documents, [entity], "sample")).toBeUndefined();
    const change = edit("/root/item/props/html", "New");
    const mixed = { ...change, jsonPatches: [...change.jsonPatches, ...edit("/root/item/actionId", "bad").jsonPatches] };
    expect(projectMvpVisualChange(mixed, documents, [entity], "sample")).toBeUndefined();
  });
});
