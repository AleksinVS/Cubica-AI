import {
  encodeJsonPointerSegment,
  isPlainJsonObject,
  readJsonPointer,
  type EditorChangeSet,
  type EditorEntity,
  type EditorEntityProjectionDocument,
  type JsonObject,
  type JsonValue
} from "@cubica/editor-engine";
import type { MvpElementSource } from "./mvp-element-operations";

export type MvpCreateKind = "rule" | "page" | "element" | `prototype:${string}`;
export interface MvpAuthoringSource { readonly filePath: string; readonly pointer: string }

export function mvpSourceEntity(source: MvpElementSource, documentKind: "game" | "ui"): EditorEntity {
  const facet = { filePath: source.filePath, pointer: source.pointer, documentKind } as const;
  return {
    entityId: `mvp-source:${source.filePath}#${source.pointer}`,
    kind: documentKind === "ui" ? "ui-component" : "content-block",
    label: typeof source.value._label === "string" ? source.value._label : source.pointer.split("/").at(-1) ?? "Элемент",
    primarySource: facet,
    facets: { [documentKind === "ui" ? "view" : "content"]: [facet] },
    diagnostics: []
  };
}
export type MvpAuthoringAction =
  | { readonly ok: true; readonly changeSet: EditorChangeSet; readonly source: MvpAuthoringSource; readonly entityId?: string }
  | { readonly ok: false; readonly reason: string };

function documentsForKind(documents: readonly EditorEntityProjectionDocument[], kind: "game" | "ui") {
  return documents.filter((document) => document.documentKind === kind && isPlainJsonObject(document.json));
}

function uniqueId(base: string, used: Set<string>): string {
  let candidate = base;
  for (let suffix = 2; used.has(candidate); suffix += 1) candidate = `${base}-${suffix}`;
  used.add(candidate);
  return candidate;
}

function collectIds(value: JsonValue | undefined, used: Set<string>): void {
  if (Array.isArray(value)) { for (const child of value) collectIds(child, used); return; }
  if (!isPlainJsonObject(value)) return;
  if (typeof value.id === "string") used.add(value.id);
  for (const child of Object.values(value)) collectIds(child, used);
}

function action(filePath: string, pointer: string, value: JsonValue, summary: string, entityId?: string, sourcePointer = pointer): MvpAuthoringAction {
  return {
    ok: true,
    source: { filePath, pointer: sourcePointer },
    ...(entityId === undefined ? {} : { entityId }),
    changeSet: { id: `mvp-create-${crypto.randomUUID()}`, summary, jsonPatches: [{ filePath, operations: [{ op: "add", path: pointer, value }] }] }
  };
}

function screenForSource(document: EditorEntityProjectionDocument, pointer: string | undefined): { index: number; value: JsonObject } | undefined {
  if (!isPlainJsonObject(document.json)) return undefined;
  const root = readJsonPointer(document.json, "/root");
  if (!isPlainJsonObject(root) || !Array.isArray(root.screens)) return undefined;
  const screens = root.screens;
  const selected = pointer === undefined ? undefined : /^\/root\/screens\/(\d+)(?:\/|$)/u.exec(pointer);
  if (selected !== undefined && selected !== null) {
    const index = Number(selected[1]);
    return isPlainJsonObject(screens[index]) ? { index, value: screens[index] } : undefined;
  }
  if (screens.length === 1 && isPlainJsonObject(screens[0])) return { index: 0, value: screens[0] };
  const entry = typeof root.entry_point === "string" ? root.entry_point : undefined;
  const entryIndex = screens.findIndex((screen) => isPlainJsonObject(screen) && screen.id === entry);
  return entryIndex >= 0 && isPlainJsonObject(screens[entryIndex]) ? { index: entryIndex, value: screens[entryIndex] } : undefined;
}

function insertionContainer(screen: JsonObject, screenPointer: string): { pointer: string; value: JsonObject } | undefined {
  const root = screen.root;
  if (!isPlainJsonObject(root)) return undefined;
  if (screen.layout_mode !== "map-first") return { pointer: `${screenPointer}/root`, value: root };
  if (!Array.isArray(root.children)) return undefined;
  const index = root.children.findIndex((child) => isPlainJsonObject(child) && isPlainJsonObject(child.props) &&
    child.props.workspaceSlot !== "board" && Array.isArray(child.children));
  const value = root.children[index];
  return index >= 0 && isPlainJsonObject(value) ? { pointer: `${screenPointer}/root/children/${index}`, value } : undefined;
}

