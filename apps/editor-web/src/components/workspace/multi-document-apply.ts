/**
 * Multi-document EditorChangeSet dry-run (ADR-057 §4.10, §5; Phase 6.2a, part A).
 *
 * The `EditorChangeSet` contract is already MULTI-FILE (its `jsonPatches` may
 * carry a `filePath` per patch), but the editor previously applied only the
 * ACTIVE document and deferred the rest with a diagnostic. Entity creation
 * (ADR-057 §4.10) is an ATOMIC cross-manifest operation — a game facet in the
 * game manifest plus a UI facet in the channel manifest — so it produces one
 * ChangeSet touching TWO files at once.
 *
 * This module is the ATOMICITY PRE-CHECK for such a ChangeSet: it dry-runs EVERY
 * touched document (not just the active one) in memory and validates each against
 * its own JSON Schema BEFORE anything is written anywhere. If ANY document fails
 * (missing text, invalid patch, schema/semantic error), the whole result is
 * `ok: false` and the caller must apply NOTHING — no silent half-applied facet
 * split (ADR-057 §5 "молчаливая потеря запрещена").
 *
 * It is FRAMEWORK-AGNOSTIC and PURE (no React, no I/O): each file is dry-run with
 * the SAME engine gate the single-document path uses (`dryRunEditorChangeSet`),
 * fed a ChangeSet SLICE that contains only that one file's patches — so the
 * engine's own "touches N files outside the active document" refusal never fires
 * and the core 6.1 gate stays untouched. That makes it directly unit-testable.
 */
import {
  createDocumentStore,
  dryRunEditorChangeSet,
  type ChangedPointersByFile,
  type DocumentDiagnostic,
  type EditorChangeSet,
  type EditorChangeSetJsonPatch,
  type EditorDiffSummaryItem,
  type SchemaRegistry
} from "@cubica/editor-engine";

/** Result of a multi-document dry-run: the per-file "after" texts plus the combined inverse. */
export interface MultiDocumentDryRunResult {
  /** `true` only when EVERY touched document dry-ran and validated cleanly. */
  readonly ok: boolean;
  /** New text for each touched file, keyed by file path (only when `ok`). */
  readonly afterTextByPath: ReadonlyMap<string, string>;
  /** Text each touched file started from, keyed by path (for undo bookkeeping). */
  readonly beforeTextByPath: ReadonlyMap<string, string>;
  /** One ChangeSet that reverses the forward change across ALL touched files. */
  readonly inverseChangeSet: EditorChangeSet;
  /** Forward JSON-Patch pointers per file, for the incremental projection updater (Phase 2.1b). */
  readonly changedPointersByFile: ChangedPointersByFile;
  /** Human-readable diff lines aggregated across every touched file. */
  readonly diffSummary: readonly EditorDiffSummaryItem[];
  /** All diagnostics gathered; a blocking (`error`) one makes `ok` false. */
  readonly diagnostics: readonly DocumentDiagnostic[];
  /** Every file path the ChangeSet touched (deduplicated). */
  readonly affectedFilePaths: readonly string[];
}

export interface DryRunMultiDocumentChangeSetInput {
  readonly changeSet: EditorChangeSet;
  /**
   * Current live text of EVERY document the ChangeSet touches (active + siblings).
   * A touched file absent from this map is treated as a hard error (the caller
   * must supply the live text so the dry-run reflects the real disk/editor state).
   */
  readonly documentTextByPath: ReadonlyMap<string, string>;
  readonly schemaRegistry: SchemaRegistry;
  /** Resolves the JSON Schema id used to validate a given file path. */
  readonly resolveSchemaId: (filePath: string) => string | undefined;
  /** Whether to include the engine's semantic diagnostics (identity discipline). */
  readonly includeSemanticDiagnostics?: boolean;
}

/** A one-off diagnostic that blocks the whole multi-document apply. */
function blockingDiagnostic(message: string): DocumentDiagnostic {
  return { severity: "error", source: "change-set", pointer: "", message };
}

/** Groups a ChangeSet's JSON patches by their target file path, preserving order. */
function groupPatchesByFile(patches: readonly EditorChangeSetJsonPatch[]): Map<string, EditorChangeSetJsonPatch[]> {
  const byFile = new Map<string, EditorChangeSetJsonPatch[]>();
  for (const patch of patches) {
    const list = byFile.get(patch.filePath) ?? [];
    list.push(patch);
    byFile.set(patch.filePath, list);
  }
  return byFile;
}

