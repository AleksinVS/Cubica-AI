/**
 * Reusable compiler for Cubica ADR-030 authoring manifests.
 *
 * Authoring manifest means the editable source JSON that can use `_type`,
 * `_definitions`, `_extends`, and `_semantics`. Runtime manifest means the
 * generated JSON consumed by runtime-api and player-web. This module keeps
 * those layers separate and can be used by both CLI checks and editor-web
 * route handlers.
 */

const fs = require("node:fs");
const path = require("node:path");
const Ajv = require("ajv");

const repoRoot = path.resolve(__dirname, "..", "..");
const schemasRoot = path.join(repoRoot, "docs", "architecture", "schemas");
const AUTHORING_KEYS = new Set([
  "_type",
  "_extends",
  "_label",
  "_semantics",
  "_prompt",
  "_promptTemplate",
  "_definitions",
  "_schemaVersion",
  "_manifestType",
  "_channel"
]);
const MAX_EXTENDS_DEPTH = 5;

class CompileError extends Error {
  constructor(message, filePath, pointer) {
    const location = filePath ? `${relativePath(filePath)}${pointer || ""}` : "unknown source";
    super(`${message} at ${location}`);
    this.name = "CompileError";
    this.filePath = filePath;
    this.pointer = pointer || "";
    this.rawMessage = message;
  }
}

function relativePath(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

function toPointerSegment(segment) {
  return String(segment).replace(/~/g, "~0").replace(/\//g, "~1");
}

function joinPointer(parent, segment) {
  return `${parent}/${toPointerSegment(segment)}`;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new CompileError(`Invalid JSON: ${error.message}`, filePath, "");
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function formatErrors(errors) {
  return (errors || [])
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");
}

function buildAjv() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  for (const schemaFile of [
    "manifest-authoring-common.schema.json",
    "game-authoring.schema.json",
    "ui-authoring.schema.json",
    "game-authoring-v2.schema.json",
    "ui-authoring-v2.schema.json",
    "manifest-source-map.schema.json",
    "game-manifest.schema.json",
    "ui-manifest.schema.json"
  ]) {
    const schema = readJson(path.join(schemasRoot, schemaFile));
    if (schemaFile === "game-manifest.schema.json") {
      ajv.addSchema(schema, "https://cubica.platform/schemas/game-manifest.schema.json");
    } else {
      ajv.addSchema(schema);
    }
  }
  return ajv;
}

function hasPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function withoutAuthoringKeys(value) {
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (!AUTHORING_KEYS.has(key)) {
      result[key] = child;
    }
  }
  return result;
}

function assertNoMergeOperatorConflicts(node, filePath, pointer) {
  if (!hasPlainObject(node)) {
    return;
  }

  if (isDeclarativeExpressionPointer(pointer)) {
    return;
  }

  for (const key of Object.keys(node)) {
    if (!key.startsWith("+") && !key.startsWith("-")) {
      continue;
    }
    const baseKey = key.slice(1);
    if (Object.prototype.hasOwnProperty.call(node, baseKey)) {
      throw new CompileError(
        `Merge operator "${key}" conflicts with sibling "${baseKey}"`,
        filePath,
        pointer
      );
    }
    throw new CompileError(
      `Merge operator "${key}" is not enabled by the current authoring schema`,
      filePath,
      pointer
    );
  }
}

function isDeclarativeExpressionPointer(pointer) {
  const segments = pointer.split("/").filter(Boolean);
  return segments.includes("jsonLogic") || segments.includes("expression");
}

function mergeObjects(parentValue, childValue) {
  if (Array.isArray(parentValue) || Array.isArray(childValue)) {
    return clone(childValue);
  }
  if (!hasPlainObject(parentValue) || !hasPlainObject(childValue)) {
    return clone(childValue);
  }

  const merged = clone(parentValue);
  for (const [key, value] of Object.entries(childValue)) {
    if (hasPlainObject(merged[key]) && hasPlainObject(value)) {
      merged[key] = mergeObjects(merged[key], value);
    } else {
      merged[key] = clone(value);
    }
  }
  return merged;
}

function createCompilerContext(sourceFile, authoring) {
  return {
    sourceFile,
    authoring,
    definitions: authoring._definitions || {},
    definitionCache: new Map(),
    allowUnresolvedTypes: authoring._schemaVersion === "2.0"
  };
}

function readPointer(document, pointer) {
  if (pointer === "") {
    return { exists: true, value: document };
  }
  if (!pointer.startsWith("/")) {
    return { exists: false, value: undefined };
  }

  let current = document;
  for (const rawSegment of pointer.slice(1).split("/")) {
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!hasPlainObject(current) && !Array.isArray(current)) {
      return { exists: false, value: undefined };
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      return { exists: false, value: undefined };
    }
    current = current[segment];
  }
  return { exists: true, value: current };
}

