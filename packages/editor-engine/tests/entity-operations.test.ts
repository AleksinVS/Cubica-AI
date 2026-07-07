/**
 * Tests for the entity create/delete/refactor ChangeSet builders (Phase 6.1;
 * ADR-057 §4.2/§4.5/§4.10; editor-preview-first-ux §9.1; design-spec §2.8;
 * ADR-050).
 *
 * The builders are exercised against a small, game-neutral projection built from
 * real authoring documents so cross-entity links (steps → action, UI button →
 * action) come from a genuine `EditorEntityProjection` (ADR-052), not a bespoke
 * index. A tiny Antarctica-flavoured fixture covers the Cyrillic slug rule.
 */
import { describe, expect, it } from "vitest";
import {
  buildAddViewFacetChangeSet,
  buildCreateEntityChangeSet,
  buildCreatePrototypeChangeSet,
  buildDeleteEntityChangeSet,
  buildEditorEntityProjection,
  buildRenameEntityIdChangeSet,
  classifyChangeSet,
  slugifyEntityId
} from "../src/index.ts";
import type { EditorEntityProjection, EditorEntityProjectionDocument, JsonValue } from "../src/index.ts";

const GAME_FILE = "games/demo/authoring/game.authoring.json";
const UI_FILE = "games/demo/authoring/ui/web.authoring.json";

/**
 * Game manifest: a visual prototype (`game.Resource`, `_requiresView`), a
 * non-visual prototype (`game.Rule`), and a flow whose step references action
 * `accept` (so `accept` has an incoming reference and `orphan` has none).
 */
const gameJson = {
  _manifestType: "game",
  _definitions: {
    "game.Resource": { _semantics: "A visual resource.", _requiresView: true },
    "game.Rule": { _semantics: "A non-visual rule." }
  },
  root: {
    id: "demo",
    content: {},
    logic: {
      flows: [{ id: "main", steps: [{ id: "start", actionId: "accept" }] }],
      actions: [
        { id: "accept", _label: "Accept" },
        { id: "orphan", _label: "Orphan" },
        { id: "lonely", _label: "Lonely" }
      ]
    }
  }
} as const;

/**
 * UI manifest for channel `web`: one screen whose root container holds two
 * button components. `accept-btn` references game action `accept` via `actionId`,
 * so the projection unifies it as a `view` facet of the action entity.
 */
const uiJson = {
  _manifestType: "ui",
  _channel: "web",
  root: {
    _type: "ui.Manifest",
    _label: "Demo UI",
    screens: [
      {
        id: "s1",
        _type: "ui.Screen",
        _label: "Screen 1",
        root: {
          id: "s1-root",
          _type: "ui.RootComponent",
          type: "containerComponent",
          _label: "Root",
          children: [
            { id: "accept-btn", _type: "ui.ButtonComponent", type: "buttonComponent", _label: "Accept", actionId: "accept" },
            { id: "orphan-btn", _type: "ui.ButtonComponent", type: "buttonComponent", _label: "Orphan", actionId: "orphan" }
          ]
        }
      }
    ]
  }
} as const;

function documents(): readonly EditorEntityProjectionDocument[] {
  return [
    { filePath: GAME_FILE, json: gameJson as unknown as JsonValue, documentKind: "game" },
    { filePath: UI_FILE, json: uiJson as unknown as JsonValue, documentKind: "ui", channel: "web" }
  ];
}

function buildProjection(): EditorEntityProjection {
  return buildEditorEntityProjection({ gameId: "demo", documents: documents(), activeChannel: "web" });
}

describe("slugifyEntityId (design-spec §2.8: ASCII slug from label)", () => {
  it("transliterates Cyrillic, lowercases and hyphenates", () => {
    expect(slugifyEntityId("Новый ресурс")).toBe("novyy-resurs");
    expect(slugifyEntityId("Привет, Мир!")).toBe("privet-mir");
  });

  it("passes ASCII through and falls back for empty results", () => {
    expect(slugifyEntityId("Food Counter")).toBe("food-counter");
    expect(slugifyEntityId("!!!")).toBe("entity");
  });
});

