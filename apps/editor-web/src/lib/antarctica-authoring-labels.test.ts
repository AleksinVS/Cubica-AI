import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { dryRunMultiDocumentChangeSet, type EditorChangeSet, type JsonValue } from "@cubica/editor-engine";
import { compileGameForEditor, validateAuthoringForEditor } from "./compiler-workflow";
import { getSharedAuthoringSchemaRegistry, schemaIdForAuthoringDocument } from "./editor-json-schema";

const gameId = "antarctica";
const gamePath = "game.authoring.json";
const uiPath = "ui/web.authoring.json";
const projectRoot = path.join(process.cwd(), "..", "..");

type AuthoringNode = { _type?: string; _label?: string; [key: string]: unknown };

function removeNewAuthorLabels(document: AuthoringNode, kind: "game" | "ui"): number {
  if (kind === "game") {
    const cards = ((document.root as AuthoringNode).state as AuthoringNode).public as AuthoringNode;
    const states = ((cards.objects as AuthoringNode).cards as Record<string, AuthoringNode>);
    for (const state of Object.values(states)) delete state._label;
    return Object.keys(states).length;
  }

  const panels = ((document.root as AuthoringNode).panels as Record<string, AuthoringNode>);
  let removed = 0;
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    const node = value as AuthoringNode;
    if (node._type && node._label) {
      delete node._label;
      removed += 1;
    }
    for (const child of Object.values(node)) visit(child);
  };
  for (const panel of Object.values(panels)) visit(panel);
  return removed;
}

describe("Antarctica authoring labels", () => {
  it("validates and dry-runs edits against both complete documents while keeping runtime output unchanged", async () => {
    const authoringRoot = path.join(projectRoot, "games", gameId, "authoring");
    const gameText = await readFile(path.join(authoringRoot, gamePath), "utf8");
    const uiText = await readFile(path.join(authoringRoot, uiPath), "utf8");

    for (const [filePath, text] of [[gamePath, gameText], [uiPath, uiText]] as const) {
      const validation = await validateAuthoringForEditor({ gameId, filePath, text, repoRoot: projectRoot });
      expect(validation.ok, JSON.stringify(validation.diagnostics)).toBe(true);
    }

    const changeSet: EditorChangeSet = {
      id: "antarctica-label-regression",
      summary: "Edit a card state and a panel label",
      jsonPatches: [
        { filePath: gamePath, operations: [{ op: "replace", path: "/root/state/public/objects/cards/1/_label", value: "Доступность первой карточки" }] },
        { filePath: uiPath, operations: [{ op: "replace", path: "/root/panels/hint/_label", value: "Подсказка игроку" }] }
      ]
    };
    const dryRun = dryRunMultiDocumentChangeSet({
      changeSet,
      documentTextByPath: new Map([[gamePath, gameText], [uiPath, uiText]]),
      schemaRegistry: getSharedAuthoringSchemaRegistry(),
      resolveSchemaId: (filePath) => schemaIdForAuthoringDocument(filePath, undefined),
      includeSemanticDiagnostics: true
    });
    expect(dryRun.ok, JSON.stringify(dryRun.diagnostics)).toBe(true);
    expect(dryRun.afterTextByPath.size).toBe(2);

    // Recreate only the missing metadata from before this migration. Both
    // versions must publish the same runtime manifests, not merely pass schema.
    const beforeGame = JSON.parse(gameText) as AuthoringNode;
    const beforeUi = JSON.parse(uiText) as AuthoringNode;
    expect(removeNewAuthorLabels(beforeGame, "game")).toBe(71);
    expect(removeNewAuthorLabels(beforeUi, "ui")).toBe(18);
    const outputRoot = path.join(projectRoot, ".tmp", `antarctica-labels-${process.pid}-${randomUUID()}`);
    try {
      const before = await compileGameForEditor({
        gameId,
        repoRoot: projectRoot,
        generatedArtifactRoot: path.join(outputRoot, "before"),
        authoringTextOverrides: new Map([
          [gamePath, `${JSON.stringify(beforeGame)}\n`],
          [uiPath, `${JSON.stringify(beforeUi)}\n`]
        ])
      });
      const after = await compileGameForEditor({
        gameId,
        repoRoot: projectRoot,
        generatedArtifactRoot: path.join(outputRoot, "after")
      });
      expect(before.ok, JSON.stringify(before.diagnostics)).toBe(true);
      expect(after.ok, JSON.stringify(after.diagnostics)).toBe(true);
      expect(after.artifacts.map((artifact) => artifact.generatedFile)).toEqual(before.artifacts.map((artifact) => artifact.generatedFile));
      expect(after.artifacts.map((artifact) => artifact.generatedFile)).toEqual(expect.arrayContaining([
        `games/${gameId}/game.manifest.json`,
        `games/${gameId}/ui/web/ui.manifest.json`
      ]));
      for (const artifact of after.artifacts) {
        const relativeFile = artifact.generatedFile;
        const beforeRuntime = JSON.parse(await readFile(path.join(outputRoot, "before", relativeFile), "utf8")) as JsonValue;
        const afterRuntime = JSON.parse(await readFile(path.join(outputRoot, "after", relativeFile), "utf8")) as JsonValue;
        expect(afterRuntime, relativeFile).toEqual(beforeRuntime);
      }
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  }, 60_000);
});
