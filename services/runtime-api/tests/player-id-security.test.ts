/** Public request trust-boundary coverage for the canonical command envelope. */

import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  SessionCommandTransaction,
  SessionCommandTransactionInput
} from "@cubica/contracts-session";
import {
  parseAgentTurnRequest,
  parseCreateSessionRequest,
  parseDispatchActionRequest
} from "../src/modules/player-api/requestValidation.ts";
import { createRuntimeApiServer } from "../src/modules/player-api/httpServer.ts";
import { InMemorySessionStore } from "../src/modules/session/inMemorySessionStore.ts";
import {
  createLocalSessionAccess,
  hashSessionCredential,
  resolveSessionActor
} from "../src/modules/session/sessionAuthentication.ts";
import { SessionAuthorizationError } from "../src/modules/session/sessionStoreErrors.ts";

const validCommand = {
  sessionId: "session-1",
  actionId: "advance",
  commandId: "cli_AAAAAAAAAAAAAAAAAAAAAA",
  expectedStateVersion: 0,
  params: {}
};

/**
 * Records whether an HTTP command reached the session transaction. Command
 * fingerprinting happens inside that transaction, so a zero count proves the
 * transport schema rejected the body before either storage or fingerprinting.
 */
class CommandTransactionTrackingStore extends InMemorySessionStore<Record<string, unknown>> {
  commandTransactionCount = 0;

  override async withCommandTransaction<TResult>(
    input: SessionCommandTransactionInput,
    operation: SessionCommandTransaction<Record<string, unknown>, TResult>
  ): Promise<TResult> {
    this.commandTransactionCount += 1;
    return super.withCommandTransaction(input, operation);
  }
}

test("public session and command bodies reject client-selected player identity", () => {
  assert.throws(
    () => parseCreateSessionRequest({ gameId: "neutral-game", playerId: "participant-1" }),
    /unsupported field "playerId"/u
  );
  assert.throws(
    () => parseDispatchActionRequest({ ...validCommand, playerId: "participant-1" }),
    /additional properties/u
  );
  assert.throws(
    () => parseAgentTurnRequest({ ...validCommand, playerId: "participant-1" }),
    /additional properties/u
  );
});

test("legacy payload and unknown envelope fields are rejected", () => {
  for (const unsupported of [{ payload: {} }, { role: "facilitator" }, { op: "state.set" }]) {
    assert.throws(
      () => parseDispatchActionRequest({ ...validCommand, ...unsupported }),
      /additional properties/u
    );
  }
});

test("external command id has one unambiguous cli_ profile", () => {
  assert.deepEqual(parseDispatchActionRequest(validCommand), validCommand);
  for (const commandId of [
    "sys_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "cli_too-short",
    "cli_AAAAAAAAAAAAAAAAAAAAA=",
    "advance-turn-42"
  ]) {
    assert.throws(
      () => parseDispatchActionRequest({ ...validCommand, commandId }),
      /runtime command schema/u
    );
  }
});

test("params are required and prototype-sensitive top-level keys are rejected", () => {
  const { params: _params, ...withoutParams } = validCommand;
  assert.throws(() => parseDispatchActionRequest(withoutParams), /required property 'params'/u);
  for (const key of ["__proto__", "constructor", "prototype"]) {
    const params = Object.create(null) as Record<string, unknown>;
    params[key] = true;
    assert.throws(
      () => parseDispatchActionRequest({ ...validCommand, params }),
      /must match pattern/u
    );
  }
});

test("params transport envelope accepts the bounded scalar types used by action schemas", () => {
  const params = {
    vehicleId: "vehicle-1",
    redContribution: 2,
    positionT: 0.25,
    enabled: true
  };

  assert.deepEqual(parseDispatchActionRequest({ ...validCommand, params }).params, params);
});

test("params transport envelope rejects nested values, arrays, unsafe names and excessive width", () => {
  const tooWide = Object.fromEntries(
    Array.from({ length: 17 }, (_, index) => [`param${index}`, index])
  );
  for (const params of [
    { nested: { deeper: { value: "unbounded" } } },
    { list: ["nested"] },
    { "not a safe name": true },
    tooWide
  ]) {
    assert.throws(
      () => parseDispatchActionRequest({ ...validCommand, params }),
      /runtime command schema/u
    );
  }
});

test("HTTP rejects nested and over-wide params before session storage and fingerprinting", async () => {
  const sessionStore = new CommandTransactionTrackingStore();
  const api = createRuntimeApiServer({ port: 0, sessionStore });
  await api.start();
  const tooWide = Object.fromEntries(
    Array.from({ length: 17 }, (_, index) => [`param${index}`, index])
  );

  try {
    for (const params of [
      { nested: { deeper: { value: "unbounded" } } },
      tooWide
    ]) {
      const response = await fetch(`http://127.0.0.1:${api.port}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validCommand, params })
      });
      const body = await response.json() as { error?: string };

      assert.equal(response.status, 400);
      assert.match(body.error ?? "", /runtime command schema/u);
    }
    assert.equal(sessionStore.commandTransactionCount, 0);
  } finally {
    await api.close();
  }
});

test("local session credential contains at least 32 random bytes and storage sees only SHA-256", () => {
  const access = createLocalSessionAccess("player");
  assert.match(access.accessToken, /^ses_[A-Za-z0-9_-]{43}$/u);
  assert.equal(Buffer.from(access.accessToken.slice(4), "base64url").byteLength, 32);
  assert.match(access.principal.credentialSha256, /^[a-f0-9]{64}$/u);
  assert.equal(access.principal.credentialSha256, hashSessionCredential(access.accessToken));
  assert.doesNotMatch(access.principal.credentialSha256, /ses_/u);
});

test("server resolves the active actor from authenticated scope and authoritative state", () => {
  const session = {
    sessionId: "session-1",
    gameId: "neutral-game",
    bundleHash: "a".repeat(64),
    state: { public: { turn: { activePlayerId: "p2" } } },
    sessionRole: "player" as const,
    version: { sessionId: "session-1", stateVersion: 3, lastEventSequence: 3 },
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const principal = {
    principalId: "principal-1",
    sessionId: "session-1",
    kind: "local-controller" as const,
    role: "player" as const,
    actorScope: { kind: "all-session-actors" as const },
    createdAt: new Date()
  };
  assert.equal(resolveSessionActor(session, principal), "p2");
  assert.throws(
    () => resolveSessionActor(session, {
      ...principal,
      actorScope: { kind: "listed-actors", actorIds: ["p1"] }
    }),
    SessionAuthorizationError
  );
});
