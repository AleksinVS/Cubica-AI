#!/usr/bin/env node
/**
 * Validates the ADR-050 prototype audit status record.
 *
 * The weekly audit publishes this small JSON file so editor-web can warn
 * authors when the weekly audit is missing, stale, failed, or partial. Keeping
 * the validator separate makes the CI artifact contract explicit without
 * introducing a runtime dependency on the editor.
 */

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const statusPath = process.argv[2] ? path.resolve(repoRoot, process.argv[2]) : path.join(repoRoot, ".tmp", "prototype-audit", "status.json");

function fail(message) {
  console.error(`validate-prototype-audit-status: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(statusPath)) {
  fail(`status file does not exist: ${path.relative(repoRoot, statusPath)}`);
}

let status;
try {
  status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
} catch (error) {
  fail(`invalid JSON: ${error.message}`);
}

for (const field of ["schemaVersion", "cadence", "expectedEveryDays", "graceHours", "lastStartedAt", "lastCompletedAt", "status", "llmStatus", "summary"]) {
  if (!Object.prototype.hasOwnProperty.call(status, field)) {
    fail(`missing required field: ${field}`);
  }
}

if (status.schemaVersion !== 1) {
  fail(`unsupported schemaVersion: ${status.schemaVersion}`);
}

if (!["weekly", "manual"].includes(status.cadence)) {
  fail(`unsupported cadence: ${status.cadence}`);
}

if (!["completed", "failed"].includes(status.status)) {
  fail(`unsupported status: ${status.status}`);
}

if (!["completed", "skipped", "failed", "not-requested"].includes(status.llmStatus)) {
  fail(`unsupported llmStatus: ${status.llmStatus}`);
}

for (const dateField of ["lastStartedAt", "lastCompletedAt"]) {
  if (Number.isNaN(Date.parse(status[dateField]))) {
    fail(`${dateField} is not an ISO date string`);
  }
}

if (!status.summary || typeof status.summary !== "object" || Array.isArray(status.summary)) {
  fail("summary must be an object");
}

console.log(`validate-prototype-audit-status: ${path.relative(repoRoot, statusPath)} OK`);
