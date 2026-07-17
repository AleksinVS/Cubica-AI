#!/usr/bin/env node
/**
 * Schema → TypeScript generator for manifest contracts (ADR-056).
 *
 * Direction of truth: JSON Schema is the single source of truth for manifest
 * structures. This tool compiles the canonical schemas into committed
 * TypeScript artifacts so schema/type drift becomes a hard, reviewable diff.
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
    schema: path.join(repoRoot, "docs", "architecture", "schemas", "game-intent.schema.json"),
    output: path.join(repoRoot, "packages", "contracts", "manifest", "src", "generated", "game-intent.ts"),
    rootName: "GameIntentSchemaDefs",
    validationOnlyAllOfDefinitions: ["GameManifestStringActionParamSchema"]
  },
  {
    schema: path.join(repoRoot, "docs", "architecture", "schemas", "game-manifest.schema.json"),
    output: path.join(repoRoot, "packages", "contracts", "manifest", "src", "generated", "game-manifest.ts"),
    rootName: "GameManifestSchemaDefs",
    composeDelegatedContracts: true,
    validationOnlyAllOfDefinitions: ["GameManifest"]
  },
  {
    schema: path.join(repoRoot, "docs", "architecture", "schemas", "game-assets.schema.json"),
    output: path.join(repoRoot, "packages", "contracts", "manifest", "src", "generated", "game-assets.ts"),
    rootName: "GameAssetsSchemaDefs"
  },
  {
    schema: path.join(repoRoot, "docs", "architecture", "schemas", "mechanics-plan.schema.json"),
    output: path.join(repoRoot, "packages", "contracts", "manifest", "src", "generated", "mechanics-plan.ts"),
    rootName: "MechanicsPlan",
    compileRoot: true
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
 * Remove validation-only conditionals that TypeScript cannot represent.
 *
 * json-schema-to-typescript turns an object containing `allOf` into an
 * intersection with `{[key: string]: unknown}`, even when the canonical schema
 * is closed with `additionalProperties: false`. The listed conditionals only
 * narrow runtime values (the AI-mode manifest invariant and the shorter
 * resource-reference string); deleting them from this in-memory copy preserves
 * the useful structural TypeScript projection without changing the JSON Schema
 * that Ajv executes.
 */
function normalizeSchemaForTypeGeneration(schema, job) {
  const normalized = structuredClone(schema);
  const definitions = normalized.definitions || normalized.$defs || {};
  for (const definitionName of job.validationOnlyAllOfDefinitions || []) {
    const definition = definitions[definitionName];
    if (!definition || !Object.prototype.hasOwnProperty.call(definition, "allOf")) {
      throw new Error(`Type-generation normalization cannot find ${definitionName}.allOf in ${job.schema}`);
    }
    delete definition.allOf;
  }
  return normalized;
}

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
  const schema = normalizeSchemaForTypeGeneration(
    JSON.parse(fs.readFileSync(job.schema, "utf8")),
    job
  );
  if (job.compileRoot) {
    return compile(schema, job.rootName, COMPILE_OPTIONS);
  }
  const definitionsKey = schema.definitions ? "definitions" : "$defs";
  const definitions = schema[definitionsKey] || {};
  const bundle = {
    $schema: schema.$schema || "http://json-schema.org/draft-07/schema#",
    [definitionsKey]: definitions
  };
  const generated = await compile(bundle, job.rootName, COMPILE_OPTIONS);
  if (!job.composeDelegatedContracts) return generated;

  // The draft-07 manifest envelope delegates both actor-facing Game Intents and
  // Mechanics IR to independent 2020-12 schemas. Compose their independently
  // generated types here so GameManifest remains schema-derived end to end.
  const importLines = [
    'import type {GameIntentCatalog} from "./game-intent.ts";',
    'import type {CubicaMechanicsIRV1Alpha1} from "./mechanics-plan.ts";',
    ""
  ].join("\n");
  let composed = generated.replace(BANNER, `${BANNER}${importLines}\n`);
  for (const [field, typeName] of [
    ["actions", "GameIntentCatalog"],
    ["mechanics", "CubicaMechanicsIRV1Alpha1"]
  ]) {
    const before = composed;
    composed = composed.replace(`  ${field}: {};`, `  ${field}: ${typeName};`);
    if (composed === before) {
      throw new Error(`Generated GameManifest no longer contains the expected delegated ${field} field`);
    }
  }
  return composed;
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

module.exports = { generateOne, normalizeSchemaForTypeGeneration, JOBS, COMPILE_OPTIONS };
