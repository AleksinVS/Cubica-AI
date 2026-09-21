/**
 * Server-side compiler workflow for editor-web route handlers.
 *
 * The browser edits authoring JSON, while this module calls the shared
 * ADR-030 compiler and maps generated runtime diagnostics back to authoring
 * JSON Pointers. Keeping this code server-only prevents runtime/player layers
 * from learning authoring-only keys.
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  createDocumentStore,
  createPrototypeExtractionProposal,
  discoverPrototypeExtractionCandidates,
  dryRunEditorChangeSet,
  isPlainJsonObject,
  parseJsonPointer,
  readJsonPointer,
  validateDocument,
  type DiagnosticSeverity,
  type DocumentDiagnostic,
  type DocumentSnapshot,
  type EditorDiffSummaryItem,
  type JsonObject,
  type JsonValue,
  type PrototypeExtractionClassification,
  type PrototypeExtractionProposal,
  type TextRange
} from "@cubica/editor-engine";

import { EditorRepositoryError, normalizeAuthoringFilePath } from "./editor-repository";
import {
  getSharedAuthoringSchemaRegistry,
  schemaIdForAuthoringDocument
} from "./editor-json-schema";
import {
  createEditorFileCacheTelemetry,
  loadDocumentSnapshotWithCache,
  type EditorFileCacheTelemetry
} from "./editor-file-cache";

interface CompilerCacheEntry {
  compiler?: AuthoringCompilerModule;
  load?: Promise<AuthoringCompilerModule>;
}

// The reusable compiler resolves schemas from its own file path. Keep its code
// cache separate from the editor session's authoritative authoring sources.
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
  readonly telemetry: EditorCompileTelemetry;
  /** Level-2 per-file snapshot cache hit/miss + revive/build durations (design-spec §5). */
  readonly fileCacheTelemetry: EditorFileCacheTelemetry;
}

export interface EditorCompileResult {
  readonly ok: boolean;
  readonly gameId: string;
  readonly checkOnly: boolean;
  readonly diagnostics: readonly EditorCompilerDiagnostic[];
  readonly artifacts: readonly EditorCompileArtifact[];
  readonly telemetry: EditorCompileTelemetry;
}

export interface EditorPrototypeExtractionGate {
  readonly id: string;
  readonly label: string;
  readonly ok: boolean;
  readonly diagnostics: readonly EditorCompilerDiagnostic[];
}

export interface EditorPrototypeExtractionResult {
  readonly ok: boolean;
  readonly gameId: string;
  readonly filePath: string;
  readonly proposal?: PrototypeExtractionProposal;
  readonly diagnostics: readonly EditorCompilerDiagnostic[];
  readonly diffSummary: readonly EditorDiffSummaryItem[];
  readonly gates: readonly EditorPrototypeExtractionGate[];
  readonly artifacts: readonly EditorCompileArtifact[];
}

export interface EditorPreviewSourceMap {
  readonly generatedFile: string;
  readonly sourceFile: string;
  readonly mappings: Record<string, readonly { readonly file: string; readonly pointer: string }[]>;
  /**
   * Sorted generated JSON Pointers whose entire subtree was omitted from
   * `mappings` because it is a position-for-position verbatim copy of an
   * ancestor's authoring subtree — see `mapGeneratedPointerToAuthoring`
   * below and the identical field on `PreviewSelectionSourceMap` in
   * preview-message-adapter.ts. Optional so a source map read before this
   * field existed still resolves every pointer, just less precisely.
   */
  readonly verbatimSubtrees?: readonly string[];
}

interface AuthoringCompilerModule {
  readonly CompileError: new (message: string, filePath?: string, pointer?: string) => Error;
  buildAjv(): unknown;
  getSharedAjv(): unknown;
  compileAuthoringFile(job: CompilerJob, ajv?: unknown): CompilerOutput;
  compileAuthoringText(job: CompilerJob, text: string, ajv?: unknown): CompilerOutput;
  compileAuthoringTextCached(
    job: CompilerJob,
    text: string,
    ajv?: unknown,
    options?: { readonly telemetry?: CompileTelemetryRecorder; readonly cacheEnabled?: boolean }
  ): CompilerOutput;
  createCompileTelemetry(): CompileTelemetryRecorder;
  compareGenerated(filePath: string, expected: unknown): string | null;
  discoverJobs(options?: { readonly gameId?: string | null }): readonly CompilerJob[];
  relativePath(filePath: string): string;
  validateRuntimeManifest(job: CompilerJob, manifest: unknown, ajv?: unknown): RuntimeValidationResult;
}

