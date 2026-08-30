/** Shared invariants enforced by every command-transaction store adapter. */

import type {
  SessionCommandReceipt,
  SessionCommandTransactionInput,
  SessionEventRecord,
  SessionPrincipal,
  SessionRecord
} from "@cubica/contracts-session";
import { canonicalizeJson } from "../content/canonicalJson.ts";
import { requireProtectedMechanicsAudit } from "./commandIdentity.ts";
import { assertNextSessionVersion, SessionStoreUnavailableError } from "./sessionStoreErrors.ts";

const MAX_DURABLE_COMMAND_RESULT_UTF8_BYTES = 60 * 1024;
const MAX_DURABLE_EVENT_UTF8_BYTES = 320 * 1024;
const MAX_DURABLE_EVENTS_UTF8_BYTES = 3 * 1024 * 1024;

export function assertCommandTransactionResult<TState>(input: {
  input: SessionCommandTransactionInput;
  current: SessionRecord<TState>;
  principal: SessionPrincipal;
  existingReceipt?: SessionCommandReceipt;
  updatedSession?: SessionRecord<TState>;
  receipt?: SessionCommandReceipt;
  events?: ReadonlyArray<SessionEventRecord>;
}): void {
  if (input.existingReceipt !== undefined && input.receipt !== undefined) {
    throw new SessionStoreUnavailableError();
  }
  if (input.updatedSession !== undefined) {
    if (input.receipt === undefined) {
      throw new SessionStoreUnavailableError();
    }
    assertNextSessionVersion(input.input.sessionId, input.current, input.updatedSession);
    if (
      input.updatedSession.bundleHash !== input.current.bundleHash ||
      input.updatedSession.gameId !== input.current.gameId
    ) {
      throw new SessionStoreUnavailableError();
    }
  }
  const events = input.events ?? [];
  assertDurableEventSizes(events);
  if (events.length > 0 && (input.updatedSession === undefined || input.receipt === undefined)) {
    throw new SessionStoreUnavailableError();
  }
  if (input.receipt !== undefined) {
    if (
      input.receipt.sessionId !== input.input.sessionId ||
      input.receipt.principalId !== input.principal.principalId ||
      input.receipt.commandId !== input.input.commandId ||
      input.receipt.bundleHash !== input.current.bundleHash ||
      input.receipt.stateVersionBefore !== input.current.version.stateVersion ||
      input.receipt.stateVersionAfter !==
        (input.updatedSession?.version.stateVersion ?? input.current.version.stateVersion)
    ) {
      throw new SessionStoreUnavailableError();
    }
    if (
      input.receipt.status === "applied" && input.updatedSession === undefined ||
      input.receipt.status === "rejected" && input.updatedSession !== undefined
    ) {
      throw new SessionStoreUnavailableError();
    }
    const expectedEventCount = (input.updatedSession?.version.lastEventSequence ?? input.current.version.lastEventSequence) -
      input.current.version.lastEventSequence;
    if (
      expectedEventCount !== events.length ||
      input.receipt.eventRefs.length !== events.length ||
      input.receipt.status === "rejected" && events.length > 0
    ) {
      throw new SessionStoreUnavailableError();
    }
    assertPublicReceiptProjection(input.receipt);
    assertDurableReceiptResult(input.receipt);
    if (input.receipt.audit.mechanics !== undefined) {
      try {
        requireProtectedMechanicsAudit(input.receipt.audit.mechanics);
      } catch {
        throw new SessionStoreUnavailableError();
      }
    }
    const eventActionId = input.receipt.audit.selectedActionId ?? input.receipt.actionId;
    for (const [index, event] of events.entries()) {
      const sequence = input.current.version.lastEventSequence + index + 1;
      const eventId = `${input.input.sessionId}:${sequence}`;
      if (
        event.eventId !== eventId ||
        event.sessionId !== input.input.sessionId ||
        event.sequence !== sequence ||
        event.receiptId !== input.receipt.receiptId ||
        event.commandId !== input.input.commandId ||
        event.actionId !== eventActionId ||
        event.principalId !== input.principal.principalId ||
        event.actorId !== input.receipt.actorId ||
        input.receipt.eventRefs[index] !== eventId ||
        !["public", "actor", "server"].includes(event.audience) ||
        typeof event.eventType !== "string" || event.eventType.length === 0 ||
        !(event.createdAt instanceof Date) || Number.isNaN(event.createdAt.getTime()) ||
        typeof event.data !== "object" || event.data === null || Array.isArray(event.data)
      ) {
        throw new SessionStoreUnavailableError();
      }
    }
  } else if (events.length > 0) {
    throw new SessionStoreUnavailableError();
  }
}

