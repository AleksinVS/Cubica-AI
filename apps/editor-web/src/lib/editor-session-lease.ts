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
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
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

type LeaseInspection =
  | { readonly kind: "missing" }
  | { readonly kind: "error" }
  | { readonly kind: "valid"; readonly owner: EditorSessionLeaseOwner; readonly fileStat: Stats }
  | { readonly kind: "invalid"; readonly fileStat: Stats };

interface ReclaimCoordinatorOwner {
  readonly pid: number;
  readonly token: string;
}

interface ReclaimCoordination {
  readonly path: string;
  readonly owner: ReclaimCoordinatorOwner;
  readonly recoveredTombstones: readonly string[];
}

type ReclaimCoordinatorInspection =
  | { readonly kind: "missing" }
  | { readonly kind: "error" }
  | { readonly kind: "valid"; readonly owner: ReclaimCoordinatorOwner };

const reclaimInspectionTestHookKey = Symbol.for("cubica.test.editor-session-lease.reclaim-inspected");

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
  const inspected = await inspectLease(leasePath);
  if (inspected.kind === "missing") {
    return true;
  }
  if (inspected.kind === "error") {
    return false;
  }

  // A newly-created record can be observed before its owner JSON is flushed.
  // The grace window prevents another process from mistaking that short state
  // for an abandoned lease.
  if (inspected.kind === "invalid") {
    if (Date.now() - inspected.fileStat.mtimeMs < invalidOwnerGraceMs) {
      return false;
    }
  } else if (isProcessAlive(inspected.owner.pid)) {
    return false;
  }

  await runReclaimTestHook("lease-inspected", leasePath);

  const coordination = await acquireReclaimCoordination(leasePath, inspected);
  if (coordination === undefined) {
    return false;
  }

  let identityIsGone = false;
  try {
    const current = await inspectLease(leasePath);
    if (current.kind === "missing") {
      identityIsGone = true;
      return true;
    }
    if (!isSameLeaseIdentity(inspected, current)) {
      identityIsGone = true;
      return false;
    }
    if (current.kind === "valid" && isProcessAlive(current.owner.pid)) {
      return false;
    }

    try {
      await rm(leasePath);
      identityIsGone = true;
      return true;
    } catch (error) {
      // A failed stale-lock cleanup is contention, not progress. Returning
      // false preserves the bounded poll/deadline path instead of spinning.
      return isMissingFileError(error);
    }
  } finally {
    await releaseReclaimCoordination(coordination);
    if (identityIsGone) {
      await Promise.all(coordination.recoveredTombstones.map(async (tombstonePath) => {
        await rm(tombstonePath, { recursive: true, force: true }).catch(() => undefined);
      }));
    }
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
    return parseLeaseOwner(await readFile(leasePath, "utf8"));
  } catch {
    return undefined;
  }
}

async function inspectLease(leasePath: string): Promise<LeaseInspection> {
  let fileStat: Stats;
  try {
    fileStat = await stat(leasePath);
  } catch (error) {
    return isMissingFileError(error) ? { kind: "missing" } : { kind: "error" };
  }

  try {
    const owner = parseLeaseOwner(await readFile(leasePath, "utf8"));
    return owner === undefined
      ? { kind: "invalid", fileStat }
      : { kind: "valid", owner, fileStat };
  } catch (error) {
    return isMissingFileError(error) ? { kind: "missing" } : { kind: "error" };
  }
}

