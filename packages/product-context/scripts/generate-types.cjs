/**
 * Deterministically generates package-local TypeScript declarations from the
 * canonical JSON Schema. The schema remains the source of truth; this script
 * only creates an ergonomic compile-time projection for server code.
 */
const { readFile, writeFile, mkdir } = require("node:fs/promises");
const { resolve, dirname } = require("node:path");
const { compile } = require("json-schema-to-typescript");

const packageRoot = resolve(__dirname, "..");
const schemaPath = resolve(packageRoot, "../../docs/architecture/schemas/product-knowledge/product-knowledge.schema.json");
const outputPath = resolve(packageRoot, "src/generated/product-knowledge.ts");
const checkOnly = process.argv.includes("--check");

async function main() {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const options = {
    bannerComment: "",
    strictIndexSignatures: true,
    unknownAny: true,
    unreachableDefinitions: true,
    ignoreMinAndMaxItems: true,
    style: { bracketSpacing: false, printWidth: 120, semi: true, singleQuote: true, tabWidth: 2, trailingComma: 'none', useTabs: false }
  };
  // The generator exposes every reachable definition through the legacy
  // `definitions` spelling. The canonical document remains 2020-12 `$defs`;
  // this in-memory compatibility projection never becomes another source file.
  const converted = JSON.parse(JSON.stringify(schema).replaceAll("#/$defs/", "#/definitions/"));
  const generatorSchema = {
    $schema: converted.$schema,
    $id: converted.$id,
    title: "ProductKnowledgeContracts",
    anyOf: ["KnowledgePage", "ExactPatchProposal", "DecisionEnvelope", "ImpactAssessment", "KnowledgeWriteOperation", "SemanticReviewResult"].map((name) => ({ $ref: `#/definitions/${name}` })),
    definitions: converted.$defs
  };
  const declaration = await compile(generatorSchema, "ProductKnowledgeContracts", options);
  const generated = "/* This file is generated from docs/architecture/schemas/product-knowledge/product-knowledge.schema.json. Do not edit it manually. */\n\n" + declaration;
  if (checkOnly) {
    const existing = await readFile(outputPath, "utf8").catch(() => "");
    if (existing !== generated) throw new Error("Generated types are stale. Run npm run generate:types.");
    return;
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, generated);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
