/**
 * Neutral publication proof for finite binary64 values and nested projections.
 *
 * The fixture uses generic points and entities. It verifies the schema-first
 * contract without importing any concrete game's map or ordering rule.
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const { checkMechanicsBundle, MechanicsSemanticError } = require("./mechanics-checker.cjs");
const { mechanicsSha256 } = require("./mechanics-canonicalize.cjs");
const { recommendedModuleLockForOperations } = require("./mechanics-modules.cjs");
const { validateMechanicsSchema } = require("./mechanics-validator.cjs");

const HASH = `sha256:${"0".repeat(64)}`;

const stored = (name, valueType, access = "read-only") => ({
  storage: { kind: "attribute", name },
  valueType,
  access
});

function createFixture() {
  const mechanics = {
    apiVersion: "cubica.dev/mechanics/v1alpha1",
    budgetProfile: "turn-based-standard-v1",
    moduleLock: {},
    stateModel: {
      types: {
        "fixture.point-json": {
          kind: "json",
          maxDepth: 3,
          maxNodes: 8,
          maxUtf8Bytes: 256
        },
        "fixture.coordinate": {
          kind: "finite-number",
          minimum: -1_000_000_000,
          maximum: 1_000_000_000
        },
        "fixture.string": { kind: "string" }
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
            position: stored("position", "fixture.point-json"),
            positionX: {
              source: { kind: "nested-field", field: "position", path: ["x"] },
              valueType: "fixture.coordinate",
              access: "read-only"
            }
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
            {
              id: "ordered",
              kind: "command",
              op: "core.entities.order",
              selection: { op: "value.result", stepId: "selected" },
              keys: [{
                source: { kind: "current-field", field: "positionX" },
                direction: "ascending",
                missing: "error"
              }],
              tieBreak: { kind: "canonical-id" }
            }
          ]
        }
      }
    }
  };
  return finalize(mechanics);
}

function finalize(mechanics) {
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

function initialState(x = 987_654_321.1234567) {
  return {
    public: {
      entities: {
        example: {
          objectType: "fixture.entity",
          facets: {},
          attributes: { position: { x, y: 2 } }
        }
      }
    },
    secret: {}
  };
}

function expectSemanticCode(mechanics, code, options) {
  assert.throws(
    () => checkMechanicsBundle(mechanics, options),
    (error) => error instanceof MechanicsSemanticError && error.code === code
  );
}

test("schema and checker accept a bounded finite coordinate and read-only projection", () => {
  const mechanics = createFixture();
  const schema = validateMechanicsSchema(mechanics);
  assert.equal(schema.valid, true, JSON.stringify(schema.errors));
  const checked = checkMechanicsBundle(mechanics, { initialState: initialState() });
  assert.equal(checked.costs.order.algorithmWork, 56);
});

test("finite-number rejects non-finite and impossible bounds", () => {
  const nonFinite = createFixture();
  nonFinite.stateModel.types["fixture.coordinate"].maximum = Number.POSITIVE_INFINITY;
  assert.equal(validateMechanicsSchema(nonFinite).valid, false);

  const inverted = createFixture();
  inverted.stateModel.types["fixture.coordinate"].minimum = 2;
  inverted.stateModel.types["fixture.coordinate"].maximum = 1;
  finalize(inverted);
  expectSemanticCode(inverted, "MECHANICS_TYPE_RANGE_INVALID");
});

test("projection shape is closed and forbids unsafe, empty, deep, or writable paths", () => {
  for (const mutate of [
    (field) => { field.source.path = []; },
    (field) => { field.source.path = Array.from({ length: 17 }, () => "x"); },
    (field) => { field.source.path = ["__proto__"]; },
    (field) => { field.access = "read-write"; }
  ]) {
    const mechanics = createFixture();
    mutate(mechanics.stateModel.collections.entities.fields.positionX);
    assert.equal(validateMechanicsSchema(mechanics).valid, false);
  }
});

test("checker rejects unknown or derived projection sources", () => {
  const unknown = createFixture();
  unknown.stateModel.collections.entities.fields.positionX.source.field = "missing";
  finalize(unknown);
  expectSemanticCode(unknown, "MECHANICS_DERIVED_FIELD_SOURCE_UNKNOWN");

  const chain = createFixture();
  chain.stateModel.collections.entities.fields.positionY = {
    source: { kind: "nested-field", field: "positionX", path: ["value"] },
    valueType: "fixture.coordinate",
    access: "read-only"
  };
  finalize(chain);
  expectSemanticCode(chain, "MECHANICS_DERIVED_FIELD_SOURCE_NOT_STORED");
});

test("record sources are resolved statically while bounded JSON is refined at state validation", () => {
  const mechanics = createFixture();
  mechanics.stateModel.types["fixture.point-record"] = {
    kind: "record",
    fields: {
      x: { typeRef: "fixture.coordinate", optional: false }
    }
  };
  mechanics.stateModel.collections.records = {
    itemShape: "record",
    audienceRef: "public",
    storage: { root: "public", segments: ["records"] },
    capacity: 2,
    stableKey: "map-key",
    fields: {
      point: {
        storage: { kind: "path", path: ["point"] },
        valueType: "fixture.point-record",
        access: "read-only"
      },
      x: {
        source: { kind: "nested-field", field: "point", path: ["x"] },
        valueType: "fixture.coordinate",
        access: "read-only"
      }
    }
  };
  finalize(mechanics);
  assert.doesNotThrow(() => checkMechanicsBundle(mechanics, {
    initialState: {
      ...initialState(),
      public: {
        ...initialState().public,
        records: { one: { point: { x: 12.5 } } }
      }
    }
  }));

  mechanics.stateModel.collections.records.fields.x.source.path = ["missing"];
  finalize(mechanics);
  expectSemanticCode(mechanics, "MECHANICS_DERIVED_FIELD_PATH_UNKNOWN");
});

test("initial-state projection refinement fails closed for missing, non-number, and out-of-range values", () => {
  for (const x of [undefined, "12", 1_000_000_001]) {
    const mechanics = createFixture();
    const state = initialState();
    state.public.entities.example.attributes.position.x = x;
    expectSemanticCode(mechanics, "MECHANICS_INITIAL_STATE_TYPE_MISMATCH", { initialState: state });
  }
});

test("finite-number supports min/max ordering but rejects binary64 sum", () => {
  const mechanics = createFixture();
  const step = mechanics.plans.order.transaction.steps[1];
  step.keys[0].source = {
    kind: "related-aggregate",
    collection: "entities",
    join: {
      current: { kind: "stable-id" },
      relatedField: "positionX"
    },
    aggregate: "sum",
    valueField: "positionX"
  };
  finalize(mechanics);
  expectSemanticCode(mechanics, "MECHANICS_ORDER_REFERENCE_INVALID");

  // Use a string join so the aggregate reaches its numeric-value validation.
  mechanics.stateModel.collections.entities.fields.owner = stored("owner", "fixture.string");
  step.keys[0].source.join = {
    current: { kind: "stable-id" },
    relatedField: "owner"
  };
  finalize(mechanics);
  expectSemanticCode(mechanics, "MECHANICS_ORDER_FINITE_SUM_UNSUPPORTED");
});
