/**
 * Cross-process exclusive leases for editor-session mutations.
 *
 * A lease is a short-lived ownership record created with `O_EXCL` (`"wx"`).
 * The filesystem therefore chooses exactly one winner even when separate
 * Next.js workers or a maintenance process race for the same session. The
 * record contains a random owner token and PID so cleanup never removes a lock
 * that still belongs to a live process.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import { EditorRepositoryError } from "./editor-repository";

const sessionIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,80}$/u;
const leaseSchemaVersion = 1;
const defaultWaitMs = readPositiveIntegerEnv("CUBICA_EDITOR_SESSION_LEASE_WAIT_MS", 5_000);
const defaultPollMs = readPositiveIntegerEnv("CUBICA_EDITOR_SESSION_LEASE_POLL_MS", 40);
const invalidOwnerGraceMs = readPositiveIntegerEnv("CUBICA_EDITOR_SESSION_LEASE_INVALID_GRACE_MS", 30_000);
const heldLeaseKeys = new AsyncLocalStorage<ReadonlySet<string>>();

interface EditorSessionLeaseOwner {
  readonly schemaVersion: 1;
  readonly token: string;
  readonly pid: number;
  readonly operation: string;
  readonly acquiredAt: string;
}

export interface EditorSessionLeaseOptions {
  readonly waitMs?: number;
  readonly pollMs?: number;
}

/** Stable operational conflict returned when another process owns a session. */
export class EditorSessionLeaseError extends EditorRepositoryError {
  readonly code = "session_busy" as const;

  constructor() {
    super("Editor session is busy with another operation. Retry shortly.", 409);
    this.name = "EditorSessionLeaseError";
  }
}

/**
 * Runs one complete mutation while holding the session's cross-process lease.
 *
 * Nested calls for the same session are reentrant inside one async call chain;
 * this lets Save call touch/metadata helpers without deadlocking itself while
 * independent requests still contend through the filesystem record.
 */
export async function withEditorSessionLease<T>(
  input: {
    readonly repoRoot: string;
    readonly sessionId: string;
    readonly operation: string;
    readonly options?: EditorSessionLeaseOptions;
  },
  callback: () => Promise<T>
): Promise<T> {
  validateSessionId(input.sessionId);
  const leasePath = editorSessionLeasePath(input.repoRoot, input.sessionId);
  const leaseKey = path.resolve(leasePath);
  const inherited = heldLeaseKeys.getStore();
  if (inherited?.has(leaseKey) === true) {
    return callback();
  }

  const owner = await acquireLease(leasePath, input.operation, input.options);
  const nextHeld = new Set(inherited ?? []);
  nextHeld.add(leaseKey);

  try {
    return await heldLeaseKeys.run(nextHeld, callback);
  } finally {
    await releaseLease(leasePath, owner.token);
  }
}

/** Exposed for integration tests and operator diagnostics; it never creates the file. */
export function editorSessionLeasePath(repoRoot: string, sessionId: string): string {
  validateSessionId(sessionId);
  return path.join(path.resolve(repoRoot), ".tmp", "editor-session-leases", `${sessionId}.lock`);
}

