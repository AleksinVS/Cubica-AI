import { describe, expect, it } from "vitest";
import { validateEditorPreviewTemporaryLayerRequest, validateEditorPreviewTemporaryLayerResponse } from "../src/index.ts";

const request = {
  source: "cubica-editor-web", type: "temporaryPreviewLayer", protocolVersion: 1,
  requestId: "r1", sessionId: "s1", compileRevision: "compiled-1",
  scene: { screenId: "scene-a", stepIndex: 0 }, sequence: 2,
  patches: [{ operationId: "op-1", runtimePointer: "/screens/scene-a/root/children/0",
    ownerRuntimePointer: "/screens/scene-a/root/children/0/style/width", property: "width", value: 160 }]
};

describe("temporary preview layer wire contract", () => {
  it("accepts a bounded full snapshot and an empty clear", () => {
    expect(validateEditorPreviewTemporaryLayerRequest(request)).toBe(true);
    expect(validateEditorPreviewTemporaryLayerRequest({ ...request, sequence: 3, patches: [] })).toBe(true);
    expect(validateEditorPreviewTemporaryLayerResponse({ source: "cubica-player-web", type: "temporaryPreviewLayerResult",
      protocolVersion: 1, requestId: "r1", sessionId: "s1", sequence: 2, ok: true })).toBe(true);
  });

  it("rejects arbitrary state patches and unbounded payloads", () => {
    expect(validateEditorPreviewTemporaryLayerRequest({ ...request, extra: "/state" })).toBe(false);
    expect(validateEditorPreviewTemporaryLayerRequest({ ...request, patches: [{ ...request.patches[0], property: "state" }] })).toBe(false);
    expect(validateEditorPreviewTemporaryLayerRequest({ ...request, patches: [{ ...request.patches[0], property: "html", value: "x".repeat(10001) }] })).toBe(false);
    expect(validateEditorPreviewTemporaryLayerRequest({ ...request, sequence: -1 })).toBe(false);
  });
});
