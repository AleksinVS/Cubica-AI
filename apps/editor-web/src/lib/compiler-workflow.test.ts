import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  compilerExportsForTests,
  loadPreviewSelectionSourceMaps,
  mapGeneratedPointerToAuthoring,
  validateAuthoringForEditor
} from "./compiler-workflow";
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
