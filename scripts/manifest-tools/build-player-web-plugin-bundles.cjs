#!/usr/bin/env node
/**
 * Builds immutable published player-web plugin bundles.
 *
 * Published bundles are generated artifacts: player-web imports them in
 * production through runtime-api, while runtime-api never executes the browser
 * plugin code. The script validates `plugin.json` with JSON Schema, runs the
 * platform-owned typecheck command directly through Node, and writes
 * content-addressed bundle metadata for each game.
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const AjvLib = require("ajv");
const Ajv = AjvLib.default || AjvLib;
const addFormatsLib = require("ajv-formats");
const addFormats = addFormatsLib.default || addFormatsLib;
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..", "..");
const schemasRoot = path.join(repoRoot, "docs", "architecture", "schemas");
const pluginSchema = readJson(path.join(schemasRoot, "plugin.schema.json"));
const bundleSchema = readJson(path.join(schemasRoot, "player-web-plugin-bundles.schema.json"));
const pluginSchemaId = "https://cubica.platform/schemas/plugin.schema.json";
const bundleSchemaId = "https://cubica.platform/schemas/player-web-plugin-bundles.schema.json";
const supportedApiVersion = "2.0";
// A cold project-local plugin typecheck currently completes near 15 seconds on
// the supported low-memory host. Keep the validation bounded, but leave enough
// headroom for process startup and scheduler contention so valid plugins do not
// fail at the wrapper boundary.
const validationTimeoutMs = 30_000;

function parseArgs(argv) {
  const options = {
    check: false,
    quiet: false,
    games: []
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") {
      options.check = true;
    } else if (arg === "--quiet") {
      options.quiet = true;
    } else if (arg === "--game") {
      const gameId = argv[index + 1];
      if (!gameId) {
        throw new Error("--game requires a game id.");
      }
      options.games.push(gameId);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv);
  const gameIds = options.games.length > 0 ? options.games : await discoverGamesWithPlugins();
  // Strict Ajv mode keeps JSON Schema the single source of truth (ADR-025) for
  // generated plugin/bundle metadata: unknown keywords/formats fail fast instead
  // of being silently ignored. allowUnionTypes accepts valid `type: [...]` unions
  // and ajv-formats registers standard formats so `format` keywords are known.
  const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
  addFormats(ajv);
  ajv.addSchema(pluginSchema, pluginSchemaId);
  ajv.addSchema(bundleSchema, bundleSchemaId);

  const updated = [];
  for (const gameId of gameIds) {
    const result = await buildGameBundles(ajv, gameId, options);
    updated.push(...result);
  }

  if (!options.quiet) {
    console.log(updated.length > 0
      ? `build-player-web-plugin-bundles: OK (${updated.join(", ")})`
      : "build-player-web-plugin-bundles: OK (no project-local player-web plugins)");
  }
}

async function buildGameBundles(ajv, gameId, options) {
  assertSafeId(gameId, "game id");
  const gameRoot = path.join(repoRoot, "games", gameId);
  const plugins = await discoverPlayerWebPlugins(ajv, gameId);
  const publishedRoot = path.join(gameRoot, "published");
  const metadataPath = path.join(publishedRoot, "player-web-plugin-bundles.json");

  if (plugins.length === 0) {
    if (options.check && fs.existsSync(metadataPath)) {
      throw new Error(`${relative(metadataPath)} exists, but ${gameId} has no project-local player-web plugins.`);
    }
    return [];
  }

  const bundles = [];
  for (const plugin of plugins) {
    await runPluginTypecheck(plugin);
    const bundleBytes = await buildBundleBytes(plugin);
    const contentHash = createHash("sha256").update(bundleBytes).digest("hex");
    const integrity = `sha256-${createHash("sha256").update(bundleBytes).digest("base64")}`;
    const filename = `${plugin.manifest.id}.${contentHash}.mjs`;
    const filePath = path.join(publishedRoot, filename);
    bundles.push({
      pluginId: plugin.manifest.id,
      gameId: plugin.manifest.gameId,
      apiVersion: plugin.manifest.apiVersion,
      target: "player-web",
      scope: "published",
      contentHash,
      integrity,
      filePath: relativePath(gameRoot, filePath),
      url: `/published-plugin-bundles/${plugin.manifest.gameId}/${plugin.manifest.id}/${contentHash}.mjs`,
      bundleBytes
    });
  }

  const metadata = {
    $schema: "../../../docs/architecture/schemas/player-web-plugin-bundles.schema.json",
    schemaVersion: "1.0",
    bundles: bundles.map(({ bundleBytes: _bundleBytes, ...bundle }) => bundle)
  };
  validateJson(ajv, bundleSchemaId, metadata, metadataPath);

  if (options.check) {
    assertGeneratedFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    for (const bundle of bundles) {
      assertGeneratedFile(path.join(gameRoot, bundle.filePath), bundle.bundleBytes);
    }
    return bundles.map((bundle) => `${bundle.gameId}/${bundle.pluginId}`);
  }

  await fsp.mkdir(publishedRoot, { recursive: true });
  await fsp.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  for (const bundle of bundles) {
    const absoluteBundlePath = path.join(gameRoot, bundle.filePath);
    await fsp.writeFile(absoluteBundlePath, bundle.bundleBytes);
    await removeStalePluginBundles(publishedRoot, bundle.pluginId, path.basename(absoluteBundlePath));
  }
  return bundles.map((bundle) => `${bundle.gameId}/${bundle.pluginId}`);
}

async function discoverGamesWithPlugins() {
  const gamesRoot = path.join(repoRoot, "games");
  const entries = await fsp.readdir(gamesRoot, { withFileTypes: true });
  const gameIds = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const pluginsRoot = path.join(gamesRoot, entry.name, "plugins");
    if (fs.existsSync(pluginsRoot)) {
      gameIds.push(entry.name);
    }
  }
  return gameIds.sort();
}

async function discoverPlayerWebPlugins(ajv, gameId) {
  const pluginsRoot = path.join(repoRoot, "games", gameId, "plugins");
  const entries = await fsp.readdir(pluginsRoot, { withFileTypes: true }).catch((error) => {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  });

  const plugins = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const pluginRoot = path.join(pluginsRoot, entry.name);
    const pluginJsonPath = path.join(pluginRoot, "plugin.json");
    if (!fs.existsSync(pluginJsonPath)) {
      continue;
    }
    const manifest = readJson(pluginJsonPath);
    validateJson(ajv, pluginSchemaId, manifest, pluginJsonPath);
    if (manifest.gameId !== gameId) {
      throw new Error(`${relative(pluginJsonPath)} gameId must match ${gameId}.`);
    }
    if (manifest.id !== entry.name) {
      throw new Error(`${relative(pluginJsonPath)} id must match plugin directory name.`);
    }
    if (manifest.apiVersion !== supportedApiVersion) {
      throw new Error(`${relative(pluginJsonPath)} apiVersion must be ${supportedApiVersion}.`);
    }
    validatePlatformOnlyPackage(pluginRoot);
    plugins.push({ pluginRoot, pluginJsonPath, manifest });
  }
  return plugins.sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
}

function validateJson(ajv, schemaId, value, filePath) {
  const validate = ajv.getSchema(schemaId);
  if (!validate) {
    throw new Error(`Schema is not registered: ${schemaId}`);
  }
  if (!validate(value)) {
    const details = (validate.errors || [])
      .map((error) => `${error.instancePath || "/"} ${error.message}`)
      .join("; ");
    throw new Error(`${relative(filePath)} failed schema validation: ${details}`);
  }
}

function validatePlatformOnlyPackage(pluginRoot) {
  const packagePath = path.join(pluginRoot, "package.json");
  if (!fs.existsSync(packagePath)) {
    return;
  }
  const packageJson = readJson(packagePath);
  for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    if (packageJson[key] && Object.keys(packageJson[key]).length > 0) {
      throw new Error(`${relative(packagePath)} must not declare ${key} while dependenciesPolicy is platform-only.`);
    }
  }
}

async function runPluginTypecheck(plugin) {
  const tsconfigPath = await writeGeneratedTypecheckConfig(plugin);
  const tscPath = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");
  const result = await runProcess({
    file: process.execPath,
    args: [tscPath, "-p", tsconfigPath, "--noEmit"],
    cwd: repoRoot,
    timeoutMs: validationTimeoutMs
  });
  if (!result.ok) {
    const reason = result.timedOut
      ? `plugin typecheck timed out after ${validationTimeoutMs}ms`
      : `plugin typecheck failed with exit code ${result.exitCode ?? "unknown"}`;
    throw new Error([`${relative(plugin.pluginJsonPath)}: ${reason}.`, result.stderr, result.stdout].filter(Boolean).join("\n\n"));
  }
}

async function writeGeneratedTypecheckConfig(plugin) {
  const configPath = path.join(repoRoot, ".tmp", "published-plugin-validation", plugin.manifest.gameId, plugin.manifest.id, "tsconfig.json");
  const config = {
    compilerOptions: {
      target: "ES2022",
      lib: ["dom", "dom.iterable", "es2022"],
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      jsx: "preserve",
      allowImportingTsExtensions: true,
      baseUrl: repoRoot,
      paths: {
        "@/*": ["apps/player-web/src/*"],
        "@cubica/player-web/plugin-api": ["apps/player-web/src/plugins/player-plugin-api.ts"],
        "@cubica/contracts-manifest": ["packages/contracts/manifest/src/index.ts"],
        "@cubica/contracts-session": ["packages/contracts/session/src/index.ts"],
        "@cubica/view-protocol": ["packages/view-protocol/src/index.ts"]
      }
    },
    include: [path.join(plugin.pluginRoot, "src/**/*.ts")]
  };
  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  await fsp.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return configPath;
}

