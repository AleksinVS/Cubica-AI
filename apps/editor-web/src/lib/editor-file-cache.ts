/**
 * Level-2 disk warm-start cache for per-file DocumentStore snapshots
 * (ADR-057 §4.13 "Уровень 2"; editor-preview-first-ux §10; design-spec §2.6).
 *
 * WHAT THIS IS. The server-side half of the Level-2 cache. It stores one
 * `DocumentSnapshot` (parse tree + text location map + syntax diagnostics) per
 * authoring file on disk under `.tmp/editor-cache/files/<key>.json`, keyed by a
 * summary hash of everything the snapshot depends on. A cache hit revives the
 * snapshot instead of re-parsing — and building the location map is ~98% of the
 * parse cost, which is the hottest server point (`createDocumentStore(...)
 * .snapshot()` runs on every validate/compile request; profiling baseline §9).
 * The serialization/revival lives framework-agnostic in editor-engine; this
 * module is the Node-only disk layer.
 *
 * WHAT IS AND IS NOT CACHED. Only the snapshot is cached. A snapshot carries
 * SYNTAX diagnostics only (they are a pure function of the text, so they are
 * safe to cache). Schema and semantic diagnostics (`validateDocument`) and the
 * generated-runtime compile results are NOT stored here, because this key does
 * not hash the JSON Schemas or the compiler — folding schema-dependent results
 * into a text-only key would violate "any uncounted key input is a cache design
 * error" (ADR-057 §5). Compile results have their own Level-3 cache whose key
 * DOES hash the schemas and the compiler (profiling baseline §9.7).
 *
 * INVARIANTS (ADR-057 §5, editor-preview-first-ux §10).
 *   - One-shot: never a source of truth, never an input to compilation/runtime.
 *   - Any mismatch / missing / corrupt file → SILENT miss and a normal rebuild;
 *     read failures are swallowed, never surfaced.
 *   - Content-addressed, so the cache is independent of the Git worktree: two
 *     editor sessions or branches with identical file content share one entry.
 *   - Files live only under `.tmp/` (outside Git); deleting any of them is safe.
 *
 * CONCURRENCY (profiling baseline §9.6). Several requests/workers may build the
 * same file in parallel. Writes are atomic (unique temp file + `rename`), so a
 * reader never observes a half-written file. Two writers of the same key produce
 * BYTE-IDENTICAL content (the snapshot is a deterministic function of the key
 * inputs), so a write race cannot corrupt an entry — the last `rename` wins with
 * the same bytes. There are no global locks serializing the pipeline.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DOCUMENT_SNAPSHOT_CACHE_FORMAT_VERSION,
  createDocumentStore,
  reviveDocumentSnapshot,
  serializeDocumentSnapshot,
  type DocumentSnapshot
} from "@cubica/editor-engine";

/**
 * Bumping this invalidates every previously written per-file entry. It is mixed
 * into the key alongside the editor-engine snapshot format version, so a change
 * to either the disk layout here or the snapshot shape in the engine can never
 * read back a stale-shaped file.
 */
export const FILE_ARTIFACT_CACHE_FORMAT_VERSION = 1;

/** Default cap on the total size of `.tmp/editor-cache/` before LRU eviction. */
export const EDITOR_CACHE_DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

/**
 * Level-2 hit/miss + duration telemetry for a single validate/compile run
 * (design-spec §5), mirroring the Level-3 compile telemetry shape. Durations are
 * milliseconds: revive time on hits, build (parse) time on misses.
 */
export interface EditorFileCacheTelemetry {
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly hitReviveMs: number;
  readonly missBuildMs: number;
}

export interface EditorFileCacheTelemetryRecorder {
  recordHit(ms: number): void;
  recordMiss(ms: number): void;
  snapshot(): EditorFileCacheTelemetry;
}

export function createEditorFileCacheTelemetry(): EditorFileCacheTelemetryRecorder {
  let cacheHits = 0;
  let cacheMisses = 0;
  let hitReviveMs = 0;
  let missBuildMs = 0;
  const round = (ms: number): number => Math.round(ms * 1000) / 1000;

  return {
    recordHit(ms) {
      cacheHits += 1;
      hitReviveMs += ms;
    },
    recordMiss(ms) {
      cacheMisses += 1;
      missBuildMs += ms;
    },
    snapshot() {
      return { cacheHits, cacheMisses, hitReviveMs: round(hitReviveMs), missBuildMs: round(missBuildMs) };
    }
  };
}

