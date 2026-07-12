#!/usr/bin/env node

/**
 * Build the small evidence packet an agent uses for semantic adaptation.
 * The script never labels a signal as a conflict or approves a skill.
 */

import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import {
  MEMORY_PATH,
  POLICY_PATH,
  REPO_ROOT,
  buildCacheKey,
  collectSignals,
  parseArgs,
  parseSkill,
  readJson,
  selectExperience,
  selectRules,
  sha256,
} from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.skill || !args.tags) {
  throw new Error("Usage: prepare-adaptation.mjs --skill <path> --tags <comma-list> [--output <path>] [--force]");
}

const skillPath = path.resolve(REPO_ROOT, args.skill);
// Every candidate is an adaptation requiring semantic review. Add these tags
// centrally so callers cannot accidentally omit the accumulated core lessons.
const tags = [
  ...new Set([
    ...String(args.tags).split(",").map((tag) => tag.trim()).filter(Boolean),
    "adaptation",
    "semantics",
  ]),
];
const [skillText, policy, memory] = await Promise.all([
  readFile(skillPath, "utf8"),
  readJson(POLICY_PATH),
  readJson(MEMORY_PATH),
]);
const parsedSkill = parseSkill(skillText, skillPath);
const rules = selectRules(policy, tags);
const experience = selectExperience(memory, tags);
const cacheKey = buildCacheKey({ skillText, policy, memory, rules, experience, tags });
const cacheDir = path.join(REPO_ROOT, ".cache/external-skill-adapter");
const cachePath = path.join(cacheDir, `${cacheKey}.json`);
const outputPath = path.resolve(
  REPO_ROOT,
  args.output ?? `.tmp/external-skill-adapter/${parsedSkill.metadata.name}.packet.json`,
);

await mkdir(path.dirname(outputPath), { recursive: true });
await mkdir(cacheDir, { recursive: true });

if (!args.force) {
  try {
    await copyFile(cachePath, outputPath);
    console.log(`prepare-adaptation: cache hit ${cacheKey}`);
    console.log(outputPath);
    process.exit(0);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const packet = {
  schemaVersion: "1.0",
  decisionOwner: "agent",
  warning: "Mechanical signals are evidence, not semantic compatibility decisions.",
  projectReading: {
    allowed: true,
    guidance: "Read targeted project sources when the packet is insufficient; record reusable findings in adaptation-memory.json.",
  },
  candidate: {
    path: path.relative(REPO_ROOT, skillPath),
    name: parsedSkill.metadata.name,
    description: parsedSkill.metadata.description,
    sha256: sha256(skillText),
  },
  tags,
  policy: {
    version: policy.policyVersion,
    adapterVersion: policy.adapterVersion,
    rules,
  },
  memory: {
    revision: memory.revision,
    entries: experience,
  },
  signals: collectSignals(skillText, policy.checks.signalPatterns),
  cacheKey,
};

const serialized = `${JSON.stringify(packet, null, 2)}\n`;
await Promise.all([writeFile(cachePath, serialized), writeFile(outputPath, serialized)]);
console.log(`prepare-adaptation: created ${cacheKey}`);
console.log(outputPath);