function addToChildren(filePath: string, pointer: string, container: JsonObject, node: JsonObject, summary: string): MvpAuthoringAction {
  if (container.children !== undefined && !Array.isArray(container.children)) return { ok: false, reason: "У выбранного контейнера неверный список элементов." };
  const children = Array.isArray(container.children) ? container.children : [];
  const target = `${pointer}/children`;
  return {
    ok: true,
    source: { filePath, pointer: `${target}/${children.length}` },
    entityId: typeof node.id === "string" ? node.id : undefined,
    changeSet: {
      id: `mvp-create-${crypto.randomUUID()}`,
      summary,
      jsonPatches: [{ filePath, operations: [
        { op: "test", path: pointer, value: container },
        ...(container.children === undefined
          ? [{ op: "add" as const, path: target, value: [node] }]
          : [{ op: "add" as const, path: `${target}/-`, value: node }])
      ] }]
    }
  };
}

/** Authoring-only additions; the server dry-run/compile remains the final gate. */
export function buildMvpCreateItem(
  kind: MvpCreateKind,
  documents: readonly EditorEntityProjectionDocument[],
  pageSource?: MvpAuthoringSource
): MvpAuthoringAction {
  const game = documentsForKind(documents, "game")[0];
  const ui = pageSource === undefined
    ? documentsForKind(documents, "ui")[0]
    : documentsForKind(documents, "ui").find((document) => document.filePath === pageSource.filePath);
  if (kind === "rule") {
    if (game === undefined || !isPlainJsonObject(game.json)) return { ok: false, reason: "Исходный документ правил недоступен." };
    const rules = readJsonPointer(game.json, "/root/logic/rules");
    if (!Array.isArray(rules)) return { ok: false, reason: "В игре нет списка /root/logic/rules." };
    const ids = new Set<string>(); collectIds(game.json, ids);
    const id = uniqueId("new-rule", ids);
    return action(game.filePath, "/root/logic/rules/-", {
      id, _type: "game.Rule", _label: "Новое правило", _semantics: "Авторское правило игры.",
      _prompt: { status: "draft", raw: "Опишите условие и результат правила.", source: "user", language: "ru", updatedAt: new Date().toISOString() }
    }, "Создать правило", `mvp-rule:${game.filePath}#/root/logic/rules/${rules.length}`, `/root/logic/rules/${rules.length}`);
  }
  if (ui === undefined || !isPlainJsonObject(ui.json)) return { ok: false, reason: "Исходный UI-документ недоступен." };
  const ids = new Set<string>(); collectIds(ui.json, ids);
  if (kind === "page") {
    const screens = readJsonPointer(ui.json, "/root/screens");
    if (!Array.isArray(screens)) return { ok: false, reason: "В UI нет списка экранов." };
    const id = uniqueId("new-page", ids);
    return action(ui.filePath, "/root/screens/-", {
      id, _type: "ui.Screen", _label: "Новая страница", _semantics: "Авторская страница игры.",
      title: "Новая страница", layout_mode: "auto",
      root: { _type: "ui.Component", _label: "Содержимое страницы", _semantics: "Контейнер элементов страницы.", type: "screenComponent", children: [] }
    }, "Создать страницу", id, `/root/screens/${screens.length}`);
  }
  const screen = screenForSource(ui, pageSource?.pointer);
  if (screen === undefined) return { ok: false, reason: "Выберите страницу или откройте начальный экран перед добавлением элемента." };
  const screenPointer = `/root/screens/${screen.index}`;
  const container = insertionContainer(screen.value, screenPointer);
  if (container === undefined) return { ok: false, reason: "На этой странице нет подходящего контейнера для нового элемента." };
  let node: JsonObject;
  if (kind === "element") {
    node = {
      id: uniqueId("new-text", ids), _type: "ui.Component", _label: "Новый текст", _semantics: "Текстовый элемент страницы.",
      type: "richTextComponent", props: { html: "Новый текст" }
    };
  } else {
    const definitionType = kind.slice("prototype:".length);
    const definitions = readJsonPointer(ui.json, "/_definitions");
    const definition = isPlainJsonObject(definitions) && definitionType.startsWith("ui.")
      ? resolveDefinitionBody(definitionType, definitions) : undefined;
    if (definition === undefined || typeof definition.type !== "string") {
      return { ok: false, reason: "Выбранный UI-прототип недоступен для этой страницы." };
    }
    node = instantiateMvpPrototype(definitionType, definition, ids);
  }
  return addToChildren(ui.filePath, container.pointer, container.value, node, `Добавить элемент «${node._label}»`);
}

