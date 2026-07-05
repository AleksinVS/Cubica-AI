/**
 * Round-trip and strict-revive tests for the Level-2 PROJECT-artifact
 * serialization layer (ADR-057 §4.13 "Уровень 2 — проектные артефакты"; Phase
 * 2.2b).
 *
 * These prove the two contracts the projection warm-start cache relies on:
 *  1. serialize -> revive reproduces a projection deeply equal to a fresh build,
 *     including the two DERIVED Map indexes rebuilt on revive;
 *  2. revive is STRICT: garbage, a foreign format version, or a foreign lens-set
 *     version yields `null` (a silent miss), never a throw or a partial value.
 */
import { describe, expect, it } from "vitest";

import { createDocumentStore } from "../src/document-store.ts";
import {
  PROJECTION_LENS_SET_VERSION,
  buildEditorEntityProjection
} from "../src/entity-projection.ts";
import {
  EDITOR_ENTITY_PROJECTION_CACHE_FORMAT_VERSION,
  reviveEditorEntityProjection,
  serializeEditorEntityProjection
} from "../src/editor-entity-projection-serialization.ts";
import type { EditorEntityProjection, JsonValue } from "../src/types.ts";

const gameText = `${JSON.stringify(
  {
    _manifestType: "game",
    id: "sample",
    _label: "Sample",
    root: {
      _label: "Sample",
      logic: {
        actions: [{ id: "accept", _label: "Accept", objectId: "card" }],
        flows: [{ id: "f0", steps: [{ id: "s0", _label: "Step 0" }] }]
      },
      content: { infos: { card: { _label: "Card" } } },
      state: { public: { metrics: { score: { _label: "Score" } } } }
    }
  },
  null,
  2
)}\n`;

function buildProjection(text: string): EditorEntityProjection {
  const snapshot = createDocumentStore({ filePath: "games/sample/authoring/game.authoring.json", text }).snapshot();
  return buildEditorEntityProjection({ documents: [{ filePath: snapshot.filePath, json: snapshot.json }] });
}

/** Two projections are equal iff their entities, diagnostics, and both derived indexes match. */
function expectProjectionsEqual(actual: EditorEntityProjection, expected: EditorEntityProjection): void {
  expect(actual.projectionVersion).toBe(expected.projectionVersion);
  expect(actual.gameId).toBe(expected.gameId);
  expect(actual.sourceHashes).toEqual(expected.sourceHashes);
  expect(actual.entities).toEqual(expected.entities);
  expect(actual.diagnostics).toEqual(expected.diagnostics);
  expect([...actual.entityById.entries()]).toEqual([...expected.entityById.entries()]);
  expect([...actual.entitiesBySourcePointer.entries()]).toEqual([...expected.entitiesBySourcePointer.entries()]);
}

describe("editor entity projection serialization", () => {
  it("round-trips a projection with deep-equal entities and rebuilt Map indexes", () => {
    const original = buildProjection(gameText);
    expect(original.entities.length).toBeGreaterThan(0);

    const envelope = serializeEditorEntityProjection(original);
    const revived = reviveEditorEntityProjection(JSON.parse(JSON.stringify(envelope)));

    expect(revived).not.toBeNull();
    expectProjectionsEqual(revived as EditorEntityProjection, original);

    // The derived lookup maps answer identically to a fresh build.
    const [firstEntity] = original.entities;
    expect((revived as EditorEntityProjection).entityById.get(firstEntity.entityId)).toEqual(firstEntity);
    const key = `${firstEntity.primarySource.filePath}#${firstEntity.primarySource.pointer}`;
    expect((revived as EditorEntityProjection).entitiesBySourcePointer.get(key)).toEqual(
      original.entitiesBySourcePointer.get(key)
    );
  });

  it("carries optional documentHashes and engineVersion without affecting revive", () => {
    const original = buildProjection(gameText);
    const envelope = serializeEditorEntityProjection(original, {
      engineVersion: "test-1",
      documentHashes: { "games/sample/authoring/game.authoring.json": "abc" }
    });
    expect(envelope.documentHashes).toEqual({ "games/sample/authoring/game.authoring.json": "abc" });
    expect(envelope.engineVersion).toBe("test-1");
    expect(envelope.lensSetVersion).toBe(PROJECTION_LENS_SET_VERSION);

    const revived = reviveEditorEntityProjection(JSON.parse(JSON.stringify(envelope)));
    expectProjectionsEqual(revived as EditorEntityProjection, original);
  });

  it("revives garbage, wrong shapes, and foreign versions as null (a silent miss)", () => {
    expect(reviveEditorEntityProjection(null)).toBeNull();
    expect(reviveEditorEntityProjection(42 as unknown as JsonValue)).toBeNull();
    expect(reviveEditorEntityProjection("not an envelope")).toBeNull();
    expect(reviveEditorEntityProjection([])).toBeNull();
    expect(reviveEditorEntityProjection({})).toBeNull();
    expect(
      reviveEditorEntityProjection({
        formatVersion: EDITOR_ENTITY_PROJECTION_CACHE_FORMAT_VERSION,
        lensSetVersion: PROJECTION_LENS_SET_VERSION
      })
    ).toBeNull();
    expect(
      reviveEditorEntityProjection({
        formatVersion: EDITOR_ENTITY_PROJECTION_CACHE_FORMAT_VERSION,
        lensSetVersion: PROJECTION_LENS_SET_VERSION,
        payload: { projectionVersion: 1, sourceHashes: {}, entities: "nope", diagnostics: [] }
      })
    ).toBeNull();

    const envelope = serializeEditorEntityProjection(buildProjection(gameText));
    // A foreign (bumped) format version must not be read.
    expect(reviveEditorEntityProjection({ ...envelope, formatVersion: EDITOR_ENTITY_PROJECTION_CACHE_FORMAT_VERSION + 1 })).toBeNull();
    // A foreign lens-set version must not be read (the builder emits different entities).
    expect(reviveEditorEntityProjection({ ...envelope, lensSetVersion: PROJECTION_LENS_SET_VERSION + 1 })).toBeNull();
  });
});
