/**
 * Tests for the framework-free editor engine public API.
 *
 * The cases stay intentionally small and shape-based so the package remains
 * independent from concrete games and UI frameworks.
 */
import { describe, expect, it } from "vitest";
import {
  applyJsonPatch,
  applyJsonPatchWithInverse,
  buildAuthoringGraphProjection,
  buildVisibleAuthoringGraphProjection,
  buildJsonPointer,
  appendPreviewPlaythroughEvent,
  buildManifestChronologyTimeline,
  buildPreviewTraceRestorePlan,
  createDocumentStore,
  createPatchJournalStep,
  createPreviewPlaythroughTrace,
  createSchemaRegistry,
  createStaticPreviewRendererAdapter,
  createPrototypeExtractionProposal,
  discoverPrototypeExtractionCandidates,
  dryRunEditorChangeSet,
  hashEditorText,
  decodeJsonPointerSegment,
  encodeJsonPointerSegment,
  hitTestPreviewPoint,
  hitTestPreviewRect,
  parseJsonPointer,
  previewRectContainsPoint,
  previewRectsIntersect,
  readJsonPointer,
  reverseProjectIntent,
  buildEntityTreeViewModel,
  buildTreeViewModel,
  sortPreviewEntitiesTopmostFirst,
  validateDocument,
  validateJsonValue,
  type DocumentDiagnostic,
  type JsonSchema,
  type JsonValue,
  type PreviewEntityDescriptor,
  type TextRange
} from "../src/index.ts";

describe("JSON Pointer utilities", () => {
  it("encodes, decodes, builds, parses, and reads pointers", () => {
    const segment = "a/b~c";
    expect(encodeJsonPointerSegment(segment)).toBe("a~1b~0c");
    expect(decodeJsonPointerSegment("a~1b~0c")).toBe(segment);
    expect(buildJsonPointer(["root", segment, "0"])).toBe("/root/a~1b~0c/0");
    expect(parseJsonPointer("/root/a~1b~0c/0")).toEqual(["root", segment, "0"]);

    const document: JsonValue = { root: { [segment]: ["value"] } };
    expect(readJsonPointer(document, "/root/a~1b~0c/0")).toBe("value");
    expect(readJsonPointer(document, "/root/missing")).toBeUndefined();
  });
});

describe("JSON Patch utilities", () => {
  it("adds, replaces, and removes object and array values immutably", () => {
    const source: JsonValue = { title: "Old", items: [{ label: "A" }] };
    const patched = applyJsonPatch(source, [
      { op: "replace", path: "/title", value: "New" },
      { op: "add", path: "/items/1", value: { label: "B" } },
      { op: "remove", path: "/items/0/label" }
    ]);

    expect(patched).toEqual({ title: "New", items: [{}, { label: "B" }] });
    expect(source).toEqual({ title: "Old", items: [{ label: "A" }] });
    expect(patched).not.toBe(source);
    expect(readJsonPointer(patched, "/items/1/label")).toBe("B");
  });

  it("supports test guards, inverse patch generation, and dry-run summaries", () => {
    const source: JsonValue = { title: "Old", items: ["A"] };
    const applied = applyJsonPatchWithInverse(source, [
      { op: "test", path: "/title", value: "Old" },
      { op: "replace", path: "/title", value: "New" },
      { op: "add", path: "/items/-", value: "B" }
    ]);

    expect(applied.value).toEqual({ title: "New", items: ["A", "B"] });
    expect(applied.inverseOperations).toEqual([
      { op: "remove", path: "/items/1" },
      { op: "replace", path: "/title", value: "Old" }
    ]);
    expect(applyJsonPatch(applied.value, applied.inverseOperations)).toEqual(source);
    expect(() => applyJsonPatchWithInverse(source, [{ op: "test", path: "/title", value: "Other" }])).toThrow(
      /test failed/u
    );

    const snapshot = createDocumentStore({ filePath: "doc.authoring.json", text: JSON.stringify(source) }).snapshot();
    const dryRun = dryRunEditorChangeSet({
      snapshot,
      changeSet: {
        id: "change-1",
        summary: "Rename title",
        jsonPatches: [
          {
            filePath: "doc.authoring.json",
            operations: [
              { op: "test", path: "/title", value: "Old" },
              { op: "replace", path: "/title", value: "New" }
            ]
          }
        ],
        textPatches: []
      },
      includeSemanticDiagnostics: false
    });

    expect(dryRun.ok).toBe(true);
    expect(dryRun.after?.json).toEqual({ title: "New", items: ["A"] });
    expect(dryRun.inverseChangeSet?.jsonPatches[0]?.operations).toEqual([
      { op: "replace", path: "/title", value: "Old" }
    ]);
    expect(dryRun.diffSummary[0]).toMatchObject({
      filePath: "doc.authoring.json",
      pointer: "/title",
      operation: "replace"
    });

    const journalStep = createPatchJournalStep({
      id: "step-1",
      createdAt: "2026-05-28T00:00:00.000Z",
      intent: {
        id: "intent-1",
        kind: "preview-prompt",
        prompt: "Rename",
        activeFilePath: "doc.authoring.json",
        targetPointers: ["/title"],
        createdAt: "2026-05-28T00:00:00.000Z"
      },
      forward: {
        id: "change-1",
        summary: "Rename title",
        jsonPatches: [{ filePath: "doc.authoring.json", operations: [{ op: "replace", path: "/title", value: "New" }] }]
      },
      inverse: dryRun.inverseChangeSet as NonNullable<typeof dryRun.inverseChangeSet>,
      beforeText: snapshot.text,
      afterText: dryRun.after?.text ?? "",
      diffSummary: dryRun.diffSummary
    });

    expect(journalStep.beforeHash).toBe(hashEditorText(snapshot.text));
    expect(journalStep.affectedFiles).toEqual(["doc.authoring.json"]);
  });
});

