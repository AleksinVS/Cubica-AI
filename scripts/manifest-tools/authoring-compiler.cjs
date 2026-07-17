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
const os = require("node:os");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const AjvLib = require("ajv");
const Ajv = AjvLib.default || AjvLib;
const addFormatsLib = require("ajv-formats");
const addFormats = addFormatsLib.default || addFormatsLib;
const {
  COMPILE_CACHE_FORMAT_VERSION,
  hashText,
  resolveCompileCacheEnabled,
  readCacheEntry,
  writeCacheEntry,
  createCompileTelemetry
} = require("./compile-cache.cjs");
const { mechanicsSha256 } = require("./mechanics-canonicalize.cjs");
const {
  checkMechanicsBundle,
  MechanicsSemanticError,
  turnSessionInitializationForManifest
} = require("./mechanics-checker.cjs");
const {
  validateMacroInput,
  validateMechanicsAuthoringSchema
} = require("./mechanics-authoring-validator.cjs");
const { recommendedModuleLockForOperations } = require("./mechanics-modules.cjs");
const { validateGameIntentSchema, validateMechanicsSchema } = require("./mechanics-validator.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const schemasRoot = path.join(repoRoot, "docs", "architecture", "schemas");

// The schema set the compiler validates against. Declared once so both buildAjv
// (which compiles them) and the cache key (which hashes their contents) stay in
// sync: if a validation schema changes, cached compile results must invalidate.
const COMPILER_SCHEMA_FILES = [
  "manifest-authoring-common.schema.json",
  "game-authoring.schema.json",
  "ui-authoring.schema.json",
  "game-authoring-v2.schema.json",
  "ui-authoring-v2.schema.json",
  "manifest-source-map.schema.json",
  "game-manifest.schema.json",
  "ui-manifest.schema.json"
];
const MECHANICS_COMPILER_INPUT_FILES = [
  path.join(schemasRoot, "mechanics-authoring.schema.json"),
  path.join(schemasRoot, "game-intent.schema.json"),
  path.join(schemasRoot, "mechanics-operation-catalog.json"),
  path.join(schemasRoot, "mechanics-operation-catalog.schema.json"),
  path.join(schemasRoot, "mechanics-plan.schema.json"),
  path.join(__dirname, "mechanics-authoring-validator.cjs"),
  path.join(__dirname, "mechanics-canonicalize.cjs"),
  path.join(__dirname, "mechanics-checker.cjs"),
  path.join(__dirname, "mechanics-modules.cjs"),
  path.join(__dirname, "mechanics-validator.cjs")
];

// Directory for level-3 compile cache entries. Under `.tmp/` (outside Git);
// deleting it is always safe (ADR-057 §5).
const COMPILE_CACHE_DIR = path.join(repoRoot, ".tmp", "editor-cache", "compile");
const AUTHORING_KEYS = new Set([
  "_type",
  "_extends",
  "_label",
  "_semantics",
  "_prompt",
  "_promptTemplate",
  "_requiresView",
  "_decorative",
  "_definitions",
  "_schemaVersion",
  "_manifestType",
  "_channel"
]);
const MAX_EXTENDS_DEPTH = 5;
// Non-enumerable compiler context: pending actions type-check plans but are
// deliberately absent from runtime JSON, source maps, hashes, and caches.
const PARAMETER_ACTIONS = Symbol("cubica.pending-parameter-actions");

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
  // Strict Ajv mode keeps JSON Schema the single source of truth (ADR-025) for
  // both authoring and runtime manifest schemas: unknown keywords/formats and
  // malformed schemas fail fast instead of being silently ignored. allowUnionTypes
  // accepts valid `type: [...]` unions (e.g. ui-manifest uiStyle.width) and
  // ajv-formats registers standard formats (uri, date-time, ...) so `format`
  // keywords are recognised rather than rejected as unknown under strict mode.
  // strictRequired is disabled because both manifest-authoring-common.schema.json
  // (elementPrompt conditional `then: {required:["normalized"]}`) and
  // game-manifest.schema.json ("at least one of" `anyOf` and "must be absent"
  // `not` idioms) place `required` in subschemas that do not re-list the property
  // in a local `properties` — the property is defined at the parent or is
  // intentionally forbidden. `required` stays fully enforced; only the authoring
  // lint is relaxed. Documented bounded exception in LEGACY-0016.
  const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true, strictRequired: false });
  addFormats(ajv);
  for (const schemaFile of COMPILER_SCHEMA_FILES) {
    const schema = readJson(path.join(schemasRoot, schemaFile));
    if (schemaFile === "game-manifest.schema.json") {
      ajv.addSchema(schema, "https://cubica.platform/schemas/game-manifest.schema.json");
    } else {
      ajv.addSchema(schema);
    }
  }
  return ajv;
}

// Per-process (per-worker) cache of built Ajv instances, keyed by the hash of
// the schema set. Building Ajv and compiling its validators costs ~120 ms
// (profiling-baseline §2.1), so buildAjv() on every request was wasteful. This
// reuses one instance for the whole process; the key means a schema change on
// disk yields a fresh instance. Worker threads each get their own module copy,
// hence their own cache — validators are never shared across threads (§9.6).
const sharedAjvBySchemaHash = new Map();

/**
 * Combined SHA-256 of every compiler schema file's contents, computed once and
 * memoised. Used both to key the shared Ajv and to invalidate the compile cache
 * when a validation schema changes.
 */
let cachedSchemasHash;
function getSchemasHash() {
  if (cachedSchemasHash === undefined) {
    cachedSchemasHash = hashText(
      [
        ...COMPILER_SCHEMA_FILES.map((file) => path.join(schemasRoot, file)),
        ...MECHANICS_COMPILER_INPUT_FILES
      ].map((file) => fs.readFileSync(file, "utf8")).join("\0")
    );
  }
  return cachedSchemasHash;
}

