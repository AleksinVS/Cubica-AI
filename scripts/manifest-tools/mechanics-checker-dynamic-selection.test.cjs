/**
 * Neutral publication proofs for the ADR-095 Mechanics contract extensions.
 *
 * The semantic checker is the publication boundary that connects JSON Schema
 * structure to typed step-result provenance. These fixtures therefore use the
 * real bundle checker and compiler-owned module locks/hashes instead of
 * imitating either rule with test-local validation.
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const { checkMechanicsBundle, MechanicsSemanticError } = require("./mechanics-checker.cjs");
const { mechanicsSha256 } = require("./mechanics-canonicalize.cjs");
const { recommendedModuleLockForOperations } = require("./mechanics-modules.cjs");
const { validateMechanicsSchema } = require("./mechanics-validator.cjs");

const API_VERSION = "cubica.dev/mechanics/v1alpha1";

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
      "core.json": {
        kind: "json",
        maxDepth: 8,
        maxNodes: 256,
        maxUtf8Bytes: 8192
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

function action(planRef) {
  return {
    invocation: "external",
    paramsSchema: emptyParamsSchema(),
    binding: { kind: "mechanics-plan", planRef }
  };
}

function plan(steps) {
  return { transaction: { steps } };
}

function entityCollection(rootSegment, fields, itemType = "neutral.object") {
  return {
    audienceRef: "public",
    storage: { root: "public", segments: [rootSegment] },
    capacity: 8,
    stableKey: "map-key",
    itemTypes: [itemType],
    fields
  };
}

function storedAttribute(name, valueType, access = "read-only") {
  return {
    storage: { kind: "attribute", name },
    valueType,
    access
  };
}

function selectStep(id, collection, cardinality, attributes = undefined) {
  return {
    id,
    kind: "query",
    op: "core.entities.select",
    selector: {
      collection,
      ...(attributes === undefined ? {} : { attributes }),
      cardinality
    }
  };
}

/**
 * Recompute all compiler-owned identities after each fixture mutation.
 *
 * This is important for negative semantic tests: they must reach the intended
 * checker rule rather than failing earlier on stale plan or action hashes.
 */
function finalizeFixture(fixture) {
  const operations = Object.values(fixture.mechanics.plans)
    .flatMap((candidate) => candidate.transaction.steps.map((step) => step.op));
  fixture.mechanics.moduleLock = recommendedModuleLockForOperations(operations);

  // networkModels is bound by digest, not by embedded value -- mirrors the
  // per-plan hash input computed in checkMechanicsBundle (mechanics-checker.cjs)
  // and in compileAuthoringText (authoring-compiler.cjs).
  const networkModelsHash = mechanicsSha256(fixture.networkModels || {});
  for (const [planId, candidate] of Object.entries(fixture.mechanics.plans)) {
    candidate.planHash = mechanicsSha256({
      apiVersion: fixture.mechanics.apiVersion,
      budgetProfile: fixture.mechanics.budgetProfile,
      moduleLock: fixture.mechanics.moduleLock,
      stateModel: fixture.mechanics.stateModel,
      objectModels: fixture.objectModels || {},
      networkModelsHash,
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

function checkFixture(fixture) {
  return checkMechanicsBundle(fixture.mechanics, {
    actions: fixture.actions,
    objectModels: fixture.objectModels || {},
    networkModels: fixture.networkModels || {}
  });
}

function expectSemanticError(fixture, code) {
  assert.throws(
    () => checkFixture(finalizeFixture(fixture)),
    (error) => error instanceof MechanicsSemanticError && error.code === code
  );
}

function graphFixture() {
  const stateModel = baseStateModel();
  stateModel.collections.nodes = entityCollection(
    "nodes",
    {
      networkId: storedAttribute("networkId", "core.string"),
      position: storedAttribute("position", "core.json")
    },
    "neutral.node"
  );
  stateModel.collections.edges = entityCollection(
    "edges",
    {
      networkId: storedAttribute("networkId", "core.string"),
      fromNodeId: storedAttribute("fromNodeId", "core.string"),
      toNodeId: storedAttribute("toNodeId", "core.string"),
      geometry: storedAttribute("geometry", "core.json")
    },
    "neutral.edge"
  );
  stateModel.endpoints.sequence = {
    audienceRef: "public",
    storage: { root: "public", segments: ["sequence"] },
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
        inspect: plan([
          {
            id: "path",
            kind: "algorithm",
            op: "graph.shortestPath",
            networkId: "neutral-network",
            fromNode: { op: "value.literal", value: "node-a" },
            toNode: { op: "value.literal", value: "node-b" },
            onUnavailable: "return-unreachable"
          },
          {
            id: "assert-reachability-is-typed",
            kind: "assert",
            op: "core.assert",
            predicate: {
              op: "predicate.compare",
              operator: "eq",
              left: { op: "value.result", stepId: "path", path: ["reachable"] },
              right: { op: "value.literal", value: true }
            },
            errorCode: "NEUTRAL_PATH_NOT_REACHABLE"
          }
        ])
      }
    },
    actions: { inspect: action("inspect") },
    networkModels: {
      "neutral-network": {
        visibility: "public",
        nodeCollection: "nodes",
        edgeCollection: "edges",
        waypointObjectType: "neutral.node",
        edgeObjectType: "neutral.edge",
        nodeStateFacet: "state",
        buildableNodeStates: ["open"],
        edgeStateFacet: "state",
        splittableEdgeStates: ["open"],
        builtEdgeState: "open",
        sequenceEndpoint: "sequence",
        regions: [{
          id: "neutral-region",
          polygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 0, y: 10 }
          ]
        }]
      }
    }
  };
}

