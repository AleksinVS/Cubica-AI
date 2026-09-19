/**
 * File-system repository adapter for editor-web authoring manifests.
 *
 * The editor may read and write only existing `*.authoring.json` files below
 * `games/<gameId>/authoring`. Runtime manifests stay outside this adapter on
 * purpose, so browser saves cannot modify generated delivery files.
 */
import { createHash } from "node:crypto";
import { mkdir, open, opendir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface AuthoringFileSummary {
  readonly gameId: string;
  readonly filePath: string;
  readonly size: number;
  readonly versionHash: string;
}

export interface AuthoringListResult {
  readonly gameId: string;
  readonly games: readonly string[];
  readonly files: readonly AuthoringFileSummary[];
  readonly defaultFilePath: string | undefined;
}

export interface AuthoringFileDocument extends AuthoringFileSummary {
  readonly text: string;
}

export interface SaveAuthoringFileInput {
  readonly gameId: string;
  readonly filePath: string;
  readonly text: string;
  readonly versionHash: string;
  readonly repoRoot?: string;
}

export interface SaveAuthoringFileResult extends AuthoringFileDocument {
  readonly previousVersionHash: string;
}

export interface EditorLayoutPosition {
  readonly x: number;
  readonly y: number;
}

export interface EditorLayoutNode {
  readonly position?: EditorLayoutPosition;
}

export interface EditorLayoutDocumentBody {
  readonly version: 1;
  readonly nodes: Record<string, EditorLayoutNode>;
}

export interface EditorLayoutDocument {
  readonly gameId: string;
  readonly authoringFilePath: string;
  readonly layoutFilePath: string;
  readonly layout: EditorLayoutDocumentBody;
  readonly text: string;
  readonly versionHash: string;
}

export interface SaveEditorLayoutInput {
  readonly gameId: string;
  readonly authoringFilePath: string;
  readonly layout: EditorLayoutDocumentBody;
  readonly versionHash?: string;
  readonly repoRoot?: string;
}

export interface SaveEditorLayoutResult extends EditorLayoutDocument {
  readonly previousVersionHash: string;
}

export class EditorRepositoryError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = "EditorRepositoryError";
  }
}

const defaultGameId = "simple-choice";
const authoringFilePattern = /^[a-zA-Z0-9._/-]+\.authoring\.json$/u;
const gameIdPattern = /^[a-z0-9][a-z0-9-]*$/u;
const layoutVersion = 1;

export async function listAuthoringFiles(input: {
  readonly gameId?: string | null;
  readonly repoRoot?: string;
}): Promise<AuthoringListResult> {
  const repoRoot = await resolveRepositoryRoot(input.repoRoot);
  const games = await listEditableGameIds(repoRoot);
  if (games.length === 0) {
    throw new EditorRepositoryError("No editable authoring games were found.", 404);
  }

  const gameId = input.gameId === undefined || input.gameId === null || input.gameId === "" ? chooseDefaultGame(games) : input.gameId;
  validateGameId(gameId);

  if (!games.includes(gameId)) {
    throw new EditorRepositoryError(`Editable authoring directory was not found for game: ${gameId}`, 404);
  }

  const baseDirectory = await getAuthoringBaseDirectory(repoRoot, gameId);
  const files = await collectAuthoringFiles(repoRoot, gameId, baseDirectory.realPath, "");

  return {
    gameId,
    games,
    files,
    defaultFilePath: chooseDefaultFile(files)
  };
}

export async function openAuthoringFile(input: {
  readonly gameId: string;
  readonly filePath: string;
  readonly repoRoot?: string;
}): Promise<AuthoringFileDocument> {
  const repoRoot = await resolveRepositoryRoot(input.repoRoot);
  const resolved = await resolveExistingAuthoringFile(repoRoot, input.gameId, input.filePath);
  const text = await readFile(resolved.realPath, "utf8");
  const fileStat = await stat(resolved.realPath);

  return {
    gameId: input.gameId,
    filePath: resolved.filePath,
    text,
    size: fileStat.size,
    versionHash: hashText(text)
  };
}