describe("prototype extraction proposals", () => {
  it("discovers repeated authoring objects and builds a local prototype ChangeSet", () => {
    const authoring = {
      $schema: "schema:ui-authoring",
      _schemaVersion: "2.0",
      _manifestType: "ui",
      _definitions: {
        "ui.Button": {
          _semantics: "Base button."
        }
      },
      root: {
        _type: "ui.Manifest",
        _label: "Web UI",
        screens: [
          {
            id: "main",
            _type: "ui.Screen",
            _label: "Main",
            root: {
              id: "continue",
              _type: "ui.Button",
              _label: "Continue",
              kind: "button",
              props: {
                variant: "primary",
                text: "Continue"
              },
              action: {
                type: "navigate",
                target: "details"
              }
            }
          },
          {
            id: "details",
            _type: "ui.Screen",
            _label: "Details",
            root: {
              id: "back",
              _type: "ui.Button",
              _label: "Back",
              kind: "button",
              props: {
                variant: "primary",
                text: "Back"
              },
              action: {
                type: "navigate",
                target: "main"
              }
            }
          }
        ]
      }
    } satisfies JsonValue;
    const snapshot = createDocumentStore({
      filePath: "ui/web.authoring.json",
      text: JSON.stringify(authoring, null, 2)
    }).snapshot();

    const discovery = discoverPrototypeExtractionCandidates({ snapshot, rootPointer: "/root" });
    expect(discovery.ok).toBe(true);
    expect(
      discovery.candidates.some(
        (candidate) =>
          candidate.pointers.includes("/root/screens/0/root") && candidate.pointers.includes("/root/screens/1/root")
      )
    ).toBe(true);

    const proposalResult = createPrototypeExtractionProposal({
      snapshot,
      sourcePointers: ["/root/screens/0/root", "/root/screens/1/root"],
      definitionType: "ui.PrimaryNavigationButton",
      definitionSemantics: "Reusable primary navigation button for this game UI.",
      promptTemplate: {
        raw: "Опишите текст кнопки и целевой экран перехода.",
        language: "ru",
        appliesTo: "ui.PrimaryNavigationButton"
      }
    });

    expect(proposalResult.ok).toBe(true);
    if (!proposalResult.ok) {
      throw new Error("Expected prototype extraction proposal to be created.");
    }
    const proposal = proposalResult.proposal;
    expect(proposal.definitionPointer).toBe("/_definitions/ui.PrimaryNavigationButton");
    expect(proposal.definition).toEqual({
      _semantics: "Reusable primary navigation button for this game UI.",
      _extends: "ui.Button",
      _promptTemplate: {
        raw: "Опишите текст кнопки и целевой экран перехода.",
        language: "ru",
        appliesTo: "ui.PrimaryNavigationButton"
      },
      action: {
        type: "navigate"
      },
      kind: "button",
      props: {
        variant: "primary"
      }
    });
    expect(proposal.instanceOverrides[0]?.replacement).toEqual({
      _type: "ui.PrimaryNavigationButton",
      id: "continue",
      _label: "Continue",
      kind: "button",
      props: {
        variant: "primary",
        text: "Continue"
      },
      action: {
        type: "navigate",
        target: "details"
      }
    });
    expect(proposal.validationGates).toContain("canonical-runtime-diff");
    expect(proposal.sourceMapImpact.affectedPointers).toEqual(["/root/screens/0/root", "/root/screens/1/root"]);

    const dryRun = dryRunEditorChangeSet({
      snapshot,
      changeSet: proposal.changeSet,
      includeSemanticDiagnostics: false
    });
    expect(dryRun.ok).toBe(true);
    expect(readJsonPointer(dryRun.after?.json as JsonValue, "/_definitions/ui.PrimaryNavigationButton")).toEqual(
      proposal.definition
    );
    expect(readJsonPointer(dryRun.after?.json as JsonValue, "/root/screens/1/root")).toEqual({
      _type: "ui.PrimaryNavigationButton",
      id: "back",
      _label: "Back",
      kind: "button",
      props: {
        variant: "primary",
        text: "Back"
      },
      action: {
        type: "navigate",
        target: "main"
      }
    });
  });

  it("rejects sources with mixed _type values so extraction cannot hide semantic differences", () => {
    const snapshot = createDocumentStore({
      filePath: "game.authoring.json",
      text: JSON.stringify(
        {
          _definitions: {},
          root: {
            actions: [
              { id: "one", _type: "game.ChoiceAction", handler: "choice.select" },
              { id: "two", _type: "game.MetricAction", handler: "choice.select" }
            ]
          }
        },
        null,
        2
      )
    }).snapshot();

    const proposal = createPrototypeExtractionProposal({
      snapshot,
      sourcePointers: ["/root/actions/0", "/root/actions/1"],
      definitionType: "game.SharedAction",
      definitionSemantics: "Shared action."
    });

    expect(proposal.ok).toBe(false);
    expect(proposal.diagnostics[0]?.message).toMatch(/different _type/u);
  });
});

