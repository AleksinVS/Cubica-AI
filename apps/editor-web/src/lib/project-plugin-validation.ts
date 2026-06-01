/**
 * Project-local plugin validation and preview bundling.
 *
 * The editor owns this step because local plugins are authoring-time source
 * files. runtime-api only receives an already validated browser module path for
 * the active preview content source and never executes plugin source itself.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createDocumentStore,
  createSchemaRegistry,
  validateDocument,
  type DocumentDiagnostic
} from "@cubica/editor-engine";
import ts from "typescript";

import pluginSchema from "../../../../docs/architecture/schemas/plugin.schema.json";
import type { EditorCompilerDiagnostic } from "./compiler-workflow";

const pluginSchemaId = "https://cubica.platform/schemas/plugin.schema.json";
const validationTimeoutMs = 15_000;
const canonicalValidationScripts: Record<string, string> = {
  typecheck: "tsc -p tsconfig.json --noEmit"
};
const forbiddenDependencyKeys = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies"
] as const;

interface PlayerWebPluginTarget {
  readonly entry: string;
  readonly contributes: {
    readonly gameConfigFactory?: boolean;
  };
}

interface ProjectPluginManifest {
  readonly id: string;
  readonly gameId: string;
  readonly apiVersion: string;
  readonly targets: {
    readonly "player-web": PlayerWebPluginTarget;
  };
  readonly validation: Record<string, string>;
  readonly permissions: {
    readonly network: false;
    readonly filesystem: "plugin-root-only";
    readonly environment: readonly string[];
  };
  readonly dependenciesPolicy: "platform-only";
}

export interface PlayerWebPluginBundleForRuntime {
  readonly pluginId: string;
  readonly gameId: string;
  readonly apiVersion: string;
  readonly target: "player-web";
  readonly scope: "preview";
  readonly contentHash: string;
  readonly filePath: string;
}

export interface ProjectPluginValidationResult {
  readonly ok: boolean;
  readonly diagnostics: readonly EditorCompilerDiagnostic[];
  readonly playerWebBundles: readonly PlayerWebPluginBundleForRuntime[];
}

interface DiscoveredProjectPlugin {
  readonly pluginRoot: string;
  readonly pluginJsonPath: string;
  readonly pluginIdFromPath: string;
  readonly manifest: ProjectPluginManifest;
}

interface ModuleRecord {
  readonly id: string;
  readonly filePath: string;
  readonly sourceText: string;
  readonly imports: readonly string[];
}

/**
 * Discovers, validates, typechecks, and bundles all project-local player plugins
 * for one game. No plugin directory is a valid result: simple manifest-only
 * games stay plugin-free.
 */
export async function validateAndBundleProjectPlugins(input: {
  readonly repoRoot: string;
  readonly gameId: string;
}): Promise<ProjectPluginValidationResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const diagnostics: EditorCompilerDiagnostic[] = [];
  const bundles: PlayerWebPluginBundleForRuntime[] = [];
  const discovered = await discoverProjectPlugins(repoRoot, input.gameId);

  for (const discovery of discovered) {
    const pluginDiagnostics: EditorCompilerDiagnostic[] = [...discovery.diagnostics];
    if (discovery.plugin === undefined) {
      diagnostics.push(...pluginDiagnostics);
      continue;
    }

    const plugin = discovery.plugin;
    pluginDiagnostics.push(...validatePluginPathBoundary(repoRoot, input.gameId, plugin));
    pluginDiagnostics.push(...await validateDependencyPolicy(repoRoot, plugin));
    pluginDiagnostics.push(...await validateCommandDeclarations(repoRoot, plugin));

    if (hasErrors(pluginDiagnostics)) {
      diagnostics.push(...pluginDiagnostics);
      continue;
    }

    pluginDiagnostics.push(...await runPluginTypecheck(repoRoot, plugin));
    if (hasErrors(pluginDiagnostics)) {
      diagnostics.push(...pluginDiagnostics);
      continue;
    }

    const bundle = await bundlePlayerWebPlugin(repoRoot, plugin).catch((error: unknown) => {
      pluginDiagnostics.push(pluginDiagnostic(repoRoot, plugin.pluginJsonPath, error instanceof Error ? error.message : "Plugin bundling failed."));
      return undefined;
    });
    diagnostics.push(...pluginDiagnostics);
    if (bundle !== undefined) {
      bundles.push(bundle);
    }
  }

  return {
    ok: !hasErrors(diagnostics),
    diagnostics,
    playerWebBundles: bundles
  };
}

/**
 * Runs one platform-owned validation process without shell parsing.
 *
 * Tests use this helper directly for timeout/failure coverage. Production
 * validation maps plugin.json command names to this function instead of running
 * package.json script strings.
 */
