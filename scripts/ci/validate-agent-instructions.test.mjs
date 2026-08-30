/** Regression coverage for AGENTS instruction governance in isolated fixtures. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  parseWorktreePorcelainZ,
  validateAgentInstructions,
  validateWorktreeLocations
} from "./validate-agent-instructions.mjs";

function fixture(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), "agent-instructions-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const destination = path.join(root, relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, content, "utf8");
  }
  return root;
}

function rules(body = "") { return `# AGENTS\n${body}`; }
function claude(source) {
  return ["<!-- GENERATED FILE: edit AGENTS.md, then run node scripts/dev/generate-claude-rules.cjs. -->", "# CLAUDE", "", "> This compatibility copy is generated from `AGENTS.md`; `AGENTS.md` remains the only editable source.", source.slice("# AGENTS\n".length)].join("\n");
}

function check(files) {
  const root = fixture(files);
  try { return validateAgentInstructions(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("rejects a root instruction over 16 KiB", () => {
  const source = rules("x".repeat(16 * 1024));
  const result = check({ "AGENTS.md": source, "CLAUDE.md": claude(source) });
  assert.match(result.violations.join("\n"), /root limit 16384/u);
});

test("rejects an applicable chain over its configured budget", () => {
  const root = rules("a".repeat(80));
  const result = check({
    ".codex/config.toml": "project_doc_max_bytes = 100\n",
    "AGENTS.md": root,
    "CLAUDE.md": claude(root),
    "nested/AGENTS.md": rules("b".repeat(80))
  });
  assert.match(result.violations.join("\n"), /nested\/AGENTS\.md: applicable instruction chain/u);
});

test("caps a chain at 28 KiB even when the host limit is larger", () => {
  const root = rules("a".repeat(16_000));
  const result = check({
    ".codex/config.toml": "project_doc_max_bytes = 65536\n",
    "AGENTS.md": root,
    "CLAUDE.md": claude(root),
    "nested/AGENTS.md": rules("b".repeat(13_000))
  });
  assert.equal(result.limit, 28 * 1024);
  assert.match(result.violations.join("\n"), /nested\/AGENTS\.md: applicable instruction chain/u);
});

test("honors TOML digit separators in a smaller host limit", () => {
  const root = rules("a".repeat(10_000));
  const result = check({
    ".codex/config.toml": "project_doc_max_bytes = 20_000\n",
    "AGENTS.md": root,
    "CLAUDE.md": claude(root),
    "nested/AGENTS.md": rules("b".repeat(11_000))
  });
  assert.equal(result.limit, 20_000);
  assert.match(result.violations.join("\n"), /nested\/AGENTS\.md: applicable instruction chain/u);
});

test("fails closed for a malformed configured host limit", () => {
  const source = rules();
  const result = check({
    ".codex/config.toml": "project_doc_max_bytes = \"large\"\n",
    "AGENTS.md": source,
    "CLAUDE.md": claude(source)
  });
  assert.match(result.violations.join("\n"), /must be a positive TOML integer/u);
});

test("override replaces the standard file in the same directory", () => {
  const root = rules();
  const result = check({
    "AGENTS.md": root, "CLAUDE.md": claude(root),
    "area/AGENTS.md": rules("[broken](missing.md)"),
    "area/AGENTS.override.md": rules("[good](present.md)"),
    "area/present.md": "present"
  });
  assert.deepEqual(result.activeFiles, ["AGENTS.md", "area/AGENTS.override.md"]);
  assert.equal(result.violations.length, 0);
});

test("forbids a root override that would bypass the canonical root budget", () => {
  const source = rules();
  const result = check({
    "AGENTS.md": source,
    "AGENTS.override.md": rules("x".repeat(20_000)),
    "CLAUDE.md": claude(source)
  });
  assert.match(result.violations.join("\n"), /root override is forbidden/u);
});

test("ignores policies under .tmp and archive", () => {
  const source = rules();
  const result = check({
    "AGENTS.md": source, "CLAUDE.md": claude(source),
    ".tmp/AGENTS.md": rules("[broken](missing.md)"),
    "docs/tasks/archive/AGENTS.md": rules("[broken](missing.md)")
  });
  assert.equal(result.violations.length, 0);
  assert.deepEqual(result.activeFiles, ["AGENTS.md"]);
});

test("checks inline and reference Markdown links but ignores inline code", () => {
  const source = rules([
    "[exists](guide.md#part)",
    "[missing](none.md)",
    "[absolute](/tmp/nope)",
    "[routing][routing]",
    "[routing]: missing-reference.md",
    "[undefined][unknown]",
    "`[example](not-a-link.md)`"
  ].join("\n"));
  const result = check({ "AGENTS.md": source, "CLAUDE.md": claude(source), "guide.md": "# guide" });
  assert.match(result.violations.join("\n"), /target does not exist: none\.md/u);
  assert.match(result.violations.join("\n"), /absolute Markdown link is forbidden: \/tmp\/nope/u);
  assert.match(result.violations.join("\n"), /target does not exist: missing-reference\.md/u);
  assert.match(result.violations.join("\n"), /Markdown reference is not defined: unknown/u);
  assert.doesNotMatch(result.violations.join("\n"), /not-a-link/u);
});

test("rejects a stale CLAUDE compatibility copy", () => {
  const source = rules();
  const result = check({ "AGENTS.md": source, "CLAUDE.md": "stale" });
  assert.deepEqual(result.violations, ["CLAUDE.md: stale; regenerate it from AGENTS.md"]);
});

test("accepts a complete valid repository fixture", () => {
  const source = rules("[guide](docs/)");
  const result = check({ "AGENTS.md": source, "CLAUDE.md": claude(source), "docs/.keep": "" });
  assert.deepEqual(result.violations, []);
});

test("allows agent and exact product editor worktrees only under their declared temporary roots", () => {
  const primary = path.resolve("/srv/Cubica-AI");
  assert.deepEqual(validateWorktreeLocations(primary, [
    { path: primary, branch: "refs/heads/main" },
    { path: path.join(primary, ".tmp", "worktrees", "feature-a"), branch: "refs/heads/agent/feature-a" },
    { path: path.join(primary, ".tmp", "worktrees", "nested", "feature-b"), branch: null },
    { path: path.join(primary, ".tmp", "editor-worktrees", "game-abc123"), branch: "refs/heads/editor/session/game-abc123" }
  ]), []);

  const violations = validateWorktreeLocations(primary, [
    { path: "/srv/Cubica-AI-feature-a", branch: "refs/heads/agent/feature-a" },
    { path: path.join(primary, ".tmp", "worktrees-other", "feature-b"), branch: "refs/heads/agent/feature-b" },
    { path: "relative-worktree", branch: "refs/heads/agent/relative" },
    { path: path.join(primary, ".tmp", "editor-worktrees", "agent-copy"), branch: "refs/heads/agent/copy" },
    { path: path.join(primary, ".tmp", "editor-worktrees", "nested", "session"), branch: "refs/heads/editor/session/session" },
    { path: path.join(primary, ".tmp", "editor-worktrees", "session-a"), branch: "refs/heads/editor/session/session-b" }
  ]);
  assert.equal(violations.length, 6);
  assert.match(violations.join("\n"), /Cubica-AI-feature-a/u);
  assert.match(violations.join("\n"), /worktrees-other/u);
  assert.match(violations.join("\n"), /not absolute/u);
  assert.match(violations.join("\n"), /agent-copy/u);
  assert.match(violations.join("\n"), /nested/u);
  assert.match(violations.join("\n"), /session-a/u);
});

test("parses NUL-delimited worktree porcelain without splitting paths on spaces", () => {
  const raw = [
    "worktree /srv/Cubica-AI", "HEAD abc", "branch refs/heads/main", "",
    "worktree /srv/Cubica-AI/.tmp/worktrees/feature with spaces", "HEAD def", "detached", ""
  ].join("\0");
  assert.deepEqual(parseWorktreePorcelainZ(raw), [
    { path: "/srv/Cubica-AI", branch: "refs/heads/main" },
    { path: "/srv/Cubica-AI/.tmp/worktrees/feature with spaces", branch: null }
  ]);
});