export async function saveAuthoringFile(input: SaveAuthoringFileInput): Promise<SaveAuthoringFileResult> {
  const repoRoot = await resolveRepositoryRoot(input.repoRoot);
  const resolved = await resolveExistingAuthoringFile(repoRoot, input.gameId, input.filePath);
  const currentText = await readFile(resolved.realPath, "utf8");
  const currentVersionHash = hashText(currentText);

  if (currentVersionHash !== input.versionHash) {
    throw new EditorRepositoryError(`The authoring file changed on disk. Reload before saving.`, 409);
  }

  await writeFile(resolved.realPath, input.text, "utf8");
  const fileStat = await stat(resolved.realPath);

  return {
    gameId: input.gameId,
    filePath: resolved.filePath,
    text: input.text,
    size: fileStat.size,
    previousVersionHash: currentVersionHash,
    versionHash: hashText(input.text)
  };
}

/** One file to write during a multi-document apply: its path and full new text. */
export interface WorktreeFileWrite {
  readonly filePath: string;
  readonly text: string;
}

/** Per-file outcome of an apply: its normalized path and the new content hash. */
export interface AppliedWorktreeFile {
  readonly filePath: string;
  readonly versionHash: string;
}

/**
 * Writes the active and sibling authoring files as one recoverable batch.
 *
 * All targets are resolved and their originals snapshotted FIRST; then every file
 * is written. A failed write may have truncated its target, so rollback includes
 * that target as well as all earlier files.
 */
export async function applyAuthoringFilesToWorktree(input: {
  readonly gameId: string;
  readonly repoRoot: string;
  readonly files: readonly WorktreeFileWrite[];
  /** Expected hashes are checked after all targets are resolved and before the first write. */
  readonly expectedBeforeHashes?: Readonly<Record<string, string>>;
}): Promise<{ readonly files: readonly AppliedWorktreeFile[] }> {
  return applyAuthoringFilesWithWriter(input, (filePath, text) => writeFile(filePath, text, "utf8"));
}

/** Test seam for a write failure followed by an independent rollback failure. */
export async function applyAuthoringFilesToWorktreeForTests(
  input: Parameters<typeof applyAuthoringFilesToWorktree>[0],
  writeText: (filePath: string, text: string) => Promise<void>
): ReturnType<typeof applyAuthoringFilesToWorktree> {
  return applyAuthoringFilesWithWriter(input, writeText);
}

