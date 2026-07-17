/**
 * Neutral regression suite for the final typed Mechanics migration.
 *
 * These fixtures intentionally avoid concrete game vocabulary. They prove
 * publication semantics that JSON Schema cannot express across actions,
 * plans, module locks, state types, and persisted system schedules.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { compileAuthoringText } = require("./authoring-compiler.cjs");
const { checkMechanicsBundle, MechanicsSemanticError } = require("./mechanics-checker.cjs");
const { mechanicsSha256 } = require("./mechanics-canonicalize.cjs");
const {
  MODULE_REGISTRY,
  OPERATION_MODULES,
  recommendedModuleLockForOperations
} = require("./mechanics-modules.cjs");
const {
  validateGameIntentSchema,
  validateMechanicsSchema,
  validateOperationCatalogSchema
} = require("./mechanics-validator.cjs");
const operationCatalog = require("../../docs/architecture/schemas/mechanics-operation-catalog.json");

const API_VERSION = "cubica.dev/mechanics/v1alpha1";
const repoRoot = path.resolve(__dirname, "..", "..");

function baseStateModel() {
  return {
    types: {
      "core.boolean": { kind: "boolean" },
      "core.string": { kind: "string" },
      "core.integer": {
        kind: "integer",
        minimum: Number.MIN_SAFE_INTEGER,
        maximum: Number.MAX_SAFE_INTEGER
      }
    },
    endpoints: {},
    collections: {},
    events: {}
  };
}

function emptyParamsSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {},
    required: []
  };
}

function integerParamsSchema(required = true) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      amount: {
        type: "integer",
        minimum: 0,
        maximum: 100
      }
    },
    required: required ? ["amount"] : []
  };
}

function action(planRef, invocation = "external", paramsSchema = emptyParamsSchema()) {
  return {
    invocation,
    paramsSchema,
    binding: { kind: "mechanics-plan", planRef }
  };
}

function plan(steps) {
  return { transaction: { steps } };
}

function constantAssert(id = "assert") {
  return {
    id,
    kind: "assert",
    op: "core.assert",
    predicate: { op: "predicate.constant", value: true }
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
      objectModels: fixture.objectModels || {},
      networkModels: fixture.networkModels || {},
      planId,
      transaction: candidate.transaction
    });
  }
  for (const [actionId, definition] of Object.entries(fixture.actions)) {
    const referencedPlan = fixture.mechanics.plans[definition.binding.planRef];
    definition.definitionHash = mechanicsSha256({
      apiVersion: fixture.mechanics.apiVersion,
      actionId,
      definition,
      planHash: referencedPlan.planHash
    });
  }
  return fixture;
}

function checkFixture(fixture, options = {}) {
  return checkMechanicsBundle(fixture.mechanics, {
    actions: fixture.actions,
    objectModels: fixture.objectModels || {},
    networkModels: fixture.networkModels || {},
    ...options
  });
}

function expectSemanticError(fixture, code) {
  assert.throws(
    () => checkFixture(finalizeFixture(fixture)),
    (error) => error instanceof MechanicsSemanticError && error.code === code
  );
}

function scheduleFixture() {
  return {
    mechanics: {
      apiVersion: API_VERSION,
      budgetProfile: "turn-based-standard-v1",
      moduleLock: {},
      stateModel: baseStateModel(),
      plans: {
        register: plan([
          {
            id: "register",
            kind: "command",
            op: "system.schedule.register",
            actionId: "system.resolve",
            params: { amount: { op: "value.param", name: "amount" } },
            trigger: {
              op: "predicate.compare",
              operator: ">",
              left: { op: "value.param", name: "amount" },
              right: { op: "value.literal", value: 0 }
            },
            falsePolicy: "defer",
            maxOccurrences: 1
          }
        ]),
        resolve: plan([constantAssert()])
      }
    },
    actions: {
      register: action("register", "external", integerParamsSchema()),
      "system.resolve": {
        ...action("resolve", "system", integerParamsSchema()),
        allowedSessionRoles: ["assistant"]
      }
    }
  };
}

function createFixture() {
  const stateModel = baseStateModel();
  stateModel.collections.entities = {
    audienceRef: "public",
    storage: { root: "public", segments: ["entities"] },
    capacity: 16,
    stableKey: "map-key",
    itemTypes: ["neutral.entity"],
    fields: {
      network: {
        storage: { kind: "attribute", name: "networkId" },
        valueType: "core.string",
        access: "read-only"
      }
    }
  };
  return {
    mechanics: {
      apiVersion: API_VERSION,
      budgetProfile: "turn-based-standard-v1",
      moduleLock: {},
      stateModel,
      plans: {
        create: plan([
          {
            id: "create",
            kind: "command",
            op: "core.entity.create",
            collection: "entities",
            entityId: { op: "value.literal", value: "entity-1" },
            objectType: "neutral.entity",
            facets: {},
            attributes: {
              network: { op: "value.literal", value: "network-1" }
            },
            visibility: "public"
          }
        ])
      }
    },
    actions: { create: action("create") }
  };
}

/**
 * Build the smallest neutral turn-based package whose concrete participant
 * identities are intentionally absent from the reusable authoring state.
 */
