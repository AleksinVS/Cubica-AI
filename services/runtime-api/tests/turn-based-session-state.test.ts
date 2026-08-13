/** Neutral tests for manifest-declared turn state and server-owned randomness. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import type { CubicaMechanicsIRV1Alpha1, GameManifest, Step } from "@cubica/contracts-manifest";

import { initializeTurnBasedSessionState } from "../src/modules/session/turnBasedSessionState.ts";
import { materializeLocalSessionParticipants } from "../src/modules/session/sessionParticipants.ts";

const require = createRequire(import.meta.url);
const { recommendedModuleLock } = require("../../../scripts/manifest-tools/mechanics-modules.cjs") as {
  recommendedModuleLock: (moduleIds: Array<string>) => CubicaMechanicsIRV1Alpha1["moduleLock"];
};
const HASH = `sha256:${"0".repeat(64)}`;

const createManifest = (): GameManifest => ({
  meta: {
    id: "neutral-turn-fixture",
    version: "1.0.0",
    name: "Neutral turn fixture",
    description: "Contract fixture without concrete game rules.",
    schemaVersion: "2.0.0"
  },
  config: {
    players: { min: 2, max: 2 },
    settings: { mode: "hotseat", locale: "en" },
    turnModel: { phases: ["roll", "resolve"] }
  },
  state: {
    public: { log: [] },
    secret: {},
    playersTemplate: {
      metrics: { score: 10, position: 0 },
      flags: { ready: false },
      status: "active",
      visibility: { metrics: "public", flags: "private" }
    }
  },
  actions: {
    "turn.roll": {
      invocation: "external",
      definitionHash: HASH,
      binding: { kind: "mechanics-plan", planRef: "turn.roll" }
    }
  },
  mechanics: {
    apiVersion: "cubica.dev/mechanics/v1alpha1",
    budgetProfile: "turn-based-standard-v1",
    moduleLock: recommendedModuleLock(["cubica.random"]),
    stateModel: {
      types: {
        "core.string": { kind: "string" },
        "fixture.roll": {
          kind: "record",
          fields: {
            dice: { typeRef: "core.string", optional: false },
            rolls: { typeRef: "core.string", optional: false },
            total: { typeRef: "core.string", optional: false }
          }
        }
      },
      endpoints: {
        lastRoll: {
          audienceRef: "public",
          storage: { root: "public", segments: ["turn", "lastRoll"] },
          valueType: "fixture.roll",
          access: "read-write"
        }
      },
      collections: {},
      events: {}
    },
    plans: {
      "turn.roll": {
        planHash: HASH,
        transaction: {
          steps: [{
            id: "roll",
            kind: "command",
            op: "random.dice.roll",
            dice: "2d6",
            stream: "turn",
            target: { endpoint: "lastRoll" }
          }]
        }
      }
    }
  }
});

const declaredState = (manifest: GameManifest): Record<string, unknown> =>
  structuredClone(manifest.state) as unknown as Record<string, unknown>;

test("participant template expands into isolated p1..pN state and an initial turn", () => {
  const manifest = createManifest();
  const state = initializeTurnBasedSessionState(
    manifest,
    declaredState(manifest),
    {}
  );

  assert.equal("playersTemplate" in state, false);
  assert.deepEqual(state.players, {
    p1: { metrics: { score: 10, position: 0 }, flags: { ready: false }, objects: {}, status: "active" },
    p2: { metrics: { score: 10, position: 0 }, flags: { ready: false }, objects: {}, status: "active" }
  });
  assert.deepEqual((state.public as Record<string, unknown>).turn, {
    order: ["p1", "p2"],
    activePlayerId: "p1",
    phase: "roll",
    turnNumber: 1
  });
  assert.equal("random" in (state.secret as Record<string, unknown>), false);

  const players = state.players as Record<string, Record<string, any>>;
  players.p1.metrics.score = 1;
  assert.equal(players.p2.metrics.score, 10, "participant objects must not share nested references");
});

test("neutral single-participant non-turn manifest gets metadata without player-scoped state", () => {
  const manifest = createManifest();
  manifest.config.players = { min: 1, max: 1 };
  delete manifest.config.turnModel;
  delete manifest.state.playersTemplate;
  const state = initializeTurnBasedSessionState(manifest, declaredState(manifest));

  assert.equal("players" in state, false);
  assert.deepEqual(materializeLocalSessionParticipants(state, manifest.config.players.min), [
    { seatId: "p1", playerId: "p1", kind: "human", joinState: "local" }
  ]);
});

test("authored random state is removed unconditionally", () => {
  const manifest = createManifest();
  // An authored random object must never become a second source of truth.
  manifest.state.secret = {
    random: {
      alg: "author-authored-placeholder",
      seed: "must-not-survive-session-initialization"
    }
  };

  const state = initializeTurnBasedSessionState(
    manifest,
    declaredState(manifest),
    {}
  );
  assert.equal("random" in (state.secret as Record<string, unknown>), false);
});

test("participant count outside manifest bounds is rejected", () => {
  const manifest = createManifest();
  assert.throws(
    () => initializeTurnBasedSessionState(manifest, declaredState(manifest), {
      participantCount: 3
    }),
    /outside manifest bounds/u
  );
});

test("random deck manifests do not initialize persistent generator state", () => {
  for (const step of [
    {
      id: "shuffle",
      kind: "command",
      op: "deck.shuffle" as const,
      deckId: "events",
      sourceCollection: "eventCards",
      stream: "events"
    },
    {
      id: "draw",
      kind: "command",
      op: "deck.draw" as const,
      deckId: "events",
      target: { endpoint: "drawnCardId" },
      onEmpty: "reshuffle-discard" as const
    }
  ] satisfies Array<Step>) {
    const manifest = createManifest();
    manifest.mechanics.moduleLock = recommendedModuleLock(["cubica.deck"]);
    manifest.mechanics.stateModel.types["fixture.cardId"] = { kind: "string" };
    manifest.mechanics.stateModel.endpoints.drawnCardId = {
      audienceRef: "public",
      storage: { root: "public", segments: ["drawnCardId"] },
      valueType: "fixture.cardId",
      access: "read-write"
    };
    manifest.mechanics.stateModel.collections.eventCards = {
      audienceRef: "public",
      storage: { root: "public", segments: ["objects", "eventCards"] },
      capacity: 32,
      stableKey: "map-key",
      itemTypes: ["fixture.card"],
      fields: {}
    };
    manifest.state.secret = {
      random: {
        alg: "xoshiro128ss-v1",
        seed: "00000000000000000000000000000000",
        counter: 99
      }
    };
    manifest.actions = {
      "deck.action": {
        invocation: "external",
        definitionHash: HASH,
        binding: { kind: "mechanics-plan", planRef: "deck.action" }
      }
    };
    manifest.mechanics.plans = {
      "deck.action": {
        planHash: HASH,
        transaction: { steps: [step] }
      }
    };

    const state = initializeTurnBasedSessionState(
      manifest,
      declaredState(manifest),
      {}
    );

    assert.equal("random" in (state.secret as Record<string, unknown>), false);
  }
});

test("non-random deck lifecycle operations do not initialize random state", () => {
  for (const step of [
    {
      id: "extract",
      kind: "command",
      op: "deck.extract" as const,
      deckId: "events",
      source: "order" as const
    },
    {
      id: "return",
      kind: "command",
      op: "deck.return" as const,
      deckId: "events",
      card: { op: "value.literal" as const, value: "event-a" },
      destination: "discard" as const
    },
    {
      id: "insert",
      kind: "command",
      op: "deck.insert" as const,
      deckId: "events",
      sourceCollection: "eventCards",
      card: { op: "value.literal" as const, value: "event-a" },
      destination: "held" as const
    }
  ] satisfies Array<Step>) {
    const manifest = createManifest();
    manifest.mechanics.moduleLock = recommendedModuleLock(["cubica.deck"]);
    manifest.actions = {};
    manifest.mechanics.plans = {
      lifecycle: {
        planHash: HASH,
        transaction: { steps: [step] }
      }
    };

    const state = initializeTurnBasedSessionState(
      manifest,
      declaredState(manifest),
      {}
    );
    assert.equal(
      "random" in (state.secret as Record<string, unknown>),
      false,
      `${step.op} must not initialize persisted random state`
    );
  }
});

test("road planning does not initialize persistent generator state", () => {
  const manifest = createManifest();
  // The initializer only needs to detect the schema-validated capability here;
  // geometric contract validation is covered by the platform fixture. Version
  // 2 of the region road planner (ADR-100) is deterministic and declares
  // `tieBreak: "shortest-then-codepoint"` instead of the version 1
  // `"server-random"` value — this fixture no longer exercises randomness at
  // all, but it still proves that declaring road planning does not, by
  // itself, cause the initializer to materialize persisted generator state.
  (manifest as any).networkModels = {
    grid: { roadPlanning: { tieBreak: "shortest-then-codepoint" } }
  };
  manifest.actions = {};
  manifest.mechanics.plans = {
    noop: {
      planHash: HASH,
      transaction: {
        steps: [{
          id: "noop",
          kind: "assert",
          op: "core.assert",
          predicate: { op: "predicate.constant", value: true },
          errorCode: "FIXTURE_PRECONDITION_FAILED"
        }]
      }
    }
  };
  manifest.mechanics.moduleLock = recommendedModuleLock(["cubica.core"]);
  manifest.state.secret = {};

  const state = initializeTurnBasedSessionState(
    manifest,
    declaredState(manifest),
    {}
  );

  assert.equal("random" in (state.secret as Record<string, unknown>), false);
});

test("neither conditional random ordering nor canonical ordering initializes random state", () => {
  for (const tieBreak of [
    { kind: "server-random", stream: "fixture.order" },
    { kind: "canonical-id" }
  ] as const) {
    const manifest = createManifest();
    manifest.actions = {};
    manifest.mechanics.moduleLock = recommendedModuleLock(["cubica.ordering"]);
    manifest.mechanics.stateModel.types["core.integer"] = {
      kind: "integer",
      minimum: 0,
      maximum: 10
    };
    manifest.mechanics.stateModel.collections.entities = {
      audienceRef: "public",
      storage: { root: "public", segments: ["entities"] },
      capacity: 4,
      stableKey: "map-key",
      itemTypes: ["fixture.entity"],
      fields: {
        rank: {
          storage: { kind: "attribute", name: "rank" },
          valueType: "core.integer",
          access: "read-only"
        }
      }
    };
    manifest.mechanics.plans = {
      ordering: {
        planHash: HASH,
        transaction: {
          steps: [
            {
              id: "selected",
              kind: "query",
              op: "core.entities.select",
              selector: {
                collection: "entities",
                cardinality: { min: 0, max: 4 }
              }
            },
            {
              id: "ordered",
              kind: "command",
              op: "core.entities.order",
              selection: { op: "value.result", stepId: "selected" },
              keys: [{
                source: { kind: "current-field", field: "rank" },
                direction: "ascending",
                missing: "error"
              }],
              tieBreak: tieBreak.kind === "server-random"
                ? { kind: tieBreak.kind, stream: tieBreak.stream }
                : { kind: tieBreak.kind },
              // A false condition represents a runtime branch. Initialization
              // still must not persist generator state for a possible future use.
              when: { op: "predicate.constant", value: false }
            }
          ] as unknown as [Step, ...Array<Step>]
        }
      }
    };
    manifest.state.secret = {};

    const state = initializeTurnBasedSessionState(
      manifest,
      declaredState(manifest),
      {}
    );

    assert.equal(
      "random" in (state.secret as Record<string, unknown>),
      false
    );
  }
});
