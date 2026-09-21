/** Prototype-declared, authoring-only YAML property projection (ADR-108). */
import AjvModule, { type Options as AjvOptions } from "ajv";
import { manifestAuthoringCommonSchema, type ProjectionDescriptor, type ProjectionProperty } from "@cubica/contracts-manifest";
import { appendPointerSegment, parseJsonPointer, readJsonPointer } from "./json-pointer-patch.ts";
import { isPlainJsonObject, titleFromToken } from "./shared.ts";
import type { EditorEntityFacetKind, EditorEntityFieldDictionaryEntry, EditorEntityProjectionDocument, FacetSourceLine, JsonObject, JsonValue } from "./types.ts";

export interface SemanticSource { readonly filePath: string; readonly pointer: string }
export interface SemanticFacet extends SemanticSource { readonly kind: EditorEntityFacetKind }
export interface BuildSemanticEntityProjectionInput {
  readonly mode: "instance" | "prototype";
  readonly target: SemanticSource;
  readonly targetFacet?: EditorEntityFacetKind;
  readonly documents: readonly EditorEntityProjectionDocument[];
  /** Exact sources established by the caller's entity projection or preview provenance. */
  readonly facets?: readonly SemanticFacet[];
  readonly fieldDictionary?: readonly EditorEntityFieldDictionaryEntry[];
}
export interface SemanticProperty {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly group?: string;
  readonly facet: EditorEntityFacetKind;
  readonly presentation: ProjectionProperty["presentation"];
  readonly value: JsonValue;
  /** Exact authoring value, retained for agent context when `value` is a rule explanation. */
  readonly sourceValue: JsonValue;
  readonly owner: SemanticSource;
  readonly writeTarget: SemanticSource & { readonly operation: "add" | "replace" | "agent"; readonly parentObjects: readonly string[] };
  readonly inherited: boolean;
  readonly resetTarget?: SemanticSource;
  readonly scope: "instance" | "prototype" | "shared";
}
export interface SemanticEntityProjection {
  readonly text: string;
  readonly facetSourceMap: { readonly lines: readonly FacetSourceLine[] };
  readonly properties: readonly SemanticProperty[];
  readonly definitionType?: string;
  readonly definitionSource?: SemanticSource;
  readonly diagnostics: readonly string[];
}

const fallbackKeys = new Set(["title", "text", "label", "caption", "description", "icon", "alt"]);
const technicalKeys = new Set(["id", "type", "_type", "_label", "_semantics", "_prompt", "_promptTemplate", "_projection", "gameEntityId", "source", "sourceMap", "expression", "computed"]);
type ProjectionAjv = { compile(schema: unknown): (value: unknown) => boolean };
type ProjectionAjvConstructor = new (options?: AjvOptions) => ProjectionAjv;
const AjvConstructor = (AjvModule as unknown as { readonly default?: ProjectionAjvConstructor }).default ??
  (AjvModule as unknown as ProjectionAjvConstructor);
const projectionValidator = new AjvConstructor({ strict: false }).compile({
  definitions: {
    projectionDescriptor: manifestAuthoringCommonSchema.definitions.projectionDescriptor,
    projectionProperty: manifestAuthoringCommonSchema.definitions.projectionProperty
  },
  $ref: "#/definitions/projectionDescriptor"
});

