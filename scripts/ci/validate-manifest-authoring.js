#!/usr/bin/env node
/**
 * Validates ADR-030 authoring manifest governance.
 *
 * Governance means the repository rule that developers and agents edit
 * authoring inputs, while generated runtime manifests are produced only by
 * the compiler. This CI check blocks stale generated files and authoring-only
 * keys leaking into runtime manifests.
 */

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const Ajv = require("ajv");
const { compileAuthoringFile, validateRuntimeManifest } = require("../manifest-tools/authoring-compiler.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const schemasRoot = path.join(repoRoot, "docs", "architecture", "schemas");
const authoringOnlyKeys = new Set([
  "_type",
  "_extends",
  "_label",
  "_definitions",
  "_semantics",
  "_prompt",
  "_promptTemplate",
  "_requiresView",
  "_decorative",
  "_schemaVersion",
  "_manifestType",
  "_channel",
  "_source_trace"
]);

function fail(message) {
  console.error(`validate-manifest-authoring: ${message}`);
  process.exit(1);
}

function relative(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

function readJson(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function toPointerSegment(segment) {
  return String(segment).replace(/~/g, "~0").replace(/\//g, "~1");
}

function joinPointer(pointer, segment) {
  return `${pointer}/${toPointerSegment(segment)}`;
}

function readJsonPointer(document, pointer) {
  if (pointer === "") {
    return { exists: true, value: document };
  }
  if (!pointer.startsWith("/")) {
    return { exists: false, value: undefined };
  }

  let current = document;
  for (const rawSegment of pointer.slice(1).split("/")) {
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!current || typeof current !== "object") {
      return { exists: false, value: undefined };
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      return { exists: false, value: undefined };
    }
    current = current[segment];
  }
  return { exists: true, value: current };
}

function collectFiles(root, predicate) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const result = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (predicate(fullPath)) {
        result.push(fullPath);
      }
    }
  }
  return result.sort();
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
    "ui-manifest.schema.json",
    "plugin.schema.json",
    "player-web-plugin-bundles.schema.json"
  ]) {
    const schema = readJson(`docs/architecture/schemas/${schemaFile}`);
    if (schemaFile === "game-manifest.schema.json") {
      ajv.addSchema(schema, "https://cubica.platform/schemas/game-manifest.schema.json");
    } else if (schemaFile === "player-web-plugin-bundles.schema.json") {
      ajv.addSchema(schema, "https://cubica.platform/schemas/player-web-plugin-bundles.schema.json");
    } else {
      ajv.addSchema(schema);
    }
  }
  return ajv;
}

function formatErrors(errors) {
  return (errors || []).map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
}

function authoringSchemaId(kind, authoring) {
  if (authoring._schemaVersion !== "2.0") {
    fail(`authoring manifests must use _schemaVersion "2.0"; found "${authoring._schemaVersion || "<missing>"}"`);
  }
  if (kind === "game") {
    return "https://cubica.platform/schemas/game-authoring.v2.json";
  }
  return "https://cubica.platform/schemas/ui-authoring.v2.json";
}

function validateJsonData(ajv, schemaId, data, filePath) {
  const validate = ajv.getSchema(schemaId);
  if (!validate) {
    fail(`schema is not registered: ${schemaId}`);
  }
  if (!validate(data)) {
    fail(`${relative(filePath)} failed schema validation: ${formatErrors(validate.errors)}`);
  }
}

function validateJsonFile(ajv, schemaId, filePath) {
  const validate = ajv.getSchema(schemaId);
  if (!validate) {
    fail(`schema is not registered: ${schemaId}`);
  }
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!validate(data)) {
    fail(`${relative(filePath)} failed schema validation: ${formatErrors(validate.errors)}`);
  }
}

function validateAuthoringFile(ajv, kind, filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  validateJsonData(ajv, authoringSchemaId(kind, data), data, filePath);
}