function turnSessionFixture() {
  const stateModel = baseStateModel();
  Object.assign(stateModel.types, {
    "core.optional-string": {
      kind: "option",
      itemType: "core.string"
    },
    "neutral.participant-order": {
      kind: "list",
      itemType: "core.string",
      maxItems: 4
    },
    "neutral.turn-phase": {
      kind: "enum",
      values: ["begin", "finish"]
    }
  });
  Object.assign(stateModel.endpoints, {
    "public.turn.order": {
      audienceRef: "public",
      storage: { root: "public", segments: ["turn", "order"] },
      valueType: "neutral.participant-order",
      access: "read-only"
    },
    "public.turn.active": {
      audienceRef: "public",
      storage: { root: "public", segments: ["turn", "activePlayerId"] },
      valueType: "core.string",
      access: "read-write"
    },
    "public.turn.number": {
      audienceRef: "public",
      storage: { root: "public", segments: ["turn", "turnNumber"] },
      valueType: "core.integer",
      access: "read-write"
    },
    "public.turn.phase": {
      audienceRef: "public",
      storage: { root: "public", segments: ["turn", "phase"] },
      valueType: "neutral.turn-phase",
      access: "read-write"
    }
  });
  return {
    mechanics: {
      apiVersion: API_VERSION,
      budgetProfile: "turn-based-standard-v1",
      moduleLock: {},
      stateModel,
      plans: {
        inspect: plan([constantAssert()])
      }
    },
    actions: {
      inspect: action("inspect")
    }
  };
}

