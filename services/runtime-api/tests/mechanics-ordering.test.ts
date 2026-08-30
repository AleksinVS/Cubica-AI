/**
 * Neutral runtime proof for bounded lexicographic typed-collection ordering.
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
      structuredClone(selectedStep),
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

const recordOrderingPlan = (
  keys: Array<Record<string, unknown>>,
  tieBreak: Record<string, unknown> = { kind: "canonical-id" }
): CubicaMechanicsIRV1Alpha1["plans"][string] => {
  const plan = orderingPlan(keys, tieBreak);
  (plan.transaction.steps[0] as unknown as { selector: Record<string, unknown> }).selector = {
    collection: "records",
    attributes: {
      status: { op: "value.literal", value: "active" }
    },
    cardinality: { min: 0, max: 8 }
  };
  return plan;
};

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
        },
        records: {
          itemShape: "record",
          audienceRef: "public",
          storage: { root: "public", segments: ["records"] },
          capacity: 8,
          stableKey: "map-key",
          fields: {
            rank: {
              storage: { kind: "path", path: ["rank"] },
              valueType: "core.integer",
              access: "read-only"
            },
            status: {
              storage: { kind: "path", path: ["status"] },
              valueType: "core.string",
              access: "read-only"
            },
            ownerRef: {
              storage: { kind: "path", path: ["ownerRef"] },
              valueType: "core.optional-string",
              access: "read-only"
            }
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
      }], { kind: "server-random", stream: "fixture.order" }),
      seededWithoutTies: orderingPlan([{
        source: { kind: "current-field", field: "sequence" },
        direction: "ascending",
        missing: "error"
      }], { kind: "server-random", stream: "fixture.order" }),
      missingError: orderingPlan([{
        source: {
          kind: "related-field",
          referenceField: "ownerRef",
          collection: "owners",
          field: "label"
        },
        direction: "ascending",
        missing: "error"
      }], { kind: "server-random", stream: "fixture.order" }),
      recordRelated: recordOrderingPlan([
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
          source: aggregateSource("count"),
          direction: "descending",
          missing: "error"
        },
        {
          source: aggregateSource("sum"),
          direction: "descending",
          missing: "last"
        }
      ]),
      recordTies: recordOrderingPlan([{
        source: { kind: "current-field", field: "rank" },
        direction: "ascending",
        missing: "error"
      }], { kind: "server-random", stream: "fixture.record-order" })
    }
  } as unknown as CubicaMechanicsIRV1Alpha1;

  mechanics.plans.seededThenFail = structuredClone(mechanics.plans.seededTies);
  mechanics.plans.seededThenFail.transaction.steps.push({
    id: "reject-after-random",
    kind: "assert",
    op: "core.assert",
    predicate: { op: "predicate.constant", value: false },
    errorCode: "FIXTURE_REJECT_AFTER_RANDOM"
  });
  mechanics.plans.recordTiesThenFail = structuredClone(mechanics.plans.recordTies);
  mechanics.plans.recordTiesThenFail.transaction.steps.push({
    id: "reject-record-after-random",
    kind: "assert",
    op: "core.assert",
    predicate: { op: "predicate.constant", value: false },
    errorCode: "FIXTURE_REJECT_RECORD_AFTER_RANDOM"
  });
  mechanics.plans.recordForbiddenObjectTypes = structuredClone(mechanics.plans.recordRelated);
  (mechanics.plans.recordForbiddenObjectTypes.transaction.steps[0] as unknown as {
    selector: Record<string, unknown>;
  }).selector.objectTypes = ["fixture.entity"];
  mechanics.plans.recordForbiddenFacets = structuredClone(mechanics.plans.recordRelated);
  (mechanics.plans.recordForbiddenFacets.transaction.steps[0] as unknown as {
    selector: Record<string, unknown>;
  }).selector.facets = { active: { op: "value.literal", value: true } };

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
      },
      records: {
        "record-z": { rank: 2, status: "active", ownerRef: "owner-b" },
        "record-a": { rank: 1, status: "active", ownerRef: "owner-b" },
        "record-hidden": { rank: 0, status: "inactive", ownerRef: "owner-c" },
        "record-b": { rank: 1, status: "active", ownerRef: "owner-a" }
      }
    },
    secret: {}
  };
}

function executePlan(
  planId: keyof ReturnType<typeof createOrderingMechanics>["plans"],
  state = createOrderingState(),
  sampleRange: (exclusiveUpperBound: number) => number = () => 0
) {
  const mechanics = createOrderingMechanics();
  return executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans[String(planId)],
    state,
    actorContext: { sessionRole: "player" },
    random: { sampleRange }
  });
}

test("runtime orders by current, id-field related and decimal aggregate keys with bounded costs", () => {
  const output = executePlan("lexicographic");

  assert.deepEqual(output.result, {
    kind: "entities",
    collectionId: "entities",
    ids: ["alpha", "bravo", "charlie", "delta"],
    // The whole point of this operation is the order of `ids`, and the result
    // says so: a later bounded iteration keeps that order instead of
    // re-sorting canonically (ADR-102). A plain `core.entities.select` result
    // carries no such marker, because its id order is an artefact of storage.
    ordered: true,
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

test("injected live randomness stays inside complete-tie groups", () => {
  const first = executePlan("seededTies");
  const second = executePlan("seededTies");
  const firstResult = first.result as { ids: Array<string>; tieGroups: Array<Array<string>> };

  assert.deepEqual(first.result, second.result);
  assert.deepEqual(firstResult.tieGroups, [["alpha", "bravo", "charlie"]]);
  assert.equal(firstResult.ids.at(-1), "delta", "a non-tied entity must not cross its key boundary");
  assert.equal("random" in (first.candidateState.secret as Record<string, unknown>), false);
});

test("random tie-breaking without a complete tie does not sample", () => {
  const original = createOrderingState();
  let samplerCalls = 0;
  const output = executePlan("seededWithoutTies", original, () => {
    samplerCalls += 1;
    return 0;
  });

  assert.deepEqual(output.candidateState, original);
  assert.equal(samplerCalls, 0);
});

test("a failed transaction after tie breaking leaves its input state untouched", () => {
  const original = createOrderingState();
  const snapshot = structuredClone(original);
  const mechanics = createOrderingMechanics();

  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.seededThenFail,
      state: original,
      actorContext: { sessionRole: "player" },
      random: { sampleRange: () => 0 }
    }),
    (error) => error instanceof MechanicsExecutionError &&
      error.code === "FIXTURE_REJECT_AFTER_RANDOM"
  );
  assert.deepEqual(original, snapshot);
});

test("runtime orders record maps by current, related, count and sum keys with exact costs", () => {
  const state = createOrderingState();
  const records = (state.public as {
    records: Record<string, Record<string, unknown>>;
  }).records;
  records["record-a"].ownerRef = "owner-a";
  records["record-b"].ownerRef = "owner-a";
  records["record-c"] = { rank: 1, status: "active", ownerRef: "owner-a" };
  records["record-d"] = { rank: 1, status: "active", ownerRef: "owner-b" };
  const measurements = (state.public as {
    measurements: Record<string, Record<string, unknown>>;
  }).measurements;
  Object.assign(measurements, {
    "record-measurement-1": measurement("record-a", 1),
    "record-measurement-2": measurement("record-a", 2),
    "record-measurement-3": measurement("record-b", 2),
    "record-measurement-4": measurement("record-b", 3),
    "record-measurement-5": measurement("record-c", 100),
    "record-measurement-6": measurement("record-d", 100),
    "record-measurement-7": measurement("record-z", -1)
  });
  const output = executePlan("recordRelated", state);

  assert.deepEqual(output.result, {
    kind: "entities",
    collectionId: "records",
    ids: ["record-b", "record-a", "record-c", "record-d", "record-z"],
    ordered: true,
    tieGroups: []
  });
  assert.equal(output.cost.scannedEntities, 37);
  assert.equal(output.cost.algorithmWork, 173);
  assert.equal(output.cost.resultEntities, 10);
  assert.deepEqual(output.candidateState, state, "stable map identifiers and records stay unchanged");
});

test("selection and ordering ignore actor-private leaves without dropping or rewriting records", () => {
  const mechanics = createOrderingMechanics();
  mechanics.stateModel.collections.records.storage = { root: "players", segments: [] };
  mechanics.stateModel.endpoints.privateNote = {
    audienceRef: "actor",
    storage: { root: "players", segments: [{ context: "actor" }, "privateNote"] },
    valueType: "core.string",
    access: "read-write"
  };
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

  const state = createOrderingState() as Record<string, any>;
  state.players = structuredClone(state.public.records);
  delete state.public.records;
  for (const [actorId, actorRecord] of Object.entries(state.players) as Array<[
    string,
    Record<string, unknown>
  ]>) {
    actorRecord.privateNote = `${actorId}-only`;
  }
  const snapshot = structuredClone(state);
  const output = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.recordTies,
    state,
    actorContext: { actorPlayerId: "record-a", sessionRole: "player" },
    random: { sampleRange: () => 0 }
  });
  const result = output.result as { ids: string[]; tieGroups: string[][] };

  assert.deepEqual(result.ids, ["record-b", "record-a", "record-z"]);
  assert.equal(result.ids.length, 3, "only the public status selector controls cardinality");
  assert.deepEqual(result.tieGroups, [["record-a", "record-b"]]);
  assert.deepEqual(output.candidateState, snapshot, "private leaves and public record values are preserved exactly");
});

test("server randomness for record maps stays inside complete ties and rolls back atomically", () => {
  const state = createOrderingState();
  const snapshot = structuredClone(state);
  const output = executePlan("recordTies", state, () => 0);
  const result = output.result as { ids: Array<string>; tieGroups: Array<Array<string>> };

  assert.deepEqual(result.tieGroups, [["record-a", "record-b"]]);
  assert.equal(result.ids.at(-1), "record-z", "a non-tied record must not cross its key boundary");
  assert.deepEqual(output.candidateState, snapshot);

  const mechanics = createOrderingMechanics();
  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.recordTiesThenFail,
      state,
      actorContext: { sessionRole: "player" },
      random: { sampleRange: () => 0 }
    }),
    (error) => error instanceof MechanicsExecutionError &&
      error.code === "FIXTURE_REJECT_RECORD_AFTER_RANDOM"
  );
  assert.deepEqual(state, snapshot);
});

test("runtime record selectors fail closed for entity-only selector fields", () => {
  const mechanics = createOrderingMechanics();
  const state = createOrderingState();
  for (const planId of ["recordForbiddenObjectTypes", "recordForbiddenFacets"] as const) {
    assert.throws(
      () => executeMechanicsTransaction({
        mechanics,
        plan: mechanics.plans[planId],
        state,
        actorContext: { sessionRole: "player" },
        random: { sampleRange: () => 0 }
      }),
      (error) => error instanceof MechanicsExecutionError &&
        error.code === "MECHANICS_COLLECTION_ITEM_SHAPE_MISMATCH"
    );
  }
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
