import { describe, expect, it } from "vitest";
import { createSchemaRegistry } from "@cubica/editor-engine";

import { embeddedAuthoringSample } from "./authoring-sample";
import { registerLocalAuthoringSchemas, gameAuthoringSchemaId } from "./editor-json-schema";
import {
  applyJsonPropertyEditResult,
  applyPropertyEdit,
  applyPropertyEditResult,
  applyWritableGraphOperation,
  coercePropertyValue,
  createEditorViewModel,
  findTreeNodeForPointer,
  safeDefaultCollectionValue,
  selectProperties
} from "./editor-web-adapter";

describe("editor web adapter", () => {
  it("uses @cubica/editor-engine projection for the embedded authoring sample", () => {
    const viewModel = createEditorViewModel(JSON.stringify(embeddedAuthoringSample));

    expect(viewModel.snapshot.diagnostics).toEqual([]);
    expect(viewModel.fullNodes.some((node) => node.role === "document")).toBe(true);
    expect(viewModel.fullNodes.some((node) => node.role === "definition")).toBe(true);
    expect(viewModel.fullEdges.some((edge) => edge.role === "defines")).toBe(true);
    expect(viewModel.nodes.length).toBeLessThanOrEqual(25);
    expect(viewModel.nodes.every((node) => node.semanticRole !== "property")).toBe(true);
    expect(viewModel.tree.root.pointer).toBe("");
    expect(viewModel.tree.nodeByPointer.get("/_definitions")).toBeUndefined();
    expect(viewModel.jsonTree.nodeByPointer.get("/_definitions")).toBeDefined();
  });

  it("reveals only the expanded active branch in the visible graph", () => {
    const text = JSON.stringify({
      root: {
        actions: {
          start: { _type: "game.StartAction", title: "Start" },
          finish: { _type: "game.FinishAction", title: "Finish" }
        },
        screens: {
          intro: { _type: "ui.Screen", title: "Intro" },
          result: { _type: "ui.Screen", title: "Result" }
        }
      }
    });

    const actionsView = createEditorViewModel(text, {
      graphState: {
        selectedNodeId: "/root/actions",
        activeBranchRootId: "/root",
        expandedNodeIds: ["/root", "/root/actions"],
        maxVisibleNodes: 60
      }
    });
    expect(actionsView.nodes.map((node) => node.pointer)).toContain("/root/actions/start");
    expect(actionsView.nodes.map((node) => node.pointer)).not.toContain("/root/screens/intro");

    const screensView = createEditorViewModel(text, {
      graphState: {
        selectedNodeId: "/root/screens",
        activeBranchRootId: "/root",
        expandedNodeIds: ["/root", "/root/screens"],
        maxVisibleNodes: 60
      }
    });
    expect(screensView.nodes.map((node) => node.pointer)).toContain("/root/screens/intro");
    expect(screensView.nodes.map((node) => node.pointer)).not.toContain("/root/actions/start");
  });

  it("edits properties through reverseProjectIntent operations", () => {
    const viewModel = createEditorViewModel(JSON.stringify(embeddedAuthoringSample));
    const pointer = "/_definitions/game.EditorPrototypeManifest/meta";
    const properties = selectProperties(viewModel.snapshot, pointer);
    const nameProperty = properties.find((property) => property.label === "name");

    expect(nameProperty).toBeDefined();
    const nextText = applyPropertyEdit(viewModel.snapshot, nameProperty?.pointer ?? "", "Edited Sample");

    expect(nextText).toContain("\"name\": \"Edited Sample\"");
    expect(nextText).toContain("\"id\": \"editor-prototype\"");
  });

  it("routes canonical schema and semantic diagnostics with pointer labels", () => {
    const registry = createSchemaRegistry();
    registerLocalAuthoringSchemas(registry);

    const viewModel = createEditorViewModel(
      JSON.stringify({
        _schemaVersion: "1.0",
        _manifestType: "game",
        _definitions: {
          "bad-name": { _semantics: "Invalid definition key" }
        },
        root: {
          first: { id: "same" },
          second: { id: "same" }
        }
      }),
      {
        filePath: "game.authoring.json",
        schemaRegistry: registry,
        schemaId: gameAuthoringSchemaId
      }
    );

    expect(viewModel.diagnostics.some((diagnostic) => diagnostic.source === "schema")).toBe(true);
    expect(viewModel.diagnostics.some((diagnostic) => diagnostic.source === "semantic")).toBe(true);
    expect(viewModel.diagnostics.every((diagnostic) => diagnostic.label.length > 0)).toBe(true);
    expect(viewModel.tree.root.subtreeDiagnosticCount).toBeGreaterThan(0);
  });

  it("can resolve tree nodes for deep pointers and their ancestors", () => {
    const viewModel = createEditorViewModel(
      JSON.stringify({
        root: {
          _type: "game.Game",
          _label: "Game",
          nested: [{ id: "a", _type: "game.Step", _label: "Step A" }]
        }
      })
    );
    const deep = findTreeNodeForPointer(viewModel.tree, "/root/nested/0/id");

    expect(deep?.pointer).toBe("/root/nested/0");
    expect(findTreeNodeForPointer(viewModel.jsonTree, "/root/nested/0/id/missing")?.pointer).toBe("/root/nested/0/id");
  });

  it("exposes reverse-projection diagnostics for unsafe property edits", () => {
    const viewModel = createEditorViewModel(JSON.stringify(embeddedAuthoringSample));
    const result = applyPropertyEditResult(viewModel.snapshot, "/missing/value", "Nope");

    expect(result.text).toBe(viewModel.snapshot.text);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        source: "reverse-projection",
        pointer: "/missing/value"
      })
    ]);
  });

  it("coerces scalar input and validates compact JSON property edits", () => {
    expect(coercePropertyValue(1, "2.5")).toBe(2.5);
    expect(coercePropertyValue(true, "false")).toBe(false);
    expect(coercePropertyValue("old", "new")).toBe("new");

    const viewModel = createEditorViewModel(JSON.stringify({ config: { enabled: true, values: [1] } }));
    const valid = applyJsonPropertyEditResult(viewModel.snapshot, "/config/values", "[1, 2]");
    expect(valid.text).toContain("\"values\": [\n      1,\n      2\n    ]");

    const invalid = applyJsonPropertyEditResult(viewModel.snapshot, "/config/values", "[");
    expect(invalid.text).toBe(viewModel.snapshot.text);
    expect(invalid.diagnostics).toEqual([
      expect.objectContaining({
        source: "property-json",
        pointer: "/config/values"
      })
    ]);
  });

  it("adds and removes collection items through writable graph operations", () => {
    const viewModel = createEditorViewModel(JSON.stringify({ list: [{ id: "a", enabled: true }], map: {} }));

    expect(safeDefaultCollectionValue([{ id: "a", enabled: true }])).toEqual({ id: "", enabled: false });

    const added = applyWritableGraphOperation(viewModel.snapshot, {
      type: "addCollectionItem",
      collectionPointer: "/list",
      rawJson: "{\"id\":\"b\"}"
    });
    expect(added.text).toContain("\"id\": \"b\"");

    const removed = applyWritableGraphOperation(viewModel.snapshot, {
      type: "removeCollectionItem",
      itemPointer: "/list/0"
    });
    expect(removed.text).toContain("\"list\": []");

    const rejectedRoot = applyWritableGraphOperation(viewModel.snapshot, {
      type: "removeCollectionItem",
      itemPointer: ""
    });
    expect(rejectedRoot.diagnostics[0]).toMatchObject({ source: "reverse-projection", pointer: "" });
  });

  it("connects and disconnects reference fields through writable graph operations", () => {
    const viewModel = createEditorViewModel(
      JSON.stringify({
        nodes: [{ id: "a" }, { id: "b" }],
        link: { $ref: "#/nodes/0" }
      })
    );

    const connected = applyWritableGraphOperation(viewModel.snapshot, {
      type: "connectReference",
      referencePointer: "/link/$ref",
      targetPointer: "/nodes/1"
    });
    expect(connected.text).toContain("\"$ref\": \"#/nodes/1\"");

    const disconnected = applyWritableGraphOperation(viewModel.snapshot, {
      type: "disconnectReference",
      referencePointer: "/link/$ref"
    });
    expect(disconnected.text).not.toContain("\"$ref\"");
  });
});
