/**
 * Stable identities and receipts for externally delivered gameplay commands.
 *
 * The transport request id is intentionally excluded from the fingerprint: a
 * retry may use a new HTTP delivery while still representing the same logical
 * command. Rule and bundle hashes remain included so an old command cannot be
 * silently rebound after content changes.
 */

import { createHash, randomUUID } from "node:crypto";
import type {
  DispatchActionInput,
  PublicSessionCommandReceipt,
  SessionCommandReceipt,
  SessionMechanicsAudit,
  SessionPrincipal,
  SessionRecord
} from "@cubica/contracts-session";
import { canonicalizeJson } from "../content/canonicalJson.ts";

const DURABLE_COMMAND_RESULT_FORMAT = "1.0.0" as const;
// Keep headroom for PostgreSQL JSONB's normalized textual spacing below the
// database's independent 64 KiB constraint.
const MAX_DURABLE_COMMAND_RESULT_UTF8_BYTES = 60 * 1024;
// The largest published Mechanics budget permits 8 MiB of step audit. Keep a
// small envelope allowance for the version and cost fields while still
// bounding every receipt before it reaches either store adapter.
export const MAX_PROTECTED_MECHANICS_AUDIT_UTF8_BYTES = 8 * 1024 * 1024 + 16 * 1024;

export interface DurableCommandResult {
  formatVersion: typeof DURABLE_COMMAND_RESULT_FORMAT;
  kind: "game-intent" | "agent-turn";
  value: unknown;
}

export interface ExternalCommandFingerprintInput {
  command: DispatchActionInput;
  bundleHash: string;
  definitionHash: string;
  previewRef?: unknown;
}

export function createExternalCommandFingerprint(input: ExternalCommandFingerprintInput): string {
  return sha256({
    actionId: input.command.actionId,
    params: input.command.params,
    expectedStateVersion: input.command.expectedStateVersion,
    bundleHash: input.bundleHash,
    definitionHash: input.definitionHash,
    ...(input.previewRef === undefined ? {} : { previewRef: input.previewRef })
  });
}

/**
 * Derive one scheduler command identity exactly as pinned by ADR-084.
 * The `sys_` prefix describes the profile; only the internal store boundary
 * grants authority to execute it.
 */
export function createSystemCommandId(
  sessionId: string,
  scheduleId: string,
  occurrence: number
): string {
  if (!sessionId || !scheduleId || !Number.isSafeInteger(occurrence) || occurrence < 1) {
    throw new Error("System command identity requires a session, schedule and positive occurrence");
  }
  const digest = createHash("sha256")
    .update(canonicalizeJson(["cubica.system-command/v1", sessionId, scheduleId, occurrence]))
    .digest("base64url");
  return `sys_${digest}`;
}

export function createSystemCommandFingerprint(input: {
  sessionId: string;
  scheduleId: string;
  occurrence: number;
  actionId: string;
  params: Record<string, string | number | boolean>;
  bundleHash: string;
  definitionHash: string;
}): string {
  return sha256({
    profile: "cubica.system-command/v1",
    sessionId: input.sessionId,
    scheduleId: input.scheduleId,
    occurrence: input.occurrence,
    actionId: input.actionId,
    params: input.params,
    bundleHash: input.bundleHash,
    definitionHash: input.definitionHash
  });
}

/** Hash a published action definition independently from its runtime plan. */
export function createActionDefinitionHash(definition: unknown): string {
  return `sha256:${sha256(definition)}`;
}

export interface CreateAppliedCommandReceiptInput<TState> {
  command: DispatchActionInput;
  principal: SessionPrincipal;
  actorId?: string;
  before: SessionRecord<TState>;
  after: SessionRecord<TState>;
  fingerprint: string;
  definitionHash: string;
  planHash?: string;
  eventRefs?: ReadonlyArray<string>;
  durableResult?: DurableCommandResult;
  selectedActionId?: string;
  commandKind?: DurableCommandResult["kind"];
  mechanicsAudit?: SessionMechanicsAudit;
}