/** Returns a process-wide reused Ajv instance (see sharedAjvBySchemaHash). */
function getSharedAjv() {
  const schemaHash = getSchemasHash();
  let ajv = sharedAjvBySchemaHash.get(schemaHash);
  if (ajv === undefined) {
    ajv = buildAjv();
    sharedAjvBySchemaHash.set(schemaHash, ajv);
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
  // Computed, read-only player metrics still use a declarative expression
  // object whose operators may begin with '+' or '-'. Gameplay mutations no
  // longer pass through the removed effect-array compatibility exception.
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
    // The authoring file's repository-relative path is stable for the whole
    // compile, so we compute it once here instead of re-running path.relative
    // (plus its regex) inside the hot source-existence check for every child of
    // every node.
    sourceFileRelative: relativePath(sourceFile),
    authoring,
    definitions: authoring._definitions || {},
    definitionCache: new Map(),
    // Memoises JSON Pointer resolution against `authoring` for this compile.
    // `authoring` is never mutated while compiling, so a pointer always resolves
    // to the same {exists, value}; see resolveAuthoringPointer for why this
    // removes the super-linear "walk from the document root for every child"
    // cost the previous readPointer paid.
    pointerCache: new Map(),
    allowUnresolvedTypes: authoring._schemaVersion === "2.0"
  };
}

/**
 * Resolves a JSON Pointer inside the authoring document, memoised per compile.
 *
 * WHY this shape (and not a fresh walk from the root each time): the compiler
 * derives child sources by extending a parent pointer with one more segment,
 * then asks "does this pointer exist in the authoring file?". The old readPointer
 * re-walked the entire path from the document root for every such question, so a
 * node at depth d cost O(d) per child — super-linear across a deep, wide manifest
 * (large games may contain hundreds of actions). Here each pointer is resolved
 * from its already-cached parent in O(1) and stored, so the whole traversal is
 * linear in the number of distinct pointers queried. Semantics are identical to
 * the previous readPointer: descending requires an object/array with an own
 * property for the (unescaped) segment, otherwise the pointer does not exist.
 */
function resolveAuthoringPointer(context, pointer) {
  const cache = context.pointerCache;
  const cached = cache.get(pointer);
  if (cached !== undefined) {
    return cached;
  }

  let result;
  if (pointer === "") {
    result = { exists: true, value: context.authoring };
  } else if (!pointer.startsWith("/")) {
    result = { exists: false, value: undefined };
  } else {
    // Split off only the last segment; the parent prefix is resolved (and
    // cached) recursively. JSON Pointer separators are literal "/" characters —
    // slashes inside a segment are escaped as "~1" — so lastIndexOf finds the
    // real boundary, matching how the previous readPointer split the path.
    const lastSlash = pointer.lastIndexOf("/");
    const parentPointer = pointer.slice(0, lastSlash);
    const segment = pointer.slice(lastSlash + 1).replace(/~1/g, "/").replace(/~0/g, "~");
    const parent = resolveAuthoringPointer(context, parentPointer);
    const current = parent.value;
    if (
      !parent.exists ||
      (!hasPlainObject(current) && !Array.isArray(current)) ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      result = { exists: false, value: undefined };
    } else {
      result = { exists: true, value: current[segment] };
    }
  }

  cache.set(pointer, result);
  return result;
}