async function acquireLease(
  leasePath: string,
  operation: string,
  options: EditorSessionLeaseOptions | undefined
): Promise<EditorSessionLeaseOwner> {
  const waitMs = normalizeNonNegativeInteger(options?.waitMs, defaultWaitMs);
  const pollMs = Math.max(1, normalizeNonNegativeInteger(options?.pollMs, defaultPollMs));
  const deadline = Date.now() + waitMs;
  await mkdir(path.dirname(leasePath), { recursive: true });

  for (;;) {
    const owner: EditorSessionLeaseOwner = {
      schemaVersion: leaseSchemaVersion,
      token: randomUUID(),
      pid: process.pid,
      operation: normalizeOperation(operation),
      acquiredAt: new Date().toISOString()
    };

    try {
      const handle = await open(leasePath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
        await handle.sync();
      } catch (error) {
        await handle.close().catch(() => undefined);
        await rm(leasePath, { force: true }).catch(() => undefined);
        throw error;
      }
      // The durable ownership record, not the descriptor, is the lock. A rare
      // close error must not turn a successfully-created lease into an orphan
      // that the same live process can never release.
      await handle.close().catch(() => undefined);
      return owner;
    } catch (error) {
      if (!isFileExistsError(error)) {
        throw new EditorRepositoryError("Editor session lease could not be created.", 500);
      }
    }

    if (await reclaimAbandonedLease(leasePath)) {
      continue;
    }
    if (Date.now() >= deadline) {
      throw new EditorSessionLeaseError();
    }
    await delay(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }
}

async function reclaimAbandonedLease(leasePath: string): Promise<boolean> {
  const [owner, fileStat] = await Promise.all([
    readLeaseOwner(leasePath),
    stat(leasePath).catch(() => undefined)
  ]);
  if (fileStat === undefined) {
    return true;
  }

  // A newly-created record can be observed before its owner JSON is flushed.
  // The grace window prevents another process from mistaking that short state
  // for an abandoned lease.
  if (owner === undefined) {
    if (Date.now() - fileStat.mtimeMs < invalidOwnerGraceMs) {
      return false;
    }
  } else if (isProcessAlive(owner.pid)) {
    return false;
  }

  try {
    await rm(leasePath, { force: true });
    return true;
  } catch (error) {
    // A failed stale-lock cleanup is contention, not progress. Returning false
    // preserves the bounded poll/deadline path instead of spinning forever on
    // a filesystem that keeps rejecting deletion.
    return isMissingFileError(error);
  }
}

async function releaseLease(leasePath: string, token: string): Promise<void> {
  const owner = await readLeaseOwner(leasePath);
  if (owner?.token !== token || owner.pid !== process.pid) {
    return;
  }

  // Renaming removes the canonical lock name atomically, so a failed cleanup
  // of the tombstone cannot block future owners. If rename itself repeatedly
  // fails, safety wins over availability: leave the original owner record in
  // place until this process exits rather than risk modifying a replacement
  // owner's canonical lock through a check/remove race.
  const tombstonePath = `${leasePath}.released-${token}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await rename(leasePath, tombstonePath);
      await rm(tombstonePath, { force: true }).catch(() => undefined);
      return;
    } catch (error) {
      if (isMissingFileError(error)) {
        return;
      }
      if (attempt < 2) {
        await delay(10);
      }
    }
  }
}

async function readLeaseOwner(leasePath: string): Promise<EditorSessionLeaseOwner | undefined> {
  try {
    const parsed = JSON.parse(await readFile(leasePath, "utf8")) as Partial<EditorSessionLeaseOwner>;
    if (
      parsed.schemaVersion !== leaseSchemaVersion ||
      typeof parsed.token !== "string" ||
      parsed.token === "" ||
      !Number.isSafeInteger(parsed.pid) ||
      (parsed.pid as number) <= 0 ||
      typeof parsed.operation !== "string" ||
      typeof parsed.acquiredAt !== "string"
    ) {
      return undefined;
    }
    return parsed as EditorSessionLeaseOwner;
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isPermissionError(error);
  }
}

function normalizeOperation(operation: string): string {
  const normalized = operation.trim().replaceAll(/[^a-zA-Z0-9._-]/gu, "-");
  return (normalized === "" ? "mutation" : normalized).slice(0, 80);
}

function validateSessionId(sessionId: string): void {
  if (!sessionIdPattern.test(sessionId) || sessionId.includes("..")) {
    throw new EditorRepositoryError("Session id must be a safe editor session segment.", 400);
  }
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isFileExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { readonly code?: unknown }).code === "EEXIST";
}

function isPermissionError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { readonly code?: unknown }).code === "EPERM";
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { readonly code?: unknown }).code === "ENOENT";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