export async function runPluginValidationProcess(input: {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
}): Promise<{
  readonly ok: boolean;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const controller = new AbortController();
  let timedOut = false;
  let stdout = "";
  let stderr = "";

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, input.timeoutMs);

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null, fallbackError?: unknown) => {
      clearTimeout(timer);
      if (fallbackError !== undefined && stderr.trim() === "") {
        stderr = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      }
      resolve({
        ok: exitCode === 0 && !timedOut,
        exitCode,
        signal,
        timedOut,
        stdout,
        stderr
      });
    };

    const child = spawn(input.file, [...input.args], {
      cwd: input.cwd,
      shell: false,
      signal: controller.signal,
      stdio: ["ignore", "pipe", "pipe"]
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk.toString("utf8"));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk.toString("utf8"));
    });
    child.once("error", (error) => finish(null, null, error));
    child.once("close", (code, signal) => finish(code, signal));
  });
}

async function discoverProjectPlugins(
  repoRoot: string,
  gameId: string
): Promise<Array<{ readonly plugin?: DiscoveredProjectPlugin; readonly diagnostics: readonly EditorCompilerDiagnostic[] }>> {
  const pluginsRoot = path.join(repoRoot, "games", gameId, "plugins");
  const entries = await readdir(pluginsRoot, { withFileTypes: true }).catch((error: unknown) => {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  });

  const discovered: Array<{ readonly plugin?: DiscoveredProjectPlugin; readonly diagnostics: readonly EditorCompilerDiagnostic[] }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const pluginRoot = path.join(pluginsRoot, entry.name);
    const pluginJsonPath = path.join(pluginRoot, "plugin.json");
    const rawPluginJson = await readFile(pluginJsonPath, "utf8").catch((error: unknown) => {
      if (isMissingFileError(error)) {
        return undefined;
      }
      throw error;
    });
    if (rawPluginJson === undefined) {
      continue;
    }

    const diagnostics = validatePluginManifestText(repoRoot, pluginJsonPath, rawPluginJson);
    if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      discovered.push({ diagnostics });
      continue;
    }
    const parsed = JSON.parse(rawPluginJson) as ProjectPluginManifest;
    discovered.push({
      diagnostics,
      plugin: {
        pluginRoot,
        pluginJsonPath,
        pluginIdFromPath: entry.name,
        manifest: parsed
      }
    });
  }

  return discovered;
}

function validatePluginManifestText(
  repoRoot: string,
  pluginJsonPath: string,
  text: string
): readonly EditorCompilerDiagnostic[] {
  const snapshot = createDocumentStore({ filePath: relativePath(repoRoot, pluginJsonPath), text }).snapshot();
  const registry = createSchemaRegistry();
  registry.registerSchema(pluginSchemaId, pluginSchema);

  return validateDocument(snapshot, {
    schemaRegistry: registry,
    schemaId: pluginSchemaId,
    includeSemanticDiagnostics: false
  }).map((diagnostic) => editorDiagnosticFromDocument(repoRoot, pluginJsonPath, diagnostic));
}

function validatePluginPathBoundary(
  repoRoot: string,
  gameId: string,
  plugin: DiscoveredProjectPlugin
): readonly EditorCompilerDiagnostic[] {
  const diagnostics: EditorCompilerDiagnostic[] = [];
  const expectedRoot = path.join(repoRoot, "games", gameId, "plugins", plugin.manifest.id);
  if (path.resolve(plugin.pluginRoot) !== path.resolve(expectedRoot)) {
    diagnostics.push(pluginDiagnostic(
      repoRoot,
      plugin.pluginJsonPath,
      `plugin id "${plugin.manifest.id}" must match its directory games/${gameId}/plugins/${plugin.pluginIdFromPath}.`,
      "/id"
    ));
  }
  if (plugin.manifest.gameId !== gameId) {
    diagnostics.push(pluginDiagnostic(
      repoRoot,
      plugin.pluginJsonPath,
      `plugin gameId "${plugin.manifest.gameId}" must match the preview game "${gameId}".`,
      "/gameId"
    ));
  }
  if (!isInsidePath(path.join(repoRoot, "games", gameId, "plugins"), plugin.pluginRoot)) {
    diagnostics.push(pluginDiagnostic(repoRoot, plugin.pluginJsonPath, "plugin root must stay inside games/<gameId>/plugins/<pluginId>."));
  }
  return diagnostics;
}

