import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCacheKey,
  collectSignals,
  extractMarkdownSection,
  normalizeMarkdown,
  parseSkill,
} from "./lib.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "./lib.mjs";

test("parses skill frontmatter with YAML semantics", () => {
  const parsed = parseSkill("---\nname: sample\ndescription: >-\n  Multi line\n  description\n---\n# Body\n");
  assert.equal(parsed.metadata.name, "sample");
  assert.equal(parsed.metadata.description, "Multi line description");
});

test("extracts only the requested Markdown section", () => {
  const source = "# Root\n\n## One\nA  \n\n### Nested\nB\n\n## Two\nC\n";
  const section = normalizeMarkdown(extractMarkdownSection(source, "One"));
  assert.match(section, /A/);
  assert.match(section, /Nested/);
  assert.doesNotMatch(section, /Two/);
});

test("reports mechanical signals without assigning compatibility", () => {
  const signals = collectSignals("Run git commit now\n", [
    { id: "git", pattern: "git commit", tags: ["git"] },
  ]);
  assert.deepEqual(signals, [{ signalId: "git", line: 1, excerpt: "Run git commit now", tags: ["git"] }]);
  assert.equal(Object.hasOwn(signals[0], "decision"), false);
});

test("cache key changes when accumulated memory changes", () => {
  const base = {
    skillText: "skill",
    policy: { policyVersion: "1.0.0", adapterVersion: "1.0.0" },
    rules: [{ id: "rule" }],
    experience: [],
    tags: ["testing"],
  };
  const first = buildCacheKey({ ...base, memory: { revision: 1 } });
  const second = buildCacheKey({ ...base, memory: { revision: 2 } });
  assert.notEqual(first, second);
});

test("active pilot skills preserve project authority and safety boundaries", async () => {
  const skillPaths = [
    "skills/debugging-and-error-recovery/SKILL.md",
    "skills/verification-before-completion/SKILL.md",
  ];
  const skills = await Promise.all(
    skillPaths.map((skillPath) => readFile(path.join(REPO_ROOT, skillPath), "utf8")),
  );

  assert.match(skills[0], /architecture decision only when/i);
  assert.match(skills[0], /Continue independent work/i);
  assert.match(skills[1], /according to the changed behavior, risk, and affected boundaries/i);
  assert.match(skills[1], /must not silently publish, deploy, commit, push/i);
  skills.forEach((skill) => {
    assert.doesNotMatch(skill, /invoke.*\$cubica/i);
    assert.doesNotMatch(skill, /full (test )?suite.*(?:always|required)/i);
  });
});
