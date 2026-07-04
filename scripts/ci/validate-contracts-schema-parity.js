#!/usr/bin/env node
/**
 * Validates ADR-056 schema → TypeScript contract parity.
 *
 * Parity means the committed TypeScript projection of the manifest JSON Schema
 * exactly matches what the generator produces from the current schema. JSON
 * Schema is the single source of truth (ADR-025); the TypeScript artifact is
 * derived. This check regenerates the artifact in memory and fails the build if
 * the committed file differs, so schema/TS drift (like the historical
 * `overrides` gap) becomes a hard CI error instead of a silent divergence.
 *
 * It mirrors the authoring-compiler drift check in
 * scripts/ci/validate-manifest-authoring.js: it shells out to the generator in
 * `--check` mode and surfaces its diagnostics.
 */

const path = require("node:path");
const { execFileSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..");

function fail(message) {
  console.error(`validate-contracts-schema-parity: ${message}`);
  process.exit(1);
}

function main() {
  try {
    execFileSync(
      process.execPath,
      [path.join(repoRoot, "scripts", "manifest-tools", "generate-contracts-types.cjs"), "--check", "--quiet"],
      { cwd: repoRoot, stdio: "pipe" }
    );
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : "";
    const stdout = error.stdout ? String(error.stdout).trim() : "";
    fail([stderr, stdout].filter(Boolean).join("\n") || error.message);
  }
  console.log("validate-contracts-schema-parity: OK");
}

main();
