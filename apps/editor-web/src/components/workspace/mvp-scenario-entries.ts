import { encodeJsonPointerSegment, isPlainJsonObject, readJsonPointer, type EditorEntity, type EditorEntityProjectionDocument, type JsonValue } from "@cubica/editor-engine";
import type { EditorPreviewSceneRequest } from "@cubica/contracts-session";
type EditorPreviewSceneSelector = NonNullable<EditorPreviewSceneRequest["selector"]>;

export interface MvpScenarioEntry {
  readonly id: string;
  readonly label: string;
  readonly source: { readonly filePath: string; readonly pointer: string };
  readonly entityId?: string;
  readonly selector?: EditorPreviewSceneSelector;
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
  return entries.map(entry => ({ ...entry, selector: scenarioSelector(entry, documents, entries) }));
}

function scenarioSelector(entry: MvpScenarioEntry, documents: readonly EditorEntityProjectionDocument[], entries: readonly MvpScenarioEntry[]): EditorPreviewSceneSelector | undefined {
  const document = documents.find(item => item.filePath === entry.source.filePath);
  const read = (pointer: string) => {
    const value = document?.json === undefined ? undefined : readJsonPointer(document.json, pointer);
    const definitions = document?.json === undefined ? undefined : readJsonPointer(document.json, "/_definitions");
    if (!isPlainJsonObject(value)) return undefined;
    // Scene selectors are flat inherited fields. Platform base types contain
    // no game-specific scene coordinates; only local declarations supply them.
    let effective = { ...value };
    let type = value._type;
    const visited = new Set<string>();
    while (typeof type === "string" && isPlainJsonObject(definitions) && isPlainJsonObject(definitions[type])) {
      if (visited.has(type) || visited.size >= 5) return undefined;
      visited.add(type);
      const parent = definitions[type];
      if (!isPlainJsonObject(parent)) return undefined;
      effective = { ...parent, ...effective };
      type = parent._extends;
    }
    return effective;
  };
  const value = read(entry.source.pointer);
  if (value === undefined) return undefined;
  if (document?.documentKind === "ui") return typeof value.id === "string" ? { screenKey: value.id } : undefined;
  const direct = (node: typeof value): EditorPreviewSceneSelector | undefined => {
    if (typeof node.screenId !== "string") return undefined;
    return {
      screenId: node.screenId,
      ...(Number.isInteger(node.stepIndex) && Number(node.stepIndex) >= 0 ? { stepIndex: Number(node.stepIndex) } : {}),
      ...(typeof node.advanceActionId === "string" && typeof node.id === "string" ? { activeInfoId: node.id } : {})
    };
  };
  const content = entries.filter(item => item.source.filePath === entry.source.filePath && item.source.pointer.startsWith("/root/content/"))
    .map(item => ({ entry: item, value: read(item.source.pointer) }));
  // Follow declared action links; a step label or id spelling is not a scene binding.
  const actionIds = value.actionIds;
  if (Array.isArray(actionIds)) {
    const linked = content.filter(item => typeof item.value?.advanceActionId === "string" && actionIds.includes(item.value.advanceActionId));
    if (linked.length === 1 && linked[0].value !== undefined) return direct(linked[0].value);
    if (linked.length > 1) return undefined;
  }
  const own = direct(value);
  if (own !== undefined) return own;
  const cardId = value.cardId ?? value.id;
  if (typeof cardId !== "string" && typeof cardId !== "number") return undefined;
  const owners = content.filter(item => Array.isArray(item.value?.cardIds) && item.value.cardIds.includes(cardId));
  if (owners.length !== 1 || owners[0].value === undefined) return undefined;
  const scene = direct(owners[0].value);
  return scene === undefined ? undefined : { ...scene, focusRuntimePointer: entry.source.pointer.replace(/^\/root(?=\/content\/)/u, "") };
}