/**
 * Computes the per-file cache key.
 *
 * KEY INPUTS (each is a genuine input of the snapshot; an uncounted input would
 * be a cache design error — ADR-057 §5):
 *   - `FILE_ARTIFACT_CACHE_FORMAT_VERSION` — this module's disk layout;
 *   - `DOCUMENT_SNAPSHOT_CACHE_FORMAT_VERSION` — the editor-engine snapshot shape
 *     and the parser that produced it (chosen over `PROJECTION_LENS_SET_VERSION`
 *     on purpose: the cached artifact is the DocumentStore snapshot, not the
 *     entity projection, so the snapshot's own format version is the correct and
 *     minimal engine input; projection-lens version does not affect it);
 *   - `filePath` — the snapshot embeds `filePath`, so two files with identical
 *     text must not share an entry;
 *   - the full file text — the only content the parse output depends on.
 * SHA-256 is content-addressing (collision-resistant), unlike the engine's cheap
 * 32-bit `hashEditorText`, which is unsuitable as a cache key.
 */
export function computeFileArtifactKey(filePath: string, text: string): string {
  return createHash("sha256")
    .update("editor-file-artifact\n")
    .update(`${FILE_ARTIFACT_CACHE_FORMAT_VERSION}\n`)
    .update(`${DOCUMENT_SNAPSHOT_CACHE_FORMAT_VERSION}\n`)
    .update(`${filePath}\n`)
    .update(text)
    .digest("hex");
}