describe("TextLocationMap", () => {
  it("maps root, object keys, values, arrays, and primitives in pretty JSON", () => {
    const text = [
      "{",
      "  \"title\": \"Root\",",
      "  \"items\": [",
      "    { \"id\": \"one\", \"active\": true },",
      "    null",
      "  ],",
      "  \"count\": 2",
      "}",
      ""
    ].join("\n");
    const snapshot = createDocumentStore({ filePath: "pretty.json", text }).snapshot();

    expect(snapshot.locationMap.get("")).toEqual(rangeForOffsets(text, 0, text.trimEnd().length));
    expect(snapshot.locationMap.get("/title", "key")).toEqual(rangeForFragment(text, "\"title\""));
    expect(snapshot.locationMap.get("/title")).toEqual(rangeForFragment(text, "\"Root\""));
    expect(snapshot.locationMap.get("/items")).toEqual(
      rangeForFragment(text, "[\n    { \"id\": \"one\", \"active\": true },\n    null\n  ]")
    );
    expect(snapshot.locationMap.get("/items/0")).toEqual(rangeForFragment(text, "{ \"id\": \"one\", \"active\": true }"));
    expect(snapshot.locationMap.get("/items/0/id", "key")).toEqual(rangeForFragment(text, "\"id\""));
    expect(snapshot.locationMap.get("/items/0/id")).toEqual(rangeForFragment(text, "\"one\""));
    expect(snapshot.locationMap.get("/items/0/active")).toEqual(rangeForFragment(text, "true"));
    expect(snapshot.locationMap.get("/items/1")).toEqual(rangeForFragment(text, "null"));
    expect(snapshot.locationMap.get("/count")).toEqual(rangeForFragment(text, "2"));
  });

  it("maps minified JSON and primitive roots", () => {
    const minified = "{\"a\":[1,{\"b\":null}],\"c\":false}";
    const minifiedSnapshot = createDocumentStore({ filePath: "minified.json", text: minified }).snapshot();

    expect(minifiedSnapshot.locationMap.get("")).toEqual(rangeForOffsets(minified, 0, minified.length));
    expect(minifiedSnapshot.locationMap.get("/a", "key")).toEqual(rangeForFragment(minified, "\"a\""));
    expect(minifiedSnapshot.locationMap.get("/a/0")).toEqual(rangeForFragment(minified, "1"));
    expect(minifiedSnapshot.locationMap.get("/a/1/b")).toEqual(rangeForFragment(minified, "null"));
    expect(minifiedSnapshot.locationMap.get("/c")).toEqual(rangeForFragment(minified, "false"));

    const primitive = "  true\n";
    const primitiveSnapshot = createDocumentStore({ filePath: "primitive.json", text: primitive }).snapshot();
    expect(primitiveSnapshot.locationMap.get("")).toEqual(rangeForFragment(primitive, "true"));
  });
});

describe("DocumentStore", () => {
  it("reports invalid JSON diagnostics and leaves invalid text unpatched", () => {
    const store = createDocumentStore({ filePath: "broken.json", text: "{ bad" });
    const before = store.snapshot();

    expect(before.json).toBeUndefined();
    expect(before.diagnostics).toHaveLength(1);
    expect(before.diagnostics[0]).toMatchObject({ severity: "error", source: "syntax", pointer: "" });

    const after = store.applyPatch([{ op: "add", path: "/x", value: 1 }]);
    expect(after.text).toBe("{ bad");
    expect(after.diagnostics).toHaveLength(1);
  });

  it("patches valid JSON, tracks selection, and refreshes location ranges", () => {
    const store = createDocumentStore({ filePath: "ok.json", text: "{\"name\":\"Draft\"}" });

    const selected = store.selectPointer("/name");
    expect(selected.selectedPointer).toBe("/name");

    const patched = store.applyPatch([{ op: "replace", path: "/name", value: "Published" }]);
    expect(patched.json).toEqual({ name: "Published" });
    expect(patched.text).toContain("\"Published\"");
    expect(patched.locationMap.get("/name")).toEqual(rangeForFragment(patched.text, "\"Published\""));
  });
});

