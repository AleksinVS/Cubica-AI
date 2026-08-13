import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createImmutableBundleContent } from "../src/modules/content/immutableBundle.ts";
import {
  parseCreateSessionRequest,
  parseRestorePreviewSessionRequest
} from "../src/modules/player-api/requestValidation.ts";
import { InMemorySessionStore } from "../src/modules/session/inMemorySessionStore.ts";
import {
  assertSessionParticipantsMatchState,
  materializeLocalSessionParticipants
} from "../src/modules/session/sessionParticipants.ts";

const participants = [
  { seatId: "p1", playerId: "p1", kind: "human" as const, joinState: "local" as const },
  { seatId: "p2", playerId: "p2", kind: "human" as const, joinState: "local" as const }
];

test("neutral local materializer preserves authoritative two-seat turn order", () => {
  const state = {
    public: { turn: { order: ["p2", "p1"], activePlayerId: "p2" } },
    players: { p1: {}, p2: {} }
  };
  assert.deepEqual(materializeLocalSessionParticipants(state, 2), [
    { seatId: "p2", playerId: "p2", kind: "human", joinState: "local" },
    { seatId: "p1", playerId: "p1", kind: "human", joinState: "local" }
  ]);
});

test("neutral non-turn session gets metadata without inventing player-scoped state", () => {
  const state = { public: { screen: "ready" }, secret: {} };
  const result = materializeLocalSessionParticipants(state, 1);
  assert.deepEqual(result, [
    { seatId: "p1", playerId: "p1", kind: "human", joinState: "local" }
  ]);
  assert.equal("players" in state, false);
});

test("semantic participant validation rejects agent creation, duplicates and actor mismatch in S8", () => {
  const state = { players: { p1: {}, p2: {} }, public: { turn: { order: ["p1", "p2"] } } };
  assert.throws(() => assertSessionParticipantsMatchState([
    { ...participants[0], kind: "agent" }, participants[1]
  ], state, { allowAgents: false }), /invalid or duplicate/u);
  assert.throws(() => assertSessionParticipantsMatchState([
    participants[0], { ...participants[1], seatId: "p1" }
  ], state, { allowAgents: false }), /invalid or duplicate/u);
  assert.throws(() => assertSessionParticipantsMatchState([
    participants[0], { ...participants[1], playerId: "p3" }
  ], state, { allowAgents: false }), /state\.players/u);
});

test("canonical schema rejects malformed participant shapes before semantic validation", () => {
  const state = { players: { p1: {} }, public: { turn: { order: ["p1"] } } };
  for (const malformed of [
    null,
    [],
    [{ ...participants[0], extra: true }],
    [{ ...participants[0], playerId: "__proto__" }],
    [{ ...participants[0], kind: "robot" }]
  ]) {
    assert.throws(
      () => assertSessionParticipantsMatchState(malformed, state, { allowAgents: false }),
      /canonical schema/u
    );
  }
});

test("semantic validation rejects partial or contradictory player-turn shapes", () => {
  for (const state of [
    { players: { p1: {} }, public: {} },
    { public: { turn: { order: ["p1"] } } },
    { players: null, public: { turn: { order: ["p1"] } } },
    { public: { turn: null } },
    { public: { turn: { activePlayerId: "p1" } } },
    { players: { p1: {} }, public: { turn: { order: ["p1"], activePlayerId: "p2" } } }
  ]) {
    assert.throws(
      () => assertSessionParticipantsMatchState([participants[0]], state, { allowAgents: false }),
      /state\.players|public\.turn|activePlayerId/u
    );
  }
});

test("S8 store creation rejects an agent participant", async () => {
  const store = new InMemorySessionStore<Record<string, unknown>>();
  const bundle = createImmutableBundleContent("neutral-agent-seat-fixture", {});
  await assert.rejects(store.createSession({
    gameId: "neutral-agent-seat-fixture",
    initialState: { public: {} },
    participants: [{ ...participants[0], kind: "agent" }],
    immutableBundle: bundle,
    principal: {
      principalId: "principal-local",
      kind: "local-controller",
      role: "player",
      actorScope: { kind: "all-session-actors" },
      credentialSha256: "a".repeat(64)
    }
  }), /invalid or duplicate/u);
});

test("in-memory store rejects participant mutation across a snapshot update", async () => {
  const store = new InMemorySessionStore<Record<string, unknown>>();
  const bundle = createImmutableBundleContent("neutral-participant-fixture", {});
  const created = await store.createSession({
    gameId: "neutral-participant-fixture",
    initialState: { public: {} },
    participants: [participants[0]],
    immutableBundle: bundle,
    principal: {
      principalId: "principal-local",
      kind: "local-controller",
      role: "player",
      actorScope: { kind: "all-session-actors" },
      credentialSha256: "a".repeat(64)
    }
  });
  await assert.rejects(store.updateSession({
    ...created.session,
    participants: [{ ...participants[0], seatId: "changed-seat" }],
    version: { ...created.session.version, stateVersion: 1 },
    updatedAt: new Date()
  }, { expectedStateVersion: 0 }), /cannot change/u);
  assert.deepEqual((await store.getSession(created.session.sessionId))?.participants, [participants[0]]);
});

test("untrusted create request cannot inject participant metadata", () => {
  assert.throws(() => parseCreateSessionRequest({
    gameId: "neutral-game",
    participants: [participants[0]]
  }), /unsupported field "participants"/u);
  assert.throws(() => parseRestorePreviewSessionRequest({
    state: {},
    version: { stateVersion: 0, lastEventSequence: 0 },
    participants: [participants[0]]
  }), /unsupported field "participants"/u);
});

test("create request accepts only a positive integer participantCount", () => {
  assert.deepEqual(parseCreateSessionRequest({ gameId: "neutral-game", participantCount: 2 }), {
    gameId: "neutral-game",
    participantCount: 2
  });
  for (const participantCount of [0, -1, 1.5, "2", null]) {
    assert.throws(
      () => parseCreateSessionRequest({ gameId: "neutral-game", participantCount }),
      /participantCount must be a positive integer/u
    );
  }
});

test("migration 004 deletes sessions before the required column and preserves bundles", async () => {
  const up = await readFile(new URL("../migrations/004_session_participants.up.sql", import.meta.url), "utf8");
  const down = await readFile(new URL("../migrations/004_session_participants.down.sql", import.meta.url), "utf8");
  const ledger = await readFile(new URL("../migrations/002_authenticated_command_ledger.up.sql", import.meta.url), "utf8");
  const schedules = await readFile(new URL("../migrations/003_system_schedules.up.sql", import.meta.url), "utf8");

  assert.ok(up.indexOf("DELETE FROM game_sessions") < up.indexOf("ADD COLUMN participants JSONB NOT NULL"));
  assert.ok(up.indexOf("DELETE FROM game_sessions") < up.indexOf("DROP COLUMN player_id"));
  assert.match(up, /DROP COLUMN player_id/u);
  assert.doesNotMatch(up, /DELETE FROM game_bundles/u);
  assert.match(up, /jsonb_typeof\(participants\) = 'array'/u);
  assert.doesNotMatch(up, /seatId|playerId|joinState/u);
  assert.match(ledger, /REFERENCES game_sessions\(id\) ON DELETE CASCADE/u);
  assert.match(schedules, /REFERENCES game_sessions\(id, bundle_hash\) ON DELETE CASCADE/u);
  assert.match(down, /disposable pre-release development\/test databases/u);
  assert.match(down, /ADD COLUMN player_id TEXT/u);
  assert.doesNotMatch(down, /DELETE FROM game_bundles/u);
});
