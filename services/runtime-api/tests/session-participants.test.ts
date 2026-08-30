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
  applyPrivateInviteClaim,
  assertCreationPrincipalsMatchParticipants,
  assertSessionParticipantsMatchState,
  materializeLocalSessionParticipants,
  materializePrivateSessionParticipants
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

test("neutral non-turn session gets metadata without inventing player-scoped state", () => {
  const state = { public: { screen: "ready" }, secret: {} };
  const result = materializeLocalSessionParticipants(state, 1);
  assert.deepEqual(result, [
    { seatId: "p1", playerId: "p1", kind: "human", joinState: "local" }
  ]);
  assert.equal("players" in state, false);
});

test("private materializer assigns one joined host and invited human guests", () => {
  const state = {
    public: { turn: { order: ["p2", "p1", "p3"], activePlayerId: "p2" } },
    players: { p1: {}, p2: {}, p3: {} }
  };
  assert.deepEqual(materializePrivateSessionParticipants(state, 3), [
    { seatId: "p2", playerId: "p2", kind: "human", joinState: "joined" },
    { seatId: "p1", playerId: "p1", kind: "human", joinState: "invited" },
    { seatId: "p3", playerId: "p3", kind: "human", joinState: "invited" }
  ]);
});

test("private principal topology binds one expiring capability to each invited seat", () => {
  const privateParticipants = [
    { seatId: "p1", playerId: "p1", kind: "human" as const, joinState: "joined" as const },
    { seatId: "p2", playerId: "p2", kind: "human" as const, joinState: "invited" as const }
  ];
  const expiresAt = new Date("2026-08-26T12:00:00.000Z");
  const principals = [
    {
      principalId: "11111111-1111-4111-8111-111111111111",
      kind: "participant" as const,
      role: "player" as const,
      actorScope: { kind: "listed-actors" as const, actorIds: ["p1"] },
      credentialSha256: "a".repeat(64)
    },
    {
      principalId: "22222222-2222-4222-8222-222222222222",
      kind: "participant" as const,
      role: "player" as const,
      actorScope: { kind: "listed-actors" as const, actorIds: ["p2"] },
      credentialSha256: "b".repeat(64),
      credentialExpiresAt: expiresAt
    }
  ];
  assert.doesNotThrow(() => assertCreationPrincipalsMatchParticipants(principals, privateParticipants));
  assert.throws(
    () => assertCreationPrincipalsMatchParticipants(
      [{ ...principals[0], credentialExpiresAt: expiresAt }, principals[1]],
      privateParticipants
    ),
    /match joined and invited/u
  );
  assert.throws(
    () => assertCreationPrincipalsMatchParticipants(
      [principals[0], { ...principals[1], actorScope: { kind: "listed-actors", actorIds: ["p1"] } }],
      privateParticipants
    ),
    /one principal per seat|match joined and invited/u
  );
  assert.throws(
    () => assertCreationPrincipalsMatchParticipants(
      [principals[0], { ...principals[1], role: "facilitator" }],
      privateParticipants
    ),
    /match joined and invited/u
  );
  assert.throws(
    () => assertCreationPrincipalsMatchParticipants(
      [principals[0], { ...principals[1], credentialExpiresAt: null as unknown as Date }],
      privateParticipants
    ),
    /credential material/u
  );
});

test("private invite claim changes only the server-owned seat lifecycle and version", () => {
  const claimedAt = new Date("2026-08-25T12:00:00.000Z");
  const current = {
    sessionId: "11111111-1111-4111-8111-111111111111",
    gameId: "neutral-private-fixture",
    bundleHash: "a".repeat(64),
    participants: [
      { seatId: "p1", playerId: "p1", kind: "human" as const, joinState: "joined" as const },
      { seatId: "p2", playerId: "p2", kind: "human" as const, joinState: "invited" as const }
    ],
    state: {
      public: { turn: { order: ["p1", "p2"], activePlayerId: "p1" } },
      players: { p1: {}, p2: {} },
      secret: { sentinel: "unchanged" }
    },
    version: {
      sessionId: "11111111-1111-4111-8111-111111111111",
      stateVersion: 7,
      lastEventSequence: 3
    },
    createdAt: new Date("2026-08-25T11:00:00.000Z"),
    updatedAt: new Date("2026-08-25T11:00:00.000Z")
  };
  const updated = applyPrivateInviteClaim(current, "p2", claimedAt);
  assert.deepEqual(updated.participants.map(({ joinState }) => joinState), ["joined", "joined"]);
  assert.equal(updated.version.stateVersion, 8);
  assert.equal(updated.version.lastEventSequence, 3);
  assert.deepEqual(updated.state, current.state);
  assert.equal(updated.updatedAt, claimedAt);
  assert.throws(() => applyPrivateInviteClaim(updated, "p2", claimedAt), /available human seat/u);
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

test("migration 006 stores only invite expiry metadata and keeps tokens hashed", async () => {
  const up = await readFile(new URL("../migrations/006_private_invite_claim.up.sql", import.meta.url), "utf8");
  const down = await readFile(new URL("../migrations/006_private_invite_claim.down.sql", import.meta.url), "utf8");
  assert.match(up, /ADD COLUMN credential_expires_at TIMESTAMPTZ/u);
  assert.match(up, /WHERE credential_expires_at IS NOT NULL/u);
  assert.doesNotMatch(up, /invite_token|raw_credential|\binv_/u);
  assert.match(down, /DROP COLUMN IF EXISTS credential_expires_at/u);
});

test("migration 007 stores one hash-only recovery capability on a durable guest principal", async () => {
  const up = await readFile(new URL("../migrations/007_private_seat_recovery.up.sql", import.meta.url), "utf8");
  const down = await readFile(new URL("../migrations/007_private_seat_recovery.down.sql", import.meta.url), "utf8");
  assert.match(up, /ADD COLUMN recovery_token_sha256 TEXT/u);
  assert.match(up, /ADD COLUMN recovery_token_expires_at TIMESTAMPTZ/u);
  assert.match(up, /credential_expires_at IS NULL/u);
  assert.match(up, /session_role = 'player'/u);
  assert.doesNotMatch(up, /raw_credential|recovery_token\s+TEXT|\bses_|\binv_/u);
  assert.match(down, /DROP COLUMN IF EXISTS recovery_token_sha256/u);
  assert.match(down, /DROP COLUMN IF EXISTS recovery_token_expires_at/u);
});
