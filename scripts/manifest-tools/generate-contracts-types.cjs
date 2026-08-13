#!/usr/bin/env node
/**
 * Schema → TypeScript generator for schema-backed public contracts (ADR-056).
 *
 * Direction of truth: JSON Schema is the single source of truth for manifest
 * structures. This tool compiles the canonical schemas into committed
 * TypeScript artifacts so schema/type drift becomes a hard, reviewable diff.
 *
 * Usage:
 *   node scripts/manifest-tools/generate-contracts-types.cjs            # write artifact
 *   node scripts/manifest-tools/generate-contracts-types.cjs --check    # fail on drift
 *   node scripts/manifest-tools/generate-contracts-types.cjs --quiet    # suppress OK log
 *   node scripts/manifest-tools/generate-contracts-types.cjs --job=name # run one named job
 */

const fs = require("node:fs");
const path = require("node:path");
const { compile } = require("json-schema-to-typescript");

const repoRoot = path.resolve(__dirname, "..", "..");

/**
 * One generation job: a source JSON Schema or OpenAPI component and the
 * committed TS artifact. Adding another schema-backed public contract extends
 * parity coverage without touching the drift-check wiring.
 */
const JOBS = [
  {
    name: "create-session-request",
    schema: path.join(repoRoot, "docs", "architecture", "runtime-api-openapi.yaml"),
    schemaPath: ["components", "schemas", "CreateSessionRequest"],
    output: path.join(repoRoot, "packages", "contracts", "session", "src", "generated", "create-session-request.ts"),
    rootName: "CreateSessionRequest",
    compileRoot: true
  },
  {
    name: "create-session-request-schema",
    schema: path.join(repoRoot, "docs", "architecture", "runtime-api-openapi.yaml"),
    schemaPath: ["components", "schemas", "CreateSessionRequest"],
    output: path.join(repoRoot, "packages", "contracts", "session", "src", "generated", "create-session-request.schema.json"),
    outputKind: "json-schema"
  },
  {
    name: "session-participant",
    schema: path.join(repoRoot, "docs", "architecture", "runtime-api-openapi.yaml"),
    schemaPath: ["components", "schemas", "SessionParticipant"],
    output: path.join(repoRoot, "packages", "contracts", "session", "src", "generated", "session-participant.ts"),
    rootName: "SessionParticipant",
    compileRoot: true
  },
  {
    name: "session-participants-schema",
    schema: path.join(repoRoot, "docs", "architecture", "runtime-api-openapi.yaml"),
    schemaPath: ["components", "schemas", "SessionParticipants"],
    output: path.join(repoRoot, "packages", "contracts", "session", "src", "generated", "session-participants.schema.json"),
    outputKind: "json-schema"
  },
  {
    name: "game-intent",
    schema: path.join(repoRoot, "docs", "architecture", "schemas", "game-intent.schema.json"),
    output: path.join(repoRoot, "packages", "contracts", "manifest", "src", "generated", "game-intent.ts"),
    rootName: "GameIntentSchemaDefs",
    validationOnlyAllOfDefinitions: ["GameManifestStringActionParamSchema"]
  },
  {
    name: "game-manifest",
    schema: path.join(repoRoot, "docs", "architecture", "schemas", "game-manifest.schema.json"),
    output: path.join(repoRoot, "packages", "contracts", "manifest", "src", "generated", "game-manifest.ts"),
    rootName: "GameManifestSchemaDefs",
    composeDelegatedContracts: true,
    validationOnlyAllOfDefinitions: ["GameManifest"]
  },
  {
    name: "game-assets",
    schema: path.join(repoRoot, "docs", "architecture", "schemas", "game-assets.schema.json"),
    output: path.join(repoRoot, "packages", "contracts", "manifest", "src", "generated", "game-assets.ts"),
    rootName: "GameAssetsSchemaDefs"
  },
  {
    name: "mechanics-plan",
    schema: path.join(repoRoot, "docs", "architecture", "schemas", "mechanics-plan.schema.json"),
    output: path.join(repoRoot, "packages", "contracts", "manifest", "src", "generated", "mechanics-plan.ts"),
    rootName: "MechanicsPlan",
    compileRoot: true
  },
  {
    name: "public-gameplay-journal",
    schema: path.join(repoRoot, "docs", "architecture", "schemas", "public-gameplay-journal.schema.json"),
    output: path.join(repoRoot, "packages", "contracts", "session", "src", "generated", "public-gameplay-journal.ts"),
    rootName: "PortablePublicGameplayJournal",
    compileRoot: true,
    validationOnlyRootAllOf: true
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
  if (job.validationOnlyRootAllOf) {
    if (!Object.prototype.hasOwnProperty.call(normalized, "allOf")) {
      throw new Error(`Type-generation normalization cannot find root allOf in ${job.schema}`);
    }
    delete normalized.allOf;
  }
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
  const sourceDocument = JSON.parse(fs.readFileSync(job.schema, "utf8"));
  let source = sourceDocument;
  for (const segment of job.schemaPath || []) {
    source = source?.[segment];
  }
  if (!source || typeof source !== "object") {
    throw new Error(`Type-generation source is missing in ${job.schema}`);
  }
  source = structuredClone(source);
  if (job.schemaPath) {
    source = inlineOpenApiComponentRefs(source, sourceDocument);
  }
  if (job.outputKind === "json-schema") {
    return `${JSON.stringify(source, null, 2)}\n`;
  }
  const schema = normalizeSchemaForTypeGeneration(source, job);
  const compileOptions = job.schemaPath
    ? {
        ...COMPILE_OPTIONS,
        bannerComment: BANNER
          .replace("canonical JSON Schema in docs/architecture/schemas/", "canonical OpenAPI component in docs/architecture/runtime-api-openapi.yaml")
          .replace("npm run generate:contracts", `node scripts/manifest-tools/generate-contracts-types.cjs --job=${job.name}`)
      }
    : COMPILE_OPTIONS;
  if (job.compileRoot) {
    return compile(schema, job.rootName, compileOptions);
  }
  const definitionsKey = schema.definitions ? "definitions" : "$defs";
  const definitions = schema[definitionsKey] || {};
  const bundle = {
    $schema: schema.$schema || "http://json-schema.org/draft-07/schema#",
    [definitionsKey]: definitions
  };
  const generated = await compile(bundle, job.rootName, compileOptions);
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

function inlineOpenApiComponentRefs(value, document) {
  if (Array.isArray(value)) return value.map((entry) => inlineOpenApiComponentRefs(entry, document));
  if (!value || typeof value !== "object") return value;
  if (typeof value.$ref === "string" && value.$ref.startsWith("#/components/schemas/")) {
    const name = value.$ref.slice("#/components/schemas/".length);
    const target = document.components?.schemas?.[name];
    if (!target) throw new Error(`OpenAPI component reference is missing: ${value.$ref}`);
    return inlineOpenApiComponentRefs(structuredClone(target), document);
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    inlineOpenApiComponentRefs(entry, document)
  ]));
}

async function run() {
  const args = new Set(process.argv.slice(2));
  const check = args.has("--check");
  const quiet = args.has("--quiet");
  const jobArg = process.argv.slice(2).find((arg) => arg.startsWith("--job="));
  const selectedJob = jobArg?.slice("--job=".length);
  const jobs = selectedJob === undefined
    ? JOBS
    : JOBS.filter((job) => job.name === selectedJob);
  if (selectedJob !== undefined && jobs.length !== 1) {
    throw new Error(`Unknown generation job: ${selectedJob}`);
  }

  let drifted = false;
  for (const job of jobs) {
    const generated = await generateOne(job);
    const relOutput = path.relative(repoRoot, job.output).replace(/\\/g, "/");

    if (check) {
      const existing = fs.existsSync(job.output) ? fs.readFileSync(job.output, "utf8") : null;
      if (existing !== generated) {
        drifted = true;
        console.error(
          `generate-contracts-types: DRIFT in ${relOutput}. ` +
          `The committed artifact no longer matches its canonical schema. ` +
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
