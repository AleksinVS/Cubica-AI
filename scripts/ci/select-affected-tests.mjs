#!/usr/bin/env node
/**
 * Selects the smallest known-safe verification set for changed repository paths.
 *
 * The policy is deliberately fail-closed: a path that is unknown or can affect
 * shared contracts, generated output, authentication, security, or test
 * orchestration expands to the complete verification set. CI currently uses
 * this selector only for an informational summary; required jobs still run.
 */
import { appendFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SUITES = Object.freeze({
  legacy: {
    label: "legacy/stub gate",
    command: ["npm", "run", "verify:legacy"]
  },
  manifest: {
    label: "manifest authoring gate",
    command: ["npm", "run", "verify:manifest-authoring"]
  },
  canonical: {
    label: "canonical verification (CI-safe)",
    command: ["npm", "run", "verify:canonical:ci"]
  },
  portal: {
    label: "portal rule tests",
    command: ["npm", "run", "test:portal-rules", "--prefix", "services/portal-backend"]
  },
  "e2e:full": {
    label: "production E2E (full)",
    command: ["npm", "run", "test:e2e:prod"]
  },
  "e2e:player": {
    label: "production E2E (player)",
    command: ["npm", "run", "test:e2e:player"]
  },
  "e2e:editor": {
    label: "production E2E (editor)",
    command: ["npm", "run", "test:e2e:editor"]
  },
  "e2e:portal": {
    label: "production E2E (portal)",
    command: ["npm", "run", "test:e2e:portal"]
  }
});

export const FULL_SUITE_IDS = Object.freeze([
  "legacy",
  "manifest",
  "canonical",
  "portal",
  "e2e:full"
]);

// Include deletions: a change made only of removed files must never look like
// an empty diff and accidentally select no verification suites.
export const GIT_DIFF_FILTER = "ACDMRTUXB";

const CRITICAL_PATH_PATTERNS = [
  /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/,
  /^\.github\/workflows\//,
  /(^|\/)(playwright|vitest|jest|eslint|tsconfig)(\.|\/)/i,
  /^scripts\/ci\//,
  /^scripts\/manifest-tools\//,
  /(^|\/)(schema|schemas|generate|generator|generators)(\/|\.|-|$)/i,
  /^packages\/contracts\//,
  /^packages\/view-protocol\//,
  /(^|\/)(auth|authentication|authorization|security)(\/|\.|-|$)/i
];

/**
 * Map changed paths to suite identifiers while retaining the reason for a
 * complete fallback. Stable ordering keeps local output and unit tests clear.
 */
export function selectAffected(paths) {
  const normalizedPaths = [...new Set(paths.map(normalizePath).filter(Boolean))].sort();
  const selected = new Set();
  const fallbackPaths = [];

  for (const changedPath of normalizedPaths) {
    if (CRITICAL_PATH_PATTERNS.some((pattern) => pattern.test(changedPath))) {
      fallbackPaths.push(changedPath);
      continue;
    }

    if (changedPath.startsWith("apps/player-web/")) {
      selected.add("canonical");
      selected.add("e2e:player");
    } else if (changedPath.startsWith("apps/editor-web/")) {
      selected.add("canonical");
      selected.add("e2e:editor");
    } else if (changedPath.startsWith("services/runtime-api/")) {
      selected.add("canonical");
      selected.add("e2e:full");
    } else if (changedPath.startsWith("services/portal-backend/")) {
      selected.add("portal");
      selected.add("e2e:portal");
    } else if (
      changedPath.startsWith("packages/editor-engine/") ||
      changedPath.startsWith("packages/view-protocol/")
    ) {
      selected.add("canonical");
      selected.add("e2e:editor");
    } else if (changedPath.startsWith("skills/")) {
      selected.add("legacy");
      selected.add("canonical");
    } else if (
      changedPath.startsWith("docs/") ||
      changedPath === "AGENTS.md" ||
      changedPath === "NEXT_STEPS.md" ||
      changedPath === "PROJECT_ARCHITECTURE.md" ||
      changedPath === "PROJECT_OVERVIEW.md" ||
      changedPath === "PROJECT_STRUCTURE.yaml"
    ) {
      selected.add("legacy");
    } else {
      // Games, root configuration, unfamiliar services, and future repository
      // areas are intentionally unknown until an explicit safe mapping exists.
      fallbackPaths.push(changedPath);
    }
  }

  if (fallbackPaths.length > 0) {
    return {
      paths: normalizedPaths,
      suiteIds: [...FULL_SUITE_IDS],
      fullFallback: true,
      fallbackPaths
    };
  }

  return {
    paths: normalizedPaths,
    suiteIds: orderedSuiteIds(selected),
    fullFallback: false,
    fallbackPaths: []
  };
}

function normalizePath(value) {
  return String(value).trim().replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function orderedSuiteIds(selected) {
  return Object.keys(SUITES).filter((suiteId) => selected.has(suiteId));
}

function parseArgs(argv) {
  const options = { base: null, head: "HEAD", run: false, summary: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--base" || argument === "--head") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a git revision`);
      options[argument.slice(2)] = value;
      index += 1;
    } else if (argument === "--run") {
      options.run = true;
    } else if (argument === "--summary") {
      options.summary = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function changedPaths(options) {
  try {
    if (options.base) {
      return gitLines(["diff", "--name-only", `--diff-filter=${GIT_DIFF_FILTER}`, `${options.base}...${options.head}`]);
    }

    const workingPaths = new Set([
      ...gitLines(["diff", "--name-only", `--diff-filter=${GIT_DIFF_FILTER}`, "HEAD"]),
      ...gitLines(["diff", "--cached", "--name-only", `--diff-filter=${GIT_DIFF_FILTER}`]),
      ...gitLines(["ls-files", "--others", "--exclude-standard"])
    ]);
    if (workingPaths.size > 0) return [...workingPaths];

    return gitLines(["diff", "--name-only", `--diff-filter=${GIT_DIFF_FILTER}`, "HEAD~1..HEAD"]);
  } catch (error) {
    // A shallow clone, missing base, or unborn repository must never narrow the
    // checks. This synthetic unknown path forces the complete fallback.
    console.error(`[affected] git diff unavailable: ${error.message}`);
    return ["__unknown_diff__"];
  }
}

function gitLines(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    .split(/\r?\n/u)
    .filter(Boolean);
}

function formatSummary(selection) {
  const suiteLabels = selection.suiteIds.map((suiteId) => SUITES[suiteId].label);
  const fallback = selection.fullFallback
    ? `yes (${selection.fallbackPaths.length} critical or unknown path(s))`
    : "no";
  return [
    "### Affected-test observation",
    "",
    `- Changed paths: ${selection.paths.length}`,
    `- Full fallback: ${fallback}`,
    `- Suggested checks: ${suiteLabels.length > 0 ? suiteLabels.join(", ") : "none"}`,
    "",
    "> Informational only: all required CI gates still run."
  ].join("\n");
}

function runSuites(suiteIds) {
  for (const suiteId of suiteIds) {
    const suite = SUITES[suiteId];
    console.log(`[affected] ${suite.label}`);
    const result = spawnSync(suite.command[0], suite.command.slice(1), {
      stdio: "inherit",
      env: process.env
    });
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const selection = selectAffected(changedPaths(options));
  const summary = formatSummary(selection);
  console.log(summary);

  if (options.summary && process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, "utf8");
  }

  if (options.run) {
    process.exitCode = runSuites(selection.suiteIds);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[affected] ${error.message}`);
    process.exitCode = 1;
  });
}
