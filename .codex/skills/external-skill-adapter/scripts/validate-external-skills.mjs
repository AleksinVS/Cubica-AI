#!/usr/bin/env node

/**
 * Validate policy data, source drift, registry integrity, and active artifacts.
 * Optional refresh flags update hashes only; they never approve a skill.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  MEMORY_PATH,
  MEMORY_SCHEMA_PATH,
  POLICY_PATH,
  POLICY_SCHEMA_PATH,
  REGISTRY_PATH,
  REGISTRY_SCHEMA_PATH,
  REPO_ROOT,
  extractMarkdownSection,
  normalizeMarkdown,
  parseArgs,
  parseSkill,
  readJson,
  sha256,
  validateWithSchema,
  writeJson,
} from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const [policy, memory, registry] = await Promise.all([
  validateWithSchema(POLICY_SCHEMA_PATH, POLICY_PATH),
  validateWithSchema(MEMORY_SCHEMA_PATH, MEMORY_PATH),
  validateWithSchema(REGISTRY_SCHEMA_PATH, REGISTRY_PATH),
]);

const sourceIds = new Set(policy.sources.map((source) => source.id));
const ruleIds = new Set(policy.rules.map((rule) => rule.id));
const experienceIds = new Set(memory.entries.map((entry) => entry.id));
const registrySourceIds = new Set(registry.sources.map((source) => source.id));
const failures = [];

for (const rule of policy.rules) {
  rule.sourceIds.forEach((sourceId) => {
    if (!sourceIds.has(sourceId)) failures.push(`Rule ${rule.id} references unknown source ${sourceId}`);
  });
}
for (const entry of memory.entries) {
  entry.ruleIds.forEach((ruleId) => {
    if (!ruleIds.has(ruleId)) failures.push(`Experience ${entry.id} references unknown rule ${ruleId}`);
  });
}

for (const source of policy.sources) {
  const sourcePath = path.join(REPO_ROOT, source.path);
  const markdown = await readFile(sourcePath, "utf8");
  const digest = sha256(normalizeMarkdown(extractMarkdownSection(markdown, source.heading)));
  if (args["refresh-source-hashes"]) {
    source.normalizedSha256 = digest;
  } else if (digest !== source.normalizedSha256) {
    failures.push(`Policy source drift: ${source.id} (${source.path}#${source.heading})`);
  }
}

const activeCapabilities = new Map();
for (const skill of registry.skills) {
  if (!registrySourceIds.has(skill.sourceId)) failures.push(`${skill.localName} references unknown source ${skill.sourceId}`);
  skill.experienceIds.forEach((id) => {
    if (!experienceIds.has(id)) failures.push(`${skill.localName} references unknown experience ${id}`);
  });

  if (["approved", "adapted"].includes(skill.status)) {
    const previous = activeCapabilities.get(skill.capability);
    if (previous) failures.push(`Capability collision: ${skill.capability} owned by ${previous} and ${skill.localName}`);
    activeCapabilities.set(skill.capability, skill.localName);
  }

  const upstreamPath = path.join(REPO_ROOT, skill.upstreamSnapshotPath);
  const activePath = path.join(REPO_ROOT, skill.activeSkillPath);
  const [upstreamText, activeText] = await Promise.all([
    readFile(upstreamPath, "utf8"),
    readFile(activePath, "utf8"),
  ]);
  const upstreamHash = sha256(upstreamText);
  const activeHash = sha256(activeText);
  if (args["refresh-artifact-hashes"]) {
    skill.upstreamSha256 = upstreamHash;
    skill.activeSha256 = activeHash;
  } else {
    if (upstreamHash !== skill.upstreamSha256) failures.push(`Upstream hash drift: ${skill.localName}`);
    if (activeHash !== skill.activeSha256) failures.push(`Active hash drift: ${skill.localName}`);
  }

  const parsed = parseSkill(activeText, activePath);
  if (parsed.metadata.name !== skill.localName) {
    failures.push(`Frontmatter name mismatch: ${skill.localName} != ${parsed.metadata.name}`);
  }
  if (/\bTODO\b/.test(activeText)) failures.push(`Unresolved TODO in ${skill.localName}`);
  for (const pattern of policy.checks.forbiddenActivePatterns) {
    if (new RegExp(pattern, "i").test(activeText)) {
      failures.push(`Forbidden active pattern /${pattern}/ in ${skill.localName}`);
    }
  }
}

for (const source of registry.sources) {
  const last = Date.parse(source.lastCheckedAt);
  const next = Date.parse(source.nextCheckAfter);
  const minimum = last + registry.cadenceDays * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(last) || !Number.isFinite(next)) failures.push(`Invalid update date for ${source.id}`);
  if (next < minimum) failures.push(`Update cadence shorter than ${registry.cadenceDays} days for ${source.id}`);
}

if (args["refresh-source-hashes"]) await writeJson(POLICY_PATH, policy);
if (args["refresh-artifact-hashes"]) await writeJson(REGISTRY_PATH, registry);

if (failures.length > 0) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log(
  `validate-external-skills: OK (${policy.rules.length} rules, ${memory.entries.length} experiences, ${registry.skills.length} active records)`,
);