async function applyAuthoringFilesWithWriter(
  input: Parameters<typeof applyAuthoringFilesToWorktree>[0],
  writeText: (filePath: string, text: string) => Promise<void>
): ReturnType<typeof applyAuthoringFilesToWorktree> {
  if (input.files.length === 0) {
    return { files: [] };
  }

  const repoRoot = await resolveRepositoryRoot(input.repoRoot);
  validateGameId(input.gameId);
  const journalDirectory = path.join(repoRoot, ".tmp", "editor-mutation-recovery");
  const journalPath = path.join(journalDirectory, `${input.gameId}.json`);
  if (await fileExists(journalPath)) {
    throw new EditorRepositoryError("An incomplete editor mutation needs recovery before further writes.", 503);
  }
  const normalizedPaths = input.files.map((file) => normalizeAuthoringFilePath(file.filePath));
  if (new Set(normalizedPaths).size !== normalizedPaths.length) {
    throw new EditorRepositoryError("A mutation batch cannot write the same authoring file twice.", 400);
  }
  const resolved = await Promise.all(
    input.files.map(async (file) => {
      const target = await resolveExistingAuthoringFile(repoRoot, input.gameId, file.filePath);
      const originalText = await readFile(target.realPath, "utf8");
      return { ...target, text: file.text, originalText };
    })
  );

  for (const file of resolved) {
    const expected = input.expectedBeforeHashes?.[file.filePath];
    if (expected !== undefined && hashText(file.originalText) !== expected) {
      throw new EditorRepositoryError(`The authoring file changed on disk: ${file.filePath}. Reload before applying.`, 409);
    }
  }

  await mkdir(journalDirectory, { recursive: true });
  const journal = await open(journalPath, "wx").catch((error: unknown) => {
    if (isFileExistsError(error)) {
      throw new EditorRepositoryError("An incomplete editor mutation needs recovery before further writes.", 503);
    }
    throw error;
  });
  try {
    await journal.writeFile(JSON.stringify({
      gameId: input.gameId,
      files: resolved.map((file) => ({
        filePath: file.filePath,
        beforeHash: hashText(file.originalText),
        afterHash: hashText(file.text),
        originalText: file.originalText
      }))
    }), "utf8");
    await journal.sync();
  } finally {
    await journal.close();
  }
  const journalDirectoryHandle = await open(journalDirectory, "r");
  try { await journalDirectoryHandle.sync(); } finally { await journalDirectoryHandle.close(); }

  const written: typeof resolved = [];
  try {
    for (const file of resolved) {
      written.push(file);
      await writeText(file.realPath, file.text);
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const file of written) {
      try {
        await writeText(file.realPath, file.originalText);
      } catch {
        // A rejected write can leave the original bytes intact. Hash
        // verification below decides whether recovery is actually incomplete.
      }
    }
    for (const file of resolved) {
      try {
        if (hashText(await readFile(file.realPath, "utf8")) !== hashText(file.originalText)) {
          rollbackErrors.push(new Error(`Rollback hash mismatch: ${file.filePath}`));
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new EditorRepositoryError(`Editor mutation rollback is incomplete. Recovery journal: .tmp/editor-mutation-recovery/${input.gameId}.json`, 503);
    }
    await rm(journalPath);
    throw error instanceof EditorRepositoryError
      ? error
      : new EditorRepositoryError("Applying entity operation to the worktree failed.", 500);
  }

  await rm(journalPath);

  return {
    files: resolved.map((file) => ({ filePath: file.filePath, versionHash: hashText(file.text) }))
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try { await stat(filePath); return true; } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

function isFileExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

export async function openEditorLayout(input: {
  readonly gameId: string;
  readonly authoringFilePath: string;
  readonly repoRoot?: string;
}): Promise<EditorLayoutDocument> {
  const repoRoot = await resolveRepositoryRoot(input.repoRoot);
  const resolved = await resolveEditorLayoutPath(repoRoot, input.gameId, input.authoringFilePath);

  try {
    const text = await readFile(resolved.realPath, "utf8");
    const layout = parseEditorLayout(text);
    return {
      gameId: input.gameId,
      authoringFilePath: resolved.authoringFilePath,
      layoutFilePath: resolved.layoutFilePath,
      layout,
      text,
      versionHash: hashText(text)
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      const layout = createEmptyEditorLayout();
      const text = formatEditorLayout(layout);
      return {
        gameId: input.gameId,
        authoringFilePath: resolved.authoringFilePath,
        layoutFilePath: resolved.layoutFilePath,
        layout,
        text,
        versionHash: hashText(text)
      };
    }

    throw error;
  }
}

export async function saveEditorLayout(input: SaveEditorLayoutInput): Promise<SaveEditorLayoutResult> {
  const repoRoot = await resolveRepositoryRoot(input.repoRoot);
  const resolved = await resolveEditorLayoutPath(repoRoot, input.gameId, input.authoringFilePath);
  const current = await openEditorLayout({
    gameId: input.gameId,
    authoringFilePath: input.authoringFilePath,
    repoRoot
  });

  if (input.versionHash !== undefined && current.versionHash !== input.versionHash) {
    throw new EditorRepositoryError(`The editor layout changed on disk. Reload before saving layout.`, 409);
  }

  const layout = normalizeEditorLayout(input.layout);
  const text = formatEditorLayout(layout);
  await mkdir(path.dirname(resolved.lexicalPath), { recursive: true });
  await writeFile(resolved.lexicalPath, text, "utf8");

  return {
    gameId: input.gameId,
    authoringFilePath: resolved.authoringFilePath,
    layoutFilePath: resolved.layoutFilePath,
    layout,
    text,
    previousVersionHash: current.versionHash,
    versionHash: hashText(text)
  };
}

export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function normalizeAuthoringFilePath(filePath: string): string {
  if (filePath.includes("\0")) {
    throw new EditorRepositoryError("File path contains an invalid character.", 400);
  }

  const normalized = filePath.replaceAll("\\", "/");
  if (
    normalized === "" ||
    path.isAbsolute(filePath) ||
    normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..") ||
    !authoringFilePattern.test(normalized)
  ) {
    throw new EditorRepositoryError("Only relative *.authoring.json paths are editable.", 400);
  }

  return normalized;
}

export function layoutPathForAuthoringFile(filePath: string): string {
  const normalizedFilePath = normalizeAuthoringFilePath(filePath);
  const uiMatch = /^ui\/([^/]+)\.authoring\.json$/u.exec(normalizedFilePath);

  if (uiMatch !== null) {
    return `ui/${uiMatch[1]}.layout.json`;
  }

  return "editor.layout.json";
}

async function resolveRepositoryRoot(explicitRoot: string | undefined): Promise<string> {
  if (explicitRoot !== undefined) {
    return realpath(explicitRoot);
  }

  let current = process.cwd();
  for (;;) {
    try {
      await stat(path.join(current, "PROJECT_STRUCTURE.yaml"));
      return realpath(current);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new EditorRepositoryError("Repository root could not be resolved.", 500);
      }
      current = parent;
    }
  }
}

async function listEditableGameIds(repoRoot: string): Promise<readonly string[]> {
  const gamesDirectory = path.join(repoRoot, "games");
  const entries = await opendir(gamesDirectory);
  const games: string[] = [];

  for await (const entry of entries) {
    if (!entry.isDirectory() || !gameIdPattern.test(entry.name)) {
      continue;
    }

    try {
      await getAuthoringBaseDirectory(repoRoot, entry.name);
      games.push(entry.name);
    } catch {
      // A game without an authoring directory is not editable in Stage 2.
    }
  }

  return games.sort((left, right) => left.localeCompare(right));
}

function chooseDefaultGame(games: readonly string[]): string {
  return games.includes(defaultGameId) ? defaultGameId : games[0] ?? defaultGameId;
}

function chooseDefaultFile(files: readonly AuthoringFileSummary[]): string | undefined {
  const preferred = files.find((file) => file.filePath === "game.authoring.json");
  return preferred?.filePath ?? files[0]?.filePath;
}

async function getAuthoringBaseDirectory(
  repoRoot: string,
  gameId: string
): Promise<{ readonly lexicalPath: string; readonly realPath: string }> {
  validateGameId(gameId);
  const lexicalPath = path.join(repoRoot, "games", gameId, "authoring");
  const realPath = await realpath(lexicalPath);
  assertPathInside(realPath, path.join(repoRoot, "games", gameId), "Authoring directory escapes the game directory.");
  return { lexicalPath, realPath };
}

async function collectAuthoringFiles(
  repoRoot: string,
  gameId: string,
  baseRealPath: string,
  relativeDirectory: string
): Promise<readonly AuthoringFileSummary[]> {
  const directory = path.join(baseRealPath, relativeDirectory);
  const entries = await opendir(directory);
  const files: AuthoringFileSummary[] = [];

  for await (const entry of entries) {
    const relativePath = relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
    const absolutePath = path.join(baseRealPath, relativePath);

    if (entry.isDirectory()) {
      const directoryRealPath = await realpath(absolutePath);
      assertPathInside(directoryRealPath, baseRealPath, "Authoring subdirectory escapes the authoring root.");
      files.push(...(await collectAuthoringFiles(repoRoot, gameId, baseRealPath, relativePath)));
      continue;
    }

    if (!entry.isFile() || !relativePath.endsWith(".authoring.json")) {
      continue;
    }

    const resolved = await resolveExistingAuthoringFile(repoRoot, gameId, relativePath);
    const text = await readFile(resolved.realPath, "utf8");
    const fileStat = await stat(resolved.realPath);
    files.push({
      gameId,
      filePath: resolved.filePath,
      size: fileStat.size,
      versionHash: hashText(text)
    });
  }

  return files.sort((left, right) => left.filePath.localeCompare(right.filePath));
}

async function resolveExistingAuthoringFile(
  repoRoot: string,
  gameId: string,
  filePath: string
): Promise<{ readonly filePath: string; readonly realPath: string }> {
  validateGameId(gameId);
  const normalizedFilePath = normalizeAuthoringFilePath(filePath);
  const baseDirectory = await getAuthoringBaseDirectory(repoRoot, gameId);
  const targetPath = path.resolve(baseDirectory.lexicalPath, normalizedFilePath);

  assertPathInside(targetPath, baseDirectory.lexicalPath, "File path escapes the authoring directory.");

  let targetRealPath: string;
  try {
    targetRealPath = await realpath(targetPath);
  } catch {
    throw new EditorRepositoryError("Authoring file was not found.", 404);
  }
  assertPathInside(targetRealPath, baseDirectory.realPath, "Resolved file escapes the authoring directory.");

  const fileStat = await stat(targetRealPath);
  if (!fileStat.isFile()) {
    throw new EditorRepositoryError("Authoring path is not a file.", 400);
  }

  return { filePath: normalizedFilePath, realPath: targetRealPath };
}

async function resolveEditorLayoutPath(
  repoRoot: string,
  gameId: string,
  authoringFilePath: string
): Promise<{
  readonly authoringFilePath: string;
  readonly layoutFilePath: string;
  readonly lexicalPath: string;
  readonly realPath: string;
}> {
  await resolveExistingAuthoringFile(repoRoot, gameId, authoringFilePath);
  const normalizedAuthoringFilePath = normalizeAuthoringFilePath(authoringFilePath);
  const layoutFilePath = layoutPathForAuthoringFile(normalizedAuthoringFilePath);
  const baseDirectory = await getAuthoringBaseDirectory(repoRoot, gameId);
  const lexicalPath = path.resolve(baseDirectory.lexicalPath, layoutFilePath);

  assertPathInside(lexicalPath, baseDirectory.lexicalPath, "Layout file path escapes the authoring directory.");

  try {
    const realLayoutPath = await realpath(lexicalPath);
    assertPathInside(realLayoutPath, baseDirectory.realPath, "Resolved layout file escapes the authoring directory.");
    const fileStat = await stat(realLayoutPath);
    if (!fileStat.isFile()) {
      throw new EditorRepositoryError("Editor layout path is not a file.", 400);
    }

    return {
      authoringFilePath: normalizedAuthoringFilePath,
      layoutFilePath,
      lexicalPath,
      realPath: realLayoutPath
    };
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }

    const parentRealPath = await realpath(path.dirname(lexicalPath));
    assertPathInside(parentRealPath, baseDirectory.realPath, "Editor layout directory escapes the authoring root.");
    return {
      authoringFilePath: normalizedAuthoringFilePath,
      layoutFilePath,
      lexicalPath,
      realPath: lexicalPath
    };
  }
}

function validateGameId(gameId: string): void {
  if (!gameIdPattern.test(gameId)) {
    throw new EditorRepositoryError("Game id must be a safe repository segment.", 400);
  }
}

function assertPathInside(targetPath: string, basePath: string, message: string): void {
  const relativePath = path.relative(basePath, targetPath);
  if (relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))) {
    return;
  }

  throw new EditorRepositoryError(message, 400);
}

