/** Security regression tests for the single actor-scoped session projector. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { StateModel } from "@cubica/contracts-manifest";
import type { SessionPrincipal, SessionRecord } from "@cubica/contracts-session";

import {
  buildPlayerSessionProjection,
  projectPlayerSessionState
} from "../src/modules/session/playerSessionProjection.ts";
import { resolveSessionActor } from "../src/modules/session/sessionAuthentication.ts";

const stateModel = {
  types: {
    "test.integer": { kind: "integer", minimum: 0, maximum: 1000 },
    "test.string": { kind: "string" },
    "test.record": { kind: "record", fields: {} }
  },
  endpoints: {
    "public.score": {
      audienceRef: "public",
      storage: { root: "public", segments: ["score"] },
      valueType: "test.integer",
      access: "read-write"
    },
    "public.profile": {
      audienceRef: "public",
      storage: { root: "public", segments: ["profile"] },
      valueType: "test.record",
      access: "read-only",
      usage: "projection-only"
    },
    "server.profile-token": {
      audienceRef: "server",
      storage: { root: "public", segments: ["profile", "internalToken"] },
      valueType: "test.string",
      access: "read-only"
    },
    "public.player-rank": {
      audienceRef: "public",
      storage: { root: "players", segments: [{ context: "actor" }, "rank"] },
      valueType: "test.integer",
      access: "read-write"
    },
    "actor.hand": {
      audienceRef: "actor",
      storage: { root: "players", segments: [{ context: "actor" }, "hand"] },
      valueType: "test.record",
      access: "read-write"
    },
    "server.random": {
      audienceRef: "server",
      storage: { root: "secret", segments: ["random"] },
      valueType: "test.record",
      access: "read-write"
    }
  },
  collections: {},
  events: {}
} as const satisfies StateModel;

const storedState = {
  public: {
    score: 7,
    profile: {
      displayName: "Neutral session",
      internalToken: "must-not-leave-runtime"
    },
    undeclaredNeighbor: "not-public-without-a-state-model-symbol"
  },
  players: {
    p1: {
      rank: 1,
      hand: { cardIds: ["alpha"] },
      undeclaredNeighbor: "p1-private-undeclared"
    },
    p2: {
      rank: 2,
      hand: { cardIds: ["beta"] },
      undeclaredNeighbor: "p2-private-undeclared"
    }
  },
  secret: {
    random: { seed: "0123456789abcdeffedcba9876543210", counter: 2 }
  }
};

test("stateModel projection returns public symbols and only the authenticated actor symbols", () => {
  const projection = buildPlayerSessionProjection({
    state: storedState,
    stateModel,
    actorPlayerId: "p1"
  });
  const projected = projection.state;

  assert.deepEqual(projected, {
    public: {
      score: 7,
      profile: { displayName: "Neutral session" }
    },
    players: {
      p1: { rank: 1, hand: { cardIds: ["alpha"] } },
      p2: { rank: 2 }
    }
  });
  assert.equal("secret" in projected, false);
  assert.deepEqual(projection.publicAudienceState.players, {
    p1: { rank: 1 },
    p2: { rank: 2 }
  });
  assert.deepEqual(projection.actorAudienceState.players, {
    p1: { hand: { cardIds: ["alpha"] } }
  });
  assert.equal(storedState.public.profile.internalToken, "must-not-leave-runtime");
  assert.deepEqual(storedState.players.p2.hand.cardIds, ["beta"]);
});

test("two authenticated principals receive isolated actor views of the same state", () => {
  const session: SessionRecord<typeof storedState> = {
    sessionId: "session-neutral",
    gameId: "neutral-game",
    bundleHash: "a".repeat(64),
    state: storedState,
    sessionRole: "player",
    version: { sessionId: "session-neutral", stateVersion: 3, lastEventSequence: 0 },
    createdAt: new Date("2026-07-16T00:00:00.000Z"),
    updatedAt: new Date("2026-07-16T00:00:00.000Z")
  };
  const principalFor = (principalId: string, actorId: string): SessionPrincipal => ({
    principalId,
    sessionId: session.sessionId,
    kind: "participant",
    role: "player",
    actorScope: { kind: "listed-actors", actorIds: [actorId] },
    createdAt: new Date("2026-07-16T00:00:00.000Z")
  });

  const p1View = projectPlayerSessionState({
    state: session.state,
    stateModel,
    actorPlayerId: resolveSessionActor(session, principalFor("principal-p1", "p1"))
  });
  const p2View = projectPlayerSessionState({
    state: session.state,
    stateModel,
    actorPlayerId: resolveSessionActor(session, principalFor("principal-p2", "p2"))
  });

  assert.deepEqual(p1View.players, {
    p1: { rank: 1, hand: { cardIds: ["alpha"] } },
    p2: { rank: 2 }
  });
  assert.deepEqual(p2View.players, {
    p1: { rank: 1 },
    p2: { rank: 2, hand: { cardIds: ["beta"] } }
  });
  assert.equal(JSON.stringify(p1View).includes("beta"), false);
  assert.equal(JSON.stringify(p2View).includes("alpha"), false);
});

test("an actor-labelled static path fails closed because it cannot identify its owner", () => {
  const unsafeModel: StateModel = {
    ...stateModel,
    endpoints: {
      "actor.ambiguous": {
        audienceRef: "actor",
        storage: { root: "public", segments: ["profile"] },
        valueType: "test.record",
        access: "read-only"
      }
    }
  };
  const projected = projectPlayerSessionState({
    state: storedState,
    stateModel: unsafeModel,
    actorPlayerId: "p1"
  });
  assert.deepEqual(projected, {});
});