async function validateDependencyPolicy(
  repoRoot: string,
  plugin: DiscoveredProjectPlugin
): Promise<readonly EditorCompilerDiagnostic[]> {
  const packageJsonPath = path.join(plugin.pluginRoot, "package.json");
  const rawPackageJson = await readFile(packageJsonPath, "utf8").catch((error: unknown) => {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  });
  if (rawPackageJson === undefined) {
    return [];
  }

  const diagnostics: EditorCompilerDiagnostic[] = [];
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawPackageJson) as Record<string, unknown>;
  } catch {
    return [pluginDiagnostic(repoRoot, packageJsonPath, "package.json must be valid JSON.")];
  }

  for (const key of forbiddenDependencyKeys) {
    const value = parsed[key];
    if (value !== undefined && typeof value === "object" && value !== null && Object.keys(value).length > 0) {
      diagnostics.push(pluginDiagnostic(
        repoRoot,
        packageJsonPath,
        `dependenciesPolicy=platform-only forbids package.json ${key}; use only platform-provided imports for now.`,
        `/${key}`
      ));
    }
  }

  return diagnostics;
}

async function validateCommandDeclarations(
  repoRoot: string,
  plugin: DiscoveredProjectPlugin
): Promise<readonly EditorCompilerDiagnostic[]> {
  const diagnostics: EditorCompilerDiagnostic[] = [];
  const requestedCommands = new Set(Object.values(plugin.manifest.validation));
  for (const command of requestedCommands) {
    if (!(command in canonicalValidationScripts)) {
      diagnostics.push(pluginDiagnostic(
        repoRoot,
        plugin.pluginJsonPath,
        `validation command "${command}" is not in the current direct-execution allowlist.`,
        "/validation"
      ));
    }
  }

  const packageJsonPath = path.join(plugin.pluginRoot, "package.json");
  const rawPackageJson = await readFile(packageJsonPath, "utf8").catch((error: unknown) => {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  });
  if (rawPackageJson === undefined) {
    return diagnostics;
  }

  let parsed: { readonly scripts?: Record<string, unknown> };
  try {
    parsed = JSON.parse(rawPackageJson) as { readonly scripts?: Record<string, unknown> };
  } catch {
    diagnostics.push(pluginDiagnostic(repoRoot, packageJsonPath, "package.json must be valid JSON."));
    return diagnostics;
  }
  for (const command of requestedCommands) {
    const declaredScript = parsed.scripts?.[command];
    const expectedScript = canonicalValidationScripts[command];
    if (declaredScript !== undefined && declaredScript !== expectedScript) {
      diagnostics.push(pluginDiagnostic(
        repoRoot,
        packageJsonPath,
        `script "${command}" must be declared as "${expectedScript}" because the editor executes the platform-owned command directly.`,
        `/scripts/${escapeJsonPointer(command)}`
      ));
    }
  }

  return diagnostics;
}

async function runPluginTypecheck(
  repoRoot: string,
  plugin: DiscoveredProjectPlugin
): Promise<readonly EditorCompilerDiagnostic[]> {
  const tsconfigPath = await writeGeneratedTypecheckConfig(repoRoot, plugin);
  const platformRoot = resolvePlatformRoot();
  const tscPath = path.join(platformRoot, "node_modules", "typescript", "bin", "tsc");
  const result = await runPluginValidationProcess({
    file: process.execPath,
    args: [tscPath, "-p", tsconfigPath, "--noEmit"],
    cwd: platformRoot,
    timeoutMs: validationTimeoutMs
  });

  if (result.ok) {
    return [];
  }

  const reason = result.timedOut
    ? `plugin typecheck timed out after ${validationTimeoutMs}ms.`
    : `plugin typecheck failed with exit code ${result.exitCode ?? "unknown"}.`;
  const details = [reason, result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n\n");
  return [pluginDiagnostic(repoRoot, plugin.pluginJsonPath, details)];
}

async function writeGeneratedTypecheckConfig(
  repoRoot: string,
  plugin: DiscoveredProjectPlugin
): Promise<string> {
  const configPath = path.join(repoRoot, ".tmp", "editor-plugin-validation", plugin.manifest.gameId, plugin.manifest.id, "tsconfig.json");
  const platformRoot = resolvePlatformRoot();
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
      baseUrl: platformRoot,
      paths: {
        "@/*": ["apps/player-web/src/*"],
        "@cubica/player-web/plugin-api": ["apps/player-web/src/plugins/player-plugin-api.ts"],
        "@cubica/contracts-manifest": ["packages/contracts/manifest/src/index.ts"],
        "@cubica/contracts-session": ["packages/contracts/session/src/index.ts"],
        "@cubica/sdk-core": ["SDK/core/src/index.ts"],
        "@cubica/sdk-shared": ["SDK/shared/src/index.ts"]
      }
    },
    include: [path.join(plugin.pluginRoot, "src/**/*.ts")]
  };
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return configPath;
}

