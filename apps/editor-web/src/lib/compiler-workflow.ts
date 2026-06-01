/**
 * Server-side compiler workflow for editor-web route handlers.
 *
 * The browser edits authoring JSON, while this module calls the shared
 * ADR-030 compiler and maps generated runtime diagnostics back to authoring
 * JSON Pointers. Keeping this code server-only prevents runtime/player layers
 * from learning authoring-only keys.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  createDocumentStore,
  createSchemaRegistry,
  validateDocument,
  type DiagnosticSeverity,
  type DocumentSnapshot,
  type TextRange
} from "@cubica/editor-engine";

import { EditorRepositoryError, normalizeAuthoringFilePath } from "./editor-repository";
import {
  registerLocalAuthoringSchemas,
  schemaIdForAuthoringDocument
} from "./editor-json-schema";

interface CompilerCacheEntry {
  compiler?: AuthoringCompilerModule;
  load?: Promise<AuthoringCompilerModule>;
}

// The reusable compiler resolves schemas and manifests from its own file path.
// Caching by repository root lets an editor session compile inside its Git
// worktree (an isolated checkout for one editing session) without leaking
// generated files into the main checkout.
const compilerCacheByRoot = new Map<string, CompilerCacheEntry>();

export interface EditorCompilerDiagnostic {
  readonly severity: DiagnosticSeverity;
  readonly source: string;
  readonly pointer: string;
  readonly label: string;
  readonly message: string;
  readonly range?: TextRange;
  readonly filePath?: string;
  readonly generatedPointer?: string;
  readonly generatedFile?: string;
}

export interface EditorCompileArtifact {
  readonly kind: "game" | "ui";
  readonly gameId: string;
  readonly channel?: string;
  readonly sourceFile: string;
  readonly generatedFile: string;
  readonly sourceMapFile: string;
}

export interface EditorValidationResult {
  readonly ok: boolean;
  readonly gameId: string;
  readonly filePath: string;
  readonly diagnostics: readonly EditorCompilerDiagnostic[];
  readonly artifacts: readonly EditorCompileArtifact[];
}

export interface EditorCompileResult {
  readonly ok: boolean;
  readonly gameId: string;
  readonly checkOnly: boolean;
  readonly diagnostics: readonly EditorCompilerDiagnostic[];
  readonly artifacts: readonly EditorCompileArtifact[];
}

export interface EditorPreviewSourceMap {
  readonly generatedFile: string;
  readonly sourceFile: string;
  readonly mappings: Record<string, readonly { readonly file: string; readonly pointer: string }[]>;
}

interface AuthoringCompilerModule {
  readonly CompileError: new (message: string, filePath?: string, pointer?: string) => Error;
  buildAjv(): unknown;
  compileAuthoringFile(job: CompilerJob, ajv?: unknown): CompilerOutput;
  compileAuthoringText(job: CompilerJob, text: string, ajv?: unknown): CompilerOutput;
  compareGenerated(filePath: string, expected: unknown): string | null;
  discoverJobs(options?: { readonly gameId?: string | null }): readonly CompilerJob[];
  relativePath(filePath: string): string;
  validateRuntimeManifest(job: CompilerJob, manifest: unknown, ajv?: unknown): RuntimeValidationResult;
}

interface CompilerJob {
  readonly kind: "game" | "ui";
  readonly gameId: string;
  readonly channel?: string;
  readonly sourceFile: string;
  readonly outputFile: string;
  readonly sourceMapFile: string;
}

interface CompilerOutput {
  readonly manifest: unknown;
  readonly sourceMap: CompilerSourceMap;
}

interface CompilerSourceMap {
  readonly generatedFile: string;
  readonly sourceFile: string;
  readonly mappings: Record<string, readonly CompilerSource[]>;
}

interface CompilerSource {
  readonly file: string;
  readonly pointer: string;
}

interface RuntimeValidationResult {
  readonly valid: boolean;
  readonly schemaId: string;
  readonly errors: readonly {
    readonly pointer: string;
    readonly message: string;
    readonly keyword: string;
    readonly params: unknown;
  }[];
}

export async function validateAuthoringForEditor(input: {
  readonly gameId: string;
  readonly filePath: string;
  readonly text: string;
  readonly repoRoot?: string;
}): Promise<EditorValidationResult> {
  const filePath = normalizeAuthoringFilePath(input.filePath);
  const snapshot = createDocumentStore({ filePath, text: input.text }).snapshot();
  const diagnostics = collectAuthoringDiagnostics(snapshot, filePath);
  const artifacts: EditorCompileArtifact[] = [];

  if (!hasBlockingSource(diagnostics, new Set(["syntax", "schema"]))) {
    const compiler = await getCompiler(input.repoRoot);
    const job = findJob(compiler, input.gameId, filePath);
    const ajv = compiler.buildAjv();

    try {
      const output = compiler.compileAuthoringText(job, input.text, ajv);
      artifacts.push(toArtifact(compiler, job));
      diagnostics.push(...runtimeDiagnostics(compiler, job, output, snapshot, ajv));
    } catch (error) {
      diagnostics.push(compileErrorToDiagnostic(compiler, error, snapshot, filePath));
    }
  }

  return {
    ok: !hasErrors(diagnostics),
    gameId: input.gameId,
    filePath,
    diagnostics,
    artifacts
  };
}

export async function compileGameForEditor(input: {
  readonly gameId: string;
  readonly checkOnly?: boolean;
  readonly repoRoot?: string;
}): Promise<EditorCompileResult> {
  const checkOnly = input.checkOnly ?? false;
  const compiler = await getCompiler(input.repoRoot);
  const jobs = compiler.discoverJobs({ gameId: input.gameId });
  if (jobs.length === 0) {
    throw new EditorRepositoryError(`No authoring compiler jobs were found for game: ${input.gameId}`, 404);
  }

  const ajv = compiler.buildAjv();
  const diagnostics: EditorCompilerDiagnostic[] = [];
  const artifacts: EditorCompileArtifact[] = [];

  for (const job of jobs) {
    try {
      const output = compiler.compileAuthoringFile(job, ajv);
      const runtime = compiler.validateRuntimeManifest(job, output.manifest, ajv);
      artifacts.push(toArtifact(compiler, job));
      diagnostics.push(...runtime.errors.map((error) => runtimeErrorToDiagnostic(compiler, job, output.sourceMap, error)));

      if (checkOnly) {
        const manifestDiff = compiler.compareGenerated(job.outputFile, output.manifest);
        const sourceMapDiff = compiler.compareGenerated(job.sourceMapFile, output.sourceMap);
        for (const message of [manifestDiff, sourceMapDiff].filter(Boolean) as string[]) {
          diagnostics.push({
            severity: "error",
            source: "compile",
            pointer: "",
            label: "/",
            message,
            filePath: compiler.relativePath(job.sourceFile),
            generatedFile: compiler.relativePath(job.outputFile)
          });
        }
      } else if (runtime.valid) {
        await writeJsonFile(job.outputFile, output.manifest);
        await writeJsonFile(job.sourceMapFile, output.sourceMap);
      }
    } catch (error) {
      diagnostics.push(compileErrorToDiagnostic(compiler, error, undefined, compiler.relativePath(job.sourceFile)));
    }
  }

  return {
    ok: !hasErrors(diagnostics),
    gameId: input.gameId,
    checkOnly,
    diagnostics,
    artifacts
  };
}

export function mapGeneratedPointerToAuthoring(
  sourceMap: CompilerSourceMap,
  generatedPointer: string
): CompilerSource | undefined {
  let pointer = normalizeGeneratedPointer(generatedPointer);

  for (;;) {
    const sources = sourceMap.mappings[pointer];
    if (sources !== undefined && sources.length > 0) {
      return sources[0];
    }

    const parent = parentPointer(pointer);
    if (parent === undefined) {
      return undefined;
    }
    pointer = parent;
  }
}

export async function loadPreviewSelectionSourceMaps(
  gameId: string,
  repoRoot?: string
): Promise<readonly EditorPreviewSourceMap[]> {
  const compiler = await getCompiler(repoRoot);
  const jobs = compiler.discoverJobs({ gameId });
  const sourceMaps: EditorPreviewSourceMap[] = [];

  for (const job of jobs) {
    if (!existsSync(job.sourceMapFile)) {
      continue;
    }

    const text = await readFile(job.sourceMapFile, "utf8");
    const parsed = JSON.parse(text) as Partial<EditorPreviewSourceMap>;
    if (
      typeof parsed.generatedFile === "string" &&
      typeof parsed.sourceFile === "string" &&
      parsed.mappings !== undefined &&
      typeof parsed.mappings === "object" &&
      !Array.isArray(parsed.mappings)
    ) {
      sourceMaps.push({
        generatedFile: parsed.generatedFile,
        sourceFile: parsed.sourceFile,
        mappings: parsed.mappings as EditorPreviewSourceMap["mappings"]
      });
    }
  }

  return sourceMaps;
}

export async function compilerExportsForTests(): Promise<readonly string[]> {
  return Object.keys(await getCompiler()).sort();
}

function collectAuthoringDiagnostics(snapshot: DocumentSnapshot, filePath: string): EditorCompilerDiagnostic[] {
  const registry = createSchemaRegistry();
  registerLocalAuthoringSchemas(registry);
  const schemaId = schemaIdForAuthoringDocument(filePath, snapshot.json);

  return validateDocument(snapshot, {
    schemaRegistry: registry,
    schemaId,
    includeSemanticDiagnostics: true
  }).map((diagnostic) => ({
    severity: diagnostic.severity,
    source: diagnostic.source,
    pointer: diagnostic.pointer,
    label: diagnostic.pointer === "" ? "/" : diagnostic.pointer,
    message: diagnostic.message,
    range: diagnostic.range,
    filePath
  }));
}

function runtimeDiagnostics(
  compiler: AuthoringCompilerModule,
  job: CompilerJob,
  output: CompilerOutput,
  snapshot: DocumentSnapshot,
  ajv: unknown
): readonly EditorCompilerDiagnostic[] {
  return compiler.validateRuntimeManifest(job, output.manifest, ajv).errors.map((error) => {
    const mapped = mapGeneratedPointerToAuthoring(output.sourceMap, error.pointer);
    const pointer = mapped?.pointer ?? "";

    return {
      ...runtimeErrorToDiagnostic(compiler, job, output.sourceMap, error),
      pointer,
      label: pointer === "" ? "/" : pointer,
      range: snapshot.locationMap.get(pointer) ?? snapshot.locationMap.get(parentPointer(pointer) ?? "")
    };
  });
}

function runtimeErrorToDiagnostic(
  compiler: AuthoringCompilerModule,
  job: CompilerJob,
  sourceMap: CompilerSourceMap,
  error: RuntimeValidationResult["errors"][number]
): EditorCompilerDiagnostic {
  const mapped = mapGeneratedPointerToAuthoring(sourceMap, error.pointer);
  const pointer = mapped?.pointer ?? "";

  return {
    severity: "error",
    source: "runtime-schema",
    pointer,
    label: pointer === "" ? "/" : pointer,
    message: `${error.pointer || "/"} ${error.message}`,
    filePath: mapped?.file ?? compiler.relativePath(job.sourceFile),
    generatedPointer: error.pointer,
    generatedFile: compiler.relativePath(job.outputFile)
  };
}

function compileErrorToDiagnostic(
  compiler: AuthoringCompilerModule,
  error: unknown,
  snapshot: DocumentSnapshot | undefined,
  fallbackFilePath: string
): EditorCompilerDiagnostic {
  const compileError = isCompileError(error) ? error : undefined;
  const pointer = compileError?.pointer ?? "";
  const message = compileError?.rawMessage ?? (error instanceof Error ? error.message : "Compiler failed.");

  return {
    severity: "error",
    source: "compile",
    pointer,
    label: pointer === "" ? "/" : pointer,
    message,
    range: snapshot?.locationMap.get(pointer) ?? snapshot?.locationMap.get(parentPointer(pointer) ?? ""),
    filePath: compileError?.filePath === undefined ? fallbackFilePath : compiler.relativePath(compileError.filePath)
  };
}

function findJob(compiler: AuthoringCompilerModule, gameId: string, filePath: string): CompilerJob {
  const job = compiler.discoverJobs({ gameId }).find((candidate) => authoringRelativePath(compiler, candidate) === filePath);
  if (job === undefined) {
    throw new EditorRepositoryError(`Authoring compiler job was not found for ${gameId}/${filePath}`, 404);
  }

  return job;
}

function authoringRelativePath(compiler: AuthoringCompilerModule, job: CompilerJob): string {
  return compiler.relativePath(job.sourceFile).replace(`games/${job.gameId}/authoring/`, "");
}

function toArtifact(compiler: AuthoringCompilerModule, job: CompilerJob): EditorCompileArtifact {
  return {
    kind: job.kind,
    gameId: job.gameId,
    channel: job.channel,
    sourceFile: compiler.relativePath(job.sourceFile),
    generatedFile: compiler.relativePath(job.outputFile),
    sourceMapFile: compiler.relativePath(job.sourceMapFile)
  };
}

function normalizeGeneratedPointer(pointer: string): string {
  return pointer === "/" ? "" : pointer;
}

function parentPointer(pointer: string): string | undefined {
  if (pointer === "") {
    return undefined;
  }

  const index = pointer.lastIndexOf("/");
  return index <= 0 ? "" : pointer.slice(0, index);
}

function hasErrors(diagnostics: readonly EditorCompilerDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function hasBlockingSource(diagnostics: readonly EditorCompilerDiagnostic[], sources: ReadonlySet<string>): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error" && sources.has(diagnostic.source));
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isCompileError(error: unknown): error is {
  readonly filePath?: string;
  readonly pointer?: string;
  readonly rawMessage?: string;
  readonly message: string;
} {
  return typeof error === "object" && error !== null && "name" in error && (error as { readonly name?: string }).name === "CompileError";
}

async function getCompiler(repoRoot?: string): Promise<AuthoringCompilerModule> {
  const resolvedRepoRoot = resolveRepositoryRoot(repoRoot);
  const cache = compilerCacheByRoot.get(resolvedRepoRoot) ?? {};
  compilerCacheByRoot.set(resolvedRepoRoot, cache);

  if (cache.compiler !== undefined) {
    return cache.compiler;
  }

  cache.load ??= loadCompiler(resolvedRepoRoot);

  try {
    cache.compiler = await cache.load;
    return cache.compiler;
  } catch (error) {
    cache.load = undefined;
    throw error;
  }
}

async function loadCompiler(repoRoot: string): Promise<AuthoringCompilerModule> {
  const compilerPath = path.resolve(repoRoot, "scripts", "manifest-tools", "authoring-compiler.cjs");
  if (!existsSync(compilerPath)) {
    throw new Error(`Authoring compiler module was not found: ${compilerPath}`);
  }

  // Dynamic import with webpackIgnore is intentional: route handlers run in
  // Node.js and must load this repository-local CommonJS tool from the real
  // file system instead of webpack's server bundle module graph.
  const compilerUrl = pathToFileURL(compilerPath).href;
  const loaded = (await import(/* webpackIgnore: true */ compilerUrl)) as
    | AuthoringCompilerModule
    | { readonly default?: AuthoringCompilerModule };

  return ("default" in loaded && loaded.default !== undefined ? loaded.default : loaded) as AuthoringCompilerModule;
}

function resolveRepositoryRoot(repoRoot?: string): string {
  let current = repoRoot === undefined || repoRoot === "" ? process.cwd() : path.resolve(repoRoot);

  for (;;) {
    if (existsSync(path.join(current, "PROJECT_STRUCTURE.yaml"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return process.cwd();
    }
    current = parent;
  }
}
