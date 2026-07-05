/**
 * Tests for the ChangeSet operation risk policy (ADR-057 §4.5, §5).
 *
 * The policy is exercised against a small game authoring projection so the
 * "incoming reference" facts come from a real `EditorEntityProjection`
 * (ADR-052) rather than a bespoke index. Fixtures stay tiny and game-neutral.
 */
import { describe, expect, it } from "vitest";
import {
  buildEditorEntityProjection,
  classifyChangeSet,
  type EditorChangeSet,
  type EditorEntityProjection,
  type JsonPatchOperation
} from "../src/index.ts";

const GAME_FILE = "games/demo/authoring/game.authoring.json";

/**
 * A minimal game manifest: one step references action `accept`, so `accept`
 * has an incoming reference while `orphan` has none.
 */
const gameJson = {
  _manifestType: "game",
  root: {
    id: "demo",
    logic: {
      flows: [{ id: "main", steps: [{ id: "start", actionId: "accept" }] }],
      actions: [
        { id: "accept", _label: "Accept" },
        { id: "orphan", _label: "Orphan" }
      ]
    }
  }
} as const;

function buildProjection(): EditorEntityProjection {
  return buildEditorEntityProjection({
    gameId: "demo",
    documents: [{ filePath: GAME_FILE, json: gameJson as never }]
  });
}

function changeSet(operations: readonly JsonPatchOperation[], extra?: Partial<EditorChangeSet>): EditorChangeSet {
  return {
    id: "cs-test",
    summary: "test change",
    jsonPatches: operations.length === 0 ? [] : [{ filePath: GAME_FILE, operations }],
    ...extra
  };
}

describe("classifyChangeSet risk policy", () => {
  const projection = buildProjection();

  it("classifies a leaf value replace as safe with no reasons", () => {
    const result = classifyChangeSet(
      changeSet([{ op: "replace", path: "/root/logic/actions/1/_label", value: "Orphan v2" }]),
      projection
    );
    expect(result.risk).toBe("safe");
    expect(result.reasons).toEqual([]);
  });

  it("classifies adding a collection element as structural", () => {
    const result = classifyChangeSet(
      changeSet([{ op: "add", path: "/root/logic/actions/-", value: { id: "extra", _label: "Extra" } }]),
      projection
    );
    expect(result.risk).toBe("structural");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("classifies replacing a whole structure as structural", () => {
    const result = classifyChangeSet(
      changeSet([{ op: "replace", path: "/root/logic/flows/0/steps", value: [] }]),
      projection
    );
    expect(result.risk).toBe("structural");
  });

  it("classifies an id change as dangerous", () => {
    const result = classifyChangeSet(
      changeSet([{ op: "replace", path: "/root/logic/actions/1/id", value: "renamed" }]),
      projection
    );
    expect(result.risk).toBe("dangerous");
    expect(result.reasons.some((reason) => reason.includes("identity"))).toBe(true);
  });

  it("classifies retargeting a reference as dangerous", () => {
    const result = classifyChangeSet(
      changeSet([{ op: "replace", path: "/root/logic/flows/0/steps/0/actionId", value: "orphan" }]),
      projection
    );
    expect(result.risk).toBe("dangerous");
    expect(result.reasons.some((reason) => reason.includes("retargets reference"))).toBe(true);
  });

  it("does not treat lookalike fields such as `grid` as references", () => {
    const result = classifyChangeSet(
      changeSet([{ op: "replace", path: "/root/logic/flows/0/grid", value: "tight" }]),
      projection
    );
    expect(result.risk).toBe("safe");
  });

  it("classifies deleting an entity WITH incoming references as dangerous", () => {
    // `accept` (actions/0) is referenced by the `start` step.
    const result = classifyChangeSet(
      changeSet([{ op: "remove", path: "/root/logic/actions/0" }]),
      projection
    );
    expect(result.risk).toBe("dangerous");
    expect(result.reasons.some((reason) => reason.includes("incoming reference"))).toBe(true);
  });

  it("classifies deleting an entity WITHOUT incoming references as structural", () => {
    // `orphan` (actions/1) is referenced by nothing.
    const result = classifyChangeSet(
      changeSet([{ op: "remove", path: "/root/logic/actions/1" }]),
      projection
    );
    expect(result.risk).toBe("structural");
  });

  it("classifies a file operation inside authoring/assets as structural", () => {
    const result = classifyChangeSet(
      changeSet([], { fileCreates: [{ filePath: "games/demo/assets/card.png", text: "" }] }),
      projection
    );
    expect(result.risk).toBe("structural");
  });

  it("classifies a file operation outside authoring/assets as dangerous", () => {
    const result = classifyChangeSet(
      changeSet([], { fileDeletes: [{ filePath: "package.json" }] }),
      projection
    );
    expect(result.risk).toBe("dangerous");
    expect(result.reasons.some((reason) => reason.includes("outside authoring/assets"))).toBe(true);
  });

  it("returns the maximum risk for a mixed ChangeSet and keeps every reason", () => {
    const result = classifyChangeSet(
      changeSet([
        { op: "replace", path: "/root/logic/actions/1/_label", value: "safe edit" },
        { op: "add", path: "/root/logic/actions/-", value: { id: "extra" } },
        { op: "replace", path: "/root/logic/actions/1/id", value: "renamed" }
      ]),
      projection
    );
    expect(result.risk).toBe("dangerous");
    // The structural add reason and the dangerous id-change reason both survive.
    expect(result.reasons.some((reason) => reason.includes("adds"))).toBe(true);
    expect(result.reasons.some((reason) => reason.includes("identity"))).toBe(true);
  });

  it("ignores read-only `test` guard operations", () => {
    const result = classifyChangeSet(
      changeSet([{ op: "test", path: "/root/id", value: "demo" }]),
      projection
    );
    expect(result.risk).toBe("safe");
  });
});