async function runProcess(input) {
  return new Promise((resolve) => {
    const controller = new AbortController();
    let timedOut = false;
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, input.timeoutMs);

    const finish = (exitCode, signal, fallbackError) => {
      clearTimeout(timer);
      if (fallbackError && stderr.trim() === "") {
        stderr = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      }
      resolve({ ok: exitCode === 0 && !timedOut, exitCode, signal, timedOut, stdout, stderr });
    };

    const child = spawn(input.file, [...input.args], {
      cwd: input.cwd,
      shell: false,
      signal: controller.signal,
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout?.on("data", (chunk) => {
      stdout = appendBounded(stdout, chunk.toString("utf8"));
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk.toString("utf8"));
    });
    child.once("error", (error) => finish(null, null, error));
    child.once("close", (code, signal) => finish(code, signal));
  });
}

async function buildBundleBytes(plugin) {
  const entryPath = path.resolve(plugin.pluginRoot, plugin.manifest.targets["player-web"].entry);
  if (!isInsidePath(plugin.pluginRoot, entryPath)) {
    throw new Error(`${relative(plugin.pluginJsonPath)} player-web entry must stay inside plugin root.`);
  }

  const graph = await collectModuleGraph(plugin.pluginRoot, entryPath);
  const moduleBlocks = [];
  for (const moduleRecord of graph) {
    const emitted = ts.transpileModule(moduleRecord.sourceText, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true
      },
      fileName: moduleRecord.filePath
    }).outputText;
    moduleBlocks.push(
      `__pluginDefine(${JSON.stringify(moduleRecord.id)}, (exports, module) => {\n${rewriteCommonJsRequires(plugin.pluginRoot, moduleRecord.filePath, emitted)}\n});`
    );
  }

  const entryId = moduleId(plugin.pluginRoot, entryPath);
  const bundleText = [
    "const __pluginApi = globalThis.__cubicaPlayerPluginApiModule;",
    "if (!__pluginApi) { throw new Error('Cubica player plugin API is not available.'); }",
    "const __pluginModules = new Map();",
    "const __pluginCache = new Map();",
    "function __pluginDefine(id, factory) { __pluginModules.set(id, factory); }",
    "function __pluginRequire(id) {",
    "  if (id === '@cubica/player-web/plugin-api') return __pluginApi;",
    "  if (__pluginCache.has(id)) return __pluginCache.get(id).exports;",
    "  const factory = __pluginModules.get(id);",
    "  if (!factory) throw new Error(`Plugin module not found: ${id}`);",
    "  const module = { exports: {} };",
    "  __pluginCache.set(id, module);",
    "  factory(module.exports, module);",
    "  return module.exports;",
    "}",
    ...moduleBlocks,
    `const __entry = __pluginRequire(${JSON.stringify(entryId)});`,
    "export const activate = __entry.activate;",
    "export default __entry;",
    ""
  ].join("\n");
  return Buffer.from(bundleText, "utf8");
}

