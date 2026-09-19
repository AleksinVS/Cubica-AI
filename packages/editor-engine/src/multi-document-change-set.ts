/**
 * Pure multi-document EditorChangeSet dry-run gate.
 *
 * Each touched authoring document is validated through the single-document
 * engine gate and the results are folded into one atomic verdict. This module
 * has no filesystem or UI dependencies, so both editor-web server routes and
 * browser clients can use the same calculation.
 */
import { createDocumentStore } from "./document-store.ts";
import { dryRunEditorChangeSet } from "./change-set.ts";
import type {
  ChangedPointersByFile,
  DocumentDiagnostic,
  EditorChangeSet,
  EditorChangeSetJsonPatch,
  EditorDiffSummaryItem,
  SchemaRegistry
} from "./types.ts";

export interface MultiDocumentDryRunResult {
  readonly ok: boolean;
  readonly afterTextByPath: ReadonlyMap<string, string>;
  readonly beforeTextByPath: ReadonlyMap<string, string>;
  readonly inverseChangeSet: EditorChangeSet;
  readonly changedPointersByFile: ChangedPointersByFile;
  readonly diffSummary: readonly EditorDiffSummaryItem[];
  readonly diagnostics: readonly DocumentDiagnostic[];
  readonly affectedFilePaths: readonly string[];
}

export interface DryRunMultiDocumentChangeSetInput {
  readonly changeSet: EditorChangeSet;
  readonly documentTextByPath: ReadonlyMap<string, string>;
  readonly schemaRegistry: SchemaRegistry;
  readonly resolveSchemaId: (filePath: string) => string | undefined;
  readonly includeSemanticDiagnostics?: boolean;
}

function blockingDiagnostic(message: string): DocumentDiagnostic {
  return { severity: "error", source: "change-set", pointer: "", message };
}

function groupPatchesByFile(patches: readonly EditorChangeSetJsonPatch[]): Map<string, EditorChangeSetJsonPatch[]> {
  const byFile = new Map<string, EditorChangeSetJsonPatch[]>();
  for (const patch of patches) {
    const list = byFile.get(patch.filePath) ?? [];
    list.push(patch);
    byFile.set(patch.filePath, list);
  }
  return byFile;
}

export function dryRunMultiDocumentChangeSet(input: DryRunMultiDocumentChangeSetInput): MultiDocumentDryRunResult {
  const diagnostics: DocumentDiagnostic[] = [];
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
    const snapshot = createDocumentStore({ filePath, text }).snapshot();
    const fileChangeSet: EditorChangeSet = { ...input.changeSet, jsonPatches: patches };
    const fileDryRun = dryRunEditorChangeSet({
      snapshot,
      changeSet: fileChangeSet,
      schemaRegistry: input.schemaRegistry,
      schemaId: input.resolveSchemaId(filePath),
      includeSemanticDiagnostics: input.includeSemanticDiagnostics ?? true
    });
    diagnostics.push(...fileDryRun.diagnostics);
    if (!fileDryRun.ok || fileDryRun.after === undefined || fileDryRun.inverseChangeSet === undefined) {
      continue;
    }
    afterTextByPath.set(filePath, fileDryRun.after.text);
    inversePatches.push(...fileDryRun.inverseChangeSet.jsonPatches);
    changedPointersByFile[filePath] = patches.flatMap((patch) => patch.operations.map((operation) => operation.path));
    diffSummary.push(...fileDryRun.diffSummary);
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
