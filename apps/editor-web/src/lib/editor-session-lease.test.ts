/** Integration tests for the filesystem-backed editor-session lease. */
import { spawn, type ChildProcess } from "node:child_process";
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

describe("editor session lease", () => {
  let child: ChildProcess | undefined;

  afterEach(async () => {
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
