/**
 * Server authority for preview-confirmed editor mutations.
 *
 * The browser may render a candidate from its current buffer, but this module
 * is the final source of truth: it re-reads the session worktree, validates the
 * active disk version, dry-runs every affected document, and binds the exact
 * before/after effect to an opaque SHA-256 digest before authoring writes.
 */
import {
  buildEditorEntityProjection,
  createDocumentStore,
  dryRunMultiDocumentChangeSet,
  inferEditorEntityDocumentChannel,
  inferEditorEntityDocumentKind,
  classifyChangeSet,
  type DocumentDiagnostic,
  type EditorChangeSet,
  type EditorEntityProjectionDocument,
  type EditorMutationRequest,
  type JsonValue
} from "@cubica/editor-engine";
import editorMutationSchema from "../../../../docs/architecture/schemas/editor-mutation.schema.json";
import {
  createSchemaRegistry,
  type SchemaRegistry
} from "@cubica/editor-engine";
import { createHash } from "node:crypto";

import {
  EditorRepositoryError,
  applyAuthoringFilesToWorktree,
  hashText,
  listAuthoringFiles,
  normalizeAuthoringFilePath,
  openAuthoringFile
} from "./editor-repository";
import {
  repoRootForSession,
  withEditorSessionMutationLease
} from "./editor-session-store";
import {
  compileGameForEditor,
  loadPreviewSelectionSourceMaps,
  type EditorCompilerDiagnostic
} from "./compiler-workflow";
import { prepareRuntimeSession } from "./editor-preview-runtime";
import { copyCandidatePluginBundles, createEditorMutationCandidate } from "./editor-mutation-candidate";
import { validateAndBundleProjectPlugins } from "./project-plugin-validation";
import { getSharedAuthoringSchemaRegistry, schemaIdForAuthoringDocument } from "./editor-json-schema";

const editorMutationSchemaId = "https://cubica.platform/schemas/editor-mutation.schema.json";
const editorMutationDigestDomain = "cubica.editor-mutation.effect.v1";

interface MutationContext {
  readonly repoRoot: string;
  readonly sessionId: string;
  readonly gameId: string;
  readonly activeFilePath: string;
  readonly activeDiskVersionHash: string;
  readonly beforeTextByPath: ReadonlyMap<string, string>;
  readonly projection: ReturnType<typeof buildEditorEntityProjection>;
  readonly changeSet: EditorChangeSet;
}

interface PreparedEffect {
  readonly context: MutationContext;
  readonly dryRun: ReturnType<typeof dryRunMultiDocumentChangeSet>;
  readonly risk: ReturnType<typeof classifyChangeSet>;
  readonly effectDigest: string;
  readonly documents: readonly MutationDocument[];
  readonly compileTextByPath: ReadonlyMap<string, string>;
}

interface MutationDocument {
  readonly filePath: string;
  readonly text: string;
  readonly previousVersionHash: string;
  readonly versionHash: string;
}

interface MutationRouteResult {
  readonly body: unknown;
  readonly status?: number;
}

interface PendingEffect {
  readonly baseEffectDigest: string;
  readonly confirmationDigest: string;
  readonly candidateRoot: string;
}

// The lease serializes operations for a session; only a successfully rendered
// candidate can authorize a later confirm in this server process.
const pendingEffectsBySession = new Map<string, PendingEffect>();

export function clearPendingEditorMutationEffectsForTests(): void {
  pendingEffectsBySession.clear();
}

const requestSchemaRegistry = createMutationRequestSchemaRegistry();

/** Validates the route body against the canonical JSON Schema using Ajv. */
export function validateEditorMutationRequest(value: unknown): value is EditorMutationRequest {
  return requestSchemaRegistry.validateValue({
    schemaId: editorMutationSchemaId,
    value: value as JsonValue
  }).length === 0;
}

