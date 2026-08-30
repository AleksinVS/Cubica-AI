/**
 * Equivalence property tests for the incremental projection updater
 * (ADR-057 §4.13; editor-preview-first-ux §10 "Уровень 1"; design-spec §2.6, §5).
 *
 * THE MAIN GATE (task Phase 2.1): for every change, the projection produced by
 * `updateEditorEntityProjection` (incremental) must be DEEPLY EQUAL to the
 * projection produced by `buildEditorEntityProjection` on the same next input
 * (full rebuild). "Deeply equal" here means the whole projection value: entities
 * (in order), their facets (in order), diagnostics (in order), and the derived
 * `entityById` / `entitiesBySourcePointer` maps.
 *
 * Order semantics that the gate pins down:
 *   - `entities` are sorted by `entityId`;
 *   - facet source pointers keep insertion order within each facet kind, in the
 *     fixed `orderedEditorEntityFacetKinds` order;
 *   - `diagnostics` are construction diagnostics first, then identity
 *     diagnostics, in entity order.
 * The incremental path preserves all of these by refreshing records in place.
 *
 * Coverage: real authoring documents (antarctica, simple-choice), a small
 * synthetic project for targeted cross-entity cases, and a deterministic fuzz
 * that mutates random pointers across every patch class the task calls out
 * (leaf replace, collection add/remove, `_label` edit, link edit, UI-facet edit,
 * and edits ABOVE a lens prefix).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyJsonPatch,
  buildEditorEntityProjection,
  createEditorEntityProjectionState,
  updateEditorEntityProjection
} from "../src/index.ts";
import type {
  BuildEditorEntityProjectionInput,
  ChangedPointersByFile,
  EditorEntityProjectionDocument,
  JsonPatchOperation,
  JsonValue
} from "../src/index.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..", "..");

/** Reads and parses an authoring file relative to the repository root. */
function loadJson(relativePath: string): JsonValue {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8")) as JsonValue;
}

/** Deep-clones a JSON value so mutations in one document set never leak to another. */
function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Applies one or more JSON Patch operations to a single document and returns the
 * next document set plus the `changedPointersByFile` a DocumentStore edit would
 * naturally report (the op paths). `applyJsonPatch` never mutates its input, so
 * the previous document set stays intact.
 */
function applyPatch(
  documents: readonly EditorEntityProjectionDocument[],
  filePath: string,
  operations: readonly JsonPatchOperation[]
): { readonly nextDocuments: readonly EditorEntityProjectionDocument[]; readonly changedPointersByFile: ChangedPointersByFile } {
  const nextDocuments = documents.map((document) =>
    document.filePath === filePath && document.json !== undefined
      ? { ...document, json: applyJsonPatch(document.json, operations) }
      : document
  );
  return { nextDocuments, changedPointersByFile: { [filePath]: operations.map((operation) => operation.path) } };
}

/**
 * Asserts the incremental update equals a full rebuild for `operations` applied
 * to `filePath`, and returns the resulting update so callers can also inspect the
 * telemetry report. This is the reusable equivalence assertion.
 */
function expectIncrementalEqualsFull(
  input: BuildEditorEntityProjectionInput,
  filePath: string,
  operations: readonly JsonPatchOperation[]
): ReturnType<typeof updateEditorEntityProjection> {
  const previous = createEditorEntityProjectionState(input);
  const { nextDocuments, changedPointersByFile } = applyPatch(input.documents, filePath, operations);
  const nextInput: BuildEditorEntityProjectionInput = { ...input, documents: nextDocuments };

  const update = updateEditorEntityProjection(previous, { input: nextInput, changedPointersByFile });
  const full = buildEditorEntityProjection(nextInput);

  expect(update.state.projection).toEqual(full);
  return update;
}

/** Antarctica: the heaviest real project (game + two UI channels). */
function antarcticaInput(): BuildEditorEntityProjectionInput {
  return {
    gameId: "antarctica",
    documents: [
      { filePath: "games/antarctica/authoring/game.authoring.json", json: cloneJson(loadJson("games/antarctica/authoring/game.authoring.json")) },
      { filePath: "games/antarctica/authoring/ui/web.authoring.json", json: cloneJson(loadJson("games/antarctica/authoring/ui/web.authoring.json")) },
      { filePath: "games/antarctica/authoring/ui/telegram.authoring.json", json: cloneJson(loadJson("games/antarctica/authoring/ui/telegram.authoring.json")) }
    ]
  };
}

