/**
 * Neutral runtime proof for bounded lexicographic entity ordering.
 *
 * Generic entities, related owners and measurements exercise the public
 * Mechanics contract without embedding any concrete game's terminology or
 * rules in the shared executor.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { CubicaMechanicsIRV1Alpha1 } from "@cubica/contracts-manifest";

import {
  executeMechanicsTransaction,
  MechanicsExecutionError
} from "../src/modules/mechanics/index.ts";
import { requireSelection } from "../src/modules/mechanics/coreOperations.ts";
import { createSessionRandomStreamsState } from "../src/modules/runtime/sessionRandom.ts";

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
const SEED = "0123456789abcdeffedcba9876543210";

const collectionField = (
  name: string,
  valueType: string
): {
  storage: { kind: "attribute"; name: string };
  valueType: string;
  access: "read-only";
} => ({
  storage: { kind: "attribute", name },
  valueType,
  access: "read-only"
});

const selectedStep = {
  id: "selected",
  kind: "query",
  op: "core.entities.select",
  selector: {
    collection: "entities",
    cardinality: { min: 0, max: 8 }
  }
} as const;

const orderingPlan = (
  keys: Array<Record<string, unknown>>,
  tieBreak: Record<string, unknown> = { kind: "canonical-id" }
): CubicaMechanicsIRV1Alpha1["plans"][string] => ({
  planHash: HASH,
  transaction: {
    steps: [
      selectedStep,
      {
        id: "ordered",
        kind: "command",
        op: "core.entities.order",
        selection: { op: "value.result", stepId: "selected" },
        keys,
        tieBreak
      }
    ] as unknown as CubicaMechanicsIRV1Alpha1["plans"][string]["transaction"]["steps"]
  }
});

function createOrderingMechanics(): CubicaMechanicsIRV1Alpha1 {
  const aggregateSource = (
    aggregate: "count" | "sum" | "min" | "max"
  ): Record<string, unknown> => ({
    kind: "related-aggregate",
    collection: "measurements",
    join: {
      current: { kind: "stable-id" },
      relatedField: "entityRef"
    },
    aggregate,
    ...(aggregate === "count" ? {} : { valueField: "amount" })
  });
  const mechanics = {
    apiVersion: "cubica.dev/mechanics/v1alpha1",
    budgetProfile: "turn-based-standard-v1",
    moduleLock: {},
    stateModel: {
      types: {
        "core.string": { kind: "string" },
        "core.optional-string": { kind: "option", itemType: "core.string" },
        "core.integer": { kind: "integer", minimum: -100, maximum: 100 },
        "fixture.decimal": {
          kind: "decimal",
          scale: 2,
          minimum: "-100.00",
          maximum: "100.00"
        },
        "fixture.coordinate": {
          kind: "finite-number",
          minimum: -1_000_000_000,
          maximum: 1_000_000_000
        },
        "fixture.point": {
          kind: "json",
          maxDepth: 2,
          maxNodes: 4,
          maxUtf8Bytes: 128
        }
      },
      endpoints: {},
      collections: {
        entities: {
          audienceRef: "public",
          storage: { root: "public", segments: ["entities"] },
          capacity: 8,
          stableKey: "map-key",
          itemTypes: ["fixture.entity"],
          fields: {
            rank: collectionField("rank", "core.integer"),
            sequence: collectionField("sequence", "core.integer"),
            ownerRef: collectionField("ownerRef", "core.optional-string"),
            position: collectionField("position", "fixture.point"),
            positionX: {
              source: { kind: "nested-field", field: "position", path: ["x"] },
              valueType: "fixture.coordinate",
              access: "read-only"
            }
          }
        },
        owners: {
          audienceRef: "public",
          storage: { root: "public", segments: ["owners"] },
          capacity: 4,
          stableKey: "id-field",
          itemTypes: ["fixture.owner"],
          fields: {
            priority: collectionField("priority", "core.integer"),
            label: collectionField("label", "core.string")
          }
        },
        measurements: {
          audienceRef: "public",
          storage: { root: "public", segments: ["measurements"] },
          capacity: 16,
          stableKey: "map-key",
          itemTypes: ["fixture.measurement"],
          fields: {
            entityRef: collectionField("entityRef", "core.string"),
            amount: collectionField("amount", "fixture.decimal"),
            binaryAmount: collectionField("binaryAmount", "fixture.coordinate")
          }
        }
      },
      events: {}
    },
    plans: {
      lexicographic: orderingPlan([
        {
          source: { kind: "current-field", field: "rank" },
          direction: "ascending",
          missing: "error"
        },
        {
          source: {
            kind: "related-field",
            referenceField: "ownerRef",
            collection: "owners",
            field: "priority"
          },
          direction: "descending",
          missing: "last"
        },
        {
          source: aggregateSource("sum"),
          direction: "descending",
          missing: "last"
        }
      ]),
      count: orderingPlan([{
        source: aggregateSource("count"),
        direction: "descending",
        missing: "error"
      }]),
      minimum: orderingPlan([{
        source: aggregateSource("min"),
        direction: "ascending",
        missing: "first"
      }]),
      maximum: orderingPlan([{
        source: aggregateSource("max"),
        direction: "descending",
        missing: "last"
      }]),
      finiteMinimum: orderingPlan([{
        source: {
          ...aggregateSource("min"),
          valueField: "binaryAmount"
        },
        direction: "ascending",
        missing: "first"
      }]),
      finiteClose: orderingPlan([{
        source: { kind: "current-field", field: "positionX" },
        direction: "ascending",
        missing: "error"
      }]),
      seededTies: orderingPlan([{
        source: { kind: "current-field", field: "rank" },
        direction: "ascending",
        missing: "error"
      }], { kind: "seeded-random", stream: "fixture.order" }),
      seededWithoutTies: orderingPlan([{
        source: { kind: "current-field", field: "sequence" },
        direction: "ascending",
        missing: "error"
      }], { kind: "seeded-random", stream: "fixture.order" }),
      missingError: orderingPlan([{
        source: {
          kind: "related-field",
          referenceField: "ownerRef",
          collection: "owners",
          field: "label"
        },
        direction: "ascending",
        missing: "error"
      }], { kind: "seeded-random", stream: "fixture.order" })
    }
  } as unknown as CubicaMechanicsIRV1Alpha1;

  const operations = Object.values(mechanics.plans)
    .flatMap((plan) => plan.transaction.steps.map((step) => step.op));
  mechanics.moduleLock = recommendedModuleLockForOperations(operations);
  for (const [planId, plan] of Object.entries(mechanics.plans)) {
    plan.planHash = mechanicsSha256({
      apiVersion: mechanics.apiVersion,
      budgetProfile: mechanics.budgetProfile,
      moduleLock: mechanics.moduleLock,
      stateModel: mechanics.stateModel,
      objectModels: {},
      networkModels: {},
      planId,
      transaction: plan.transaction
    });
  }
  return mechanics;
}

const entity = (
  rank: number,
  sequence: number,
  ownerRef: string,
  x = sequence
): Record<string, unknown> => ({
  objectType: "fixture.entity",
  facets: {},
  attributes: { rank, sequence, ownerRef, position: { x, y: 0 } }
});

const measurement = (
  entityRef: string,
  amount: number
): Record<string, unknown> => ({
  objectType: "fixture.measurement",
  facets: {},
  attributes: { entityRef, amount, binaryAmount: amount }
});

function createOrderingState(): Record<string, unknown> {
  const random = createSessionRandomStreamsState(SEED);
  random.counters["fixture.other"] = 7;
  return {
    public: {
      entities: {
        delta: entity(2, 4, "owner-b"),
        alpha: entity(1, 1, "owner-a"),
        charlie: entity(1, 3, "owner-c"),
        bravo: entity(1, 2, "owner-a")
      },
      owners: [
        {
          id: "owner-b",
          objectType: "fixture.owner",
          facets: {},
          attributes: { priority: 1, label: "Beta" }
        },
        {
          id: "owner-a",
          objectType: "fixture.owner",
          facets: {},
          attributes: { priority: 2, label: "Alpha" }
        },
        {
          id: "owner-c",
          objectType: "fixture.owner",
          facets: {},
          attributes: { priority: 2, label: "Gamma" }
        }
      ],
      measurements: {
        "measurement-1": measurement("alpha", 1.25),
        "measurement-2": measurement("alpha", 2.25),
        "measurement-3": measurement("bravo", 3.5),
        "measurement-4": measurement("delta", -1)
      }
    },
    secret: { random }
  };
}

function executePlan(
  planId: keyof ReturnType<typeof createOrderingMechanics>["plans"],
  state = createOrderingState()
) {
  const mechanics = createOrderingMechanics();
  return executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans[String(planId)],
    state,
    actorContext: { sessionRole: "player" }
  });
}

test("runtime orders by current, id-field related and decimal aggregate keys with bounded costs", () => {
  const output = executePlan("lexicographic");

  assert.deepEqual(output.result, {
    kind: "entities",
    collectionId: "entities",
    ids: ["alpha", "bravo", "charlie", "delta"],
    tieGroups: [["alpha", "bravo"]]
  });
  assert.deepEqual(output.audit.at(-1)?.result, {
    kind: "entities",
    collectionId: "entities",
    count: 4
  });
  assert.equal(output.cost.scannedEntities, 19);
  assert.equal(output.cost.algorithmWork, 88);
  assert.equal(output.cost.resultEntities, 10);
});

test("count, sum, minimum and maximum define their empty-group behavior", () => {
  assert.deepEqual(
    (executePlan("count").result as { ids: Array<string> }).ids,
    ["alpha", "bravo", "delta", "charlie"]
  );
  assert.deepEqual(
    (executePlan("minimum").result as { ids: Array<string> }).ids,
    ["charlie", "delta", "alpha", "bravo"]
  );
  assert.deepEqual(
    (executePlan("maximum").result as { ids: Array<string> }).ids,
    ["bravo", "alpha", "delta", "charlie"]
  );
  assert.deepEqual(
    (executePlan("finiteMinimum").result as { ids: Array<string> }).ids,
    ["charlie", "delta", "alpha", "bravo"]
  );
});

test("finite-number ordering preserves close binary64 values and exact ties", () => {
  const state = createOrderingState();
  const entities = (state.public as {
    entities: Record<string, { attributes: Record<string, unknown> }>;
  }).entities;
  entities.alpha.attributes.position = { x: 987_654_321.1234567, y: 0 };
  entities.bravo.attributes.position = { x: 987_654_321.1234568, y: 0 };
  entities.charlie.attributes.position = { x: -0, y: 0 };
  entities.delta.attributes.position = { x: 0, y: 0 };

  const output = executePlan("finiteClose", state);
  assert.deepEqual(
    (output.result as { ids: Array<string>; tieGroups: Array<Array<string>> }).ids,
    ["charlie", "delta", "alpha", "bravo"]
  );
  assert.deepEqual(
    (output.result as { tieGroups: Array<Array<string>> }).tieGroups,
    [["charlie", "delta"]],
    "-0 and 0 are one exact ordering value while close non-equal coordinates remain distinct"
  );
});

test("seeded ties are reproducible, stay inside complete-tie groups and isolate streams", () => {
  const first = executePlan("seededTies");
  const second = executePlan("seededTies");
  const firstResult = first.result as { ids: Array<string>; tieGroups: Array<Array<string>> };

  assert.deepEqual(first.result, second.result);
  assert.deepEqual(firstResult.tieGroups, [["alpha", "bravo", "charlie"]]);
  assert.equal(firstResult.ids.at(-1), "delta", "a non-tied entity must not cross its key boundary");
  assert.equal(first.randomState?.counters["fixture.other"], 7);
  assert.equal(first.randomState?.counters["fixture.order"], 2);
});

test("seeded mode without a complete tie neither reads nor persists its random stream", () => {
  const original = createOrderingState();
  const output = executePlan("seededWithoutTies", original);

  assert.deepEqual(output.candidateState, original);
  assert.equal(output.randomState, undefined);
  assert.deepEqual(
    ((output.candidateState.secret as Record<string, unknown>).random as { counters: Record<string, number> }).counters,
    { "fixture.other": 7 }
  );
});

test("an error before tie breaking rolls back and leaves the random counters untouched", () => {
  const original = createOrderingState();
  const entities = (original.public as {
    entities: Record<string, { attributes: Record<string, unknown> }>;
  }).entities;
  entities.charlie.attributes.ownerRef = "owner-missing";
  const snapshot = structuredClone(original);
  const mechanics = createOrderingMechanics();

  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.missingError,
      state: original,
      actorContext: { sessionRole: "player" }
    }),
    (error) => error instanceof MechanicsExecutionError &&
      error.code === "MECHANICS_ORDER_VALUE_MISSING"
  );
  assert.deepEqual(original, snapshot);
});

test("the shared trusted-selection guard rejects duplicate identifiers", () => {
  assert.throws(
    () => requireSelection({
      kind: "entities",
      collectionId: "entities",
      ids: ["alpha", "alpha"]
    }, "ordered"),
    (error) => error instanceof MechanicsExecutionError &&
      error.code === "MECHANICS_RESULT_TYPE_MISMATCH"
  );
});