function sourceExists(context, source) {
  if (source.file !== relativePath(context.sourceFile)) {
    return false;
  }
  return readPointer(context.authoring, source.pointer).exists;
}

function uniqueSources(sources) {
  const seen = new Set();
  const result = [];
  for (const source of sources) {
    const key = `${source.file}\0${source.pointer}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(source);
    }
  }
  return result;
}

function deriveChildSources(parentSources, segment, context) {
  const candidates = parentSources.map((source) => ({
    file: source.file,
    pointer: joinPointer(source.pointer, segment)
  }));
  const existing = candidates.filter((source) => sourceExists(context, source));
  if (existing.length > 0) {
    return uniqueSources(existing);
  }

  // Falling back to the nearest existing source keeps diagnostics useful even
  // for merged object children that are created by the compiler rather than
  // present as a concrete node in one authoring file.
  return uniqueSources(parentSources.filter((source) => sourceExists(context, source)));
}

function resolveDefinition(typeName, context, stack = []) {
  const sourceFile = context.sourceFile;
  const definition = context.definitions[typeName];
  if (!definition) {
    if (context.allowUnresolvedTypes) {
      return { value: {}, sources: [] };
    }
    throw new CompileError(`Unknown authoring _type "${typeName}"`, sourceFile, "/_definitions");
  }
  if (stack.includes(typeName)) {
    throw new CompileError(`Cyclic _extends chain: ${[...stack, typeName].join(" -> ")}`, sourceFile, "/_definitions");
  }
  if (stack.length >= MAX_EXTENDS_DEPTH) {
    throw new CompileError(`_extends chain is deeper than ${MAX_EXTENDS_DEPTH}`, sourceFile, "/_definitions");
  }
  if (context.definitionCache.has(typeName)) {
    return clone(context.definitionCache.get(typeName));
  }

  let resolved = {};
  const sources = [];
  if (typeof definition._extends === "string") {
    const parent = resolveDefinition(definition._extends, context, [...stack, typeName]);
    resolved = mergeObjects(resolved, parent.value);
    sources.push(...parent.sources);
  }

  const definitionPointer = joinPointer("/_definitions", typeName);
  resolved = mergeObjects(resolved, withoutAuthoringKeys(definition));
  sources.push({ file: relativePath(sourceFile), pointer: definitionPointer });

  const result = { value: resolved, sources };
  context.definitionCache.set(typeName, clone(result));
  return result;
}

function compileNode(node, context, pointer, inheritedSources = []) {
  const sourceFile = context.sourceFile;
  if (Array.isArray(node)) {
    const values = [];
    const mappings = {};
    node.forEach((item, index) => {
      const childSources = deriveChildSources(inheritedSources, index, context);
      const child = compileNode(item, context, joinPointer(pointer, index), childSources);
      values.push(child.value);
      Object.assign(mappings, child.mappings);
    });
    mappings[pointer] = inheritedSources.length > 0 ? inheritedSources : [{ file: relativePath(sourceFile), pointer }];
    return { value: values, mappings };
  }

  if (!hasPlainObject(node)) {
    return {
      value: node,
      mappings: {
        [pointer]: inheritedSources.length > 0 ? inheritedSources : [{ file: relativePath(sourceFile), pointer }]
      }
    };
  }

  assertNoMergeOperatorConflicts(node, sourceFile, pointer);

  let working = withoutAuthoringKeys(node);
  const ownSources = inheritedSources.length > 0 ? inheritedSources : [{ file: relativePath(sourceFile), pointer }];
  let sources = ownSources;
  if (typeof node._type === "string") {
    const resolved = resolveDefinition(node._type, context);
    working = mergeObjects(resolved.value, working);
    sources = uniqueSources([...ownSources, ...resolved.sources]);
  }

  const result = {};
  const mappings = {
    [pointer]: sources
  };
  for (const [key, value] of Object.entries(working)) {
    const childPointer = joinPointer(pointer, key);
    const childSources = deriveChildSources(sources, key, context);
    const child = compileNode(value, context, childPointer, childSources);
    result[key] = child.value;
    Object.assign(mappings, child.mappings);
  }

  return { value: result, mappings };
}

function assertNoAuthoringKeys(value, filePath, pointer = "") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoAuthoringKeys(item, filePath, joinPointer(pointer, index)));
    return;
  }
  if (!hasPlainObject(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (AUTHORING_KEYS.has(key) || key === "_source_trace") {
      throw new CompileError(`Runtime output contains authoring-only key "${key}"`, filePath, pointer || "/");
    }
    assertNoAuthoringKeys(child, filePath, joinPointer(pointer, key));
  }
}

function compileAuthoringDocument(job, authoring, ajv) {
  const schemaId = schemaIdForAuthoringJob(job, authoring);
  const validate = ajv.getSchema(schemaId);
  if (!validate(authoring)) {
    throw new CompileError(`Authoring schema validation failed: ${formatErrors(validate.errors)}`, job.sourceFile, "");
  }

  const compiledRoot = compileNode(authoring.root, createCompilerContext(job.sourceFile, authoring), "/root");
  const compiled = authoring._schemaVersion === "2.0"
    ? compileAuthoringV2(job, compiledRoot)
    : compiledRoot;
  assertNoAuthoringKeys(compiled.value, job.outputFile);

  const sourceMap = {
    version: 1,
    generatedFile: relativePath(job.outputFile),
    sourceFile: relativePath(job.sourceFile),
    mappings: normalizeRuntimePointers(compiled.mappings)
  };

  const validateSourceMap = ajv.getSchema("https://cubica.platform/schemas/manifest-source-map.v1.json");
  if (!validateSourceMap(sourceMap)) {
    throw new CompileError(`Source map schema validation failed: ${formatErrors(validateSourceMap.errors)}`, job.sourceMapFile, "");
  }

  return {
    manifest: compiled.value,
    sourceMap
  };
}

function compileAuthoringText(job, text, ajv = buildAjv()) {
  let authoring;
  try {
    authoring = JSON.parse(text);
  } catch (error) {
    throw new CompileError(`Invalid JSON: ${error.message}`, job.sourceFile, "");
  }

  return compileAuthoringDocument(job, authoring, ajv);
}

function compileAuthoringFile(job, ajv = buildAjv()) {
  return compileAuthoringDocument(job, readJson(job.sourceFile), ajv);
}

function normalizeRuntimePointers(mappings) {
  const normalized = {};
  for (const [pointer, sources] of Object.entries(mappings)) {
    if (pointer === "/root") {
      normalized[""] = sources;
    } else if (pointer.startsWith("/root/")) {
      normalized[pointer.slice("/root".length)] = sources;
    } else {
      normalized[pointer] = sources;
    }
  }
  return normalized;
}

function schemaIdForAuthoringJob(job, authoring) {
  const version = authoring && authoring._schemaVersion === "2.0" ? "v2" : "v1";
  if (job.kind === "game") {
    return version === "v2"
      ? "https://cubica.platform/schemas/game-authoring.v2.json"
      : "https://cubica.platform/schemas/game-authoring.v1.json";
  }
  return version === "v2"
    ? "https://cubica.platform/schemas/ui-authoring.v2.json"
    : "https://cubica.platform/schemas/ui-authoring.v1.json";
}

function ensureObject(value, filePath, pointer, label) {
  if (!hasPlainObject(value)) {
    throw new CompileError(`${label} must be an object`, filePath, pointer);
  }
  return value;
}

function ensureArray(value, filePath, pointer, label) {
  if (!Array.isArray(value)) {
    throw new CompileError(`${label} must be an array`, filePath, pointer);
  }
  return value;
}

function sourceFor(compiled, sourceFile, pointer) {
  return compiled.mappings[pointer] || [{ file: relativePath(sourceFile), pointer }];
}

function addRuntimeMapping(mappings, targetPointer, compiled, sourceFile, sourcePointer) {
  mappings[targetPointer] = sourceFor(compiled, sourceFile, sourcePointer);
}

function copySubtreeMappings(mappings, compiled, sourceFile, sourcePrefix, targetPrefix) {
  for (const sourcePointer of Object.keys(compiled.mappings)) {
    if (sourcePointer !== sourcePrefix && !sourcePointer.startsWith(`${sourcePrefix}/`)) {
      continue;
    }
    const suffix = sourcePointer.slice(sourcePrefix.length);
    const targetPointer = `${targetPrefix}${suffix}`;
    mappings[targetPointer] = sourceFor(compiled, sourceFile, sourcePointer);
  }
}

function copyIfPresent(target, mappings, compiled, sourceFile, source, key) {
  if (Object.prototype.hasOwnProperty.call(source, key)) {
    target[key] = source[key];
    copySubtreeMappings(mappings, compiled, sourceFile, joinPointer("/root", key), joinPointer("", key));
  }
}

function normalizeFacetValue(rawValue, initialValue) {
  if (typeof initialValue === "boolean") {
    if (rawValue === "true") {
      return true;
    }
    if (rawValue === "false") {
      return false;
    }
  }

  if (typeof initialValue === "number" && rawValue !== "") {
    const numericValue = Number(rawValue);
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
  }

  return rawValue;
}

function sameFacetValue(left, right) {
  return left === right;
}

function buildObjectViewRule(valueDefinition) {
  const view = hasPlainObject(valueDefinition.view) ? clone(valueDefinition.view) : {};
  if (Object.prototype.hasOwnProperty.call(valueDefinition, "visible")) {
    view.visible = valueDefinition.visible;
  }
  if (Object.prototype.hasOwnProperty.call(valueDefinition, "interactive")) {
    view.interactive = valueDefinition.interactive;
  }
  return Object.keys(view).length > 0 ? view : null;
}

function appendObjectModelsRuntimeField(manifest, mappings, compiledRoot, sourceFile, objectTypesValue) {
  const objectTypes = ensureObject(objectTypesValue, sourceFile, "/root/objectTypes", "game v2 root.objectTypes");
  const objectModels = {};

  for (const [objectTypeId, objectType] of Object.entries(objectTypes)) {
    const objectTypePointer = joinPointer("/root/objectTypes", objectTypeId);
    const objectTypeObject = ensureObject(objectType, sourceFile, objectTypePointer, "game v2 object type");

    if (objectTypeObject.scope !== "session") {
      throw new CompileError(
        `Object type "${objectTypeId}" uses unsupported scope "${String(objectTypeObject.scope)}"; only "session" is implemented`,
        sourceFile,
        joinPointer(objectTypePointer, "scope")
      );
    }

    const facetsSource = ensureObject(
      objectTypeObject.facets,
      sourceFile,
      joinPointer(objectTypePointer, "facets"),
      `game v2 object type "${objectTypeId}" facets`
    );
    const facets = {};
    const viewFacets = {};

    for (const [facetId, facet] of Object.entries(facetsSource)) {
      const facetPointer = joinPointer(joinPointer(objectTypePointer, "facets"), facetId);
      const facetObject = ensureObject(facet, sourceFile, facetPointer, `game v2 object type "${objectTypeId}" facet "${facetId}"`);
      const valuesSource = ensureObject(
        facetObject.values,
        sourceFile,
        joinPointer(facetPointer, "values"),
        `game v2 object type "${objectTypeId}" facet "${facetId}" values`
      );
      const values = Object.keys(valuesSource).map((valueKey) => normalizeFacetValue(valueKey, facetObject.initial));

      if (!values.some((value) => sameFacetValue(value, facetObject.initial))) {
        throw new CompileError(
          `Facet "${facetId}" initial value "${String(facetObject.initial)}" is not listed in values`,
          sourceFile,
          joinPointer(facetPointer, "initial")
        );
      }

      facets[facetId] = {
        initial: facetObject.initial,
        values
      };

      for (const [valueKey, valueDefinition] of Object.entries(valuesSource)) {
        const valueObject = ensureObject(
          valueDefinition,
          sourceFile,
          joinPointer(joinPointer(facetPointer, "values"), valueKey),
          `game v2 object type "${objectTypeId}" facet "${facetId}" value "${valueKey}"`
        );
        const viewRule = buildObjectViewRule(valueObject);
        if (viewRule) {
          viewFacets[`${facetId}.${String(normalizeFacetValue(valueKey, facetObject.initial))}`] = viewRule;
        }
      }
    }

    const model = {
      collection: objectTypeObject.collection,
      scope: objectTypeObject.scope,
      facets
    };

    if (typeof objectTypeObject.idField === "string") {
      model.idField = objectTypeObject.idField;
    }

    if (Object.keys(viewFacets).length > 0) {
      model.view = { facets: viewFacets };
    }

    objectModels[objectTypeId] = model;

    addRuntimeMapping(mappings, joinPointer("/objectModels", objectTypeId), compiledRoot, sourceFile, objectTypePointer);
    addRuntimeMapping(mappings, joinPointer(joinPointer("/objectModels", objectTypeId), "collection"), compiledRoot, sourceFile, joinPointer(objectTypePointer, "collection"));
    addRuntimeMapping(mappings, joinPointer(joinPointer("/objectModels", objectTypeId), "scope"), compiledRoot, sourceFile, joinPointer(objectTypePointer, "scope"));
    if (typeof objectTypeObject.idField === "string") {
      addRuntimeMapping(mappings, joinPointer(joinPointer("/objectModels", objectTypeId), "idField"), compiledRoot, sourceFile, joinPointer(objectTypePointer, "idField"));
    }
    addRuntimeMapping(mappings, joinPointer(joinPointer("/objectModels", objectTypeId), "facets"), compiledRoot, sourceFile, joinPointer(objectTypePointer, "facets"));
    for (const [facetId, facet] of Object.entries(facets)) {
      const facetPointer = joinPointer(joinPointer(objectTypePointer, "facets"), facetId);
      const targetFacetPointer = joinPointer(joinPointer(joinPointer("/objectModels", objectTypeId), "facets"), facetId);
      addRuntimeMapping(mappings, targetFacetPointer, compiledRoot, sourceFile, facetPointer);
      addRuntimeMapping(mappings, joinPointer(targetFacetPointer, "initial"), compiledRoot, sourceFile, joinPointer(facetPointer, "initial"));
      addRuntimeMapping(mappings, joinPointer(targetFacetPointer, "values"), compiledRoot, sourceFile, joinPointer(facetPointer, "values"));
      facet.values.forEach((value, index) => {
        addRuntimeMapping(
          mappings,
          joinPointer(joinPointer(targetFacetPointer, "values"), index),
          compiledRoot,
          sourceFile,
          joinPointer(joinPointer(facetPointer, "values"), String(value))
        );
      });
    }

    if (Object.keys(viewFacets).length > 0) {
      addRuntimeMapping(mappings, joinPointer(joinPointer("/objectModels", objectTypeId), "view"), compiledRoot, sourceFile, objectTypePointer);
      addRuntimeMapping(mappings, joinPointer(joinPointer(joinPointer("/objectModels", objectTypeId), "view"), "facets"), compiledRoot, sourceFile, joinPointer(objectTypePointer, "facets"));
      for (const [viewKey] of Object.entries(viewFacets)) {
        const [facetId, valueKey] = viewKey.split(".");
        addRuntimeMapping(
          mappings,
          joinPointer(joinPointer(joinPointer(joinPointer("/objectModels", objectTypeId), "view"), "facets"), viewKey),
          compiledRoot,
          sourceFile,
          joinPointer(joinPointer(joinPointer(joinPointer(objectTypePointer, "facets"), facetId), "values"), valueKey)
        );
      }
    }
  }

  manifest.objectModels = objectModels;
  addRuntimeMapping(mappings, "/objectModels", compiledRoot, sourceFile, "/root/objectTypes");
}

function appendGameLogicRuntimeFields(manifest, mappings, compiledRoot, sourceFile, logic) {
  if (Object.prototype.hasOwnProperty.call(logic, "actions")) {
    const actions = {};
    const actionItems = ensureArray(logic.actions, sourceFile, "/root/logic/actions", "game v2 root.logic.actions");
    actionItems.forEach((action, index) => {
      const actionPointer = joinPointer("/root/logic/actions", index);
      const actionObject = ensureObject(action, sourceFile, actionPointer, "game v2 action");
      if (typeof actionObject.id !== "string" || actionObject.id.length === 0) {
        throw new CompileError("game v2 action requires a non-empty id", sourceFile, joinPointer(actionPointer, "id"));
      }
      if (Object.prototype.hasOwnProperty.call(actions, actionObject.id)) {
        throw new CompileError(`Duplicate game v2 action id "${actionObject.id}"`, sourceFile, joinPointer(actionPointer, "id"));
      }
      const { id, ...runtimeAction } = actionObject;
      actions[id] = runtimeAction;
      copySubtreeMappings(mappings, compiledRoot, sourceFile, actionPointer, joinPointer("/actions", actionObject.id));
    });
    manifest.actions = actions;
    addRuntimeMapping(mappings, "/actions", compiledRoot, sourceFile, "/root/logic/actions");
  }

  if (Object.prototype.hasOwnProperty.call(logic, "templates")) {
    manifest.templates = logic.templates;
    copySubtreeMappings(mappings, compiledRoot, sourceFile, "/root/logic/templates", "/templates");
  }
}

function compileGameAuthoringV2(job, compiledRoot) {
  const sourceFile = job.sourceFile;
  const root = ensureObject(compiledRoot.value, sourceFile, "/root", "game v2 root");
  const logic = ensureObject(root.logic, sourceFile, "/root/logic", "game v2 root.logic");
  const manifest = {};
  const mappings = {
    "": sourceFor(compiledRoot, sourceFile, "/root")
  };

  for (const [key, value] of Object.entries(root)) {
    if (key === "logic") {
      appendGameLogicRuntimeFields(manifest, mappings, compiledRoot, sourceFile, value);
    } else if (key === "objectTypes") {
      appendObjectModelsRuntimeField(manifest, mappings, compiledRoot, sourceFile, value);
    } else {
      copyIfPresent(manifest, mappings, compiledRoot, sourceFile, root, key);
    }
  }

  return { value: manifest, mappings };
}

function appendUiScreensRuntimeField(manifest, mappings, compiledRoot, sourceFile, screensValue) {
  const screens = {};
  const screenItems = ensureArray(screensValue, sourceFile, "/root/screens", "UI v2 root.screens");
  screenItems.forEach((screen, index) => {
    const screenPointer = joinPointer("/root/screens", index);
    const screenObject = ensureObject(screen, sourceFile, screenPointer, "UI v2 screen");
    if (typeof screenObject.id !== "string" || screenObject.id.length === 0) {
      throw new CompileError("UI v2 screen requires a non-empty id", sourceFile, joinPointer(screenPointer, "id"));
    }
    if (Object.prototype.hasOwnProperty.call(screens, screenObject.id)) {
      throw new CompileError(`Duplicate UI v2 screen id "${screenObject.id}"`, sourceFile, joinPointer(screenPointer, "id"));
    }
    const { id, ...runtimeScreen } = screenObject;
    screens[screenObject.id] = runtimeScreen;
    copySubtreeMappings(mappings, compiledRoot, sourceFile, screenPointer, joinPointer("/screens", screenObject.id));
  });
  manifest.screens = screens;
  addRuntimeMapping(mappings, "/screens", compiledRoot, sourceFile, "/root/screens");
}

function compileUiAuthoringV2(job, compiledRoot) {
  const sourceFile = job.sourceFile;
  const root = ensureObject(compiledRoot.value, sourceFile, "/root", "UI v2 root");
  const manifest = {};
  const mappings = {
    "": sourceFor(compiledRoot, sourceFile, "/root")
  };

  for (const [key, value] of Object.entries(root)) {
    if (key === "screens") {
      appendUiScreensRuntimeField(manifest, mappings, compiledRoot, sourceFile, value);
    } else {
      copyIfPresent(manifest, mappings, compiledRoot, sourceFile, root, key);
    }
  }

  return { value: manifest, mappings };
}

function compileAuthoringV2(job, compiledRoot) {
  return job.kind === "game"
    ? compileGameAuthoringV2(job, compiledRoot)
    : compileUiAuthoringV2(job, compiledRoot);
}

function discoverJobs(options = {}) {
  const gamesRoot = path.join(repoRoot, "games");
  if (!fs.existsSync(gamesRoot)) {
    return [];
  }

  const jobs = [];
  for (const gameId of fs.readdirSync(gamesRoot).sort()) {
    if (options.gameId && gameId !== options.gameId) {
      continue;
    }
    const gameRoot = path.join(gamesRoot, gameId);
    const stat = fs.statSync(gameRoot);
    if (!stat.isDirectory()) {
      continue;
    }

    const authoringRoot = path.join(gameRoot, "authoring");
    const gameAuthoring = path.join(authoringRoot, "game.authoring.json");
    if (fs.existsSync(gameAuthoring)) {
      jobs.push({
        kind: "game",
        gameId,
        sourceFile: gameAuthoring,
        outputFile: path.join(gameRoot, "game.manifest.json"),
        sourceMapFile: path.join(gameRoot, "game.manifest.source-map.json")
      });
    }

    const uiAuthoringRoot = path.join(authoringRoot, "ui");
    if (fs.existsSync(uiAuthoringRoot)) {
      for (const entry of fs.readdirSync(uiAuthoringRoot).sort()) {
        if (!entry.endsWith(".authoring.json")) {
          continue;
        }
        const channel = entry.slice(0, -".authoring.json".length);
        jobs.push({
          kind: "ui",
          gameId,
          channel,
          sourceFile: path.join(uiAuthoringRoot, entry),
          outputFile: path.join(gameRoot, "ui", channel, "ui.manifest.json"),
          sourceMapFile: path.join(gameRoot, "ui", channel, "ui.manifest.source-map.json")
        });
      }
    }
  }

  return jobs;
}

function parseArgs(argv) {
  const options = {
    check: false,
    quiet: false,
    gameId: null
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") {
      options.check = true;
    } else if (arg === "--quiet") {
      options.quiet = true;
    } else if (arg === "--game") {
      options.gameId = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function schemaIdForRuntimeJob(job) {
  return job.kind === "game"
    ? "https://cubica.platform/schemas/game-manifest.schema.json"
    : "https://cubica.platform/schemas/ui-manifest.v1.json";
}

function pointerFromAjvError(error) {
  if (error.keyword === "required" && error.params && typeof error.params.missingProperty === "string") {
    return joinPointer(error.instancePath || "", error.params.missingProperty);
  }
  if (error.keyword === "additionalProperties" && error.params && typeof error.params.additionalProperty === "string") {
    return joinPointer(error.instancePath || "", error.params.additionalProperty);
  }
  if (error.keyword === "propertyNames" && typeof error.propertyName === "string") {
    return joinPointer(error.instancePath || "", error.propertyName);
  }
  return error.instancePath || "";
}

function validateRuntimeManifest(job, manifest, ajv = buildAjv()) {
  const schemaId = schemaIdForRuntimeJob(job);
  const validate = ajv.getSchema(schemaId);
  if (!validate) {
    throw new CompileError(`Runtime schema is not registered: ${schemaId}`, job.outputFile, "");
  }
  const valid = validate(manifest);
  return {
    valid: Boolean(valid),
    schemaId,
    errors: (validate.errors || []).map((error) => ({
      pointer: pointerFromAjvError(error),
      message: error.message || error.keyword,
      keyword: error.keyword,
      params: error.params || {}
    }))
  };
}

function compareGenerated(filePath, expected) {
  const expectedText = `${JSON.stringify(expected, null, 2)}\n`;
  if (!fs.existsSync(filePath)) {
    return `missing generated file ${relativePath(filePath)}`;
  }
  const actualText = fs.readFileSync(filePath, "utf8");
  return actualText === expectedText ? null : `generated file is stale: ${relativePath(filePath)}`;
}

function compileJobs(options = {}) {
  const ajv = buildAjv();
  const jobs = discoverJobs(options);
  const stale = [];
  const results = [];

  if (jobs.length === 0) {
    return { jobs, results, stale };
  }

  for (const job of jobs) {
    const output = compileAuthoringFile(job, ajv);
    if (options.check) {
      const manifestDiff = compareGenerated(job.outputFile, output.manifest);
      const sourceMapDiff = compareGenerated(job.sourceMapFile, output.sourceMap);
      if (manifestDiff) stale.push(manifestDiff);
      if (sourceMapDiff) stale.push(sourceMapDiff);
    } else {
      writeJson(job.outputFile, output.manifest);
      writeJson(job.sourceMapFile, output.sourceMap);
    }
    results.push({ job, output });
    if (!options.quiet) {
      const action = options.check ? "checked" : "compiled";
      console.log(`${action} ${relativePath(job.sourceFile)} -> ${relativePath(job.outputFile)}`);
    }
  }

  return { jobs, results, stale };
}

function run(options = {}) {
  const result = compileJobs(options);

  if (result.jobs.length === 0) {
    if (!options.quiet) {
      console.log("compile-authoring-manifests: no authoring manifests found");
    }
    return result;
  }

  if (result.stale.length > 0) {
    throw new Error(`Authoring/generated drift detected:\n- ${result.stale.join("\n- ")}`);
  }

  return result;
}

function runCli(argv = process.argv) {
  return run(parseArgs(argv));
}

module.exports = {
  CompileError,
  buildAjv,
  compileAuthoringFile,
  compileAuthoringText,
  compileJobs,
  compareGenerated,
  discoverJobs,
  formatErrors,
  normalizeRuntimePointers,
  parseArgs,
  relativePath,
  run,
  runCli,
  schemaIdForRuntimeJob,
  validateRuntimeManifest
};