function createEmptyEditorLayout(): EditorLayoutDocumentBody {
  return {
    version: layoutVersion,
    nodes: {}
  };
}

function parseEditorLayout(text: string): EditorLayoutDocumentBody {
  try {
    return normalizeEditorLayout(JSON.parse(text) as EditorLayoutDocumentBody);
  } catch (error) {
    if (error instanceof EditorRepositoryError) {
      throw error;
    }

    throw new EditorRepositoryError("Editor layout JSON is invalid.", 400);
  }
}

function normalizeEditorLayout(layout: EditorLayoutDocumentBody): EditorLayoutDocumentBody {
  if (!isRecord(layout) || layout.version !== layoutVersion || !isRecord(layout.nodes)) {
    throw new EditorRepositoryError("Editor layout must be an object with version 1 and nodes.", 400);
  }

  const nodes: Record<string, EditorLayoutNode> = {};
  for (const [nodeId, node] of Object.entries(layout.nodes)) {
    if (!isRecord(node)) {
      continue;
    }

    if (node.position === undefined) {
      nodes[nodeId] = {};
      continue;
    }

    if (!isRecord(node.position) || typeof node.position.x !== "number" || typeof node.position.y !== "number") {
      throw new EditorRepositoryError("Editor layout node positions must use numeric x and y values.", 400);
    }

    nodes[nodeId] = {
      position: {
        x: node.position.x,
        y: node.position.y
      }
    };
  }

  return {
    version: layoutVersion,
    nodes
  };
}

function formatEditorLayout(layout: EditorLayoutDocumentBody): string {
  return `${JSON.stringify(normalizeEditorLayout(layout), null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && (error as { readonly code?: unknown }).code === "ENOENT";
}
