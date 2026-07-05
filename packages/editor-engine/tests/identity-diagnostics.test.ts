/**
 * Identity-discipline diagnostics (ADR-057 §4.2; editor-preview-first-ux §2.1;
 * design-spec §4).
 *
 * These cover the two declarative признака introduced in Phase 1.5:
 *   - `entity-missing-view` (warning): a GAME entity whose type declares the
 *     authoring flag `_requiresView` (for the active channel) has no `view`
 *     facet resolving there. Non-visual types (no `_requiresView`) are clean.
 *   - `entity-view-orphan` (warning): a UI element that is neither declared
 *     `_decorative` nor references any game entity id.
 *
 * Both признака are read DECLARATIVELY from the authoring nodes; the engine
 * never hardcodes a list of types (ADR-057 §5). Fixtures are game-agnostic.
 */
import { describe, expect, it } from "vitest";
import { buildEditorEntityProjection } from "../src/index.ts";
import type { EditorEntityProjectionDiagnostic, JsonValue } from "../src/index.ts";

/** Filters a projection's diagnostics down to one identity-discipline code. */
function diagnosticsWithCode(
  diagnostics: readonly EditorEntityProjectionDiagnostic[],
  code: "entity-view-orphan" | "entity-missing-view"
): readonly EditorEntityProjectionDiagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.code === code);
}

/** A UI-only document with a single screen whose root is one component. */
function uiWithRootComponent(component: JsonValue): JsonValue {
  return {
    _schemaVersion: "2.0",
    _manifestType: "ui",
    _channel: "web",
    root: {
      _type: "ui.Manifest",
      _label: "Fixture UI",
      screens: [
        {
          id: "screen-1",
          _type: "ui.Screen",
          _label: "Screen 1",
          root: component
        }
      ]
    }
  } satisfies JsonValue;
}

describe("entity-view-orphan (ADR-057 §4.2)", () => {
  it("(a) does NOT flag a decorative UI element without a game reference", () => {
    const ui = uiWithRootComponent({
      id: "decor-1",
      _type: "ui.Component",
      _label: "Decorative divider",
      _decorative: true,
      type: "dividerComponent",
      props: { cssClass: "divider" }
    });

    const projection = buildEditorEntityProjection({
      documents: [{ filePath: "ui/web.authoring.json", json: ui }]
    });

    expect(diagnosticsWithCode(projection.diagnostics, "entity-view-orphan")).toEqual([]);
  });

  it("(b) flags a non-decorative UI element with no game reference", () => {
    const ui = uiWithRootComponent({
      id: "decor-1",
      _type: "ui.Component",
      _label: "Lonely divider",
      type: "dividerComponent",
      props: { cssClass: "divider" }
    });

    const projection = buildEditorEntityProjection({
      documents: [{ filePath: "ui/web.authoring.json", json: ui }]
    });

    const orphans = diagnosticsWithCode(projection.diagnostics, "entity-view-orphan");
    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toMatchObject({
      severity: "warning",
      code: "entity-view-orphan",
      source: { pointer: "/root/screens/0/root", documentKind: "ui" }
    });
  });

  it("does NOT flag a UI element bound to a game entity by matching id", () => {
    const game = {
      _manifestType: "game",
      root: {
        _type: "game.Game",
        _label: "Metric Fixture",
        state: { public: { metrics: { score: 0 } } },
        logic: { flows: [], actions: [] }
      }
    } satisfies JsonValue;
    const ui = uiWithRootComponent({
      id: "score",
      _type: "ui.Component",
      _label: "Score readout",
      type: "gameVariableComponent",
      props: { caption: "Score" }
    });

    const projection = buildEditorEntityProjection({
      documents: [
        { filePath: "game.authoring.json", json: game },
        { filePath: "ui/web.authoring.json", json: ui }
      ]
    });

    expect(diagnosticsWithCode(projection.diagnostics, "entity-view-orphan")).toEqual([]);
  });
});

describe("entity-missing-view (ADR-057 §4.2)", () => {
  /** A game document with one step; `requiresView`/`screenId` are configurable. */
  function gameWithStep(step: Record<string, JsonValue>): JsonValue {
    return {
      _manifestType: "game",
      root: {
        _type: "game.Game",
        _label: "Step Fixture",
        logic: {
          flows: [
            { id: "main", _type: "game.Flow", _label: "Main", steps: [{ id: "s1", _type: "game.Step", _label: "Step 1", ...step }] }
          ],
          actions: []
        }
      }
    } satisfies JsonValue;
  }

  it("(c) flags a view-requiring type with no view facet in the active channel", () => {
    const projection = buildEditorEntityProjection({
      documents: [{ filePath: "game.authoring.json", json: gameWithStep({ _requiresView: true }) }],
      activeChannel: "web"
    });

    const missing = diagnosticsWithCode(projection.diagnostics, "entity-missing-view");
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({
      severity: "warning",
      code: "entity-missing-view",
      source: { pointer: "/root/logic/flows/0/steps/0", documentKind: "game" }
    });
  });

  it("(d) is clean for a non-visual type (no _requiresView) without a view", () => {
    const projection = buildEditorEntityProjection({
      documents: [{ filePath: "game.authoring.json", json: gameWithStep({}) }],
      activeChannel: "web"
    });

    expect(diagnosticsWithCode(projection.diagnostics, "entity-missing-view")).toEqual([]);
  });

  it("(e) is per-channel: view exists in web, missing only in telegram", () => {
    const game = gameWithStep({ _requiresView: { channels: ["web", "telegram"] }, screenId: "screen-1" });
    const webUi = {
      _schemaVersion: "2.0",
      _manifestType: "ui",
      _channel: "web",
      // Screen has no child component, so the web view facet comes purely from the
      // screen link and there is no UI element to raise an orphan warning.
      root: { _type: "ui.Manifest", _label: "Web UI", screens: [{ id: "screen-1", _type: "ui.Screen", _label: "Screen 1" }] }
    } satisfies JsonValue;

    const documents = [
      { filePath: "game.authoring.json", json: game },
      { filePath: "ui/web.authoring.json", json: webUi }
    ];

    const webProjection = buildEditorEntityProjection({ documents, activeChannel: "web" });
    expect(diagnosticsWithCode(webProjection.diagnostics, "entity-missing-view")).toEqual([]);

    const telegramProjection = buildEditorEntityProjection({ documents, activeChannel: "telegram" });
    const missing = diagnosticsWithCode(telegramProjection.diagnostics, "entity-missing-view");
    expect(missing).toHaveLength(1);
    expect(missing[0]?.source.pointer).toBe("/root/logic/flows/0/steps/0");
  });
});
