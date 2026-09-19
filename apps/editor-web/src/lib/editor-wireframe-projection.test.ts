import { describe, expect, it } from "vitest";
import type { JsonValue } from "@cubica/editor-engine";

import antarcticaDocument from "../../../../games/antarctica/authoring/ui/web.authoring.json";
import simpleChoiceDocument from "../../../../games/simple-choice/authoring/ui/web.authoring.json";

import {
  EDITOR_WIREFRAME_MAX_DEPTH,
  EDITOR_WIREFRAME_MAX_NODES,
  EDITOR_WIREFRAME_MAX_SCREENS,
  projectEditorWireframe,
  type EditorWireframeNode
} from "./editor-wireframe-projection";

function flatten(nodes: readonly EditorWireframeNode[]): EditorWireframeNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

describe("projectEditorWireframe", () => {
  it("projects the real Antarctica and neutral Simple Choice hierarchies", () => {
    const antarctica = projectEditorWireframe(antarcticaDocument as unknown as JsonValue, "games/antarctica/authoring/ui/web.authoring.json");
    const simpleChoice = projectEditorWireframe(simpleChoiceDocument as JsonValue, "games/simple-choice/authoring/ui/web.authoring.json");

    expect(antarctica.entryScreenId).toBe("S1");
    expect(antarctica.screens.length).toBeGreaterThan(0);
    expect(flatten(antarctica.screens[0]?.nodes ?? []).length).toBeGreaterThan(2);
    expect(simpleChoice.entryScreenId).toBe("intro");
    expect(flatten(simpleChoice.screens[0]?.nodes ?? []).map((node) => node.label).join(" ")).toContain("Simple Choice");
  });

  it("keeps unresolved bindings literal and never evaluates them", () => {
    const projection = projectEditorWireframe(simpleChoiceDocument as JsonValue, "simple-choice.json");
    const labels = flatten(projection.screens.flatMap((screen) => screen.nodes)).flatMap((node) => [node.label, node.displayText ?? ""]);

    expect(labels.some((label) => label.includes("{{choice.title}}"))).toBe(true);
    expect(labels.some((label) => label.includes("[object Object]"))).toBe(false);
  });

  it("handles empty and malformed documents without inventing a screen", () => {
    expect(projectEditorWireframe(null, "empty.json")).toMatchObject({
      title: "Структурный макет",
      screens: [],
      entryScreenId: null,
      truncated: false
    });
    const malformed = projectEditorWireframe({ root: { screens: [{ id: "broken", root: { type: "screenComponent", children: [null, "bad"] } }] } }, "broken.json");
    expect(malformed.screens).toHaveLength(1);
    expect(malformed.screens[0]?.nodes[0]?.children.map((node) => node.label)).toEqual([
      "Незавершённый элемент",
      "Незавершённый элемент"
    ]);
  });

  it("bounds deep and wide documents and marks the result as truncated", () => {
    let node: JsonValue = { _label: "leaf", type: "richTextComponent" };
    for (let depth = 0; depth < EDITOR_WIREFRAME_MAX_DEPTH + 4; depth += 1) {
      node = { _label: `level-${depth}`, type: "areaComponent", children: [node] };
    }
    const wideChildren = Array.from({ length: EDITOR_WIREFRAME_MAX_NODES + 20 }, (_, index) => ({ id: `child-${index}`, type: "buttonComponent" }));
    const projection = projectEditorWireframe({ root: { screens: [{ id: "deep", root: { type: "screenComponent", children: [node, ...wideChildren] } }] } }, "budget.json");
    const nodes = flatten(projection.screens.flatMap((screen) => screen.nodes));

    expect(projection.truncated).toBe(true);
    expect(nodes.length).toBeLessThanOrEqual(EDITOR_WIREFRAME_MAX_NODES);
    expect(nodes.some((candidate) => candidate.truncated)).toBe(true);
  });

  it("caps the number of screens while retaining a visible truncation state", () => {
    const screens = Array.from({ length: EDITOR_WIREFRAME_MAX_SCREENS + 20 }, (_, index) => ({
      id: `screen-${index}`,
      root: { type: "screenComponent" }
    }));
    const projection = projectEditorWireframe({ root: { screens } }, "many-screens.json");

    expect(projection.screens).toHaveLength(EDITOR_WIREFRAME_MAX_SCREENS);
    expect(projection.truncated).toBe(true);
  });
});