/** Build the internal audit row and its explicitly safe public projection. */
export function createAppliedCommandReceipt<TState>(
  input: CreateAppliedCommandReceiptInput<TState>
): SessionCommandReceipt {
  const now = new Date();
  const eventRefs = [...(input.eventRefs ?? [])];
  const publicReceipt: PublicSessionCommandReceipt = {
    commandId: input.command.commandId,
    actionId: input.command.actionId,
    status: "applied",
    stateVersionBefore: input.before.version.stateVersion,
    stateVersionAfter: input.after.version.stateVersion,
    eventRefs,
    ...(input.planHash === undefined ? {} : { planHash: input.planHash })
  };

  return {
    receiptId: randomUUID(),
    sessionId: input.before.sessionId,
    principalId: input.principal.principalId,
    commandId: input.command.commandId,
    fingerprint: input.fingerprint,
    actionId: input.command.actionId,
    ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
    bundleHash: input.before.bundleHash,
    definitionHash: input.definitionHash,
    ...(input.planHash === undefined ? {} : { planHash: input.planHash }),
    stateVersionBefore: input.before.version.stateVersion,
    stateVersionAfter: input.after.version.stateVersion,
    status: "applied",
    eventRefs,
    publicReceipt,
    ...(input.durableResult === undefined ? {} : { result: cloneBoundedDurableResult(input.durableResult) }),
    audit: {
      acceptedAt: now,
      ...(input.command.requestId === undefined ? {} : { requestId: input.command.requestId }),
      commandKind: input.commandKind ?? "game-intent",
      triggerActionId: input.command.actionId,
      ...(input.selectedActionId === undefined ? {} : { selectedActionId: input.selectedActionId }),
      ...(input.mechanicsAudit === undefined
        ? {}
        : { mechanics: requireProtectedMechanicsAudit(input.mechanicsAudit) })
    },
    createdAt: now
  };
}

export interface CreateRejectedCommandReceiptInput<TState> {
  command: DispatchActionInput;
  principal: SessionPrincipal;
  actorId?: string;
  current: SessionRecord<TState>;
  fingerprint: string;
  definitionHash: string;
  rejectionCode: string;
  planHash?: string;
  durableResult?: DurableCommandResult;
  selectedActionId?: string;
  commandKind?: DurableCommandResult["kind"];
}

/** Persist a stable admitted gameplay rejection without changing session state. */
export function createRejectedCommandReceipt<TState>(
  input: CreateRejectedCommandReceiptInput<TState>
): SessionCommandReceipt {
  const now = new Date();
  const publicReceipt: PublicSessionCommandReceipt = {
    commandId: input.command.commandId,
    actionId: input.command.actionId,
    status: "rejected",
    stateVersionBefore: input.current.version.stateVersion,
    stateVersionAfter: input.current.version.stateVersion,
    eventRefs: [],
    rejectionCode: input.rejectionCode,
    ...(input.planHash === undefined ? {} : { planHash: input.planHash })
  };
  return {
    receiptId: randomUUID(),
    sessionId: input.current.sessionId,
    principalId: input.principal.principalId,
    commandId: input.command.commandId,
    fingerprint: input.fingerprint,
    actionId: input.command.actionId,
    ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
    bundleHash: input.current.bundleHash,
    definitionHash: input.definitionHash,
    ...(input.planHash === undefined ? {} : { planHash: input.planHash }),
    stateVersionBefore: input.current.version.stateVersion,
    stateVersionAfter: input.current.version.stateVersion,
    status: "rejected",
    eventRefs: [],
    publicReceipt,
    ...(input.durableResult === undefined ? {} : { result: cloneBoundedDurableResult(input.durableResult) }),
    audit: {
      acceptedAt: now,
      ...(input.command.requestId === undefined ? {} : { requestId: input.command.requestId }),
      commandKind: input.commandKind ?? "game-intent",
      triggerActionId: input.command.actionId,
      ...(input.selectedActionId === undefined ? {} : { selectedActionId: input.selectedActionId })
    },
    createdAt: now
  };
}