/** UI definitions with a concrete component type can be inserted without guessing runtime shape. */
export function mvpPrototypeEntries(documents: readonly EditorEntityProjectionDocument[]): readonly { id: string; label: string }[] {
  return documentsForKind(documents, "ui").flatMap((document) => {
    const definitions = isPlainJsonObject(document.json) ? readJsonPointer(document.json, "/_definitions") : undefined;
    return isPlainJsonObject(definitions) ? Object.entries(definitions)
      .flatMap(([id]) => {
        const body = id.startsWith("ui.") ? resolveDefinitionBody(id, definitions) : undefined;
        return body !== undefined && typeof body.type === "string"
          ? [{ id, label: typeof body._label === "string" ? body._label : id }] : [];
      }) : [];
  });
}

/** One server candidate must carry both structured edits and authored metadata. */
export function combineMvpDraftChanges(
  source: MvpElementSource,
  structured: EditorChangeSet,
  metadata: EditorChangeSet
): EditorChangeSet | undefined {
  const metadataWrites = metadata.jsonPatches.flatMap((patch) => patch.operations).filter((operation) => operation.op !== "test");
  const conflicts = structured.jsonPatches.some((patch) => patch.filePath === source.filePath &&
    patch.operations.some((operation) => operation.op !== "test" && metadataWrites.some((write) =>
      operation.path === write.path || operation.path.startsWith(`${write.path}/`) || write.path.startsWith(`${operation.path}/`))));
  if (conflicts || (structured.textPatches?.length ?? 0) > 0 || (structured.fileCreates?.length ?? 0) > 0 ||
      (structured.fileDeletes?.length ?? 0) > 0 || (structured.fileRenames?.length ?? 0) > 0) return undefined;
  return {
    id: `mvp-draft-${crypto.randomUUID()}`,
    summary: "Сохранить намерение и структурированную правку элемента",
    jsonPatches: [
      { filePath: source.filePath, operations: [{ op: "test", path: source.pointer, value: source.value }] },
      ...structured.jsonPatches,
      { filePath: source.filePath, operations: metadataWrites }
    ]
  };
}