interface CompileTelemetryRecorder {
  recordHit(ms: number): void;
  recordMiss(ms: number): void;
  snapshot(): EditorCompileTelemetry;
}

/**
 * Level-3 compile cache telemetry surfaced to the editor client (design-spec
 * §5) so a future status bar can show warm/cold compile behaviour.
 */
export interface EditorCompileTelemetry {
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly hitReadMs: number;
  readonly missCompileMs: number;
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
  // See EditorPreviewSourceMap's identical field above.
  readonly verbatimSubtrees?: readonly string[];
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
  // Level-2 warm-start cache: revive the DocumentStore snapshot (parse tree +
  // location map) when this exact file content was parsed before, skipping the
  // ~98%-of-parse cost of rebuilding the location map (profiling baseline §9).
  const fileCacheTelemetry = createEditorFileCacheTelemetry();
  const snapshot = await loadDocumentSnapshotWithCache({ filePath, text: input.text, telemetry: fileCacheTelemetry });
  const diagnostics = collectAuthoringDiagnostics(snapshot, filePath);
  const artifacts: EditorCompileArtifact[] = [];
  const compiler = await getCompiler(input.repoRoot);
  const telemetry = compiler.createCompileTelemetry();

  if (!hasBlockingSource(diagnostics, new Set(["syntax", "schema"]))) {
    const job = await findJob(compiler, input.gameId, filePath, input.repoRoot);
    const ajv = compiler.getSharedAjv();

    try {
      // Hot path: reuse the level-3 compile cache so re-validating unchanged
      // authoring on load/edit skips the recompile.
      const output = compiler.compileAuthoringTextCached(job, input.text, ajv, { telemetry });
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
    artifacts,
    telemetry: telemetry.snapshot(),
    fileCacheTelemetry: fileCacheTelemetry.snapshot()
  };
}

/** Compile a prototype in its existing layout without persisting or registering a game. */
export async function compilePrototypeForEditor(input: {
  readonly gameId: string;
  readonly filePath: string;
  readonly text: string;
  readonly sourcePointer: string;
  readonly prototypePointer: string;
  readonly repoRoot?: string;
}): Promise<JsonObject> {
  const document = JSON.parse(input.text) as JsonValue;
  const source = readJsonPointer(document, input.sourcePointer);
  const prototype = readJsonPointer(document, input.prototypePointer);
  const definitionParts = parseJsonPointer(input.prototypePointer);
  if (!isPlainJsonObject(document) || document._manifestType !== "ui" ||
      !input.sourcePointer.startsWith("/root/") || !isPlainJsonObject(source) ||
      !isPlainJsonObject(prototype) || definitionParts.length !== 2 ||
      definitionParts[0] !== "_definitions" || source._type !== definitionParts[1]) {
    throw new EditorRepositoryError("Выбранный экземпляр не принадлежит этому локальному прототипу.", 400);
  }
  // Only identity belongs to the temporary instance. In particular, copying
  // props would hide the prototype's defaults behind the original overrides.
  const instance: Record<string, JsonValue> = { _type: source._type };
  let definition: JsonObject | undefined = prototype;
  const visited = new Set<JsonObject>();
  while (definition !== undefined && !visited.has(definition)) {
    visited.add(definition);
    if (typeof definition.type === "string") { instance.type = definition.type; break; }
    const base: JsonValue | undefined = isPlainJsonObject(document._definitions) && typeof definition._extends === "string"
      ? document._definitions[definition._extends] : undefined;
    definition = isPlainJsonObject(base) ? base : undefined;
  }
  // The raw UI schema requires its runtime discriminator before expansion.
  if (instance.type === undefined && typeof source.type === "string") instance.type = source.type;
  for (const key of ["id", "gameEntityId", "_label", "_semantics"] as const) {
    if (source[key] !== undefined) instance[key] = source[key];
  }
  const parts = parseJsonPointer(input.sourcePointer);
  const parentPointer = input.sourcePointer.slice(0, input.sourcePointer.lastIndexOf("/"));
  const parent = readJsonPointer(document, parentPointer);
  const key = parts.at(-1)!;
  if (Array.isArray(parent)) parent[Number(key)] = instance;
  else if (isPlainJsonObject(parent)) (parent as Record<string, JsonValue>)[key] = instance;
  else throw new EditorRepositoryError("Выбранный элемент больше не существует.", 409);

  const text = JSON.stringify(document);
  const filePath = normalizeAuthoringFilePath(input.filePath);
  const snapshot = createDocumentStore({ filePath, text }).snapshot();
  const diagnostics = collectAuthoringDiagnostics(snapshot, filePath);
  if (hasErrors(diagnostics)) throw new EditorRepositoryError(diagnostics[0]?.message ?? "Некорректный прототип.", 422);
  const compiler = await getCompiler(input.repoRoot);
  const job = await findJob(compiler, input.gameId, filePath, input.repoRoot);
  const ajv = compiler.getSharedAjv();
  const output = compiler.compileAuthoringText(job, text, ajv);
  diagnostics.push(...runtimeDiagnostics(compiler, job, output, snapshot, ajv));
  if (hasErrors(diagnostics)) throw new EditorRepositoryError(diagnostics.find(item => item.severity === "error")?.message ?? "Прототип не прошёл проверку.", 422);
  const runtimePointer = Object.entries(output.sourceMap.mappings).find(([, sources]) =>
    sources.some(item => item.file === output.sourceMap.sourceFile && item.pointer === input.sourcePointer));
  const component = runtimePointer === undefined ? undefined : readJsonPointer(output.manifest as JsonValue, runtimePointer[0]);
  if (!isPlainJsonObject(component) || typeof component.type !== "string") {
    throw new EditorRepositoryError("Не удалось определить представление прототипа.", 422);
  }
  return component;
}

export async function compileGameForEditor(input: {
  readonly gameId: string;
  readonly checkOnly?: boolean;
  readonly repoRoot?: string;
  /** In-memory authoring sources used for an exact non-authoring preview. */
  readonly authoringTextOverrides?: ReadonlyMap<string, string>;
  /** Redirects generated artifacts into an isolated candidate content root. */
  readonly generatedArtifactRoot?: string;
}): Promise<EditorCompileResult> {
  const checkOnly = input.checkOnly ?? false;
  const compilerRoot = resolveRepositoryRoot(input.repoRoot);
  const sourceRoot = input.repoRoot === undefined ? compilerRoot : path.resolve(input.repoRoot);
  const compiler = await getCompiler(compilerRoot);
  const jobs = await discoverEditorCompileJobs(compiler, compilerRoot, sourceRoot, input.gameId);
  if (jobs.length === 0) {
    throw new EditorRepositoryError(`No authoring compiler jobs were found for game: ${input.gameId}`, 404);
  }

  const ajv = compiler.getSharedAjv();
  const telemetry = compiler.createCompileTelemetry();
  const diagnostics: EditorCompilerDiagnostic[] = [];
  const artifacts: EditorCompileArtifact[] = [];

  for (const job of jobs) {
    try {
      const artifactRoot = input.generatedArtifactRoot ?? sourceRoot;
      const outputFile = path.join(artifactRoot, compiler.relativePath(job.outputFile));
      const sourceMapFile = path.join(artifactRoot, compiler.relativePath(job.sourceMapFile));
      const relativeSourcePath = authoringRelativePath(compiler, job);
      const sourceFile = path.join(sourceRoot, compiler.relativePath(job.sourceFile));
      const text = input.authoringTextOverrides?.get(relativeSourcePath) ?? await readFile(sourceFile, "utf8");
      const output = compiler.compileAuthoringTextCached(job, text, ajv, { telemetry });
      const runtime = compiler.validateRuntimeManifest(job, output.manifest, ajv);
      artifacts.push(toArtifact(compiler, job));
      diagnostics.push(...runtime.errors.map((error) => runtimeErrorToDiagnostic(compiler, job, output.sourceMap, error)));

      if (checkOnly) {
        const manifestDiff = compiler.compareGenerated(outputFile, output.manifest);
        const sourceMapDiff = compiler.compareGenerated(sourceMapFile, output.sourceMap);
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
        await writeJsonFile(outputFile, output.manifest);
        await writeJsonFile(sourceMapFile, output.sourceMap);
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
    artifacts,
    telemetry: telemetry.snapshot()
  };
}

export async function planPrototypeExtractionForEditor(input: {
  readonly gameId: string;
  readonly filePath: string;
  readonly text: string;
  readonly sourcePointers?: readonly string[];
  readonly definitionType?: string;
  readonly definitionSemantics?: string;
  readonly promptTemplate?: JsonObject;
  readonly classification?: Exclude<PrototypeExtractionClassification, "rejected-over-extraction">;
  readonly knownVariantKeys?: readonly string[];
  readonly repoRoot?: string;
}): Promise<EditorPrototypeExtractionResult> {
  const filePath = normalizeAuthoringFilePath(input.filePath);
  // Same Level-2 warm-start cache as validate: the revived snapshot is identical
  // to a freshly built one, so caching is transparent to prototype extraction.
  const snapshot = await loadDocumentSnapshotWithCache({ filePath, text: input.text });
  const diagnostics: EditorCompilerDiagnostic[] = [];
  const gates: EditorPrototypeExtractionGate[] = [];
  const artifacts: EditorCompileArtifact[] = [];

  const selectedSources = selectPrototypeSourcePointers(snapshot, input.sourcePointers);
  if (!selectedSources.ok) {
    diagnostics.push(...selectedSources.diagnostics.map((diagnostic) => documentDiagnosticToCompilerDiagnostic(diagnostic, filePath)));
    gates.push(makeGate("candidate-selection", "Candidate selection", diagnostics));
    return prototypeExtractionResult(input.gameId, filePath, undefined, diagnostics, [], gates, artifacts);
  }

  const definitionType = input.definitionType?.trim() || inferPrototypeDefinitionType(snapshot, selectedSources.sourcePointers);
  const proposalResult = createPrototypeExtractionProposal({
    snapshot,
    sourcePointers: selectedSources.sourcePointers,
    definitionType,
    definitionSemantics: input.definitionSemantics?.trim() || "Local prototype extracted from repeated authoring elements.",
    promptTemplate: input.promptTemplate,
    classification: input.classification,
    knownVariantKeys: input.knownVariantKeys
  });
  if (!proposalResult.ok) {
    diagnostics.push(...proposalResult.diagnostics.map((diagnostic) => documentDiagnosticToCompilerDiagnostic(diagnostic, filePath)));
    gates.push(makeGate("proposal", "Prototype proposal", diagnostics));
    return prototypeExtractionResult(input.gameId, filePath, undefined, diagnostics, [], gates, artifacts);
  }

  gates.push(makeGate("proposal", "Prototype proposal", []));

  const registry = getSharedAuthoringSchemaRegistry();
  const dryRun = dryRunEditorChangeSet({
    snapshot,
    changeSet: proposalResult.proposal.changeSet,
    schemaRegistry: registry,
    schemaId: schemaIdForAuthoringDocument(filePath, snapshot.json),
    includeSemanticDiagnostics: true
  });
  const dryRunDiagnostics = dryRun.diagnostics.map((diagnostic) => documentDiagnosticToCompilerDiagnostic(diagnostic, filePath));
  diagnostics.push(...dryRunDiagnostics);
  gates.push(makeGate("editor-dry-run", "Editor ChangeSet dry-run", dryRunDiagnostics));
  if (!dryRun.ok || dryRun.after?.json === undefined) {
    return prototypeExtractionResult(input.gameId, filePath, proposalResult.proposal, diagnostics, dryRun.diffSummary, gates, artifacts);
  }

  const compiler = await getCompiler(input.repoRoot);
  const job = await findJob(compiler, input.gameId, filePath, input.repoRoot);
  artifacts.push(toArtifact(compiler, job));
  const ajv = compiler.getSharedAjv();

  let beforeOutput: CompilerOutput;
  let afterOutput: CompilerOutput;
  try {
    const compiledBefore = compiler.compileAuthoringText(job, input.text, ajv);
    const compiledAfter = compiler.compileAuthoringText(job, dryRun.after.text, ajv);
    beforeOutput = compiledBefore;
    afterOutput = compiledAfter;
    const runtimeErrors = compiler.validateRuntimeManifest(job, compiledAfter.manifest, ajv).errors;
    const runtimeDiagnosticsAfter = runtimeErrors.map((error) => runtimeErrorToDiagnostic(compiler, job, compiledAfter.sourceMap, error));
    diagnostics.push(...runtimeDiagnosticsAfter);
    gates.push(makeGate("runtime-schema", "Generated runtime schema", runtimeDiagnosticsAfter));
  } catch (error) {
    const compileDiagnostic = compileErrorToDiagnostic(compiler, error, dryRun.after, filePath);
    diagnostics.push(compileDiagnostic);
    gates.push(makeGate("compiler-dry-run", "Compiler dry-run", [compileDiagnostic]));
    return prototypeExtractionResult(input.gameId, filePath, proposalResult.proposal, diagnostics, dryRun.diffSummary, gates, artifacts);
  }

  gates.push(makeGate("compiler-dry-run", "Compiler dry-run", []));

  const runtimeDiffDiagnostics =
    proposalResult.proposal.expectedRuntimeDiff === "must-be-zero" && !stableJsonEqual(beforeOutput.manifest, afterOutput.manifest)
      ? [
          {
            severity: "error" as const,
            source: "prototype-extraction",
            pointer: "",
            label: "/",
            message: "Prototype extraction changed generated runtime manifest output; move this change to a separate migration task.",
            filePath
          }
        ]
      : [];
  diagnostics.push(...runtimeDiffDiagnostics);
  gates.push(makeGate("canonical-runtime-diff", "Canonical runtime diff", runtimeDiffDiagnostics));

  const sourceMapDiagnostics = sourceMapPointerDiagnostics({
    compiler,
    job,
    afterJson: dryRun.after.json,
    sourceMap: afterOutput.sourceMap,
    proposal: proposalResult.proposal,
    filePath
  });
  diagnostics.push(...sourceMapDiagnostics);
  gates.push(makeGate("source-map-pointer-existence", "Source map pointer existence", sourceMapDiagnostics));

  return prototypeExtractionResult(input.gameId, filePath, proposalResult.proposal, diagnostics, dryRun.diffSummary, gates, artifacts);
}

export function mapGeneratedPointerToAuthoring(
  sourceMap: CompilerSourceMap,
  generatedPointer: string
): CompilerSource | undefined {
  const originalPointer = normalizeGeneratedPointer(generatedPointer);
  let pointer = originalPointer;

  for (;;) {
    const sources = sourceMap.mappings[pointer];
    if (sources !== undefined && sources.length > 0) {
      const source = sources[0];
      // See preview-message-adapter.ts's identical check for why this can
      // only append the walked-past suffix when `pointer` is listed in
      // `verbatimSubtrees` — an identical (non-listed) match's source already
      // IS the answer, and appending to it would fabricate a pointer that
      // does not exist.
      if (sourceMap.verbatimSubtrees?.includes(pointer)) {
        return {
          file: source.file,
          pointer: source.pointer + originalPointer.slice(pointer.length)
        };
      }
      return source;
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
  repoRoot?: string,
  generatedArtifactRoot?: string
): Promise<readonly EditorPreviewSourceMap[]> {
  const compilerRoot = resolveRepositoryRoot(repoRoot);
  const sourceRoot = repoRoot === undefined ? compilerRoot : path.resolve(repoRoot);
  const compiler = await getCompiler(compilerRoot);
  const jobs = await discoverEditorCompileJobs(compiler, compilerRoot, sourceRoot, gameId);
  const sourceMaps: EditorPreviewSourceMap[] = [];

  for (const job of jobs) {
    const sourceMapFile = path.join(generatedArtifactRoot ?? sourceRoot, compiler.relativePath(job.sourceMapFile));
    if (!existsSync(sourceMapFile)) {
      continue;
    }

    const text = await readFile(sourceMapFile, "utf8");
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
        mappings: parsed.mappings as EditorPreviewSourceMap["mappings"],
        verbatimSubtrees: Array.isArray(parsed.verbatimSubtrees) ? parsed.verbatimSubtrees : undefined
      });
    }
  }

  return sourceMaps;
}

export async function compilerExportsForTests(): Promise<readonly string[]> {
  return Object.keys(await getCompiler()).sort();
}

function collectAuthoringDiagnostics(snapshot: DocumentSnapshot, filePath: string): EditorCompilerDiagnostic[] {
  const registry = getSharedAuthoringSchemaRegistry();
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

function selectPrototypeSourcePointers(
  snapshot: DocumentSnapshot,
  requestedPointers: readonly string[] | undefined
):
  | {
      readonly ok: true;
      readonly sourcePointers: readonly string[];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly DocumentDiagnostic[];
    } {
  const explicitPointers = [...new Set((requestedPointers ?? []).map((pointer) => pointer.trim()).filter(Boolean))];
  if (explicitPointers.length >= 2) {
    return { ok: true, sourcePointers: explicitPointers };
  }

  const discovered = discoverPrototypeExtractionCandidates({ snapshot, rootPointer: "/root" });
  if (!discovered.ok) {
    return { ok: false, diagnostics: discovered.diagnostics };
  }

  const candidate = discovered.candidates[0];
  if (candidate === undefined) {
    return {
      ok: false,
      diagnostics: [
        {
          severity: "error",
          source: "prototype-extraction",
          pointer: "",
          message: "No repeated authoring object candidate was found for prototype extraction."
        }
      ]
    };
  }

  return { ok: true, sourcePointers: candidate.pointers };
}

function inferPrototypeDefinitionType(snapshot: DocumentSnapshot, sourcePointers: readonly string[]): string {
  const firstValue = sourcePointers[0] === undefined ? undefined : readJsonPointer(snapshot.json as JsonValue, sourcePointers[0]);
  const typePrefix = inferPrototypePrefix(snapshot.filePath, firstValue);
  const sourceType = firstValue !== undefined && typeof firstValue === "object" && firstValue !== null && !Array.isArray(firstValue)
    ? typeof (firstValue as { readonly _type?: unknown })._type === "string"
      ? (firstValue as { readonly _type: string })._type
      : undefined
    : undefined;
  const baseName = sourceType?.split(".").at(-1) ?? "ExtractedPrototype";
  const suffix = hashString(sourcePointers.join("\n")).slice(0, 6);
  return `${typePrefix}.${toDefinitionSegment(`Local${baseName}${suffix}`)}`;
}

function inferPrototypePrefix(filePath: string, value: JsonValue | undefined): "game" | "ui" {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const type = (value as { readonly _type?: unknown })._type;
    if (typeof type === "string" && type.startsWith("game.")) {
      return "game";
    }
    if (typeof type === "string" && type.startsWith("ui.")) {
      return "ui";
    }
  }
  return filePath.includes("/ui/") || filePath.includes("ui/") ? "ui" : "game";
}

function toDefinitionSegment(value: string): string {
  const normalized = value
    .replace(/[^a-zA-Z0-9]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return /^[A-Z]/u.test(normalized) ? normalized : `Prototype${normalized}`;
}

function documentDiagnosticToCompilerDiagnostic(diagnostic: DocumentDiagnostic, filePath: string): EditorCompilerDiagnostic {
  return {
    severity: diagnostic.severity,
    source: diagnostic.source,
    pointer: diagnostic.pointer,
    label: diagnostic.pointer === "" ? "/" : diagnostic.pointer,
    message: diagnostic.message,
    range: diagnostic.range,
    filePath
  };
}

function makeGate(
  id: string,
  label: string,
  diagnostics: readonly EditorCompilerDiagnostic[]
): EditorPrototypeExtractionGate {
  return {
    id,
    label,
    ok: !hasErrors(diagnostics),
    diagnostics
  };
}

function prototypeExtractionResult(
  gameId: string,
  filePath: string,
  proposal: PrototypeExtractionProposal | undefined,
  diagnostics: readonly EditorCompilerDiagnostic[],
  diffSummary: readonly EditorDiffSummaryItem[],
  gates: readonly EditorPrototypeExtractionGate[],
  artifacts: readonly EditorCompileArtifact[]
): EditorPrototypeExtractionResult {
  return {
    ok: !hasErrors(diagnostics),
    gameId,
    filePath,
    proposal,
    diagnostics,
    diffSummary,
    gates,
    artifacts
  };
}

function sourceMapPointerDiagnostics(input: {
  readonly compiler: AuthoringCompilerModule;
  readonly job: CompilerJob;
  readonly afterJson: JsonValue;
  readonly sourceMap: CompilerSourceMap;
  readonly proposal: PrototypeExtractionProposal;
  readonly filePath: string;
}): readonly EditorCompilerDiagnostic[] {
  const diagnostics: EditorCompilerDiagnostic[] = [];
  const sourceFile = input.compiler.relativePath(input.job.sourceFile);
  const requiredPointers = new Set(input.proposal.sourceMapImpact.affectedPointers);

  for (const pointer of requiredPointers) {
    if (readJsonPointer(input.afterJson, pointer) === undefined) {
      diagnostics.push({
        severity: "error",
        source: "source-map",
        pointer,
        label: pointer === "" ? "/" : pointer,
        message: `Affected authoring pointer no longer exists after prototype extraction: ${pointer || "/"}.`,
        filePath: input.filePath
      });
    }
  }

  for (const sources of Object.values(input.sourceMap.mappings)) {
    for (const source of sources) {
      if (source.file !== sourceFile || readJsonPointer(input.afterJson, source.pointer) !== undefined) {
        continue;
      }

      diagnostics.push({
        severity: "error",
        source: "source-map",
        pointer: source.pointer,
        label: source.pointer === "" ? "/" : source.pointer,
        message: `Generated source map points to a missing authoring pointer: ${source.pointer || "/"}.`,
        filePath: input.filePath,
        generatedFile: input.sourceMap.generatedFile
      });
    }
  }

  return diagnostics;
}

function stableJsonEqual(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
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

async function discoverEditorCompileJobs(
  compiler: AuthoringCompilerModule,
  compilerRoot: string,
  sourceRoot: string,
  gameId: string
): Promise<readonly CompilerJob[]> {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(gameId)) {
    throw new EditorRepositoryError("Game id must be a safe repository segment.", 400);
  }
  if (sourceRoot === compilerRoot) {
    return compiler.discoverJobs({ gameId });
  }

  // The compiler module lives in the full checkout, while an editor session
  // may contain only one game's files. Virtual job paths keep published source
  // maps repository-relative; source bytes are read from sourceRoot instead.
  const sourceGameRoot = path.join(sourceRoot, "games", gameId);
  const compilerGameRoot = path.join(compilerRoot, "games", gameId);
  const jobs: CompilerJob[] = [];
  if (existsSync(path.join(sourceGameRoot, "authoring", "game.authoring.json"))) {
    jobs.push({
      kind: "game", gameId,
      sourceFile: path.join(compilerGameRoot, "authoring", "game.authoring.json"),
      outputFile: path.join(compilerGameRoot, "game.manifest.json"),
      sourceMapFile: path.join(compilerGameRoot, "game.manifest.source-map.json")
    });
  }

  const uiSourceRoot = path.join(sourceGameRoot, "authoring", "ui");
  if (existsSync(uiSourceRoot)) {
    for (const entry of (await readdir(uiSourceRoot, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".authoring.json")) continue;
      const channel = entry.name.slice(0, -".authoring.json".length);
      jobs.push({
        kind: "ui", gameId, channel,
        sourceFile: path.join(compilerGameRoot, "authoring", "ui", entry.name),
        outputFile: path.join(compilerGameRoot, "ui", channel, "ui.manifest.json"),
        sourceMapFile: path.join(compilerGameRoot, "ui", channel, "ui.manifest.source-map.json")
      });
    }
  }
  return jobs;
}

async function findJob(
  compiler: AuthoringCompilerModule,
  gameId: string,
  filePath: string,
  repoRoot?: string
): Promise<CompilerJob> {
  const compilerRoot = resolveRepositoryRoot(repoRoot);
  const sourceRoot = repoRoot === undefined ? compilerRoot : path.resolve(repoRoot);
  const jobs = await discoverEditorCompileJobs(compiler, compilerRoot, sourceRoot, gameId);
  const job = jobs.find((candidate) => authoringRelativePath(compiler, candidate) === filePath);
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

interface JsonWriteOperations {
  readonly mkdir: typeof mkdir;
  readonly writeFile: typeof writeFile;
  readonly rename: typeof rename;
  readonly rm: typeof rm;
}

const jsonWriteOperations: JsonWriteOperations = { mkdir, writeFile, rename, rm };

async function writeJsonFile(
  filePath: string,
  value: unknown,
  operations: JsonWriteOperations = jsonWriteOperations
): Promise<void> {
  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );

  try {
    await operations.mkdir(directory, { recursive: true });
    // The temporary file is in the destination directory, so rename publishes
    // a complete JSON document atomically rather than exposing a partial write.
    await operations.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await operations.rename(tempPath, filePath);
  } catch (error) {
    await operations.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Test-only seam for proving failed writes preserve the previously published manifest. */
export async function writeJsonFileForTests(
  filePath: string,
  value: unknown,
  operations: JsonWriteOperations
): Promise<void> {
  await writeJsonFile(filePath, value, operations);
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
