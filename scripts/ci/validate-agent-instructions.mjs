#!/usr/bin/env node
/**
 * Validates the repository's active AGENTS instructions without mutating them.
 *
 * An active instruction is the nearest policy file for a directory.  An
 * AGENTS.override.md in the same directory deliberately replaces AGENTS.md,
 * mirroring the precedence rule used by agent hosts.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { renderClaudeRules } = require("../dev/generate-claude-rules.cjs");

export const DEFAULT_PROJECT_DOC_MAX_BYTES = 32_768;
export const ROOT_AGENT_MAX_BYTES = 16 * 1024;
export const CHAIN_AGENT_MAX_BYTES = 28 * 1024;

// These are generated, dependency, archive, or temporary trees. Their policy
// files are not part of the live repository instruction chain.
const EXCLUDED_DIRECTORIES = new Set([
  ".cache", ".git", ".next", ".output", ".parcel-cache", ".svelte-kit",
  ".tmp", ".turbo", ".vercel", ".vite", "archive", "build", "cache",
  "coverage", "dist", "node_modules", "out", "target", "vendor"
]);

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function formatPath(repoRoot, filePath) {
  const relative = path.relative(repoRoot, filePath);
  return relative ? toPosix(relative) : ".";
}

export function readProjectDocMaxBytes(repoRoot) {
  const configPath = path.join(repoRoot, ".codex", "config.toml");
  if (!existsSync(configPath)) return DEFAULT_PROJECT_DOC_MAX_BYTES;
  const assignments = readFileSync(configPath, "utf8")
    .split(/\r?\n/u)
    .filter((line) => /^\s*project_doc_max_bytes\s*=/u.test(line));
  if (assignments.length === 0) return DEFAULT_PROJECT_DOC_MAX_BYTES;
  if (assignments.length > 1) {
    throw new Error(".codex/config.toml: project_doc_max_bytes is assigned more than once");
  }

  const rawValue = assignments[0].replace(/#.*$/u, "").split("=", 2)[1].trim();
  // TOML permits underscores only between digits. Accept an optional positive
  // sign, then fail closed for strings, floats, negative or malformed values.
  if (!/^\+?[0-9](?:_?[0-9])*$/u.test(rawValue)) {
    throw new Error(".codex/config.toml: project_doc_max_bytes must be a positive TOML integer");
  }
  const value = Number(rawValue.replaceAll("_", "").replace(/^\+/u, ""));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(".codex/config.toml: project_doc_max_bytes must be a positive safe integer");
  }
  return value;
}

export function isExcludedDirectory(name) {
  return EXCLUDED_DIRECTORIES.has(name);
}

/** Discover active files in stable path order, while avoiding inactive trees. */
export function findActiveInstructionFiles(repoRoot) {
  const active = [];
  function visit(directory) {
    const names = readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    const nameSet = new Set(names.map((entry) => entry.name));
    if (nameSet.has("AGENTS.override.md")) active.push(path.join(directory, "AGENTS.override.md"));
    else if (nameSet.has("AGENTS.md")) active.push(path.join(directory, "AGENTS.md"));

    for (const entry of names) {
      if (entry.isDirectory() && !isExcludedDirectory(entry.name)) visit(path.join(directory, entry.name));
    }
  }
  visit(repoRoot);
  return active.sort((left, right) => formatPath(repoRoot, left).localeCompare(formatPath(repoRoot, right)));
}

function activeFileInDirectory(directory) {
  const override = path.join(directory, "AGENTS.override.md");
  if (existsSync(override)) return override;
  const standard = path.join(directory, "AGENTS.md");
  return existsSync(standard) ? standard : null;
}