export async function executeEditorMutation(
  value: EditorMutationRequest,
  requestOrigin: string | undefined
): Promise<MutationRouteResult> {
  const action = value.action;
  return withEditorSessionMutationLease(value.sessionId, `editor-mutation:${action}`, async () => {
    const prepared = await calculatePreparedEffect(value);
    if (!prepared.dryRun.ok) {
      return {
        status: 422,
        body: {
          ok: false,
          status: "invalid",
          summary: value.changeSet.summary,
          diagnostics: prepared.dryRun.diagnostics.map(toMutationDiagnostic)
        }
      };
    }

    if (isNoOp(prepared)) {
      return {
        status: 422,
        body: {
          ok: true,
          status: "no-op",
          summary: value.changeSet.summary,
          diagnostics: [{ severity: "warning", source: "change-set", pointer: "", message: "ChangeSet produces no content changes." }]
        }
      };
    }

    if (action === "prepare") {
      const result = await buildMutationPreview({
        prepared,
        requestOrigin,
        preserveRoot: pendingEffectsBySession.get(value.sessionId)?.candidateRoot
      });
      if (result.candidateRoot !== undefined && result.confirmationDigest !== undefined) {
        pendingEffectsBySession.set(value.sessionId, {
          baseEffectDigest: prepared.effectDigest,
          confirmationDigest: result.confirmationDigest,
          candidateRoot: result.candidateRoot
        });
      }
      return {
        body: {
          ok: true,
          status: "prepared",
          summary: value.changeSet.summary,
          effectDigest: result.confirmationDigest ?? prepared.effectDigest,
          risk: prepared.risk.risk,
          riskReasons: prepared.risk.reasons,
          documents: prepared.documents,
          inverseChangeSet: prepared.dryRun.inverseChangeSet,
          changedPointersByFile: prepared.dryRun.changedPointersByFile,
          diffSummary: prepared.dryRun.diffSummary.map(toMutationDiffSummaryItem),
          diagnostics: prepared.dryRun.diagnostics.map(toMutationDiagnostic),
          preview: result.preview
        }
      };
    }

    if (action === "confirm" && (
      pendingEffectsBySession.get(value.sessionId)?.baseEffectDigest !== prepared.effectDigest ||
      value.effectDigest !== pendingEffectsBySession.get(value.sessionId)?.confirmationDigest
    )) {
      throw new EditorRepositoryError("The prepared editor effect is stale or does not match this request.", 409);
    }

    // Validate the exact after-text map without publishing generated files to
    // the live worktree. The next current-preview build publishes after commit.
    {
      const candidate = await createEditorMutationCandidate({
        gameId: prepared.context.gameId,
        sessionId: prepared.context.sessionId,
        repoRoot: prepared.context.repoRoot,
        preserveRoot: pendingEffectsBySession.get(value.sessionId)?.candidateRoot
      });
      try {
        const compile = await compileGameForEditor({
          gameId: prepared.context.gameId,
          repoRoot: prepared.context.repoRoot,
          checkOnly: false,
          authoringTextOverrides: prepared.compileTextByPath,
          generatedArtifactRoot: candidate.repoRoot
        });
        if (!compile.ok) {
          throw new EditorMutationValidationError("The editor effect failed runtime validation.", compile.diagnostics);
        }
      } finally {
        await candidate.discard();
      }
    }

    const applied = await applyAuthoringFilesToWorktree({
      gameId: prepared.context.gameId,
      repoRoot: prepared.context.repoRoot,
      files: prepared.documents.map((document) => ({ filePath: document.filePath, text: document.text })),
      expectedBeforeHashes: Object.fromEntries(prepared.documents.map((document) => [
        document.filePath,
        document.filePath === prepared.context.activeFilePath
          ? prepared.context.activeDiskVersionHash
          : document.previousVersionHash
      ]))
    });
    pendingEffectsBySession.delete(value.sessionId);

    return {
      body: {
        ok: true,
        status: action === "direct" ? "direct" : "confirmed",
        summary: value.changeSet.summary,
        effectDigest: action === "confirm"
          ? value.effectDigest
          : prepared.effectDigest,
        inverseChangeSet: prepared.dryRun.inverseChangeSet,
        changedPointersByFile: prepared.dryRun.changedPointersByFile,
        diffSummary: prepared.dryRun.diffSummary.map(toMutationDiffSummaryItem),
        documents: prepared.documents.map((document, index) => ({
          ...document,
          versionHash: applied.files[index]?.versionHash ?? document.versionHash
        }))
      }
    };
  });
}