describe("schema registry and validation", () => {
  it("registers local schemas and maps Ajv diagnostics to pointers and ranges", () => {
    const registry = createSchemaRegistry();
    registry.registerSchema("schema:shape", collectionSchema);
    const text = [
      "{",
      "  \"nodes\": [",
      "    { \"id\": 7, \"extra\": true },",
      "    { \"amount\": 1 }",
      "  ]",
      "}",
      ""
    ].join("\n");
    const snapshot = createDocumentStore({ filePath: "schema.json", text }).snapshot();
    const diagnostics = validateDocument(snapshot, {
      schemaRegistry: registry,
      schemaId: "schema:shape",
      includeSemanticDiagnostics: false
    });

    expect(registry.hasSchema("schema:shape")).toBe(true);
    expect(diagnostics.map((diagnostic) => diagnostic.source)).toEqual(["schema", "schema", "schema"]);
    expect(diagnostics.map((diagnostic) => diagnostic.pointer).sort()).toEqual([
      "/nodes/0/extra",
      "/nodes/0/id",
      "/nodes/1/id"
    ]);
    expect(diagnostics.find((diagnostic) => diagnostic.pointer === "/nodes/0/id")?.range).toEqual(
      snapshot.locationMap.get("/nodes/0/id")
    );
    expect(diagnostics.find((diagnostic) => diagnostic.pointer === "/nodes/1/id")?.range).toBeUndefined();
  });

  it("validates parsed values without a document store", () => {
    const registry = createSchemaRegistry();
    registry.registerSchema("schema:shape", collectionSchema);

    expect(
      validateJsonValue(
        { nodes: [{ id: "one", amount: 1 }] },
        { schemaRegistry: registry, schemaId: "schema:shape", includeSemanticDiagnostics: false }
      )
    ).toEqual([]);
    expect(
      validateJsonValue({ nodes: [{ id: 1 }] }, { schemaRegistry: registry, schemaId: "schema:shape" }).map(
        (diagnostic) => diagnostic.pointer
      )
    ).toContain("/nodes/0/id");
  });
});

describe("semantic diagnostics", () => {
  it("detects duplicate ids within array and object collections plus unresolved local references", () => {
    const store = createDocumentStore({
      filePath: "semantic.json",
      text: JSON.stringify(
        {
          groups: [{ id: "same" }, { id: "same" }],
          lookup: { first: { id: "shared" }, second: { id: "shared" } },
          link: { $ref: "#/missing/node" },
          validLink: { $ref: "#/groups/0" }
        },
        null,
        2
      )
    });
    const snapshot = store.snapshot();
    const diagnostics = validateDocument(snapshot);

    expect(diagnostics.map((diagnostic) => diagnostic.source)).toEqual(["semantic", "semantic", "semantic"]);
    expect(diagnostics.map((diagnostic) => diagnostic.pointer).sort()).toEqual([
      "/groups/1/id",
      "/link/$ref",
      "/lookup/second/id"
    ]);
    expect(diagnostics.find((diagnostic) => diagnostic.pointer === "/link/$ref")?.range).toEqual(
      snapshot.locationMap.get("/link/$ref")
    );
  });

  it("keeps invariant checks tied to JSON shape rather than collection names", () => {
    const first = summarizeInvariantShape("alpha");
    const second = summarizeInvariantShape("omega");

    expect(first).toEqual(second);
  });
});

describe("authoring graph projection", () => {
  it("creates neutral graph roles without domain-specific assumptions", () => {
    const store = createDocumentStore({
      filePath: "authoring.json",
      text: JSON.stringify({
        catalog: [{ id: "intro", type: "node", next: { $ref: "#/catalog/0" } }],
        metadata: { title: "Generic" }
      })
    });

    const projection = buildAuthoringGraphProjection(store.snapshot());
    const roles = projection.nodes.map((node) => node.role);

    expect(roles).toContain("document");
    expect(roles).toContain("collection");
    expect(roles).toContain("typed-object");
    expect(roles).toContain("reference");
    expect(roles).toContain("property");
    expect(projection.edges.some((edge) => edge.role === "references")).toBe(true);
  });

  it("adds semantic metadata and hides raw property nodes from the default visible graph", () => {
    const snapshot = createDocumentStore({
      filePath: "authoring.json",
      text: JSON.stringify({
        _definitions: {
          "game.StartAction": {
            _semantics: "Starts a generic flow.",
            displayName: "Start Flow"
          }
        },
        root: {
          _type: "game.GenericManifest",
          actions: {
            start: {
              _type: "game.StartAction",
              title: "Start"
            }
          },
          state: {
            public: {
              metrics: {
                score: 0
              }
            }
          }
        }
      })
    }).snapshot();

    const projection = buildAuthoringGraphProjection(snapshot);
    const actionNode = projection.nodes.find((node) => node.pointer === "/root/actions/start");
    const metricNode = projection.nodes.find((node) => node.pointer === "/root/state/public/metrics/score");
    const titleNode = projection.nodes.find((node) => node.pointer === "/root/actions/start/title");

    expect(actionNode).toMatchObject({
      semanticRole: "action",
      semanticTitle: "Start",
      presentationRole: "operation"
    });
    expect(metricNode).toMatchObject({
      semanticRole: "metric",
      presentationRole: "metric"
    });
    expect(titleNode).toMatchObject({
      semanticRole: "property",
      hiddenByDefault: true
    });
    expect(projection.edges.some((edge) => edge.role === "references" && edge.from === "/root/actions/start")).toBe(true);

    const visible = buildVisibleAuthoringGraphProjection(projection, { selectedNodeId: "$", maxVisibleNodes: 25 });
    expect(visible.nodes.length).toBeLessThanOrEqual(25);
    expect(visible.nodes.every((node) => node.semanticRole !== "property")).toBe(true);
    expect(visible.edges.some((edge) => edge.role === "contains")).toBe(true);
  });

  it("uses expansion state to reveal an active branch without rendering sibling internals", () => {
    const snapshot = createDocumentStore({
      filePath: "authoring.json",
      text: JSON.stringify({
        root: {
          actions: {
            one: { _type: "game.OneAction", title: "One" },
            two: { _type: "game.TwoAction", title: "Two" }
          },
          screens: {
            first: { _type: "ui.Screen", title: "First Screen" },
            second: { _type: "ui.Screen", title: "Second Screen" }
          }
        }
      })
    }).snapshot();
    const projection = buildAuthoringGraphProjection(snapshot);

    const actionsVisible = buildVisibleAuthoringGraphProjection(projection, {
      selectedNodeId: "/root/actions",
      activeBranchRootId: "/root",
      expandedNodeIds: ["/root", "/root/actions"],
      maxVisibleNodes: 60
    });
    expect(actionsVisible.nodes.map((node) => node.pointer)).toContain("/root/actions/one");
    expect(actionsVisible.nodes.map((node) => node.pointer)).not.toContain("/root/screens/first");

    const screensVisible = buildVisibleAuthoringGraphProjection(projection, {
      selectedNodeId: "/root/screens",
      activeBranchRootId: "/root",
      expandedNodeIds: ["/root", "/root/screens"],
      maxVisibleNodes: 60
    });
    expect(screensVisible.nodes.map((node) => node.pointer)).toContain("/root/screens/first");
    expect(screensVisible.nodes.map((node) => node.pointer)).not.toContain("/root/actions/one");
  });
});