/** Return the applicable root-to-directory policy chain for one active file. */
export function instructionChain(repoRoot, activeFile) {
  const chain = [];
  let directory = path.dirname(activeFile);
  while (true) {
    const candidate = activeFileInDirectory(directory);
    if (candidate) chain.push(candidate);
    if (path.resolve(directory) === path.resolve(repoRoot)) break;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return chain.reverse();
}

function stripInlineCode(markdown) {
  // Removing code spans first prevents examples such as `[x](missing.md)` from
  // being mistaken for live Markdown links.
  return markdown.replace(/`[^`]*`/gu, "");
}

function normalizeReferenceLabel(label) {
  return label.trim().replace(/\s+/gu, " ").toLowerCase();
}

function markdownLinks(markdown) {
  const source = stripInlineCode(markdown);
  const targets = [];
  const definitions = new Map();
  const definitionExpression = /^[ \t]{0,3}\[([^\]]+)\]:[ \t]*(?:<([^>\r\n]+)>|([^\s]+))(?:[ \t]+.*)?[ \t]*$/gmu;
  for (const match of source.matchAll(definitionExpression)) {
    const label = normalizeReferenceLabel(match[1]);
    const target = match[2] ?? match[3];
    definitions.set(label, target);
    targets.push(target);
  }

  const inlineExpression = /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/gu;
  for (const match of source.matchAll(inlineExpression)) targets.push(match[1] ?? match[2]);

  const withoutDefinitions = source.replace(definitionExpression, "");
  const withoutInlineLinks = withoutDefinitions.replace(inlineExpression, "");
  const missingReferences = [];
  const referenceExpression = /!?\[([^\]]+)\]\[([^\]]*)\]/gu;
  for (const match of withoutInlineLinks.matchAll(referenceExpression)) {
    const label = normalizeReferenceLabel(match[2] || match[1]);
    if (!definitions.has(label)) missingReferences.push(label);
  }
  return { targets, missingReferences };
}

function isAbsoluteFileTarget(target) {
  return target.startsWith("file:") || path.isAbsolute(target) || path.win32.isAbsolute(target);
}

export function validateMarkdownLinks(repoRoot, filePath) {
  const violations = [];
  const links = markdownLinks(readFileSync(filePath, "utf8"));
  for (const label of links.missingReferences) {
    violations.push(`${formatPath(repoRoot, filePath)}: Markdown reference is not defined: ${label}`);
  }
  for (const rawTarget of links.targets) {
    const target = rawTarget.split("#", 1)[0];
    if (!target || /^(https?:|mailto:)/iu.test(target)) continue;
    if (isAbsoluteFileTarget(target)) {
      violations.push(`${formatPath(repoRoot, filePath)}: absolute Markdown link is forbidden: ${rawTarget}`);
      continue;
    }
    // Query strings are not file names; anchors were already removed above.
    const localTarget = target.split("?", 1)[0];
    if (localTarget && !existsSync(path.resolve(path.dirname(filePath), localTarget))) {
      violations.push(`${formatPath(repoRoot, filePath)}: Markdown link target does not exist: ${rawTarget}`);
    }
  }
  return violations;
}

export function validateAgentInstructions(repoRoot = process.cwd()) {
  const root = path.resolve(repoRoot);
  const violations = [];
  // Keep local policy below both our safety margin and the host's actual cap.
  // The margin leaves room for host-level instructions that are outside the
  // repository and therefore cannot be measured here.
  let configuredLimit = DEFAULT_PROJECT_DOC_MAX_BYTES;
  try {
    configuredLimit = readProjectDocMaxBytes(root);
  } catch (error) {
    violations.push(error instanceof Error ? error.message : String(error));
  }
  const limit = Math.min(CHAIN_AGENT_MAX_BYTES, configuredLimit);
  const rootAgents = path.join(root, "AGENTS.md");
  const rootOverride = path.join(root, "AGENTS.override.md");
  if (existsSync(rootOverride)) {
    violations.push("AGENTS.override.md: root override is forbidden; edit the canonical AGENTS.md");
  }
  if (!existsSync(rootAgents)) violations.push("AGENTS.md: root instruction file is missing");
  else if (statSync(rootAgents).size > ROOT_AGENT_MAX_BYTES) {
    violations.push(`AGENTS.md: ${statSync(rootAgents).size} bytes exceeds root limit ${ROOT_AGENT_MAX_BYTES} bytes`);
  }

  const activeFiles = findActiveInstructionFiles(root);
  for (const activeFile of activeFiles) {
    const relativePath = formatPath(root, activeFile);
    const chainBytes = instructionChain(root, activeFile).reduce((total, file) => total + statSync(file).size, 0);
    if (chainBytes > limit) violations.push(`${relativePath}: applicable instruction chain is ${chainBytes} bytes; limit is ${limit} bytes`);
    violations.push(...validateMarkdownLinks(root, activeFile));
  }

  const claudePath = path.join(root, "CLAUDE.md");
  if (existsSync(rootAgents)) {
    const expected = renderClaudeRules(readFileSync(rootAgents, "utf8"));
    const actual = existsSync(claudePath) ? readFileSync(claudePath, "utf8") : "";
    if (actual !== expected) violations.push("CLAUDE.md: stale; regenerate it from AGENTS.md");
  }
  return { activeFiles: activeFiles.map((file) => formatPath(root, file)), limit, violations };
}

export function formatReport(result) {
  if (result.violations.length === 0) return `agent-instructions: OK (${result.activeFiles.length} active file(s), chain limit ${result.limit} bytes)`;
  return [
    `agent-instructions: FAILED (${result.violations.length} violation(s))`,
    ...result.violations.map((violation) => `- ${violation}`)
  ].join("\n");
}

const editorSessionIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,80}$/u;

function strictRelative(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
    ? relative
    : null;
}

export function validateWorktreeLocations(primaryRoot, worktrees) {
  const primary = path.resolve(primaryRoot);
  const agentRoot = path.join(primary, ".tmp", "worktrees");
  const editorRoot = path.join(primary, ".tmp", "editor-worktrees");
  const violations = [];
  for (const worktree of worktrees) {
    const rawPath = worktree.path;
    if (!path.isAbsolute(rawPath)) {
      violations.push(`linked worktree path is not absolute: ${rawPath}`);
      continue;
    }
    const candidate = path.resolve(rawPath);
    if (candidate === primary) continue;

    if (strictRelative(agentRoot, candidate) !== null) continue;

    const editorSessionId = strictRelative(editorRoot, candidate);
    if (editorSessionId !== null && !editorSessionId.includes(path.sep) &&
        editorSessionIdPattern.test(editorSessionId) && !editorSessionId.includes("..") &&
        worktree.branch === `refs/heads/editor/session/${editorSessionId}`) continue;

    if (editorSessionId !== null) {
      violations.push(`${candidate}: product editor worktree must be a direct .tmp/editor-worktrees/<sessionId> child on refs/heads/editor/session/<sessionId>`);
    } else {
      violations.push(`${candidate}: linked worktree must use a declared repository-local .tmp root`);
    }
  }
  return violations;
}

export function parseWorktreePorcelainZ(raw) {
  const records = [];
  let current = null;
  for (const field of raw.split("\0")) {
    if (field.startsWith("worktree ")) {
      if (current !== null) records.push(current);
      current = { path: field.slice("worktree ".length), branch: null };
    } else if (field.startsWith("branch ") && current !== null) {
      current.branch = field.slice("branch ".length);
    }
  }
  if (current !== null) records.push(current);
  return records;
}

function validateCurrentWorktreeLocations(repoRoot) {
  try {
    const commonGitDirectory = execFileSync(
      "git", ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
    const primaryRoot = path.dirname(commonGitDirectory);
    const worktrees = parseWorktreePorcelainZ(execFileSync(
      "git", ["worktree", "list", "--porcelain", "-z"],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ));
    return validateWorktreeLocations(primaryRoot, worktrees);
  } catch {
    return ["linked worktree locations could not be verified"];
  }
}

function main() {
  const result = validateAgentInstructions(process.cwd());
  result.violations.push(...validateCurrentWorktreeLocations(process.cwd()));
  console.log(formatReport(result));
  if (result.violations.length > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
