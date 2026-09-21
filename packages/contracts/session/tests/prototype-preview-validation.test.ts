import { describe, expect, it } from "vitest";
import {
  validateEditorPrototypePreviewRequest,
  validateEditorPrototypePreviewResponse,
  validateEditorPreviewPrototypeRequest
} from "../src/index.ts";

describe("prototype preview contracts", () => {
  const endpointRequest = {
    gameId: "neutral-game", filePath: "games/neutral-game/authoring/ui/web.authoring.json",
    sourcePointer: "/root/screens/0/root/children/0",
    prototypePointer: "/_definitions/ui.Example",
    expectedVersion: "a".repeat(64), sessionId: "editor-session"
  };

  it("requires an exact authoring source, local prototype pointer, and file revision", () => {
    expect(validateEditorPrototypePreviewRequest(endpointRequest)).toBe(true);
    expect(validateEditorPrototypePreviewRequest({ ...endpointRequest, sourcePointer: "/other/0" })).toBe(false);
    expect(validateEditorPrototypePreviewRequest({ ...endpointRequest, prototypePointer: "/_definitions/x/props" })).toBe(false);
    expect(validateEditorPrototypePreviewRequest({ ...endpointRequest, expectedVersion: "" })).toBe(false);
    expect(validateEditorPrototypePreviewRequest({ ...endpointRequest, extra: true })).toBe(false);
  });

  it("validates compiled UI components and refuses unrecognized component fields", () => {
    const component = { type: "richTextComponent", props: { html: "Default" } };
    expect(validateEditorPrototypePreviewResponse({ component })).toBe(true);
    const wire = { source: "cubica-editor-web", type: "showPreviewPrototype", protocolVersion: 1,
      requestId: "r1", sessionId: "s1", runtimePointer: "/screens/example/root/children/0", component };
    expect(validateEditorPreviewPrototypeRequest(wire)).toBe(true);
    expect(validateEditorPreviewPrototypeRequest({ ...wire, component: { ...component, unexpected: true } })).toBe(false);
  });
});