class EditorMutationValidationError extends EditorRepositoryError {
  constructor(message: string, readonly diagnostics: readonly EditorCompilerDiagnostic[]) {
    super(message, 422);
    this.name = "EditorMutationValidationError";
  }
}

export function mutationErrorResponse(error: unknown): MutationRouteResult {
  if (error instanceof EditorMutationValidationError) {
    return {
      status: error.statusCode,
      body: { error: error.message, diagnostics: error.diagnostics.map(toMutationDiagnostic) }
    };
  }
  if (error instanceof EditorRepositoryError) {
    return { status: error.statusCode, body: { error: error.message } };
  }
  return { status: 500, body: { error: "Unexpected editor mutation failure." } };
}

function createMutationRequestSchemaRegistry(): SchemaRegistry {
  const registry = createSchemaRegistry();
  registry.registerSchema(editorMutationSchemaId, editorMutationSchema);
  return registry;
}

async function calculatePreparedEffect(value: EditorMutationRequest): Promise<PreparedEffect> {
  const sessionResult = await repoRootForSession(value.sessionId, value.gameId);
  if (sessionResult.session === undefined || sessionResult.repoRoot === undefined) {
    throw new EditorRepositoryError("Editor mutation requires an active editor session worktree.", 400);
  }
  if (sessionResult.session.gameId !== value.gameId) {
    throw new EditorRepositoryError("Editor session does not belong to the requested game.", 409);
  }

  const activeFilePath = normalizeAuthoringFilePath(value.activeFilePath);
  const changeSet = normalizeChangeSet(value.changeSet);
  const activeDisk = await openAuthoringFile({ gameId: value.gameId, filePath: activeFilePath, repoRoot: sessionResult.repoRoot });
  if (activeDisk.versionHash !== value.activeDocument.versionHash) {
    throw new EditorRepositoryError("The active authoring file changed on disk. Reload before applying.", 409);
  }

  const affectedFilePaths = [...new Set(changeSet.jsonPatches.map((patch) => patch.filePath))].sort();
  const beforeTextByPath = new Map<string, string>();
  for (const filePath of affectedFilePaths) {
    beforeTextByPath.set(
      filePath,
      filePath === activeFilePath
        ? value.activeDocument.text
        : (await openAuthoringFile({ gameId: value.gameId, filePath, repoRoot: sessionResult.repoRoot })).text
    );
  }

  const projection = await loadProjection({
    gameId: value.gameId,
    repoRoot: sessionResult.repoRoot,
    activeFilePath,
    activeText: value.activeDocument.text
  });
  const dryRun = dryRunMultiDocumentChangeSet({
    changeSet,
    documentTextByPath: beforeTextByPath,
    schemaRegistry: getAuthoringSchemaRegistry(),
    resolveSchemaId: (filePath) => schemaIdForFile(filePath, beforeTextByPath.get(filePath)),
    includeSemanticDiagnostics: true
  });
  const risk = classifyChangeSet(changeSet, projection);
  const documents = [...dryRun.affectedFilePaths]
    .sort()
    .map((filePath) => {
      const text = dryRun.afterTextByPath.get(filePath) ?? "";
      return {
        filePath,
        text,
        previousVersionHash: hashText(dryRun.beforeTextByPath.get(filePath) ?? ""),
        versionHash: hashText(text)
      } satisfies MutationDocument;
    });
  const effectDigest = computeEffectDigest({
    sessionId: value.sessionId,
    gameId: value.gameId,
    activeFilePath,
    activeBufferHash: hashText(value.activeDocument.text),
    changeSet,
    risk,
    documents
  });
  const compileTextByPath = new Map<string, string>([[activeFilePath, value.activeDocument.text]]);
  for (const [filePath, text] of dryRun.afterTextByPath) compileTextByPath.set(filePath, text);

  return {
    context: {
      repoRoot: sessionResult.repoRoot,
      sessionId: value.sessionId,
      gameId: value.gameId,
      activeFilePath,
      activeDiskVersionHash: activeDisk.versionHash,
      beforeTextByPath,
      projection,
      changeSet
    },
    dryRun,
    risk,
    effectDigest,
    documents,
    compileTextByPath
  };
}

