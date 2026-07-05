/**
 * Tests for the projection lens read-dependency declarations and the
 * incremental-invalidation helpers built on them (ADR-057 §4.13, UX §10).
 *
 * These cover only the FOUNDATION laid in Phase 1.3: the lens registry, the
 * lens-set version, the "changed pointer affects a lens" predicate, the
 * bidirectional pointer-overlap primitive, and `collectAffectedEntities`. The
 * incremental cache itself is out of scope here (Phase 2.1).
 */
import { describe, expect, it } from "vitest";
import {
  PROJECTION_LENSES,
  PROJECTION_LENS_SET_VERSION,
  buildEditorEntityProjection,
  collectAffectedEntities,
  pointerAffectsLens,
  pointersOverlap
} from "../src/index.ts";
import type { EditorEntityProjection, JsonValue, ProjectionLens } from "../src/index.ts";

/** A small game + UI project reused across the invalidation cases. */
function buildFixtureProjection(): EditorEntityProjection {
  const gameAuthoring = {
    _schemaVersion: "2.0",
    _manifestType: "game",
    root: {
      id: "game",
      _type: "game.Game",
      _label: "Projection Fixture",
      content: {
        data: {
          infos: [{ _type: "game.Info", _label: "Intro info", id: "intro-info", title: "Intro" }]
        }
      },
      state: { public: { metrics: { score: 0 } } },
      logic: {
        flows: [
          {
            id: "main",
            _type: "game.Flow",
            _label: "Main flow",
            steps: [
              {
                id: "main.start",
                _type: "game.Step",
                _label: "Start step",
                screenId: "intro",
                contentId: "intro-info",
                actionIds: ["choice.accept"]
              }
            ]
          }
        ],
        actions: [{ id: "choice.accept", _type: "game.Action", _label: "Accept choice" }]
      }
    }
  } satisfies JsonValue;

  const uiAuthoring = {
    _schemaVersion: "2.0",
    _manifestType: "ui",
    _channel: "web",
    root: {
      id: "web-ui",
      _type: "ui.Manifest",
      _label: "Projection Fixture Web UI",
      screens: [
        {
          id: "intro",
          _type: "ui.Screen",
          _label: "Intro screen",
          title: "Intro",
          root: {
            id: "intro.button",
            _type: "ui.Component",
            _label: "Accept button",
            type: "buttonComponent",
            actions: { onClick: { payload: { actionId: "choice.accept" } } }
          }
        }
      ]
    }
  } satisfies JsonValue;

  return buildEditorEntityProjection({
    gameId: "projection-fixture",
    documents: [
      { filePath: "game.authoring.json", json: gameAuthoring },
      { filePath: "ui/web.authoring.json", json: uiAuthoring }
    ]
  });
}

describe("projection lens declarations", () => {
  it("exposes a positive integer lens-set version", () => {
    expect(Number.isInteger(PROJECTION_LENS_SET_VERSION)).toBe(true);
    expect(PROJECTION_LENS_SET_VERSION).toBeGreaterThan(0);
  });

  it("declares non-empty, well-formed read pointer prefixes for unique lenses", () => {
    expect(PROJECTION_LENSES.length).toBeGreaterThan(0);

    const ids = PROJECTION_LENSES.map((lens) => lens.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const lens of PROJECTION_LENSES) {
      expect(lens.readPointerPrefixes.length).toBeGreaterThan(0);
      for (const prefix of lens.readPointerPrefixes) {
        // A prefix is either the whole-document root ("") or a JSON Pointer.
        expect(prefix === "" || prefix.startsWith("/")).toBe(true);
      }
    }
  });

  it("covers both game and ui document kinds", () => {
    const kinds = PROJECTION_LENSES.flatMap((lens) => lens.documentKinds ?? []);
    expect(kinds).toContain("game");
    expect(kinds).toContain("ui");
  });
});

describe("pointersOverlap", () => {
  it("is true for exact match, descendant, and ancestor (reverse nesting)", () => {
    expect(pointersOverlap("/a/b", "/a/b")).toBe(true);
    expect(pointersOverlap("/a/b/c", "/a/b")).toBe(true);
    expect(pointersOverlap("/a", "/a/b")).toBe(true);
  });

  it("is false for siblings and for string-prefix look-alikes", () => {
    expect(pointersOverlap("/a/b", "/a/c")).toBe(false);
    // "/ab" is NOT under "/a" — matching must respect pointer segment bounds.
    expect(pointersOverlap("/ab", "/a")).toBe(false);
  });

  it("treats the root pointer as overlapping everything", () => {
    expect(pointersOverlap("", "/a/b")).toBe(true);
    expect(pointersOverlap("/a/b", "")).toBe(true);
  });
});

