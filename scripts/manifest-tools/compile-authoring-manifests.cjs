#!/usr/bin/env node
/**
 * Compiles Cubica authoring manifests into runtime manifests.
 *
 * Authoring manifest means the editable source JSON that can use `_type`,
 * `_definitions`, `_extends`, and `_semantics`. Runtime manifest means the
 * generated JSON consumed by runtime-api and player-web. This script keeps
 * those layers separate: it resolves authoring prototypes at build time and
 * never asks runtime code to understand authoring-only keys.
 */

const fs = require("node:fs");
const path = require("node:path");
const Ajv = require("ajv");

const repoRoot = path.resolve(__dirname, "..", "..");
const schemasRoot = path.join(repoRoot, "docs", "architecture", "schemas");
const AUTHORING_KEYS = new Set(["_type", "_extends", "_semantics", "_definitions", "_schemaVersion", "_manifestType", "_channel"]);
const MAX_EXTENDS_DEPTH = 5;

class CompileError extends Error {
  constructor(message, filePath, pointer) {
    const location = filePath ? `${relativePath(filePath)}${pointer || ""}` : "unknown source";
    super(`${message} at ${location}`);
    this.name = "CompileError";
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
    "manifest-source-map.schema.json"
  ]) {
    const schema = readJson(path.join(schemasRoot, schemaFile));
    ajv.addSchema(schema);
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
    definitionCache: new Map()
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

function compileAuthoringFile(job, ajv) {
  const authoring = readJson(job.sourceFile);
  const schemaId = job.kind === "game"
    ? "https://cubica.platform/schemas/game-authoring.v1.json"
    : "https://cubica.platform/schemas/ui-authoring.v1.json";
  const validate = ajv.getSchema(schemaId);
  if (!validate(authoring)) {
    throw new CompileError(`Authoring schema validation failed: ${formatErrors(validate.errors)}`, job.sourceFile, "");
  }

  const compiled = compileNode(authoring.root, createCompilerContext(job.sourceFile, authoring), "/root");
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

function compareGenerated(filePath, expected) {
  const expectedText = `${JSON.stringify(expected, null, 2)}\n`;
  if (!fs.existsSync(filePath)) {
    return `missing generated file ${relativePath(filePath)}`;
  }
  const actualText = fs.readFileSync(filePath, "utf8");
  return actualText === expectedText ? null : `generated file is stale: ${relativePath(filePath)}`;
}

function run() {
  const options = parseArgs(process.argv);
  const ajv = buildAjv();
  const jobs = discoverJobs(options);

  if (jobs.length === 0) {
    if (!options.quiet) {
      console.log("compile-authoring-manifests: no authoring manifests found");
    }
    return;
  }

  const stale = [];
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
    if (!options.quiet) {
      const action = options.check ? "checked" : "compiled";
      console.log(`${action} ${relativePath(job.sourceFile)} -> ${relativePath(job.outputFile)}`);
    }
  }

  if (stale.length > 0) {
    throw new Error(`Authoring/generated drift detected:\n- ${stale.join("\n- ")}`);
  }
}

try {
  run();
} catch (error) {
  console.error(`compile-authoring-manifests: ${error.message}`);
  process.exit(1);
}
