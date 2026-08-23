#!/usr/bin/env node
/**
 * Proves that product-context reaches production code only through the single
 * reviewed Stage 2 server-only shadow seam.
 *
 * The editor may depend on the package and its post-response integration
 * module may import it. Every other deployable app, service, game, route, tool
 * and source import remains forbidden, so widening the migration is always an
 * explicit, reviewable change.
 */
const fs = require("node:fs");
const path = require("node:path");
const { collectModuleSpecifiers } = require("./typescript-import-analysis.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const isolatedPackage = "packages/product-context";
const isolatedPackageRoot = path.join(repoRoot, isolatedPackage);
const allowedStage2Manifest = "apps/editor-web/package.json";
const allowedStage2Import = "apps/editor-web/src/lib/product-context-shadow.ts";
const allowedForwardingImport = "apps/editor-web/src/lib/product-context-shadow-forwarding.ts";
const allowedStage2Consumers = new Set([
  "apps/editor-web/app/api/editor/agent/ag-ui/route.ts",
  "apps/editor-web/app/api/editor/agent/ag-ui/route.test.ts",
  "apps/editor-web/src/lib/product-context-shadow.test.ts"
]);
const allowedForwardingConsumers = new Set([
  "apps/editor-web/app/api/editor/agent/ag-ui/route.test.ts",
  "apps/editor-web/src/lib/editor-copilot-runtime-backend.ts",
  "apps/editor-web/src/lib/product-context-shadow.test.ts",
  "apps/editor-web/src/lib/product-context-shadow.ts"
]);
const productionRoots = ["apps", "services", "games", "packages"];
const sourceExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const ignoredDirectories = new Set([".git", ".next", ".tmp", "coverage", "dist", "node_modules"]);
const runtimeMarkers = [
  "product_context_stage1",
  "TEST_PRODUCT_CONTEXT_DATABASE_URL",
  "run-isolated-stage1",
  "knowledge.propose_change"
];
const dependencySections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const violations = [];

function relative(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

function walk(rootDirectory) {
  if (!fs.existsSync(rootDirectory)) return [];
  const files = [];
  const stack = [rootDirectory];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) stack.push(absolute);
      } else {
        files.push(absolute);
      }
    }
  }
  return files;
}

for (const root of productionRoots) {
  for (const filePath of walk(path.join(repoRoot, root))) {
    const file = relative(filePath);
    if (file === isolatedPackage || file.startsWith(`${isolatedPackage}/`)) continue;

    if (path.basename(filePath) === "package.json") {
      const manifest = JSON.parse(fs.readFileSync(filePath, "utf8"));
      for (const section of dependencySections) {
        for (const [dependency, version] of Object.entries(manifest[section] ?? {})) {
          const allowedStage2Dependency = file === allowedStage2Manifest && dependency === "@cubica/product-context";
          if (dependency === "@cubica/product-context" && !allowedStage2Dependency) {
            violations.push(`${file} declares @cubica/product-context in ${section}.`);
          }
          if (typeof version === "string" && version.startsWith("file:")) {
            const dependencyTarget = path.resolve(path.dirname(filePath), version.slice("file:".length));
            if (isInsideIsolatedPackage(dependencyTarget) && !allowedStage2Dependency) {
              violations.push(`${file} declares a file dependency on the isolated package in ${section}.`);
            }
          }
        }
      }
    }

    if (!sourceExtensions.has(path.extname(filePath))) continue;
    const source = fs.readFileSync(filePath, "utf8");
    for (const imported of collectModuleSpecifiers(source, filePath)) {
      if (/^@cubica\/product-context(?:\/|$)/u.test(imported) && file !== allowedStage2Import) {
        violations.push(`${file} imports the isolated @cubica/product-context package.`);
      }
      if (isStage2SeamImport(imported, filePath) && !allowedStage2Consumers.has(file)) {
        violations.push(`${file} imports the reviewed Stage 2 shadow seam outside its route boundary.`);
      }
      if (isForwardingBoundaryImport(imported, filePath) && !allowedForwardingConsumers.has(file)) {
        violations.push(`${file} imports the Portal bearer forwarding boundary outside its reviewed consumers.`);
      }
      if ((imported.startsWith(".") || path.isAbsolute(imported)) &&
          isInsideIsolatedPackage(path.resolve(path.dirname(filePath), imported))) {
        violations.push(`${file} reaches the isolated product-context source through ${imported}.`);
      }
    }
    for (const marker of runtimeMarkers) {
      if (source.includes(marker)) violations.push(`${file} contains isolated runtime marker ${marker}.`);
    }
  }
}

function isInsideIsolatedPackage(target) {
  return target === isolatedPackageRoot || target.startsWith(`${isolatedPackageRoot}${path.sep}`);
}

function isStage2SeamImport(imported, importerPath) {
  if (/^@\/lib\/product-context-shadow(?:\.ts)?$/u.test(imported)) return true;
  if (!imported.startsWith(".")) return false;
  const target = relative(path.resolve(path.dirname(importerPath), imported));
  return target === allowedStage2Import || `${target}.ts` === allowedStage2Import;
}

function isForwardingBoundaryImport(imported, importerPath) {
  if (/^@\/lib\/product-context-shadow-forwarding(?:\.ts)?$/u.test(imported)) return true;
  if (!imported.startsWith(".")) return false;
  const target = relative(path.resolve(path.dirname(importerPath), imported));
  return target === allowedForwardingImport || `${target}.ts` === allowedForwardingImport;
}

// The isolated package may use shared contracts and architecture schemas, but
// it must never reach upward into a deployable product by a relative import.
for (const filePath of walk(path.join(repoRoot, isolatedPackage, "src"))) {
  if (!sourceExtensions.has(path.extname(filePath))) continue;
  const file = relative(filePath);
  for (const imported of collectModuleSpecifiers(fs.readFileSync(filePath, "utf8"), filePath)) {
    if (/^(?:\.\.\/)+(?:apps|services|games)\//u.test(imported)) {
      violations.push(`${file} reaches a production root through ${imported}.`);
    }
  }
}

const rootManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
for (const command of ["verify:canonical", "verify:canonical:ci"]) {
  if (String(rootManifest.scripts?.[command] ?? "").includes("verify:product-context")) {
    violations.push(`${command} invokes the pre-migration isolated harness.`);
  }
}

if (violations.length > 0) {
  console.error("validate-product-context-isolation: failed");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("validate-product-context-isolation: OK (one reviewed Stage 2 server-only seam; all other production consumers forbidden)");