function sourceExists(context, source) {
  if (source.file !== context.sourceFileRelative) {
    return false;
  }
  return resolveAuthoringPointer(context, source.pointer).exists;
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

  // Mechanics is intentionally not validated by the draft-07 manifest
  // registry. Validate its untouched source before generic prototype lowering
  // so authoring-only keys cannot be stripped before the closed 2020-12
  // contract sees them.
  if (job.kind === "game" && authoring._schemaVersion === "2.0") {
    assertMechanicsAuthoringContract(authoring.root.mechanics, job.sourceFile);
  }

  const compiledRoot = compileNode(authoring.root, createCompilerContext(job.sourceFile, authoring), "/root");
  const compiled = authoring._schemaVersion === "2.0"
    ? compileAuthoringV2(job, compiledRoot)
    : compiledRoot;
  assertNoAuthoringKeys(compiled.value, job.outputFile);

  // Mechanics uses JSON Schema 2020-12 and therefore must never be registered
  // in the draft-07 Ajv instance above. Structural validation runs first;
  // cross-reference/type/cost checks run only on a schema-valid tree.
  if (job.kind === "game" && authoring._schemaVersion === "2.0") {
    const mechanicsValidation = validateMechanicsSchema(compiled.value.mechanics);
    if (!mechanicsValidation.valid) {
      const first = mechanicsValidation.errors[0];
      throw new CompileError(
        `Mechanics schema validation failed: ${mechanicsValidation.errors
          .map((error) => `${error.pointer || "/"} ${error.message}`)
          .join("; ")}`,
        job.sourceFile,
        `/root/mechanics${first?.pointer || ""}`
      );
    }
    try {
      checkMechanicsBundle(compiled.value.mechanics, {
        actions: compiled.value.actions,
        parameterActions: compiled.value[PARAMETER_ACTIONS] || {},
        initialState: compiled.value.state,
        // A game author declares a reusable player template. Concrete
        // participant ids and the strict public turn structure are
        // materialized by runtime when the session is created.
        turnSessionInitialization: turnSessionInitializationForManifest(compiled.value),
        objectModels: compiled.value.objectModels,
        networkModels: compiled.value.networkModels
      });
    } catch (error) {
      if (error instanceof MechanicsSemanticError) {
        throw new CompileError(`Mechanics semantic validation failed: ${error.code}: ${error.message}`, job.sourceFile, `/root${error.pointer}`);
      }
      throw error;
    }
  }

  const runtimeValidation = validateRuntimeManifest(job, compiled.value, ajv);
  if (!runtimeValidation.valid) {
    const first = runtimeValidation.errors[0];
    throw new CompileError(
      `Compiled runtime manifest is invalid: ${runtimeValidation.errors
        .map((error) => `${error.pointer || "/"} ${error.message}`)
        .join("; ")}`,
      job.sourceFile,
      `/root${first?.pointer || ""}`
    );
  }

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

/**
 * Combines every compile-invariant input into one hash prefix, computed once:
 * the cache format version, the compiler's own source hash (so a compiler code
 * change invalidates the cache — otherwise the cache would mask the change and
 * break the drift-check), and the schema-set hash.
 */
let cachedKeyPrefix;
function getCacheKeyPrefix() {
  if (cachedKeyPrefix === undefined) {
    const compilerHash = hashText(fs.readFileSync(__filename, "utf8"));
    cachedKeyPrefix = hashText(
      [COMPILE_CACHE_FORMAT_VERSION, compilerHash, getSchemasHash()].join("\0")
    );
  }
  return cachedKeyPrefix;
}

/**
 * Cache key for one compile job: the invariant prefix plus the job identity
 * (kind + generated/source paths, which the output embeds) plus the hash of the
 * authoring text. Any input not folded in here would be a cache-design bug.
 */
function computeJobCacheKey(job, authoringText) {
  return hashText(
    [
      getCacheKeyPrefix(),
      job.kind,
      relativePath(job.sourceFile),
      relativePath(job.outputFile),
      relativePath(job.sourceMapFile),
      hashText(authoringText)
    ].join("\0")
  );
}

/**
 * Compiles authoring text through the level-3 cache when enabled: returns a
 * cached `{ manifest, sourceMap }` on a hit, otherwise compiles and repopulates.
 * `options.telemetry` (optional) records hit/miss counts and durations.
 * `options.cacheEnabled` overrides the default resolution (env / honest-check).
 */
function compileAuthoringTextCached(job, text, ajv = getSharedAjv(), options = {}) {
  const telemetry = options.telemetry;
  const cacheEnabled = options.cacheEnabled !== undefined
    ? options.cacheEnabled
    : resolveCompileCacheEnabled({});

  if (cacheEnabled) {
    const key = computeJobCacheKey(job, text);
    const readStart = process.hrtime.bigint();
    const cached = readCacheEntry(COMPILE_CACHE_DIR, key);
    if (cached !== null) {
      telemetry?.recordHit(Number(process.hrtime.bigint() - readStart) / 1e6);
      return cached;
    }
    const compileStart = process.hrtime.bigint();
    const output = compileAuthoringText(job, text, ajv);
    telemetry?.recordMiss(Number(process.hrtime.bigint() - compileStart) / 1e6);
    writeCacheEntry(COMPILE_CACHE_DIR, key, output);
    return output;
  }

  const compileStart = process.hrtime.bigint();
  const output = compileAuthoringText(job, text, ajv);
  telemetry?.recordMiss(Number(process.hrtime.bigint() - compileStart) / 1e6);
  return output;
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

/**
 * Enforces the only map-first relationship that draft-07 cannot express.
 *
 * JSON Schema remains the sole source of truth for the slot vocabulary, valid
 * component types and allowed tree positions. Draft-07 has `contains` but no
 * `maxContains`, so the schema can require at least one board zone but cannot
 * prove there is exactly one. This check only supplies that missing upper
 * bound while authoring pointers are still available for useful diagnostics.
 */
function assertUiAuthoringWorkspaceSemantics(root, sourceFile) {
  const screens = ensureArray(root.screens, sourceFile, "/root/screens", "UI v2 root.screens");

  screens.forEach((screen, screenIndex) => {
    const screenPointer = joinPointer("/root/screens", screenIndex);
    const screenObject = ensureObject(screen, sourceFile, screenPointer, "UI v2 screen");
    if (screenObject.layout_mode !== "map-first") {
      return;
    }

    const rootPointer = joinPointer(screenPointer, "root");
    const rootComponent = ensureObject(screenObject.root, sourceFile, rootPointer, "UI v2 screen root");
    const childrenPointer = joinPointer(rootPointer, "children");
    const zones = ensureArray(rootComponent.children, sourceFile, childrenPointer, "map-first screen root.children");
    const boardZones = zones.filter(
      (zone) => hasPlainObject(zone) && hasPlainObject(zone.props) && zone.props.workspaceSlot === "board"
    ).length;

    if (boardZones !== 1) {
      throw new CompileError(
        `A map-first screen requires exactly one direct board zone; found ${boardZones}`,
        sourceFile,
        childrenPointer
      );
    }
  });
}

function sourceFor(compiled, sourceFile, pointer) {
  return compiled.mappings[pointer] || [{ file: relativePath(sourceFile), pointer }];
}

function addRuntimeMapping(mappings, targetPointer, compiled, sourceFile, sourcePointer) {
  mappings[targetPointer] = sourceFor(compiled, sourceFile, sourcePointer);
}

// Per-compiled-document index used to copy a source-map subtree without
// rescanning every mapping key. Keyed by the compiled result object so it is
// built at most once per compile and garbage-collected with it.
const subtreeIndexCache = new WeakMap();

/**
 * Builds (once) the ordered key list and a pointer→position lookup for a
 * compiled document's mappings.
 *
 * WHY this is safe to exploit: compileNode emits mappings in depth-first order,
 * so every node's own pointer and all of its descendant pointers form one
 * *contiguous* run in Object.keys order (an object node sits first in its run,
 * an array node last, but the run is unbroken either way — no sibling subtree is
 * ever interleaved because each node has a unique pointer). That lets
 * copySubtreeMappings find a whole subtree by expanding outward from the
 * prefix's own position instead of filtering all keys.
 */
function getSubtreeIndex(compiled) {
  let index = subtreeIndexCache.get(compiled);
  if (index === undefined) {
    const orderedKeys = Object.keys(compiled.mappings);
    const positionByKey = new Map();
    for (let i = 0; i < orderedKeys.length; i += 1) {
      positionByKey.set(orderedKeys[i], i);
    }
    index = { orderedKeys, positionByKey };
    subtreeIndexCache.set(compiled, index);
  }
  return index;
}

function isInSubtree(pointer, prefix) {
  return pointer === prefix || pointer.startsWith(`${prefix}/`);
}

/**
 * Copies every source-map entry under `sourcePrefix` to `targetPrefix`,
 * preserving the original key order (so the serialized source map stays
 * byte-identical).
 *
 * WHY the rewrite: this used to scan *all* mapping keys on every call, and it is
 * called once per action / per screen. On antarctica that was 141 actions ×
 * ~9000 keys — the dominant, super-linear cost of the whole compile. Because a
 * subtree is a contiguous run in Object.keys order (see getSubtreeIndex), we
 * locate the prefix's own position and expand left/right only across its own
 * run, making each call proportional to the subtree it copies and the total
 * work linear in the number of mappings.
 */
function copySubtreeMappings(mappings, compiled, sourceFile, sourcePrefix, targetPrefix) {
  const { orderedKeys, positionByKey } = getSubtreeIndex(compiled);
  const anchor = positionByKey.get(sourcePrefix);

  // Fallback for the (unused by current callers) case where the exact prefix
  // pointer is not itself a mapping key: fall back to the exhaustive scan so
  // semantics never depend on the contiguity assumption.
  if (anchor === undefined) {
    for (const sourcePointer of orderedKeys) {
      if (!isInSubtree(sourcePointer, sourcePrefix)) {
        continue;
      }
      mappings[`${targetPrefix}${sourcePointer.slice(sourcePrefix.length)}`] = sourceFor(compiled, sourceFile, sourcePointer);
    }
    return;
  }

  // Expand outward from the prefix's own position to cover the contiguous run
  // of its subtree; the run includes the prefix regardless of whether it sits
  // first (object node) or last (array node) within it.
  let lo = anchor;
  while (lo > 0 && isInSubtree(orderedKeys[lo - 1], sourcePrefix)) {
    lo -= 1;
  }
  let hi = anchor;
  while (hi + 1 < orderedKeys.length && isInSubtree(orderedKeys[hi + 1], sourcePrefix)) {
    hi += 1;
  }

  for (let i = lo; i <= hi; i += 1) {
    const sourcePointer = orderedKeys[i];
    mappings[`${targetPrefix}${sourcePointer.slice(sourcePrefix.length)}`] = sourceFor(compiled, sourceFile, sourcePointer);
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

}

function isMacroInvocation(value) {
  return hasPlainObject(value) && value.kind === "macro";
}

function isMacroPlaceholder(value) {
  return hasPlainObject(value) &&
    Object.keys(value).length === 1 &&
    typeof value.$macroInput === "string";
}

/** Collect reserved placeholders together with their exact authoring pointer. */
function collectMacroPlaceholders(value, pointer, result = []) {
  if (isMacroPlaceholder(value)) {
    result.push({ name: value.$macroInput, pointer });
    return result;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => collectMacroPlaceholders(child, joinPointer(pointer, index), result));
  } else if (hasPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectMacroPlaceholders(child, joinPointer(pointer, key), result);
    }
  }
  return result;
}

/**
 * Validate definition-wide relationships that JSON Schema cannot express:
 * input use, unique local ids, known macro references and an acyclic call graph.
 */
function checkMacroDefinitions(macros, sourceFile) {
  const graph = new Map();
  for (const [macroName, definition] of Object.entries(macros)) {
    const macroPointer = joinPointer("/root/mechanics/macros", macroName);
    const inputNames = new Set(Object.keys(definition.inputs));
    const usedInputs = new Set();
    const localIds = new Set();
    const calls = [];
    definition.steps.forEach((step, index) => {
      const stepPointer = joinPointer(joinPointer(macroPointer, "steps"), index);
      if (localIds.has(step.id)) {
        throw new CompileError(`Macro "${macroName}" has duplicate local step id "${step.id}"`, sourceFile, joinPointer(stepPointer, "id"));
      }
      localIds.add(step.id);
      for (const placeholder of collectMacroPlaceholders(step, stepPointer)) {
        if (!inputNames.has(placeholder.name)) {
          throw new CompileError(
            `Macro "${macroName}" references unknown input "${placeholder.name}"`,
            sourceFile,
            placeholder.pointer
          );
        }
        usedInputs.add(placeholder.name);
      }
      if (isMacroInvocation(step)) {
        if (!Object.prototype.hasOwnProperty.call(macros, step.macro)) {
          throw new CompileError(`Macro "${macroName}" calls unknown macro "${step.macro}"`, sourceFile, joinPointer(stepPointer, "macro"));
        }
        calls.push(step.macro);
      }
    });
    for (const inputName of inputNames) {
      if (!usedInputs.has(inputName)) {
        throw new CompileError(
          `Macro "${macroName}" declares unused input "${inputName}"`,
          sourceFile,
          joinPointer(joinPointer(macroPointer, "inputs"), inputName)
        );
      }
    }
    graph.set(macroName, calls);
  }

  const visited = new Set();
  const visiting = new Set();
  function visit(macroName, stack) {
    if (visiting.has(macroName)) {
      throw new CompileError(
        `Recursive Mechanics macro call: ${[...stack, macroName].join(" -> ")}`,
        sourceFile,
        joinPointer("/root/mechanics/macros", macroName)
      );
    }
    if (visited.has(macroName)) return;
    visiting.add(macroName);
    for (const dependency of graph.get(macroName) || []) visit(dependency, [...stack, macroName]);
    visiting.delete(macroName);
    visited.add(macroName);
  }
  for (const macroName of Object.keys(macros)) visit(macroName, []);
}

function assertNoInvocationPlaceholders(args, sourceFile, pointer) {
  const placeholders = collectMacroPlaceholders(args, pointer);
  if (placeholders.length > 0) {
    throw new CompileError(
      "A $macroInput placeholder is allowed only inside a macro template",
      sourceFile,
      placeholders[0].pointer
    );
  }
}

function validateMacroInvocationArgs(invocation, definition, sourceFile, pointer) {
  const declarations = definition.inputs;
  for (const name of Object.keys(declarations)) {
    if (!Object.prototype.hasOwnProperty.call(invocation.args, name)) {
      throw new CompileError(`Macro "${invocation.macro}" is missing argument "${name}"`, sourceFile, joinPointer(pointer, "args"));
    }
  }
  for (const [name, value] of Object.entries(invocation.args)) {
    const declaration = declarations[name];
    const argumentPointer = joinPointer(joinPointer(pointer, "args"), name);
    if (!declaration) {
      throw new CompileError(`Macro "${invocation.macro}" received unknown argument "${name}"`, sourceFile, argumentPointer);
    }
    const validation = validateMacroInput(declaration.kind, value);
    if (!validation.valid) {
      throw new CompileError(
        `Macro "${invocation.macro}" argument "${name}" is not a valid ${declaration.kind}: ${validation.errors
          .map((error) => `${error.pointer || "/"} ${error.message}`)
          .join("; ")}`,
        sourceFile,
        argumentPointer
      );
    }
  }
}

function rewriteLocalResultId(stepId, localIds, prefix) {
  if (localIds.has(stepId)) return `${prefix}.${stepId}`;
  // A nested macro has no synthetic result of its own, but its expanded step
  // ids are addressable as `nestedInvocation.templateStep`.
  for (const localId of localIds) {
    if (stepId.startsWith(`${localId}.`)) return `${prefix}.${stepId}`;
  }
  return stepId;
}

/** Substitute structured JSON without reinterpreting placeholders inside args. */
function instantiateMacroValue(value, args, localIds, prefix) {
  if (isMacroPlaceholder(value)) return clone(args[value.$macroInput]);
  if (Array.isArray(value)) return value.map((child) => instantiateMacroValue(child, args, localIds, prefix));
  if (!hasPlainObject(value)) return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "stepId" && value.op === "value.result" && typeof child === "string") {
      result[key] = rewriteLocalResultId(child, localIds, prefix);
    } else {
      result[key] = instantiateMacroValue(child, args, localIds, prefix);
    }
  }
  return result;
}

