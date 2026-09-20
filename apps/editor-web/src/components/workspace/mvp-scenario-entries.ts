import { encodeJsonPointerSegment, isPlainJsonObject, readJsonPointer, type EditorEntity, type EditorEntityProjectionDocument, type JsonValue } from "@cubica/editor-engine";

export interface MvpScenarioEntry {
  readonly id: string;
  readonly label: string;
  readonly source: { readonly filePath: string; readonly pointer: string };
  readonly entityId?: string;
}

/** A flow lists transitions; authored content also contains windows reached within those transitions. */
export function buildMvpScenarioEntries(entities: readonly EditorEntity[], documents: readonly EditorEntityProjectionDocument[]): MvpScenarioEntry[] {
  const entries: MvpScenarioEntry[] = entities.filter(entity => entity.kind === "game-step" || entity.kind === "ui-screen").map(entity => ({
    id: entity.entityId, entityId: entity.entityId,
    label: `${entity.kind === "game-step" ? "Этап" : "Страница"} · ${entity.label}`,
    source: { filePath: entity.primarySource.filePath, pointer: entity.primarySource.pointer }
  }));
  for (const document of documents) {
    if (document.documentKind !== "game" || document.json === undefined) continue;
    const visit = (value: JsonValue | undefined, pointer: string) => {
      if (Array.isArray(value)) { value.forEach((item, index) => visit(item, `${pointer}/${index}`)); return; }
      if (!isPlainJsonObject(value)) return;
      if (typeof value._type === "string" && typeof value._label === "string" && value._label.trim() !== "") {
        entries.push({ id: `content:${document.filePath}#${pointer}`, label: `Содержимое · ${value._label}`, source: { filePath: document.filePath, pointer } });
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        if (!key.startsWith("_")) visit(child, `${pointer}/${encodeJsonPointerSegment(key)}`);
      }
    };
    visit(readJsonPointer(document.json, "/root/content"), "/root/content");
  }
  return entries;
}
