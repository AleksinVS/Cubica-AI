import { describe, expect, it } from "vitest";
import { createSchemaRegistry, type EditorChangeSet } from "@cubica/editor-engine";

import { dryRunMultiDocumentChangeSet } from "./multi-document-apply";

/**
 * Unit tests for the multi-document apply GATE (Phase 6.2a, part A). They assert
 * the atomicity contract without any schema: a valid two-file ChangeSet dry-runs
 * every file and produces a combined inverse, while ANY failing file makes the
 * whole result `ok:false` with no `after` texts, so the caller applies NOTHING.
 */
const GAME_PATH = "game.authoring.json";
const UI_PATH = "ui/web.authoring.json";

function baseInput(changeSet: EditorChangeSet, texts: Record<string, string>) {
  return {
    changeSet,
    documentTextByPath: new Map(Object.entries(texts)),
    schemaRegistry: createSchemaRegistry(),
    resolveSchemaId: () => undefined,
    includeSemanticDiagnostics: false
  };
}

describe("dryRunMultiDocumentChangeSet", () => {
  it("dry-runs every touched document and builds a combined inverse when all pass", () => {
    const changeSet: EditorChangeSet = {
      id: "create-entity:hp",
      summary: "Create entity hp",
      jsonPatches: [
        { filePath: GAME_PATH, operations: [{ op: "add", path: "/root/content/hp", value: { id: "hp", _type: "core.metric" } }] },
        { filePath: UI_PATH, operations: [{ op: "add", path: "/root/children/-", value: { id: "hp", gameEntityId: "hp" } }] }
      ]
    };

    const result = dryRunMultiDocumentChangeSet(
      baseInput(changeSet, {
        [GAME_PATH]: `${JSON.stringify({ root: { content: {} } }, null, 2)}\n`,
        [UI_PATH]: `${JSON.stringify({ root: { children: [] } }, null, 2)}\n`
      })
    );

    expect(result.ok).toBe(true);
    expect([...result.afterTextByPath.keys()].sort()).toEqual([GAME_PATH, UI_PATH]);
    expect(result.afterTextByPath.get(GAME_PATH)).toContain("\"hp\"");
    expect(result.afterTextByPath.get(UI_PATH)).toContain("gameEntityId");
    // The inverse reverses BOTH files (undo restores every facet together).
    expect(result.inverseChangeSet.jsonPatches.map((patch) => patch.filePath).sort()).toEqual([GAME_PATH, UI_PATH]);
    // Changed pointers are reported per file for the incremental projection (2.1b).
    expect(Object.keys(result.changedPointersByFile).sort()).toEqual([GAME_PATH, UI_PATH]);
  });

  it("applies NOTHING when any single document fails (atomicity)", () => {
    const changeSet: EditorChangeSet = {
      id: "create-entity:hp",
      summary: "Create entity hp",
      jsonPatches: [
        { filePath: GAME_PATH, operations: [{ op: "add", path: "/root/content/hp", value: { id: "hp" } }] },
        // The UI patch targets a missing parent, so its dry-run throws/fails.
        { filePath: UI_PATH, operations: [{ op: "add", path: "/root/missing/x", value: { id: "hp" } }] }
      ]
    };

    const result = dryRunMultiDocumentChangeSet(
      baseInput(changeSet, {
        [GAME_PATH]: `${JSON.stringify({ root: { content: {} } }, null, 2)}\n`,
        [UI_PATH]: `${JSON.stringify({ root: { children: [] } }, null, 2)}\n`
      })
    );

    expect(result.ok).toBe(false);
    expect(result.afterTextByPath.size).toBe(0);
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
  });

  it("fails when a touched document's current text was not provided", () => {
    const changeSet: EditorChangeSet = {
      id: "create-entity:hp",
      summary: "Create entity hp",
      jsonPatches: [
        { filePath: GAME_PATH, operations: [{ op: "add", path: "/root/content/hp", value: { id: "hp" } }] },
        { filePath: UI_PATH, operations: [{ op: "add", path: "/root/children/-", value: { id: "hp" } }] }
      ]
    };

    const result = dryRunMultiDocumentChangeSet(
      baseInput(changeSet, { [GAME_PATH]: `${JSON.stringify({ root: { content: {} } }, null, 2)}\n` })
    );

    expect(result.ok).toBe(false);
    expect(result.afterTextByPath.size).toBe(0);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes(UI_PATH))).toBe(true);
  });
});