export function buildSemanticEntityProjection(input: BuildSemanticEntityProjectionInput): SemanticEntityProjection {
  const docs = new Map(input.documents.map((document) => [document.filePath, document]));
  const targetDoc = docs.get(input.target.filePath);
  const target = targetDoc?.json === undefined ? undefined : readJsonPointer(targetDoc.json, input.target.pointer);
  const diagnostics: string[] = [];
  if (!isPlainJsonObject(target)) return emptyProjection(["Selected authoring object is unavailable."]);
  const definitions = targetDoc?.json === undefined ? undefined : readJsonPointer(targetDoc.json, "/_definitions");
  const type = input.mode === "prototype" ? parseJsonPointer(input.target.pointer).at(-1) : target._type;
  const definitionType = typeof type === "string" ? type : undefined;
  const chain = resolveChain(definitionType, definitions, diagnostics);
  const definitionSource = definitionType && chain.length > 0
    ? { filePath: input.target.filePath, pointer: `/_definitions/${escapeSegment(definitionType)}` } : undefined;
  const descriptor = new Map<string, ProjectionProperty>();
  const hasExplicitDescriptor = chain.some((entry) => entry.value._projection !== undefined);
  for (const entry of chain) {
    const declaration = entry.value._projection;
    if (declaration === undefined) continue;
    if (!projectionValidator(declaration)) {
      diagnostics.push(`Invalid projection descriptor in ${entry.type}.`);
      continue;
    }
    const validDeclaration = declaration as unknown as ProjectionDescriptor;
    const declaredHere = new Set<string>();
    for (const raw of validDeclaration.properties) {
      if (declaredHere.has(raw.id)) { diagnostics.push(`Duplicate projection property ${raw.id} in ${entry.type}.`); continue; }
      declaredHere.add(raw.id);
      const previous = descriptor.get(raw.id);
      if (previous && propertyIdentity(previous) !== propertyIdentity(raw)) {
        diagnostics.push(`Projection property ${raw.id} changes its facet or field identity in ${entry.type}.`);
        continue;
      }
      descriptor.set(raw.id, raw);
    }
  }
  const facet = input.targetFacet ?? (targetDoc?.documentKind === "game" ? "logic" : "view");
  const effective = chain.reduce<JsonObject>((acc, entry) => mergeAuthoring(acc, entry.value), {});
  const body = input.mode === "instance" ? mergeAuthoring(effective, target) : effective;
  if (!orderedDescriptorHasName(descriptor) && (typeof target._label === "string" || chain.some((entry) => typeof entry.value._label === "string"))) {
    descriptor.set(`${facet}.elementName`, { id: `${facet}.elementName`, facet, path: "/_label", presentation: "text", label: input.mode === "prototype" ? "Название прототипа" : "Название элемента", order: -100 });
  }
  if (!hasExplicitDescriptor) {
    for (const key of Object.keys(target)) {
      const pointer = appendPointerSegment(input.target.pointer, key);
      const declared = input.fieldDictionary?.find((entry) => entry.pointer === pointer || entry.key === key);
      if ((declared?.meaningful === true || (declared?.meaningful !== false && fallbackKeys.has(key))) && !technicalKeys.has(key) && scalarVisible(target[key])) {
        descriptor.set(`${facet}.${key}`, { id: `${facet}.${key}`, facet, path: `/${escapeSegment(key)}`, presentation: "text", label: declared?.label });
      }
    }
  }
  const sources: SemanticFacet[] = [{ ...input.target, kind: facet }, ...(input.facets ?? [])];
  const properties: SemanticProperty[] = [];
  const ordered = [...descriptor.values()].filter((item) => (item.expose ?? ["instance", "prototype"]).includes(input.mode))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
  for (const item of ordered) {
    const refFacet = item.reference?.facet ?? item.facet;
    const source = sources.find((candidate) => candidate.kind === refFacet);
    if (!source) { diagnostics.push(`No established ${refFacet} facet for ${item.id}.`); continue; }
    const relative = item.reference?.path ?? item.path;
    if (!safeRelativePointer(relative, item.presentation)) { diagnostics.push(`Invalid property path for ${item.id}.`); continue; }
    const sourceDoc = docs.get(source.filePath);
    const sourceRoot = sourceDoc?.json === undefined ? undefined : readJsonPointer(sourceDoc.json, source.pointer);
    const isLocal = source.filePath === input.target.filePath && source.pointer === input.target.pointer;
    const sourceDefinitions = sourceDoc?.json === undefined ? undefined : readJsonPointer(sourceDoc.json, "/_definitions");
    const sourceChain = isLocal || !isPlainJsonObject(sourceRoot) || typeof sourceRoot._type !== "string"
      ? [] : resolveChain(sourceRoot._type, sourceDefinitions, diagnostics);
    const sourceDefaults = sourceChain.reduce<JsonObject>((acc, entry) => mergeAuthoring(acc, entry.value), {});
    const sourceEffective = isLocal ? body : isPlainJsonObject(sourceRoot) ? mergeAuthoring(sourceDefaults, sourceRoot) : undefined;
    const value = sourceEffective === undefined ? undefined : readJsonPointer(sourceEffective, relative);
    if (value === undefined) { diagnostics.push(`Property ${item.id} has no resolved authoring value.`); continue; }
    if (item.presentation !== "rule" && !scalarVisible(value)) { diagnostics.push(`Property ${item.id} is not a visible scalar.`); continue; }
    const owner = isLocal ? findValueOwner(input.target, target, chain, relative)
      : isPlainJsonObject(sourceRoot) ? findValueOwner(source, sourceRoot, sourceChain, relative)
      : { filePath: source.filePath, pointer: `${source.pointer}${relative}` };
    const localPath = `${source.pointer}${relative}`;
    const localValue = sourceRoot === undefined ? undefined : readJsonPointer(sourceRoot, relative);
    const parentObjects = isPlainJsonObject(sourceRoot) ? missingObjectParents(sourceRoot, source.pointer, relative) : undefined;
    const computedRule = item.presentation === "rule" ? explainRule(value, input.documents, input.fieldDictionary ?? []) : undefined;
    const shownValue: JsonValue = item.presentation === "rule" ? computedRule ?? "Правило требует проверки агентом." : value;
    if (item.presentation === "rule" && computedRule === undefined) {
      diagnostics.push(`Rule ${item.id} cannot be explained from its supported expression AST; an agent must inspect it.`);
    }
    const operation = item.presentation === "rule" || parentObjects === undefined ? "agent" : localValue === undefined ? "add" : "replace";
    const inherited = localValue === undefined && input.mode === "instance" && (isLocal || sourceChain.length > 0);
    properties.push({
      id: item.id, label: item.label ?? input.fieldDictionary?.find((entry) => entry.pointer === `${source.pointer}${relative}` || entry.key === parseJsonPointer(relative).at(-1))?.label ?? titleFromToken(parseJsonPointer(relative).at(-1) ?? item.id),
      description: item.description, group: item.group, facet: item.facet, presentation: item.presentation, value: shownValue, sourceValue: value,
      owner, writeTarget: { filePath: source.filePath, pointer: localPath, operation, parentObjects: parentObjects ?? [] },
      inherited, resetTarget: isLocal && localValue !== undefined && input.mode === "instance" && relative !== "/_label" &&
        readJsonPointer(effective, relative) !== undefined && !pathTraversesArray(target, relative) && !pathTraversesArray(effective, relative)
        ? { filePath: source.filePath, pointer: localPath } : undefined,
      scope: !isLocal ? "shared" : input.mode
    });
  }
  const lines: string[] = [];
  const sourceLines: FacetSourceLine[] = [];
  const append = (line: string, meta: Omit<FacetSourceLine, "line">) => { sourceLines.push({ ...meta, line: lines.length }); lines.push(line); };
  let group: string | undefined;
  for (const property of properties) {
    if (property.group !== group && property.group) append(`${property.group}:`, { kind: "facet", indent: 0, facetKind: property.facet });
    group = property.group;
    const indent = group ? 2 : 0;
    const prefix = `${" ".repeat(indent)}${property.label}: `;
    append(`${prefix}${formatScalar(property.value)}`, {
      kind: "field-scalar", indent, filePath: property.writeTarget.filePath, pointer: property.writeTarget.pointer,
      valueKind: "scalar", valueStart: prefix.length, facetKind: property.facet,
      writeParents: property.writeTarget.parentObjects, writeOperation: property.writeTarget.operation === "agent" ? undefined : property.writeTarget.operation,
      agentOnly: property.writeTarget.operation === "agent" ? true : undefined
    });
  }
  return { text: `${lines.join("\n")}\n`, facetSourceMap: { lines: sourceLines }, properties, definitionType, definitionSource, diagnostics };
}