function validateAuthoringInputs(ajv) {
  const gameAuthoringFiles = collectFiles(path.join(repoRoot, "games"), (filePath) => filePath.endsWith("/authoring/game.authoring.json"));
  const uiAuthoringFiles = collectFiles(path.join(repoRoot, "games"), (filePath) => /\/authoring\/ui\/[^/]+\.authoring\.json$/.test(filePath));

  for (const filePath of gameAuthoringFiles) {
    validateAuthoringFile(ajv, "game", filePath);
  }
  for (const filePath of uiAuthoringFiles) {
    validateAuthoringFile(ajv, "ui", filePath);
  }

  if (gameAuthoringFiles.length === 0 && uiAuthoringFiles.length === 0) {
    fail("no authoring manifests found; ADR-030 pilot must keep at least one adopted game/UI pair");
  }
}

function validateAuthoringV2Examples(ajv) {
  const examplesRoot = path.join(repoRoot, "docs", "architecture", "schemas", "examples", "authoring-v2");
  const examples = [
    {
      kind: "game",
      sourceFile: path.join(examplesRoot, "minimal-game.authoring.json"),
      outputFile: path.join(repoRoot, ".tmp", "authoring-v2-fixture", "game.manifest.json"),
      sourceMapFile: path.join(repoRoot, ".tmp", "authoring-v2-fixture", "game.manifest.source-map.json")
    },
    {
      kind: "ui",
      sourceFile: path.join(examplesRoot, "minimal-ui.authoring.json"),
      outputFile: path.join(repoRoot, ".tmp", "authoring-v2-fixture", "ui", "web", "ui.manifest.json"),
      sourceMapFile: path.join(repoRoot, ".tmp", "authoring-v2-fixture", "ui", "web", "ui.manifest.source-map.json")
    }
  ];

  for (const job of examples) {
    if (!fs.existsSync(job.sourceFile)) {
      fail(`missing authoring v2 example: ${relative(job.sourceFile)}`);
    }
    const output = compileAuthoringFile(job, ajv);
    const runtimeValidation = validateRuntimeManifest(job, output.manifest, ajv);
    if (!runtimeValidation.valid) {
      fail(
        `${relative(job.sourceFile)} compiled to invalid runtime manifest: ${runtimeValidation.errors
          .map((error) => `${error.pointer || "/"} ${error.message}`)
          .join("; ")}`
      );
    }
    validateJsonData(ajv, "https://cubica.platform/schemas/manifest-source-map.v1.json", output.sourceMap, job.sourceMapFile);
    scanForAuthoringKeys(output.manifest, job.outputFile);
  }
}

function adoptedRuntimeFiles() {
  const files = [];
  const gameAuthoringFiles = collectFiles(path.join(repoRoot, "games"), (filePath) => filePath.endsWith("/authoring/game.authoring.json"));
  for (const source of gameAuthoringFiles) {
    const gameRoot = path.dirname(path.dirname(source));
    files.push({
      kind: "game",
      gameRoot,
      manifest: path.join(gameRoot, "game.manifest.json"),
      sourceMap: path.join(gameRoot, "game.manifest.source-map.json")
    });
  }

  const uiAuthoringFiles = collectFiles(path.join(repoRoot, "games"), (filePath) => /\/authoring\/ui\/[^/]+\.authoring\.json$/.test(filePath));
  for (const source of uiAuthoringFiles) {
    const channel = path.basename(source, ".authoring.json");
    const gameRoot = path.dirname(path.dirname(path.dirname(source)));
    files.push({
      kind: "ui",
      gameRoot,
      manifest: path.join(gameRoot, "ui", channel, "ui.manifest.json"),
      sourceMap: path.join(gameRoot, "ui", channel, "ui.manifest.source-map.json")
    });
  }
  return files;
}

function scanForAuthoringKeys(value, filePath, pointer = "") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForAuthoringKeys(item, filePath, `${pointer}/${index}`));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (authoringOnlyKeys.has(key)) {
      fail(`${relative(filePath)} contains authoring-only key "${key}" at ${pointer || "/"}`);
    }
    scanForAuthoringKeys(child, filePath, `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`);
  }
}

