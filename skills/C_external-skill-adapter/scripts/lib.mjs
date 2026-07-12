/**
 * Shared deterministic helpers for ADR-069 external-skill tooling.
 *
 * These helpers parse structured files, collect mechanical signals, and verify
 * hashes. They deliberately do not decide whether an instruction is compatible;
 * that semantic decision belongs to the adapting agent.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import yaml from "js-yaml";
import { marked } from "marked";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(SCRIPT_DIR, "../../..");
export const POLICY_PATH = path.join(REPO_ROOT, "docs/agents/external-skills/compatibility-policy.json");
export const MEMORY_PATH = path.join(REPO_ROOT, "docs/agents/external-skills/adaptation-memory.json");
export const REGISTRY_PATH = path.join(REPO_ROOT, "docs/agents/external-skills/registry.json");
export const POLICY_SCHEMA_PATH = path.join(REPO_ROOT, "docs/architecture/schemas/external-skill-policy.schema.json");
export const MEMORY_SCHEMA_PATH = path.join(REPO_ROOT, "docs/architecture/schemas/external-skill-memory.schema.json");
export const REGISTRY_SCHEMA_PATH = path.join(REPO_ROOT, "docs/architecture/schemas/external-skill-registry.schema.json");

/** Read and parse a JSON file with its path included in parse errors. */
export async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

/** Write stable two-space JSON so reviews remain deterministic. */
export async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

/** Return a lowercase SHA-256 digest for text or bytes. */
export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** Normalize a Markdown section without hiding textual changes. */
export function normalizeMarkdown(value) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extract a heading and its body through the next heading of equal or greater
 * rank. `marked` supplies the Markdown token structure; this avoids matching a
 * heading-like string inside a code block.
 */
export function extractMarkdownSection(markdown, heading) {
  const tokens = marked.lexer(markdown);
  const start = tokens.findIndex((token) => token.type === "heading" && token.text === heading);
  if (start < 0) {
    throw new Error(`Markdown heading not found: ${heading}`);
  }

  const depth = tokens[start].depth;
  const selected = [tokens[start].raw];
  for (let index = start + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === "heading" && token.depth <= depth) break;
    selected.push(token.raw ?? "");
  }
  return selected.join("");
}

/** Parse the standard Agent Skills YAML frontmatter with a real YAML parser. */
export function parseSkill(markdown, filePath = "SKILL.md") {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) throw new Error(`Missing YAML frontmatter in ${filePath}`);
  const metadata = yaml.load(match[1]);
  if (!metadata || typeof metadata !== "object") {
    throw new Error(`Frontmatter must be an object in ${filePath}`);
  }
  return { metadata, body: markdown.slice(match[0].length) };
}

/** Find line-oriented mechanical signals configured by the policy. */
export function collectSignals(markdown, signalPatterns) {
  const signals = [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  for (const definition of signalPatterns) {
    const expression = new RegExp(definition.pattern, "i");
    lines.forEach((line, index) => {
      if (expression.test(line)) {
        signals.push({
          signalId: definition.id,
          line: index + 1,
          excerpt: line.trim().slice(0, 240),
          tags: definition.tags,
        });
      }
    });
  }
  return signals;
}

/** Validate an instance with the repository's declared JSON Schema. */
export async function validateWithSchema(schemaPath, instancePath) {
  const [schema, instance] = await Promise.all([readJson(schemaPath), readJson(instancePath)]);
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
  const validate = ajv.compile(schema);
  if (!validate(instance)) {
    const details = validate.errors.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
    throw new Error(`${instancePath} violates ${schemaPath}: ${details}`);
  }
  return instance;
}

/** Select only global rules and rules whose tags overlap the candidate tags. */
export function selectRules(policy, tags) {
  const selected = new Set(tags);
  return policy.rules.filter((rule) => rule.tags.includes("global") || rule.tags.some((tag) => selected.has(tag)));
}

/** Select active experience entries relevant to the candidate tags. */
export function selectExperience(memory, tags) {
  const selected = new Set(tags);
  return memory.entries.filter(
    (entry) => entry.status === "active" && entry.tags.some((tag) => selected.has(tag)),
  );
}

/** Compute the deterministic cache key for a bounded adaptation packet. */
export function buildCacheKey({ skillText, policy, memory, rules, experience, tags }) {
  return sha256(
    JSON.stringify({
      skillSha256: sha256(skillText),
      policyVersion: policy.policyVersion,
      memoryRevision: memory.revision,
      adapterVersion: policy.adapterVersion,
      ruleIds: rules.map((rule) => rule.id),
      experienceIds: experience.map((entry) => entry.id),
      tags: [...tags].sort(),
    }),
  );
}

/** Parse `--name value` arguments without accepting positional ambiguity. */
export function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected positional argument: ${token}`);
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