function emptyProjection(diagnostics: string[]): SemanticEntityProjection { return { text: "", facetSourceMap: { lines: [] }, properties: [], diagnostics }; }
function escapeSegment(value: string): string { return value.replace(/~/g, "~0").replace(/\//g, "~1"); }
function safeRelativePointer(value: string, presentation: ProjectionProperty["presentation"]): boolean {
  try { return value.startsWith("/") && parseJsonPointer(value).every((segment) => segment !== "" && (segment === "_label" || (presentation === "rule" && (segment === "computed" || segment === "expression")) || !technicalKeys.has(segment)) && segment !== "__proto__" && segment !== "constructor" && segment !== "prototype"); }
  catch { return false; }
}
function scalarVisible(value: JsonValue | undefined): value is string | number | boolean | null {
  return value !== undefined && (value === null || typeof value !== "object") && !(typeof value === "string" && /\{\{[^}]+\}\}/u.test(value));
}
function resolveChain(type: string | undefined, definitions: JsonValue | undefined, diagnostics: string[]): { type: string; value: JsonObject }[] {
  const chain: { type: string; value: JsonObject }[] = [];
  const seen = new Set<string>();
  let current = type;
  while (current && isPlainJsonObject(definitions) && isPlainJsonObject(definitions[current])) {
    if (seen.has(current) || chain.length >= 5) { diagnostics.push("Prototype inheritance is cyclic or too deep."); return []; }
    seen.add(current);
    const value = definitions[current] as JsonObject;
    chain.unshift({ type: current, value });
    current = typeof value._extends === "string" ? value._extends : undefined;
  }
  if (current) diagnostics.push(`Prototype ${current} is unresolved.`);
  return chain;
}
function mergeAuthoring(base: JsonObject, override: JsonObject): JsonObject {
  const result: Record<string, JsonValue> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if ((key.startsWith("_") && key !== "_label") || key === "id") continue;
    result[key] = isPlainJsonObject(value) && isPlainJsonObject(result[key]) ? mergeAuthoring(result[key], value) : value;
  }
  return result;
}
function orderedDescriptorHasName(descriptor: ReadonlyMap<string, ProjectionProperty>): boolean {
  return [...descriptor.values()].some((property) => property.path === "/_label" && property.reference === undefined);
}
function propertyIdentity(property: ProjectionProperty): string {
  return JSON.stringify([property.facet, property.path, property.reference?.facet, property.reference?.path]);
}
function findValueOwner(source: SemanticSource, target: JsonObject, chain: readonly { type: string; value: JsonObject }[], relative: string): SemanticSource {
  if (readJsonPointer(target, relative) !== undefined) return { filePath: source.filePath, pointer: `${source.pointer}${relative}` };
  for (const entry of [...chain].reverse()) if (readJsonPointer(entry.value, relative) !== undefined)
    return { filePath: source.filePath, pointer: `/_definitions/${escapeSegment(entry.type)}${relative}` };
  return { filePath: source.filePath, pointer: `${source.pointer}${relative}` };
}
function missingObjectParents(target: JsonObject, root: string, relative: string): string[] | undefined {
  const segments = parseJsonPointer(relative);
  if (segments.some((segment) => /^(?:0|[1-9][0-9]*|-)$/u.test(segment))) return undefined;
  let current: JsonValue = target;
  let pointer = root;
  const missing: string[] = [];
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(current) || (current !== undefined && !isPlainJsonObject(current))) return undefined;
    current = isPlainJsonObject(current) ? current[segment] : undefined as unknown as JsonValue;
    pointer = appendPointerSegment(pointer, segment);
    if (current === undefined) missing.push(pointer);
  }
  return missing;
}
function pathTraversesArray(root: JsonObject, relative: string): boolean {
  let current: JsonValue | undefined = root;
  for (const segment of parseJsonPointer(relative).slice(0, -1)) {
    if (Array.isArray(current)) return true;
    current = isPlainJsonObject(current) ? current[segment] : undefined;
  }
  return Array.isArray(current);
}
function formatScalar(value: JsonValue): string { return JSON.stringify(value); }

