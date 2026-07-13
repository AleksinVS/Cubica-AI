#!/usr/bin/env node

/**
 * Validate the task-local contract that fills gaps a static UI image cannot
 * express. JSON Schema owns structure; this script only checks relationships,
 * artifact hashes, and the Cubica boundary between agent and PM decisions.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(HERE, "../schemas/reference-brief.schema.json");

async function loadAjv() {
  try {
    return (await import("ajv")).default;
  } catch {
    return (await import(pathToFileURL(path.join(process.cwd(), "node_modules/ajv/dist/ajv.js")).href)).default;
  }
}

function sha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function uniqueIds(items, label, errors) {
  const seen = new Set();
  for (const item of items || []) {
    if (seen.has(item.id)) errors.push(`${label}: повторяется id ${item.id}`);
    seen.add(item.id);
  }
}

function validateArtifact(entry, label, baseDir, errors) {
  const resolved = path.resolve(baseDir, entry.path);
  if (!fs.existsSync(resolved)) {
    errors.push(`${label}: не найден файл ${entry.path}`);
    return;
  }
  if (sha256(resolved) !== entry.sha256) errors.push(`${label}: SHA-256 не совпадает для ${entry.path}`);
}

export async function validateBrief(briefPath) {
  const Ajv = await loadAjv();
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
  const brief = JSON.parse(fs.readFileSync(briefPath, "utf8"));
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  const errors = [];
  const warnings = [];
  if (!validate(brief)) {
    errors.push(...validate.errors.map((error) => `${error.instancePath || "/"} ${error.message}`));
    return { valid: false, errors, warnings, brief };
  }

  const baseDir = process.cwd();
  uniqueIds(brief.references, "references", errors);
  uniqueIds(brief.states, "states", errors);
  uniqueIds(brief.interactions, "interactions", errors);
  uniqueIds(brief.uncertainties, "uncertainties", errors);
  uniqueIds(brief.acceptance, "acceptance", errors);

  const stateIds = new Set(brief.states.map((state) => state.id));
  for (const reference of brief.references) {
    validateArtifact(reference, `reference ${reference.id}`, baseDir, errors);
    if (!stateIds.has(reference.state)) errors.push(`reference ${reference.id}: неизвестное состояние ${reference.state}`);
  }
  for (const [name, artifact] of Object.entries(brief.reuse || {})) {
    validateArtifact(artifact, `reuse ${name}`, baseDir, errors);
  }

  if (brief.scope !== "patch" && brief.responsiveRules.length === 0) {
    errors.push(`${brief.scope}: требуется хотя бы одно явное адаптивное правило`);
  }
  if (!brief.acceptance.some((criterion) => criterion.kind === "visual")) {
    errors.push("acceptance: требуется визуальный критерий");
  }
  for (const uncertainty of brief.uncertainties) {
    if (uncertainty.resolution === "pending") {
      errors.push(`uncertainty ${uncertainty.id}: решение ещё не принято`);
    }
    if (["product", "architecture"].includes(uncertainty.impact) && uncertainty.resolution !== "pm") {
      errors.push(`uncertainty ${uncertainty.id}: ${uncertainty.impact} может решить только PM`);
    }
  }
  for (const reference of brief.references) {
    if (!reference.path.startsWith(".tmp/") && !path.isAbsolute(reference.path)) {
      warnings.push(`reference ${reference.id}: временный образец обычно хранится в .tmp/`);
    }
  }
  return { valid: errors.length === 0, errors, warnings, brief };
}

async function main(argv) {
  const briefPath = argv.find((arg) => !arg.startsWith("--"));
  if (!briefPath) throw new Error("Использование: validate-reference-brief.mjs <brief.json> [--ci]");
  const result = await validateBrief(briefPath);
  console.log(`JSON Schema: ${SCHEMA_PATH}`);
  for (const warning of result.warnings) console.log(`  ПРЕДУПРЕЖДЕНИЕ: ${warning}`);
  for (const error of result.errors) console.log(`  ОШИБКА: ${error}`);
  console.log(`СТАТУС: ${result.valid ? "PASS" : "FAIL"}`);
  if (argv.includes("--ci") && !result.valid) process.exitCode = 2;
}

if (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
