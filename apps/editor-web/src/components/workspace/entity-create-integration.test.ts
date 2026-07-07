import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCreateEntityChangeSet,
  buildEditorEntityProjection,
  createDocumentStore,
  validateDocument,
  type DocumentDiagnostic,
  type EditorEntityProjectionDocument,
  type JsonValue
} from "@cubica/editor-engine";

import { getSharedAuthoringSchemaRegistry, schemaIdForAuthoringDocument } from "@/lib/editor-json-schema";
import { dryRunMultiDocumentChangeSet } from "./multi-document-apply";

/**
 * Integration test for the «+» create pipeline (Phase 6.2a) against REAL shipped
 * game manifests and the REAL authoring JSON Schemas the editor validates with.
 *
 * The core builders (6.1) only assert ChangeSet SHAPE against synthetic manifests;
 * this closes the remaining gap — that `buildCreateEntityChangeSet` output flows
 * cleanly through `dryRunMultiDocumentChangeSet` (schema + semantic validation).
 *
 * Two invariants are checked:
 *   1. On a manifest with NO pre-existing validation debt (simple-choice), a
 *      create dry-runs fully green — the button produces an applicable change.
 *   2. On ANY manifest, a create introduces NO NEW blocking diagnostic beyond the
 *      document's own baseline — the create is valid even when the surrounding
 *      document already carries unrelated pre-existing diagnostics (as Antarctica
 *      does: its state `cards` lack `_label`). This mirrors the single-document
 *      apply gate, which validates the whole after-document the same way.
 */
const REPO_ROOT = path.resolve(__dirname, "../../../../..");

function readManifest(relativePath: string): { filePath: string; text: string; json: JsonValue } {
  const text = readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
  return { filePath: relativePath.split("/authoring/")[1] ?? relativePath, text, json: JSON.parse(text) as JsonValue };
}

function baselineErrors(filePath: string, text: string): readonly DocumentDiagnostic[] {
  const snapshot = createDocumentStore({ filePath, text }).snapshot();
  return validateDocument(snapshot, {
    schemaRegistry: getSharedAuthoringSchemaRegistry(),
    schemaId: schemaIdForAuthoringDocument(filePath, snapshot.json),
    includeSemanticDiagnostics: true
  }).filter((diagnostic) => diagnostic.severity === "error");
}

function createDryRun(game: { filePath: string; text: string; json: JsonValue }, typeKey: string) {
  const documents: readonly EditorEntityProjectionDocument[] = [{ filePath: game.filePath, json: game.json, documentKind: "game" }];
  const build = buildCreateEntityChangeSet({ typeOrPrototype: typeKey, channel: "web", label: "Проверка создания" }, buildEditorEntityProjection({ documents }), documents);
  expect(build.ok).toBe(true);
  if (!build.ok) {
    throw new Error("builder failed");
  }
  const dryRun = dryRunMultiDocumentChangeSet({
    changeSet: build.changeSet,
    documentTextByPath: new Map([[game.filePath, game.text]]),
    schemaRegistry: getSharedAuthoringSchemaRegistry(),
    resolveSchemaId: (filePath) => schemaIdForAuthoringDocument(filePath, undefined),
    includeSemanticDiagnostics: true
  });
  return { build, dryRun };
}

describe("entity create pipeline (real manifests + real schemas)", () => {
  it("dry-runs fully green on a manifest without pre-existing validation debt (simple-choice)", () => {
    const game = readManifest("games/simple-choice/authoring/game.authoring.json");
    expect(baselineErrors(game.filePath, game.text)).toHaveLength(0);

    const { build, dryRun } = createDryRun(game, "core.note");
    expect(build.changeSet.jsonPatches.map((patch) => patch.filePath)).toEqual([game.filePath]);
    if (!dryRun.ok) {
      throw new Error(`create dry-run blocked: ${JSON.stringify(dryRun.diagnostics.filter((diagnostic) => diagnostic.severity === "error"))}`);
    }
    expect(dryRun.ok).toBe(true);
    expect(dryRun.afterTextByPath.get(game.filePath)).toContain("proverka-sozdaniya");
  });

  it("introduces no NEW blocking diagnostic on a manifest with pre-existing debt (Antarctica)", () => {
    const game = readManifest("games/antarctica/authoring/game.authoring.json");
    const before = baselineErrors(game.filePath, game.text).length;
    const { dryRun } = createDryRun(game, "game.AntarcticaInfoBlock");
    const afterErrors = dryRun.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
    // The created node is valid: the after-document has no MORE errors than before.
    expect(afterErrors).toBeLessThanOrEqual(before);
    // And none of the diagnostics point at the newly created entity's subtree.
    expect(dryRun.diagnostics.some((diagnostic) => diagnostic.pointer.includes("proverka-sozdaniya"))).toBe(false);
  });
});