/** Only AST operations with exact, compositional meaning receive a rule explanation. */
function explainRule(value: JsonValue, documents: readonly EditorEntityProjectionDocument[], _dictionary: readonly EditorEntityFieldDictionaryEntry[]): string | undefined {
  const expression = isPlainJsonObject(value) && isPlainJsonObject(value.expression) ? value.expression : value;
  const describe = (node: JsonValue): string | undefined => {
    if (typeof node === "number") return String(node);
    if (!isPlainJsonObject(node)) return undefined;
    if (typeof node.var === "string") {
      const declared = findDeclaredVariableLabel(node.var, documents);
      if (declared !== undefined) return declared;
      const metricId = /^public\.metrics\.([A-Za-z0-9_-]+)$/u.exec(node.var)?.[1];
      return metricId === undefined ? undefined : uniqueLabel(documents.flatMap((document) =>
        findMetricLabels(document.json).filter((metric) => metric.id === metricId).map((metric) => metric.label)));
    }
    const subtract = node["-"];
    if (Array.isArray(subtract) && subtract.length === 2) {
      const left = describe(subtract[0]); const right = describe(subtract[1]);
      return left && right ? `Из значения «${left}» вычесть значение «${right}».` : undefined;
    }
    return undefined;
  };
  return describe(expression);
}
function findDeclaredVariableLabel(variable: string, documents: readonly EditorEntityProjectionDocument[]): string | undefined {
  const labels: string[] = [];
  for (const document of documents) {
    if (document.json === undefined) continue;
    const definitions = readJsonPointer(document.json, "/_definitions");
    if (!isPlainJsonObject(definitions)) continue;
    for (const definition of Object.values(definitions)) {
      if (!isPlainJsonObject(definition) || !projectionValidator(definition._projection)) continue;
      for (const property of (definition._projection as unknown as ProjectionDescriptor).properties) {
        if (typeof property.label !== "string") continue;
        const normalized = parseJsonPointer(property.path).filter((segment) => segment !== "root" && segment !== "data").join(".");
        if (normalized === variable) labels.push(property.label);
      }
    }
  }
  return uniqueLabel(labels);
}
function uniqueLabel(labels: readonly string[]): string | undefined {
  const unique = new Set(labels);
  return unique.size === 1 ? unique.values().next().value : undefined;
}
function findMetricLabels(json: JsonValue | undefined): { id: string; label: string }[] {
  if (json === undefined) return [];
  const metrics = readJsonPointer(json, "/root/content/data/metrics");
  return Array.isArray(metrics) ? metrics.filter(isPlainJsonObject).flatMap((metric) => typeof metric.metricId === "string" && typeof metric.label === "string" ? [{ id: metric.metricId, label: metric.label }] : []) : [];
}
