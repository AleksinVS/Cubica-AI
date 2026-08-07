/** Direct invariant tests for store-independent command transaction validation. */

import assert from "node:assert/strict";
import test from "node:test";
import type {
  DispatchActionInput,
  SessionCommandReceipt,
  SessionCommandTransactionInput,
  SessionEventRecord,
  SessionPrincipal,
  SessionRecord
} from "@cubica/contracts-session";

import {
  createAppliedCommandReceipt,
  createDurableCommandResult
} from "../src/modules/session/commandIdentity.ts";
import { assertCommandTransactionResult } from "../src/modules/session/commandTransactionValidation.ts";
import { SessionStoreUnavailableError } from "../src/modules/session/sessionStoreErrors.ts";

type RuntimeState = Record<string, unknown>;

test("a coherent session, receipt and event advance is admitted", () => {
  const fixture = createFixture(true);
  assert.doesNotThrow(() => assertCommandTransactionResult(fixture));
});

test("mixed retry/new results and partial commits fail before a store mutates", () => {
  const fixture = createFixture(false);
  const invalidCases = [
    { ...fixture, existingReceipt: fixture.receipt },
    { ...fixture, receipt: undefined },
    {
      ...fixture,
      updatedSession: { ...fixture.updatedSession, bundleHash: `cubica-bundle-v1:sha256:${"f".repeat(64)}` }
    },
    {
      ...fixture,
      receipt: {
        ...fixture.receipt,
        publicReceipt: { ...fixture.receipt.publicReceipt, stateVersionAfter: 99 }
      }
    }
  ];

  for (const candidate of invalidCases) {
    assert.throws(
      () => assertCommandTransactionResult(candidate),
      SessionStoreUnavailableError
    );
  }
});

test("event ledger identity is checked against the exact committed sequence", () => {
  const fixture = createFixture(true);
  const forgedEvent = {
    ...fixture.events[0]!,
    eventId: `${fixture.current.sessionId}:2`,
    sequence: 2
  };

  assert.throws(
    () => assertCommandTransactionResult({ ...fixture, events: [forgedEvent] }),
    SessionStoreUnavailableError
  );
});

function createFixture(withEvent: boolean): {
  input: SessionCommandTransactionInput;
  current: SessionRecord<RuntimeState>;
  principal: SessionPrincipal;
  updatedSession: SessionRecord<RuntimeState>;
  receipt: SessionCommandReceipt;
  events: SessionEventRecord[];
} {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const now = new Date("2026-08-06T12:00:00.000Z");
  const bundleHash = `cubica-bundle-v1:sha256:${"b".repeat(64)}`;
  const command: DispatchActionInput = {
    sessionId,
    actionId: "fixture.apply",
    commandId: `cli_${"A".repeat(22)}`,
    expectedStateVersion: 4,
    params: {}
  };
  const current: SessionRecord<RuntimeState> = {
    sessionId,
    gameId: "transaction-validation-fixture",
    bundleHash,
    state: { public: { count: 4 } },
    version: { sessionId, stateVersion: 4, lastEventSequence: 7 },
    createdAt: now,
    updatedAt: now
  };
  const principal: SessionPrincipal = {
    principalId: "22222222-2222-4222-8222-222222222222",
    sessionId,
    kind: "local-controller",
    role: "facilitator",
    actorScope: { kind: "all-session-actors" },
    createdAt: now
  };
  const updatedSession: SessionRecord<RuntimeState> = {
    ...current,
    state: { public: { count: 5 } },
    version: {
      sessionId,
      stateVersion: 5,
      lastEventSequence: current.version.lastEventSequence + (withEvent ? 1 : 0)
    },
    updatedAt: new Date("2026-08-06T12:00:01.000Z")
  };
  const eventRefs = withEvent ? [`${sessionId}:8`] : [];
  const receipt = createAppliedCommandReceipt({
    command,
    principal,
    before: current,
    after: updatedSession,
    fingerprint: "c".repeat(64),
    definitionHash: `sha256:${"d".repeat(64)}`,
    planHash: `sha256:${"e".repeat(64)}`,
    eventRefs,
    durableResult: createDurableCommandResult("game-intent", { ok: true })
  });
  const events: SessionEventRecord[] = withEvent ? [{
    eventId: eventRefs[0]!,
    sessionId,
    sequence: 8,
    receiptId: receipt.receiptId,
    commandId: command.commandId,
    actionId: command.actionId,
    principalId: principal.principalId,
    audience: "public",
    eventType: "fixture.applied",
    summary: { messageKey: "fixture.applied" },
    data: { count: 5 },
    createdAt: updatedSession.updatedAt
  }] : [];

  return {
    input: {
      sessionId,
      commandId: command.commandId,
      credentialSha256: "a".repeat(64)
    },
    current,
    principal,
    updatedSession,
    receipt,
    events
  };
}
