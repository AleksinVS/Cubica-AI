/**
 * Neutral equivalence and safety proof for batched read-only Mechanics guards.
 *
 * The fixture contains no game concepts. It compares ordinary assertions with
 * the transactional executor and then exercises the extra trust boundaries
 * that allow a single validated snapshot to be reused safely.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import type {
  CubicaMechanicsIRV1Alpha1,
  Plan,
  Predicate
} from "@cubica/contracts-manifest";
import {
  evaluateReadOnlyMechanicsPredicates,
  executeMechanicsTransaction,
  MechanicsExecutionError,
  type MechanicsReadOnlyPredicateOutcome
} from "../src/modules/mechanics/index.ts";

const require = createRequire(import.meta.url);
const { recommendedModuleLock } = require("../../../scripts/manifest-tools/mechanics-modules.cjs") as {
  recommendedModuleLock: (moduleIds: Array<string>) => CubicaMechanicsIRV1Alpha1["moduleLock"];
};

const HASH = `sha256:${"4".repeat(64)}`;
const state = {
  public: {
    phase: "ready",
    turn: { activePlayerId: "player-1" }
  },
  secret: {
    internalStatus: "closed"
  }
};

const mechanics: CubicaMechanicsIRV1Alpha1 = {
  apiVersion: "cubica.dev/mechanics/v1alpha1",
  budgetProfile: "turn-based-standard-v1",
  moduleLock: recommendedModuleLock(["cubica.core"]),
  stateModel: {
    types: {
      "core.string": { kind: "string" }
    },
    endpoints: {
      phase: {
        audienceRef: "public",
        storage: { root: "public", segments: ["phase"] },
        valueType: "core.string",
        access: "read-only"
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
  plans: {}
};

const predicates: Array<Predicate> = [
  {
    op: "predicate.compare",
    operator: "eq",
    left: { op: "value.state", ref: { endpoint: "phase" } },
    right: { op: "value.literal", value: "ready" }
  },
  {
    op: "predicate.compare",
    operator: "eq",
    left: { op: "value.state", ref: { endpoint: "phase" } },
    right: { op: "value.literal", value: "finished" }
  },
  { op: "predicate.actor.active" },
  { op: "predicate.not", item: { op: "predicate.constant", value: false } }
];

test("batched read-only predicates match isolated transaction assertions and preserve state", () => {
  const before = structuredClone(state);
  const expected = predicates.map(evaluateWithTransaction);
  const actual = evaluateReadOnlyMechanicsPredicates({
    mechanics,
    predicates,
    state,
    actorContext: { actorPlayerId: "player-1", sessionRole: "player" }
  });

  assert.deepEqual(actual, expected);
  assert.deepEqual(state, before);
  assert.equal(Object.isFrozen(state), false);
  assert.equal(Object.isFrozen(state.public), false);
});

test("one malformed predicate is isolated without hiding valid siblings", () => {
  const actual = evaluateReadOnlyMechanicsPredicates({
    mechanics,
    predicates: [
      { op: "predicate.constant", value: true },
      { op: "predicate.unknown" } as unknown as Predicate,
      { op: "predicate.constant", value: false }
    ],
    state,
    actorContext: { sessionRole: "observer" }
  });

  assert.deepEqual(actual, [
    { status: "passed" },
    { status: "error", errorCode: "MECHANICS_PREDICATE_UNSUPPORTED" },
    { status: "rejected" }
  ]);
});

test("ordinary false predicates remain bounded rejections and preserve the snapshot", () => {
  const before = structuredClone(state);
  const falsePredicate: Predicate = {
    op: "predicate.compare",
    operator: "eq",
    left: { op: "value.state", ref: { endpoint: "phase" } },
    right: { op: "value.literal", value: "finished" }
  };

  const actual = evaluateReadOnlyMechanicsPredicates({
    mechanics,
    // A phase-driven interface commonly has many unavailable actions. This is
    // the normal result shape, not a malformed-input path, so every item must
    // remain an isolated `rejected` outcome without weakening shared gates.
    predicates: Array.from({ length: 256 }, () => falsePredicate),
    state,
    actorContext: { sessionRole: "observer" }
  });

  assert.equal(actual.length, 256);
  assert.ok(actual.every((outcome) => outcome.status === "rejected"));
  assert.deepEqual(state, before);
});

test("complete snapshot validation rejects an invalid unreferenced endpoint before evaluation", () => {
  const invalidState = structuredClone(state);
  (invalidState.secret as Record<string, unknown>).internalStatus = 7;

  assert.throws(
    () => evaluateReadOnlyMechanicsPredicates({
      mechanics,
      predicates: [{ op: "predicate.constant", value: true }],
      state: invalidState,
      actorContext: {}
    }),
    (error: unknown) =>
      error instanceof MechanicsExecutionError &&
      error.code === "MECHANICS_VALUE_TYPE_MISMATCH"
  );
});

test("verified reads remain local to one call and observe later state changes", () => {
  const mutableState = structuredClone(state);
  const phaseIsReady = predicates[0]!;

  assert.deepEqual(
    evaluateReadOnlyMechanicsPredicates({
      mechanics,
      predicates: [phaseIsReady, phaseIsReady],
      state: mutableState,
      actorContext: {}
    }),
    [{ status: "passed" }, { status: "passed" }]
  );

  // Reusing the same object identity is intentional: a cache keyed only by the
  // state object, session id or version would incorrectly preserve "passed".
  (mutableState.public as Record<string, unknown>).phase = "finished";
  assert.deepEqual(
    evaluateReadOnlyMechanicsPredicates({
      mechanics,
      predicates: [phaseIsReady],
      state: mutableState,
      actorContext: {}
    }),
    [{ status: "rejected" }]
  );
});

test("binding-derived endpoint locations are validated on every concrete read", () => {
  const bindingMechanics: CubicaMechanicsIRV1Alpha1 = {
    ...mechanics,
    stateModel: {
      ...mechanics.stateModel,
      types: {
        ...mechanics.stateModel.types,
        "core.integer": { kind: "integer", minimum: 0, maximum: 100 }
      },
      endpoints: {
        ...mechanics.stateModel.endpoints,
        teamScore: {
          audienceRef: "public",
          storage: {
            root: "public",
            segments: ["teamScores", { binding: "teamId" }, "score"]
          },
          valueType: "core.integer",
          access: "read-only"
        }
      }
    }
  };
  const bindingState = {
    ...structuredClone(state),
    public: {
      ...structuredClone(state.public),
      teamScores: {
        alpha: { score: "not-an-integer" }
      }
    }
  };
  const boundPredicate = {
    op: "predicate.compare",
    operator: "eq",
    left: {
      op: "value.state",
      ref: {
        endpoint: "teamScore",
        bindings: {
          teamId: { op: "value.literal", value: "alpha" }
        }
      }
    },
    right: { op: "value.literal", value: 3 }
  } satisfies Predicate;

  // Snapshot-wide validation cannot enumerate a parameter-bound path. Its
  // concrete value must therefore fail closed inside this predicate rather
  // than inheriting the proof for ordinary static endpoints.
  assert.deepEqual(
    evaluateReadOnlyMechanicsPredicates({
      mechanics: bindingMechanics,
      predicates: [boundPredicate],
      state: bindingState,
      actorContext: {}
    }),
    [{ status: "error", errorCode: "MECHANICS_VALUE_TYPE_MISMATCH" }]
  );
});

test("one batch reuses stable collection validation but the next batch validates again", () => {
  const collectionMechanics: CubicaMechanicsIRV1Alpha1 = {
    ...mechanics,
    stateModel: {
      ...mechanics.stateModel,
      types: {
        ...mechanics.stateModel.types,
        "core.integer": { kind: "integer", minimum: 0, maximum: 100 }
      },
      collections: {
        pieces: {
          audienceRef: "public",
          storage: { root: "public", segments: ["pieces"] },
          capacity: 8,
          stableKey: "map-key",
          itemTypes: ["fixture.piece"],
          fields: {
            score: {
              storage: { kind: "attribute", name: "score" },
              valueType: "core.integer",
              access: "read-only"
            }
          }
        }
      }
    }
  };
  let scoreReads = 0;
  const attributes: Record<string, unknown> = {};
  Object.defineProperty(attributes, "score", {
    configurable: true,
    enumerable: true,
    get: () => {
      scoreReads += 1;
      return 3;
    }
  });
  const collectionState = {
    ...structuredClone(state),
    public: {
      ...structuredClone(state.public),
      pieces: {
        alpha: {
          objectType: "fixture.piece",
          attributes
        }
      }
    }
  };
  const containsAlpha = {
    op: "predicate.collection.count",
    collection: "pieces",
    ids: [{ op: "value.literal", value: "alpha" }],
    field: ["objectType"],
    equals: { op: "value.literal", value: "fixture.piece" },
    countAtLeast: { op: "value.literal", value: 1 }
  } satisfies Predicate;

  const outcomes = evaluateReadOnlyMechanicsPredicates({
    mechanics: collectionMechanics,
    predicates: Array.from({ length: 20 }, () => containsAlpha),
    state: collectionState,
    actorContext: {}
  });
  assert.ok(outcomes.every((outcome) => outcome.status === "passed"));

  // The getter is a deterministic test probe for field validation work. It is
  // read by the mandatory JSON gate, the mandatory full-model gate and the
  // first concrete collection read, but not once again for all 20 predicates.
  assert.ok(scoreReads > 0 && scoreReads <= 6, `unexpected validation reads: ${scoreReads}`);

  const readsAfterFirstBatch = scoreReads;
  evaluateReadOnlyMechanicsPredicates({
    mechanics: collectionMechanics,
    predicates: [containsAlpha],
    state: collectionState,
    actorContext: {}
  });
  assert.ok(scoreReads > readsAfterFirstBatch, "a later call must not reuse the earlier proof");
});

test("runtime module locks and budget profiles remain mandatory", () => {
  const noCoreMechanics = {
    ...mechanics,
    moduleLock: recommendedModuleLock(["cubica.random"])
  };
  assert.deepEqual(
    evaluateReadOnlyMechanicsPredicates({
      mechanics: noCoreMechanics,
      predicates: [{ op: "predicate.constant", value: true }],
      state,
      actorContext: {}
    }),
    [{ status: "error", errorCode: "MECHANICS_MODULE_NOT_LOCKED" }]
  );

  const invalidLockMechanics = structuredClone(mechanics);
  invalidLockMechanics.moduleLock["cubica.core"]!.artifactHash = `sha256:${"0".repeat(64)}`;
  assert.throws(
    () => evaluateReadOnlyMechanicsPredicates({
      mechanics: invalidLockMechanics,
      predicates: [{ op: "predicate.constant", value: true }],
      state,
      actorContext: {}
    }),
    (error: unknown) =>
      error instanceof MechanicsExecutionError &&
      error.code === "MECHANICS_MODULE_LOCK_MISMATCH"
  );

  assert.throws(
    () => evaluateReadOnlyMechanicsPredicates({
      // Deliberately bypass the generated union to model a corrupted direct
      // runtime caller and prove the defensive unknown-profile gate.
      mechanics: {
        ...mechanics,
        budgetProfile: "missing-profile"
      } as unknown as CubicaMechanicsIRV1Alpha1,
      predicates: [{ op: "predicate.constant", value: true }],
      state,
      actorContext: {}
    }),
    (error: unknown) =>
      error instanceof MechanicsExecutionError &&
      error.code === "MECHANICS_BUDGET_PROFILE_UNKNOWN"
  );
});

test("each predicate keeps an independent expression budget and fails closed when it exceeds it", () => {
  const oversizedItems: [Predicate, ...Array<Predicate>] = [
    { op: "predicate.constant", value: true },
    ...Array.from(
      { length: 32_767 },
      () => ({ op: "predicate.constant", value: true } as const)
    )
  ];
  const oversizedPredicate: Predicate = {
    op: "predicate.all",
    items: oversizedItems
  };

  const actual = evaluateReadOnlyMechanicsPredicates({
    mechanics,
    predicates: [
      oversizedPredicate,
      { op: "predicate.constant", value: true }
    ],
    state,
    actorContext: {}
  });

  assert.deepEqual(actual, [
    { status: "error", errorCode: "MECHANICS_RUNTIME_BUDGET_EXCEEDED" },
    { status: "passed" }
  ]);
});

function evaluateWithTransaction(predicate: Predicate): MechanicsReadOnlyPredicateOutcome {
  const plan: Plan = {
    planHash: HASH,
    transaction: {
      steps: [{
        id: "baseline-assertion",
        kind: "assert",
        op: "core.assert",
        predicate,
        errorCode: "BASELINE_FALSE"
      }]
    }
  };
  try {
    executeMechanicsTransaction({
      mechanics,
      plan,
      state,
      actorContext: { actorPlayerId: "player-1", sessionRole: "player" }
    });
    return { status: "passed" };
  } catch (error) {
    if (error instanceof MechanicsExecutionError && error.code === "BASELINE_FALSE") {
      return { status: "rejected" };
    }
    return {
      status: "error",
      errorCode: error instanceof MechanicsExecutionError
        ? error.code
        : "MECHANICS_READ_ONLY_EVALUATION_FAILED"
    };
  }
}