function expandMacroInvocation(invocation, options) {
  const { macros, sourceFile, pointer, invocationOrigin, prefix, expansionBudget } = options;
  const definition = macros[invocation.macro];
  if (!definition) {
    throw new CompileError(`Unknown Mechanics macro "${invocation.macro}"`, sourceFile, joinPointer(pointer, "macro"));
  }
  validateMacroInvocationArgs(invocation, definition, sourceFile, pointer);
  const localIds = new Set(definition.steps.map((step) => step.id));
  const expanded = [];
  definition.steps.forEach((templateStep, index) => {
    const templatePointer = joinPointer(
      joinPointer(joinPointer("/root/mechanics/macros", invocation.macro), "steps"),
      index
    );
    const instantiated = instantiateMacroValue(templateStep, invocation.args, localIds, prefix);
    if (isMacroInvocation(instantiated)) {
      const nestedPrefix = `${prefix}.${instantiated.id}`;
      expanded.push(...expandMacroInvocation(instantiated, {
        macros,
        sourceFile,
        pointer: templatePointer,
        invocationOrigin,
        prefix: nestedPrefix,
        expansionBudget
      }));
      return;
    }
    expansionBudget.count += 1;
    if (expansionBudget.count > expansionBudget.max) {
      throw new CompileError(
        `Lowered plan "${expansionBudget.planId}" exceeds ${expansionBudget.max} steps`,
        sourceFile,
        templatePointer
      );
    }
    instantiated.id = `${prefix}.${templateStep.id}`;
    expanded.push({
      step: instantiated,
      sourcePointers: [invocationOrigin, templatePointer]
    });
  });
  return expanded;
}

