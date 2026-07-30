#!/usr/bin/env node
/**
 * Times one command and writes only compact metadata to `.tmp/test-profiles`.
 *
 * Command output remains on the terminal. The profile deliberately excludes
 * arguments and environment values so a CI summary cannot disclose secrets.
 *
 * Usage:
 *   npm run test:profile -- --label "legacy gate" -- npm run verify:legacy
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

function parseArgs(argv) {
  let label = "test command";
  let commandStart = 0;
  if (argv[0] === "--label") {
    if (!argv[1]) throw new Error("--label requires a value");
    label = argv[1];
    commandStart = 2;
  }
  if (argv[commandStart] === "--") commandStart += 1;
  const command = argv.slice(commandStart);
  if (command.length === 0) {
    throw new Error("provide a command after `--`, for example: -- npm run verify:legacy");
  }
  return { label, command };
}

function safeMarkdown(value) {
  return value.replaceAll("|", "\\|").replaceAll(/\r?\n/gu, " ");
}

try {
  const { label, command } = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const startedNs = process.hrtime.bigint();
  const result = spawnSync(command[0], command.slice(1), {
    stdio: "inherit",
    env: process.env
  });
  const durationMs = Number((process.hrtime.bigint() - startedNs) / 1_000_000n);
  const exitCode = result.status ?? 1;
  const profile = {
    label,
    startedAt: startedAt.toISOString(),
    durationMs,
    exitCode,
    signal: result.signal ?? null
  };

  const profileDir = path.join(process.cwd(), ".tmp", "test-profiles");
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(path.join(profileDir, "latest.json"), `${JSON.stringify(profile, null, 2)}\n`, "utf8");

  const durationSeconds = (durationMs / 1000).toFixed(1);
  console.log(`[test-profile] ${label}: ${durationSeconds}s, exit ${exitCode}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        "### Test timing",
        "",
        "| Stage | Duration | Result |",
        "|---|---:|---|",
        `| ${safeMarkdown(label)} | ${durationSeconds}s | ${exitCode === 0 ? "passed" : "failed"} |`,
        ""
      ].join("\n"),
      "utf8"
    );
  }
  process.exitCode = exitCode;
} catch (error) {
  console.error(`[test-profile] ${error.message}`);
  process.exitCode = 1;
}