function parseLeaseOwner(contents: string): EditorSessionLeaseOwner | undefined {
  try {
    const parsed = JSON.parse(contents) as Partial<EditorSessionLeaseOwner>;
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

function reclaimCoordinationPath(leasePath: string, inspected: LeaseInspection): string {
  const identity = inspected.kind === "valid"
    ? inspected.owner.token
    : [
        inspected.fileStat.dev,
        inspected.fileStat.ino,
        inspected.fileStat.size,
        inspected.fileStat.mtimeMs,
        inspected.fileStat.ctimeMs
      ].join(":");
  const identityHash = createHash("sha256").update(identity).digest("hex");
  return `${leasePath}.reclaim-${identityHash}`;
}

async function acquireReclaimCoordination(
  leasePath: string,
  inspected: LeaseInspection
): Promise<ReclaimCoordination | undefined> {
  const coordinationPath = reclaimCoordinationPath(leasePath, inspected);
  const owner: ReclaimCoordinatorOwner = { pid: process.pid, token: randomUUID() };
  const candidatePath = `${coordinationPath}.candidate-${owner.token}`;
  const markerPath = path.join(candidatePath, `${owner.pid}-${owner.token}`);
  const recoveredTombstones: string[] = [];

  try {
    await mkdir(markerPath, { recursive: true });
  } catch {
    return undefined;
  }

  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await rename(candidatePath, coordinationPath);
        return { path: coordinationPath, owner, recoveredTombstones };
      } catch (error) {
        if (isMissingFileError(error)) {
          return undefined;
        }
      }

      const current = await inspectReclaimCoordinator(coordinationPath);
      if (current.kind === "missing") {
        // The failed publish and subsequent disappearance do not prove which
        // filesystem action won. Let the bounded outer poll retry from a fresh
        // lease inspection instead of treating ambiguity as ownership.
        return undefined;
      }
      if (current.kind === "error" || isProcessAlive(current.owner.pid)) {
        return undefined;
      }

      await runReclaimTestHook("coordinator-inspected", leasePath);
      const tombstonePath = `${coordinationPath}.abandoned-${current.owner.token}`;
      try {
        // A non-empty directory is never overwritten by directory rename. The
        // retained tombstone therefore turns the observed coordinator token
        // into a compare-and-move fence: a delayed observer of X cannot move a
        // replacement Y onto X's existing tombstone.
        await rename(coordinationPath, tombstonePath);
        recoveredTombstones.push(tombstonePath);
      } catch (error) {
        if (!isMissingFileError(error)) {
          return undefined;
        }
      }
    }
    return undefined;
  } finally {
    await rm(candidatePath, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function inspectReclaimCoordinator(
  coordinationPath: string
): Promise<ReclaimCoordinatorInspection> {
  let entries: Dirent[];
  try {
    entries = await readdir(coordinationPath, { withFileTypes: true });
  } catch (error) {
    return isMissingFileError(error) ? { kind: "missing" } : { kind: "error" };
  }
  if (entries.length !== 1 || !entries[0]?.isDirectory()) {
    return { kind: "error" };
  }

  const match = /^([1-9][0-9]*)-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u
    .exec(entries[0].name);
  const pid = Number(match?.[1]);
  if (match === null || !Number.isSafeInteger(pid)) {
    return { kind: "error" };
  }
  return { kind: "valid", owner: { pid, token: match[2] as string } };
}

async function releaseReclaimCoordination(coordination: ReclaimCoordination): Promise<void> {
  const current = await inspectReclaimCoordinator(coordination.path);
  if (
    current.kind !== "valid"
    || current.owner.pid !== coordination.owner.pid
    || current.owner.token !== coordination.owner.token
  ) {
    return;
  }

  const releasedPath = `${coordination.path}.released-${coordination.owner.token}`;
  try {
    await rename(coordination.path, releasedPath);
    await rm(releasedPath, { recursive: true, force: true }).catch(() => undefined);
  } catch {
    // A later process can recover this live-looking record after this process
    // exits. Keeping it is safer than modifying an ambiguous replacement.
  }
}

function isSameLeaseIdentity(observed: LeaseInspection, current: LeaseInspection): boolean {
  if (observed.kind === "valid" && current.kind === "valid") {
    return observed.owner.token === current.owner.token;
  }
  if (observed.kind !== "invalid" || current.kind !== "invalid") {
    return false;
  }
  return observed.fileStat.dev === current.fileStat.dev
    && observed.fileStat.ino === current.fileStat.ino
    && observed.fileStat.size === current.fileStat.size
    && observed.fileStat.mtimeMs === current.fileStat.mtimeMs
    && observed.fileStat.ctimeMs === current.fileStat.ctimeMs;
}

async function runReclaimTestHook(
  phase: "lease-inspected" | "coordinator-inspected",
  leasePath: string
): Promise<void> {
  if (process.env.NODE_ENV !== "test") {
    return;
  }
  const hooks = globalThis as typeof globalThis & {
    [key: symbol]: ((input: {
      readonly phase: "lease-inspected" | "coordinator-inspected";
      readonly leasePath: string;
    }) => Promise<void>) | undefined;
  };
  await hooks[reclaimInspectionTestHookKey]?.({ phase, leasePath });
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
