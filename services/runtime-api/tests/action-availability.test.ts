/**
 * Neutral contract proof for server-projected action availability.
 *
 * The fixture intentionally contains no Cards Money Trains concepts: it proves
 * that the platform mechanism follows ordinary manifest roles, state guards,
 * and parameter schemas without a branch for a concrete game.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { CubicaMechanicsIRV1Alpha1, GameManifest, Plan } from "@cubica/contracts-manifest";
import type { SessionRecord } from "@cubica/contracts-session";

import type { GameBundle } from "../src/modules/content/manifestLoader.ts";
import { projectSessionActionAvailability } from "../src/modules/runtime/actionAvailability.ts";

type RuntimeState = Record<string, unknown>;

const require = createRequire(import.meta.url);
const { recommendedModuleLock } = require("../../../scripts/manifest-tools/mechanics-modules.cjs") as {
  recommendedModuleLock: (moduleIds: Array<string>) => CubicaMechanicsIRV1Alpha1["moduleLock"];
};

const HASH = `sha256:${"0".repeat(64)}`;
const constantPlan = (value: boolean, errorCode = "ACTION_PRECONDITION_FAILED"): Plan => ({
  planHash: HASH,
  transaction: {
    steps: [{
      id: "precondition",
      kind: "assert",
      op: "core.assert",
      predicate: { op: "predicate.constant", value },
      errorCode
    }]
  }
});
const statePlan = (expected: string): Plan => ({
  planHash: HASH,
  transaction: {
    steps: [{
      id: "precondition",
      kind: "assert",
      op: "core.assert",
      predicate: {
        op: "predicate.compare",
        operator: "eq",
        left: { op: "value.state", ref: { endpoint: "phase" } },
        right: { op: "value.literal", value: expected }
      },
      errorCode: "ACTION_PRECONDITION_FAILED"
    }]
  }
});
const stateAndParameterPlan = (expected: string): Plan => ({
  planHash: HASH,
  transaction: {
    steps: [{
      id: "precondition",
      kind: "assert",
      op: "core.assert",
      predicate: {
        op: "predicate.all",
        items: [
          {
            op: "predicate.compare",
            operator: "eq",
            left: { op: "value.state", ref: { endpoint: "phase" } },
            right: { op: "value.literal", value: expected }
          },
          {
            op: "predicate.exists",
            value: { op: "value.param", name: "targetId" },
            exists: true
          }
        ]
      },
      errorCode: "ACTION_PRECONDITION_FAILED"
    }]
  }
});
const serverOnlyPlan = (): Plan => ({
  planHash: HASH,
  transaction: {
    steps: [{
      id: "authorization",
      kind: "assert",
      op: "core.assert",
      predicate: {
        op: "predicate.compare",
        operator: "eq",
        left: { op: "value.state", ref: { endpoint: "internalStatus" } },
        right: { op: "value.literal", value: "open" }
      },
      errorCode: "ACTION_AUTHORIZATION_FAILED"
    }]
  }
});
const commandAndRandomBodyPlan = (): Plan => ({
  planHash: HASH,
  transaction: {
    steps: [
      {
        id: "precondition",
        kind: "assert",
        op: "core.assert",
        predicate: { op: "predicate.constant", value: true },
        errorCode: "ACTION_PRECONDITION_FAILED"
      },
      {
        id: "mutate",
        kind: "command",
        op: "core.state.patch",
        patches: [{
          operation: "set",
          target: { endpoint: "phase" },
          value: { op: "value.literal", value: "mutated" }
        }]
      },
      {
        id: "roll",
        kind: "command",
        op: "random.dice.roll",
        dice: "1d6",
        stream: "turn",
        target: { endpoint: "rollTarget" }
      }
    ]
  }
});
const action = (planRef: string, extra: Record<string, unknown> = {}) => ({
  definitionHash: HASH,
  binding: { kind: "mechanics-plan", planRef },
  capabilityFamily: "fixture.runtime",
  capability: "fixture.change",
  ...extra
});

const bundle: GameBundle = {
  gameId: "neutral-availability",
  bundleHash: HASH,
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
      proceed: action("proceed"),
      wait: action("wait"),
      chooseTarget: action("chooseTarget", {
        paramsSchema: {
          type: "object",
          additionalProperties: false,
          properties: { targetId: { type: "string" } },
          required: ["targetId"]
        }
      }),
      chooseBlockedTarget: action("chooseBlockedTarget", {
        paramsSchema: {
          type: "object",
          additionalProperties: false,
          properties: { targetId: { type: "string" } },
          required: ["targetId"]
        }
      }),
      facilitatorOnly: action("facilitatorOnly", { allowedSessionRoles: ["facilitator"] }),
      capabilityMetadata: action("capabilityMetadata", { displayName: "Neutral capability" }),
      serverOnlyAuthorization: action("serverOnlyAuthorization"),
      commandAndRandomBody: action("commandAndRandomBody"),
      malformedPlan: action("malformedPlan"),
      unsupported: action("missingPlan")
    },
    mechanics: {
      apiVersion: "cubica.dev/mechanics/v1alpha1",
      budgetProfile: "turn-based-standard-v1",
      moduleLock: recommendedModuleLock(["cubica.core", "cubica.random"]),
      stateModel: {
        types: { "core.string": { kind: "string" } },
        endpoints: {
          phase: {
            audienceRef: "public",
            storage: { root: "public", segments: ["phase"] },
            valueType: "core.string",
            access: "read-write"
          },
          rollTarget: {
            audienceRef: "public",
            storage: { root: "public", segments: ["rollTarget"] },
            valueType: "core.string",
            access: "read-write"
          },
          internalStatus: {
            audienceRef: "server",
            storage: { root: "secret", segments: ["internalStatus"] },
            valueType: "core.string",
            access: "read-only"
          }
        },
        collections: {},
        events: {}
      },
      plans: {
        proceed: statePlan("ready"),
        wait: statePlan("finished"),
        chooseTarget: stateAndParameterPlan("ready"),
        chooseBlockedTarget: stateAndParameterPlan("finished"),
        facilitatorOnly: constantPlan(true),
        capabilityMetadata: constantPlan(true),
        serverOnlyAuthorization: serverOnlyPlan(),
        commandAndRandomBody: commandAndRandomBodyPlan(),
        // This deliberately bypasses publication validation to prove that a
        // corrupted immutable bundle fails closed without leaking internals.
        malformedPlan: {
          planHash: HASH,
          transaction: {
            steps: [{
              id: "malformed",
              kind: "assert",
              op: "core.assert",
              predicate: { op: "predicate.unknown" },
              errorCode: "ACTION_PRECONDITION_FAILED"
            }]
          }
        } as unknown as Plan
      }
    }
  } as unknown as GameManifest
};

const snapshot: SessionRecord<RuntimeState> = {
  sessionId: "session-neutral",
  gameId: bundle.gameId,
  bundleHash: bundle.bundleHash,
  sessionRole: "player",
  version: { sessionId: "session-neutral", stateVersion: 0, lastEventSequence: 0 },
  state: {
    public: {
      phase: "ready",
      rollTarget: "not-rolled",
      objects: {
        items: {
          target: { objectType: "fixture.item", facets: {}, attributes: {} }
        }
      }
    },
    secret: { internalStatus: "closed" }
  },
  createdAt: new Date("2026-07-12T00:00:00.000Z"),
  updatedAt: new Date("2026-07-12T00:00:00.000Z")
};

test("projects state, role, parameter-dependent, and unsupported decisions without guard details", () => {
  const viewer = { sessionRole: "player" as const };
  const projection = projectSessionActionAvailability(snapshot, bundle, viewer);
  const byId = new Map(projection.map((entry) => [entry.actionId, entry]));

  assert.deepEqual(byId.get("proceed"), {
    actionId: "proceed",
    status: "available",
    basisStateVersion: 0
  });
  assert.deepEqual(byId.get("wait"), {
    actionId: "wait",
    status: "unavailable",
    reasonCode: "state_condition_failed",
    basisStateVersion: 0
  });
  assert.deepEqual(byId.get("chooseTarget"), {
    actionId: "chooseTarget",
    status: "parameter-dependent",
    reasonCode: "parameters_required",
    basisStateVersion: 0
  });
  assert.deepEqual(byId.get("chooseBlockedTarget"), {
    actionId: "chooseBlockedTarget",
    status: "unavailable",
    reasonCode: "state_condition_failed",
    basisStateVersion: 0
  });
  assert.deepEqual(byId.get("facilitatorOnly"), {
    actionId: "facilitatorOnly",
    status: "unavailable",
    reasonCode: "role_not_allowed",
    basisStateVersion: 0
  });
  assert.deepEqual(byId.get("capabilityMetadata"), {
    actionId: "capabilityMetadata",
    status: "available",
    basisStateVersion: 0
  });
  assert.deepEqual(byId.get("serverOnlyAuthorization"), {
    actionId: "serverOnlyAuthorization",
    status: "available",
    basisStateVersion: 0
  });
  assert.deepEqual(byId.get("commandAndRandomBody"), {
    actionId: "commandAndRandomBody",
    status: "available",
    basisStateVersion: 0
  });
  assert.deepEqual(byId.get("malformedPlan"), {
    actionId: "malformedPlan",
    status: "unavailable",
    reasonCode: "runtime_unsupported",
    basisStateVersion: 0
  });
  assert.deepEqual(byId.get("unsupported"), {
    actionId: "unsupported",
    status: "unavailable",
    reasonCode: "runtime_unsupported",
    basisStateVersion: 0
  });

  // Projection ran only the leading assertion. The later write and dice roll
  // neither changed the source snapshot nor required runtime random state.
  assert.equal((snapshot.state.public as Record<string, unknown>).phase, "ready");
  assert.equal((snapshot.state.public as Record<string, unknown>).rollTarget, "not-rolled");

  const changedServerState: SessionRecord<RuntimeState> = {
    ...snapshot,
    state: { ...snapshot.state, secret: { internalStatus: "open" } }
  };
  const changedServerProjection = projectSessionActionAvailability(changedServerState, bundle, viewer);
  assert.deepEqual(
    changedServerProjection.find((entry) => entry.actionId === "serverOnlyAuthorization"),
    byId.get("serverOnlyAuthorization")
  );

  // The public projection exposes only stable codes, never the failed JSON
  // path or actual state value used by the internal guard diagnostic.
  assert.equal(JSON.stringify(projection).includes("/public/phase"), false);
  assert.equal(JSON.stringify(projection).includes("finished"), false);
});