/**
 * Create the only durable shape allowed in `command_result`.
 *
 * Candidate state and emitted events deliberately do not fit this API: they
 * already have authoritative storage and copying them into every receipt
 * would multiply both secrets and database size by the number of commands.
 */
export function createDurableCommandResult(
  kind: DurableCommandResult["kind"],
  value: unknown
): DurableCommandResult {
  return cloneBoundedDurableResult({
    formatVersion: DURABLE_COMMAND_RESULT_FORMAT,
    kind,
    value
  });
}

/** Read a historical result by its pinned format, without current game rules. */
export function requireDurableCommandResult(
  value: unknown,
  expectedKind: DurableCommandResult["kind"]
): DurableCommandResult {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    (value as { formatVersion?: unknown }).formatVersion !== DURABLE_COMMAND_RESULT_FORMAT ||
    (value as { kind?: unknown }).kind !== expectedKind ||
    !("value" in value)
  ) {
    throw new Error("Stored command result uses an unsupported durable format");
  }
  return cloneBoundedDurableResult(value as DurableCommandResult);
}

/**
 * Validate and clone a protected Mechanics audit at every durable boundary.
 *
 * The executor already charges this output against the selected runtime
 * budget. This second, format-aware gate protects hand-built store calls and
 * historical PostgreSQL rows from bypassing that executor boundary.
 */
export function requireProtectedMechanicsAudit(value: unknown): SessionMechanicsAudit {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Stored Mechanics audit uses an unsupported durable format");
  }
  const audit = value as Record<string, unknown>;
  if (audit.formatVersion !== "1.0.0" || !Array.isArray(audit.steps)) {
    throw new Error("Stored Mechanics audit uses an unsupported durable format");
  }
  for (const step of audit.steps) {
    if (
      typeof step !== "object" || step === null || Array.isArray(step) ||
      typeof (step as { stepId?: unknown }).stepId !== "string" ||
      (step as { stepId: string }).stepId.length === 0 ||
      typeof (step as { operation?: unknown }).operation !== "string" ||
      (step as { operation: string }).operation.length === 0
    ) {
      throw new Error("Stored Mechanics audit contains an invalid step");
    }
  }
  const cost = audit.cost;
  if (typeof cost !== "object" || cost === null || Array.isArray(cost)) {
    throw new Error("Stored Mechanics audit contains invalid resource counters");
  }
  const counters = cost as Record<string, unknown>;
  const counterNames = [
    "steps",
    "expressionNodes",
    "scannedEntities",
    "resultEntities",
    "writes",
    "events",
    "intermediateBytes",
    "eventBytes",
    "auditBytes"
  ] as const;
  if (counterNames.some((name) => !isNonNegativeSafeInteger(counters[name]))) {
    throw new Error("Stored Mechanics audit contains invalid resource counters");
  }
  // Receipts created before algorithm metering remain readable. Every new
  // executor result includes this counter; if an old durable record omits it,
  // its absence means only that the historical value was not measured.
  if (counters.algorithmWork !== undefined && !isNonNegativeSafeInteger(counters.algorithmWork)) {
    throw new Error("Stored Mechanics audit contains invalid algorithm work counter");
  }
  if (counters.steps !== audit.steps.length) {
    throw new Error("Stored Mechanics audit step counter does not match its trace");
  }
  const canonical = canonicalizeJson(value);
  if (Buffer.byteLength(canonical, "utf8") > MAX_PROTECTED_MECHANICS_AUDIT_UTF8_BYTES) {
    throw new Error("Protected Mechanics audit exceeds the safe durable limit");
  }
  return structuredClone(value) as SessionMechanicsAudit;
}

function cloneBoundedDurableResult(result: DurableCommandResult): DurableCommandResult {
  const canonical = canonicalizeJson(result);
  if (Buffer.byteLength(canonical, "utf8") > MAX_DURABLE_COMMAND_RESULT_UTF8_BYTES) {
    throw new Error("Durable command result exceeds the safe 60 KiB application limit");
  }
  return structuredClone(result);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalizeJson(value)).digest("hex");
}