describe("buildCreateEntityChangeSet (design-spec §2.8; ADR-057 §4.10)", () => {
  const projection = buildProjection();

  it("visual type produces an atomic multi-file game + UI ChangeSet with an id reference", () => {
    const result = buildCreateEntityChangeSet(
      { typeOrPrototype: "game.Resource", channel: "web", label: "Новый ресурс" },
      projection,
      documents()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.entityId).toBe("novyy-resurs");

    const files = result.changeSet.jsonPatches.map((patch) => patch.filePath);
    expect(new Set(files)).toEqual(new Set([GAME_FILE, UI_FILE]));

    const gamePatch = result.changeSet.jsonPatches.find((patch) => patch.filePath === GAME_FILE);
    expect(gamePatch?.operations).toContainEqual({
      op: "add",
      path: "/root/content/novyy-resurs",
      value: { id: "novyy-resurs", _type: "game.Resource", _label: "Новый ресурс" }
    });

    const uiPatch = result.changeSet.jsonPatches.find((patch) => patch.filePath === UI_FILE);
    const uiOp = uiPatch?.operations[0];
    // The default `/root/children` container is absent, so the builder creates it
    // holding the new node (`value: [node]`); unwrap the array to read the node.
    const rawValue = uiOp && "value" in uiOp ? uiOp.value : undefined;
    const uiNode = (Array.isArray(rawValue) ? rawValue[0] : rawValue) as { gameEntityId?: string; id?: string } | undefined;
    // The UI node references the game entity id (UI → game direction).
    expect(uiNode?.gameEntityId).toBe("novyy-resurs");
  });

  it("non-visual type produces a game-only ChangeSet", () => {
    const result = buildCreateEntityChangeSet(
      { typeOrPrototype: "game.Rule", channel: "web", label: "Правило" },
      projection,
      documents()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.changeSet.jsonPatches.map((patch) => patch.filePath)).toEqual([GAME_FILE]);
  });

  it("appends a uniqueness suffix when the slug id is already taken", () => {
    const result = buildCreateEntityChangeSet(
      { typeOrPrototype: "game.Rule", channel: "web", label: "Accept" },
      projection,
      documents()
    );
    expect(result.ok && result.entityId).toBe("accept-2");
  });

  it("places the UI node into the given containerPointer", () => {
    const result = buildCreateEntityChangeSet(
      { typeOrPrototype: "game.Resource", channel: "web", label: "Panel", containerPointer: "/root/screens/0/root/children" },
      projection,
      documents()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const uiPatch = result.changeSet.jsonPatches.find((patch) => patch.filePath === UI_FILE);
    expect(uiPatch?.operations[0]?.path).toBe("/root/screens/0/root/children/-");
  });
});

describe("buildCreatePrototypeChangeSet (ADR-050; design-spec §2.8)", () => {
  const projection = buildProjection();

  it("baseType adds a local prototype to _definitions", () => {
    const result = buildCreatePrototypeChangeSet({ baseType: "game.Widget" }, projection, documents());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.definitionType).toBe("game.WidgetLocal");
    const patch = result.changeSet.jsonPatches[0];
    expect(patch?.filePath).toBe(GAME_FILE);
    expect(patch?.operations).toContainEqual({
      op: "add",
      path: "/_definitions/game.WidgetLocal",
      value: { _extends: "game.Widget", _semantics: "Local prototype extending game.Widget." }
    });
  });

  it("fromEntityId reuses prototype extraction across sibling instances", () => {
    const result = buildCreatePrototypeChangeSet({ fromEntityId: "ui-component:accept-btn" }, projection, documents());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.definitionType).toBe("ui.ButtonComponentLocal");
    const patch = result.changeSet.jsonPatches[0];
    expect(patch?.filePath).toBe(UI_FILE);
    expect(patch?.operations.some((op) => op.path.startsWith("/_definitions"))).toBe(true);
  });
});