function rankingFixture() {
  const stateModel = baseStateModel();
  Object.assign(stateModel.types, {
    participant: {
      kind: "record",
      fields: {
        base: { typeRef: "core.integer", optional: false }
      }
    },
    participants: {
      kind: "record",
      fields: {
        alpha: { typeRef: "participant", optional: false },
        beta: { typeRef: "participant", optional: false }
      }
    },
    related: {
      kind: "record",
      fields: {
        entityId: { typeRef: "core.string", optional: false },
        value: { typeRef: "core.integer", optional: false }
      }
    },
    relatedList: { kind: "list", itemType: "related", maxItems: 16 },
    standing: {
      kind: "record",
      fields: {
        entityId: { typeRef: "core.string", optional: false },
        baseValue: { typeRef: "core.integer", optional: false },
        relatedValue: { typeRef: "core.integer", optional: false },
        score: { typeRef: "core.integer", optional: false },
        relatedItems: { typeRef: "relatedList", optional: false },
        rank: { typeRef: "core.integer", optional: false }
      }
    },
    standings: { kind: "list", itemType: "standing", maxItems: 16 },
    winners: { kind: "list", itemType: "core.string", maxItems: 16 },
    rankingGroup: {
      kind: "record",
      fields: {
        standings: { typeRef: "standings", optional: false },
        winners: { typeRef: "winners", optional: false },
        tiedForFirst: { typeRef: "core.boolean", optional: false }
      }
    },
    rankingGroups: { kind: "map", valueType: "rankingGroup", maxProperties: 8 }
  });
  stateModel.endpoints.participants = {
    audienceRef: "public",
    storage: { root: "public", segments: ["participants"] },
    valueType: "participants",
    access: "read-only"
  };
  stateModel.endpoints.ranking = {
    audienceRef: "public",
    storage: { root: "public", segments: ["ranking"] },
    valueType: "rankingGroups",
    access: "read-write"
  };
  return {
    mechanics: {
      apiVersion: API_VERSION,
      budgetProfile: "turn-based-standard-v1",
      moduleLock: {},
      stateModel,
      plans: {
        rank: plan([
          {
            id: "scores",
            kind: "query",
            op: "core.entities.score",
            entities: { endpoint: "participants" },
            entityIds: [
              { op: "value.literal", value: "alpha" },
              { op: "value.literal", value: "beta" }
            ],
            baseField: "base",
            relatedSources: []
          },
          {
            id: "ranking",
            kind: "algorithm",
            op: "core.ranking.stable",
            scores: { op: "value.result", stepId: "scores" },
            groups: [{
              id: "all",
              entityIds: [
                { op: "value.literal", value: "alpha" },
                { op: "value.literal", value: "beta" }
              ]
            }]
          },
          {
            id: "publish",
            kind: "command",
            op: "core.state.patch",
            patches: [{
              operation: "set",
              target: { endpoint: "ranking" },
              value: { op: "value.result", stepId: "ranking", path: ["groups"] }
            }]
          }
        ])
      }
    },
    actions: { rank: action("rank") }
  };
}

function dynamicBindingFixture() {
  const stateModel = baseStateModel();
  stateModel.endpoints.balance = {
    audienceRef: "public",
    storage: {
      root: "players",
      segments: [{ binding: "participantId" }, "metrics", "balance"]
    },
    valueType: "core.integer",
    access: "read-write"
  };
  return {
    mechanics: {
      apiVersion: API_VERSION,
      budgetProfile: "turn-based-standard-v1",
      moduleLock: {},
      stateModel,
      plans: {
        add: plan([{
          id: "add",
          kind: "command",
          op: "core.number.add",
          target: {
            endpoint: "balance",
            bindings: {
              participantId: { op: "value.param", name: "participantId" }
            }
          },
          delta: { op: "value.literal", value: 1 }
        }])
      }
    },
    actions: {
      add: action("add", "external", {
        type: "object",
        additionalProperties: false,
        properties: {
          participantId: { type: "string", maxLength: 128 }
        },
        required: ["participantId"]
      })
    }
  };
}

test("operation catalog exactly covers the 27 registered operations including system schedules", () => {
  assert.equal(validateOperationCatalogSchema(operationCatalog).valid, true);
  assert.equal(OPERATION_MODULES.size, 27);
  assert.deepEqual(
    MODULE_REGISTRY.get("cubica.system").operations,
    ["system.schedule.register", "system.schedule.cancel"]
  );
  assert.deepEqual(
    Object.keys(operationCatalog.operations).sort(),
    [...OPERATION_MODULES.keys()].sort()
  );
});

test("Game Intent schema requires an explicit invocation mode", () => {
  const catalog = {
    inspect: {
      definitionHash: `sha256:${"0".repeat(64)}`,
      binding: { kind: "mechanics-plan", planRef: "inspect" }
    }
  };
  assert.equal(validateGameIntentSchema(catalog).valid, false);
  catalog.inspect.invocation = "external";
  assert.equal(validateGameIntentSchema(catalog).valid, true);
});

test("schema rejects prototype-pollution names in scheduled params", () => {
  const fixture = finalizeFixture(scheduleFixture());
  fixture.mechanics.plans.register.transaction.steps[0].params = JSON.parse(
    '{"__proto__":{"op":"value.literal","value":1}}'
  );
  assert.equal(validateMechanicsSchema(fixture.mechanics).valid, false);
});

