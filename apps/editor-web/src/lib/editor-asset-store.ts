/**
 * Server-side store for GAME ASSETS — the media/document files of a game
 * (ADR-009, ADR-057 §4/§9.4; design-spec §3.6).
 *
 * "Assets" (ассеты) are ordinary project FILES living under
 * `games/<gameId>/assets/` — images, audio, and methodology markdown — NOT
 * authoring entities. Game/UI entities merely REFERENCE them by their path
 * ("asset-reference" fields). This module is the single reader/writer the editor
 * uses to:
 *
 *   - LIST a game's assets with a type (by file extension) and a usage counter
 *     (how many authoring documents reference the file), so the library can show
 *     «используется в N местах» and flag orphans (0 uses → the `asset-orphan`
 *     info diagnostic, design-spec §4);
 *   - WRITE an uploaded asset into the session worktree so it commits together
 *     with the rest of the author's edits on the next Save (same worktree model
 *     as the fixture store, ADR-057 §5 invariant), never into the shared root;
 *   - RESOLVE one asset's bytes for a thumbnail/preview stream.
 *
 * Everything here is game-agnostic (CLAUDE §10): types come from the file
 * extension and usage counting matches asset references by convention (a string
 * field whose value points at a media file), never by a hardcoded game id.
 */
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { EditorRepositoryError, listAuthoringFiles, openAuthoringFile } from "./editor-repository";

/** Coarse asset kind the library filters by; derived only from the file extension. */
export type GameAssetType = "image" | "audio" | "markdown" | "other";

/** One asset as returned to the client (library card model). */
export interface GameAssetSummary {
  /** Project-relative path, e.g. `games/<id>/assets/images/hero.png` (the reference form). */
  readonly path: string;
  /** File name (last path segment) shown as the card label. */
  readonly name: string;
  /** Coarse kind for the type filter and icon. */
  readonly type: GameAssetType;
  /** Byte size on disk. */
  readonly size: number;
  /** How many authoring documents reference this asset (design-spec §3.6 counter). */
  readonly usageCount: number;
  /** True when nothing references the asset (`asset-orphan` info; design-spec §4). */
  readonly orphan: boolean;
}

/** Media-ish extension test, shared with the inspector's asset hint (game-agnostic). */
const ASSET_REFERENCE_PATTERN = /\.(png|jpe?g|svg|webp|gif|avif|mp3|wav|ogg|m4a|mp4|webm|md|markdown)$/iu;
const gameIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u;
/** One safe path segment inside the assets tree (no separators, no dot-dot). */
const safeSegmentPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.\- ]{0,120}$/u;

/** Maps a file extension to a coarse {@link GameAssetType}. */
function assetTypeForName(name: string): GameAssetType {
  const ext = path.extname(name).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".avif"].includes(ext)) {
    return "image";
  }
  if ([".mp3", ".wav", ".ogg", ".m4a"].includes(ext)) {
    return "audio";
  }
  if ([".md", ".markdown"].includes(ext)) {
    return "markdown";
  }
  return "other";
}

/** Absolute path of a game's assets directory inside a repo/worktree, guarded. */
function assetsDirectory(repoRoot: string, gameId: string): string {
  if (!gameIdPattern.test(gameId) || gameId.includes("..")) {
    throw new EditorRepositoryError("Asset requests require a safe gameId.", 400);
  }
  return path.join(repoRoot, "games", gameId, "assets");
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { readonly code?: unknown }).code === "ENOENT";
}

/** Recursively collects every file below `dir`, returning paths relative to `dir`. */
async function collectFilesRecursively(dir: string, relative: string): Promise<string[]> {
  const entries = await readdir(path.join(dir, relative), { withFileTypes: true }).catch((error: unknown) => {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  });

  const files: string[] = [];
  for (const entry of entries) {
    const childRelative = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await collectFilesRecursively(dir, childRelative)));
    } else if (entry.isFile()) {
      files.push(childRelative);
    }
  }
  return files;
}

/**
 * Builds a multiset of referenced asset BASENAMES across all of a game's
 * authoring documents. A reference is any string leaf value that looks like an
 * asset path (matches the media-extension pattern); we reduce it to its last
 * path segment so both the full project-relative form
 * (`games/<id>/assets/images/hero.png`) and shorter runtime forms
 * (`/images/hero.png`) count as the same reference. This is deliberately
 * game-agnostic: it never inspects a specific field name or game id.
 *
 * Known limitation (documented tech-debt): two assets sharing a file name in
 * different folders share a usage count. Games keep asset names unique in
 * practice; a precise per-path index is a follow-up.
 */
async function buildUsageIndex(gameId: string, repoRoot: string): Promise<Map<string, number>> {
  const usage = new Map<string, number>();
  const list = await listAuthoringFiles({ gameId, repoRoot }).catch(() => undefined);
  if (list === undefined) {
    return usage;
  }

  for (const file of list.files) {
    const { text } = await openAuthoringFile({ gameId, filePath: file.filePath, repoRoot }).catch(() => ({ text: "" }));
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      continue;
    }
    walkStringValues(json, (value) => {
      if (!ASSET_REFERENCE_PATTERN.test(value)) {
        return;
      }
      const basename = value.split(/[\\/]/u).pop() ?? value;
      usage.set(basename, (usage.get(basename) ?? 0) + 1);
    });
  }
  return usage;
}

