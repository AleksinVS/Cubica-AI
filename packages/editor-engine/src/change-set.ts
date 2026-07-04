/**
 * ChangeSet dry-run gate and patch journal steps.
 *
 * Before any AI-generated or manual ChangeSet is applied to the open authoring
 * document, `dryRunEditorChangeSet` is the safety gate: it checks the ChangeSet
 * touches only the active file, applies the JSON Patch with inverse generation,
 * reparses, and runs schema/semantic validation — all without mutating visible
 * editor state. `createPatchJournalStep` records an undo-capable journal entry
 * after a successful apply.
 */
import { hashEditorText, makeDiagnostic } from "./shared.ts";
import { applyJsonPatchWithInverse } from "./json-pointer-patch.ts";
import { createDocumentStore } from "./document-store.ts";
import { validateDocument } from "./schema.ts";
import type {
  DocumentDiagnostic,
  DryRunEditorChangeSetInput,
  DryRunEditorChangeSetResult,
  EditorChangeSet,
  EditorDiffSummaryItem,
  EditorPatchIntent,
  PatchJournalStep
} from "./types.ts";

/**
 * Dry-runs a bounded ChangeSet against one open authoring document.
 *
 * This is the Phase 8 safety gate used before automatic apply: it checks that
 * the ChangeSet touches only the active document, applies JSON Patch with
 * inverse generation, reparses the document, and runs schema/semantic
 * validation before the UI mutates visible editor state.
 */
export function dryRunEditorChangeSet(input: DryRunEditorChangeSetInput): DryRunEditorChangeSetResult {
  const snapshot = input.snapshot;
  const diagnostics: DocumentDiagnostic[] = [];
  const unsupportedOperationCount =
    (input.changeSet.textPatches?.length ?? 0) +
    (input.changeSet.fileCreates?.length ?? 0) +
    (input.changeSet.fileDeletes?.length ?? 0) +
    (input.changeSet.fileRenames?.length ?? 0);

  if (unsupportedOperationCount > 0) {
    diagnostics.push(
      makeDiagnostic({
        source: "change-set",
        pointer: "",
        message: "This editor surface can dry-run only JSON patches; plugin/file operations are deferred to the project workspace gate."
      })
    );
  }

  const patchesForCurrentFile = input.changeSet.jsonPatches.filter((patch) => patch.filePath === snapshot.filePath);
  const patchesForOtherFiles = input.changeSet.jsonPatches.filter((patch) => patch.filePath !== snapshot.filePath);
  if (patchesForOtherFiles.length > 0) {
    diagnostics.push(
      makeDiagnostic({
        source: "change-set",
        pointer: "",
        message: `ChangeSet touches ${patchesForOtherFiles.length} file(s) outside the active document.`
      })
    );
  }

  if (patchesForCurrentFile.length === 0) {
    diagnostics.push(
      makeDiagnostic({
        source: "change-set",
        pointer: "",
        message: "ChangeSet does not contain JSON Patch operations for the active document."
      })
    );
  }

  if (snapshot.json === undefined) {
    diagnostics.push(
      makeDiagnostic({
        source: "change-set",
        pointer: "",
        message: "Cannot apply a ChangeSet while the active document has invalid JSON."
      })
    );
  }

  if (diagnostics.length > 0 || snapshot.json === undefined) {
    return {
      ok: false,
      before: snapshot,
      after: undefined,
      inverseChangeSet: undefined,
      diffSummary: [],
      diagnostics
    };
  }

  try {
    const operations = patchesForCurrentFile.flatMap((patch) => [...patch.operations]);
    const applied = applyJsonPatchWithInverse(snapshot.json, operations);
    const nextText = `${JSON.stringify(applied.value, null, 2)}\n`;
    const after = createDocumentStore({ filePath: snapshot.filePath, text: nextText }).snapshot();
    const validationDiagnostics = validateDocument(after, {
      schemaRegistry: input.schemaRegistry,
      schemaId: input.schemaId,
      includeSemanticDiagnostics: input.includeSemanticDiagnostics
    });
    const allDiagnostics = [...validationDiagnostics];
    const ok = !allDiagnostics.some((diagnostic) => diagnostic.severity === "error");
    const inverseChangeSet: EditorChangeSet = {
      id: `${input.changeSet.id}:inverse`,
      intentId: input.changeSet.intentId,
      summary: `Undo: ${input.changeSet.summary}`,
      jsonPatches: [
        {
          filePath: snapshot.filePath,
          operations: applied.inverseOperations
        }
      ]
    };

    return {
      ok,
      before: snapshot,
      after,
      inverseChangeSet,
      diffSummary: applied.diffSummary.map((item) => ({ ...item, filePath: snapshot.filePath })),
      diagnostics: allDiagnostics
    };
  } catch (error) {
    return {
      ok: false,
      before: snapshot,
      after: undefined,
      inverseChangeSet: undefined,
      diffSummary: [],
      diagnostics: [
        makeDiagnostic({
          source: "change-set",
          pointer: "",
          message: error instanceof Error ? error.message : "ChangeSet dry-run failed."
        })
      ]
    };
  }
}

/** Creates a journal entry after a successful automatic ChangeSet apply. */
export function createPatchJournalStep(input: {
  readonly id: string;
  readonly createdAt: string;
  readonly intent: EditorPatchIntent;
  readonly forward: EditorChangeSet;
  readonly inverse: EditorChangeSet;
  readonly beforeText: string;
  readonly afterText: string;
  readonly diffSummary: readonly EditorDiffSummaryItem[];
  readonly diagnostics?: readonly DocumentDiagnostic[];
}): PatchJournalStep {
  return {
    id: input.id,
    createdAt: input.createdAt,
    intent: input.intent,
    summary: input.forward.summary,
    affectedFiles: [...new Set(input.forward.jsonPatches.map((patch) => patch.filePath))],
    forward: input.forward,
    inverse: input.inverse,
    beforeHash: hashEditorText(input.beforeText),
    afterHash: hashEditorText(input.afterText),
    diffSummary: input.diffSummary,
    diagnostics: input.diagnostics ?? []
  };
}