test("compiler defaults invocation before hashing and never publishes pending actions", () => {
  const sourceFile = path.join(
    repoRoot,
    "docs",
    "architecture",
    "schemas",
    "examples",
    "authoring-v2",
    "minimal-game.authoring.json"
  );
  const authoring = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
  // This legacy example still carries a generated lock; the v1alpha1
  // authoring contract correctly makes locks compiler-owned.
  delete authoring.root.mechanics.moduleLock;
  const pending = structuredClone(authoring.root.logic.actions[0]);
  pending.id = "future.inspect";
  pending._label = "Future inspect action";
  pending.binding = { kind: "mechanics-plan", planRef: "choice.accept" };
  authoring.root.logic.pendingActions = [pending];
  const output = compileAuthoringText({
    kind: "game",
    sourceFile,
    outputFile: path.join(repoRoot, ".tmp", "minimal-game.manifest.json"),
    sourceMapFile: path.join(repoRoot, ".tmp", "minimal-game.manifest.source-map.json")
  }, JSON.stringify(authoring));
  assert.equal(output.manifest.actions["choice.accept"].invocation, "external");
  assert.equal(Object.prototype.hasOwnProperty.call(output.manifest.actions, "future.inspect"), false);
  assert.equal(JSON.stringify(output.manifest).includes("future.inspect"), false);
  const { definitionHash, ...definition } = output.manifest.actions["choice.accept"];
  assert.equal(
    definitionHash,
    mechanicsSha256({
      apiVersion: output.manifest.mechanics.apiVersion,
      actionId: "choice.accept",
      definition,
      planHash: output.manifest.mechanics.plans["choice.accept"].planHash
    })
  );
});

test("admits an external registration of a published system intent", () => {
  assert.doesNotThrow(() => checkFixture(finalizeFixture(scheduleFixture())));
});

test("rejects schedule registration params outside the target intent schema", () => {
  const fixture = scheduleFixture();
  fixture.mechanics.plans.register.transaction.steps[0].params.amount = {
    op: "value.literal",
    value: "not-an-integer"
  };
  expectSemanticError(fixture, "MECHANICS_SCHEDULE_PARAM_TYPE_MISMATCH");
});

test("rejects actor context from a system-invocation plan", () => {
  const fixture = scheduleFixture();
  fixture.mechanics.plans.resolve.transaction.steps[0].predicate = {
    op: "predicate.exists",
    value: { op: "value.actor" }
  };
  expectSemanticError(fixture, "MECHANICS_SYSTEM_CONTEXT_INVALID");
});

test("rejects replay-unsafe result references in persisted triggers", () => {
  const fixture = scheduleFixture();
  fixture.mechanics.plans.register.transaction.steps[0].trigger = {
    op: "predicate.exists",
    value: { op: "value.result", stepId: "previous" }
  };
  expectSemanticError(fixture, "MECHANICS_SCHEDULE_TRIGGER_CONTEXT_INVALID");
});

test("rejects a literal schedule id outside the runtime base64url contract", () => {
  const fixture = scheduleFixture();
  fixture.mechanics.plans.register.transaction.steps = [{
    id: "cancel",
    kind: "command",
    op: "system.schedule.cancel",
    scheduleId: { op: "value.literal", value: "too-short" }
  }];
  expectSemanticError(fixture, "MECHANICS_SYSTEM_SCHEDULE_ID_INVALID");
});

test("checks the replayed trigger plus system target against one static budget", () => {
  const fixture = scheduleFixture();
  fixture.mechanics.plans.resolve.transaction.steps = Array.from(
    { length: 512 },
    (_, index) => constantAssert(`assert-${index}`)
  );
  expectSemanticError(fixture, "MECHANICS_SCHEDULE_COMBINED_BUDGET_EXCEEDED");
});

test("allows read-only fields to receive their immutable value during entity creation", () => {
  assert.doesNotThrow(() => checkFixture(finalizeFixture(createFixture())));
});

