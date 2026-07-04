#!/usr/bin/env node
/**
 * Schema → TypeScript generator for manifest contracts (ADR-056).
 *
 * Direction of truth: JSON Schema is the single source of truth for manifest
 * structures (ADR-025). This tool compiles the canonical game-manifest JSON
 * Schema into a committed TypeScript artifact so that any drift between the
 * schema and its TypeScript projection becomes a hard, reviewable diff.
 *
 * The generated artifact is intentionally a derived, drift-checked file — it is
 * NOT hand-edited and NOT (yet) the type surface imported by consumers. The
 * hand-written contract in `packages/contracts/manifest/src/index.ts` remains
 * the consumer surface; migrating consumers onto the generated types is a
 * bounded follow-up (see the task Handoff Log). The purpose here is to make the
 * schema→TS mechanism real and enforced in CI.
 *
 * Usage:
 *   node scripts/manifest-tools/generate-contracts-types.cjs            # write artifact
 *   node scripts/manifest-tools/generate-contracts-types.cjs --check    # fail on drift
 *   node scripts/manifest-tools/generate-contracts-types.cjs --quiet    # suppress OK log
 */

const fs = require("node:fs");
const path = require("node:path");
const { compile } = require("json-schema-to-typescript");

const repoRoot = path.resolve(__dirname, "..", "..");

/**
 * One generation job: a source JSON Schema and the committed TS artifact.
 * Adding more manifest schemas here (for example ui-manifest) extends parity
 * coverage without touching the drift-check wiring.
 */
const JOBS = [
  {
    schema: path.join(repoRoot, "docs", "architecture", "schemas", "game-manifest.schema.json"),
    output: path.join(repoRoot, "packages", "contracts", "manifest", "src", "generated", "game-manifest.ts"),
    rootName: "GameManifestSchemaDefs"
  }
];

const BANNER = [
  "/* eslint-disable */",
  "/**",
  " * GENERATED FILE — DO NOT EDIT BY HAND.",
  " *",
  " * Produced by scripts/manifest-tools/generate-contracts-types.cjs from the",
  " * canonical JSON Schema in docs/architecture/schemas/ (ADR-025, ADR-056).",
  " * JSON Schema is the single source of truth; regenerate with:",
  " *   npm run generate:contracts",
  " *",
  " * CI (scripts/ci/validate-contracts-schema-parity.js) fails if this file",
  " * drifts from the schema. Type/field changes must be made in the schema.",
  " */",
  ""
].join("\n");

/**
 * Deterministic compile options. Kept stable so regeneration produces an
 * identical string for an unchanged schema (that is what the drift check relies
 * on). Prettier formatting is bundled with json-schema-to-typescript, so the
 * output does not depend on the repo's prettier version.
 */
const COMPILE_OPTIONS = {
  bannerComment: BANNER,
  additionalProperties: false,
  unreachableDefinitions: true,
  declareExternallyReferenced: true,
  enableConstEnums: false,
  format: true,
  unknownAny: true,
  style: {
    bracketSpacing: false,
    printWidth: 120,
    singleQuote: false,
    semi: true,
    trailingComma: "none"
  }
};

/**
 * Compile one manifest schema to a TypeScript string.
 *
 * The canonical manifest schema uses a root `$ref` into `definitions`
 * (`{ "$ref": "#/definitions/RootGameManifest", "definitions": {...} }`). That
 * self-referential root trips json-schema-to-typescript's ref resolver, so we
 * compile the `definitions` bundle directly and rely on `unreachableDefinitions`
 * to emit every named definition as its own exported type. Definition names map
 * 1:1 to the type names, preserving discoverability.
 */
async function generateOne(job) {
  const schema = JSON.parse(fs.readFileSync(job.schema, "utf8"));
  const definitions = schema.definitions || schema.$defs || {};
  const bundle = {
    $schema: schema.$schema || "http://json-schema.org/draft-07/schema#",
    definitions
  };
  return compile(bundle, job.rootName, COMPILE_OPTIONS);
}

async function run() {
  const args = new Set(process.argv.slice(2));
  const check = args.has("--check");
  const quiet = args.has("--quiet");

  let drifted = false;
  for (const job of JOBS) {
    const generated = await generateOne(job);
    const relOutput = path.relative(repoRoot, job.output).replace(/\\/g, "/");

    if (check) {
      const existing = fs.existsSync(job.output) ? fs.readFileSync(job.output, "utf8") : null;
      if (existing !== generated) {
        drifted = true;
        console.error(
          `generate-contracts-types: DRIFT in ${relOutput}. ` +
            `The committed TypeScript no longer matches the JSON Schema. ` +
            `Run "npm run generate:contracts" and commit the result.`
        );
      }
    } else {
      fs.mkdirSync(path.dirname(job.output), { recursive: true });
      fs.writeFileSync(job.output, generated);
      if (!quiet) {
        console.log(`generate-contracts-types: wrote ${relOutput}`);
      }
    }
  }

  if (check && drifted) {
    process.exit(1);
  }
  if (check && !quiet) {
    console.log("generate-contracts-types: OK (no drift)");
  }
}

run().catch((error) => {
  console.error(`generate-contracts-types: ${error && error.stack ? error.stack : error}`);
  process.exit(1);
});

module.exports = { generateOne, JOBS, COMPILE_OPTIONS };
