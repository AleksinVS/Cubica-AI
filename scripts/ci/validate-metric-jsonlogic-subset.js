#!/usr/bin/env node
/**
 * Validates that every computed-metric JsonLogic expression in a shipped game
 * manifest uses only the operator subset the player-web evaluator supports
 * (LEGACY-0022).
 *
 * Why: JsonLogic is retained only for player-facing computed metrics.
 * `apps/player-web/src/lib/metric-projection.ts` intentionally implements a
 * small, documented subset, so a shipped expression outside that subset would
 * silently become `undefined` in the browser. Server-side gameplay rules use
 * typed Mechanics expressions and are deliberately outside this validator.
 *
 * SUPPORTED must stay in sync with SUPPORTED_METRIC_JSONLOGIC_OPERATORS in
 * apps/player-web/src/lib/metric-projection.ts.
 */
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const gamesRoot = path.join(repoRoot, "games");

const SUPPORTED = new Set(["var", "+", "-", "*", "/", "min", "max"]);

function fail(message) {
  console.error(`validate-metric-jsonlogic-subset: ${message}`);
  process.exit(1);
}

/** Recursively collect all game.manifest.json paths under games/. */
function collectGameManifests(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...collectGameManifests(full));
    else if (entry.name === "game.manifest.json") out.push(full);
  }
  return out;
}

/**
 * Collect the JsonLogic operator keys used in an expression tree. Each object
 * node in JsonLogic is a single `{ operator: operand }` application; scalars and
 * arrays carry no operator of their own.
 */
function collectOperators(expression, acc) {
  if (Array.isArray(expression)) {
    for (const item of expression) collectOperators(item, acc);
    return;
  }
  if (expression && typeof expression === "object") {
    const keys = Object.keys(expression);
    for (const key of keys) {
      acc.add(key);
      collectOperators(expression[key], acc);
    }
  }
}

/** Recursively find every computed metric's expression in a manifest object. */
function findComputedExpressions(node, out) {
  if (Array.isArray(node)) {
    for (const item of node) findComputedExpressions(item, out);
    return;
  }
  if (node && typeof node === "object") {
    if (node.computed && typeof node.computed === "object" && node.computed.expression !== undefined) {
      out.push({ metricId: node.metricId, expression: node.computed.expression });
    }
    for (const value of Object.values(node)) findComputedExpressions(value, out);
  }
}

function main() {
  const manifests = collectGameManifests(gamesRoot);
  if (manifests.length === 0) {
    fail("no game.manifest.json files found under games/");
  }

  const violations = [];
  let checkedExpressions = 0;

  for (const file of manifests) {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      fail(`cannot parse ${path.relative(repoRoot, file)}: ${error.message}`);
    }
    const computed = [];
    findComputedExpressions(manifest, computed);
    for (const { metricId, expression } of computed) {
      checkedExpressions += 1;
      const operators = new Set();
      collectOperators(expression, operators);
      const unsupported = [...operators].filter((op) => !SUPPORTED.has(op));
      if (unsupported.length > 0) {
        violations.push(
          `${path.relative(repoRoot, file)} metric "${metricId}" uses unsupported operator(s): ${unsupported.join(", ")}`
        );
      }
    }
  }

  if (violations.length > 0) {
    fail(
      `computed-metric expressions use operators outside the player-web subset ` +
        `[${[...SUPPORTED].join(", ")}]:\n- ${violations.join("\n- ")}`
    );
  }

  console.log(
    `validate-metric-jsonlogic-subset: OK (${manifests.length} manifests, ${checkedExpressions} computed expressions)`
  );
}

main();
