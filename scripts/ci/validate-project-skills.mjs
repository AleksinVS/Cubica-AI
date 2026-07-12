#!/usr/bin/env node

/**
 * Validate the one-copy project skill catalog required by ADR-070.
 *
 * The registry is checked by JSON Schema first. Filesystem checks then prove
 * that Codex discovers the canonical skills only through symbolic links, so a
 * second active copy cannot silently diverge from the shared catalog.
 */

import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import yaml from "js-yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SKILLS_ROOT = path.join(ROOT, "skills");
const CODEX_SKILLS_ROOT = path.join(ROOT, ".codex/skills");
const REGISTRY_PATH = path.join(SKILLS_ROOT, "registry.json");
const SCHEMA_PATH = path.join(ROOT, "docs/architecture/schemas/project-skill-registry.schema.json");
const EXTERNAL_REGISTRY_PATH = path.join(ROOT, "docs/agents/external-skills/registry.json");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function parseSkillName(markdown, filePath) {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) throw new Error(`Missing YAML frontmatter in ${filePath}`);
  const metadata = yaml.load(match[1]);
  if (!metadata || typeof metadata.name !== "string") {
    throw new Error(`Missing skill name in ${filePath}`);
  }
  return metadata.name;
}

async function expectSymlink(linkPath, targetPath, failures) {
  try {
    const stat = await lstat(linkPath);
    if (!stat.isSymbolicLink()) {
      failures.push(`Codex bridge must be a symbolic link: ${path.relative(ROOT, linkPath)}`);
      return;
    }
    const actualTarget = path.resolve(path.dirname(linkPath), await readlink(linkPath));
    if (actualTarget !== targetPath) {
      failures.push(`Codex bridge target mismatch: ${path.relative(ROOT, linkPath)}`);
    }
  } catch {
    failures.push(`Missing Codex bridge: ${path.relative(ROOT, linkPath)}`);
  }
}

const [schema, registry, externalRegistry] = await Promise.all([
  readJson(SCHEMA_PATH),
  readJson(REGISTRY_PATH),
  readJson(EXTERNAL_REGISTRY_PATH),
]);
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
const failures = [];
if (!validate(registry)) {
  failures.push(...validate.errors.map((error) => `Registry schema: ${error.instancePath || "/"} ${error.message}`));
}

const catalogNames = new Set();
const runtimeNames = new Set();
const capabilities = new Set();
const expectedBridges = new Set(["AGENTS.md"]);
for (const skill of registry.skills) {
  for (const [value, label, set] of [
    [skill.catalogName, "catalog name", catalogNames],
    [skill.runtimeName, "runtime name", runtimeNames],
    [skill.capability, "capability", capabilities],
  ]) {
    if (set.has(value)) failures.push(`Duplicate ${label}: ${value}`);
    set.add(value);
  }

  const canonicalPath = path.join(ROOT, skill.canonicalSkillPath);
  try {
    const name = parseSkillName(await readFile(canonicalPath, "utf8"), canonicalPath);
    if (name !== skill.runtimeName) {
      failures.push(`Runtime name mismatch for ${skill.catalogName}: ${name}`);
    }
  } catch (error) {
    failures.push(error.message);
  }

  const bridgePath = path.join(CODEX_SKILLS_ROOT, skill.catalogName);
  await expectSymlink(bridgePath, path.dirname(canonicalPath), failures);
  expectedBridges.add(skill.catalogName);

  if (skill.origin === "adapted") {
    const external = externalRegistry.skills.find((entry) => entry.localName === skill.runtimeName);
    if (!external) {
      failures.push(`Missing external provenance for ${skill.catalogName}`);
    } else if (external.activeSkillPath !== skill.canonicalSkillPath) {
      failures.push(`External provenance path mismatch for ${skill.catalogName}`);
    }
  }
}

await expectSymlink(path.join(CODEX_SKILLS_ROOT, "AGENTS.md"), path.join(SKILLS_ROOT, "AGENTS.md"), failures);
const bridgeEntries = await readdir(CODEX_SKILLS_ROOT, { withFileTypes: true });
for (const entry of bridgeEntries) {
  if (!expectedBridges.has(entry.name)) {
    failures.push(`Unexpected active Codex skill entry: ${entry.name}`);
  }
}

if (failures.length > 0) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(`validate-project-skills: OK (${registry.skills.length} canonical skills, ${expectedBridges.size} Codex bridges)`);
