import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  EditorRepositoryError,
  hashText,
  layoutPathForAuthoringFile,
  listAuthoringFiles,
  normalizeAuthoringFilePath,
  openEditorLayout,
  openAuthoringFile,
  saveAuthoringFile,
  saveEditorLayout
} from "./editor-repository";

const repoRoot = path.resolve(process.cwd(), ".tmp", "editor-web-repository-tests");

describe("editor repository adapter", () => {
  beforeEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
    await mkdir(path.join(repoRoot, "games", "simple-choice", "authoring", "ui"), { recursive: true });
    await mkdir(path.join(repoRoot, "games", "simple-choice", "ui", "web"), { recursive: true });
    await writeFile(path.join(repoRoot, "PROJECT_STRUCTURE.yaml"), "test: true\n", "utf8");
    await writeFile(
      path.join(repoRoot, "games", "simple-choice", "authoring", "game.authoring.json"),
      "{\"_manifestType\":\"game\"}\n",
      "utf8"
    );
    await writeFile(
      path.join(repoRoot, "games", "simple-choice", "authoring", "ui", "web.authoring.json"),
      "{\"_manifestType\":\"ui\"}\n",
      "utf8"
    );
    await writeFile(
      path.join(repoRoot, "games", "simple-choice", "game.manifest.json"),
      "{\"generated\":true}\n",
      "utf8"
    );
    await writeFile(
      path.join(repoRoot, "games", "simple-choice", "ui", "web", "ui.manifest.json"),
      "{\"generated\":true}\n",
      "utf8"
    );
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("lists only existing authoring files under the requested game", async () => {
    const result = await listAuthoringFiles({ gameId: "simple-choice", repoRoot });

    expect(result.gameId).toBe("simple-choice");
    expect(result.defaultFilePath).toBe("game.authoring.json");
    expect(result.files.map((file) => file.filePath)).toEqual(["game.authoring.json", "ui/web.authoring.json"]);
    expect(result.files.every((file) => file.versionHash.length === 64)).toBe(true);
  });

  it("opens and saves with an optimistic version hash", async () => {
    const opened = await openAuthoringFile({ gameId: "simple-choice", filePath: "game.authoring.json", repoRoot });
    const saved = await saveAuthoringFile({
      gameId: "simple-choice",
      filePath: "game.authoring.json",
      text: "{\"_manifestType\":\"game\",\"edited\":true}\n",
      versionHash: opened.versionHash,
      repoRoot
    });

    expect(saved.previousVersionHash).toBe(opened.versionHash);
    expect(saved.versionHash).toBe(hashText(saved.text));
    await expect(
      saveAuthoringFile({
        gameId: "simple-choice",
        filePath: "game.authoring.json",
        text: "{}\n",
        versionHash: opened.versionHash,
        repoRoot
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("rejects traversal, absolute paths, runtime manifests, and symlink escapes", async () => {
    expect(() => normalizeAuthoringFilePath("../game.manifest.json")).toThrow(EditorRepositoryError);
    expect(() => normalizeAuthoringFilePath("/tmp/game.authoring.json")).toThrow(EditorRepositoryError);

    await expect(
      openAuthoringFile({ gameId: "simple-choice", filePath: "../game.manifest.json", repoRoot })
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      openAuthoringFile({ gameId: "simple-choice", filePath: "game.manifest.json", repoRoot })
    ).rejects.toMatchObject({ statusCode: 400 });

    await symlink(
      path.join(repoRoot, "games", "simple-choice", "game.manifest.json"),
      path.join(repoRoot, "games", "simple-choice", "authoring", "escaped.authoring.json")
    );
    await expect(
      openAuthoringFile({ gameId: "simple-choice", filePath: "escaped.authoring.json", repoRoot })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("derives editor-only layout sidecar paths from authoring files", () => {
    expect(layoutPathForAuthoringFile("game.authoring.json")).toBe("editor.layout.json");
    expect(layoutPathForAuthoringFile("ui/web.authoring.json")).toBe("ui/web.layout.json");
    expect(() => layoutPathForAuthoringFile("../game.authoring.json")).toThrow(EditorRepositoryError);
  });

  it("opens missing layout as empty state and saves with version checks", async () => {
    const opened = await openEditorLayout({
      gameId: "simple-choice",
      authoringFilePath: "game.authoring.json",
      repoRoot
    });

    expect(opened.layoutFilePath).toBe("editor.layout.json");
    expect(opened.layout).toEqual({ version: 1, nodes: {} });

    const saved = await saveEditorLayout({
      gameId: "simple-choice",
      authoringFilePath: "game.authoring.json",
      layout: { version: 1, nodes: { "$": { position: { x: 10, y: 20 } } } },
      versionHash: opened.versionHash,
      repoRoot
    });

    expect(saved.previousVersionHash).toBe(opened.versionHash);
    expect(saved.versionHash).not.toBe(opened.versionHash);
    expect(
      (
        await openEditorLayout({
          gameId: "simple-choice",
          authoringFilePath: "game.authoring.json",
          repoRoot
        })
      ).layout.nodes.$?.position
    ).toEqual({ x: 10, y: 20 });

    await expect(
      saveEditorLayout({
        gameId: "simple-choice",
        authoringFilePath: "game.authoring.json",
        layout: { version: 1, nodes: {} },
        versionHash: opened.versionHash,
        repoRoot
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("keeps layout sidecars under authoring and rejects symlink escapes", async () => {
    await symlink(
      path.join(repoRoot, "games", "simple-choice", "game.manifest.json"),
      path.join(repoRoot, "games", "simple-choice", "authoring", "ui", "web.layout.json")
    );

    await expect(
      openEditorLayout({
        gameId: "simple-choice",
        authoringFilePath: "ui/web.authoring.json",
        repoRoot
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
