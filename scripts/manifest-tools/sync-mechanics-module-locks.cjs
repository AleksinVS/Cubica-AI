#!/usr/bin/env node
/**
 * Synchronize compiler-owned Mechanics locks through the manifest compiler.
 *
 * A module lock pins the exact executable Mechanics modules used by a game.
 * Authors declare plans, while the compiler derives the dependency-closed lock
 * and all hashes that depend on it. Rewriting only `moduleLock` would leave
 * plan/action hashes inconsistent, so this command intentionally regenerates
 * the complete published manifest from its authoring source.
 *
 * Usage:
 *   node scripts/manifest-tools/sync-mechanics-module-locks.cjs
 *   node scripts/manifest-tools/sync-mechanics-module-locks.cjs --check
 */

const fs = require("node:fs");
const path = require("node:path");
const { run } = require("./authoring-compiler.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");

const inputRoots = [
  path.join(repoRoot, "games"),
  path.join(repoRoot, "docs", "architecture", "schemas", "examples", "authoring-v2")
];

async function main(argv = process.argv) {
  const checkOnly = argv.slice(2).includes("--check");
  const sourceViolations = findSourceModuleLocks();
  if (sourceViolations.length > 0) {
    throw new Error(
      "moduleLock is compiler-owned and must not appear in authoring:\n- " +
        sourceViolations.join("\n- ")
    );
  }

  const result = await run({ check: checkOnly, quiet: true });
  console.log(checkOnly
    ? `sync-mechanics-module-locks: OK (${result.jobs.length} compiled manifests are current)`
    : `sync-mechanics-module-locks: regenerated ${result.jobs.length} compiled manifests`);
}

function discoverAuthoringJson(roots) {
  const files = [];
  for (const root of roots) walk(root, files);
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

function walk(current, files) {
  if (!fs.existsSync(current)) return;
  const stat = fs.statSync(current);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(current).sort()) {
      const child = path.join(current, entry);
      // Only editable game authoring trees are inputs. Published/generated
      // artifacts under each game are intentionally left to their compilers.
      if (current === path.join(repoRoot, "games") && !fs.statSync(child).isDirectory()) continue;
      walk(child, files);
    }
    return;
  }
  if (!current.endsWith(".json")) return;
  if (current.startsWith(path.join(repoRoot, "games")) && !current.includes(`${path.sep}authoring${path.sep}`)) {
    return;
  }
  files.push(current);
}

function findSourceModuleLocks() {
  const violations = [];
  for (const filePath of discoverAuthoringJson(inputRoots)) {
    const document = JSON.parse(fs.readFileSync(filePath, "utf8"));
    for (const pointer of collectSourceModuleLocks(document)) {
      violations.push(`${path.relative(repoRoot, filePath).replace(/\\/g, "/")}${pointer}`);
    }
  }
  return violations;
}

function collectSourceModuleLocks(value, pointer = "") {
  const matches = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      matches.push(...collectSourceModuleLocks(item, `${pointer}/${index}`));
    });
    return matches;
  }
  if (!isRecord(value)) return matches;
  if (
    value.apiVersion === "cubica.dev/mechanics/v1alpha1" &&
    Object.prototype.hasOwnProperty.call(value, "moduleLock")
  ) {
    matches.push(`${pointer}/moduleLock`);
  }
  for (const [key, child] of Object.entries(value)) {
    const segment = key.replace(/~/g, "~0").replace(/\//g, "~1");
    matches.push(...collectSourceModuleLocks(child, `${pointer}/${segment}`));
  }
  return matches;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`sync-mechanics-module-locks: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  collectSourceModuleLocks,
  discoverAuthoringJson,
  findSourceModuleLocks,
  main
};