/** Account for receipt/session metadata added after the Mechanics raw-event gate. */
function assertDurableEventSizes(events: ReadonlyArray<SessionEventRecord>): void {
  let aggregateBytes = 2; // JSON array brackets.
  for (const event of events) {
    let eventBytes: number;
    try {
      eventBytes = Buffer.byteLength(JSON.stringify(event), "utf8");
    } catch {
      throw new SessionStoreUnavailableError();
    }
    if (eventBytes > MAX_DURABLE_EVENT_UTF8_BYTES) throw new SessionStoreUnavailableError();
    aggregateBytes += eventBytes + 1;
    if (aggregateBytes > MAX_DURABLE_EVENTS_UTF8_BYTES) throw new SessionStoreUnavailableError();
  }
}

/**
 * Shared public fields must be a faithful projection of the protected row.
 * `planHash` may be intentionally omitted from the public form, but when it is
 * exposed it cannot name another plan.
 */
function assertPublicReceiptProjection(receipt: SessionCommandReceipt): void {
  const publicReceipt = receipt.publicReceipt;
  if (
    publicReceipt.commandId !== receipt.commandId ||
    publicReceipt.actionId !== receipt.actionId ||
    publicReceipt.status !== receipt.status ||
    publicReceipt.stateVersionBefore !== receipt.stateVersionBefore ||
    publicReceipt.stateVersionAfter !== receipt.stateVersionAfter ||
    publicReceipt.eventRefs.length !== receipt.eventRefs.length ||
    publicReceipt.eventRefs.some((eventRef, index) => eventRef !== receipt.eventRefs[index]) ||
    publicReceipt.planHash !== undefined && publicReceipt.planHash !== receipt.planHash ||
    receipt.status === "applied" && publicReceipt.rejectionCode !== undefined ||
    receipt.status === "rejected" && (
      typeof publicReceipt.rejectionCode !== "string" || publicReceipt.rejectionCode.length === 0
    )
  ) {
    throw new SessionStoreUnavailableError();
  }
}

/** Keep command_result small, versioned, and independent from authoritative state. */
function assertDurableReceiptResult(receipt: SessionCommandReceipt): void {
  const result = receipt.result;
  if (
    receipt.audit.triggerActionId !== receipt.actionId ||
    !["game-intent", "agent-turn"].includes(String(receipt.audit.commandKind)) ||
    receipt.audit.selectedActionId !== undefined && receipt.audit.selectedActionId.length === 0 ||
    typeof result !== "object" || result === null || Array.isArray(result)
  ) {
    throw new SessionStoreUnavailableError();
  }
  // Narrow once and keep every subsequent invariant on the same inspected
  // record. This avoids casts that could accidentally read a different shape.
  const durableResult = result as Record<string, unknown>;
  if (
    durableResult.formatVersion !== "1.0.0" ||
    !["game-intent", "agent-turn"].includes(String(durableResult.kind)) ||
    !("value" in durableResult)
  ) throw new SessionStoreUnavailableError();
  const expectedKind = receipt.audit.commandKind;
  if (durableResult.kind !== expectedKind) throw new SessionStoreUnavailableError();
  try {
    if (Buffer.byteLength(canonicalizeJson(result), "utf8") > MAX_DURABLE_COMMAND_RESULT_UTF8_BYTES) {
      throw new SessionStoreUnavailableError();
    }
  } catch {
    throw new SessionStoreUnavailableError();
  }
  if (durableResult.kind === "game-intent") {
    const value = durableResult.value;
    if (
      typeof value !== "object" || value === null || Array.isArray(value) ||
      typeof (value as { ok?: unknown }).ok !== "boolean" ||
      Object.keys(value).some((key) => !["ok", "error"].includes(key))
    ) {
      throw new SessionStoreUnavailableError();
    }
  }
}