describe("TreeViewModelBuilder", () => {
  it("builds a pointer-complete tree with escaped object keys and array indexes", () => {
    const trickyKey = "a/b~c";
    const snapshot = createDocumentStore({
      filePath: "tree.json",
      text: JSON.stringify({ root: { [trickyKey]: ["value"] } }, null, 2)
    }).snapshot();

    const tree = buildTreeViewModel({ snapshot });

    expect(tree.root.pointer).toBe("");
    expect(tree.nodeByPointer.get("/root")).toBeDefined();
    expect(tree.nodeByPointer.get("/root/a~1b~0c")).toBeDefined();
    expect(tree.nodeByPointer.get("/root/a~1b~0c/0")?.valuePreview).toContain("\"value\"");
  });

  it("attaches diagnostics to matching pointers and bubbles counts to parent branches", () => {
    const snapshot = createDocumentStore({
      filePath: "tree.json",
      text: JSON.stringify({ list: [true, false], map: { ok: 1 } }, null, 2)
    }).snapshot();

    const diagnostics: readonly DocumentDiagnostic[] = [
      { severity: "error", source: "schema", message: "Broken", pointer: "/list/1" },
      { severity: "warning", source: "semantic", message: "Heads up", pointer: "/map/ok" }
    ];

    const tree = buildTreeViewModel({ snapshot, diagnostics });
    expect(tree.nodeByPointer.get("/list/1")?.diagnostics).toHaveLength(1);
    expect(tree.nodeByPointer.get("/map/ok")?.diagnostics).toHaveLength(1);
    expect(tree.nodeByPointer.get("/list")?.subtreeDiagnosticCount).toBe(1);
    expect(tree.root.subtreeDiagnosticCount).toBe(2);
  });

  it("marks $ref containers and local reference strings as reference-ish nodes", () => {
    const snapshot = createDocumentStore({
      filePath: "tree.json",
      text: JSON.stringify({ link: { $ref: "#/target" }, refText: "#/target" }, null, 2)
    }).snapshot();

    const tree = buildTreeViewModel({ snapshot });
    expect(tree.nodeByPointer.get("/link")?.kind).toBe("reference");
    expect(tree.nodeByPointer.get("/refText")?.kind).toBe("reference");
  });
});