/**
 * Lower authoring-only macros into final runtime steps and derive the exact
 * dependency-closed module lock from those final operations.
 */
function lowerMechanicsAuthoring(source, sourceFile) {
  assertMechanicsAuthoringContract(source, sourceFile);

  const macros = source.macros || {};
  checkMacroDefinitions(macros, sourceFile);
  const plans = {};
  const origins = {};
  const operations = [];
  for (const [planId, plan] of Object.entries(source.plans)) {
    const sourceSteps = plan.transaction.steps;
    const lowered = [];
    const expansionBudget = { count: 0, max: 512, planId };
    sourceSteps.forEach((step, index) => {
      const pointer = joinPointer(
        joinPointer(joinPointer(joinPointer("/root/mechanics/plans", planId), "transaction"), "steps"),
        index
      );
      if (isMacroInvocation(step)) {
        assertNoInvocationPlaceholders(step.args, sourceFile, joinPointer(pointer, "args"));
        lowered.push(...expandMacroInvocation(step, {
          macros,
          sourceFile,
          pointer,
          invocationOrigin: pointer,
          prefix: step.id,
          expansionBudget
        }));
      } else {
        expansionBudget.count += 1;
        lowered.push({ step: clone(step), sourcePointers: [pointer] });
      }
    });
    if (lowered.length > 512) {
      throw new CompileError(`Lowered plan "${planId}" exceeds 512 steps`, sourceFile, joinPointer("/root/mechanics/plans", planId));
    }
    const seen = new Set();
    lowered.forEach(({ step, sourcePointers }) => {
      if (seen.has(step.id)) {
        throw new CompileError(`Lowered plan "${planId}" has duplicate step id "${step.id}"`, sourceFile, joinPointer(sourcePointers[0], "id"));
      }
      seen.add(step.id);
      operations.push(step.op);
    });
    plans[planId] = { transaction: { steps: lowered.map((entry) => entry.step) } };
    origins[planId] = lowered.map((entry) => entry.sourcePointers);
  }

  let moduleLock;
  try {
    moduleLock = recommendedModuleLockForOperations(operations);
  } catch (error) {
    throw new CompileError(error.message, sourceFile, "/root/mechanics/plans");
  }
  return {
    mechanics: {
      apiVersion: source.apiVersion,
      budgetProfile: source.budgetProfile,
      moduleLock,
      stateModel: source.stateModel,
      plans
    },
    origins
  };
}

function deleteMappingSubtree(mappings, prefix) {
  for (const pointer of Object.keys(mappings)) {
    if (pointer === prefix || pointer.startsWith(`${prefix}/`)) delete mappings[pointer];
  }
}

