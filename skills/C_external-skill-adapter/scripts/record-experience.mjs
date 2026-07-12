#!/usr/bin/env node

/** Append a reviewed lesson to the adaptation memory and bump its revision. */

import { MEMORY_PATH, parseArgs, readJson, writeJson } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const required = ["id", "title", "symptom", "cause", "guidance", "tags", "evidence"];
for (const field of required) {
  if (!args[field]) throw new Error(`Missing --${field}`);
}

const memory = await readJson(MEMORY_PATH);
if (memory.entries.some((entry) => entry.id === args.id)) {
  throw new Error(`Experience id already exists: ${args.id}`);
}
memory.entries.push({
  id: args.id,
  recordedOn: args.date ?? new Date().toISOString().slice(0, 10),
  status: "active",
  title: args.title,
  tags: String(args.tags).split(",").map((value) => value.trim()).filter(Boolean),
  symptom: args.symptom,
  cause: args.cause,
  guidance: args.guidance,
  ruleIds: String(args["rule-ids"] ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  evidence: String(args.evidence).split(",").map((value) => value.trim()).filter(Boolean),
});
memory.revision += 1;
await writeJson(MEMORY_PATH, memory);
console.log(`record-experience: added ${args.id}; memory revision ${memory.revision}`);
