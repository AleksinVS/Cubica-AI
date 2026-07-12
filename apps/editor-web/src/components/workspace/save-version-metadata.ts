/** Framework-free normalization of local editor diffs into Save metadata. */
import type { EditorDiffSummaryItem } from "@cubica/editor-engine";
import {
  EDITOR_VERSION_CHANGE_FACTS_MAX,
  EDITOR_VERSION_CHANGE_SUMMARY_MAX_LENGTH,
  type EditorVersionChangeFact
} from "@/lib/editor-version-contracts";

/**
 * Builds bounded, deterministic metadata from the local AI/change journal.
 * Manual text edits may not have pointer-level facts; the server supplements
 * this partial list from the authoritative file diff.
 */
export function buildSaveVersionMetadata(
  activeFilePath: string,
  diffSummary: readonly EditorDiffSummaryItem[]
): { readonly proposedSummary: string; readonly changeFacts: readonly EditorVersionChangeFact[] } {
  const facts = diffSummary.slice(0, EDITOR_VERSION_CHANGE_FACTS_MAX).map((item): EditorVersionChangeFact => {
    const kind = item.operation === "add" ? "created" : item.operation === "remove" ? "deleted" : "updated";
    const target = item.pointer === "" ? "документ" : item.pointer;
    const action = kind === "created" ? "Добавлено" : kind === "deleted" ? "Удалено" : "Изменено";
    return {
      kind,
      filePath: item.filePath || activeFilePath,
      summary: `${action}: ${target}`.slice(0, EDITOR_VERSION_CHANGE_SUMMARY_MAX_LENGTH),
      source: "assistant"
    };
  });
  const changedFiles = new Set(facts.map((fact) => fact.filePath));
  const fileName = activeFilePath.split("/").at(-1) ?? activeFilePath;
  const proposedSummary = facts.length === 0
    ? `Обновлён ${fileName}`
    : `Изменений: ${facts.length} · файлов: ${Math.max(changedFiles.size, 1)}`;
  return { proposedSummary, changeFacts: facts };
}