function mapGeneratedSubtree(mappings, pointer, value, sources) {
  mappings[pointer] = uniqueSources(sources);
  if (Array.isArray(value)) {
    value.forEach((child, index) => mapGeneratedSubtree(mappings, joinPointer(pointer, index), child, sources));
  } else if (hasPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      mapGeneratedSubtree(mappings, joinPointer(pointer, key), child, sources);
    }
  }
}

function assertMechanicsAuthoringContract(source, sourceFile) {
  const schemaValidation = validateMechanicsAuthoringSchema(source);
  if (!schemaValidation.valid) {
    const first = schemaValidation.errors[0];
    throw new CompileError(
      `Mechanics authoring schema validation failed: ${schemaValidation.errors
        .map((error) => `${error.pointer || "/"} ${error.message}`)
        .join("; ")}`,
      sourceFile,
      `/root/mechanics${first?.pointer || ""}`
    );
  }
}

/**
 * Publish the authoring Mechanics tree as immutable runtime IR.
 *
 * Authors provide transactions, while the compiler owns every hash. A plan
 * hash includes its pinned language, budget, module and state-model context so
 * the same steps cannot be replayed under different platform semantics.
 */
function publishMechanics(manifest, mappings, compiledRoot, sourceFile) {
  const authoringSource = ensureObject(manifest.mechanics, sourceFile, "/root/mechanics", "game v2 root.mechanics");
  const lowered = lowerMechanicsAuthoring(authoringSource, sourceFile);
  const source = lowered.mechanics;
  deleteMappingSubtree(mappings, "/mechanics/macros");
  deleteMappingSubtree(mappings, "/mechanics/moduleLock");
  const mechanicsSources = sourceFor(compiledRoot, sourceFile, "/root/mechanics");
  mapGeneratedSubtree(mappings, "/mechanics/moduleLock", source.moduleLock, mechanicsSources);
  const plans = ensureObject(source.plans, sourceFile, "/root/mechanics/plans", "game v2 mechanics.plans");
  const publishedPlans = {};
  for (const [planId, rawPlan] of Object.entries(plans)) {
    const sourcePointer = joinPointer("/root/mechanics/plans", planId);
    const plan = ensureObject(rawPlan, sourceFile, sourcePointer, `mechanics plan "${planId}"`);
    if (Object.prototype.hasOwnProperty.call(plan, "planHash")) {
      throw new CompileError("planHash is compiler-owned and must not appear in authoring", sourceFile, joinPointer(sourcePointer, "planHash"));
    }
    const transaction = ensureObject(plan.transaction, sourceFile, joinPointer(sourcePointer, "transaction"), `mechanics plan "${planId}" transaction`);
    const stepsPointer = joinPointer(
      joinPointer(joinPointer("/mechanics/plans", planId), "transaction"),
      "steps"
    );
    deleteMappingSubtree(mappings, stepsPointer);
    mappings[stepsPointer] = sourceFor(
      compiledRoot,
      sourceFile,
      joinPointer(joinPointer(sourcePointer, "transaction"), "steps")
    );
    transaction.steps.forEach((step, index) => {
      const sources = uniqueSources(lowered.origins[planId][index].flatMap((pointer) =>
        sourceFor(compiledRoot, sourceFile, pointer)));
      mapGeneratedSubtree(mappings, joinPointer(stepsPointer, index), step, sources);
    });
    const planContext = {
      apiVersion: source.apiVersion,
      budgetProfile: source.budgetProfile,
      moduleLock: source.moduleLock,
      stateModel: source.stateModel,
      // Domain operations such as graph edits interpret their generic steps
      // through these published models. Pinning both maps prevents an
      // otherwise byte-identical plan from changing meaning after a model
      // declaration changes.
      objectModels: manifest.objectModels || {},
      networkModels: manifest.networkModels || {},
      planId,
      transaction
    };
    publishedPlans[planId] = {
      planHash: mechanicsSha256(planContext),
      transaction
    };
    mappings[joinPointer(joinPointer("/mechanics/plans", planId), "planHash")] = sourceFor(
      compiledRoot,
      sourceFile,
      sourcePointer
    );
  }
  manifest.mechanics = { ...source, plans: publishedPlans };

  const actions = ensureObject(manifest.actions, sourceFile, "/root/logic/actions", "compiled game actions");
  for (const [actionId, actionValue] of Object.entries(actions)) {
    const action = ensureObject(actionValue, sourceFile, joinPointer("/actions", actionId), `action "${actionId}"`);
    if (Object.prototype.hasOwnProperty.call(action, "definitionHash")) {
      throw new CompileError("definitionHash is compiler-owned and must not appear in authoring", sourceFile, joinPointer(joinPointer("/actions", actionId), "definitionHash"));
    }
    const planRef = hasPlainObject(action.binding) ? action.binding.planRef : undefined;
    const referencedPlan = typeof planRef === "string" ? publishedPlans[planRef] : undefined;
    if (!referencedPlan) {
      throw new CompileError(
        `Action "${actionId}" references unknown mechanics plan "${String(planRef)}"`,
        sourceFile,
        joinPointer(joinPointer("/actions", actionId), "binding")
      );
    }
    if (!Object.prototype.hasOwnProperty.call(action, "paramsSchema")) {
      // A canonical command always contains `params`. Materializing the
      // closed empty schema keeps JSON Schema—not an imperative runtime
      // convention—as the published source of truth for parameter shape.
      action.paramsSchema = {
        type: "object",
        additionalProperties: false,
        properties: {},
        required: []
      };
      mappings[joinPointer(joinPointer("/actions", actionId), "paramsSchema")] =
        mappings[joinPointer("/actions", actionId)] || sourceFor(compiledRoot, sourceFile, "/root/logic/actions");
    }
    if (!Object.prototype.hasOwnProperty.call(action, "invocation")) {
      // Invocation is part of the immutable definition identity. Normalize
      // before definitionHash so an omitted authoring default cannot become a
      // transport- or consumer-specific fallback.
      action.invocation = "external";
      mappings[joinPointer(joinPointer("/actions", actionId), "invocation")] =
        mappings[joinPointer("/actions", actionId)] || sourceFor(compiledRoot, sourceFile, "/root/logic/actions");
    }
    action.definitionHash = mechanicsSha256({
      apiVersion: source.apiVersion,
      actionId,
      definition: action,
      planHash: referencedPlan.planHash
    });
    mappings[joinPointer(joinPointer("/actions", actionId), "definitionHash")] =
      mappings[joinPointer("/actions", actionId)] || sourceFor(compiledRoot, sourceFile, "/root/logic/actions");
  }
}

