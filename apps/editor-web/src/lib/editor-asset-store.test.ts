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
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listGameAssets, writeGameAsset } from "./editor-asset-store";
import { EditorRepositoryError } from "./editor-repository";

const repoRoot = path.resolve(process.cwd(), ".tmp", "editor-asset-store-tests");
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
    await seedProject();
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
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
});