/** Simple-choice: a small real project. */
function simpleChoiceInput(): BuildEditorEntityProjectionInput {
  return {
    gameId: "simple-choice",
    documents: [
      { filePath: "games/simple-choice/authoring/game.authoring.json", json: cloneJson(loadJson("games/simple-choice/authoring/game.authoring.json")) },
      { filePath: "games/simple-choice/authoring/ui/web.authoring.json", json: cloneJson(loadJson("games/simple-choice/authoring/ui/web.authoring.json")) }
    ]
  };
}

/** A tiny synthetic game+UI project for precise cross-entity assertions. */
function syntheticInput(): BuildEditorEntityProjectionInput {
  const game: JsonValue = {
    _schemaVersion: "2.0",
    _manifestType: "game",
    root: {
      id: "game",
      _type: "game.Game",
      _label: "Synthetic",
      state: { public: { metrics: { score: 0 } } },
      logic: {
        flows: [
          {
            id: "main",
            _type: "game.Flow",
            _label: "Main flow",
            steps: [{ id: "s1", _type: "game.Step", _label: "Start", screenId: "intro", actionIds: ["accept"] }]
          }
        ],
        actions: [
          {
            id: "accept",
            _type: "game.Action",
            _label: "Accept",
            binding: { kind: "mechanics-plan", planRef: "accept" }
          }
        ]
      },
      mechanics: {
        plans: {
          accept: {
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
      }
    }
  };
  const ui: JsonValue = {
    _schemaVersion: "2.0",
    _manifestType: "ui",
    _channel: "web",
    root: {
      id: "web-ui",
      _type: "ui.Manifest",
      _label: "Web UI",
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
            actions: { onClick: { payload: { actionId: "accept" } } }
          }
        }
      ]
    }
  };
  return {
    gameId: "synthetic",
    documents: [
      { filePath: "game.authoring.json", json: game },
      { filePath: "ui/web.authoring.json", json: ui }
    ]
  };
}

const GAME_PATH = "game.authoring.json";
const UI_PATH = "ui/web.authoring.json";