/** Reads a cache entry, returning a revived snapshot on a clean hit or `null` on any miss. Never throws. */
export async function readFileArtifact(cacheDir: string, key: string): Promise<DocumentSnapshot | null> {
  try {
    const text = await readFile(cacheEntryPath(cacheDir, key), "utf8");
    return reviveDocumentSnapshot(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * Atomically writes a cache entry (unique temp file + `rename`). Best-effort:
 * any failure is swallowed and the orphaned temp file is removed, because a
 * cache that cannot be written must never fail the request.
 */
export async function writeFileArtifact(cacheDir: string, key: string, snapshot: DocumentSnapshot): Promise<void> {
  const tempPath = path.join(cacheDir, `.${key}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(tempPath, `${JSON.stringify(serializeDocumentSnapshot(snapshot))}\n`, "utf8");
    await rename(tempPath, cacheEntryPath(cacheDir, key));
  } catch {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

/**
 * Returns a DocumentStore snapshot for `{ filePath, text }`, using the disk
 * cache: a hit revives the stored snapshot; a miss builds it and schedules a
 * DEFERRED, fire-and-forget write so the response is never blocked and a write
 * failure can never break the request.
 */
export async function loadDocumentSnapshotWithCache(input: {
  readonly filePath: string;
  readonly text: string;
  readonly telemetry?: EditorFileCacheTelemetryRecorder;
  readonly cacheEnabled?: boolean;
}): Promise<DocumentSnapshot> {
  const buildSnapshot = (): DocumentSnapshot =>
    createDocumentStore({ filePath: input.filePath, text: input.text }).snapshot();

  if (!(input.cacheEnabled ?? isEditorFileCacheEnabled())) {
    return buildSnapshot();
  }

  const cacheDir = await resolveEditorCacheFilesDir();
  const key = computeFileArtifactKey(input.filePath, input.text);

  const reviveStart = performance.now();
  const cached = await readFileArtifact(cacheDir, key);
  if (cached !== null) {
    input.telemetry?.recordHit(performance.now() - reviveStart);
    return cached;
  }

  const buildStart = performance.now();
  const snapshot = buildSnapshot();
  input.telemetry?.recordMiss(performance.now() - buildStart);

  // Deferred write: do not await, and swallow errors — the cache is one-shot.
  void writeFileArtifact(cacheDir, key, snapshot).catch(() => undefined);
  return snapshot;
}

/**
 * Garbage-collects the whole `.tmp/editor-cache/` tree (per-file Level-2 AND
 * Level-3 compile entries) by total-size limit with LRU eviction.
 *
 * When the tree exceeds `maxBytes`, the least-recently-used files (oldest by
 * `max(atime, mtime)`, which is robust even under `noatime`/`relatime` mounts)
 * are removed until the tree is back under the limit. Deletion is always safe
 * (every cache file is one-shot). In `dryRun` mode the would-be removals are
 * reported without deleting. Returns the sorted list of removed (or would-remove)
 * absolute paths.
 */
export async function garbageCollectEditorCache(input: {
  readonly cacheRoot: string;
  readonly maxBytes?: number;
  readonly dryRun?: boolean;
}): Promise<readonly string[]> {
  const maxBytes = input.maxBytes ?? resolveEditorCacheMaxBytes();
  const dryRun = input.dryRun !== false;

  const files = await collectCacheFiles(input.cacheRoot);
  const entries: { readonly filePath: string; readonly size: number; readonly lastUsedMs: number }[] = [];
  let totalBytes = 0;
  for (const filePath of files) {
    const fileStat = await stat(filePath).catch(() => undefined);
    if (fileStat === undefined) {
      continue;
    }
    totalBytes += fileStat.size;
    entries.push({ filePath, size: fileStat.size, lastUsedMs: Math.max(fileStat.atimeMs, fileStat.mtimeMs) });
  }

  if (totalBytes <= maxBytes) {
    return [];
  }

  // Oldest first; break ties by path so eviction is deterministic.
  entries.sort((left, right) => left.lastUsedMs - right.lastUsedMs || (left.filePath < right.filePath ? -1 : 1));

  const removed: string[] = [];
  for (const entry of entries) {
    if (totalBytes <= maxBytes) {
      break;
    }
    removed.push(entry.filePath);
    totalBytes -= entry.size;
    if (!dryRun) {
      await rm(entry.filePath, { force: true }).catch(() => undefined);
    }
  }

  return removed.sort();
}

/** `.tmp/editor-cache/files` under the MAIN checkout root (never a worktree, so entries are shared). */
async function resolveEditorCacheFilesDir(): Promise<string> {
  return path.join(await resolveMainRepoRoot(), ".tmp", "editor-cache", "files");
}

/**
 * Walks up from the process working directory to the repository root (the
 * directory holding `PROJECT_STRUCTURE.yaml`). The Next.js server always runs
 * from the main checkout even when it reads files from a session worktree, so
 * this keeps the content-addressed cache shared across sessions and branches.
 */
async function resolveMainRepoRoot(): Promise<string> {
  let current = process.cwd();
  for (;;) {
    try {
      await stat(path.join(current, "PROJECT_STRUCTURE.yaml"));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return process.cwd();
      }
      current = parent;
    }
  }
}

function cacheEntryPath(cacheDir: string, key: string): string {
  return path.join(cacheDir, `${key}.json`);
}

/** Recursively lists every regular file under `root`; missing root yields `[]`. */
async function collectCacheFiles(root: string): Promise<readonly string[]> {
  const dirEntries = await readdir(root, { withFileTypes: true }).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && (error as { readonly code?: unknown }).code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const files: string[] = [];
  for (const dirEntry of dirEntries) {
    const entryPath = path.join(root, dirEntry.name);
    if (dirEntry.isDirectory()) {
      files.push(...(await collectCacheFiles(entryPath)));
    } else if (dirEntry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

/** Cache is on by default; `CUBICA_EDITOR_CACHE=0`/`false` forces it off (e.g. for honest measurements). */
function isEditorFileCacheEnabled(): boolean {
  const value = process.env.CUBICA_EDITOR_CACHE;
  return value !== "0" && value !== "false";
}

function resolveEditorCacheMaxBytes(): number {
  const value = process.env.CUBICA_EDITOR_CACHE_MAX_BYTES;
  if (value === undefined) {
    return EDITOR_CACHE_DEFAULT_MAX_BYTES;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : EDITOR_CACHE_DEFAULT_MAX_BYTES;
}
