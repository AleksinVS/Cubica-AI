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
const {
  EXECUTION_CORPUS_HASH,
  SHARED_KERNEL_HASH,
  recommendedModuleLockForOperations
} = require("./mechanics-modules.cjs");
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

/**
 * Returns the JSON Pointer one level up from `pointer`, or `undefined` once
 * `pointer` is already the document root (`""`).
 *
 * This is a deliberate, self-contained port of the identically-named helper
 * in the two editor-web consumers that read a compiled source map
 * (`apps/editor-web/src/lib/preview-message-adapter.ts` and
 * `apps/editor-web/src/lib/compiler-workflow.ts`, both function
 * `mapGeneratedPointerToAuthoring`). Every place in this file that writes into
 * a mappings object now records an entry only when it differs from what this
 * exact upward walk would already find at an ancestor pointer — see
 * `recordMapping` below — so the walk here MUST match those two consumers
 * exactly, or "collapsing" would silently change an answer a consumer gives.
 */
function parentPointer(pointer) {
  if (pointer === "") {
    return undefined;
  }
  const lastSlashIndex = pointer.lastIndexOf("/");
  return lastSlashIndex <= 0 ? "" : pointer.slice(0, lastSlashIndex);
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

/**
 * Order-sensitive deep equality of two source lists (arrays of {file, pointer}).
 *
 * Used to decide whether a node's mapping entry is redundant: if this node's
 * sources are exactly the sources its nearest recorded ancestor already
 * carries, a consumer walking up from this node's pointer would land on the
 * ancestor and read the identical list anyway (see `mapGeneratedPointerToAuthoring`
 * in the two editor-web consumers). Comparing the whole list rather than just
 * its first element is the conservative choice: both consumers currently only
 * read `sources[0]`, but comparing the full list means this rule stays correct
 * even if a future consumer inspects the rest of the array.
 */
function sourcesEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].file !== b[i].file || a[i].pointer !== b[i].pointer) {
      return false;
    }
  }
  return true;
}

/**
 * Second collapse case: a node's source is not byte-identical to its nearest
 * recorded ancestor's (see `sourcesEqual`), but it is *reconstructible* from
 * it, because the ancestor's subtree was copied through verbatim — the
 * child's authoring pointer is exactly the ancestor's authoring pointer with
 * the same relative path the child has below the ancestor in the generated
 * (runtime) tree. This is exactly what happens whenever `deriveChildSources`
 * takes its "concrete pointer exists" branch all the way down a plain,
 * `_type`-free literal subtree (e.g. a region's polygon vertices): every
 * level extends both the generated pointer and the authoring pointer by the
 * identical key/index, so the two never drift apart. It requires a SINGLE
 * unambiguous source at both ends — with more than one candidate source there
 * is no one pointer to reconstruct from, so this only ever fires past a
 * genuinely single-sourced ancestor.
 *
 * This is a distinct case from `sourcesEqual` and must be marked separately
 * (see `verbatimSubtrees` in the source map): an identical source means "the
 * child's source *is* the ancestor's pointer" (appending anything would
 * fabricate a pointer that does not exist), while a positional match means
 * "append the remaining generated-pointer suffix to the ancestor's authoring
 * pointer to get the child's exact source". Confusing the two would produce a
 * wrong reconstructed pointer, not merely a less precise one.
 */