describe("updateEditorEntityProjection — targeted patch classes (synthetic)", () => {
  it("leaf replace of a projection-irrelevant field leaves the projection untouched", () => {
    const input = syntheticInput();
    // Add a plain content field, then edit it: neither read by any lens.
    const seeded: BuildEditorEntityProjectionInput = {
      ...input,
      documents: input.documents.map((document) =>
        document.filePath === GAME_PATH && document.json !== undefined
          ? { ...document, json: applyJsonPatch(document.json, [{ op: "add", path: "/root/logic/actions/0/note", value: "old" }]) }
          : document
      )
    };
    const update = expectIncrementalEqualsFull(seeded, GAME_PATH, [
      { op: "replace", path: "/root/logic/actions/0/note", value: "new" }
    ]);
    expect(update.report.mode).toBe("incremental");
    expect(update.report.reason).toBe("incremental:no-projection-effect");
    expect(update.report.rebuiltEntityIds).toEqual([]);
  });

  it("editing an action _label refreshes the action AND the referencing step's facet label", () => {
    const input = syntheticInput();
    const update = expectIncrementalEqualsFull(input, GAME_PATH, [
      { op: "replace", path: "/root/logic/actions/0/_label", value: "Accept (renamed)" }
    ]);
    expect(update.report.mode).toBe("incremental");
    // The action and the step that links to it both carry the action's pointer.
    expect(update.report.rebuiltEntityIds).toContain("game-action:accept");
    expect(update.report.rebuiltEntityIds).toContain("game-step:s1");
    const action = update.state.projection.entityById.get("game-action:accept");
    expect(action?.label).toBe("Accept (renamed)");
    // The plan caption is derived from the stable planRef, not from fields in
    // the plan object, so refreshing the action must not rewrite that caption.
    expect(action?.facets.logic?.find((source) => source.role === "mechanics-plan")?.label).toBe("Mechanics plan accept");
  });

  it("editing a UI component _label refreshes the pushed view facet on the action", () => {
    const input = syntheticInput();
    // The component pushes a view facet onto the action; its label must refresh.
    const update = expectIncrementalEqualsFull(input, UI_PATH, [
      { op: "replace", path: "/root/screens/0/root/_label", value: "Accept button v2" }
    ]);
    expect(update.report.mode).toBe("incremental");
  });

  it("changing a link target id (dangerous) falls back to a full rebuild", () => {
    const input = syntheticInput();
    const update = expectIncrementalEqualsFull(input, GAME_PATH, [
      { op: "replace", path: "/root/logic/actions/0/id", value: "accept-2" }
    ]);
    expect(update.report.mode).toBe("full");
  });

  it("re-targeting a UI actionId reference falls back to a full rebuild", () => {
    const input = syntheticInput();
    const update = expectIncrementalEqualsFull(input, UI_PATH, [
      { op: "replace", path: "/root/screens/0/root/actions/onClick/payload/actionId", value: "missing" }
    ]);
    expect(update.report.mode).toBe("full");
  });

  it("adding a collection element (array grows) falls back to a full rebuild", () => {
    const input = syntheticInput();
    const update = expectIncrementalEqualsFull(input, GAME_PATH, [
      { op: "add", path: "/root/logic/actions/1", value: { id: "decline", _type: "game.Action", _label: "Decline" } }
    ]);
    expect(update.report.mode).toBe("full");
  });

  it("removing a collection element (array shrinks) falls back to a full rebuild", () => {
    const input = syntheticInput();
    // Seed a second action so removal is valid.
    const seeded: BuildEditorEntityProjectionInput = {
      ...input,
      documents: input.documents.map((document) =>
        document.filePath === GAME_PATH && document.json !== undefined
          ? { ...document, json: applyJsonPatch(document.json, [{ op: "add", path: "/root/logic/actions/1", value: { id: "decline", _type: "game.Action", _label: "Decline" } }]) }
          : document
      )
    };
    const update = expectIncrementalEqualsFull(seeded, GAME_PATH, [{ op: "remove", path: "/root/logic/actions/1" }]);
    expect(update.report.mode).toBe("full");
  });

  it("replacing a whole subtree ABOVE a lens prefix falls back to a full rebuild", () => {
    const input = syntheticInput();
    const update = expectIncrementalEqualsFull(input, GAME_PATH, [
      { op: "replace", path: "/root/logic", value: { flows: [], actions: [] } }
    ]);
    expect(update.report.mode).toBe("full");
  });

  it("toggling a component _decorative flag falls back to a full rebuild", () => {
    const input = syntheticInput();
    const update = expectIncrementalEqualsFull(input, UI_PATH, [
      { op: "add", path: "/root/screens/0/root/_decorative", value: true }
    ]);
    expect(update.report.mode).toBe("full");
  });

  it("editing a metric value has no projection effect (metric labels come from the key)", () => {
    const input = syntheticInput();
    const update = expectIncrementalEqualsFull(input, GAME_PATH, [
      { op: "replace", path: "/root/state/public/metrics/score", value: 5 }
    ]);
    expect(update.report.mode).toBe("incremental");
    expect(update.report.rebuiltEntityIds).toEqual([]);
  });

  it("an empty change set for a file forces a full rebuild (unknown pointers)", () => {
    const input = syntheticInput();
    const previous = createEditorEntityProjectionState(input);
    const update = updateEditorEntityProjection(previous, { input, changedPointersByFile: { [GAME_PATH]: [] } });
    expect(update.report.mode).toBe("full");
    expect(update.state.projection).toEqual(buildEditorEntityProjection(input));
  });

  it("chains incremental updates through the returned state", () => {
    const input = syntheticInput();
    let state = createEditorEntityProjectionState(input);
    let documents = input.documents;
    for (const label of ["First", "Second", "Third"]) {
      const { nextDocuments, changedPointersByFile } = applyPatch(documents, GAME_PATH, [
        { op: "replace", path: "/root/logic/flows/0/steps/0/_label", value: label }
      ]);
      const nextInput: BuildEditorEntityProjectionInput = { ...input, documents: nextDocuments };
      const update = updateEditorEntityProjection(state, { input: nextInput, changedPointersByFile });
      expect(update.state.projection).toEqual(buildEditorEntityProjection(nextInput));
      expect(update.report.mode).toBe("incremental");
      state = update.state;
      documents = nextDocuments;
    }
    expect(state.projection.entityById.get("game-step:s1")?.label).toBe("Third");
  });

  it("reports a numeric non-negative duration for the update telemetry", () => {
    const input = syntheticInput();
    const update = expectIncrementalEqualsFull(input, GAME_PATH, [
      { op: "replace", path: "/root/_label", value: "Synthetic v2" }
    ]);
    expect(typeof update.report.durationMs).toBe("number");
    expect(update.report.durationMs).toBeGreaterThanOrEqual(0);
  });
});

