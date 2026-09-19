import { mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditorMutationCandidate } from "./editor-mutation-candidate";
import { compileGameForEditor } from "./compiler-workflow";

const repoRoot = path.resolve(process.cwd(), ".tmp", "editor-mutation-candidate-tests");
const sourceGame = path.join(repoRoot, "games", "simple-choice");

beforeEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
  await mkdir(path.join(sourceGame, "authoring"), { recursive: true });
  await writeFile(path.join(sourceGame, "game.manifest.json"), "{\"live\":true}\n");
  await writeFile(path.join(sourceGame, "authoring", "game.authoring.json"), "{\"source\":true}\n");
});
afterEach(async () => rm(repoRoot, { recursive: true, force: true }));

describe("mutation candidate root", () => {
  it("copies only the selected game and isolates candidate output bytes", async () => {
    const candidate = await createEditorMutationCandidate({ repoRoot, sessionId: "editor-session-1", gameId: "simple-choice" });
    expect(candidate.repoRoot).toContain("/editor-mutation-previews/");
    expect(await readdir(candidate.repoRoot)).toEqual(["games"]);
    const candidateManifest = path.join(candidate.repoRoot, "games", "simple-choice", "game.manifest.json");
    await writeFile(candidateManifest, "{\"candidate\":true}\n");
    expect(await readFile(path.join(sourceGame, "game.manifest.json"), "utf8")).toBe("{\"live\":true}\n");

    const next = await createEditorMutationCandidate({ repoRoot, sessionId: "editor-session-1", gameId: "simple-choice" });
    expect(next.contentSourceId).not.toBe(candidate.contentSourceId);
    await next.retirePrevious();
    await expect(readFile(candidateManifest, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await next.discard();
  });

  it("rejects symlinks so generated output cannot follow a copied link into live authoring", async () => {
    await symlink(path.join(sourceGame, "authoring", "game.authoring.json"), path.join(sourceGame, "game.manifest.source-map.json"));
    await expect(createEditorMutationCandidate({ repoRoot, sessionId: "editor-session-1", gameId: "simple-choice" }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it("cleans abandoned roots while preserving the current candidate during replacement", async () => {
    const first = await createEditorMutationCandidate({ repoRoot, sessionId: "editor-session-1", gameId: "simple-choice" });
    const parent = path.dirname(first.repoRoot);
    await mkdir(path.join(parent, "abandoned-one"));
    await mkdir(path.join(parent, "abandoned-two"));
    const second = await createEditorMutationCandidate({
      repoRoot, sessionId: "editor-session-1", gameId: "simple-choice", preserveRoot: first.repoRoot
    });
    expect((await readdir(parent)).sort()).toEqual([path.basename(first.repoRoot), path.basename(second.repoRoot)].sort());
    await second.retirePrevious();
    expect(await readdir(parent)).toEqual([path.basename(second.repoRoot)]);
  });

  it("writes compiled preview artifacts only into the candidate root", async () => {
    const projectRoot = path.resolve(process.cwd(), "../..");
    const liveManifest = path.join(projectRoot, "games", "simple-choice", "game.manifest.json");
    const before = await readFile(liveManifest, "utf8");
    const candidate = await createEditorMutationCandidate({
      repoRoot: projectRoot, sessionId: "editor-mutation-candidate-test", gameId: "simple-choice"
    });
    try {
      const result = await compileGameForEditor({
        gameId: "simple-choice", repoRoot: projectRoot,
        generatedArtifactRoot: candidate.repoRoot
      });
      expect(result.ok).toBe(true);
      expect(JSON.parse(await readFile(path.join(candidate.repoRoot, "games", "simple-choice", "game.manifest.json"), "utf8")))
        .toHaveProperty("meta.id", "simple-choice");
      expect(await readFile(liveManifest, "utf8")).toBe(before);
    } finally {
      await candidate.discard();
    }
  });
});