describe("buildDeleteEntityChangeSet (ADR-057 §4.10; design-spec §2.8)", () => {
  const projection = buildProjection();

  it("abort refuses and lists the incoming references", () => {
    const result = buildDeleteEntityChangeSet(
      { entityId: "game-action:accept", referencePolicy: "abort" },
      projection,
      documents()
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe("abort");
    // Both the step (game doc) and the button (UI doc) reference `accept`.
    const files = new Set(result.incomingReferences.map((ref) => ref.filePath));
    expect(files).toEqual(new Set([GAME_FILE, UI_FILE]));
    expect(result.incomingReferences).toHaveLength(2);
  });

  it("clean removes the entity node and every incoming reference across documents", () => {
    const result = buildDeleteEntityChangeSet(
      { entityId: "game-action:accept", referencePolicy: "clean" },
      projection,
      documents()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const files = new Set(result.changeSet.jsonPatches.map((patch) => patch.filePath));
    expect(files).toEqual(new Set([GAME_FILE, UI_FILE]));

    const gameOps = result.changeSet.jsonPatches.find((patch) => patch.filePath === GAME_FILE)?.operations ?? [];
    expect(gameOps).toContainEqual({ op: "remove", path: "/root/logic/actions/0" });
    expect(gameOps).toContainEqual({ op: "remove", path: "/root/logic/flows/0/steps/0/actionId" });

    const uiOps = result.changeSet.jsonPatches.find((patch) => patch.filePath === UI_FILE)?.operations ?? [];
    expect(uiOps).toContainEqual({ op: "remove", path: "/root/screens/0/root/children/0/actionId" });
  });

  it("retarget replaces every incoming reference with the new target", () => {
    const result = buildDeleteEntityChangeSet(
      { entityId: "game-action:accept", referencePolicy: "retarget", retargetTo: "orphan" },
      projection,
      documents()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const allOps = result.changeSet.jsonPatches.flatMap((patch) => patch.operations);
    expect(allOps).toContainEqual({ op: "replace", path: "/root/logic/flows/0/steps/0/actionId", value: "orphan" });
    expect(allOps).toContainEqual({ op: "replace", path: "/root/screens/0/root/children/0/actionId", value: "orphan" });
  });

  it("retarget refuses an unknown target id", () => {
    const result = buildDeleteEntityChangeSet(
      { entityId: "game-action:accept", referencePolicy: "retarget", retargetTo: "ghost" },
      projection,
      documents()
    );
    expect(result.ok).toBe(false);
  });

  it("deletes an entity with no incoming references (all owned facets removed)", () => {
    // `lonely` is referenced by nobody, so even `abort` proceeds and removes the
    // entity's own facet node — the "delete all facets" path (design-spec §2.8).
    const result = buildDeleteEntityChangeSet(
      { entityId: "game-action:lonely", referencePolicy: "abort" },
      projection,
      documents()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const gameOps = result.changeSet.jsonPatches.find((patch) => patch.filePath === GAME_FILE)?.operations ?? [];
    expect(gameOps).toContainEqual({ op: "remove", path: "/root/logic/actions/2" });
  });
});

describe("buildRenameEntityIdChangeSet (ADR-057 §4.2/§4.5)", () => {
  const projection = buildProjection();

  it("renames the id and every incoming reference, always dangerous", () => {
    const result = buildRenameEntityIdChangeSet(
      { entityId: "game-action:accept", newId: "confirm" },
      projection,
      documents()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const allOps = result.changeSet.jsonPatches.flatMap((patch) => patch.operations);
    expect(allOps).toContainEqual({ op: "replace", path: "/root/logic/actions/0/id", value: "confirm" });
    expect(allOps).toContainEqual({ op: "replace", path: "/root/logic/flows/0/steps/0/actionId", value: "confirm" });
    expect(allOps).toContainEqual({ op: "replace", path: "/root/screens/0/root/children/0/actionId", value: "confirm" });

    // Multi-file: patches touch both the game and the UI document.
    expect(new Set(result.changeSet.jsonPatches.map((patch) => patch.filePath))).toEqual(new Set([GAME_FILE, UI_FILE]));

    // Always dangerous, verified through the shared classifier (ADR-057 §4.5).
    expect(result.risk).toBe("dangerous");
    expect(classifyChangeSet(result.changeSet, projection).risk).toBe("dangerous");
  });

  it("refuses when newId is already in use", () => {
    const result = buildRenameEntityIdChangeSet(
      { entityId: "game-action:accept", newId: "orphan" },
      projection,
      documents()
    );
    expect(result.ok).toBe(false);
  });
});

describe("buildAddViewFacetChangeSet (design-spec §3.2 «создать вид»; editor-preview-first-ux §2.1)", () => {
  const projection = buildProjection();

  it("adds ONLY a UI node referencing the existing game entity id (game facet untouched)", () => {
    // `lonely` is an action with no UI button, i.e. an entity missing its view.
    const result = buildAddViewFacetChangeSet(
      { entityId: "game-action:lonely", channel: "web", containerPointer: "/root/screens/0/root/children" },
      projection,
      documents()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // The change touches the UI document ONLY — the game facet is never modified.
    expect(result.changeSet.jsonPatches).toHaveLength(1);
    expect(result.changeSet.jsonPatches[0]?.filePath).toBe(UI_FILE);

    const op = result.changeSet.jsonPatches[0]?.operations[0];
    expect(op?.op).toBe("add");
    expect(op?.path).toBe("/root/screens/0/root/children/-");
    if (op?.op === "add") {
      expect(op.value).toMatchObject({ id: "lonely", _label: "Lonely", gameEntityId: "lonely" });
    }

    // Adding a view node is a structural authoring act, never dangerous.
    expect(classifyChangeSet(result.changeSet, projection).risk).toBe("structural");
  });

  it("refuses an unknown entity", () => {
    const result = buildAddViewFacetChangeSet({ entityId: "game-action:ghost", channel: "web" }, projection, documents());
    expect(result.ok).toBe(false);
  });

  it("refuses when the entity already has a view in that channel", () => {
    // `accept` already has `accept-btn` as its web view facet.
    const result = buildAddViewFacetChangeSet({ entityId: "game-action:accept", channel: "web" }, projection, documents());
    expect(result.ok).toBe(false);
  });
});