export function splitMvpDraftLabelHeader(text: string): { readonly label?: string; readonly returnedText: string; readonly error?: string } {
  const newline = text.indexOf("\n");
  const first = (newline < 0 ? text : text.slice(0, newline)).replace(/\r$/u, "");
  if (!/^_label\s*:/u.test(first)) return { returnedText: text };
  const raw = first.replace(/^_label\s*:\s*/u, "").trim();
  if (raw === "") return { returnedText: text, error: "Название элемента не может быть пустым." };
  let label = raw;
  if (raw.startsWith('"')) {
    try { label = JSON.parse(raw) as string; }
    catch { return { returnedText: text, error: "Название после _label: должно быть корректной строкой JSON." }; }
  }
  if (typeof label !== "string" || label.trim() === "") return { returnedText: text, error: "Название элемента не может быть пустым." };
  return { label: label.trim(), returnedText: newline < 0 ? "" : text.slice(newline + 1) };
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
const prototypeRootReference = "__mvp_prototype_root__";
const localReferenceKey = /^(?:target|source|parent|child|component|element|node)Id$/u;

function rewriteLocalReferences(value: JsonValue, replacements: ReadonlyMap<string, string>, key?: string): JsonValue {
  if (Array.isArray(value)) return value.map((item) => rewriteLocalReferences(item, replacements));
  if (!isPlainJsonObject(value)) return typeof value === "string" && key !== undefined && localReferenceKey.test(key)
    ? replacements.get(value) ?? value : value;
  const copy: Record<string, JsonValue> = {};
  for (const [childKey, child] of Object.entries(value)) {
    copy[childKey] = childKey === "id" && typeof child === "string"
      ? replacements.get(child) ?? child : rewriteLocalReferences(child, replacements, childKey);
  }
  return copy;
}

function mergeBody(parent: JsonObject, child: JsonObject): Record<string, JsonValue> {
  const merged = clone(parent) as Record<string, JsonValue>;
  for (const [key, value] of Object.entries(child)) {
    const previous = merged[key];
    merged[key] = isPlainJsonObject(previous) && isPlainJsonObject(value)
      ? mergeBody(previous, value) : clone(value);
  }
  return merged;
}

function resolveDefinitionBody(type: string, definitions: JsonObject, visited = new Set<string>()): Record<string, JsonValue> | undefined {
  const definition = definitions[type];
  if (!isPlainJsonObject(definition) || visited.has(type) || visited.size >= 5) return undefined;
  visited.add(type);
  const parent = typeof definition._extends === "string" ? resolveDefinitionBody(definition._extends, definitions, visited) : {};
  if (parent === undefined) return undefined;
  const body = clone(definition) as Record<string, JsonValue>;
  delete body._extends;
  return mergeBody(parent, body);
}

function expandedSourceBody(source: JsonObject, definitions: JsonObject): Record<string, JsonValue> | undefined {
  const parent = typeof source._type === "string" && isPlainJsonObject(definitions[source._type])
    ? resolveDefinitionBody(source._type, definitions) : {};
  if (parent === undefined) return undefined;
  const combined = mergeBody(parent, source);
  delete combined._extends;
  return combined;
}

/** The saved body is an exact reusable subtree; only instance identity stays out of the definition. */
export function buildMvpSavePrototype(source: MvpElementSource, documents: readonly EditorEntityProjectionDocument[]): MvpAuthoringAction {
  const document = documentsForKind(documents, "ui").find((item) => item.filePath === source.filePath);
  if (document === undefined || !isPlainJsonObject(document.json) || !source.pointer.startsWith("/root/")) {
    return { ok: false, reason: "Выбранный UI-источник недоступен." };
  }
  const current = readJsonPointer(document.json, source.pointer);
  if (!isPlainJsonObject(current) || JSON.stringify(current) !== JSON.stringify(source.value) || typeof current.type !== "string") {
    return { ok: false, reason: "Элемент изменился. Выберите его снова перед сохранением прототипа." };
  }
  const existingDefinitions = readJsonPointer(document.json, "/_definitions");
  if (existingDefinitions !== undefined && !isPlainJsonObject(existingDefinitions)) {
    return { ok: false, reason: "Раздел локальных прототипов имеет неверный формат." };
  }
  const definitions = isPlainJsonObject(existingDefinitions) ? existingDefinitions : {};
  const usedTypes = new Set(Object.keys(definitions));
  const rawId = typeof current.id === "string" ? current.id : current.type;
  const stem = rawId.replace(/[^a-zA-Z0-9]+/gu, " ").trim().split(/\s+/u).map((part) => part[0]?.toUpperCase() + part.slice(1)).join("") || "Element";
  const definitionType = uniqueId(`ui.Saved${stem}`, usedTypes);
  const definition = expandedSourceBody(current, definitions);
  if (definition === undefined) return { ok: false, reason: "Цепочка определений элемента не может быть сохранена как прототип." };
  if (typeof current.id === "string") {
    Object.assign(definition, rewriteLocalReferences(definition, new Map([[current.id, prototypeRootReference]])));
  }
  delete definition.id;
  delete definition.gameEntityId;
  delete definition._type;
  definition._label = `${typeof current._label === "string" ? current._label : rawId} — прототип`;
  definition._semantics = typeof current._semantics === "string" && current._semantics.trim() !== ""
    ? current._semantics : "Локальный прототип выбранного UI-элемента.";
  const pointer = `/_definitions/${encodeJsonPointerSegment(definitionType)}`;
  return {
    ok: true, source: { filePath: source.filePath, pointer },
    changeSet: { id: `mvp-prototype-${crypto.randomUUID()}`, summary: `Сохранить прототип ${definitionType}`,
      jsonPatches: [{ filePath: source.filePath, operations: [
        { op: "test", path: source.pointer, value: source.value },
        ...(existingDefinitions === undefined
          ? [{ op: "add" as const, path: "/_definitions", value: { [definitionType]: definition } }]
          : [{ op: "add" as const, path: pointer, value: definition }])
      ] }] }
  };
}

function instantiateMvpPrototype(type: string, definition: JsonObject, usedIds: Set<string>): JsonObject {
  const body = clone(definition);
  const oldIds = new Set<string>(); collectIds(body, oldIds);
  const replacements = new Map<string, string>();
  for (const oldId of oldIds) replacements.set(oldId, uniqueId(oldId, usedIds));
  const newRootId = uniqueId(type.slice(3).replace(/[^a-zA-Z0-9]+/gu, "-").toLowerCase(), usedIds);
  replacements.set(prototypeRootReference, newRootId);
  const node = rewriteLocalReferences(body, replacements) as Record<string, JsonValue>;
  delete node._extends;
  delete node._promptTemplate;
  delete node._label;
  delete node._semantics;
  delete node._type;
  node.id = newRootId;
  node._type = type;
  node._label = typeof definition._label === "string" ? definition._label.replace(/ — прототип$/u, "") : type;
  node._semantics = typeof definition._semantics === "string" ? definition._semantics : "Экземпляр локального UI-прототипа.";
  if (isPlainJsonObject(definition._promptTemplate) && typeof definition._promptTemplate.raw === "string") {
    node._prompt = { status: "draft", raw: definition._promptTemplate.raw, source: "user", language: definition._promptTemplate.language ?? "ru", updatedAt: new Date().toISOString() };
  }
  return node;
}