async function loadProjection(input: {
  readonly gameId: string;
  readonly repoRoot: string;
  readonly activeFilePath: string;
  readonly activeText: string;
}) {
  const listed = await listAuthoringFiles({ gameId: input.gameId, repoRoot: input.repoRoot });
  const documents: EditorEntityProjectionDocument[] = [];
  let activeChannel: string | undefined;
  for (const file of listed.files) {
    const text = file.filePath === input.activeFilePath
      ? input.activeText
      : (await openAuthoringFile({ gameId: input.gameId, filePath: file.filePath, repoRoot: input.repoRoot })).text;
    const snapshot = createDocumentStore({ filePath: file.filePath, text }).snapshot();
    const documentKind = inferEditorEntityDocumentKind(snapshot.json);
    if (documentKind !== "game" && documentKind !== "ui") continue;
    const channel = inferEditorEntityDocumentChannel(snapshot.json);
    documents.push({ filePath: file.filePath, json: snapshot.json, documentKind, channel, sourceHash: hashText(text) });
    if (file.filePath === input.activeFilePath && documentKind === "ui") activeChannel = channel;
  }
  return buildEditorEntityProjection({ gameId: input.gameId, documents, activeChannel });
}

let authoringSchemaRegistry: SchemaRegistry | undefined;
function getAuthoringSchemaRegistry(): SchemaRegistry {
  if (authoringSchemaRegistry === undefined) {
    // Avoid importing the React workspace module into this server boundary;
    // the existing server schema registry is the shared source of truth.
    authoringSchemaRegistry = getSharedAuthoringSchemaRegistry();
  }
  return authoringSchemaRegistry;
}

function schemaIdForFile(filePath: string, text: string | undefined): string | undefined {
  let json: JsonValue | undefined;
  try { json = text === undefined ? undefined : JSON.parse(text) as JsonValue; } catch { /* dry-run reports syntax */ }
  return schemaIdForAuthoringDocument(filePath, json);
}

function normalizeChangeSet(changeSet: EditorChangeSet): EditorChangeSet {
  return {
    ...changeSet,
    jsonPatches: changeSet.jsonPatches.map((patch) => ({
      ...patch,
      filePath: normalizeAuthoringFilePath(patch.filePath)
    })),
    textPatches: changeSet.textPatches?.map((patch) => ({ ...patch, filePath: normalizeAuthoringFilePath(patch.filePath) })),
    fileCreates: changeSet.fileCreates?.map((file) => ({ ...file, filePath: normalizeAuthoringFilePath(file.filePath) })),
    fileDeletes: changeSet.fileDeletes?.map((file) => ({ ...file, filePath: normalizeAuthoringFilePath(file.filePath) })),
    fileRenames: changeSet.fileRenames?.map((file) => ({
      ...file,
      fromFilePath: normalizeAuthoringFilePath(file.fromFilePath),
      toFilePath: normalizeAuthoringFilePath(file.toFilePath)
    }))
  };
}

