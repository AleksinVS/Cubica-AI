import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readPrototypeAuditStatus } from "./prototype-audit-status";

const fixedNow = new Date("2026-06-13T12:00:00Z");

describe("readPrototypeAuditStatus", () => {
  it("returns a missing notification when the status file does not exist", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "cubica-prototype-audit-missing-"));
    const result = await readPrototypeAuditStatus({
      repoRoot: process.cwd(),
      statusFile: path.join(dir, "missing-status.json"),
      now: fixedNow
    });

    expect(result.notification).toBe("missing");
    expect(result.status).toBeNull();
  });

  it("marks stale weekly status after cadence plus grace period", async () => {
    const statusFile = await writeStatus({
      lastCompletedAt: "2026-06-01T00:00:00Z",
      llmStatus: "completed"
    });

    const result = await readPrototypeAuditStatus({
      repoRoot: process.cwd(),
      statusFile,
      now: fixedNow
    });

    expect(result.notification).toBe("stale");
  });

  it("marks failed weekly status", async () => {
    const statusFile = await writeStatus({
      status: "failed",
      llmStatus: "completed"
    });

    const result = await readPrototypeAuditStatus({
      repoRoot: process.cwd(),
      statusFile,
      now: fixedNow
    });

    expect(result.notification).toBe("failed");
  });

  it("marks skipped or failed LLM semantic audit as partial", async () => {
    const statusFile = await writeStatus({
      llmStatus: "skipped"
    });

    const result = await readPrototypeAuditStatus({
      repoRoot: process.cwd(),
      statusFile,
      now: fixedNow
    });

    expect(result.notification).toBe("partial");
  });

  it("marks reports from a different commit as outdated", async () => {
    const statusFile = await writeStatus({
      llmStatus: "completed",
      commitSha: "not-the-current-head"
    });

    const result = await readPrototypeAuditStatus({
      repoRoot: process.cwd(),
      statusFile,
      now: fixedNow
    });

    expect(result.notification).toBe("outdated-report");
  });

  it("returns no notification for a fresh completed status", async () => {
    const statusFile = await writeStatus({
      llmStatus: "completed",
      commitSha: undefined
    });

    const result = await readPrototypeAuditStatus({
      repoRoot: process.cwd(),
      statusFile,
      now: fixedNow
    });

    expect(result.notification).toBeNull();
  });
});

async function writeStatus(overrides: Partial<Record<string, unknown>>): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cubica-prototype-audit-"));
  const statusFile = path.join(dir, "status.json");
  await writeFile(
    statusFile,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        cadence: "weekly",
        expectedEveryDays: 7,
        graceHours: 36,
        lastStartedAt: "2026-06-08T03:37:00Z",
        lastCompletedAt: "2026-06-08T03:52:00Z",
        status: "completed",
        llmStatus: "completed",
        branch: "main",
        summary: {
          deterministicCandidates: 1,
          semanticCandidates: 1,
          promotionCandidates: 0
        },
        ...overrides
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return statusFile;
}
