/**
 * Prototype audit status reader for editor-web.
 *
 * Weekly prototype audits run outside the editor, usually in GitHub Actions.
 * This module turns the persisted audit status artifact into a small UI-safe
 * notification model so the editor can warn authors without blocking editing.
 */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type PrototypeAuditNotificationStatus = "missing" | "stale" | "failed" | "partial" | "outdated-report";

export interface PrototypeAuditSummary {
  readonly deterministicCandidates?: number;
  readonly semanticCandidates?: number;
  readonly promotionCandidates?: number;
  readonly localPrototypes?: number;
  readonly filesScanned?: number;
}

export interface PrototypeAuditStatusRecord {
  readonly schemaVersion: 1;
  readonly cadence: "weekly" | "manual";
  readonly expectedEveryDays: number;
  readonly graceHours: number;
  readonly lastStartedAt: string;
  readonly lastCompletedAt: string;
  readonly status: "completed" | "failed";
  readonly llmStatus: "completed" | "skipped" | "failed" | "not-requested";
  readonly branch?: string;
  readonly commitSha?: string;
  readonly reportUrl?: string;
  readonly reportPath?: string;
  readonly workflowUrl?: string;
  readonly summary: PrototypeAuditSummary;
}

export interface PrototypeAuditStatusResult {
  readonly ok: true;
  readonly status: PrototypeAuditStatusRecord | null;
  readonly notification: PrototypeAuditNotificationStatus | null;
  readonly message: string;
  readonly checkedAt: string;
}

export async function readPrototypeAuditStatus(input: {
  readonly repoRoot: string;
  readonly statusFile?: string;
  readonly now?: Date;
}): Promise<PrototypeAuditStatusResult> {
  const checkedAt = (input.now ?? new Date()).toISOString();
  const statusPath =
    input.statusFile ??
    process.env.PROTOTYPE_AUDIT_STATUS_FILE ??
    path.join(input.repoRoot, ".tmp", "prototype-audit", "status.json");

  let status: PrototypeAuditStatusRecord;
  try {
    status = parseStatusRecord(JSON.parse(await readFile(statusPath, "utf8")));
  } catch {
    return {
      ok: true,
      status: null,
      notification: "missing",
      message: "Weekly prototype audit status is missing.",
      checkedAt
    };
  }

  const notification = classifyStatus(status, {
    repoRoot: input.repoRoot,
    now: input.now ?? new Date()
  });

  return {
    ok: true,
    status,
    notification,
    message: notificationMessage(notification, status),
    checkedAt
  };
}

function parseStatusRecord(value: unknown): PrototypeAuditStatusRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Prototype audit status must be an object.");
  }

  const record = value as Partial<PrototypeAuditStatusRecord>;
  if (record.schemaVersion !== 1 || record.cadence === undefined || record.lastCompletedAt === undefined) {
    throw new Error("Prototype audit status is missing required fields.");
  }

  return {
    schemaVersion: 1,
    cadence: record.cadence === "manual" ? "manual" : "weekly",
    expectedEveryDays: numberOrDefault(record.expectedEveryDays, 7),
    graceHours: numberOrDefault(record.graceHours, 36),
    lastStartedAt: stringOrDefault(record.lastStartedAt, record.lastCompletedAt),
    lastCompletedAt: stringOrDefault(record.lastCompletedAt, ""),
    status: record.status === "failed" ? "failed" : "completed",
    llmStatus:
      record.llmStatus === "completed" || record.llmStatus === "failed" || record.llmStatus === "not-requested"
        ? record.llmStatus
        : "skipped",
    branch: typeof record.branch === "string" ? record.branch : undefined,
    commitSha: typeof record.commitSha === "string" ? record.commitSha : undefined,
    reportUrl: typeof record.reportUrl === "string" ? record.reportUrl : undefined,
    reportPath: typeof record.reportPath === "string" ? record.reportPath : undefined,
    workflowUrl: typeof record.workflowUrl === "string" ? record.workflowUrl : process.env.PROTOTYPE_AUDIT_WORKFLOW_URL,
    summary:
      typeof record.summary === "object" && record.summary !== null && !Array.isArray(record.summary)
        ? record.summary
        : {}
  };
}

function classifyStatus(
  status: PrototypeAuditStatusRecord,
  context: { readonly repoRoot: string; readonly now: Date }
): PrototypeAuditNotificationStatus | null {
  if (status.status === "failed") {
    return "failed";
  }

  if (isStale(status, context.now)) {
    return "stale";
  }

  if (status.llmStatus === "failed" || status.llmStatus === "skipped") {
    return "partial";
  }

  if (status.commitSha !== undefined && status.commitSha !== "" && status.commitSha !== currentHeadSha(context.repoRoot)) {
    return "outdated-report";
  }

  return null;
}

function isStale(status: PrototypeAuditStatusRecord, now: Date): boolean {
  const completedAt = Date.parse(status.lastCompletedAt);
  if (Number.isNaN(completedAt)) {
    return true;
  }
  const maxAgeMs = (status.expectedEveryDays * 24 + status.graceHours) * 60 * 60 * 1000;
  return now.getTime() - completedAt > maxAgeMs;
}

function currentHeadSha(repoRoot: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return undefined;
  }
}

function notificationMessage(
  notification: PrototypeAuditNotificationStatus | null,
  status: PrototypeAuditStatusRecord
): string {
  if (notification === null) {
    return `Weekly prototype audit completed at ${status.lastCompletedAt}.`;
  }

  if (notification === "stale") {
    return `Weekly prototype audit is stale; last completed at ${status.lastCompletedAt}.`;
  }

  if (notification === "failed") {
    return `Weekly prototype audit failed; last run completed at ${status.lastCompletedAt}.`;
  }

  if (notification === "partial") {
    return `Weekly prototype audit was partial; LLM semantic status is ${status.llmStatus}.`;
  }

  if (notification === "outdated-report") {
    return `Weekly prototype audit report is older than the current repository commit.`;
  }

  return "Weekly prototype audit status is missing.";
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
