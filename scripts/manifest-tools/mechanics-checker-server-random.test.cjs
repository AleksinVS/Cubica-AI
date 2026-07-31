/**
 * Neutral publication proofs for the live server-random provider.
 *
 * These fixtures exercise the real semantic checker and exact module locks.
 * They contain no game names or gameplay rules. Publication reserves only the
 * actual bounded sampling work because production stores no generator state
 * and performs no historical reconstruction.
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const { checkMechanicsBundle } = require("./mechanics-checker.cjs");
const { mechanicsSha256 } = require("./mechanics-canonicalize.cjs");
const { recommendedModuleLockForOperations } = require("./mechanics-modules.cjs");

const API_VERSION = "cubica.dev/mechanics/v1alpha1";

function emptyParamsSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {},
    required: []
  };
}

function action(planRef) {
  return {
    invocation: "external",
    paramsSchema: emptyParamsSchema(),
    binding: { kind: "mechanics-plan", planRef }
  };
}

function finalizeFixture(fixture) {
  const operations = Object.values(fixture.mechanics.plans)
    .flatMap((candidate) => candidate.transaction.steps.map((step) => step.op));
  fixture.mechanics.moduleLock = recommendedModuleLockForOperations(operations);

  for (const [planId, candidate] of Object.entries(fixture.mechanics.plans)) {
    candidate.planHash = mechanicsSha256({
      apiVersion: fixture.mechanics.apiVersion,
      budgetProfile: fixture.mechanics.budgetProfile,
      moduleLock: fixture.mechanics.moduleLock,
      stateModel: fixture.mechanics.stateModel,
      objectModels: {},
      networkModels: {},
      planId,
      transaction: candidate.transaction
    });
  }
  for (const [actionId, definition] of Object.entries(fixture.actions)) {
    definition.definitionHash = mechanicsSha256({
      apiVersion: fixture.mechanics.apiVersion,
      actionId,
      definition,
      planHash: fixture.mechanics.plans[definition.binding.planRef].planHash
    });
  }
  return fixture;
}

function baseStateModel() {
  return {
    types: {
      "core.boolean": { kind: "boolean" },
      "core.string": { kind: "string" },
      "core.integer": {
        kind: "integer",
        minimum: Number.MIN_SAFE_INTEGER,
        maximum: Number.MAX_SAFE_INTEGER
      },
      "neutral.roll-values": {
        kind: "list",
        itemType: "core.integer",
        maxItems: 99
      },
      "neutral.roll": {
        kind: "record",
        fields: {
          values: { typeRef: "neutral.roll-values", optional: false },
          total: { typeRef: "core.integer", optional: false },
          isDouble: { typeRef: "core.boolean", optional: false }
        }
      },
      "neutral.roll-option": { kind: "option", itemType: "neutral.roll" },
      "core.optional-string": { kind: "option", itemType: "core.string" }
    },
    endpoints: {
      roll: {
        audienceRef: "public",
        storage: { root: "public", segments: ["roll"] },
        valueType: "neutral.roll-option",
        access: "read-write"
      },
      card: {
        audienceRef: "public",
        storage: { root: "public", segments: ["card"] },
        valueType: "core.optional-string",
        access: "read-write"
      }
    },
    collections: {
      entities: {
        audienceRef: "public",
        storage: { root: "public", segments: ["entities"] },
        capacity: 8,
        stableKey: "map-key",
        itemTypes: ["neutral.entity"],
        fields: {
          score: {
            storage: { kind: "attribute", name: "score" },
            valueType: "core.integer",
            access: "read-only"
          }
        }
      }
    },
    events: {}
  };
}

function fixture() {
  const select = {
    id: "select",
    kind: "query",
    op: "core.entities.select",
    selector: {
      collection: "entities",
      cardinality: { min: 0, max: 8 }
    }
  };
  const order = (tieBreak) => ({
    id: "order",
    kind: "command",
    op: "core.entities.order",
    selection: { op: "value.result", stepId: "select" },
    keys: [{
      source: { kind: "current-field", field: "score" },
      direction: "descending",
      missing: "error"
    }],
    tieBreak
  });

  return {
    mechanics: {
      apiVersion: API_VERSION,
      budgetProfile: "turn-based-standard-v1",
      moduleLock: {},
      stateModel: baseStateModel(),
      plans: {
        dice: {
          transaction: {
            steps: [{
              id: "roll",
              kind: "command",
              op: "random.dice.roll",
              dice: "2d6",
              stream: "neutral.dice",
              target: { endpoint: "roll" }
            }]
          }
        },
        shuffle: {
          transaction: {
            steps: [{
              id: "shuffle",
              kind: "command",
              op: "deck.shuffle",
              deckId: "neutral-deck",
              sourceCollection: "entities",
              stream: "neutral.deck"
            }]
          }
        },
        draw: {
          transaction: {
            steps: [{
              id: "draw",
              kind: "command",
              op: "deck.draw",
              deckId: "neutral-deck",
              target: { endpoint: "card" },
              onEmpty: "reshuffle-discard"
            }]
          }
        },
        canonicalOrder: {
          transaction: {
            steps: [structuredClone(select), order({ kind: "canonical-id" })]
          }
        },
        randomOrder: {
          transaction: {
            steps: [
              structuredClone(select),
              order({ kind: "server-random", stream: "neutral.order" })
            ]
          }
        }
      }
    },
    actions: {
      dice: action("dice"),
      shuffle: action("shuffle"),
      draw: action("draw"),
      canonicalOrder: action("canonicalOrder"),
      randomOrder: action("randomOrder")
    }
  };
}

test("dice continuation reserves no historical reconstruction work", () => {
  const candidate = finalizeFixture(fixture());
  const checked = checkMechanicsBundle(candidate.mechanics, {
    actions: candidate.actions,
    objectModels: {},
    networkModels: {}
  });
  assert.equal(checked.costs.dice.algorithmWork, 0);
});

test("random tie groups add no historical reconstruction surcharge", () => {
  const candidate = finalizeFixture(fixture());
  const checked = checkMechanicsBundle(candidate.mechanics, {
    actions: candidate.actions,
    objectModels: {},
    networkModels: {}
  });
  assert.equal(
    checked.costs.randomOrder.algorithmWork -
      checked.costs.canonicalOrder.algorithmWork,
    0
  );
});

test("shuffle and draw add no historical reconstruction surcharge", () => {
  const candidate = finalizeFixture(fixture());
  const checked = checkMechanicsBundle(candidate.mechanics, {
    actions: candidate.actions,
    objectModels: {},
    networkModels: {}
  });
  assert.equal(checked.costs.shuffle.algorithmWork, 0);
  assert.equal(checked.costs.draw.algorithmWork, 0);
});
