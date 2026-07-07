/**
 * Tests for `buildEntityGroupingTreeViewModel` — the grouping-aware entity tree
 * ("По экранам" / "По типам") over the project-level `EditorEntityProjection`
 * (ADR-057 §4.6, editor-preview-first-ux §7).
 *
 * Coverage:
 * - a NEUTRAL game+ui fixture that exercises every documented feature (screen
 *   outliner, "Логика экрана", type inventory, prototype labels, occurrences,
 *   decorative marking, breadcrumbs, empty/edge cases, order determinism);
 * - the REAL antarctica web authoring (scale + determinism + the invariant "one
 *   primary node per entity").
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildEditorEntityProjection, buildEntityGroupingTreeViewModel } from "../src/index.ts";
import type { EditorEntityProjection, EditorEntityProjectionDocument, JsonValue, TreeViewNode } from "../src/types.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..", "..");

function loadJson(relativePath: string): JsonValue {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8")) as JsonValue;
}

/** Pre-order collection of every node carrying a matching predicate. */
function flatFilter(nodes: readonly TreeViewNode[], predicate: (node: TreeViewNode) => boolean): TreeViewNode[] {
  return nodes.filter(predicate);
}

// ---------------------------------------------------------------------------
// Neutral fixture: a two-document game+ui project with cross-references.
// ---------------------------------------------------------------------------

function neutralDocuments(): readonly EditorEntityProjectionDocument[] {
  const game: JsonValue = {
    _manifestType: "game",
    root: {
      _type: "game.Manifest",
      id: "neutral",
      _label: "Нейтральная игра",
      content: { data: { infos: [{ id: "intro-info", _type: "game.Content", _label: "Интро", body: "текст" }] } },
      state: { public: { metrics: { score: 0 } } },
      logic: {
        flows: [
          {
            id: "main",
            _type: "game.Flow",
            _label: "Основной поток",
            steps: [{ id: "s1", _type: "game.Step", _label: "Шаг 1", screenId: "home", actionIds: ["accept"] }]
          }
        ],
        actions: [
          { id: "accept", _type: "game.Action", _label: "Принять" },
          // Non-visual entity with NO screen binding and NO UI reference (edge case).
          { id: "hidden", _type: "game.Action", _label: "Скрытое правило" }
        ]
      }
    }
  };

  const ui: JsonValue = {
    _manifestType: "ui",
    _channel: "web",
    // A reusable prototype declaration; its `_label` becomes the type header label.
    _definitions: { cardComponent: { _label: "Карточка выбора", type: "cardComponent" } },
    root: {
      _type: "ui.Manifest",
      _label: "Веб-интерфейс",
      screens: [
        {
          id: "home",
          _type: "ui.Screen",
          _label: "Экран Дом",
          root: {
            id: "home-area",
            _type: "ui.Component",
            type: "areaComponent",
            _label: "Область дома",
            children: [
              {
                id: "home-card",
                _type: "cardComponent",
                _label: "Карточка Дом",
                children: [
                  {
                    id: "accept-btn",
                    _type: "buttonComponent",
                    _label: "Кнопка Принять",
                    actions: { onClick: { payload: { actionId: "accept" } } }
                  },
                  { id: "home-title", _type: "textComponent", _label: "Заголовок", _decorative: true }
                ]
              }
            ]
          }
        },
        {
          id: "route",
          _type: "ui.Screen",
          _label: "Экран Маршрут",
          root: {
            id: "route-area",
            _type: "ui.Component",
            type: "areaComponent",
            _label: "Область маршрута",
            children: [
              {
                id: "route-btn",
                _type: "buttonComponent",
                _label: "Кнопка Маршрут",
                actions: { onClick: { payload: { actionId: "accept" } } }
              }
            ]
          }
        }
      ]
    }
  };

  return [
    { filePath: "game.authoring.json", json: game },
    { filePath: "ui/web.authoring.json", json: ui }
  ];
}

function neutralProjection(activeChannel = "web"): {
  projection: EditorEntityProjection;
  documents: readonly EditorEntityProjectionDocument[];
} {
  const documents = neutralDocuments();
  const projection = buildEditorEntityProjection({ gameId: "neutral", documents, activeChannel });
  return { projection, documents };
}

// ---------------------------------------------------------------------------
// "По экранам" (byScreen).
// ---------------------------------------------------------------------------

