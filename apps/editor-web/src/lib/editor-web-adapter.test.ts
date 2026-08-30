import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyJsonPatch,
  createSchemaRegistry,
  reviveEditorEntityProjection,
  serializeEditorEntityProjection,
  type JsonPatchOperation,
  type JsonValue
} from "@cubica/editor-engine";

import { embeddedAuthoringSample } from "./authoring-sample";
import { registerLocalAuthoringSchemas, gameAuthoringSchemaId, uiAuthoringSchemaId } from "./editor-json-schema";
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
    expect(viewModel.editorEntityProjection.entities.length).toBeGreaterThan(0);
  });

  it("exposes the ADR-052 editor entity projection across active game and UI documents", () => {
    const gameAuthoring = {
      _manifestType: "game",
      root: {
        _type: "game.Game",
        _label: "Projection Game",
        logic: {
          flows: [
            {
              id: "main",
              steps: [
                {
                  id: "main.start",
                  _type: "game.Step",
                  _label: "Start",
                  screenId: "intro",
                  actionIds: ["choice.accept"]
                }
              ]
            }
          ],
          actions: [{ id: "choice.accept", _type: "game.Action", _label: "Accept" }]
        }
      }
    } as const;
    const uiAuthoring = {
      _manifestType: "ui",
      _channel: "web",
      root: {
        _type: "ui.Manifest",
        _label: "Projection UI",
        screens: [
          {
            id: "intro",
            _type: "ui.Screen",
            _label: "Intro screen",
            root: {
              _type: "ui.Component",
              _label: "Button",
              type: "buttonComponent",
              actions: { onClick: { payload: { actionId: "choice.accept" } } }
            }
          }
        ]
      }
    } as const;

    const viewModel = createEditorViewModel(JSON.stringify(gameAuthoring), {
      filePath: "game.authoring.json",
      gameId: "projection-game",
      editorEntityProjectionDocuments: [{ filePath: "ui/web.authoring.json", json: uiAuthoring }]
    });

    const step = viewModel.editorEntityProjection.entityById.get("game-step:main.start");
    expect(step?.facets.view?.map((source) => `${source.filePath}#${source.pointer}`)).toContain(
      "ui/web.authoring.json#/root/screens/0"
    );
    expect(viewModel.editorEntityProjection.entityById.get("game-action:choice.accept")?.facets.view).toHaveLength(1);
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
    const pointer = "/root/meta";
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

  it("accepts element prompts in local game and UI authoring schemas", () => {
    const registry = createSchemaRegistry();
    registerLocalAuthoringSchemas(registry);

    const cases = [
      {
        schemaId: gameAuthoringSchemaId,
        filePath: "game.authoring.json",
        promptOwnerPointer: "/root/logic/actions/0",
        promptStatusPointer: "/root/logic/actions/0/_prompt/status",
        document: {
          $schema: gameAuthoringSchemaId,
          _schemaVersion: "2.0",
          _manifestType: "game",
          _definitions: {
            "game.PromptedActionPrototype": {
              _semantics: "Reusable prototype that proves prompt templates are valid in game authoring.",
              _promptTemplate: {
                raw: "Describe the player choice, state changes and methodology.",
                language: "en",
                appliesTo: "game.PromptedActionPrototype"
              }
            }
          },
          root: {
            _type: "game.Game",
            _label: "Prompted Game",
            meta: {
              id: "prompted-game",
              version: "1.0.0",
              name: "Prompted Game",
              description: "Fixture that validates element prompt fields.",
              schemaVersion: "1.1"
            },
            config: {},
            logic: {
              actions: [
                {
                  id: "choice.accept",
                  _type: "game.Action",
                  _label: "Accept choice",
                  _prompt: {
                    status: "confirmed",
                    raw: "The player accepts a generic choice and receives one score point.",
                    normalized: "Create a generic accept-choice action that adds one score point.",
                    source: "user",
                    language: "en",
                    updatedAt: "2026-06-12T00:00:00Z"
                  },
                  binding: {
                    kind: "mechanics-plan",
                    planRef: "choice.accept"
                  }
                }
              ]
            },
            mechanics: {
              apiVersion: "cubica.dev/mechanics/v1alpha1",
              budgetProfile: "turn-based-standard-v1",
              moduleLock: {
                "cubica.core": {
                  moduleId: "cubica.core",
                  moduleVersion: "1.0.0",
                  artifactHash: "sha256:903e9660e0702a0bffca5465bfb3742f7f8a80b0adae45f93b77637bf2f8770b"
                }
              },
              stateModel: {
                types: {
                  "core.boolean": { kind: "boolean" }
                },
                endpoints: {},
                collections: {},
                events: {}
              },
              plans: {
                "choice.accept": {
                  transaction: {
                    steps: [
                      {
                        id: "precondition",
                        kind: "assert",
                        op: "core.assert",
                        predicate: { op: "predicate.constant", value: true },
                        errorCode: "ACTION_PRECONDITION_FAILED"
                      }
                    ]
                  }
                }
              }
            },
            state: {
              public: {}
            }
          }
        }
      },
      {
        schemaId: uiAuthoringSchemaId,
        filePath: "ui/web.authoring.json",
        promptOwnerPointer: "/root/screens/0/root",
        promptStatusPointer: "/root/screens/0/root/_prompt/status",
        document: {
          $schema: uiAuthoringSchemaId,
          _schemaVersion: "2.0",
          _manifestType: "ui",
          _channel: "web",
          _definitions: {
            "ui.PromptedButtonPrototype": {
              _semantics: "Reusable prototype that proves prompt templates are valid in UI authoring.",
              _promptTemplate: {
                raw: "Describe button text, onClick action and expected player result.",
                language: "en",
                appliesTo: "ui.PromptedButtonPrototype"
              }
            }
          },
          root: {
            _type: "ui.Manifest",
            _label: "Prompted UI",
            meta: {
              id: "prompted-game.ui.web",
              version: "1.0.0",
              game_id: "prompted-game"
            },
            entry_point: "intro",
            screens: [
              {
                id: "intro",
                _type: "ui.Screen",
                _label: "Intro",
                root: {
                  id: "intro.accept",
                  _type: "ui.Component",
                  _label: "Accept button",
                  _prompt: {
                    status: "confirmed",
                    raw: "Show a button that sends the choice.accept action.",
                    normalized: "Create a button that sends the runtime action choice.accept.",
                    source: "user",
                    language: "en",
                    updatedAt: "2026-06-12T00:00:00Z"
                  },
                  type: "buttonComponent",
                  actions: {
                    onClick: {
                      command: "requestServer",
                      payload: {
                        actionId: "choice.accept"
                      }
                    }
                  }
                }
              }
            ]
          }
        }
      }
    ] as const;

    for (const item of cases) {
      const viewModel = createEditorViewModel(JSON.stringify(item.document), {
        filePath: item.filePath,
        schemaRegistry: registry,
        schemaId: item.schemaId
      });
      const promptProperty = selectProperties(viewModel.snapshot, item.promptOwnerPointer).find(
        (property) => property.label === "_prompt"
      );

      expect(viewModel.diagnostics.filter((diagnostic) => diagnostic.source === "schema")).toEqual([]);
      expect(viewModel.jsonTree.nodeByPointer.get(item.promptStatusPointer)).toBeDefined();
      expect(promptProperty).toMatchObject({ label: "_prompt", editable: true, valueType: "object" });
    }
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

/**
 * Incremental entity-projection wiring (ADR-057 §4.13, Phase 2.1) exercised at
 * the adapter surface. The equivalence gate mirrors
 * `packages/editor-engine/tests/incremental-projection.test.ts` but through
 * `createEditorViewModel`: an incremental build must produce the SAME
 * `editorEntityProjection` as a full rebuild of the same text, and a build with
 * no `incremental` context (the controller's fallback when no previous state
 * exists yet) must behave exactly as before.
 */
describe("editor web adapter — incremental entity projection", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  const antarcticaGamePath = "games/antarctica/authoring/game.authoring.json";
  const baseText = fs.readFileSync(path.join(repoRoot, antarcticaGamePath), "utf8");

  /** Applies JSON Patch to `baseText` and returns the pretty-printed next text. */
  function patchedText(operations: readonly JsonPatchOperation[]): string {
    const nextJson = applyJsonPatch(JSON.parse(baseText) as JsonValue, operations);
    return `${JSON.stringify(nextJson, null, 2)}\n`;
  }

  it("takes the incremental fast path for a scalar _label edit and equals a full rebuild", () => {
    const baseline = createEditorViewModel(baseText, { filePath: antarcticaGamePath });
    const nextText = patchedText([{ op: "replace", path: "/root/_label", value: "Антарктида (ред.)" }]);

    const incrementalView = createEditorViewModel(nextText, {
      filePath: antarcticaGamePath,
      incremental: {
        previousState: baseline.projectionState,
        changedPointersByFile: { [antarcticaGamePath]: ["/root/_label"] }
      }
    });
    const fullView = createEditorViewModel(nextText, { filePath: antarcticaGamePath });

    // The projection is deeply equal to a full rebuild (the main correctness gate).
    expect(incrementalView.editorEntityProjection).toEqual(fullView.editorEntityProjection);
    expect(incrementalView.incrementalReport?.mode).toBe("incremental");
    expect(incrementalView.incrementalReport?.reusedEntityCount).toBeGreaterThan(0);
    expect(incrementalView.incrementalReport?.rebuiltEntityIds.length).toBeGreaterThan(0);
  });

  it("falls back to a full rebuild for a structural edit but stays equal to a full rebuild", () => {
    const baseline = createEditorViewModel(baseText, { filePath: antarcticaGamePath });
    const nextText = patchedText([
      { op: "add", path: "/root/logic/actions/0/note", value: "structural add" }
    ]);

    const incrementalView = createEditorViewModel(nextText, {
      filePath: antarcticaGamePath,
      incremental: {
        previousState: baseline.projectionState,
        changedPointersByFile: { [antarcticaGamePath]: ["/root/logic/actions/0/note"] }
      }
    });
    const fullView = createEditorViewModel(nextText, { filePath: antarcticaGamePath });

    expect(incrementalView.editorEntityProjection).toEqual(fullView.editorEntityProjection);
    expect(incrementalView.incrementalReport?.mode).toBe("full");
  });

  it("without an incremental context builds from scratch (no previous state) and matches the incremental result", () => {
    const baseline = createEditorViewModel(baseText, { filePath: antarcticaGamePath });
    const nextText = patchedText([{ op: "replace", path: "/root/logic/actions/0/_label", value: "Действие (ред.)" }]);

    // The controller passes no `incremental` option when it has no previous state.
    const fallbackView = createEditorViewModel(nextText, { filePath: antarcticaGamePath });
    expect(fallbackView.incrementalReport).toBeUndefined();

    const incrementalView = createEditorViewModel(nextText, {
      filePath: antarcticaGamePath,
      incremental: {
        previousState: baseline.projectionState,
        changedPointersByFile: { [antarcticaGamePath]: ["/root/logic/actions/0/_label"] }
      }
    });

    expect(incrementalView.editorEntityProjection).toEqual(fallbackView.editorEntityProjection);
    expect(incrementalView.incrementalReport?.mode).toBe("incremental");
    // The returned state can seed a further incremental step.
    expect(incrementalView.projectionState.projection).toBe(incrementalView.editorEntityProjection);
  });

  /**
   * Warm-start hydration (option a, Phase 2.2b): a projection revived from the
   * disk cache is substituted AS-IS, equals a fresh build of the same text, and
   * seeds a subsequent incremental edit — proving the hydrated state is a valid
   * `previousState` for `updateEditorEntityProjection`.
   */
  it("substitutes a hydrated projection as-is and equals a fresh build", () => {
    const fresh = createEditorViewModel(baseText, { filePath: antarcticaGamePath });
    // Round-trip the projection through the disk-cache serialization, as the
    // server ships it and the client revives it.
    const revived = reviveEditorEntityProjection(
      JSON.parse(JSON.stringify(serializeEditorEntityProjection(fresh.editorEntityProjection)))
    );
    expect(revived).not.toBeNull();

    const hydratedView = createEditorViewModel(baseText, {
      filePath: antarcticaGamePath,
      hydratedProjection: revived ?? undefined
    });

    // The projection is taken as-is (same object reference), no rebuild/update.
    expect(hydratedView.editorEntityProjection).toBe(revived);
    expect(hydratedView.incrementalReport).toBeUndefined();
    expect(hydratedView.editorEntityProjection).toEqual(fresh.editorEntityProjection);
    expect(hydratedView.projectionState.projection).toBe(revived);
  });

  it("lets a hydrated projection seed a subsequent incremental edit", () => {
    const fresh = createEditorViewModel(baseText, { filePath: antarcticaGamePath });
    const revived = reviveEditorEntityProjection(
      JSON.parse(JSON.stringify(serializeEditorEntityProjection(fresh.editorEntityProjection)))
    );
    const hydratedView = createEditorViewModel(baseText, {
      filePath: antarcticaGamePath,
      hydratedProjection: revived ?? undefined
    });

    const nextText = patchedText([{ op: "replace", path: "/root/_label", value: "Антарктида (тёплый старт)" }]);
    const afterEdit = createEditorViewModel(nextText, {
      filePath: antarcticaGamePath,
      incremental: {
        previousState: hydratedView.projectionState,
        changedPointersByFile: { [antarcticaGamePath]: ["/root/_label"] }
      }
    });
    const fullRebuild = createEditorViewModel(nextText, { filePath: antarcticaGamePath });

    // The edit after hydration takes the incremental path and equals a full rebuild.
    expect(afterEdit.incrementalReport?.mode).toBe("incremental");
    expect(afterEdit.editorEntityProjection).toEqual(fullRebuild.editorEntityProjection);
  });
});