async function collectModuleGraph(pluginRoot, entryPath) {
  const modules = new Map();
  async function visit(filePath) {
    const resolved = await resolveExistingSourceFile(filePath);
    if (!isInsidePath(pluginRoot, resolved)) {
      throw new Error(`plugin import escapes plugin root: ${relativePath(pluginRoot, resolved)}`);
    }
    const id = moduleId(pluginRoot, resolved);
    if (modules.has(id)) {
      return;
    }
    const sourceText = await fsp.readFile(resolved, "utf8");
    const imports = collectModuleSpecifiers(resolved, sourceText);
    modules.set(id, { id, filePath: resolved, sourceText, imports });
    for (const specifier of imports) {
      if (specifier.startsWith(".")) {
        await visit(path.resolve(path.dirname(resolved), specifier));
      } else if (specifier !== "@cubica/player-web/plugin-api") {
        throw new Error(`unsupported plugin runtime import "${specifier}". Use @cubica/player-web/plugin-api or relative plugin files.`);
      }
    }
  }
  await visit(entryPath);
  return [...modules.values()];
}

function collectModuleSpecifiers(filePath, sourceText) {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const specifiers = [];
  sourceFile.forEachChild((node) => {
    if (ts.isImportDeclaration(node)) {
      if (node.importClause?.isTypeOnly === true) {
        return;
      }
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text);
      }
      return;
    }
    if (ts.isExportDeclaration(node)) {
      if (node.isTypeOnly) {
        return;
      }
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text);
      }
    }
  });
  return specifiers;
}