describe("EntityTreeViewModelBuilder", () => {
  it("builds a semantic entity outline with _label names and hidden technical fields", () => {
    const snapshot = createDocumentStore({
      filePath: "entity-tree.json",
      text: JSON.stringify(
        {
          $schema: "schema:authoring",
          _schemaVersion: "2.0",
          _manifestType: "ui",
          _definitions: {
            "ui.Prototype": { _semantics: "Reusable only." }
          },
          root: {
            _type: "ui.Manifest",
            _label: "Web UI",
            screens: [
              {
                id: "main",
                _type: "ui.Screen",
                _label: "Главный экран",
                root: {
                  id: "next",
                  _type: "ui.Button",
                  _label: "Кнопка далее",
                  props: { text: "Далее" }
                }
              }
            ]
          }
        },
        null,
        2
      )
    }).snapshot();

    const tree = buildEntityTreeViewModel({ snapshot });

    expect(tree.nodeByPointer.get("/root")?.label).toBe("Web UI");
    expect(tree.nodeByPointer.get("/root/screens/0")?.label).toBe("Главный экран");
    expect(tree.nodeByPointer.get("/root/screens/0/root")?.label).toBe("Кнопка далее");
    expect(tree.nodeByPointer.get("/$schema")).toBeUndefined();
    expect(tree.nodeByPointer.get("/_schemaVersion")).toBeUndefined();
    expect(tree.nodeByPointer.get("/_definitions")).toBeUndefined();
    expect(tree.nodeByPointer.get("/root/screens/0/root/props/text")).toBeUndefined();
    expect(tree.nodeByPointer.get("/root/screens/0/root")?.parentPointer).toBe("/root/screens/0");
  });

  it("uses title/name/id fallback for display but validates missing _label", () => {
    const snapshot = createDocumentStore({
      filePath: "entity-tree.json",
      text: JSON.stringify(
        {
          root: {
            _type: "game.Game",
            title: "Fallback Root",
            logic: {
              actions: [{ id: "start", _type: "game.Action", name: "Fallback Action" }]
            }
          }
        },
        null,
        2
      )
    }).snapshot();
    const diagnostics = validateDocument(snapshot);
    const tree = buildEntityTreeViewModel({ snapshot, diagnostics });

    expect(tree.nodeByPointer.get("/root")?.label).toBe("Fallback Root");
    expect(tree.nodeByPointer.get("/root/logic/actions/0")?.label).toBe("Fallback Action");
    expect(diagnostics.map((diagnostic) => diagnostic.pointer).sort()).toEqual([
      "/root/_label",
      "/root/logic/actions/0/_label"
    ]);
    expect(tree.nodeByPointer.get("/root")?.subtreeDiagnosticCount).toBe(2);
  });
});

describe("preview renderer adapter protocol", () => {
  const baseEntities: readonly PreviewEntityDescriptor[] = [
    previewEntity("background", "/root/background", { x: 0, y: 0, width: 400, height: 300 }, { zIndex: 0, layer: "scene" }),
    previewEntity("button", "/root/screens/0/root/children/1", { x: 20, y: 20, width: 120, height: 40 }, { zIndex: 10, renderOrder: 1, layer: "ui" }),
    previewEntity("menu", "/root/screens/0/root/children/2", { x: 10, y: 10, width: 140, height: 60 }, { zIndex: 10, renderOrder: 2, layer: "ui" }),
    previewEntity("hidden", "/root/hidden", { x: 15, y: 15, width: 50, height: 50 }, { visible: false, zIndex: 100, layer: "ui" }),
    previewEntity("locked", "/root/locked", { x: 15, y: 15, width: 50, height: 50 }, { selectable: false, zIndex: 99, layer: "ui" })
  ];

  it("normalizes preview geometry for point and rectangle hit-testing", () => {
    expect(previewRectContainsPoint({ x: 100, y: 100, width: -50, height: -50 }, { x: 75, y: 75 })).toBe(true);
    expect(
      previewRectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 9, y: 9, width: 5, height: 5 })
    ).toBe(true);
    expect(
      previewRectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 11, y: 11, width: 5, height: 5 })
    ).toBe(false);
  });

  it("returns topmost selectable point hits without renderer-specific dependencies", () => {
    const result = hitTestPreviewPoint(baseEntities, { x: 25, y: 25 });

    expect(result.entities.map((entity) => entity.entityId)).toEqual(["menu", "button", "background"]);
    expect(sortPreviewEntitiesTopmostFirst(baseEntities).map((entity) => entity.entityId).slice(0, 3)).toEqual([
      "hidden",
      "locked",
      "menu"
    ]);
  });

  it("supports rectangle selection filters and result limits", () => {
    const result = hitTestPreviewRect(baseEntities, { x: 0, y: 0, width: 200, height: 100 }, { layers: ["ui"], limit: 1 });

    expect(result.rect).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(result.entities.map((entity) => entity.entityId)).toEqual(["menu"]);

    const diagnosticResult = hitTestPreviewRect(baseEntities, { x: 0, y: 0, width: 200, height: 100 }, {
      includeHidden: true,
      includeNonSelectable: true,
      layers: ["ui"]
    });
    expect(diagnosticResult.entities.map((entity) => entity.entityId).slice(0, 2)).toEqual(["hidden", "locked"]);
  });

  it("provides a static adapter for tests and non-DOM preview simulations", () => {
    const adapter = createStaticPreviewRendererAdapter(baseEntities);
    let changeCount = 0;
    const unsubscribe = adapter.subscribe(() => {
      changeCount += 1;
    });

    expect(adapter.hitTestPoint({ x: 25, y: 25 }).entities[0]?.entityId).toBe("menu");

    adapter.highlight({ type: "highlightEntities", entityIds: ["button"], reason: "selection" });
    expect(adapter.getHighlightCommand()).toEqual({ type: "highlightEntities", entityIds: ["button"], reason: "selection" });

    adapter.setEntities([baseEntities[1] as PreviewEntityDescriptor]);
    expect(adapter.getEntities()).toHaveLength(1);
    expect(changeCount).toBe(2);

    unsubscribe();
    adapter.highlight({ type: "clearHighlight" });
    expect(changeCount).toBe(2);
  });
});

