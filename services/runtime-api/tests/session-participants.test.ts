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
  assertCreationPrincipalsMatchParticipants,
  assertSessionParticipantsMatchState,
  materializeLocalSessionParticipants,
  materializePrivateSessionParticipants
} from "../src/modules/session/sessionParticipants.ts";
import {
  createLocalSessionAccess,
  createParticipantSessionAccess,
  resolveSessionActor,
  resolveSessionViewerActor
} from "../src/modules/session/sessionAuthentication.ts";

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

test("neutral local materializer assigns the last requested seat to an agent without changing actor coverage", () => {
  const state = {
    public: { turn: { order: ["p1", "p2"], activePlayerId: "p1" } },
    players: { p1: { score: 0 }, p2: { score: 0 } }
  };
  assert.deepEqual(materializeLocalSessionParticipants(state, 2, 1), [
    { seatId: "p1", playerId: "p1", kind: "human", joinState: "local" },
    { seatId: "p2", playerId: "p2", kind: "agent", joinState: "local" }
  ]);
  assert.deepEqual(Object.keys(state.players), state.public.turn.order);
});

test("neutral private materializer creates immutable human invite bindings without a presence lifecycle", () => {
  const state = {
    public: { turn: { order: ["p2", "p1"], activePlayerId: "p2" } },
    players: { p1: {}, p2: {} }
  };
  assert.deepEqual(materializePrivateSessionParticipants(state, 2), [
    { seatId: "p2", playerId: "p2", kind: "human", joinState: "private-invite" },
    { seatId: "p1", playerId: "p1", kind: "human", joinState: "private-invite" }
  ]);
});

test("private creation principals map one-to-one to actors and store only credential digests", async () => {
  const state = {
    public: { turn: { order: ["p1", "p2"], activePlayerId: "p1" } },
    players: { p1: { privateNote: "one" }, p2: { privateNote: "two" } }
  };
  const privateParticipants = materializePrivateSessionParticipants(state, 2);
  const first = createParticipantSessionAccess("p1", "facilitator");
  const second = createParticipantSessionAccess("p2");
  assertCreationPrincipalsMatchParticipants([first.principal, second.principal], privateParticipants);

  const store = new InMemorySessionStore<Record<string, unknown>>();
  const bundle = createImmutableBundleContent("neutral-private-session-fixture", {});
  const created = await store.createSession({
    gameId: "neutral-private-session-fixture",
    initialState: state,
    participants: privateParticipants,
    immutableBundle: bundle,
    principal: first.principal,
    additionalPrincipals: [second.principal]
  });
  const authenticatedFirst = await store.authenticateSession({
    sessionId: created.session.sessionId,
    credentialSha256: first.principal.credentialSha256
  });
  const authenticatedSecond = await store.authenticateSession({
    sessionId: created.session.sessionId,
    credentialSha256: second.principal.credentialSha256
  });
  assert.deepEqual(authenticatedFirst?.actorScope, { kind: "listed-actors", actorIds: ["p1"] });
  assert.deepEqual(authenticatedSecond?.actorScope, { kind: "listed-actors", actorIds: ["p2"] });
  assert.equal(authenticatedFirst?.role, "facilitator");
  assert.equal(authenticatedSecond?.role, "player");
  assert.equal(resolveSessionActor(created.session, authenticatedFirst!), "p1");
  assert.throws(() => resolveSessionActor(created.session, authenticatedSecond!));
  assert.equal(resolveSessionViewerActor(created.session, authenticatedSecond!), "p2");
  assert.equal(await store.authenticateSession({
    sessionId: created.session.sessionId,
    credentialSha256: "f".repeat(64)
  }), null);
  assert.doesNotMatch(JSON.stringify(store), /ses_/u);
});

test("invalid additional principals fail before an in-memory session becomes visible", async () => {
  const privateParticipants = [
    { seatId: "p1", playerId: "p1", kind: "human" as const, joinState: "private-invite" as const },
    { seatId: "p2", playerId: "p2", kind: "human" as const, joinState: "private-invite" as const }
  ];
  const first = createParticipantSessionAccess("p1");
  const wrongPrincipalKind = createLocalSessionAccess("player");
  const duplicate = { ...createParticipantSessionAccess("p2").principal, credentialSha256: first.principal.credentialSha256 };
  const duplicateId = { ...createParticipantSessionAccess("p2").principal, principalId: first.principal.principalId };
  const duplicateActor = createParticipantSessionAccess("p1").principal;
  const store = new InMemorySessionStore<Record<string, unknown>>();
  const bundle = createImmutableBundleContent("neutral-private-atomicity-fixture", {});
  await assert.rejects(store.createSession({
    gameId: "neutral-private-atomicity-fixture",
    initialState: { public: {} },
    participants: privateParticipants,
    immutableBundle: bundle,
    principal: wrongPrincipalKind.principal
  }), /map one-to-one onto participants/u);
  await assert.rejects(store.createSession({
    gameId: "neutral-private-atomicity-fixture",
    initialState: { public: {} },
    participants: privateParticipants,
    immutableBundle: bundle,
    principal: first.principal,
    additionalPrincipals: [duplicate]
  }), /unique ids and credential digests/u);
  await assert.rejects(store.createSession({
    gameId: "neutral-private-atomicity-fixture",
    initialState: { public: {} },
    participants: privateParticipants,
    immutableBundle: bundle,
    principal: first.principal,
    additionalPrincipals: [duplicateId]
  }), /unique ids and credential digests/u);
  await assert.rejects(store.createSession({
    gameId: "neutral-private-atomicity-fixture",
    initialState: { public: {} },
    participants: privateParticipants,
    immutableBundle: bundle,
    principal: first.principal,
    additionalPrincipals: [duplicateActor]
  }), /map one-to-one onto participants/u);

  const second = createParticipantSessionAccess("p2");
  const created = await store.createSession({
    gameId: "neutral-private-atomicity-fixture",
    initialState: { public: {} },
    participants: privateParticipants,
    immutableBundle: bundle,
    principal: first.principal,
    additionalPrincipals: [second.principal]
  });
  assert.ok(await store.getSession(created.session.sessionId));
});

