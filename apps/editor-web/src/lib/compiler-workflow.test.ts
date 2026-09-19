import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  compileGameForEditor,
  compilerExportsForTests,
  loadPreviewSelectionSourceMaps,
  mapGeneratedPointerToAuthoring,
  planPrototypeExtractionForEditor,
  validateAuthoringForEditor,
  writeJsonFileForTests
} from "./compiler-workflow";
import { POST as prototypeExtractionRoutePost } from "../../app/api/editor/prototype-extraction/route";
import { POST as validateRoutePost } from "../../app/api/editor/validate/route";

describe("editor compiler workflow", () => {
  it("loads the reusable authoring compiler module exports", async () => {
    await expect(compilerExportsForTests()).resolves.toEqual(
      expect.arrayContaining(["compileAuthoringFile", "compileAuthoringText", "compileJobs", "discoverJobs"])
    );
  });

  it("preserves the previous generated JSON when an editor write fails", async () => {
    const directory = path.join(process.cwd(), "..", "..", ".tmp", `atomic-editor-write-${process.pid}-${randomUUID()}`);
    const target = path.join(directory, "game.manifest.json");
    const previous = { version: "previous" };
    await mkdir(directory, { recursive: true });
    await writeFile(target, `${JSON.stringify(previous)}\n`, "utf8");

    try {
      await expect(writeJsonFileForTests(target, { version: "next" }, {
        mkdir,
        writeFile: async (filePath, _data, options) => {
          await writeFile(filePath, "{ partial", options);
          throw new Error("simulated interrupted write");
        },
        rename,
        rm
      })).rejects.toThrow("simulated interrupted write");

      await expect(readFile(target, "utf8").then(JSON.parse)).resolves.toEqual(previous);
      await expect(readdir(directory)).resolves.toEqual(["game.manifest.json"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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
    // "/actions" has no `verbatimSubtrees` marker here, so this is the
    // identical-match (rule 1) case: the ancestor's own pointer is the exact
    // answer, unchanged — appending "/missing" would fabricate a pointer that
    // was never recorded.
    expect(mapGeneratedPointerToAuthoring(sourceMap, "/actions/start/missing")).toEqual({
      file: "games/example/authoring/game.authoring.json",
      pointer: "/root/actions"
    });
  });

  it("reconstructs the exact authoring pointer under a verbatim subtree", () => {
    // A large literal subtree (e.g. authored polygon vertices) is published as
    // one recorded entry plus a `verbatimSubtrees` marker, instead of one
    // entry per vertex — see authoring-compiler.cjs's `isPositionalMatch`.
    const verbatimMap = {
      generatedFile: "games/example/game.manifest.json",
      sourceFile: "games/example/authoring/game.authoring.json",
      mappings: {
        "/networkModels": [{ file: "games/example/authoring/game.authoring.json", pointer: "/root/networkModels" }]
      },
      verbatimSubtrees: ["/networkModels"]
    };

    expect(mapGeneratedPointerToAuthoring(verbatimMap, "/networkModels/main/regions/0/polygon/1/x")).toEqual({
      file: "games/example/authoring/game.authoring.json",
      pointer: "/root/networkModels/main/regions/0/polygon/1/x"
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

  it("compiles the selected game's session sources into the requested preview root", async () => {
    const gameId = "simple-choice";
    const projectRoot = path.join(process.cwd(), "..", "..");
    const fixtureRoot = path.join(projectRoot, ".tmp", `editor-compile-source-${process.pid}-${randomUUID()}`);
    const authoringRoot = path.join(fixtureRoot, "games", gameId, "authoring");
    const candidateRoot = path.join(fixtureRoot, "candidate");
    const uiSourcePath = path.join(authoringRoot, "ui", "web.authoring.json");
    await mkdir(path.dirname(uiSourcePath), { recursive: true });

    try {
      const gameText = await readFile(path.join(projectRoot, "games", gameId, "authoring", "game.authoring.json"), "utf8");
      const uiText = await readFile(path.join(projectRoot, "games", gameId, "authoring", "ui", "web.authoring.json"), "utf8");
      const ui = JSON.parse(uiText) as {
        root: { screens: Array<{ root: { children: Array<{ children: Array<{ style?: { width: number; height: number } }> }> } }> };
      };
      expect(ui.root.screens[0]!.root.children[0]!.children[0]!.style).not.toEqual({ width: 220, height: 200 });
      ui.root.screens[0]!.root.children[0]!.children[0]!.style = { width: 220, height: 200 };
      await writeFile(path.join(authoringRoot, "game.authoring.json"), gameText);
      await writeFile(uiSourcePath, `${JSON.stringify(ui)}\n`);

      const result = await compileGameForEditor({ gameId, repoRoot: fixtureRoot, generatedArtifactRoot: candidateRoot });
      expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
      const candidateUiPath = path.join(candidateRoot, "games", gameId, "ui", "web", "ui.manifest.json");
      const candidateUi = JSON.parse(await readFile(candidateUiPath, "utf8")) as {
        screens: { intro: { root: { children: Array<{ children: Array<{ style?: unknown }> }> } } };
      };
      expect(candidateUi.screens.intro.root.children[0]!.children[0]!.style).toEqual({ width: 220, height: 200 });
      const sourceMap = JSON.parse(await readFile(candidateUiPath.replace("ui.manifest.json", "ui.manifest.source-map.json"), "utf8")) as {
        sourceFile: string;
      };
      expect(sourceMap.sourceFile).toBe(`games/${gameId}/authoring/ui/web.authoring.json`);
      expect((await loadPreviewSelectionSourceMaps(gameId, fixtureRoot, candidateRoot))
        .some((map) => map.sourceFile === sourceMap.sourceFile)).toBe(true);

      const currentResult = await compileGameForEditor({ gameId, repoRoot: fixtureRoot });
      expect(currentResult.ok, JSON.stringify(currentResult.diagnostics)).toBe(true);
      const currentUi = JSON.parse(await readFile(path.join(fixtureRoot, "games", gameId, "ui", "web", "ui.manifest.json"), "utf8")) as {
        screens: { intro: { root: { children: Array<{ children: Array<{ style?: unknown }> }> } } };
      };
      expect(currentUi.screens.intro.root.children[0]!.children[0]!.style).toEqual({ width: 220, height: 200 });
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
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