describe("timeline and playthrough trace model", () => {
  it("builds manifest chronology from v2 flow steps", () => {
    const snapshot = createDocumentStore({
      filePath: "timeline.game.authoring.json",
      text: JSON.stringify(
        {
          root: {
            _type: "game.Game",
            _label: "Game",
            logic: {
              flows: [
                {
                  id: "main",
                  _type: "game.Flow",
                  _label: "Основная хронология",
                  steps: [
                    {
                      id: "intro",
                      _type: "game.Step",
                      _label: "Вступление",
                      screenId: "S1",
                      actionIds: ["intro.next"],
                      next: "choice"
                    },
                    {
                      id: "choice",
                      _type: "game.Step",
                      _label: "Выбор",
                      screenId: "S2",
                      actionIds: ["choice.accept"]
                    }
                  ]
                }
              ]
            }
          }
        },
        null,
        2
      )
    }).snapshot();

    const timeline = buildManifestChronologyTimeline({ snapshot });

    expect(timeline.rootEntryIds).toEqual(["/root/logic/flows/0"]);
    expect(timeline.entries.map((entry) => [entry.kind, entry.label, entry.pointer])).toEqual([
      ["flow", "Основная хронология", "/root/logic/flows/0"],
      ["step", "Вступление", "/root/logic/flows/0/steps/0"],
      ["step", "Выбор", "/root/logic/flows/0/steps/1"]
    ]);
    expect(timeline.entryById.get("/root/logic/flows/0/steps/0")).toMatchObject({
      parentId: "/root/logic/flows/0",
      flowId: "main",
      stepId: "intro",
      screenId: "S1",
      actionIds: ["intro.next"],
      nextStepId: "choice"
    });
  });

  it("plans playthrough restore from nearest preview snapshot", () => {
    const trace = appendPreviewPlaythroughEvent(
      appendPreviewPlaythroughEvent(
        appendPreviewPlaythroughEvent(
          createPreviewPlaythroughTrace({ traceId: "trace-1", gameId: "game" }),
          { id: "e0", timestamp: "2026-05-28T00:00:00.000Z", kind: "action", label: "Start" },
          { step: 0 }
        ),
        { id: "e1", timestamp: "2026-05-28T00:00:01.000Z", kind: "action", label: "Next" }
      ),
      { id: "e2", timestamp: "2026-05-28T00:00:02.000Z", kind: "navigation", label: "Open" },
      { step: 2 }
    );

    const plan = buildPreviewTraceRestorePlan(trace, 1);
    expect(plan.snapshot).toMatchObject({ id: "trace-1:snapshot:0", eventSequence: 0, state: { step: 0 } });
    expect(plan.replayEvents.map((event) => event.id)).toEqual(["e1"]);

    const latest = buildPreviewTraceRestorePlan(trace, 2);
    expect(latest.snapshot).toMatchObject({ id: "trace-1:snapshot:2", eventSequence: 2, state: { step: 2 } });
    expect(latest.replayEvents).toEqual([]);
  });
});