test("in-memory creation rejects every participant-principal model except local controller or private seats", async () => {
  const store = new InMemorySessionStore<Record<string, unknown>>();
  const bundle = createImmutableBundleContent("neutral-principal-model-fixture", {});
  const localParticipant = participants[0];
  const localAccess = createLocalSessionAccess("player");
  const secondLocalAccess = createLocalSessionAccess("player");
  const participantAccess = createParticipantSessionAccess("p1");

  for (const input of [
    {
      participants: [localParticipant],
      principal: { ...localAccess.principal, kind: "facilitator" as const }
    },
    {
      participants: [localParticipant],
      principal: localAccess.principal,
      additionalPrincipals: [secondLocalAccess.principal]
    },
    {
      participants: [localParticipant],
      principal: participantAccess.principal
    },
    {
      participants: [{ ...localParticipant, joinState: "private-invite" as const }],
      principal: localAccess.principal
    },
    {
      participants: [{ ...localParticipant, kind: "agent" as const, joinState: "private-invite" as const }],
      principal: participantAccess.principal
    }
  ]) {
    await assert.rejects(store.createSession({
      gameId: "neutral-principal-model-fixture",
      initialState: { public: {} },
      immutableBundle: bundle,
      ...input
    }), /Local sessions require|map one-to-one onto participants|canonical schema/u);
  }
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

test("in-memory store accepts a server-authorized agent participant", async () => {
  const store = new InMemorySessionStore<Record<string, unknown>>();
  const bundle = createImmutableBundleContent("neutral-agent-seat-fixture", {});
  const created = await store.createSession({
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
  });
  assert.deepEqual(created.session.participants, [{ ...participants[0], kind: "agent" }]);
});

test("in-memory store still rejects malformed server participant metadata", async () => {
  const store = new InMemorySessionStore<Record<string, unknown>>();
  const bundle = createImmutableBundleContent("neutral-malformed-seat-fixture", {});
  await assert.rejects(store.createSession({
    gameId: "neutral-malformed-seat-fixture",
    initialState: { public: {} },
    participants: [{ ...participants[0], kind: "agent", extra: true }] as any,
    immutableBundle: bundle,
    principal: {
      principalId: "principal-local",
      kind: "local-controller",
      role: "player",
      actorScope: { kind: "all-session-actors" },
      credentialSha256: "a".repeat(64)
    }
  }), /canonical schema/u);
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

test("untrusted create request accepts only schema-valid local agent seat counts", () => {
  assert.deepEqual(parseCreateSessionRequest({ gameId: "neutral-game" }), { gameId: "neutral-game" });
  assert.deepEqual(parseCreateSessionRequest({ gameId: "neutral-game", agentSeatCount: 0 }), {
    gameId: "neutral-game",
    agentSeatCount: 0
  });
  assert.deepEqual(parseCreateSessionRequest({ gameId: "neutral-game", agentSeatCount: 1 }), {
    gameId: "neutral-game",
    agentSeatCount: 1
  });
  for (const agentSeatCount of [-1, 1.5, 65, "1"]) {
    assert.throws(() => parseCreateSessionRequest({ gameId: "neutral-game", agentSeatCount }));
  }
});

test("private-invite creation is optional and cannot mix with a positive agent-seat count", () => {
  assert.deepEqual(parseCreateSessionRequest({ gameId: "neutral-game", accessMode: "private-invite" }), {
    gameId: "neutral-game",
    accessMode: "private-invite"
  });
  assert.throws(() => parseCreateSessionRequest({
    gameId: "neutral-game",
    accessMode: "private-invite",
    agentSeatCount: 1
  }));
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
  assert.doesNotMatch(up, /CHECK|jsonb_typeof|jsonb_array_length/u);
  assert.doesNotMatch(up, /seatId|playerId|joinState/u);
  assert.match(ledger, /REFERENCES game_sessions\(id\) ON DELETE CASCADE/u);
  assert.match(schedules, /REFERENCES game_sessions\(id, bundle_hash\) ON DELETE CASCADE/u);
  assert.match(down, /disposable pre-release development\/test databases/u);
  assert.match(down, /ADD COLUMN player_id TEXT/u);
  assert.doesNotMatch(down, /DELETE FROM game_bundles/u);
});