function isPositionalMatch(sources, pointer, ancestorPointer, ancestorSources) {
  if (ancestorPointer === undefined || sources.length !== 1 || ancestorSources.length !== 1) {
    return false;
  }
  const expectedPointer = ancestorSources[0].pointer + pointer.slice(ancestorPointer.length);
  return sources[0].file === ancestorSources[0].file && sources[0].pointer === expectedPointer;
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

/**
 * Compiles one authoring node into its runtime value plus a source-map
 * fragment, recursing into children.
 *
 * `ancestorSources` is the source list a consumer would already find by
 * walking up from this node's pointer to the nearest pointer this function
 * (or one of its recursive calls) actually recorded, and `ancestorPointer` is
 * that same recorded pointer itself (needed for the positional check below).
 * Both are `undefined` only at the very first call, where there is no
 * ancestor yet. Before the first collapse rule existed, every single node —
 * every array element, every scalar, every coordinate — got its own mappings
 * entry, even when it was byte-identical to what the node's parent already
 * said. Measured on a real game (see the compiler's accompanying task notes)
 * 70% of entries were exactly that: pure repetition carrying no information,
 * because both source-map consumers already walk upward to the nearest
 * recorded ancestor when a pointer has no exact entry
 * (`mapGeneratedPointerToAuthoring` in
 * apps/editor-web/src/lib/preview-message-adapter.ts and in
 * apps/editor-web/src/lib/compiler-workflow.ts).
 *
 * Two independent reasons can make a node's own entry redundant, and this
 * function checks both before deciding to record anything:
 *   1. `sourcesEqual` — this node's source is byte-identical to the nearest
 *      recorded ancestor's. Omitting it can never change what a consumer
 *      resolves, because the walk would find the identical value one level up.
 *   2. `isPositionalMatch` — this node's source is not identical, but it is
 *      reconstructible: the ancestor's subtree is being copied through
 *      verbatim (e.g. thousands of polygon vertices with no `_type` merge
 *      anywhere in between), so the child's authoring pointer is exactly the
 *      ancestor's authoring pointer plus the same relative path the child has
 *      below the ancestor in the generated tree. Every pointer where this
 *      fires is recorded in `verbatimAnchors` (keyed by the ancestor's own
 *      pointer) so the source map can tell a consumer it is safe to
 *      reconstruct rather than merely fall back to the ancestor's own pointer.
 * Either way, this check happens inline, during construction, specifically so
 * a wide, deep authoring document never has to materialize a dense map before
 * being collapsed — the redundant entries are never created.
 */
function compileNode(node, context, pointer, inheritedSources = [], ancestorSources = undefined, ancestorPointer = undefined) {
  const sourceFile = context.sourceFile;
  if (Array.isArray(node)) {
    const ownSources = inheritedSources.length > 0 ? inheritedSources : [{ file: relativePath(sourceFile), pointer }];
    const identicalMatch = ancestorSources !== undefined && sourcesEqual(ownSources, ancestorSources);
    const positionalMatch = !identicalMatch && isPositionalMatch(ownSources, pointer, ancestorPointer, ancestorSources);
    const recordOwn = ancestorSources === undefined || (!identicalMatch && !positionalMatch);
    const childAncestorSources = recordOwn ? ownSources : ancestorSources;
    const childAncestorPointer = recordOwn ? pointer : ancestorPointer;
    const values = [];
    const mappings = {};
    const verbatimAnchors = new Set();
    if (positionalMatch) {
      verbatimAnchors.add(ancestorPointer);
    }
    node.forEach((item, index) => {
      const childSources = deriveChildSources(inheritedSources, index, context);
      const child = compileNode(item, context, joinPointer(pointer, index), childSources, childAncestorSources, childAncestorPointer);
      values.push(child.value);
      Object.assign(mappings, child.mappings);
      for (const anchor of child.verbatimAnchors) {
        verbatimAnchors.add(anchor);
      }
    });
    // Written after the children (same order as before this change) so an
    // array node's own key still sits last in its subtree's contiguous run —
    // see getSubtreeIndex's docstring for why that ordering matters.
    if (recordOwn) {
      mappings[pointer] = ownSources;
    }
    return { value: values, mappings, verbatimAnchors };
  }

  if (!hasPlainObject(node)) {
    const ownSources = inheritedSources.length > 0 ? inheritedSources : [{ file: relativePath(sourceFile), pointer }];
    const identicalMatch = ancestorSources !== undefined && sourcesEqual(ownSources, ancestorSources);
    const positionalMatch = !identicalMatch && isPositionalMatch(ownSources, pointer, ancestorPointer, ancestorSources);
    const recordOwn = ancestorSources === undefined || (!identicalMatch && !positionalMatch);
    const verbatimAnchors = positionalMatch ? new Set([ancestorPointer]) : new Set();
    return {
      value: node,
      mappings: recordOwn ? { [pointer]: ownSources } : {},
      verbatimAnchors
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

  const identicalMatch = ancestorSources !== undefined && sourcesEqual(sources, ancestorSources);
  const positionalMatch = !identicalMatch && isPositionalMatch(sources, pointer, ancestorPointer, ancestorSources);
  const recordOwn = ancestorSources === undefined || (!identicalMatch && !positionalMatch);
  const childAncestorSources = recordOwn ? sources : ancestorSources;
  const childAncestorPointer = recordOwn ? pointer : ancestorPointer;

  const result = {};
  // Written before the children (same order as before this change) so an
  // object node's own key still sits first in its subtree's contiguous run.
  const mappings = recordOwn ? { [pointer]: sources } : {};
  const verbatimAnchors = positionalMatch ? new Set([ancestorPointer]) : new Set();
  for (const [key, value] of Object.entries(working)) {
    const childPointer = joinPointer(pointer, key);
    const childSources = deriveChildSources(sources, key, context);
    const child = compileNode(value, context, childPointer, childSources, childAncestorSources, childAncestorPointer);
    result[key] = child.value;
    Object.assign(mappings, child.mappings);
    for (const anchor of child.verbatimAnchors) {
      verbatimAnchors.add(anchor);
    }
  }

  return { value: result, mappings, verbatimAnchors };
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
    mappings: normalizeRuntimePointers(compiled.mappings),
    // Additive field (see isPositionalMatch): pointers whose entire subtree
    // was omitted because it is a verbatim, position-for-position copy of an
    // ancestor's authoring subtree. A consumer that does not read this field
    // still gets a correct (only less precise) answer by walking up to the
    // ancestor as before; a consumer that reads it can append the remaining
    // generated-pointer path to the ancestor's source pointer and recover the
    // exact one.
    verbatimSubtrees: normalizeVerbatimSubtrees(compiled.verbatimAnchors)
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
 * Produces the invariant part of a compile-cache key from explicit inputs.
 *
 * Keeping this operation pure lets the focused regression test prove that both
 * trusted Mechanics corpus fingerprints independently invalidate the cache,
 * without rewriting runtime sources or relying on Node's module cache.
 */
function computeCacheKeyPrefix({
  formatVersion,
  compilerHash,
  schemasHash,
  sharedKernelHash,
  executionCorpusHash
}) {
  return hashText(
    [
      formatVersion,
      compilerHash,
      schemasHash,
      sharedKernelHash,
      executionCorpusHash
    ].join("\0")
  );
}

/**
 * Combines every compile-invariant input into one cached hash prefix.
 *
 * The compiler emits exact Mechanics module locks. Those locks depend not only
 * on this compiler and its schemas, but also on the complete trusted runtime
 * corpus hashed by `mechanics-modules.cjs`. Omitting that transitive input lets
 * a warm compile cache restore an old lock after runtime code changes, while an
 * honest `--check` compile correctly reports drift. Including both corpus
 * fingerprints keeps the cache a pure optimization rather than a competing
 * source of generated manifests.
 */
let cachedKeyPrefix;
function getCacheKeyPrefix() {
  if (cachedKeyPrefix === undefined) {
    const compilerHash = hashText(fs.readFileSync(__filename, "utf8"));
    cachedKeyPrefix = computeCacheKeyPrefix({
      formatVersion: COMPILE_CACHE_FORMAT_VERSION,
      compilerHash,
      schemasHash: getSchemasHash(),
      sharedKernelHash: SHARED_KERNEL_HASH,
      executionCorpusHash: EXECUTION_CORPUS_HASH
    });
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

/**
 * Renames one v1 (non-2.0) pointer from compileNode's internal "/root/..."
 * space to the runtime "" / "/..." space the source map publishes. Shared by
 * `normalizeRuntimePointers` (mapping keys) and `normalizeVerbatimSubtrees`
 * (verbatim-anchor pointers) so both apply the identical rename.
 */
function normalizeRuntimePointer(pointer) {
  if (pointer === "/root") {
    return "";
  }
  if (pointer.startsWith("/root/")) {
    return pointer.slice("/root".length);
  }
  return pointer;
}

/**
 * Renames v1 (non-2.0) pointers from compileNode's internal "/root/..." space
 * to the runtime "" / "/..." space the source map publishes.
 *
 * This is a pure, bijective rename (it does not add, drop, or merge entries),
 * so it needs no collapsing logic of its own: the rule compileNode already
 * applied — record a pointer only if it differs from its nearest recorded
 * ancestor — is defined purely in terms of JSON Pointer parent/child
 * structure, and stripping a shared "/root" prefix from every key preserves
 * that structure exactly (parent("/root/x") = "/root" renames to
 * parent("/x") = "", consistently). "/root" is always a key here (compileNode
 * always records the very first node it compiles), so "" is always present
 * after this rename, satisfying the same "root always resolvable" guarantee.
 */
function normalizeRuntimePointers(mappings) {
  const normalized = {};
  for (const [pointer, sources] of Object.entries(mappings)) {
    normalized[normalizeRuntimePointer(pointer)] = sources;
  }
  return normalized;
}

/**
 * Renames and sorts a set of "verbatim subtree" anchor pointers (see
 * `isPositionalMatch`) for publication in the source map. For a v2 document
 * these pointers are already in runtime space (built up by
 * `compileGameAuthoringV2` / `compileUiAuthoringV2` copying compileNode's own
 * anchors across via `copySubtreeMappings`), so `normalizeRuntimePointer` is a
 * no-op for them; for a v1 document it strips the same "/root" prefix
 * `normalizeRuntimePointers` strips from `mappings`. Sorted so the published
 * file is deterministic and diff-friendly, matching the worked example in the
 * task that introduced this field.
 */
function normalizeVerbatimSubtrees(anchors) {
  return Array.from(anchors, normalizeRuntimePointer).sort();
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

/**
 * Walks up from `pointer` to the nearest ancestor pointer that actually has a
 * mappings entry — the same walk `compileNode` used to decide what was safe
 * to omit while building this very map, and the same walk performed by
 * `mapGeneratedPointerToAuthoring` in
 * apps/editor-web/src/lib/preview-message-adapter.ts and
 * apps/editor-web/src/lib/compiler-workflow.ts. Returns `undefined` if no
 * ancestor (including the root) has an entry, otherwise `{ pointer, sources }`
 * — the ancestor's own pointer is returned alongside its sources because
 * `sourceFor` needs it to tell an identical-match ancestor (rule 1: return its
 * sources as-is) from a verbatim-subtree ancestor (rule 2: reconstruct the
 * exact pointer — see `isPositionalMatch`).
 */
function resolveViaAncestor(mappings, pointer) {
  let current = pointer;
  for (;;) {
    const sources = mappings[current];
    if (sources !== undefined) {
      return { pointer: current, sources };
    }
    const parent = parentPointer(current);
    if (parent === undefined) {
      return undefined;
    }
    current = parent;
  }
}

/**
 * Looks up the exact source for `pointer` inside one authoring document's own
 * compiled map (`compiled.mappings` plus `compiled.verbatimAnchors`, still in
 * `/root/...` pointer space), and reports whether that exact source is itself
 * safe to reuse as a *new* positional anchor for pointers strictly below it.
 *
 * A direct `compiled.mappings[pointer]` read would silently return the wrong
 * (too-specific, stale) fallback for any pointer whose entry was omitted as
 * redundant, because `compileNode` now omits an entry for either of two
 * reasons (see its docstring):
 *   - rule 1, byte-identical: the ancestor's own sources ARE the answer,
 *     unchanged. Nothing may be appended — this node has no evidence that
 *     *its* descendants follow any particular pattern relative to it, because
 *     "identical" only proves this one node's value, not its children's (a
 *     `_type` default with no override anywhere below it stays byte-identical
 *     to the same distant ancestor at every depth, not merely at this one).
 *   - rule 2, verbatim positional (`compiled.verbatimAnchors` names exactly
 *     which found ancestors this applies to): the remaining pointer suffix is
 *     appended to reconstruct the exact source, and — because that same
 *     suffix-appending relationship provably continues below `pointer` too
 *     (it is the same base anchor, just a longer suffix) — the result is
 *     itself `verbatim: true` and may be used as a new anchor further down.
 * Confusing the two would fabricate a pointer that does not exist for rule-1
 * subtrees, which is exactly why `copySubtreeMappings` (the only caller that
 * needs the `verbatim` flag) must not treat a rule-1 reconstruction as a new
 * anchor. The `{file, pointer}` fallback only fires for a pointer genuinely
 * outside anything `compileNode` ever produced (defensive; `/root` itself is
 * always recorded, so real callers always resolve through the walk).
 */
function reconstructSource(compiled, sourceFile, pointer) {
  const found = resolveViaAncestor(compiled.mappings, pointer);
  if (found === undefined) {
    return { sources: [{ file: relativePath(sourceFile), pointer }], verbatim: false };
  }

  const anchorIsVerbatim = found.sources.length === 1 &&
    compiled.verbatimAnchors !== undefined &&
    compiled.verbatimAnchors.has(found.pointer);

  if (found.pointer === pointer) {
    // Exact hit: `pointer`'s own recorded sources are the answer unchanged.
    // It only doubles as a new anchor for `pointer`'s own descendants when
    // compileNode itself already marked `pointer` as a verbatim anchor.
    return { sources: found.sources, verbatim: anchorIsVerbatim };
  }

  if (anchorIsVerbatim) {
    return {
      sources: [{
        file: found.sources[0].file,
        pointer: found.sources[0].pointer + pointer.slice(found.pointer.length)
      }],
      verbatim: true
    };
  }

  // Rule-1 identical match: the ancestor's raw sources ARE the answer for
  // `pointer` too, but appending anything further would fabricate a pointer
  // that does not exist — not usable as a new anchor for descendants.
  return { sources: found.sources, verbatim: false };
}

function sourceFor(compiled, sourceFile, pointer) {
  return reconstructSource(compiled, sourceFile, pointer).sources;
}

/**
 * Writes `mappings[pointer] = sources`, but only when that differs from what
 * `resolveViaAncestor` would already return for `pointer` from an ancestor.
 * Every runtime-field builder below (object models, actions, screens,
 * mechanics publication) funnels its writes through this one function so the
 * whole v2 runtime mapping — not just the per-authoring-document map built by
 * compileNode — applies the identical "omit only if a consumer's upward walk
 * already finds the same answer" rule. `pointer === ""` (the manifest root)
 * has no parent, so it is always recorded — the walk always has somewhere to
 * terminate. (This only applies the byte-identical rule, not the verbatim
 * positional one — see `copySubtreeMappings` for where a copy's own re-anchor
 * point is explicitly materialized instead.)
 */
function recordMapping(mappings, pointer, sources) {
  const parent = parentPointer(pointer);
  const found = parent === undefined ? undefined : resolveViaAncestor(mappings, parent);
  if (found === undefined || !sourcesEqual(sources, found.sources)) {
    mappings[pointer] = sources;
  }
}

/** Unwraps `resolveViaAncestor`'s `{pointer, sources}` result down to just the
 * sources array (or `undefined` if nothing was found), for callers that only
 * need "whatever an ancestor already says" and not the ancestor's own pointer. */
function ancestorSourcesFor(mappings, pointer) {
  const found = resolveViaAncestor(mappings, pointer);
  return found === undefined ? undefined : found.sources;
}

function addRuntimeMapping(mappings, targetPointer, compiled, sourceFile, sourcePointer) {
  recordMapping(mappings, targetPointer, sourceFor(compiled, sourceFile, sourcePointer));
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
 * byte-identical), and carries over any `verbatimSubtrees` anchor
 * (`compiled.verbatimAnchors`, see `isPositionalMatch`) that falls in the same
 * subtree, rewritten under `targetPrefix` the same way.
 *
 * WHY the rewrite: this used to scan *all* mapping keys on every call, and it is
 * called once per action / per screen. On antarctica that was 141 actions ×
 * ~9000 keys — the dominant, super-linear cost of the whole compile. Because a
 * subtree is a contiguous run in Object.keys order (see getSubtreeIndex), we
 * locate the prefix's own position and expand left/right only across its own
 * run, making each call proportional to the subtree it copies and the total
 * work linear in the number of mappings.
 *
 * WHY carrying anchors over is safe without re-deriving them: an anchor A
 * under `sourcePrefix` means every un-recorded descendant of A reconstructs
 * as A's source pointer plus the descendant's own relative path below A. That
 * relative path is exactly what this function preserves for every recorded
 * key (`targetPrefix + sourcePointer.slice(sourcePrefix.length)`), and
 * `sourceFor` returns the identical {file, pointer} regardless of where the
 * copy lands — so the same reconstruction is valid at A's new, copied
 * location without re-checking `isPositionalMatch` against anything.
 *
 * WHY `sourcePrefix` itself is always materialized when it has no exact
 * entry: this function's own sourcePrefix -> targetPrefix rename is *not*
 * positional in general (an action's authoring array index becomes its
 * runtime id; a screen's array index becomes its screen id), so it is exactly
 * the kind of "something between them broke the pattern" `isPositionalMatch`
 * warns about. If a whole verbatim-copied subtree sits above `sourcePrefix`
 * (nothing recorded at or below it — see the cards-money-trains "roughly one
 * entry for 79,549 vertices" case), the copy loop below would otherwise find
 * zero keys and copy nothing, silently losing every pointer under this
 * subtree to an outer ancestor two renames removed. Recording `targetPrefix`
 * itself (via `reconstructSource`, the same verbatim-aware lookup `sourceFor`
 * uses) re-establishes a correct, exact anchor at the new boundary — and
 * `targetPrefix` is only re-published as a *new* verbatim anchor when that
 * lookup reports `verbatim: true` (a rule-2 reconstruction), never for a
 * rule-1 identical match, so descendants below `targetPrefix` only keep
 * reconstructing positionally past the rename when doing so is still sound.
 */
function copySubtreeMappings(mappings, compiled, sourceFile, sourcePrefix, targetPrefix, verbatimAnchors) {
  const { orderedKeys, positionByKey } = getSubtreeIndex(compiled);
  const anchor = positionByKey.get(sourcePrefix);

  // Fallback for the case where the exact prefix pointer is not itself a
  // mapping key. Before collapsing this was rare (every node had an entry);
  // now that compileNode omits a node's entry whenever it repeats its nearest
  // recorded ancestor, `sourcePrefix` (e.g. one action's own pointer) very
  // often has no exact entry, so this branch is the common case, not a rare
  // one — but it stays correct either way, since it never relied on the
  // contiguity assumption in the first place.
  if (anchor === undefined) {
    const { sources: ownSources, verbatim } = reconstructSource(compiled, sourceFile, sourcePrefix);
    recordMapping(mappings, targetPrefix, ownSources);
    if (verbatimAnchors !== undefined && verbatim) {
      verbatimAnchors.add(targetPrefix);
    }
    for (const sourcePointer of orderedKeys) {
      if (!isInSubtree(sourcePointer, sourcePrefix)) {
        continue;
      }
      recordMapping(mappings, `${targetPrefix}${sourcePointer.slice(sourcePrefix.length)}`, sourceFor(compiled, sourceFile, sourcePointer));
    }
  } else {
    // Expand outward from the prefix's own position to cover the contiguous run
    // of its subtree; the run includes the prefix regardless of whether it sits
    // first (object node) or last (array node) within it. Contiguity survives
    // collapsing (see compileNode's docstring): omitting some entries never
    // moves the ones that remain relative to sibling subtrees.
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
      recordMapping(mappings, `${targetPrefix}${sourcePointer.slice(sourcePrefix.length)}`, sourceFor(compiled, sourceFile, sourcePointer));
    }
  }

  if (verbatimAnchors !== undefined) {
    for (const sourceAnchor of compiled.verbatimAnchors) {
      if (isInSubtree(sourceAnchor, sourcePrefix)) {
        verbatimAnchors.add(`${targetPrefix}${sourceAnchor.slice(sourcePrefix.length)}`);
      }
    }
  }
}

function copyIfPresent(target, mappings, compiled, sourceFile, source, key, verbatimAnchors) {
  if (Object.prototype.hasOwnProperty.call(source, key)) {
    target[key] = source[key];
    copySubtreeMappings(mappings, compiled, sourceFile, joinPointer("/root", key), joinPointer("", key), verbatimAnchors);
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

function appendGameLogicRuntimeFields(manifest, mappings, compiledRoot, sourceFile, logic, verbatimAnchors) {
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
      copySubtreeMappings(mappings, compiledRoot, sourceFile, actionPointer, joinPointer("/actions", actionObject.id), verbatimAnchors);
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
      collectLoweredMechanicsOperations(step, operations);
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

/**
 * Include bounded-body operations in the exact module lock.
 *
 * `core.entities.each` remains one authored top-level step, but its body is
 * executable Mechanics IR and may use modules beyond `cubica.core`. Ignoring
 * those operations here would produce a package that passes structural
 * lowering yet fails closed at publication/runtime.
 */
function collectLoweredMechanicsOperations(step, operations) {
  operations.push(step.op);
  if (step.op === "core.entities.each") {
    step.body.forEach((bodyStep) => {
      if (bodyStep.op === "core.entities.each") {
        throw new Error("Nested core.entities.each is not admitted");
      }
      operations.push(bodyStep.op);
    });
  }
}

function deleteMappingSubtree(mappings, prefix) {
  for (const pointer of Object.keys(mappings)) {
    if (pointer === prefix || pointer.startsWith(`${prefix}/`)) delete mappings[pointer];
  }
}

/**
 * Stamps every node of a compiler-generated value (e.g. a lowered Mechanics
 * step or module lock, which has no authoring counterpart of its own) with
 * the same fixed `sources` list, recursively.
 *
 * Before a generated subtree can be compared against an ancestor, it needs to
 * know what that ancestor's recorded sources actually are — `mapGeneratedSubtree`
 * (the entry point below) looks that up once via `resolveViaAncestor`, then
 * `mapGeneratedSubtreeNode` carries it down through the recursion exactly like
 * compileNode's `ancestorSources` parameter, applying the identical "only
 * record if this differs from the nearest recorded ancestor" rule. Every leaf
 * here shares the very same `sources` array, so without this rule a subtree
 * with N nodes would previously store the identical list N times.
 */
function mapGeneratedSubtree(mappings, pointer, value, sources) {
  const parent = parentPointer(pointer);
  const found = parent === undefined ? undefined : resolveViaAncestor(mappings, parent);
  mapGeneratedSubtreeNode(mappings, pointer, value, uniqueSources(sources), found?.sources);
}

function mapGeneratedSubtreeNode(mappings, pointer, value, sources, ancestorSources) {
  const recordOwn = ancestorSources === undefined || !sourcesEqual(sources, ancestorSources);
  if (recordOwn) {
    mappings[pointer] = sources;
  }
  const childAncestor = recordOwn ? sources : ancestorSources;
  if (Array.isArray(value)) {
    value.forEach((child, index) => mapGeneratedSubtreeNode(mappings, joinPointer(pointer, index), child, sources, childAncestor));
  } else if (hasPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      mapGeneratedSubtreeNode(mappings, joinPointer(pointer, key), child, sources, childAncestor);
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
  // Hash networkModels once for the whole compilation and fold that digest
  // into every plan's hash input, instead of embedding the full object per
  // plan. See the matching comment in mechanics-checker.cjs's
  // checkMechanicsBundle for why the digest is equivalent (same bytes, same
  // hash) and the measurements that motivated it (2.71 MB networkModels on
  // the real cards-money-trains map, ~357ms per serialization, 99 plans). The
  // compiler and the checker must compute planHash identically, or a package
  // this compiler publishes would fail semantic validation at load time.
  const networkModelsHash = mechanicsSha256(manifest.networkModels || {});
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
    recordMapping(
      mappings,
      stepsPointer,
      sourceFor(compiledRoot, sourceFile, joinPointer(joinPointer(sourcePointer, "transaction"), "steps"))
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
      // declaration changes. objectModels stays embedded by value (it is a
      // few KB, not a measured cost); networkModels is bound by digest -- see
      // networkModelsHash above.
      objectModels: manifest.objectModels || {},
      networkModelsHash,
      planId,
      transaction
    };
    publishedPlans[planId] = {
      planHash: mechanicsSha256(planContext),
      transaction
    };
    recordMapping(
      mappings,
      joinPointer(joinPointer("/mechanics/plans", planId), "planHash"),
      sourceFor(compiledRoot, sourceFile, sourcePointer)
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
      // resolveViaAncestor (not a direct `mappings[...]` read) because the
      // action's own pointer may itself have been collapsed away if it never
      // introduced anything past what its ancestor already said; walking up
      // finds the same source a consumer would. recordMapping then almost
      // always omits this entry too — a synthesized default has exactly the
      // same provenance as its action, so recording it would repeat that
      // action's own mapping (or, one level further, its ancestor's).
      recordMapping(
        mappings,
        joinPointer(joinPointer("/actions", actionId), "paramsSchema"),
        ancestorSourcesFor(mappings, joinPointer("/actions", actionId)) || sourceFor(compiledRoot, sourceFile, "/root/logic/actions")
      );
    }
    if (!Object.prototype.hasOwnProperty.call(action, "invocation")) {
      // Invocation is part of the immutable definition identity. Normalize
      // before definitionHash so an omitted authoring default cannot become a
      // transport- or consumer-specific fallback.
      action.invocation = "external";
      recordMapping(
        mappings,
        joinPointer(joinPointer("/actions", actionId), "invocation"),
        ancestorSourcesFor(mappings, joinPointer("/actions", actionId)) || sourceFor(compiledRoot, sourceFile, "/root/logic/actions")
      );
    }
    action.definitionHash = mechanicsSha256({
      apiVersion: source.apiVersion,
      actionId,
      definition: action,
      planHash: referencedPlan.planHash
    });
    recordMapping(
      mappings,
      joinPointer(joinPointer("/actions", actionId), "definitionHash"),
      ancestorSourcesFor(mappings, joinPointer("/actions", actionId)) || sourceFor(compiledRoot, sourceFile, "/root/logic/actions")
    );
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
  // Direct assignment (not recordMapping) is correct here: "" is the manifest
  // root, has no parent pointer, and per the collapsing rule a pointer with no
  // ancestor is always recorded — otherwise a consumer's upward walk would
  // have nowhere to terminate.
  const mappings = {
    "": sourceFor(compiledRoot, sourceFile, "/root")
  };
  // Carries verbatim-subtree anchors (see isPositionalMatch) forward from
  // compiledRoot's own "/root/..." pointer space into this manifest's runtime
  // pointer space, via copySubtreeMappings/copyIfPresent below.
  const verbatimAnchors = new Set();

  for (const [key, value] of Object.entries(root)) {
    if (key === "logic") {
      appendGameLogicRuntimeFields(manifest, mappings, compiledRoot, sourceFile, value, verbatimAnchors);
    } else if (key === "objectTypes") {
      appendObjectModelsRuntimeField(manifest, mappings, compiledRoot, sourceFile, value);
    } else {
      copyIfPresent(manifest, mappings, compiledRoot, sourceFile, root, key, verbatimAnchors);
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

  return { value: manifest, mappings, verbatimAnchors };
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

function appendUiScreensRuntimeField(manifest, mappings, compiledRoot, sourceFile, screensValue, verbatimAnchors) {
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
    copySubtreeMappings(mappings, compiledRoot, sourceFile, screenPointer, joinPointer("/screens", screenObject.id), verbatimAnchors);
  });
  manifest.screens = screens;
  addRuntimeMapping(mappings, "/screens", compiledRoot, sourceFile, "/root/screens");
}

function compileUiAuthoringV2(job, compiledRoot) {
  const sourceFile = job.sourceFile;
  const root = ensureObject(compiledRoot.value, sourceFile, "/root", "UI v2 root");
  assertUiAuthoringWorkspaceSemantics(root, sourceFile);
  const manifest = {};
  // Direct assignment (not recordMapping) is correct here: "" is the manifest
  // root, has no parent pointer, and per the collapsing rule a pointer with no
  // ancestor is always recorded — otherwise a consumer's upward walk would
  // have nowhere to terminate.
  const mappings = {
    "": sourceFor(compiledRoot, sourceFile, "/root")
  };
  // See compileGameAuthoringV2's identical field for why this is threaded
  // through copyIfPresent/copySubtreeMappings rather than recomputed here.
  const verbatimAnchors = new Set();

  for (const [key, value] of Object.entries(root)) {
    if (key === "screens") {
      appendUiScreensRuntimeField(manifest, mappings, compiledRoot, sourceFile, value, verbatimAnchors);
    } else {
      copyIfPresent(manifest, mappings, compiledRoot, sourceFile, root, key, verbatimAnchors);
    }
  }

  return { value: manifest, mappings, verbatimAnchors };
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
  computeCacheKeyPrefix,
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
