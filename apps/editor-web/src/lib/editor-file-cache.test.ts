/**
 * Tests for the Level-2 disk warm-start cache (ADR-057 §4.13; UX §10).
 *
 * Covers: atomic write + revive round-trip, corrupt-file -> silent miss,
 * concurrent writes of one key, end-to-end hit/miss telemetry, size/LRU GC, and
 * a local build-vs-revive measurement on a heavy authoring file (design-spec §5).
 */
import { mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, afterAll } from "vitest";

import { createDocumentStore, serializeDocumentSnapshot } from "@cubica/editor-engine";
import {
  computeFileArtifactKey,
  createEditorFileCacheTelemetry,
  garbageCollectEditorCache,
  loadDocumentSnapshotWithCache,
  readFileArtifact,
  writeFileArtifact
} from "./editor-file-cache";

const workspaceRoot = path.resolve(process.cwd(), "..", "..");
const testRoot = path.join(workspaceRoot, ".tmp", "editor-file-cache-tests");

function uniqueDir(name: string): string {
  return path.join(testRoot, `${name}-${process.pid}-${Math.random().toString(36).slice(2)}`);
}

const sampleText = `${JSON.stringify({ _type: "game.manifest", id: "x", _label: "X", root: { a: 1 } }, null, 2)}\n`;

function buildSampleSnapshot(filePath: string, text: string) {
  return createDocumentStore({ filePath, text }).snapshot();
}

afterAll(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

describe("editor file cache", () => {
  it("writes atomically and revives a byte-identical snapshot (miss then hit)", async () => {
    const dir = uniqueDir("round-trip");
    const key = computeFileArtifactKey("game.authoring.json", sampleText);
    const original = buildSampleSnapshot("game.authoring.json", sampleText);

    expect(await readFileArtifact(dir, key)).toBeNull(); // cold: miss
    await writeFileArtifact(dir, key, original);

    const revived = await readFileArtifact(dir, key);
    expect(revived).not.toBeNull();
    expect(serializeDocumentSnapshot(revived!).payload).toEqual(serializeDocumentSnapshot(original).payload);
  });

  it("treats a corrupt cache file as a silent miss", async () => {
    const dir = uniqueDir("corrupt");
    const key = computeFileArtifactKey("game.authoring.json", sampleText);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${key}.json`), "{ this is not valid json", "utf8");

    expect(await readFileArtifact(dir, key)).toBeNull();
  });

  it("survives concurrent writes of the same key (byte-identical, no corruption)", async () => {
    const dir = uniqueDir("concurrent");
    const key = computeFileArtifactKey("game.authoring.json", sampleText);
    const snapshot = buildSampleSnapshot("game.authoring.json", sampleText);

    await Promise.all(Array.from({ length: 8 }, () => writeFileArtifact(dir, key, snapshot)));

    const revived = await readFileArtifact(dir, key);
    expect(revived).not.toBeNull();
    expect(serializeDocumentSnapshot(revived!).payload).toEqual(serializeDocumentSnapshot(snapshot).payload);
  });

  it("records a miss on first load and a hit on the second via the real cache dir", async () => {
    // Unique content makes the key fresh regardless of prior test runs.
    const filePath = "game.authoring.json";
    const text = `${JSON.stringify({ _type: "game.manifest", id: "hitmiss", n: Date.now(), r: Math.random() })}\n`;
    const telemetry = createEditorFileCacheTelemetry();

    await loadDocumentSnapshotWithCache({ filePath, text, telemetry });
    // Deferred write is fire-and-forget; the write itself is small and awaited internally.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await loadDocumentSnapshotWithCache({ filePath, text, telemetry });

    const snapshot = telemetry.snapshot();
    expect(snapshot.cacheMisses).toBe(1);
    expect(snapshot.cacheHits).toBe(1);
  });

  it("bypasses the cache when disabled", async () => {
    const telemetry = createEditorFileCacheTelemetry();
    const result = await loadDocumentSnapshotWithCache({
      filePath: "game.authoring.json",
      text: sampleText,
      telemetry,
      cacheEnabled: false
    });
    expect(result.json).toEqual(JSON.parse(sampleText));
    expect(telemetry.snapshot()).toEqual({ cacheHits: 0, cacheMisses: 0, hitReviveMs: 0, missBuildMs: 0 });
  });

  it("evicts the least-recently-used files once the size limit is exceeded", async () => {
    const cacheRoot = uniqueDir("gc");
    const filesDir = path.join(cacheRoot, "files");
    await mkdir(filesDir, { recursive: true });

    const payload = "x".repeat(4096); // 4 KiB per file
    const old = path.join(filesDir, "old.json");
    const mid = path.join(filesDir, "mid.json");
    const fresh = path.join(filesDir, "fresh.json");
    for (const filePath of [old, mid, fresh]) {
      await writeFile(filePath, payload, "utf8");
    }
    const base = Date.now();
    await utimes(old, new Date(base - 3_000_000), new Date(base - 3_000_000));
    await utimes(mid, new Date(base - 2_000_000), new Date(base - 2_000_000));
    await utimes(fresh, new Date(base), new Date(base));

    // Limit of ~9 KiB fits two of the three 4 KiB files, so exactly the oldest is evicted.
    const dry = await garbageCollectEditorCache({ cacheRoot, maxBytes: 9 * 1024, dryRun: true });
    expect(dry).toEqual([old]);
    await expect(stat(old)).resolves.toBeDefined(); // dry-run did not delete

    const removed = await garbageCollectEditorCache({ cacheRoot, maxBytes: 9 * 1024, dryRun: false });
    expect(removed).toEqual([old]);
    await expect(stat(old)).rejects.toThrow(); // evicted
    await expect(stat(mid)).resolves.toBeDefined(); // fresher kept
    await expect(stat(fresh)).resolves.toBeDefined();
  });

  it("does nothing when the cache is under the size limit", async () => {
    const cacheRoot = uniqueDir("gc-under");
    await mkdir(path.join(cacheRoot, "files"), { recursive: true });
    await writeFile(path.join(cacheRoot, "files", "a.json"), "small", "utf8");
    expect(await garbageCollectEditorCache({ cacheRoot, maxBytes: 1024 * 1024, dryRun: false })).toEqual([]);
  });

  it("measures build vs revive on a heavy authoring file (design-spec §5)", async () => {
    const filePath = "games/antarctica/authoring/game.authoring.json";
    const text = await readFile(path.join(workspaceRoot, filePath), "utf8");

    const buildStart = performance.now();
    const snapshot = createDocumentStore({ filePath, text }).snapshot();
    const buildMs = performance.now() - buildStart;

    const envelope = serializeDocumentSnapshot(snapshot);
    const serialized = JSON.stringify(envelope);
    const dir = uniqueDir("measure");
    const key = computeFileArtifactKey(filePath, text);
    await writeFileArtifact(dir, key, snapshot);

    const reviveStart = performance.now();
    const revived = await readFileArtifact(dir, key);
    const reviveMs = performance.now() - reviveStart;

    expect(revived).not.toBeNull();
    // eslint-disable-next-line no-console
    console.log(
      `[L2 measure] antarctica build=${buildMs.toFixed(1)}ms revive=${reviveMs.toFixed(1)}ms ` +
        `payload=${(serialized.length / 1024).toFixed(0)}KiB speedup=${(buildMs / reviveMs).toFixed(1)}x`
    );
  });
});
