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
  createPrototypeExtractionProposal,
  discoverPrototypeExtractionCandidates,
  dryRunEditorChangeSet,
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
  readonly telemetry: EditorCompileTelemetry;
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
  const compiler = await getCompiler(input.repoRoot);
  const telemetry = compiler.createCompileTelemetry();

  if (!hasBlockingSource(diagnostics, new Set(["syntax", "schema"]))) {
    const job = findJob(compiler, input.gameId, filePath);
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
    telemetry: telemetry.snapshot()
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

  const ajv = compiler.getSharedAjv();
  const telemetry = compiler.createCompileTelemetry();
  const diagnostics: EditorCompilerDiagnostic[] = [];
  const artifacts: EditorCompileArtifact[] = [];

  for (const job of jobs) {
    try {
      const text = await readFile(job.sourceFile, "utf8");
      const output = compiler.compileAuthoringTextCached(job, text, ajv, { telemetry });
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
  const snapshot = createDocumentStore({ filePath, text: input.text }).snapshot();
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
  const job = findJob(compiler, input.gameId, filePath);
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
