#!/usr/bin/env node
/**
 * CLI wrapper for the ADR-030 authoring manifest compiler.
 *
 * The implementation lives in `authoring-compiler.cjs` so editor-web route
 * handlers can reuse the same compiler without shelling out or duplicating
 * manifest rules.
 */

const { runCli } = require("./authoring-compiler.cjs");

try {
  runCli(process.argv);
} catch (error) {
  console.error(`compile-authoring-manifests: ${error.message}`);
  process.exit(1);
}