/**
 * Prove that an AI-enabled game starts through the same published Game Intent
 * contract as every later player or model-selected action. This is a semantic
 * reference check, not a second shape validator: JSON Schema remains the SSOT
 * for the field and its non-empty string constraint.
 */
function assertAgentRuntimeInitialAction(manifest, sourceFile) {
  if (manifest.agentRuntime === undefined) return;
  const agentRuntime = ensureObject(
    manifest.agentRuntime,
    sourceFile,
    "/root/agentRuntime",
    "game v2 root.agentRuntime"
  );
  const actionId = agentRuntime.initialActionId;
  const actions = hasPlainObject(manifest.actions) ? manifest.actions : {};
  if (typeof actionId !== "string" || !Object.prototype.hasOwnProperty.call(actions, actionId)) {
    throw new CompileError(
      `agentRuntime.initialActionId references unknown published action "${String(actionId)}"`,
      sourceFile,
      "/root/agentRuntime/initialActionId"
    );
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

  publishMechanics(manifest, mappings, compiledRoot, sourceFile);
  const parameterActions = compilePendingParameterActions(logic.pendingActions, sourceFile);
  Object.defineProperty(manifest, PARAMETER_ACTIONS, {
    value: parameterActions,
    enumerable: false,
    configurable: false,
    writable: false
  });
  assertPublishedGameIntentContract(manifest.actions, sourceFile);
  assertAgentRuntimeInitialAction(manifest, sourceFile);

  return { value: manifest, mappings };
}

/**
 * Convert unpublished action entities into checker-only parameter contexts.
 * The 2020-12 Game Intent contract validates their complete public shape with
 * a compiler placeholder hash, while the non-enumerable carrier above proves
 * they cannot leak into the generated manifest.
 */
function compilePendingParameterActions(value, sourceFile) {
  if (value === undefined) return {};
  const actions = {};
  const items = ensureArray(value, sourceFile, "/root/logic/pendingActions", "game v2 root.logic.pendingActions");
  for (const [index, rawAction] of items.entries()) {
    const pointer = joinPointer("/root/logic/pendingActions", index);
    const action = ensureObject(rawAction, sourceFile, pointer, "pending game action");
    if (typeof action.id !== "string" || action.id.length === 0) {
      throw new CompileError("pending action requires a non-empty id", sourceFile, joinPointer(pointer, "id"));
    }
    if (Object.prototype.hasOwnProperty.call(actions, action.id)) {
      throw new CompileError(`Duplicate pending action id "${action.id}"`, sourceFile, joinPointer(pointer, "id"));
    }
    const { id, ...definition } = action;
    const normalized = {
      ...definition,
      invocation: definition.invocation || "external",
      paramsSchema: definition.paramsSchema || {
        type: "object",
        additionalProperties: false,
        properties: {},
        required: []
      }
    };
    const validation = validateGameIntentSchema({
      [id]: { ...normalized, definitionHash: `sha256:${"0".repeat(64)}` }
    });
    if (!validation.valid) {
      throw new CompileError(
        `Pending Game Intent validation failed: ${validation.errors
          .map((error) => `${error.pointer || "/"} ${error.message}`)
          .join("; ")}`,
        sourceFile,
        pointer
      );
    }
    actions[id] = normalized;
  }
  return actions;
}

/** Validate the compiler-owned action catalog in its isolated 2020-12 registry. */
function assertPublishedGameIntentContract(actions, sourceFile) {
  const validation = validateGameIntentSchema(actions);
  if (validation.valid) return;
  const first = validation.errors[0];
  throw new CompileError(
    `Published Game Intent validation failed: ${validation.errors
      .map((error) => `${error.pointer || "/"} ${error.message}`)
      .join("; ")}`,
    sourceFile,
    `/root/actions${first?.pointer || ""}`
  );
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
  assertUiAuthoringWorkspaceSemantics(root, sourceFile);
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

/**
 * Degree of parallelism for the compile pool. Default: min(jobCount, cores).
 * `CUBICA_COMPILE_CONCURRENCY` overrides it; =1 forces the inline sequential
 * path, which must behave identically to the pool (profiling-baseline §9.6).
 */
function resolveConcurrency(jobCount) {
  const env = process.env.CUBICA_COMPILE_CONCURRENCY;
  if (env !== undefined && env !== "") {
    const parsed = Number.parseInt(env, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.min(parsed, Math.max(1, jobCount));
    }
  }
  const cores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(cores, Math.max(1, jobCount)));
}

/** Rebuilds a CompileError (or plain Error) from a worker's serialized error. */
function restoreWorkerError(serialized) {
  if (serialized.name === "CompileError" && typeof serialized.rawMessage === "string") {
    return new CompileError(serialized.rawMessage, serialized.filePath, serialized.pointer);
  }
  return new Error(serialized.message);
}

/**
 * Runs compile tasks on a pool of worker threads and resolves with a
 * Map<taskIndex, workerResult>. Each worker handles one task at a time and pulls
 * the next when done (simple work queue). Results carry their taskIndex, so the
 * caller re-applies side effects in deterministic job order regardless of which
 * worker finished first.
 */
function compileTasksInPool(tasks, concurrency) {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, "compile-worker.cjs");
    const results = new Map();
    const workers = [];
    let next = 0;
    let completed = 0;
    let settled = false;

    const dispatch = (worker) => {
      if (next >= tasks.length) {
        return;
      }
      const task = tasks[next];
      next += 1;
      worker.postMessage({ type: "compile", taskIndex: task.taskIndex, job: task.job, text: task.text });
    };

    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      for (const worker of workers) {
        worker.terminate();
      }
      reject(error);
    };

    const workerCount = Math.max(1, Math.min(concurrency, tasks.length));
    for (let i = 0; i < workerCount; i += 1) {
      const worker = new Worker(workerPath);
      workers.push(worker);
      worker.on("message", (message) => {
        if (settled) {
          return;
        }
        results.set(message.taskIndex, message);
        completed += 1;
        if (completed === tasks.length) {
          settled = true;
          // Ask workers to close their ports so their threads exit cleanly.
          for (const idle of workers) {
            idle.postMessage({ type: "shutdown" });
          }
          resolve(results);
          return;
        }
        dispatch(worker);
      });
      worker.on("error", fail);
    }

    for (const worker of workers) {
      dispatch(worker);
    }
  });
}

