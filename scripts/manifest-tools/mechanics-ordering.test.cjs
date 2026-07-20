/**
 * Neutral publication tests for bounded entity ordering.
 *
 * The fixture deliberately uses generic entities, owners and measurements.
 * It proves the reusable Mechanics contract without importing any rule or
 * vocabulary from a concrete game.
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const { checkMechanicsBundle, MechanicsSemanticError } = require("./mechanics-checker.cjs");
const { mechanicsSha256 } = require("./mechanics-canonicalize.cjs");
const { recommendedModuleLockForOperations } = require("./mechanics-modules.cjs");
const { validateMechanicsSchema } = require("./mechanics-validator.cjs");

const API_VERSION = "cubica.dev/mechanics/v1alpha1";
const HASH = `sha256:${"0".repeat(64)}`;

const field = (name, valueType) => ({
  storage: { kind: "attribute", name },
  valueType,
  access: "read-only"
});

function orderStep(keys, tieBreak = { kind: "canonical-id" }) {
  return {
    id: "ordered",
    kind: "command",
    op: "core.entities.order",
    selection: { op: "value.result", stepId: "selected" },
    keys,
    tieBreak
  };
}

function createOrderingMechanics(step = orderStep([{
  source: { kind: "current-field", field: "rank" },
  direction: "ascending",
  missing: "error"
}])) {
  const mechanics = {
    apiVersion: API_VERSION,
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
        "fixture.state": { kind: "enum", values: ["open", "closed"] }
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
            rank: field("rank", "core.integer"),
            ownerRef: field("ownerRef", "core.optional-string"),
            group: field("group", "core.string"),
            state: field("state", "fixture.state")
          }
        },
        owners: {
          audienceRef: "public",
          storage: { root: "public", segments: ["owners"] },
          capacity: 4,
          stableKey: "id-field",
          itemTypes: ["fixture.owner"],
          fields: {
            priority: field("priority", "core.integer"),
            label: field("label", "core.string")
          }
        },
        measurements: {
          audienceRef: "public",
          storage: { root: "public", segments: ["measurements"] },
          capacity: 16,
          stableKey: "map-key",
          itemTypes: ["fixture.measurement"],
          fields: {
            entityRef: field("entityRef", "core.string"),
            group: field("group", "core.string"),
            amount: field("amount", "fixture.decimal")
          }
        }
      },
      events: {}
    },
    plans: {
      order: {
        planHash: HASH,
        transaction: {
          steps: [
            {
              id: "selected",
              kind: "query",
              op: "core.entities.select",
              selector: {
                collection: "entities",
                cardinality: { min: 0, max: 8 }
              }
            },
            step
          ]
        }
      }
    }
  };
  return finalizeMechanics(mechanics);
}

function finalizeMechanics(mechanics) {
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

function expectSemanticCode(mechanics, code) {
  assert.throws(
    () => checkMechanicsBundle(mechanics),
    (error) => error instanceof MechanicsSemanticError && error.code === code
  );
}

test("schema and checker accept lexicographic current, id-field relation and aggregate ordering", () => {
  const mechanics = createOrderingMechanics(orderStep([
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
      source: {
        kind: "related-aggregate",
        collection: "measurements",
        join: {
          current: { kind: "stable-id" },
          relatedField: "entityRef"
        },
        aggregate: "sum",
        valueField: "amount"
      },
      direction: "descending",
      missing: "last"
    }
  ]));

  const schema = validateMechanicsSchema(mechanics);
  assert.equal(schema.valid, true, JSON.stringify(schema.errors));
  const checked = checkMechanicsBundle(mechanics);

  // Selection scans 8. Ordering scans the selected collection (8), the
  // id-field relation (4), and the aggregate relation twice (16 + 16).
  assert.equal(checked.costs.order.scannedEntities, 52);
  assert.equal(checked.costs.order.algorithmWork, 164);
  assert.equal(checked.costs.order.resultEntities, 24);
});

test("ordering aggregate shape is closed and distinguishes count from numeric aggregates", () => {
  const countWithValue = createOrderingMechanics();
  const countSource = {
    kind: "related-aggregate",
    collection: "measurements",
    join: {
      current: { kind: "stable-id" },
      relatedField: "entityRef"
    },
    aggregate: "count",
    valueField: "amount"
  };
  countWithValue.plans.order.transaction.steps[1].keys[0].source = countSource;
  assert.equal(validateMechanicsSchema(finalizeMechanics(countWithValue)).valid, false);

  const sumWithoutValue = createOrderingMechanics();
  sumWithoutValue.plans.order.transaction.steps[1].keys[0].source = {
    kind: "related-aggregate",
    collection: "measurements",
    join: {
      current: { kind: "stable-id" },
      relatedField: "entityRef"
    },
    aggregate: "sum"
  };
  assert.equal(validateMechanicsSchema(finalizeMechanics(sumWithoutValue)).valid, false);
});

test("checker rejects conditional source selections and unsupported enum sort keys", () => {
  const conditional = createOrderingMechanics();
  conditional.plans.order.transaction.steps[0].when = {
    op: "predicate.constant",
    value: true
  };
  finalizeMechanics(conditional);
  expectSemanticCode(conditional, "MECHANICS_ORDER_SOURCE_CONDITIONAL");

  const enumKey = createOrderingMechanics(orderStep([{
    source: { kind: "current-field", field: "state" },
    direction: "ascending",
    missing: "error"
  }]));
  expectSemanticCode(enumKey, "MECHANICS_ORDER_FIELD_TYPE_UNSUPPORTED");
});

test("checker rejects aggregate ranges whose declared capacity can overflow fixed-point sums", () => {
  const mechanics = createOrderingMechanics(orderStep([{
    source: {
      kind: "related-aggregate",
      collection: "measurements",
      join: {
        current: { kind: "stable-id" },
        relatedField: "entityRef"
      },
      aggregate: "sum",
      valueField: "amount"
    },
    direction: "ascending",
    missing: "last"
  }]));
  mechanics.stateModel.types["fixture.decimal"] = {
    kind: "decimal",
    scale: 2,
    minimum: "-6000000000000.00",
    maximum: "6000000000000.00"
  };
  finalizeMechanics(mechanics);
  expectSemanticCode(mechanics, "MECHANICS_ORDER_DECIMAL_OVERFLOW");
});

test("checker includes related audiences in result flow and blocks disclosure through a public update", () => {
  const mechanics = createOrderingMechanics(orderStep([{
    source: {
      kind: "related-field",
      referenceField: "ownerRef",
      collection: "owners",
      field: "priority"
    },
    direction: "descending",
    missing: "last"
  }]));
  mechanics.stateModel.collections.owners.audienceRef = "server";
  mechanics.stateModel.collections.owners.storage.root = "secret";
  mechanics.plans.order.transaction.steps.push({
    id: "update",
    kind: "command",
    op: "core.entities.update",
    selection: { op: "value.result", stepId: "ordered" },
    attributeValues: {
      rank: { op: "value.literal", value: 1 }
    }
  });
  mechanics.stateModel.collections.entities.fields.rank.access = "read-write";
  finalizeMechanics(mechanics);
  expectSemanticCode(mechanics, "MECHANICS_INFORMATION_FLOW_VIOLATION");
});

test("ordered selections remain compatible with update and within composition", () => {
  const mechanics = createOrderingMechanics();
  mechanics.stateModel.collections.entities.fields.rank.access = "read-write";
  mechanics.plans.order.transaction.steps.push(
    {
      id: "updateOrdered",
      kind: "command",
      op: "core.entities.update",
      selection: { op: "value.result", stepId: "ordered" },
      attributeValues: {
        rank: { op: "value.literal", value: 1 }
      }
    },
    {
      id: "refined",
      kind: "query",
      op: "core.entities.select",
      selector: {
        collection: "entities",
        within: { op: "value.result", stepId: "ordered" },
        cardinality: { min: 0, max: 8 }
      }
    }
  );
  finalizeMechanics(mechanics);

  const schema = validateMechanicsSchema(mechanics);
  assert.equal(schema.valid, true, JSON.stringify(schema.errors));
  assert.doesNotThrow(() => checkMechanicsBundle(mechanics));
});