/** Depth-first visit of every string leaf in a parsed JSON value. */
function walkStringValues(node: unknown, visit: (value: string) => void): void {
  if (typeof node === "string") {
    visit(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      walkStringValues(item, visit);
    }
    return;
  }
  if (typeof node === "object" && node !== null) {
    for (const value of Object.values(node)) {
      walkStringValues(value, visit);
    }
  }
}

/**
 * Lists a game's assets with their type, size, and usage counter. The counter
 * and the derived `orphan` flag come from {@link buildUsageIndex}; a missing
 * assets directory just yields an empty list rather than throwing, so a game
 * without assets renders an empty library.
 */
export async function listGameAssets(input: {
  readonly gameId: string;
  readonly repoRoot: string;
}): Promise<{ readonly assets: readonly GameAssetSummary[] }> {
  const directory = assetsDirectory(input.repoRoot, input.gameId);
  const relativePaths = await collectFilesRecursively(directory, "");
  const usage = await buildUsageIndex(input.gameId, input.repoRoot);

  const assets: GameAssetSummary[] = [];
  for (const relativePath of relativePaths) {
    const name = relativePath.split("/").pop() ?? relativePath;
    const fileStat = await stat(path.join(directory, relativePath)).catch(() => undefined);
    if (fileStat === undefined || !fileStat.isFile()) {
      continue;
    }
    const usageCount = usage.get(name) ?? 0;
    assets.push({
      path: `games/${input.gameId}/assets/${relativePath}`,
      name,
      type: assetTypeForName(name),
      size: fileStat.size,
      usageCount,
      orphan: usageCount === 0
    });
  }

  assets.sort((left, right) => left.path.localeCompare(right.path));
  return { assets };
}

/** Validates that every segment of an assets-relative path is a safe segment. */
function normalizeAssetRelativePath(relativePath: string): string {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\/+/u, "").trim();
  const segments = normalized.split("/").filter((segment) => segment !== "");
  if (segments.length === 0 || segments.some((segment) => segment === ".." || !safeSegmentPattern.test(segment))) {
    throw new EditorRepositoryError("Asset path must be safe segments below the assets directory.", 400);
  }
  return segments.join("/");
}

/**
 * Resolves one asset file's absolute path inside a game's assets directory,
 * guarding against path traversal, and returns it together with its size and
 * detected type. Used by the content/preview stream route.
 */
export async function resolveGameAssetFile(input: {
  readonly gameId: string;
  readonly repoRoot: string;
  readonly relativePath: string;
}): Promise<{ readonly absolutePath: string; readonly type: GameAssetType; readonly name: string; readonly size: number }> {
  const directory = assetsDirectory(input.repoRoot, input.gameId);
  // Accept either a bare assets-relative path or the full project-relative form.
  const stripped = input.relativePath.replace(new RegExp(`^games/${input.gameId}/assets/`, "u"), "");
  const relativePath = normalizeAssetRelativePath(stripped);
  const absolutePath = path.join(directory, relativePath);
  const fileStat = await stat(absolutePath).catch(() => undefined);
  if (fileStat === undefined || !fileStat.isFile()) {
    throw new EditorRepositoryError("Asset file was not found.", 404);
  }
  const name = relativePath.split("/").pop() ?? relativePath;
  return { absolutePath, type: assetTypeForName(name), name, size: fileStat.size };
}

/** Input to {@link writeGameAsset}: a base64 payload plus its destination name. */
export interface WriteGameAssetInput {
  readonly gameId: string;
  readonly repoRoot: string;
  /** Destination path relative to the assets directory (e.g. `images/hero.png`). */
  readonly relativePath: string;
  /** File contents, base64-encoded (binaries are transported as base64 over JSON). */
  readonly contentBase64: string;
}

/**
 * Writes an uploaded asset into the session worktree assets tree. The write is
 * NOT committed here: it lands in the worktree and commits on the next Save,
 * exactly like any other authoring edit (ADR-057 §9.4). Binaries are carried as
 * base64 over JSON — honestly simple, at the cost of ~33 % payload inflation;
 * a multipart upload is a possible follow-up for very large media.
 */
export async function writeGameAsset(input: WriteGameAssetInput): Promise<GameAssetSummary> {
  const relativePath = normalizeAssetRelativePath(input.relativePath);
  const directory = assetsDirectory(input.repoRoot, input.gameId);
  const target = path.join(directory, relativePath);

  let bytes: Buffer;
  try {
    bytes = Buffer.from(input.contentBase64, "base64");
  } catch {
    throw new EditorRepositoryError("Asset content must be valid base64.", 400);
  }
  if (bytes.length === 0) {
    throw new EditorRepositoryError("Asset content is empty.", 400);
  }

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);

  const name = relativePath.split("/").pop() ?? relativePath;
  return {
    path: `games/${input.gameId}/assets/${relativePath}`,
    name,
    type: assetTypeForName(name),
    size: bytes.length,
    usageCount: 0,
    orphan: true
  };
}