describe("pointerAffectsLens", () => {
  const flowLens: ProjectionLens = {
    id: "game-flow-step",
    documentKinds: ["game"],
    readPointerPrefixes: ["/root/logic/flows"]
  };

  it("matches a change inside a read subtree", () => {
    expect(pointerAffectsLens(flowLens, "/root/logic/flows/0/steps/0/_label")).toBe(true);
  });

  it("matches a change above a read subtree (whole subtree replaced)", () => {
    expect(pointerAffectsLens(flowLens, "/root/logic")).toBe(true);
  });

  it("ignores unrelated changes", () => {
    expect(pointerAffectsLens(flowLens, "/root/state/public/metrics")).toBe(false);
  });

  it("respects document-kind scoping when a kind is provided", () => {
    expect(pointerAffectsLens(flowLens, "/root/logic/flows", "ui")).toBe(false);
    expect(pointerAffectsLens(flowLens, "/root/logic/flows", "game")).toBe(true);
  });

  it("treats a root-prefix lens as reading the whole document", () => {
    const previewLens: ProjectionLens = { id: "preview-facets", readPointerPrefixes: [""] };
    expect(pointerAffectsLens(previewLens, "/anything/deep")).toBe(true);
  });
});

describe("collectAffectedEntities", () => {
  it("affects the edited entity and its ancestors, but not siblings", () => {
    const projection = buildFixtureProjection();
    const affected = collectAffectedEntities(projection, {
      "game.authoring.json": ["/root/logic/flows/0/steps/0/_label"]
    });

    expect(affected.has("game-step:main.start")).toBe(true);
    expect(affected.has("game-flow:main")).toBe(true);
    expect(affected.has("game-root:game")).toBe(true);
    // Sibling subtrees are untouched.
    expect(affected.has("game-action:choice.accept")).toBe(false);
    expect(affected.has("metric:score")).toBe(false);
    // Other file: no entity affected.
    expect(affected.has("ui-screen:intro")).toBe(false);
  });

  it("affects descendants when a subtree is replaced from above", () => {
    const projection = buildFixtureProjection();
    const affected = collectAffectedEntities(projection, {
      "game.authoring.json": ["/root/logic/flows"]
    });

    expect(affected.has("game-flow:main")).toBe(true);
    expect(affected.has("game-step:main.start")).toBe(true);
    expect(affected.has("game-action:choice.accept")).toBe(false);
  });

  it("propagates cross-file changes through recorded source pointers only", () => {
    const projection = buildFixtureProjection();
    const affected = collectAffectedEntities(projection, {
      "ui/web.authoring.json": ["/root/screens/0/title"]
    });

    expect(affected.has("ui-screen:intro")).toBe(true);
    expect(affected.has("ui-root:web-ui")).toBe(true);
    // The game step carries a view facet into this screen (ADR-052 links), so a
    // screen edit invalidates it across files.
    expect(affected.has("game-step:main.start")).toBe(true);
    // The button component and the action point at deeper/sibling pointers.
    expect(affected.has("ui-component:intro.button")).toBe(false);
    expect(affected.has("game-action:choice.accept")).toBe(false);
  });

  it("treats an empty changed pointer as a whole-file change", () => {
    const projection = buildFixtureProjection();
    const affected = collectAffectedEntities(projection, { "game.authoring.json": [""] });

    expect(affected.has("game-root:game")).toBe(true);
    expect(affected.has("game-flow:main")).toBe(true);
    expect(affected.has("game-step:main.start")).toBe(true);
    expect(affected.has("game-action:choice.accept")).toBe(true);
    expect(affected.has("metric:score")).toBe(true);
    // A change confined to the game file leaves UI-only entities alone.
    expect(affected.has("ui-root:web-ui")).toBe(false);
  });

  it("returns an empty set when no changed file matches a source pointer", () => {
    const projection = buildFixtureProjection();
    const affected = collectAffectedEntities(projection, { "unrelated.json": ["/root"] });
    expect(affected.size).toBe(0);
  });
});