/**
 * Dry-runs a (possibly multi-file) ChangeSet across every document it touches.
 *
 * Each file is validated INDEPENDENTLY through the existing single-document
 * engine gate, then the results are folded into one atomic verdict: the moment
 * any file reports a blocking diagnostic (or a touched file's text is missing, or
 * an unsupported non-JSON-patch operation appears) the whole result is `ok:false`
 * and carries no `after` texts, so the caller writes nothing.
 */
export function dryRunMultiDocumentChangeSet(input: DryRunMultiDocumentChangeSetInput): MultiDocumentDryRunResult {
  const diagnostics: DocumentDiagnostic[] = [];

  // File-scoped operations (plugin create/delete/rename, whole-file text patches)
  // have no per-pointer JSON form; this surface only applies JSON patches.
  const unsupportedOperationCount =
    (input.changeSet.textPatches?.length ?? 0) +
    (input.changeSet.fileCreates?.length ?? 0) +
    (input.changeSet.fileDeletes?.length ?? 0) +
    (input.changeSet.fileRenames?.length ?? 0);
  if (unsupportedOperationCount > 0) {
    diagnostics.push(blockingDiagnostic("This editor surface can apply only JSON patches; file/plugin operations are not supported here."));
  }

  const patchesByFile = groupPatchesByFile(input.changeSet.jsonPatches);
  const affectedFilePaths = [...patchesByFile.keys()];
  if (affectedFilePaths.length === 0) {
    diagnostics.push(blockingDiagnostic("ChangeSet contains no JSON Patch operations."));
  }

  const afterTextByPath = new Map<string, string>();
  const beforeTextByPath = new Map<string, string>();
  const inversePatches: EditorChangeSetJsonPatch[] = [];
  const changedPointersByFile: Record<string, readonly string[]> = {};
  const diffSummary: EditorDiffSummaryItem[] = [];

  for (const [filePath, patches] of patchesByFile) {
    const text = input.documentTextByPath.get(filePath);
    if (text === undefined) {
      diagnostics.push(blockingDiagnostic(`ChangeSet touches ${filePath}, whose current text was not provided to the apply gate.`));
      continue;
    }
    beforeTextByPath.set(filePath, text);

    // Build a per-file snapshot and a ChangeSet SLICE that names ONLY this file,
    // so the engine's single-document gate treats it as "the active document" and
    // never emits its cross-file refusal. Validation uses this file's schema.
    const snapshot = createDocumentStore({ filePath, text }).snapshot();
    const fileChangeSet: EditorChangeSet = { ...input.changeSet, jsonPatches: patches };
    const fileDryRun = dryRunEditorChangeSet({
      snapshot,
      changeSet: fileChangeSet,
      schemaRegistry: input.schemaRegistry,
      schemaId: input.resolveSchemaId(filePath),
      includeSemanticDiagnostics: input.includeSemanticDiagnostics ?? true
    });

    for (const diagnostic of fileDryRun.diagnostics) {
      diagnostics.push(diagnostic);
    }
    if (!fileDryRun.ok || fileDryRun.after === undefined || fileDryRun.inverseChangeSet === undefined) {
      continue;
    }

    afterTextByPath.set(filePath, fileDryRun.after.text);
    for (const inverse of fileDryRun.inverseChangeSet.jsonPatches) {
      inversePatches.push(inverse);
    }
    changedPointersByFile[filePath] = patches.flatMap((patch) => patch.operations.map((operation) => operation.path));
    for (const item of fileDryRun.diffSummary) {
      diffSummary.push(item);
    }
  }

  const ok = !diagnostics.some((diagnostic) => diagnostic.severity === "error") && afterTextByPath.size === affectedFilePaths.length;

  return {
    ok,
    afterTextByPath: ok ? afterTextByPath : new Map(),
    beforeTextByPath,
    inverseChangeSet: {
      id: `${input.changeSet.id}:inverse`,
      intentId: input.changeSet.intentId,
      summary: `Undo: ${input.changeSet.summary}`,
      jsonPatches: inversePatches
    },
    changedPointersByFile,
    diffSummary,
    diagnostics,
    affectedFilePaths
  };
}