describe("reverseProjectIntent", () => {
  it("turns safe value edits into JSON Patch and rejects unsafe missing parents", () => {
    const snapshot = createDocumentStore({ filePath: "doc.json", text: "{\"title\":\"Old\"}" }).snapshot();

    expect(reverseProjectIntent(snapshot, { type: "setValue", pointer: "/title", value: "New" })).toEqual({
      target: "authoring",
      operations: [{ op: "replace", path: "/title", value: "New" }]
    });
    expect(reverseProjectIntent(snapshot, { type: "setValue", pointer: "/description", value: "Text" })).toEqual({
      target: "authoring",
      operations: [{ op: "add", path: "/description", value: "Text" }]
    });
    expect(reverseProjectIntent(snapshot, { type: "setValue", pointer: "/missing/value", value: 1 }).target).toBe(
      "rejected"
    );
  });

  it("turns node movement into a layout-only JSON Patch", () => {
    const store = createDocumentStore({ filePath: "doc.json", text: "{\"nodes\":[{\"id\":\"a\"}]}" });
    const result = reverseProjectIntent(store.snapshot(), {
      type: "moveNode",
      pointer: "/nodes/0",
      position: { x: 12, y: 34 }
    });

    expect(result).toEqual({
      target: "layout",
      operations: [
        {
          op: "add",
          path: "/nodes/~1nodes~10/position",
          value: { x: 12, y: 34 }
        }
      ]
    });
    expect(store.snapshot().json).toEqual({ nodes: [{ id: "a" }] });
  });

  it("adds and removes array and object collection items safely", () => {
    const snapshot = createDocumentStore({
      filePath: "collections.json",
      text: JSON.stringify({ list: [{ id: "a" }], map: { one: { id: "b" } } })
    }).snapshot();

    const addArray = reverseProjectIntent(snapshot, {
      type: "addCollectionItem",
      collectionPointer: "/list",
      value: { id: "c" }
    });
    expect(addArray).toEqual({
      target: "authoring",
      operations: [{ op: "add", path: "/list/-", value: { id: "c" } }]
    });
    expect(applyJsonPatch(snapshot.json as JsonValue, addArray.operations)).toEqual({
      list: [{ id: "a" }, { id: "c" }],
      map: { one: { id: "b" } }
    });

    const addObject = reverseProjectIntent(snapshot, {
      type: "addCollectionItem",
      collectionPointer: "/map",
      key: "two",
      value: { id: "d" }
    });
    expect(addObject).toEqual({
      target: "authoring",
      operations: [{ op: "add", path: "/map/two", value: { id: "d" } }]
    });

    expect(reverseProjectIntent(snapshot, { type: "removeCollectionItem", itemPointer: "/list/0" })).toEqual({
      target: "authoring",
      operations: [{ op: "remove", path: "/list/0" }]
    });
    expect(reverseProjectIntent(snapshot, { type: "removeCollectionItem", itemPointer: "" }).target).toBe("rejected");
    expect(
      reverseProjectIntent(snapshot, {
        type: "addCollectionItem",
        collectionPointer: "/list",
        key: "bad",
        value: null
      }).target
    ).toBe("rejected");
  });

  it("connects and disconnects local reference fields safely", () => {
    const snapshot = createDocumentStore({
      filePath: "refs.json",
      text: JSON.stringify({
        nodes: [{ id: "a" }, { id: "b" }],
        links: { next: null, stale: "#/nodes/0", external: "remote.json#/node", bad: 5 }
      })
    }).snapshot();

    expect(
      reverseProjectIntent(snapshot, {
        type: "connectReference",
        referencePointer: "/links/next",
        targetPointer: "/nodes/1"
      })
    ).toEqual({
      target: "authoring",
      operations: [{ op: "replace", path: "/links/next", value: "#/nodes/1" }]
    });
    expect(
      reverseProjectIntent(snapshot, {
        type: "connectReference",
        referencePointer: "/links/new",
        targetPointer: "/nodes/0"
      })
    ).toEqual({
      target: "authoring",
      operations: [{ op: "add", path: "/links/new", value: "#/nodes/0" }]
    });
    expect(
      reverseProjectIntent(snapshot, {
        type: "disconnectReference",
        referencePointer: "/links/stale",
        expectedTargetPointer: "/nodes/0"
      })
    ).toEqual({
      target: "authoring",
      operations: [{ op: "remove", path: "/links/stale" }]
    });
    expect(
      reverseProjectIntent(snapshot, {
        type: "connectReference",
        referencePointer: "/links/bad",
        targetPointer: "/nodes/0"
      }).target
    ).toBe("rejected");
    expect(
      reverseProjectIntent(snapshot, {
        type: "connectReference",
        referencePointer: "/links/missing",
        targetPointer: "/nodes/3"
      }).target
    ).toBe("rejected");
    expect(
      reverseProjectIntent(snapshot, {
        type: "disconnectReference",
        referencePointer: "/links/external"
      }).target
    ).toBe("rejected");
  });
});

const collectionSchema: JsonSchema = {
  $id: "schema:shape",
  type: "object",
  required: ["nodes"],
  additionalProperties: false,
  properties: {
    nodes: {
      type: "array",
      items: {
        type: "object",
        required: ["id"],
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          amount: { type: "number" }
        }
      }
    }
  }
};

function summarizeInvariantShape(collectionName: string): {
  readonly semanticPointers: number;
  readonly projectionRoles: readonly string[];
  readonly reverseTarget: string;
} {
  const store = createDocumentStore({
    filePath: `${collectionName}.json`,
    text: JSON.stringify({
      [collectionName]: [{ id: "dup" }, { id: "dup" }],
      link: { $ref: `#/${collectionName}/9` }
    })
  });
  const snapshot = store.snapshot();

  return {
    semanticPointers: validateDocument(snapshot).length,
    projectionRoles: [...new Set(buildAuthoringGraphProjection(snapshot).nodes.map((node) => node.role))].sort(),
    reverseTarget: reverseProjectIntent(snapshot, {
      type: "addCollectionItem",
      collectionPointer: `/${collectionName}`,
      value: { id: "new" }
    }).target
  };
}

function previewEntity(
  entityId: string,
  authoringPointer: string,
  bounds: PreviewEntityDescriptor["bounds"],
  overrides: Partial<PreviewEntityDescriptor> = {}
): PreviewEntityDescriptor {
  return {
    entityId,
    authoringPointer,
    label: entityId,
    semanticRole: "ui-component",
    bounds,
    visible: true,
    ...overrides
  };
}

function rangeForFragment(text: string, fragment: string, occurrence = 0): TextRange {
  let offset = -1;
  let from = 0;

  for (let count = 0; count <= occurrence; count += 1) {
    offset = text.indexOf(fragment, from);
    if (offset === -1) {
      throw new Error(`Fragment not found: ${fragment}`);
    }

    from = offset + fragment.length;
  }

  return rangeForOffsets(text, offset, offset + fragment.length);
}

function rangeForOffsets(text: string, start: number, end: number): TextRange {
  const lineStarts = [0];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }

  return {
    start: positionForOffset(lineStarts, start),
    end: positionForOffset(lineStarts, end)
  };
}

function positionForOffset(lineStarts: readonly number[], offset: number): {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
} {
  let lineIndex = 0;

  for (let index = 0; index < lineStarts.length; index += 1) {
    if ((lineStarts[index] as number) > offset) {
      break;
    }

    lineIndex = index;
  }

  return {
    line: lineIndex + 1,
    column: offset - (lineStarts[lineIndex] as number) + 1,
    offset
  };
}
