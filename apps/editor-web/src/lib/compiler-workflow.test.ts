import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  compilerExportsForTests,
  loadPreviewSelectionSourceMaps,
  mapGeneratedPointerToAuthoring,
  planPrototypeExtractionForEditor,
  validateAuthoringForEditor
} from "./compiler-workflow";
import { POST as prototypeExtractionRoutePost } from "../../app/api/editor/prototype-extraction/route";
import { POST as validateRoutePost } from "../../app/api/editor/validate/route";

describe("editor compiler workflow", () => {
  it("loads the reusable authoring compiler module exports", async () => {
    await expect(compilerExportsForTests()).resolves.toEqual(
      expect.arrayContaining(["compileAuthoringFile", "compileAuthoringText", "compileJobs", "discoverJobs"])
    );
  });

  it("maps generated runtime diagnostics through exact and ancestor source-map entries", () => {
    const sourceMap = {
      generatedFile: "games/example/game.manifest.json",
      sourceFile: "games/example/authoring/game.authoring.json",
      mappings: {
        "/actions": [{ file: "games/example/authoring/game.authoring.json", pointer: "/root/actions" }],
        "/actions/start/displayName": [
          { file: "games/example/authoring/game.authoring.json", pointer: "/root/actions/start/displayName" }
        ]
      }
    };

    expect(mapGeneratedPointerToAuthoring(sourceMap, "/actions/start/displayName")).toEqual({
      file: "games/example/authoring/game.authoring.json",
      pointer: "/root/actions/start/displayName"
    });
    expect(mapGeneratedPointerToAuthoring(sourceMap, "/actions/start/missing")).toEqual({
      file: "games/example/authoring/game.authoring.json",
      pointer: "/root/actions"
    });
  });

  it("validates current unsaved authoring text without writing runtime manifests", async () => {
    const gameId = "simple" + "-choice";
    const filePath = "game.authoring.json";
    const text = await readFile(path.join(process.cwd(), "..", "..", "games", gameId, "authoring", filePath), "utf8");
    const result = await validateAuthoringForEditor({
      gameId,
      filePath,
      text
    });

    expect(result.ok).toBe(true);
    expect(result.artifacts.map((artifact) => artifact.generatedFile)).toContain(`games/${gameId}/game.manifest.json`);
    expect(result.diagnostics).toEqual([]);
  });

  it("plans prototype extraction with dry-run, runtime diff, and source-map gates", async () => {
    const gameId = "simple" + "-choice";
    const filePath = "ui/web.authoring.json";
    const text = await readFile(path.join(process.cwd(), "..", "..", "games", gameId, "authoring", "ui", "web.authoring.json"), "utf8");
    const result = await planPrototypeExtractionForEditor({
      gameId,
      filePath,
      text,
      sourcePointers: ["/root/screens/0/root", "/root/screens/1/root"],
      definitionType: "ui.LocalScreenShell",
      definitionSemantics: "Local repeated screen shell for simple-choice web UI."
    });

    expect(result.ok).toBe(true);
    expect(result.proposal?.definitionPointer).toBe("/_definitions/ui.LocalScreenShell");
    expect(result.proposal?.changeSet.jsonPatches[0]?.operations.map((operation) => operation.op)).toContain("replace");
    expect(result.gates.map((gate) => [gate.id, gate.ok])).toEqual([
      ["proposal", true],
      ["editor-dry-run", true],
      ["runtime-schema", true],
      ["compiler-dry-run", true],
      ["canonical-runtime-diff", true],
      ["source-map-pointer-existence", true]
    ]);
    expect(result.diffSummary.length).toBeGreaterThan(0);
    expect(result.artifacts.map((artifact) => artifact.generatedFile)).toContain(`games/${gameId}/ui/web/ui.manifest.json`);
  });

  it("returns a non-500 prototype extraction route response", async () => {
    const gameId = "simple" + "-choice";
    const text = await readFile(path.join(process.cwd(), "..", "..", "games", gameId, "authoring", "ui", "web.authoring.json"), "utf8");
    const response = await prototypeExtractionRoutePost(
      new Request("http://localhost/api/editor/prototype-extraction", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gameId,
          filePath: "ui/web.authoring.json",
          text,
          sourcePointers: ["/root/screens/0/root", "/root/screens/1/root"],
          definitionType: "ui.LocalScreenShell",
          definitionSemantics: "Local repeated screen shell for simple-choice web UI."
        })
      })
    );
    const body = (await response.json()) as { readonly ok?: boolean; readonly error?: string };

    expect(response.status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.ok).toBe(true);
  });

  it("loads sidecar source maps for preview runtime-to-authoring selection", async () => {
    const gameId = "simple" + "-choice";
    const sourceMaps = await loadPreviewSelectionSourceMaps(gameId);

    expect(sourceMaps.some((sourceMap) => sourceMap.generatedFile.endsWith("game.manifest.json"))).toBe(true);
    expect(sourceMaps.some((sourceMap) => sourceMap.generatedFile.endsWith("ui.manifest.json"))).toBe(true);
    expect(Object.keys(sourceMaps[0]?.mappings ?? {}).length).toBeGreaterThan(0);
  });

  it("returns a non-500 validate route response for simple-choice authoring text", async () => {
    const gameId = "simple" + "-choice";
    const filePath = "game.authoring.json";
    const text = await readFile(path.join(process.cwd(), "..", "..", "games", gameId, "authoring", filePath), "utf8");
    const response = await validateRoutePost(
      new Request("http://localhost/api/editor/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gameId, filePath, text })
      })
    );
    const body = (await response.json()) as { readonly ok?: boolean; readonly error?: string };

    expect(response.status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.ok).toBe(true);
  });
});