function computeEffectDigest(input: {
  readonly sessionId: string;
  readonly gameId: string;
  readonly activeFilePath: string;
  readonly activeBufferHash: string;
  readonly changeSet: EditorChangeSet;
  readonly risk: ReturnType<typeof classifyChangeSet>;
  readonly documents: readonly MutationDocument[];
}): string {
  const payload = stableStringify({
    domain: editorMutationDigestDomain,
    policyVersion: "1",
    sessionId: input.sessionId,
    gameId: input.gameId,
    activeFilePath: input.activeFilePath,
    activeBufferHash: input.activeBufferHash,
    changeSet: input.changeSet,
    risk: { level: input.risk.risk, reasons: input.risk.reasons },
    documents: input.documents
      .map((document) => ({ filePath: document.filePath, before: document.previousVersionHash, after: document.versionHash }))
      .sort((left, right) => left.filePath.localeCompare(right.filePath))
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

async function buildMutationPreview(input: {
  readonly prepared: PreparedEffect;
  readonly requestOrigin: string | undefined;
  readonly preserveRoot?: string;
}): Promise<{
  readonly preview: Record<string, unknown>;
  readonly candidateRoot?: string;
  readonly confirmationDigest?: string;
}> {
  const { context } = input.prepared;
  const candidate = await createEditorMutationCandidate({
    gameId: context.gameId, sessionId: context.sessionId, repoRoot: context.repoRoot,
    preserveRoot: input.preserveRoot
  });
  try {
    const compile = await compileGameForEditor({
      gameId: context.gameId,
      repoRoot: context.repoRoot,
      checkOnly: false,
      authoringTextOverrides: input.prepared.compileTextByPath,
      generatedArtifactRoot: candidate.repoRoot
    });
    if (!compile.ok) {
      await candidate.discard();
      return { preview: { ready: false, diagnostics: compile.diagnostics.map(toMutationDiagnostic) } };
    }
    const pluginValidation = await validateAndBundleProjectPlugins({ gameId: context.gameId, repoRoot: context.repoRoot });
    if (!pluginValidation.ok) {
      await candidate.discard();
      return { preview: { ready: false, diagnostics: pluginValidation.diagnostics.map(toMutationDiagnostic) } };
    }
    await copyCandidatePluginBundles({
      sourceRoot: context.repoRoot,
      candidateRoot: candidate.repoRoot,
      relativeFilePaths: pluginValidation.playerWebBundles.map((bundle) => bundle.filePath)
    });
    const sourceMaps = await loadPreviewSelectionSourceMaps(context.gameId, context.repoRoot, candidate.repoRoot);
    const readiness = await prepareRuntimeSession(context.gameId, input.requestOrigin, {
      contentSourceId: candidate.contentSourceId,
      contentRoot: candidate.repoRoot,
      pluginBundles: pluginValidation.playerWebBundles
    });
    if (!readiness.ready) {
      await candidate.discard();
      return { preview: { ready: false, diagnostics: readiness.diagnostics.map(toMutationDiagnostic) } };
    }
    await candidate.retirePrevious().catch(() => undefined);
    return {
      candidateRoot: candidate.repoRoot,
      confirmationDigest: createHash("sha256")
        .update(`${editorMutationDigestDomain}.candidate\0${input.prepared.effectDigest}\0${candidate.contentSourceId}`, "utf8")
        .digest("hex"),
      preview: {
        ready: true,
        ...(readiness.playerUrl === undefined ? {} : { playerUrl: readiness.playerUrl }),
        sourceMaps,
        diagnostics: readiness.diagnostics.map(toMutationDiagnostic)
      }
    };
  } catch (error) {
    await candidate.discard().catch(() => undefined);
    throw error;
  }
}

function isNoOp(prepared: PreparedEffect): boolean {
  return prepared.documents.length > 0 && prepared.documents.every((document) => document.previousVersionHash === document.versionHash);
}

function toMutationDiagnostic(diagnostic: DocumentDiagnostic | EditorCompilerDiagnostic | string) {
  if (typeof diagnostic === "string") return { severity: "error" as const, source: "plugin", pointer: "", message: diagnostic };
  const filePath = "filePath" in diagnostic ? diagnostic.filePath : undefined;
  return {
    severity: diagnostic.severity,
    source: diagnostic.source,
    pointer: diagnostic.pointer,
    message: diagnostic.message,
    ...(filePath === undefined ? {} : { filePath })
  };
}

function toMutationDiffSummaryItem(item: { readonly filePath: string; readonly pointer: string; readonly operation: string; readonly description: string }) {
  return { filePath: item.filePath, pointer: item.pointer, operation: item.operation, description: item.description };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
