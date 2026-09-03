/** Integration tests for the filesystem-backed editor-session lease. */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  editorSessionLeasePath,
  EditorSessionLeaseError,
  withEditorSessionLease
} from "./editor-session-lease";

const repoRoot = path.resolve(process.cwd(), ".tmp", "editor-session-lease-tests");
const sessionId = "neutral-lease-session";
const leaseDirectory = path.dirname(editorSessionLeasePath(repoRoot, sessionId));
const reclaimInspectionTestHookKey = Symbol.for("cubica.test.editor-session-lease.reclaim-inspected");
const testHooks = globalThis as typeof globalThis & {
  [key: symbol]: ((input: {
    readonly phase: "lease-inspected" | "coordinator-inspected";
    readonly leasePath: string;
  }) => Promise<void>) | undefined;
};

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

async function waitForTestStep(promise: Promise<void>, step: string): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${step}.`)), 1_000);
      })
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

describe("editor session lease", () => {
  let child: ChildProcess | undefined;

  afterEach(async () => {
    delete testHooks[reclaimInspectionTestHookKey];
    child?.kill("SIGKILL");
    if (child !== undefined && child.exitCode === null && child.signalCode === null) {
      await once(child, "exit").catch(() => undefined);
    }
    child = undefined;
    await chmod(leaseDirectory, 0o700).catch(() => undefined);
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("serializes independent operations and remains reentrant in one async chain", async () => {
    let enterFirst!: () => void;
    let releaseFirst!: () => void;
    const entered = new Promise<void>((resolve) => { enterFirst = resolve; });
    const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let nestedRan = false;

    const first = withEditorSessionLease({ repoRoot, sessionId, operation: "save" }, async () => {
      await withEditorSessionLease({ repoRoot, sessionId, operation: "mark-saved" }, async () => {
        nestedRan = true;
      });
      enterFirst();
      await release;
    });
    await entered;

    await expect(withEditorSessionLease({
      repoRoot,
      sessionId,
      operation: "restore",
      options: { waitMs: 25, pollMs: 5 }
    }, async () => undefined)).rejects.toBeInstanceOf(EditorSessionLeaseError);
    expect(nestedRan).toBe(true);

    releaseFirst();
    await first;
    await expect(withEditorSessionLease({ repoRoot, sessionId, operation: "close" }, async () => "released"))
      .resolves.toBe("released");
  });

  it("does not evict a live external owner and reclaims it after that process exits", async () => {
    const leasePath = editorSessionLeasePath(repoRoot, sessionId);
    const script = `
      const fs = require("node:fs");
      const path = require("node:path");
      const leasePath = process.argv[1];
      fs.mkdirSync(path.dirname(leasePath), { recursive: true });
      fs.writeFileSync(leasePath, JSON.stringify({
        schemaVersion: 1,
        token: "external-owner",
        pid: process.pid,
        operation: "save",
        acquiredAt: new Date().toISOString()
      }) + "\\n", { flag: "wx", mode: 0o600 });
      process.stdout.write("ready\\n");
      setInterval(() => undefined, 1000);
    `;
    child = spawn(process.execPath, ["-e", script, leasePath], { stdio: ["ignore", "pipe", "pipe"] });
    await once(child.stdout!, "data");

    await expect(withEditorSessionLease({
      repoRoot,
      sessionId,
      operation: "restore",
      options: { waitMs: 25, pollMs: 5 }
    }, async () => undefined)).rejects.toMatchObject({ code: "session_busy" });

    child.kill("SIGKILL");
    await once(child, "exit");
    child = undefined;
    await expect(withEditorSessionLease({
      repoRoot,
      sessionId,
      operation: "restore",
      options: { waitMs: 100, pollMs: 5 }
    }, async () => "reclaimed")).resolves.toBe("reclaimed");
  });

  it("does not let a delayed stale-owner observation remove a replacement owner", async () => {
    const leasePath = editorSessionLeasePath(repoRoot, sessionId);
    await mkdir(leaseDirectory, { recursive: true });
    await writeFile(leasePath, `${JSON.stringify({
      schemaVersion: 1,
      token: "stale-owner-a",
      pid: 2_147_483_647,
      operation: "save",
      acquiredAt: new Date(Date.now() - 60_000).toISOString()
    })}\n`, { encoding: "utf8", mode: 0o600 });

    const staleOwnerInspected = deferred();
    const resumeDelayedContender = deferred();
    let delayed = false;
    testHooks[reclaimInspectionTestHookKey] = async ({ phase, leasePath: inspectedPath }) => {
      if (delayed || phase !== "lease-inspected" || inspectedPath !== leasePath) {
        return;
      }
      delayed = true;
      staleOwnerInspected.resolve();
      await resumeDelayedContender.promise;
    };
    const delayedContender = withEditorSessionLease({
      repoRoot,
      sessionId,
      operation: "delayed-restore",
      options: { waitMs: 40, pollMs: 5 }
    }, async () => "entered");
    await waitForTestStep(staleOwnerInspected.promise, "the delayed A inspection");

    let markReplacementEntered!: () => void;
    let releaseReplacement!: () => void;
    const replacementEntered = new Promise<void>((resolve) => { markReplacementEntered = resolve; });
    const replacementRelease = new Promise<void>((resolve) => { releaseReplacement = resolve; });
    const replacementOwner = withEditorSessionLease({
      repoRoot,
      sessionId,
      operation: "claim-b",
      options: { waitMs: 100, pollMs: 5 }
    }, async () => {
      markReplacementEntered();
      await replacementRelease;
    });
    await waitForTestStep(replacementEntered, "replacement owner B to enter");

    resumeDelayedContender.resolve();
    const delayedOutcome = await delayedContender.then(
      (value) => value,
      (error: unknown) => error instanceof EditorSessionLeaseError ? error.code : "unexpected-error"
    );
    releaseReplacement();
    await replacementOwner;

    expect(delayedOutcome).toBe("session_busy");
  });

  it("recovers coordination abandoned by a dead process without evicting replacement B", async () => {
    const leasePath = editorSessionLeasePath(repoRoot, sessionId);
    const staleToken = "stale-owner-a";
    await mkdir(leaseDirectory, { recursive: true });
    await writeFile(leasePath, `${JSON.stringify({
      schemaVersion: 1,
      token: staleToken,
      pid: 2_147_483_647,
      operation: "save",
      acquiredAt: new Date(Date.now() - 60_000).toISOString()
    })}\n`, { encoding: "utf8", mode: 0o600 });

    const coordinationPath = `${leasePath}.reclaim-${createHash("sha256").update(staleToken).digest("hex")}`;
    const script = `
      const crypto = require("node:crypto");
      const fs = require("node:fs");
      const path = require("node:path");
      const coordinationPath = process.argv[1];
      const token = crypto.randomUUID();
      fs.mkdirSync(path.join(coordinationPath, process.pid + "-" + token), { recursive: true });
      process.stdout.write("ready\\n");
      setInterval(() => undefined, 1000);
    `;
    child = spawn(process.execPath, ["-e", script, coordinationPath], { stdio: ["ignore", "pipe", "pipe"] });
    await once(child.stdout!, "data");
    child.kill("SIGKILL");
    await once(child, "exit");
    child = undefined;

    const deadCoordinatorInspected = deferred();
    const resumeDelayedRecovery = deferred();
    let delayed = false;
    testHooks[reclaimInspectionTestHookKey] = async ({ phase, leasePath: inspectedPath }) => {
      if (delayed || phase !== "coordinator-inspected" || inspectedPath !== leasePath) {
        return;
      }
      delayed = true;
      deadCoordinatorInspected.resolve();
      await resumeDelayedRecovery.promise;
    };

    const delayedRecovery = withEditorSessionLease({
      repoRoot,
      sessionId,
      operation: "delayed-recovery",
      options: { waitMs: 80, pollMs: 5 }
    }, async () => "entered");
    await waitForTestStep(deadCoordinatorInspected.promise, "dead reclaim coordinator inspection");

    const replacementEntered = deferred();
    const releaseReplacement = deferred();
    const replacementOwner = withEditorSessionLease({
      repoRoot,
      sessionId,
      operation: "claim-b-after-reclaimer-crash",
      options: { waitMs: 200, pollMs: 5 }
    }, async () => {
      replacementEntered.resolve();
      await releaseReplacement.promise;
    });
    await waitForTestStep(replacementEntered.promise, "replacement B after coordinator recovery");

    resumeDelayedRecovery.resolve();
    const delayedOutcome = await delayedRecovery.then(
      (value) => value,
      (error: unknown) => error instanceof EditorSessionLeaseError ? error.code : "unexpected-error"
    );
    releaseReplacement.resolve();
    await replacementOwner;

    expect(delayedOutcome).toBe("session_busy");
  });

  it("times out instead of spinning when an abandoned lock cannot be removed", async () => {
    const leasePath = editorSessionLeasePath(repoRoot, sessionId);
    await mkdir(leaseDirectory, { recursive: true });
    await writeFile(leasePath, `${JSON.stringify({
      schemaVersion: 1,
      token: "dead-owner",
      pid: 2_147_483_647,
      operation: "save",
      acquiredAt: new Date(Date.now() - 60_000).toISOString()
    })}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(leaseDirectory, 0o500);

    const startedAt = Date.now();
    await expect(withEditorSessionLease({
      repoRoot,
      sessionId,
      operation: "restore",
      options: { waitMs: 25, pollMs: 5 }
    }, async () => undefined)).rejects.toMatchObject({ code: "session_busy" });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(20);
  });
});