async function bundlePlayerWebPlugin(
  repoRoot: string,
  plugin: DiscoveredProjectPlugin
): Promise<PlayerWebPluginBundleForRuntime> {
  const entryPath = path.resolve(plugin.pluginRoot, plugin.manifest.targets["player-web"].entry);
  if (!isInsidePath(plugin.pluginRoot, entryPath)) {
    throw new Error("player-web entry must stay inside the plugin root.");
  }

  const graph = await collectModuleGraph(plugin.pluginRoot, entryPath);
  const moduleBlocks: string[] = [];
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
    "export default __entry;"
  ].join("\n");
  const contentHash = createHash("sha256").update(bundleText).digest("hex");
  const outputPath = path.join(repoRoot, ".tmp", "editor-plugin-bundles", plugin.manifest.gameId, plugin.manifest.id, `${contentHash}.mjs`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${bundleText}\n`, "utf8");

  return {
    pluginId: plugin.manifest.id,
    gameId: plugin.manifest.gameId,
    apiVersion: plugin.manifest.apiVersion,
    target: "player-web",
    scope: "preview",
    contentHash,
    filePath: relativePath(repoRoot, outputPath)
  };
}

async function collectModuleGraph(pluginRoot: string, entryPath: string): Promise<readonly ModuleRecord[]> {
  const modules = new Map<string, ModuleRecord>();

  async function visit(filePath: string): Promise<void> {
    const resolved = await resolveExistingSourceFile(filePath);
    if (!isInsidePath(pluginRoot, resolved)) {
      throw new Error(`plugin import escapes plugin root: ${relativePath(pluginRoot, resolved)}`);
    }
    const id = moduleId(pluginRoot, resolved);
    if (modules.has(id)) {
      return;
    }

    const sourceText = await readFile(resolved, "utf8");
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

function collectModuleSpecifiers(filePath: string, sourceText: string): readonly string[] {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const specifiers: string[] = [];

  sourceFile.forEachChild((node) => {
    if (ts.isImportDeclaration(node)) {
      if (node.importClause?.isTypeOnly === true) {
        return;
      }
      if (node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text);
      }
      return;
    }

    if (ts.isExportDeclaration(node)) {
      if (node.isTypeOnly) {
        return;
      }
      if (node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text);
      }
    }
  });

  return specifiers;
}

function rewriteCommonJsRequires(pluginRoot: string, fromFilePath: string, emitted: string): string {
  return emitted.replace(/require\("([^"]+)"\)/gu, (_match, specifier: string) => {
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

async function resolveExistingSourceFile(filePathWithoutExtension: string): Promise<string> {
  for (const candidate of sourceFileCandidates(filePathWithoutExtension)) {
    const stats = await stat(candidate).catch((error: unknown) => {
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

function resolveExistingSourceFileSync(filePathWithoutExtension: string): string {
  for (const candidate of sourceFileCandidates(filePathWithoutExtension)) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }
  throw new Error(`plugin source file was not found: ${filePathWithoutExtension}`);
}

function sourceFileCandidates(filePathWithoutExtension: string): readonly string[] {
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

function editorDiagnosticFromDocument(
  repoRoot: string,
  filePath: string,
  diagnostic: DocumentDiagnostic
): EditorCompilerDiagnostic {
  return {
    severity: diagnostic.severity,
    source: "plugin-schema",
    pointer: diagnostic.pointer,
    label: diagnostic.pointer === "" ? "/" : diagnostic.pointer,
    message: diagnostic.message,
    range: diagnostic.range,
    filePath: relativePath(repoRoot, filePath)
  };
}

function pluginDiagnostic(
  repoRoot: string,
  filePath: string,
  message: string,
  pointer = ""
): EditorCompilerDiagnostic {
  return {
    severity: "error",
    source: "plugin-validation",
    pointer,
    label: pointer === "" ? "/" : pointer,
    message,
    filePath: relativePath(repoRoot, filePath)
  };
}

function appendBounded(current: string, next: string): string {
  const combined = current + next;
  return combined.length > 40_000 ? combined.slice(-40_000) : combined;
}

function moduleId(pluginRoot: string, filePath: string): string {
  return relativePath(pluginRoot, filePath);
}

function relativePath(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function isInsidePath(parent: string, candidate: string): boolean {
  const resolvedParent = path.resolve(parent);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedParent || resolvedCandidate.startsWith(`${resolvedParent}${path.sep}`);
}

function hasErrors(diagnostics: readonly EditorCompilerDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { readonly code?: unknown }).code === "ENOENT";
}

function escapeJsonPointer(segment: string): string {
  return segment.replace(/~/gu, "~0").replace(/\//gu, "~1");
}

function resolvePlatformRoot(): string {
  let current = process.cwd();
  for (;;) {
    if (existsSync(path.join(current, "PROJECT_STRUCTURE.yaml"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return process.cwd();
    }
    current = parent;
  }
}
