#!/usr/bin/env node
/**
 * Proves that the Stage 1 product-knowledge package remains a closed harness.
 *
 * Stage 1 is deliberately installable in the monorepo but must not influence
 * a deployed application, service, game, assistant registry, route or tool.
 * This check fails on both dependency-level and source-level integration so a
 * later migration has to be an explicit, reviewable change.
 */
const fs = require("node:fs");
const path = require("node:path");
const { collectModuleSpecifiers } = require("./typescript-import-analysis.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const isolatedPackage = "packages/product-context";
const isolatedPackageRoot = path.join(repoRoot, isolatedPackage);
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
          if (dependency === "@cubica/product-context") {
            violations.push(`${file} declares @cubica/product-context in ${section}.`);
          }
          if (typeof version === "string" && version.startsWith("file:")) {
            const dependencyTarget = path.resolve(path.dirname(filePath), version.slice("file:".length));
            if (isInsideIsolatedPackage(dependencyTarget)) {
              violations.push(`${file} declares a file dependency on the isolated package in ${section}.`);
            }
          }
        }
      }
    }

    if (!sourceExtensions.has(path.extname(filePath))) continue;
    const source = fs.readFileSync(filePath, "utf8");
    for (const imported of collectModuleSpecifiers(source, filePath)) {
      if (/^@cubica\/product-context(?:\/|$)/u.test(imported)) {
        violations.push(`${file} imports the isolated @cubica/product-context package.`);
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

console.log("validate-product-context-isolation: OK (zero production dependents, imports, routes, tools, or runtime markers)");
