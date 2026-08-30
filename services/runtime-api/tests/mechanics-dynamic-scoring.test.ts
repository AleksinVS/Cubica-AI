/**
 * Neutral runtime proof for static and selection-backed score/ranking.
 *
 * Generic objects and measurements demonstrate the platform contract without
 * importing participant roles, currencies, victory rules or any concrete
 * game's identifiers into the shared Mechanics executor.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { CubicaMechanicsIRV1Alpha1 } from "@cubica/contracts-manifest";

import {
  executeMechanicsTransaction,
  MechanicsExecutionError
} from "../src/modules/mechanics/index.ts";

const require = createRequire(import.meta.url);
const { recommendedModuleLockForOperations } = require(
  "../../../scripts/manifest-tools/mechanics-modules.cjs"
) as {
  recommendedModuleLockForOperations: (
    operations: Array<string>
  ) => CubicaMechanicsIRV1Alpha1["moduleLock"];
};
const { mechanicsSha256 } = require(
  "../../../scripts/manifest-tools/mechanics-canonicalize.cjs"
) as {
  mechanicsSha256: (value: unknown) => string;
};

const HASH = `sha256:${"0".repeat(64)}`;

const literal = (value: unknown): Record<string, unknown> => ({
  op: "value.literal",
  value
});

const result = (stepId: string): Record<string, unknown> => ({
  op: "value.result",
  stepId
});

const attributeField = (
  name: string,
  valueType: string
): Record<string, unknown> => ({
  storage: { kind: "attribute", name },
  valueType,
  access: "read-only"
});

const facetField = (
  name: string,
  valueType: string
): Record<string, unknown> => ({
  storage: { kind: "facet", name },
  valueType,
  access: "read-only"
});

const selectedObjects = {
  id: "selectedObjects",
  kind: "query",
  op: "core.entities.select",
  selector: {
    collection: "objects",
    facets: { active: literal(true) },
    cardinality: { min: 0, max: 4 }
  }
};

const dynamicScore = {
  id: "dynamicScore",
  kind: "query",
  op: "core.entities.score",
  selection: result("selectedObjects"),
  baseField: "base",
  relatedSources: [{
    collection: "measurements",
    ownerField: "owner",
    valueField: "amount"
  }]
};

function createMechanics(): CubicaMechanicsIRV1Alpha1 {
  const mechanics = {
    apiVersion: "cubica.dev/mechanics/v1alpha1",
    budgetProfile: "turn-based-standard-v1",
    moduleLock: {},
    stateModel: {
      types: {
        "core.boolean": { kind: "boolean" },
        "core.integer": { kind: "integer", minimum: -10_000, maximum: 10_000 },
        "core.string": { kind: "string" },
        "fixture.json": {
          kind: "json",
          maxDepth: 4,
          maxNodes: 64,
          maxUtf8Bytes: 4_096
        }
      },
      endpoints: {
        legacyObjects: {
          audienceRef: "public",
          storage: { root: "public", segments: ["legacyObjects"] },
          valueType: "fixture.json",
          access: "read-only"
        }
      },
      collections: {
        objects: {
          audienceRef: "public",
          storage: { root: "public", segments: ["objects"] },
          capacity: 4,
          stableKey: "map-key",
          itemTypes: ["fixture.object"],
          fields: {
            active: facetField("active", "core.boolean"),
            base: attributeField("base", "core.integer"),
            group: attributeField("group", "core.string")
          }
        },
        otherObjects: {
          audienceRef: "public",
          storage: { root: "public", segments: ["otherObjects"] },
          capacity: 2,
          stableKey: "map-key",
          itemTypes: ["fixture.other-object"],
          fields: {
            active: facetField("active", "core.boolean"),
            base: attributeField("base", "core.integer"),
            group: attributeField("group", "core.string")
          }
        },
        measurements: {
          audienceRef: "public",
          storage: { root: "public", segments: ["measurements"] },
          capacity: 8,
          stableKey: "map-key",
          itemTypes: ["fixture.measurement"],
          fields: {
            owner: attributeField("owner", "core.string"),
            amount: attributeField("amount", "core.integer")
          }
        }
      },
      events: {}
    },
    plans: {
      staticCompatibility: {
        planHash: HASH,
        transaction: {
          steps: [{
            id: "staticScore",
            kind: "query",
            op: "core.entities.score",
            entities: { endpoint: "legacyObjects" },
            entityIds: [literal("legacy-a"), literal("legacy-b")],
            baseField: "base",
            relatedSources: []
          }, {
            id: "staticRanking",
            kind: "algorithm",
            op: "core.ranking.stable",
            scores: result("staticScore"),
            groups: [{
              id: "all",
              entityIds: [literal("legacy-b"), literal("legacy-a")]
            }]
          }]
        }
      },
      dynamicRanking: {
        planHash: HASH,
        transaction: {
          steps: [
            selectedObjects,
            dynamicScore,
            {
              id: "redObjects",
              kind: "query",
              op: "core.entities.select",
              selector: {
                collection: "objects",
                facets: { active: literal(true) },
                attributes: { group: literal("red") },
                cardinality: { min: 0, max: 4 }
              }
            },
            {
              id: "blueObjects",
              kind: "query",
              op: "core.entities.select",
              selector: {
                collection: "objects",
                facets: { active: literal(true) },
                attributes: { group: literal("blue") },
                cardinality: { min: 0, max: 4 }
              }
            },
            {
              id: "dynamicRanking",
              kind: "algorithm",
              op: "core.ranking.stable",
              scores: result("dynamicScore"),
              groups: [
                { id: "red", selection: result("redObjects") },
                { id: "blue", selection: result("blueObjects") }
              ]
            }
          ]
        }
      },
      wrongCollection: {
        planHash: HASH,
        transaction: {
          steps: [
            selectedObjects,
            dynamicScore,
            {
              id: "otherSelection",
              kind: "query",
              op: "core.entities.select",
              selector: {
                collection: "otherObjects",
                cardinality: { min: 0, max: 2 }
              }
            },
            {
              id: "wrongCollectionRanking",
              kind: "algorithm",
              op: "core.ranking.stable",
              scores: result("dynamicScore"),
              groups: [{ id: "other", selection: result("otherSelection") }]
            }
          ]
        }
      },
      unscoredMember: {
        planHash: HASH,
        transaction: {
          steps: [
            selectedObjects,
            dynamicScore,
            {
              id: "allObjects",
              kind: "query",
              op: "core.entities.select",
              selector: {
                collection: "objects",
                cardinality: { min: 0, max: 4 }
              }
            },
            {
              id: "unscoredRanking",
              kind: "algorithm",
              op: "core.ranking.stable",
              scores: result("dynamicScore"),
              groups: [{ id: "all", selection: result("allObjects") }]
            }
          ]
        }
      },
      unknownStaticMember: {
        planHash: HASH,
        transaction: {
          steps: [{
            id: "staticScore",
            kind: "query",
            op: "core.entities.score",
            entities: { endpoint: "legacyObjects" },
            entityIds: [literal("legacy-a")],
            baseField: "base",
            relatedSources: []
          }, {
            id: "unknownRanking",
            kind: "algorithm",
            op: "core.ranking.stable",
            scores: result("staticScore"),
            groups: [{ id: "all", entityIds: [literal("unknown-object")] }]
          }]
        }
      }
    }
  } as unknown as CubicaMechanicsIRV1Alpha1;

  const operations = Object.values(mechanics.plans)
    .flatMap((plan) => plan.transaction.steps.map((step) => step.op));
  mechanics.moduleLock = recommendedModuleLockForOperations(operations);
  // networkModels is bound by digest, not by embedded value -- must mirror
  // checkMechanicsBundle in scripts/manifest-tools/mechanics-checker.cjs.
  const networkModelsHash = mechanicsSha256({});
  for (const [planId, plan] of Object.entries(mechanics.plans)) {
    plan.planHash = mechanicsSha256({
      apiVersion: mechanics.apiVersion,
      budgetProfile: mechanics.budgetProfile,
      moduleLock: mechanics.moduleLock,
      stateModel: mechanics.stateModel,
      objectModels: {},
      networkModelsHash,
      planId,
      transaction: plan.transaction
    });
  }
  return mechanics;
}

const object = (
  active: boolean,
  base: number,
  group: string,
  objectType = "fixture.object"
): Record<string, unknown> => ({
  objectType,
  facets: { active },
  attributes: { base, group }
});

const measurement = (owner: string, amount: number): Record<string, unknown> => ({
  objectType: "fixture.measurement",
  facets: {},
  attributes: { owner, amount }
});

function createState(): Record<string, unknown> {
  return {
    public: {
      legacyObjects: {
        "legacy-a": { base: 5 },
        "legacy-b": { base: 3 }
      },
      objects: {
        delta: object(false, 100, "red"),
        gamma: object(true, 10, "blue"),
        beta: object(true, 8, "red"),
        alpha: object(true, 10, "red")
      },
      otherObjects: {
        outsider: object(true, 1, "other", "fixture.other-object")
      },
      measurements: {
        "measurement-delta": measurement("delta", 999),
        "measurement-beta": measurement("beta", 4),
        "measurement-alpha": measurement("alpha", 2)
      }
    }
  };
}

function executePlan(planId: keyof ReturnType<typeof createMechanics>["plans"]) {
  const mechanics = createMechanics();
  return executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans[String(planId)],
    state: createState(),
    actorContext: { sessionRole: "facilitator" }
  });
}

test("legacy static score and ranking retain their existing result shape", () => {
  const output = executePlan("staticCompatibility");
  const scoreAudit = output.audit.find((entry) => entry.stepId === "staticScore");

  assert.deepEqual(scoreAudit?.result, {
    kind: "scores",
    entries: [{
      entityId: "legacy-a",
      baseValue: 5,
      relatedValue: 0,
      score: 5,
      relatedItems: []
    }, {
      entityId: "legacy-b",
      baseValue: 3,
      relatedValue: 0,
      score: 3,
      relatedItems: []
    }]
  });
  assert.deepEqual(
    (output.result as { groups: Record<string, { winners: Array<string> }> }).groups.all.winners,
    ["legacy-a"]
  );
});

test("dynamic score uses three selected objects and ranks two same-collection subselections", () => {
  const output = executePlan("dynamicRanking");
  const scoreAudit = output.audit.find((entry) => entry.stepId === "dynamicScore");
  const ranking = output.result as {
    groups: Record<string, {
      standings: Array<{ entityId: string; score: number; rank: number }>;
      winners: Array<string>;
      tiedForFirst: boolean;
    }>;
  };

  assert.deepEqual(scoreAudit?.result, {
    kind: "scores",
    entries: [{
      entityId: "alpha",
      baseValue: 10,
      relatedValue: 2,
      score: 12,
      relatedItems: [{ entityId: "measurement-alpha", value: 2 }]
    }, {
      entityId: "beta",
      baseValue: 8,
      relatedValue: 4,
      score: 12,
      relatedItems: [{ entityId: "measurement-beta", value: 4 }]
    }, {
      entityId: "gamma",
      baseValue: 10,
      relatedValue: 0,
      score: 10,
      relatedItems: []
    }]
  }, "the unselected owner and its related value must not enter aggregation");
  assert.deepEqual(ranking.groups.red.winners, ["alpha", "beta"]);
  assert.equal(ranking.groups.red.tiedForFirst, true);
  assert.deepEqual(
    ranking.groups.red.standings.map(({ entityId, rank }) => ({ entityId, rank })),
    [{ entityId: "alpha", rank: 1 }, { entityId: "beta", rank: 1 }]
  );
  assert.deepEqual(ranking.groups.blue.winners, ["gamma"]);
});

test("dynamic ranking rejects a selection from another collection", () => {
  assert.throws(
    () => executePlan("wrongCollection"),
    (error) => error instanceof MechanicsExecutionError &&
      error.code === "MECHANICS_RANKING_SELECTION_COLLECTION_MISMATCH"
  );
});

test("dynamic ranking rejects a same-collection member absent from the score table", () => {
  assert.throws(
    () => executePlan("unscoredMember"),
    (error) => error instanceof MechanicsExecutionError &&
      error.code === "MECHANICS_RANKING_ENTITY_UNKNOWN"
  );
});

test("static ranking still rejects an unknown score member", () => {
  assert.throws(
    () => executePlan("unknownStaticMember"),
    (error) => error instanceof MechanicsExecutionError &&
      error.code === "MECHANICS_RANKING_ENTITY_UNKNOWN"
  );
});