function validateGeneratedOutputs(ajv) {
  for (const file of adoptedRuntimeFiles()) {
    if (!fs.existsSync(file.manifest)) {
      fail(`missing generated manifest: ${relative(file.manifest)}`);
    }
    if (!fs.existsSync(file.sourceMap)) {
      fail(`missing generated source map: ${relative(file.sourceMap)}`);
    }
    const schemaId = file.kind === "game"
      ? "https://cubica.platform/schemas/game-manifest.schema.json"
      : "https://cubica.platform/schemas/ui-manifest.v1.json";
    validateJsonFile(ajv, schemaId, file.manifest);
    validateJsonFile(ajv, "https://cubica.platform/schemas/manifest-source-map.v1.json", file.sourceMap);
    scanForAuthoringKeys(JSON.parse(fs.readFileSync(file.manifest, "utf8")), file.manifest);
  }
}

function validatePluginManifests(ajv) {
  const schemaId = "https://cubica.platform/schemas/plugin.schema.json";
  const pluginManifests = [
    ...collectFiles(path.join(repoRoot, "games"), (filePath) => /\/plugins\/[^/]+\/plugin\.json$/.test(filePath)),
    ...collectFiles(path.join(schemasRoot, "examples", "plugin"), (filePath) => filePath.endsWith(".plugin.json"))
  ];

  for (const filePath of pluginManifests) {
    validateJsonFile(ajv, schemaId, filePath);
    const plugin = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (plugin.dependenciesPolicy === "platform-only") {
      validatePlatformOnlyPluginPackage(filePath);
    }
  }
}