/** Collects (pointer, value) pairs for every node in a document, for the fuzz. */
function enumeratePointers(value: JsonValue, pointer: string, out: { pointer: string; value: JsonValue }[]): void {
  out.push({ pointer, value });
  if (Array.isArray(value)) {
    value.forEach((item, index) => enumeratePointers(item, `${pointer}/${index}`, out));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      enumeratePointers(child, `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, out);
    }
  }
}

/** Small deterministic PRNG (mulberry32) so fuzz runs are reproducible. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds a random-but-valid patch op for a chosen node, spanning every patch class. */
function randomOperationFor(node: { pointer: string; value: JsonValue }, rng: () => number): JsonPatchOperation | undefined {
  const { pointer, value } = node;
  if (pointer === "") {
    return undefined; // never replace the whole document
  }
  if (typeof value === "string") {
    return { op: "replace", path: pointer, value: `${value}~edited` };
  }
  if (typeof value === "number") {
    return { op: "replace", path: pointer, value: value + 1 };
  }
  if (typeof value === "boolean") {
    return { op: "replace", path: pointer, value: !value };
  }
  if (Array.isArray(value)) {
    if (value.length > 0 && rng() < 0.5) {
      return { op: "remove", path: `${pointer}/${Math.floor(rng() * value.length)}` };
    }
    return { op: "add", path: `${pointer}/${value.length}`, value: { id: `fuzz-${Math.floor(rng() * 1e6)}`, _type: "x.Fuzz", _label: "Fuzz" } };
  }
  if (value !== null && typeof value === "object") {
    // Either replace the whole object (above-prefix subtree) or add/remove a key.
    const roll = rng();
    if (roll < 0.34) {
      return { op: "replace", path: pointer, value: { _label: "Replaced subtree" } };
    }
    const keys = Object.keys(value);
    if (roll < 0.67 && keys.length > 0) {
      const key = keys[Math.floor(rng() * keys.length)];
      return { op: "remove", path: `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}` };
    }
    return { op: "add", path: `${pointer}/fuzzKey`, value: "fuzz" };
  }
  return undefined;
}

describe.each([
  ["antarctica", antarcticaInput, 40],
  ["simple-choice", simpleChoiceInput, 120]
])("updateEditorEntityProjection — fuzz equivalence on real %s authoring", (_name, makeInput, samplesPerDocument) => {
  it("is deeply equal to a full rebuild across random patches on every document", () => {
    const input = makeInput();
    const rng = makeRng(0xc0ffee);
    // `input` is constant, so the previous state is built once, not per sample.
    const previous = createEditorEntityProjectionState(input);
    let checked = 0;

    for (const document of input.documents) {
      if (document.json === undefined) {
        continue;
      }
      const nodes: { pointer: string; value: JsonValue }[] = [];
      enumeratePointers(document.json, "", nodes);

      for (let sample = 0; sample < samplesPerDocument; sample += 1) {
        const node = nodes[Math.floor(rng() * nodes.length)];
        const operation = randomOperationFor(node, rng);
        if (operation === undefined) {
          continue;
        }
        // Guard against invalid patches (e.g. remove of an already-removed path):
        // skip any op that throws when applied.
        let nextJson: JsonValue;
        try {
          nextJson = applyJsonPatch(document.json, [operation]);
        } catch {
          continue;
        }
        const nextDocuments = input.documents.map((candidate) =>
          candidate.filePath === document.filePath ? { ...candidate, json: nextJson } : candidate
        );
        const nextInput: BuildEditorEntityProjectionInput = { ...input, documents: nextDocuments };
        const update = updateEditorEntityProjection(previous, {
          input: nextInput,
          changedPointersByFile: { [document.filePath]: [operation.path] }
        });
        const full = buildEditorEntityProjection(nextInput);
        const firstDifferentEntityIndex = update.state.projection.entities.findIndex(
          (entity, index) => JSON.stringify(entity) !== JSON.stringify(full.entities[index])
        );
        expect(
          update.state.projection.entities[firstDifferentEntityIndex],
          `incremental projection diverged for ${document.filePath} sample ${sample}: ${JSON.stringify(operation)}; ` +
            `first different entity index=${firstDifferentEntityIndex}`
        ).toEqual(full.entities[firstDifferentEntityIndex]);
        expect(update.state.projection).toEqual(full);
        checked += 1;
      }
    }

    expect(checked).toBeGreaterThan(0);
  });
});

describe("updateEditorEntityProjection — real-doc label refresh is faster than full rebuild", () => {
  it("takes the incremental path for a typical antarctica _label edit", () => {
    const input = antarcticaInput();
    const update = expectIncrementalEqualsFull(input, "games/antarctica/authoring/game.authoring.json", [
      { op: "replace", path: "/root/_label", value: "Антарктическая корпорация (ред.)" }
    ]);
    expect(update.report.mode).toBe("incremental");
    expect(update.report.reusedEntityCount).toBeGreaterThan(0);
  });
});
