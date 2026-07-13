/**
 * Neutral contract proof for server-projected action availability.
 *
 * The fixture intentionally contains no Cards Money Trains concepts: it proves
 * that the platform mechanism follows ordinary manifest roles, state guards,
 * and parameter schemas without a branch for a concrete game.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { GameManifest } from "@cubica/contracts-manifest";
import type { SessionRecord } from "@cubica/contracts-session";

import type { GameBundle } from "../src/modules/content/manifestLoader.ts";
import { projectSessionActionAvailability } from "../src/modules/runtime/actionAvailability.ts";

type RuntimeState = Record<string, unknown>;

const action = (guard: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  handlerType: "manifest-data",
  capabilityFamily: "runtime.server",
  capability: "fixture.change",
  deterministic: { guard, effects: [] },
  ...extra
});

const bundle: GameBundle = {
  gameId: "neutral-availability",
  manifest: {
    meta: {
      id: "neutral-availability",
      version: "1.0.0",
      name: "Neutral availability",
      description: "Neutral fixture",
      schemaVersion: "1.1"
    },
    config: {
      players: { min: 1, max: 2 },
      settings: { mode: "local", locale: "en-US" },
      sessionMode: "facilitated"
    },
    state: {},
    actions: {
      proceed: action({
        stateConditions: [{ path: "/public/phase", operator: "==", value: "ready" }]
      }),
      wait: action({
        stateConditions: [{ path: "/public/phase", operator: "==", value: "finished" }]
      }),
      chooseTarget: action({
        object: { collection: "items", objectId: "{{targetId}}" }
      }, {
        paramsSchema: {
          type: "object",
          additionalProperties: false,
          properties: { targetId: { type: "string" } },
          required: ["targetId"]
        }
      }),
      facilitatorOnly: action({}, { allowedSessionRoles: ["facilitator"] }),
      legacyCapability: { handlerType: "script", capabilityFamily: "runtime.server" },
      malformedGuard: action({ jsonLogic: { unsupported_fixture_operator: [] } }),
      unsupported: { handlerType: "ai" }
    }
  } as unknown as GameManifest
};

const snapshot: SessionRecord<RuntimeState> = {
  sessionId: "session-neutral",
  gameId: bundle.gameId,
  playerId: "participant-a",
  sessionRole: "player",
  version: { sessionId: "session-neutral", stateVersion: 0, lastEventSequence: 0 },
  state: {
    public: {
      phase: "ready",
      objects: {
        items: {
          target: { objectType: "fixture.item", facets: {}, attributes: {} }
        }
      }
    }
  },
  createdAt: new Date("2026-07-12T00:00:00.000Z"),
  updatedAt: new Date("2026-07-12T00:00:00.000Z")
};

test("projects state, role, parameter-dependent, and unsupported decisions without guard details", () => {
  const projection = projectSessionActionAvailability(snapshot, bundle);
  const byId = new Map(projection.map((entry) => [entry.actionId, entry]));

  assert.deepEqual(byId.get("proceed"), { actionId: "proceed", status: "available" });
  assert.deepEqual(byId.get("wait"), {
    actionId: "wait",
    status: "unavailable",
    reasonCode: "state_condition_failed"
  });
  assert.deepEqual(byId.get("chooseTarget"), {
    actionId: "chooseTarget",
    status: "parameter-dependent",
    reasonCode: "parameters_required"
  });
  assert.deepEqual(byId.get("facilitatorOnly"), {
    actionId: "facilitatorOnly",
    status: "unavailable",
    reasonCode: "role_not_allowed"
  });
  assert.deepEqual(byId.get("legacyCapability"), {
    actionId: "legacyCapability",
    status: "available"
  });
  assert.deepEqual(byId.get("malformedGuard"), {
    actionId: "malformedGuard",
    status: "unavailable",
    reasonCode: "runtime_unsupported"
  });
  assert.deepEqual(byId.get("unsupported"), {
    actionId: "unsupported",
    status: "unavailable",
    reasonCode: "runtime_unsupported"
  });

  // The public projection exposes only stable codes, never the failed JSON
  // path or actual state value used by the internal guard diagnostic.
  assert.equal(JSON.stringify(projection).includes("/public/phase"), false);
  assert.equal(JSON.stringify(projection).includes("finished"), false);
});
