#!/usr/bin/env node

/**
 * Validate the one-copy project skill catalog required by ADR-070.
 *
 * The registry is checked by JSON Schema first. Filesystem checks then prove
 * that Codex discovers the canonical skills only through symbolic links, so a
 * second active copy cannot silently diverge from the shared catalog.
 */

import { createHash } from "node:crypto";
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
const CANDIDATE_ROOT = path.join(ROOT, "skill-candidates");
const CANDIDATE_REGISTRY_PATH = path.join(CANDIDATE_ROOT, "registry.json");
const CANDIDATE_SCHEMA_PATH = path.join(ROOT, "docs/architecture/schemas/skill-candidate-registry.schema.json");

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

async function listSnapshotFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listSnapshotFiles(path.join(directory, entry.name), relative));
    } else if (entry.name !== ".desc.json") {
      files.push(relative);
    }
  }
  return files.sort();
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

const [schema, registry, externalRegistry, candidateSchema, candidateRegistry] = await Promise.all([
  readJson(SCHEMA_PATH),
  readJson(REGISTRY_PATH),
  readJson(EXTERNAL_REGISTRY_PATH),
  readJson(CANDIDATE_SCHEMA_PATH),
  readJson(CANDIDATE_REGISTRY_PATH),
]);
const ajv = new Ajv({
  allErrors: true,
  strict: false,
  formats: { uri: true, "date-time": true },
});
const validate = ajv.compile(schema);
const validateCandidates = ajv.compile(candidateSchema);
const failures = [];
if (!validate(registry)) {
  failures.push(...validate.errors.map((error) => `Registry schema: ${error.instancePath || "/"} ${error.message}`));
}
if (!validateCandidates(candidateRegistry)) {
  failures.push(...validateCandidates.errors.map(
    (error) => `Candidate registry schema: ${error.instancePath || "/"} ${error.message}`
  ));
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

// Dependencies are catalog names rather than runtime names so every agent
// resolves the same canonical directory. Missing nodes and cycles would make
// automatic activation order-dependent, therefore both are CI failures.
const dependencyGraph = new Map();
for (const skill of registry.skills) {
  const dependencies = skill.requires || [];
  dependencyGraph.set(skill.catalogName, dependencies);
  for (const dependency of dependencies) {
    if (!catalogNames.has(dependency)) {
      failures.push(`Missing dependency for ${skill.catalogName}: ${dependency}`);
    }
    if (dependency === skill.catalogName) {
      failures.push(`Skill cannot require itself: ${skill.catalogName}`);
    }
  }
}
const visited = new Set();
const visiting = new Set();
function visitDependencies(name, trail) {
  if (visiting.has(name)) {
    failures.push(`Cyclic skill dependency: ${[...trail, name].join(" -> ")}`);
    return;
  }
  if (visited.has(name)) return;
  visiting.add(name);
  for (const dependency of dependencyGraph.get(name) || []) {
    if (dependencyGraph.has(dependency)) visitDependencies(dependency, [...trail, name]);
  }
  visiting.delete(name);
  visited.add(name);
}
for (const name of dependencyGraph.keys()) visitDependencies(name, []);

// Candidate snapshots are deliberately outside both active roots. Their
// registry is a tamper-evident inventory: any added or changed upstream file
// must be reviewed and recorded before CI accepts it.
const candidateIds = new Set();
for (const candidate of candidateRegistry.candidates || []) {
  if (candidateIds.has(candidate.id)) failures.push(`Duplicate candidate id: ${candidate.id}`);
  candidateIds.add(candidate.id);

  const importPath = path.resolve(ROOT, candidate.importedPath);
  const relativeToCandidates = path.relative(CANDIDATE_ROOT, importPath);
  if (!relativeToCandidates || relativeToCandidates.startsWith("..") || path.isAbsolute(relativeToCandidates)) {
    failures.push(`Candidate must stay under skill-candidates/: ${candidate.importedPath}`);
    continue;
  }
  if (candidate.activation !== "forbidden") {
    failures.push(`Candidate activation must be forbidden: ${candidate.id}`);
  }
  if (registry.skills.some((skill) => path.resolve(ROOT, skill.canonicalSkillPath).startsWith(`${importPath}${path.sep}`))) {
    failures.push(`Candidate is present in the active registry: ${candidate.id}`);
  }

  const declared = new Map();
  for (const file of candidate.files || []) {
    if (declared.has(file.path)) failures.push(`Duplicate candidate file: ${candidate.id}/${file.path}`);
    declared.set(file.path, file.sha256);
    const filePath = path.resolve(importPath, file.path);
    const relativeToImport = path.relative(importPath, filePath);
    if (!relativeToImport || relativeToImport.startsWith("..") || path.isAbsolute(relativeToImport)) {
      failures.push(`Candidate file escapes its snapshot: ${candidate.id}/${file.path}`);
      continue;
    }
    try {
      const stat = await lstat(filePath);
      if (!stat.isFile()) {
        failures.push(`Candidate snapshot entry must be a regular file: ${candidate.id}/${file.path}`);
      } else if (sha256(await readFile(filePath)) !== file.sha256) {
        failures.push(`Candidate snapshot hash mismatch: ${candidate.id}/${file.path}`);
      }
    } catch {
      failures.push(`Missing candidate snapshot file: ${candidate.id}/${file.path}`);
    }
  }
  if (!declared.has("SKILL.md")) failures.push(`Candidate snapshot has no declared SKILL.md: ${candidate.id}`);
  try {
    const actualFiles = await listSnapshotFiles(importPath);
    for (const actual of actualFiles) {
      if (!declared.has(actual)) failures.push(`Unregistered candidate snapshot file: ${candidate.id}/${actual}`);
    }
    for (const expected of declared.keys()) {
      if (!actualFiles.includes(expected)) failures.push(`Declared candidate file is absent: ${candidate.id}/${expected}`);
    }
  } catch {
    failures.push(`Missing candidate snapshot directory: ${candidate.importedPath}`);
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
console.log(
  `validate-project-skills: OK (${registry.skills.length} canonical skills, ` +
  `${candidateRegistry.candidates.length} inactive candidates, ${expectedBridges.size} Codex bridges)`
);