async function compileJobs(options = {}) {
  const jobs = discoverJobs(options);
  const cacheEnabled = resolveCompileCacheEnabled({ check: Boolean(options.check) });
  const telemetry = createCompileTelemetry();
  const stale = [];
  const results = [];

  if (jobs.length === 0) {
    return { jobs, results, stale, telemetry: { ...telemetry.snapshot(), cacheEnabled, concurrency: 0 } };
  }

  const sharedAjv = getSharedAjv();
  const concurrency = resolveConcurrency(jobs.length);

  // Phase 1 (main thread, deterministic): read authoring text and probe the
  // cache. A hit resolves the output immediately; misses are queued for compile.
  const prepared = jobs.map((job) => {
    const text = fs.readFileSync(job.sourceFile, "utf8");
    const entry = { job, text, key: null, output: undefined, fromCache: false };
    if (cacheEnabled) {
      entry.key = computeJobCacheKey(job, text);
      const readStart = process.hrtime.bigint();
      const cached = readCacheEntry(COMPILE_CACHE_DIR, entry.key);
      if (cached !== null) {
        telemetry.recordHit(Number(process.hrtime.bigint() - readStart) / 1e6);
        entry.output = cached;
        entry.fromCache = true;
      }
    }
    return entry;
  });

  // Phase 2: compile the misses — on the worker pool when concurrency > 1,
  // inline otherwise. Both paths produce identical outputs; only ordering of
  // side effects (phase 3) is what makes output byte-identical, and that is
  // always driven by job order on the main thread.
  const missTasks = [];
  prepared.forEach((entry, index) => {
    if (!entry.fromCache) {
      missTasks.push({ taskIndex: index, job: entry.job, text: entry.text });
    }
  });

  if (missTasks.length > 0 && concurrency > 1) {
    const poolResults = await compileTasksInPool(missTasks, concurrency);
    for (const task of missTasks) {
      const message = poolResults.get(task.taskIndex);
      if (message === undefined) {
        throw new Error(`Compile worker returned no result for ${relativePath(task.job.sourceFile)}`);
      }
      if (!message.ok) {
        throw restoreWorkerError(message.error);
      }
      prepared[task.taskIndex].output = message.output;
      telemetry.recordMiss(message.compileMs);
    }
  } else {
    for (const task of missTasks) {
      const compileStart = process.hrtime.bigint();
      const output = compileAuthoringText(task.job, task.text, sharedAjv);
      telemetry.recordMiss(Number(process.hrtime.bigint() - compileStart) / 1e6);
      prepared[task.taskIndex].output = output;
    }
  }

  // Phase 3 (main thread, in job order): write/compare, populate cache, log.
  for (const entry of prepared) {
    const { job, output, key, fromCache } = entry;
    if (options.check) {
      const manifestDiff = compareGenerated(job.outputFile, output.manifest);
      const sourceMapDiff = compareGenerated(job.sourceMapFile, output.sourceMap);
      if (manifestDiff) stale.push(manifestDiff);
      if (sourceMapDiff) stale.push(sourceMapDiff);
    } else {
      writeJson(job.outputFile, output.manifest);
      writeJson(job.sourceMapFile, output.sourceMap);
    }
    if (cacheEnabled && key !== null && !fromCache) {
      writeCacheEntry(COMPILE_CACHE_DIR, key, output);
    }
    results.push({ job, output });
    if (!options.quiet) {
      const action = options.check ? "checked" : "compiled";
      console.log(`${action} ${relativePath(job.sourceFile)} -> ${relativePath(job.outputFile)}`);
    }
  }

  return { jobs, results, stale, telemetry: { ...telemetry.snapshot(), cacheEnabled, concurrency } };
}

async function run(options = {}) {
  const result = await compileJobs(options);

  if (result.jobs.length === 0) {
    if (!options.quiet) {
      console.log("compile-authoring-manifests: no authoring manifests found");
    }
    return result;
  }

  if (result.stale.length > 0) {
    throw new Error(`Authoring/generated drift detected:\n- ${result.stale.join("\n- ")}`);
  }

  if (!options.quiet) {
    const t = result.telemetry;
    console.log(
      `compile cache: ${t.cacheEnabled ? "on" : "off"} — ` +
        `${t.cacheHits} hit / ${t.cacheMisses} miss ` +
        `(read ${t.hitReadMs.toFixed(1)} ms, compile ${t.missCompileMs.toFixed(1)} ms), ` +
        `concurrency ${t.concurrency}`
    );
  }

  return result;
}

async function runCli(argv = process.argv) {
  return run(parseArgs(argv));
}

module.exports = {
  CompileError,
  buildAjv,
  getSharedAjv,
  lowerMechanicsAuthoring,
  compileAuthoringFile,
  compileAuthoringText,
  compileAuthoringTextCached,
  compileJobs,
  compareGenerated,
  createCompileTelemetry,
  computeJobCacheKey,
  discoverJobs,
  formatErrors,
  normalizeRuntimePointers,
  parseArgs,
  publishMechanics,
  relativePath,
  resolveConcurrency,
  run,
  runCli,
  schemaIdForRuntimeJob,
  validateRuntimeManifest
};
