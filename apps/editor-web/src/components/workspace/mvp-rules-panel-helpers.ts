import {
  buildJsonPointer,
  isPlainJsonObject,
  parseJsonPointer,
  readJsonPointer,
  type EditorChangeSet,
  type EditorEntity,
  type EditorEntityProjectionDocument,
  type JsonObject,
  type JsonValue
} from "@cubica/editor-engine";

export interface MvpRuleSource {
  readonly filePath: string;
  readonly pointer: string;
  readonly value: JsonObject;
}

export type CanonicalElementPrompt = JsonObject & {
  readonly status: "confirmed";
  readonly raw: string;
  readonly normalized: string;
  readonly source: "user";
  readonly language: "ru";
  /** The authoring schema calls this field `updatedAt`; its value is ISO-8601. */
  readonly updatedAt: string;
};

function stableJson(value: JsonValue | undefined): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isPlainJsonObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Source revision used to keep a local draft from silently crossing a reload. */
export function rulesSourceRevision(documents: readonly EditorEntityProjectionDocument[], filePath?: string): string {
  return documents
    .filter((document) => filePath === undefined || document.filePath === filePath)
    .map((document) => `${document.filePath}\u001f${document.sourceHash ?? stableJson(document.json)}`)
    .sort()
    .join("\u001e");
}

export function ruleEntities(entities: readonly EditorEntity[]): readonly EditorEntity[] {
  return entities.filter((entity) => {
    if (entity.kind === "game-root" || entity.kind === "game-action") return entity.primarySource.documentKind === "game";
    const pointer = entity.primarySource.pointer;
    return entity.primarySource.documentKind === "game" && (pointer === "/root/logic/rules" || pointer.startsWith("/root/logic/rules/"));
  });
}

/** Rules are authoring-only today, so the MVP panel projects their exact pointers locally. */
export function projectMvpRuleEntities(documents: readonly EditorEntityProjectionDocument[]): readonly EditorEntity[] {
  return documents.flatMap((document) => {
    if (document.documentKind !== "game" || document.json === undefined) return [];
    const rules = readJsonPointer(document.json, "/root/logic/rules");
    if (!Array.isArray(rules)) return [];
    return rules.flatMap((value, index): EditorEntity[] => {
      if (!isPlainJsonObject(value)) return [];
      const pointer = `/root/logic/rules/${index}`;
      const source = { filePath: document.filePath, pointer, documentKind: "game" as const };
      return [{
        entityId: `mvp-rule:${document.filePath}#${pointer}`,
        kind: "content-block",
        label: typeof value._label === "string" ? value._label : `Правило ${index + 1}`,
        primarySource: source,
        facets: { logic: [source] },
        diagnostics: []
      }];
    });
  });
}

export function readRuleText(entity: EditorEntity, documents: readonly EditorEntityProjectionDocument[]): string {
  const document = documents.find((candidate) => candidate.filePath === entity.primarySource.filePath);
  const node = document?.json === undefined ? undefined : readJsonPointer(document.json, entity.primarySource.pointer);
  if (!isPlainJsonObject(node)) return "";
  const prompt = isPlainJsonObject(node._prompt) && typeof node._prompt.raw === "string" ? node._prompt.raw.trim() : "";
  if (prompt !== "") return prompt;
  return typeof node._semantics === "string" ? node._semantics.trim() : "";
}

export function readRuleSource(entity: EditorEntity, documents: readonly EditorEntityProjectionDocument[]): MvpRuleSource | undefined {
  const document = documents.find((candidate) => candidate.filePath === entity.primarySource.filePath);
  if (document?.json === undefined) return undefined;
  const value = readJsonPointer(document.json, entity.primarySource.pointer);
  return isPlainJsonObject(value)
    ? { filePath: entity.primarySource.filePath, pointer: entity.primarySource.pointer, value }
    : undefined;
}

export function readPreparedRuleText(
  entity: EditorEntity,
  preparedDocuments: readonly { readonly filePath: string; readonly text: string }[]
): string | undefined {
  const document = preparedDocuments.find((candidate) => candidate.filePath === entity.primarySource.filePath);
  if (document === undefined) return undefined;
  try {
    const json = JSON.parse(document.text) as JsonValue;
    const node = readJsonPointer(json, entity.primarySource.pointer);
    if (!isPlainJsonObject(node)) return undefined;
    return isPlainJsonObject(node._prompt) && typeof node._prompt.raw === "string" ? node._prompt.raw.trim() : "";
  } catch {
    return undefined;
  }
}

function changeSet(source: MvpRuleSource, nextPrompt: JsonValue | undefined, summary: string): EditorChangeSet {
  const hasPrompt = Object.hasOwn(source.value, "_prompt");
  const promptPath = buildJsonPointer([...parseJsonPointer(source.pointer), "_prompt"]);
  const operations: EditorChangeSet["jsonPatches"][number]["operations"] = [
    { op: "test", path: source.pointer, value: source.value },
    ...(nextPrompt === undefined
      ? hasPrompt ? [{ op: "remove" as const, path: promptPath }] : []
      : [{ op: hasPrompt ? "replace" as const : "add" as const, path: promptPath, value: nextPrompt }])
  ];
  return {
    id: `mvp-rule-${typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Date.now().toString(36)}`,
    summary,
    jsonPatches: [{ filePath: source.filePath, operations }]
  };
}

/** Builds the sole authoring patch; it never mutates the projection or source document. */
export function buildMvpRuleChangeSet(
  source: MvpRuleSource,
  text: string,
  now: string = new Date().toISOString()
): EditorChangeSet | undefined {
  const trimmed = text.trim();
  const existingPrompt = isPlainJsonObject(source.value._prompt) && typeof source.value._prompt.raw === "string"
    ? source.value._prompt.raw.trim()
    : undefined;
  const semantics = typeof source.value._semantics === "string" ? source.value._semantics.trim() : "";
  if (trimmed === "") {
    if (!Object.hasOwn(source.value, "_prompt")) return undefined;
    return changeSet(source, undefined, "Удалено авторское правило");
  }
  if (trimmed === (existingPrompt ?? semantics)) return undefined;
  const prompt: CanonicalElementPrompt = {
    status: "confirmed",
    raw: trimmed,
    normalized: trimmed,
    source: "user",
    language: "ru",
    updatedAt: now
  };
  return changeSet(source, prompt, "Сохранено авторское правило");
}
