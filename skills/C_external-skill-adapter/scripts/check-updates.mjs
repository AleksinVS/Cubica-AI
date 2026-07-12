#!/usr/bin/env node

/**
 * Check pinned repositories on a bounded cadence without applying updates.
 * A check only reports candidate commits; adaptation remains a separate gate.
 */

import { spawnSync } from "node:child_process";
import { REGISTRY_PATH, parseArgs, readJson, writeJson } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const registry = await readJson(REGISTRY_PATH);
const now = args.now ? new Date(args.now) : new Date();
if (Number.isNaN(now.valueOf())) throw new Error(`Invalid --now value: ${args.now}`);
const force = Boolean(args.force || args.security);
const results = [];

for (const source of registry.sources) {
  const due = now >= new Date(source.nextCheckAfter);
  if (!due && !force) {
    results.push({ sourceId: source.id, status: "skipped", nextCheckAfter: source.nextCheckAfter });
    continue;
  }

  const command = spawnSync("git", ["ls-remote", source.repository, "HEAD"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (command.status !== 0) {
    results.push({ sourceId: source.id, status: "error", message: command.stderr.trim() });
    continue;
  }
  const latestCommit = command.stdout.trim().split(/\s+/)[0];
  results.push({
    sourceId: source.id,
    status: latestCommit === source.pinnedCommit ? "current" : "candidate-available",
    pinnedCommit: source.pinnedCommit,
    latestCommit,
  });

  if (args.write) {
    source.lastCheckedAt = now.toISOString();
    source.nextCheckAfter = new Date(
      now.valueOf() + registry.cadenceDays * 24 * 60 * 60 * 1000,
    ).toISOString();
  }
}

if (args.write) await writeJson(REGISTRY_PATH, registry);
console.log(JSON.stringify({ checkedAt: now.toISOString(), forced: force, applied: false, results }, null, 2));
if (results.some((result) => result.status === "error")) process.exit(1);