test("keeps the same read-only field protected from later mutation", () => {
  const fixture = createFixture();
  fixture.mechanics.plans.create.transaction.steps = [{
    id: "mutate",
    kind: "command",
    op: "core.entity.attributes.patch",
    entity: {
      collection: "entities",
      entityId: { op: "value.literal", value: "entity-1" }
    },
    patches: [{
      path: ["network"],
      operation: "set",
      value: { op: "value.literal", value: "network-2" }
    }]
  }];
  expectSemanticError(fixture, "MECHANICS_FIELD_READ_ONLY");
});

test("allows a public per-participant endpoint with an explicit dynamic storage binding", () => {
  assert.doesNotThrow(() => checkFixture(finalizeFixture(dynamicBindingFixture())));
});

test("accepts strict turn endpoints that runtime materializes from the reusable player template", () => {
  const fixture = finalizeFixture(turnSessionFixture());
  assert.doesNotThrow(() => checkFixture(fixture, {
    initialState: { public: {}, playersTemplate: { metrics: {} } },
    turnSessionInitialization: {
      minimumPlayers: 2,
      maximumPlayers: 4,
      phases: ["begin", "finish"]
    }
  }));
});

test("rejects optional live-session turn fields instead of weakening the platform contract", () => {
  const fixture = turnSessionFixture();
  fixture.mechanics.stateModel.endpoints["public.turn.active"].valueType = "core.optional-string";
  assert.throws(
    () => checkFixture(finalizeFixture(fixture), {
      initialState: { public: {}, playersTemplate: { metrics: {} } },
      turnSessionInitialization: {
        minimumPlayers: 2,
        maximumPlayers: 4,
        phases: ["begin", "finish"]
      }
    }),
    (error) => error instanceof MechanicsSemanticError && error.code === "MECHANICS_TURN_ENDPOINT_OPTIONAL"
  );
});

test("rejects an authored turn value that conflicts with runtime session ownership", () => {
  const fixture = finalizeFixture(turnSessionFixture());
  assert.throws(
    () => checkFixture(fixture, {
      initialState: {
        public: {
          turn: {
            order: ["p1", "p2"],
            activePlayerId: "p1",
            turnNumber: 1,
            phase: "begin"
          }
        },
        playersTemplate: { metrics: {} }
      },
      turnSessionInitialization: {
        minimumPlayers: 2,
        maximumPlayers: 4,
        phases: ["begin", "finish"]
      }
    }),
    (error) => error instanceof MechanicsSemanticError && error.code === "MECHANICS_TURN_STATE_SOURCE_CONFLICT"
  );
});

test("rejects a turn declaration that cannot hold the maximum session size", () => {
  const fixture = turnSessionFixture();
  fixture.mechanics.stateModel.types["neutral.participant-order"].maxItems = 3;
  assert.throws(
    () => checkFixture(finalizeFixture(fixture), {
      initialState: { public: {}, playersTemplate: { metrics: {} } },
      turnSessionInitialization: {
        minimumPlayers: 2,
        maximumPlayers: 4,
        phases: ["begin", "finish"]
      }
    }),
    (error) => error instanceof MechanicsSemanticError && error.code === "MECHANICS_TURN_ENDPOINT_TYPE_MISMATCH"
  );
});

test("rejects secret data used as a public dynamic storage key", () => {
  const fixture = dynamicBindingFixture();
  fixture.mechanics.stateModel.endpoints.secretParticipant = {
    audienceRef: "server",
    storage: { root: "secret", segments: ["selectedParticipant"] },
    valueType: "core.string",
    access: "read-only"
  };
  fixture.mechanics.plans.add.transaction.steps[0].target.bindings.participantId = {
    op: "value.state",
    ref: { endpoint: "secretParticipant" }
  };
  expectSemanticError(fixture, "MECHANICS_INFORMATION_FLOW_VIOLATION");
});

test("accepts the exact neutral ranking result shape declared by state", () => {
  assert.doesNotThrow(() => checkFixture(finalizeFixture(rankingFixture())));
});

test("rejects a ranking sink that omits a runtime-owned required field", () => {
  const fixture = rankingFixture();
  delete fixture.mechanics.stateModel.types.rankingGroup.fields.tiedForFirst;
  expectSemanticError(fixture, "MECHANICS_EXPRESSION_TYPE_MISMATCH");
});