function rewriteCommonJsRequires(pluginRoot, fromFilePath, emitted) {
  return emitted.replace(/require\("([^"]+)"\)/gu, (_match, specifier) => {
    if (specifier === "@cubica/player-web/plugin-api") {
      return "__pluginRequire(\"@cubica/player-web/plugin-api\")";
    }
    if (!specifier.startsWith(".")) {
      throw new Error(`unsupported plugin runtime import "${specifier}".`);
    }
    const targetPath = resolveExistingSourceFileSync(path.resolve(path.dirname(fromFilePath), specifier));
    return `__pluginRequire(${JSON.stringify(moduleId(pluginRoot, targetPath))})`;
  });
}

async function resolveExistingSourceFile(filePathWithoutExtension) {
  for (const candidate of sourceFileCandidates(filePathWithoutExtension)) {
    const stats = await fsp.stat(candidate).catch((error) => {
      if (isMissingFileError(error)) {
        return undefined;
      }
      throw error;
    });
    if (stats?.isFile()) {
      return candidate;
    }
  }
  throw new Error(`plugin source file was not found: ${filePathWithoutExtension}`);
}

function resolveExistingSourceFileSync(filePathWithoutExtension) {
  for (const candidate of sourceFileCandidates(filePathWithoutExtension)) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  throw new Error(`plugin source file was not found: ${filePathWithoutExtension}`);
}

function sourceFileCandidates(filePathWithoutExtension) {
  if (path.extname(filePathWithoutExtension) !== "") {
    return [filePathWithoutExtension];
  }
  return [
    `${filePathWithoutExtension}.ts`,
    `${filePathWithoutExtension}.tsx`,
    path.join(filePathWithoutExtension, "index.ts"),
    path.join(filePathWithoutExtension, "index.tsx")
  ];
}

async function removeStalePluginBundles(publishedRoot, pluginId, currentFilename) {
  const entries = await fsp.readdir(publishedRoot, { withFileTypes: true }).catch((error) => {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (entry.name.startsWith(`${pluginId}.`) && entry.name.endsWith(".mjs") && entry.name !== currentFilename) {
      await fsp.unlink(path.join(publishedRoot, entry.name));
    }
  }
}

function assertGeneratedFile(filePath, expected) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${relative(filePath)} is missing. Run node scripts/manifest-tools/build-player-web-plugin-bundles.cjs.`);
  }
  const actual = fs.readFileSync(filePath);
  const expectedBuffer = Buffer.isBuffer(expected) ? expected : Buffer.from(expected, "utf8");
  if (!actual.equals(expectedBuffer)) {
    throw new Error(`${relative(filePath)} is stale. Run node scripts/manifest-tools/build-player-web-plugin-bundles.cjs.`);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertSafeId(value, label) {
  if (!/^[a-z][a-z0-9-]*$/u.test(value)) {
    throw new Error(`Unsafe ${label}: ${value}`);
  }
}

function moduleId(pluginRoot, filePath) {
  return relativePath(pluginRoot, filePath);
}

function relative(filePath) {
  return relativePath(repoRoot, filePath);
}

function relativePath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function isInsidePath(parent, candidate) {
  const resolvedParent = path.resolve(parent);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedParent || resolvedCandidate.startsWith(`${resolvedParent}${path.sep}`);
}

function isMissingFileError(error) {
  return typeof error === "object" && error !== null && error.code === "ENOENT";
}

function appendBounded(current, next) {
  const combined = current + next;
  return combined.length > 40_000 ? combined.slice(-40_000) : combined;
}

main().catch((error) => {
  console.error(`build-player-web-plugin-bundles: ${error.message}`);
  process.exit(1);
});