describe("buildEntityGroupingTreeViewModel — byScreen (outliner)", () => {
  it("top level is every screen of the active channel, in document order", () => {
    const { projection, documents } = neutralProjection();
    const model = buildEntityGroupingTreeViewModel({ projection, documents, grouping: "byScreen", activeChannel: "web" });

    expect(model.root.children.map((node) => node.label)).toEqual(["Экран Дом", "Экран Маршрут"]);
    for (const screen of model.root.children) {
      expect(screen.entityKind).toBe("ui-screen");
      expect(screen.entityId).toBeDefined();
    }
  });

  it("flags the active screen for auto-reveal (first by default, else the requested one)", () => {
    const { projection, documents } = neutralProjection();

    const defaulted = buildEntityGroupingTreeViewModel({ projection, documents, grouping: "byScreen", activeChannel: "web" });
    expect(defaulted.root.children.map((node) => node.isActiveContext)).toEqual([true, undefined]);

    const routeId = projection.entities.find((entity) => entity.kind === "ui-screen" && entity.label === "Экран Маршрут")?.entityId;
    const explicit = buildEntityGroupingTreeViewModel({
      projection,
      documents,
      grouping: "byScreen",
      activeChannel: "web",
      activeScreenEntityId: routeId
    });
    expect(explicit.root.children.map((node) => node.isActiveContext)).toEqual([undefined, true]);
  });

  it("nests UI components exactly as the display and marks decorative elements", () => {
    const { projection, documents } = neutralProjection();
    const model = buildEntityGroupingTreeViewModel({ projection, documents, grouping: "byScreen", activeChannel: "web" });

    // home > area > card > [button, title]
    const home = model.root.children[0];
    const area = home.children.find((node) => node.label === "Область дома");
    expect(area).toBeDefined();
    const card = area?.children.find((node) => node.label === "Карточка Дом");
    expect(card).toBeDefined();
    const title = card?.children.find((node) => node.label === "Заголовок");
    expect(title?.isDecorative).toBe(true);
  });

  it("carries the referenced GAME entity id on a UI node that references one", () => {
    const { projection, documents } = neutralProjection();
    const model = buildEntityGroupingTreeViewModel({ projection, documents, grouping: "byScreen", activeChannel: "web" });

    const acceptButton = model.flatNodes.find((node) => node.label === "Кнопка Принять");
    expect(acceptButton?.entityId).toBe("game-action:accept");
    expect(acceptButton?.entityKind).toBe("ui-component");
  });

  it("puts non-visual entities bound to a screen into a collapsed 'Логика экрана' subgroup", () => {
    const { projection, documents } = neutralProjection();
    const model = buildEntityGroupingTreeViewModel({ projection, documents, grouping: "byScreen", activeChannel: "web" });

    const home = model.root.children[0];
    const logic = home.children.find((node) => node.groupingRole === "screen-logic");
    expect(logic).toBeDefined();
    expect(logic?.isNonVisual).toBe(true);
    const stepNode = logic?.children.find((node) => node.entityId === "game-step:s1");
    expect(stepNode).toBeDefined();
    expect(stepNode?.isNonVisual).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// "По типам" (byType).
// ---------------------------------------------------------------------------

describe("buildEntityGroupingTreeViewModel — byType (inventory)", () => {
  it("top level is prototype/type headers with the definition label and prototype role", () => {
    const { projection, documents } = neutralProjection();
    const model = buildEntityGroupingTreeViewModel({ projection, documents, grouping: "byType", activeChannel: "web" });

    for (const header of model.root.children) {
      expect(header.groupingRole).toBe("prototype");
      expect(header.entityId).toBeUndefined();
    }
    const cardHeader = model.root.children.find((node) => node.label === "Карточка выбора");
    expect(cardHeader).toBeDefined();
    expect(cardHeader?.isNonVisual).toBeUndefined();
    expect(cardHeader?.children).toHaveLength(1);
  });

  it("lists instances under their prototype with a location breadcrumb", () => {
    const { projection, documents } = neutralProjection();
    const model = buildEntityGroupingTreeViewModel({ projection, documents, grouping: "byType", activeChannel: "web" });

    const cardHeader = model.root.children.find((node) => node.label === "Карточка выбора");
    const instance = cardHeader?.children[0];
    expect(instance?.entityId).toBe("ui-component:home-card");
    expect(instance?.occurrenceKind).toBe("primary");
    // Container ancestors, outermost first: screen then the named area.
    expect(instance?.locationBreadcrumb).toEqual(["Экран Дом", "Область дома"]);
  });

  it("marks nested foreign instances inside an expansion as occurrences", () => {
    const { projection, documents } = neutralProjection();
    const model = buildEntityGroupingTreeViewModel({ projection, documents, grouping: "byType", activeChannel: "web" });

    const cardHeader = model.root.children.find((node) => node.label === "Карточка выбора");
    const instance = cardHeader?.children[0];
    const nestedButton = instance?.children.find((node) => node.entityId === "ui-component:accept-btn");
    expect(nestedButton?.occurrenceKind).toBe("occurrence");
    // Its canonical primary lives under the buttonComponent header.
    const buttonHeader = model.root.children.find((node) => node.label === "buttonComponent");
    const buttonPrimary = buttonHeader?.children.find((node) => node.entityId === "ui-component:accept-btn");
    expect(buttonPrimary?.occurrenceKind).toBe("primary");
  });

  it("includes non-visual types alongside visual ones", () => {
    const { projection, documents } = neutralProjection();
    const model = buildEntityGroupingTreeViewModel({ projection, documents, grouping: "byType", activeChannel: "web" });

    const actionHeader = model.root.children.find((node) => node.label === "Action");
    expect(actionHeader?.isNonVisual).toBe(true);
    expect(actionHeader?.children.some((node) => node.entityId === "game-action:accept")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Occurrences ("вхождения").
// ---------------------------------------------------------------------------

describe("buildEntityGroupingTreeViewModel — occurrences", () => {
  it("byScreen: an entity referenced in several places has one primary, the rest occurrences", () => {
    const { projection, documents } = neutralProjection();
    const model = buildEntityGroupingTreeViewModel({ projection, documents, grouping: "byScreen", activeChannel: "web" });

    // "accept" surfaces on two buttons (home + route) and in the screens' logic.
    const acceptNodes = model.nodesByEntityId.get("game-action:accept") ?? [];
    expect(acceptNodes.length).toBeGreaterThanOrEqual(2);
    const primaries = acceptNodes.filter((node) => node.occurrenceKind === "primary");
    expect(primaries).toHaveLength(1);
    // Selecting by entity id finds every occurrence, and each has a distinct node id.
    expect(new Set(acceptNodes.map((node) => node.id)).size).toBe(acceptNodes.length);
    // The primary is the first appearance in pre-order (the home button).
    expect(primaries[0].pointer).toBe("/root/screens/0/root/children/0/children/0");
  });

  it("byType: every entity has exactly one primary node; nodeByPointer prefers it", () => {
    const { projection, documents } = neutralProjection();
    const model = buildEntityGroupingTreeViewModel({ projection, documents, grouping: "byType", activeChannel: "web" });

    const buttonNodes = model.nodesByEntityId.get("ui-component:accept-btn") ?? [];
    expect(buttonNodes.length).toBeGreaterThanOrEqual(2);
    expect(buttonNodes.filter((node) => node.occurrenceKind === "primary")).toHaveLength(1);

    const byPointer = model.nodeByPointer.get("/root/screens/0/root/children/0/children/0");
    expect(byPointer?.occurrenceKind).toBe("primary");
  });
});

// ---------------------------------------------------------------------------
// Empty / edge cases (design-spec §3.1, task §5).
// ---------------------------------------------------------------------------

describe("buildEntityGroupingTreeViewModel — empty and edge cases", () => {
  it("byScreen with no screens in the active channel yields an empty top level", () => {
    const { projection, documents } = neutralProjection();
    const model = buildEntityGroupingTreeViewModel({ projection, documents, grouping: "byScreen", activeChannel: "telegram" });
    expect(model.root.children).toHaveLength(0);
    expect(model.nodesByEntityId.size).toBe(0);
  });

  it("byType reaches an entity with no declared prototype (a bare metric)", () => {
    const { projection, documents } = neutralProjection();
    const model = buildEntityGroupingTreeViewModel({ projection, documents, grouping: "byType", activeChannel: "web" });

    const metricHeader = model.root.children.find((node) => node.label === "Metric");
    expect(metricHeader?.isNonVisual).toBe(true);
    expect(metricHeader?.children.some((node) => node.entityId === "metric:score")).toBe(true);
  });

  it("byType reaches a non-visual entity with no screen binding, and byScreen never surfaces it", () => {
    const { projection, documents } = neutralProjection();
    const byType = buildEntityGroupingTreeViewModel({ projection, documents, grouping: "byType", activeChannel: "web" });
    const byScreen = buildEntityGroupingTreeViewModel({ projection, documents, grouping: "byScreen", activeChannel: "web" });

    expect(byType.nodesByEntityId.has("game-action:hidden")).toBe(true);
    expect(byScreen.nodesByEntityId.has("game-action:hidden")).toBe(false);
  });

  it("a decorative UI element is marked, not omitted, in byType", () => {
    const { projection, documents } = neutralProjection();
    const model = buildEntityGroupingTreeViewModel({ projection, documents, grouping: "byType", activeChannel: "web" });
    const decorativeNodes = flatFilter(model.flatNodes, (node) => node.entityId === "ui-component:home-title");
    expect(decorativeNodes.length).toBeGreaterThan(0);
    expect(decorativeNodes.every((node) => node.isDecorative === true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Determinism.
// ---------------------------------------------------------------------------

describe("buildEntityGroupingTreeViewModel — determinism", () => {
  it("produces a byte-stable node id sequence across rebuilds", () => {
    const { projection, documents } = neutralProjection();
    const first = buildEntityGroupingTreeViewModel({ projection, documents, grouping: "byType", activeChannel: "web" });
    const second = buildEntityGroupingTreeViewModel({ projection, documents, grouping: "byType", activeChannel: "web" });
    expect(first.flatNodes.map((node) => node.id)).toEqual(second.flatNodes.map((node) => node.id));
  });

  it("orders screens by document order and prototype headers by type key", () => {
    const { projection, documents } = neutralProjection();
    const byScreen = buildEntityGroupingTreeViewModel({ projection, documents, grouping: "byScreen", activeChannel: "web" });
    expect(byScreen.root.children.map((node) => node.label)).toEqual(["Экран Дом", "Экран Маршрут"]);

    const byType = buildEntityGroupingTreeViewModel({ projection, documents, grouping: "byType", activeChannel: "web" });
    const labels = byType.root.children.map((node) => node.label);
    // Locale-stable relative order (both lowercase type keys).
    expect(labels.indexOf("buttonComponent")).toBeLessThan(labels.indexOf("Карточка выбора"));
    expect(labels.indexOf("Карточка выбора")).toBeLessThan(labels.indexOf("textComponent"));
  });
});

// ---------------------------------------------------------------------------
// Real antarctica web authoring (scale + invariants + determinism).
// ---------------------------------------------------------------------------

describe("buildEntityGroupingTreeViewModel — real antarctica web", () => {
  function antarcticaProjection(): { projection: EditorEntityProjection; documents: readonly EditorEntityProjectionDocument[] } {
    const documents: readonly EditorEntityProjectionDocument[] = [
      { filePath: "game.authoring.json", json: loadJson("games/antarctica/authoring/game.authoring.json") },
      { filePath: "ui/web.authoring.json", json: loadJson("games/antarctica/authoring/ui/web.authoring.json") }
    ];
    const projection = buildEditorEntityProjection({ gameId: "antarctica", documents, activeChannel: "web" });
    return { projection, documents };
  }

  it("byScreen shows the four web screens with the first flagged active and entity-tagged nodes", () => {
    const { projection, documents } = antarcticaProjection();
    const model = buildEntityGroupingTreeViewModel({ projection, documents, grouping: "byScreen", activeChannel: "web" });

    const screens = model.root.children;
    expect(screens).toHaveLength(4);
    expect(screens.every((node) => node.entityKind === "ui-screen")).toBe(true);
    expect(screens.filter((node) => node.isActiveContext === true)).toHaveLength(1);
    expect(screens[0].isActiveContext).toBe(true);
    // Every UI node carries an entity id (its referenced game entity or its own).
    const uiNodes = model.flatNodes.filter((node) => node.entityKind === "ui-component");
    expect(uiNodes.length).toBeGreaterThan(0);
    expect(uiNodes.every((node) => node.entityId !== undefined)).toBe(true);
  });

  it("byType assigns exactly one primary node per projection entity and is deterministic", () => {
    const { projection, documents } = antarcticaProjection();
    const model = buildEntityGroupingTreeViewModel({ projection, documents, grouping: "byType", activeChannel: "web" });

    const primaryEntityNodes = model.flatNodes.filter((node) => node.entityId !== undefined && node.occurrenceKind === "primary");
    expect(primaryEntityNodes).toHaveLength(projection.entities.length);
    // Occurrences exist because UI instances re-appear inside their containers.
    expect(model.flatNodes.some((node) => node.occurrenceKind === "occurrence")).toBe(true);
    // Non-visual prototypes (metrics, actions, steps) sit next to visual ones.
    expect(model.root.children.some((node) => node.isNonVisual === true)).toBe(true);
    expect(model.root.children.some((node) => node.isNonVisual === undefined)).toBe(true);

    const rebuilt = buildEntityGroupingTreeViewModel({ projection, documents, grouping: "byType", activeChannel: "web" });
    expect(model.flatNodes.map((node) => node.id)).toEqual(rebuilt.flatNodes.map((node) => node.id));
  });
});
