/**
 * Tests for the server-side game-asset store (ADR-009; ADR-057 §9.4).
 *
 * A temp project holds a game authoring manifest that references one asset and
 * two asset files (one referenced, one orphan). The tests assert:
 *   - `listGameAssets` types assets by extension, counts references
 *     («используется в N местах»), and flags the unreferenced one as an orphan
 *     (the `asset-orphan` diagnostic input);
 *   - `writeGameAsset` decodes base64 and writes the file into the assets tree so
 *     a later listing sees it (upload → worktree → commit on Save);
 *   - path traversal is rejected before any write.
 */
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listGameAssets, resolveGameAssetFile, writeGameAsset } from "./editor-asset-store";
import { EditorRepositoryError } from "./editor-repository";

const repoRoot = path.resolve(process.cwd(), ".tmp", "editor-asset-store-tests");
const outsideRoot = path.resolve(process.cwd(), ".tmp", "editor-asset-store-outside");
const gameId = "simple-choice";

// A game manifest that references `used.png` by its project-relative path.
const gameManifest = JSON.stringify({
  _manifestType: "game",
  root: { screens: [{ id: "start", image: `games/${gameId}/assets/images/used.png` }] }
});

async function seedProject(): Promise<void> {
  const authoring = path.join(repoRoot, "games", gameId, "authoring");
  await mkdir(authoring, { recursive: true });
  await writeFile(path.join(authoring, "game.authoring.json"), `${gameManifest}\n`, "utf8");

  const images = path.join(repoRoot, "games", gameId, "assets", "images");
  await mkdir(images, { recursive: true });
  await writeFile(path.join(images, "used.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(path.join(images, "orphan.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
}

describe("editor-asset-store", () => {
  beforeEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
    await seedProject();
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  });

  it("lists assets with type, usage counter, and orphan flag", async () => {
    const { assets } = await listGameAssets({ gameId, repoRoot });
    const byName = new Map(assets.map((asset) => [asset.name, asset]));

    const used = byName.get("used.png");
    const orphan = byName.get("orphan.png");
    expect(used?.type).toBe("image");
    expect(used?.path).toBe(`games/${gameId}/assets/images/used.png`);
    expect(used?.usageCount).toBe(1);
    expect(used?.orphan).toBe(false);
    expect(orphan?.usageCount).toBe(0);
    expect(orphan?.orphan).toBe(true);
  });

  it("writes an uploaded asset into the assets tree (base64 → bytes)", async () => {
    const contentBase64 = Buffer.from("hello-audio").toString("base64");
    const written = await writeGameAsset({ gameId, repoRoot, relativePath: "audio/theme.mp3", contentBase64 });

    expect(written.type).toBe("audio");
    expect(written.path).toBe(`games/${gameId}/assets/audio/theme.mp3`);
    const onDisk = await readFile(path.join(repoRoot, "games", gameId, "assets", "audio", "theme.mp3"), "utf8");
    expect(onDisk).toBe("hello-audio");

    const { assets } = await listGameAssets({ gameId, repoRoot });
    expect(assets.some((asset) => asset.name === "theme.mp3")).toBe(true);
  });

  it("rejects path traversal before writing", async () => {
    await expect(
      writeGameAsset({ gameId, repoRoot, relativePath: "../../escape.png", contentBase64: Buffer.from("x").toString("base64") })
    ).rejects.toBeInstanceOf(EditorRepositoryError);
  });

  it("refuses to read an asset symlink that resolves outside the assets root", async () => {
    const outsideFile = path.join(outsideRoot, "secret.png");
    await mkdir(outsideRoot, { recursive: true });
    await writeFile(outsideFile, "secret", "utf8");
    await symlink(outsideFile, path.join(repoRoot, "games", gameId, "assets", "images", "outside.png"));

    await expect(resolveGameAssetFile({ gameId, repoRoot, relativePath: "images/outside.png" })).rejects.toMatchObject({
      statusCode: 400
    });
  });

  it("refuses to overwrite an asset symlink that resolves outside the assets root", async () => {
    const outsideFile = path.join(outsideRoot, "secret.png");
    await mkdir(outsideRoot, { recursive: true });
    await writeFile(outsideFile, "original", "utf8");
    await symlink(outsideFile, path.join(repoRoot, "games", gameId, "assets", "images", "outside.png"));

    await expect(
      writeGameAsset({ gameId, repoRoot, relativePath: "images/outside.png", contentBase64: Buffer.from("changed").toString("base64") })
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(readFile(outsideFile, "utf8")).resolves.toBe("original");
  });

  it("refuses an assets directory symlink that resolves outside the game directory", async () => {
    const assets = path.join(repoRoot, "games", gameId, "assets");
    await rm(assets, { recursive: true, force: true });
    await mkdir(outsideRoot, { recursive: true });
    await writeFile(path.join(outsideRoot, "secret.png"), "original", "utf8");
    await symlink(outsideRoot, assets, "dir");

    await expect(
      resolveGameAssetFile({ gameId, repoRoot, relativePath: "secret.png" })
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      writeGameAsset({
        gameId,
        repoRoot,
        relativePath: "created.png",
        contentBase64: Buffer.from("changed").toString("base64")
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(readFile(path.join(outsideRoot, "secret.png"), "utf8")).resolves.toBe("original");
  });

  it("refuses an assets directory symlink into another directory of the same game", async () => {
    const gameRoot = path.join(repoRoot, "games", gameId);
    const assets = path.join(gameRoot, "assets");
    const authoringFile = path.join(gameRoot, "authoring", "game.authoring.json");
    const original = await readFile(authoringFile, "utf8");
    await rm(assets, { recursive: true, force: true });
    await symlink(path.join(gameRoot, "authoring"), assets, "dir");

    await expect(
      resolveGameAssetFile({ gameId, repoRoot, relativePath: "game.authoring.json" })
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      writeGameAsset({
        gameId,
        repoRoot,
        relativePath: "game.authoring.json",
        contentBase64: Buffer.from("changed").toString("base64")
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(readFile(authoringFile, "utf8")).resolves.toBe(original);
  });

  it("refuses a game directory symlink to an external asset tree", async () => {
    const gameRoot = path.join(repoRoot, "games", gameId);
    const outsideAssets = path.join(outsideRoot, "assets");
    await rm(gameRoot, { recursive: true, force: true });
    await mkdir(outsideAssets, { recursive: true });
    const outsideFile = path.join(outsideAssets, "secret.png");
    await writeFile(outsideFile, "original", "utf8");
    await symlink(outsideRoot, gameRoot, "dir");

    await expect(
      resolveGameAssetFile({ gameId, repoRoot, relativePath: "secret.png" })
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      writeGameAsset({
        gameId,
        repoRoot,
        relativePath: "created.png",
        contentBase64: Buffer.from("changed").toString("base64")
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(readFile(outsideFile, "utf8")).resolves.toBe("original");
  });

  it("does not interpret gameId punctuation as a regular expression", async () => {
    const dottedGameId = "simple.choice";
    const dottedImages = path.join(repoRoot, "games", dottedGameId, "assets", "images");
    await mkdir(dottedImages, { recursive: true });
    await writeFile(path.join(dottedImages, "used.png"), "safe", "utf8");

    await expect(
      resolveGameAssetFile({
        gameId: dottedGameId,
        repoRoot,
        // `simpleXchoice` matched the old unescaped `simple.choice` regexp.
        relativePath: "games/simpleXchoice/assets/images/used.png"
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