function validatePublishedPlayerWebPluginBundles(ajv) {
  const schemaId = "https://cubica.platform/schemas/player-web-plugin-bundles.schema.json";
  const metadataFiles = collectFiles(path.join(repoRoot, "games"), (filePath) => /\/published\/player-web-plugin-bundles\.json$/.test(filePath));
  for (const filePath of metadataFiles) {
    validateJsonFile(ajv, schemaId, filePath);
    const gameRoot = path.dirname(path.dirname(filePath));
    const gameId = path.basename(gameRoot);
    const metadata = JSON.parse(fs.readFileSync(filePath, "utf8"));
    for (const bundle of metadata.bundles || []) {
      if (bundle.gameId !== gameId) {
        fail(`${relative(filePath)} bundle gameId must match ${gameId}`);
      }
      const bundlePath = path.resolve(gameRoot, bundle.filePath);
      if (bundlePath === gameRoot || !bundlePath.startsWith(`${gameRoot}${path.sep}`)) {
        fail(`${relative(filePath)} bundle filePath must stay inside the game root`);
      }
      if (!fs.existsSync(bundlePath)) {
        fail(`${relative(filePath)} points to missing bundle ${bundle.filePath}`);
      }
      const bytes = fs.readFileSync(bundlePath);
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      const integrity = `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
      if (contentHash !== bundle.contentHash) {
        fail(`${relative(bundlePath)} contentHash does not match metadata`);
      }
      if (integrity !== bundle.integrity) {
        fail(`${relative(bundlePath)} integrity does not match metadata`);
      }
    }
  }
}

function validatePlatformOnlyPluginPackage(pluginManifestPath) {
  const pluginRoot = path.dirname(pluginManifestPath);
  const packagePath = path.join(pluginRoot, "package.json");
  if (!fs.existsSync(packagePath)) {
    return;
  }

  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    if (packageJson[field] && Object.keys(packageJson[field]).length > 0) {
      fail(`${relative(packagePath)} must not declare ${field} while plugin dependenciesPolicy is platform-only`);
    }
  }
}

function validateSourceMapPointers() {
  const documentCache = new Map();
  for (const file of adoptedRuntimeFiles()) {
    const sourceMap = JSON.parse(fs.readFileSync(file.sourceMap, "utf8"));
    for (const [generatedPointer, sources] of Object.entries(sourceMap.mappings || {})) {
      for (const source of sources) {
        const sourceFile = path.join(repoRoot, source.file);
        if (!fs.existsSync(sourceFile)) {
          fail(`${relative(file.sourceMap)} maps ${generatedPointer || "/"} to missing source file ${source.file}`);
        }
        let document = documentCache.get(sourceFile);
        if (!document) {
          document = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
          documentCache.set(sourceFile, document);
        }
        if (!readJsonPointer(document, source.pointer).exists) {
          fail(`${relative(file.sourceMap)} maps ${generatedPointer || "/"} to missing source pointer ${source.file}${source.pointer}`);
        }
      }
    }
  }
}

function collectActionReferences(value, filePath, pointer = "") {
  const references = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      references.push(...collectActionReferences(item, filePath, joinPointer(pointer, index)));
    });
    return references;
  }
  if (!value || typeof value !== "object") {
    return references;
  }

  if (value.payload && typeof value.payload.actionId === "string") {
    references.push({
      kind: "payload.actionId",
      actionId: value.payload.actionId,
      filePath,
      pointer: `${pointer}/payload/actionId`
    });
  }
  if (typeof value.advanceActionId === "string") {
    references.push({
      kind: "advanceActionId",
      actionId: value.advanceActionId,
      filePath,
      pointer: `${pointer}/advanceActionId`
    });
  }

  for (const [key, child] of Object.entries(value)) {
    references.push(...collectActionReferences(child, filePath, joinPointer(pointer, key)));
  }
  return references;
}

function validateDanglingActionReferences() {
  const files = adoptedRuntimeFiles();
  const gameFiles = files.filter((file) => file.kind === "game");
  for (const gameFile of gameFiles) {
    const gameManifest = JSON.parse(fs.readFileSync(gameFile.manifest, "utf8"));
    const actionIds = new Set(Object.keys(gameManifest.actions || {}));
    const relatedFiles = files.filter((file) => file.gameRoot === gameFile.gameRoot);
    for (const file of relatedFiles) {
      const manifest = JSON.parse(fs.readFileSync(file.manifest, "utf8"));
      for (const reference of collectActionReferences(manifest, file.manifest)) {
        if (!actionIds.has(reference.actionId)) {
          fail(
            `${relative(reference.filePath)} has dangling ${reference.kind} "${reference.actionId}" at ${reference.pointer || "/"}`
          );
        }
      }
    }
  }
}

function validateCompilerDrift() {
  try {
    execFileSync(
      process.execPath,
      [path.join(repoRoot, "scripts", "manifest-tools", "compile-authoring-manifests.cjs"), "--check", "--quiet"],
      { cwd: repoRoot, stdio: "pipe" }
    );
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : "";
    const stdout = error.stdout ? String(error.stdout).trim() : "";
    fail([stderr, stdout].filter(Boolean).join("\n") || error.message);
  }
}

function validatePublishedPluginBundleDrift() {
  try {
    execFileSync(
      process.execPath,
      [path.join(repoRoot, "scripts", "manifest-tools", "build-player-web-plugin-bundles.cjs"), "--check", "--quiet"],
      { cwd: repoRoot, stdio: "pipe" }
    );
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : "";
    const stdout = error.stdout ? String(error.stdout).trim() : "";
    fail([stderr, stdout].filter(Boolean).join("\n") || error.message);
  }
}

function main() {
  const ajv = buildAjv();
  validateAuthoringInputs(ajv);
  validateAuthoringV2Examples(ajv);
  validatePluginManifests(ajv);
  validatePublishedPlayerWebPluginBundles(ajv);
  validateCompilerDrift();
  validatePublishedPluginBundleDrift();
  validateGeneratedOutputs(ajv);
  validateSourceMapPointers();
  validateDanglingActionReferences();
  console.log("validate-manifest-authoring: OK");
}

main();
