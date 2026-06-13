import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("prototype audit status route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a nonblocking missing notification when the status file is absent", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "cubica-prototype-audit-route-missing-"));
    vi.stubEnv("PROTOTYPE_AUDIT_STATUS_FILE", path.join(dir, "missing-status.json"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.notification).toBe("missing");
    expect(body.status).toBeNull();
  });

  it("returns the current status record without blocking editor work", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "cubica-prototype-audit-route-"));
    const statusFile = path.join(dir, "status.json");
    await writeFile(
      statusFile,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          cadence: "weekly",
          expectedEveryDays: 7,
          graceHours: 36,
          lastStartedAt: new Date().toISOString(),
          lastCompletedAt: new Date().toISOString(),
          status: "completed",
          llmStatus: "completed",
          reportPath: ".tmp/prototype-audit/weekly-report.md",
          summary: {
            deterministicCandidates: 1,
            semanticCandidates: 0,
            promotionCandidates: 0
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    vi.stubEnv("PROTOTYPE_AUDIT_STATUS_FILE", statusFile);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.notification).toBeNull();
    expect(body.status.reportPath).toBe(".tmp/prototype-audit/weekly-report.md");
  });
});