function dynamicRankingFixture() {
  const stateModel = baseStateModel();
  stateModel.collections.objects = entityCollection("objects", {
    base: storedAttribute("base", "core.integer"),
    category: storedAttribute("category", "core.string")
  });
  stateModel.collections.alternateObjects = entityCollection(
    "alternate-objects",
    {
      base: storedAttribute("base", "core.integer"),
      category: storedAttribute("category", "core.string")
    },
    "neutral.alternate"
  );

  const categoryEquals = (value) => ({
    category: { op: "value.literal", value }
  });

  return {
    mechanics: {
      apiVersion: API_VERSION,
      budgetProfile: "turn-based-standard-v1",
      moduleLock: {},
      stateModel,
      plans: {
        rank: plan([
          selectStep("all", "objects", { min: 0, max: 8 }),
          selectStep("first-group", "objects", { min: 0, max: 4 }, categoryEquals("first")),
          selectStep("second-group", "objects", { min: 0, max: 4 }, categoryEquals("second")),
          {
            id: "scores",
            kind: "query",
            op: "core.entities.score",
            selection: { op: "value.result", stepId: "all" },
            baseField: "base",
            relatedSources: []
          },
          {
            id: "ranking",
            kind: "algorithm",
            op: "core.ranking.stable",
            scores: { op: "value.result", stepId: "scores" },
            groups: [
              {
                id: "first",
                selection: { op: "value.result", stepId: "first-group" }
              },
              {
                id: "second",
                selection: { op: "value.result", stepId: "second-group" }
              }
            ]
          }
        ])
      }
    },
    actions: { rank: action("rank") }
  };
}

test("soft shortest path publishes a typed boolean reachability result", () => {
  assert.doesNotThrow(() => checkFixture(finalizeFixture(graphFixture())));
});

test("dynamic scoring and two same-collection ranking groups pass publication", () => {
  assert.doesNotThrow(() => checkFixture(finalizeFixture(dynamicRankingFixture())));
});

test("dynamic scoring rejects a conditional source selection", () => {
  const fixture = dynamicRankingFixture();
  fixture.mechanics.plans.rank.transaction.steps[0].when = {
    op: "predicate.constant",
    value: true
  };
  expectSemanticError(fixture, "MECHANICS_SCORE_SOURCE_CONDITIONAL");
});

test("dynamic ranking rejects a selection from another collection", () => {
  const fixture = dynamicRankingFixture();
  fixture.mechanics.plans.rank.transaction.steps.splice(
    3,
    0,
    selectStep("alternate-group", "alternateObjects", { min: 0, max: 4 })
  );
  const ranking = fixture.mechanics.plans.rank.transaction.steps.at(-1);
  ranking.groups[1].selection.stepId = "alternate-group";
  expectSemanticError(fixture, "MECHANICS_RANKING_SELECTION_COLLECTION_MISMATCH");
});

test("score source schema requires exactly one static or dynamic source", () => {
  const validFixture = finalizeFixture(dynamicRankingFixture());
  assert.equal(validateMechanicsSchema(validFixture.mechanics).valid, true);

  const invalidFixture = dynamicRankingFixture();
  const score = invalidFixture.mechanics.plans.rank.transaction.steps
    .find((step) => step.op === "core.entities.score");
  score.entities = { endpoint: "neutral-records" };
  score.entityIds = [{ op: "value.literal", value: "object-a" }];
  finalizeFixture(invalidFixture);

  assert.equal(validateMechanicsSchema(invalidFixture.mechanics).valid, false);
});
