/**
 * Neutral contract proof for bounded per-entity Mechanics execution.
 *
 * The fixture models generic primary and related objects. It proves canonical
 * iteration, trusted item identity, exact static multiplication, relation
 * composition and transaction rollback without importing any concrete game.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type {
  AssertStep,
  CubicaMechanicsIRV1Alpha1,
  EntitiesEachStep,
  GameManifestTransportNetworkModelMap,
  RelationAttachStep
} from "@cubica/contracts-manifest";

import {
  executeMechanicsTransaction,
  MechanicsExecutionError
} from "../src/modules/mechanics/index.ts";

const require = createRequire(import.meta.url);
const {
  recommendedModuleLockForOperations
} = require("../../../scripts/manifest-tools/mechanics-modules.cjs") as {
  recommendedModuleLockForOperations: (
    operations: Array<string>
  ) => CubicaMechanicsIRV1Alpha1["moduleLock"];
};
const {
  checkMechanicsBundle,
  MechanicsSemanticError
} = require("../../../scripts/manifest-tools/mechanics-checker.cjs") as {
  MechanicsSemanticError: new (...args: Array<unknown>) => Error & { code: string };
  checkMechanicsBundle: (
    mechanics: CubicaMechanicsIRV1Alpha1,
    options: { networkModels: GameManifestTransportNetworkModelMap }
  ) => {
    costs: Record<string, {
      steps: number;
      expressionNodes: number;
      algorithmWork: number;
      scannedEntities: number;
      resultEntities: number;
      writes: number;
    }>;
  };
};
const {
  validateMechanicsSchema
} = require("../../../scripts/manifest-tools/mechanics-validator.cjs") as {
  validateMechanicsSchema: (
    mechanics: unknown
  ) => { valid: boolean; errors: Array<unknown> };
};
const {
  mechanicsSha256
} = require("../../../scripts/manifest-tools/mechanics-canonicalize.cjs") as {
  mechanicsSha256: (value: unknown) => string;
};
const {
  lowerMechanicsAuthoring
} = require("../../../scripts/manifest-tools/authoring-compiler.cjs") as {
  lowerMechanicsAuthoring: (
    source: Record<string, unknown>,
    sourceFile: string
  ) => {
    mechanics: CubicaMechanicsIRV1Alpha1;
  };
};

const HASH = `sha256:${"0".repeat(64)}`;

const NETWORK_MODELS: GameManifestTransportNetworkModelMap = {
  main: {
    visibility: "public",
    nodeCollection: "nodes",
    edgeCollection: "edges",
    waypointObjectType: "fixture.node",
    edgeObjectType: "fixture.edge",
    nodeStateFacet: "availability",
    buildableNodeStates: ["open"],
    edgeStateFacet: "availability",
    splittableEdgeStates: ["open"],
    builtEdgeState: "open",
    sequenceEndpoint: "sequence",
    regions: [{
      id: "region",
      polygon: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 }
      ]
    }],
    movement: {
      vehicleCollection: "primaryObjects",
      vehicleObjectTypes: ["fixture.primary"],
      vehicleStateFacet: "availability",
      movableVehicleStates: ["active"],
      locationAttribute: "nodeId",
      traversableNodeStates: ["open"],
      traversableEdgeStates: ["open"],
      capacityCollection: "primaryObjects",
      capacityObjectTypes: ["fixture.primary"],
      capacityLocationAttribute: "nodeId",
      capacityStateFacet: "availability",
      capacityOccupyingStates: ["active"],
      maxVehiclesPerNode: 4,
      coupledCollection: "relatedObjects",
      coupledObjectTypes: ["fixture.related"],
      coupledStateFacet: "availability",
      couplableVehicleStates: ["active"],
      coupledVehicleAttribute: "attachedPrimaryId",
      coupledLocationAttribute: "nodeId",
      compatibleCouplings: [{
        vehicleObjectType: "fixture.primary",
        coupledObjectTypes: ["fixture.related"]
      }],
      maxCoupledVehicles: 4
    }
  }
};

function storedField(
  kind: "facet" | "attribute",
  name: string,
  valueType: string
) {
  return {
    storage: { kind, name },
    valueType,
    access: "read-write" as const
  };
}

function createMechanics(): CubicaMechanicsIRV1Alpha1 {
  const mechanics: CubicaMechanicsIRV1Alpha1 = {
    apiVersion: "cubica.dev/mechanics/v1alpha1",
    budgetProfile: "turn-based-standard-v1",
    moduleLock: recommendedModuleLockForOperations([
      "core.entities.select",
      "core.entities.order",
      "core.entities.each",
      "relation.attach",
      "core.assert"
    ]),
    stateModel: {
      types: {
        "core.string": { kind: "string" },
        "core.optional-string": { kind: "option", itemType: "core.string" },
        "core.integer": { kind: "integer", minimum: 0, maximum: 10_000 },
        "fixture.status": {
          kind: "enum",
          values: ["active", "open"]
        },
        "fixture.json": {
          kind: "json",
          maxDepth: 8,
          maxNodes: 128,
          maxUtf8Bytes: 4_096
        }
      },
      endpoints: {
        sequence: {
          audienceRef: "public",
          storage: { root: "public", segments: ["sequence"] },
          valueType: "core.integer",
          access: "read-write"
        }
      },
      collections: {
        nodes: {
          audienceRef: "public",
          storage: { root: "public", segments: ["nodes"] },
          capacity: 8,
          stableKey: "map-key",
          itemTypes: ["fixture.node"],
          fields: {
            availability: storedField("facet", "availability", "fixture.status"),
            networkId: storedField("attribute", "networkId", "core.string"),
            position: storedField("attribute", "position", "fixture.json")
          }
        },
        edges: {
          audienceRef: "public",
          storage: { root: "public", segments: ["edges"] },
          capacity: 8,
          stableKey: "map-key",
          itemTypes: ["fixture.edge"],
          fields: {
            availability: storedField("facet", "availability", "fixture.status"),
            networkId: storedField("attribute", "networkId", "core.string"),
            fromNodeId: storedField("attribute", "fromNodeId", "core.string"),
            toNodeId: storedField("attribute", "toNodeId", "core.string"),
            geometry: storedField("attribute", "geometry", "fixture.json")
          }
        },
        primaryObjects: {
          audienceRef: "public",
          storage: { root: "public", segments: ["primaryObjects"] },
          capacity: 4,
          stableKey: "map-key",
          itemTypes: ["fixture.primary"],
          fields: {
            availability: storedField("facet", "availability", "fixture.status"),
            networkId: storedField("attribute", "networkId", "core.string"),
            nodeId: storedField("attribute", "nodeId", "core.string")
          }
        },
        relatedObjects: {
          audienceRef: "public",
          storage: { root: "public", segments: ["relatedObjects"] },
          capacity: 4,
          stableKey: "map-key",
          itemTypes: ["fixture.related"],
          fields: {
            availability: storedField("facet", "availability", "fixture.status"),
            networkId: storedField("attribute", "networkId", "core.string"),
            nodeId: storedField("attribute", "nodeId", "core.string"),
            attachedPrimaryId: storedField(
              "attribute",
              "attachedPrimaryId",
              "core.optional-string"
            ),
            rank: storedField("attribute", "rank", "core.integer")
          }
        }
      },
      events: {}
    },
    plans: {
      attachAll: {
        planHash: HASH,
        transaction: {
          steps: [
            selectRelatedStep(),
            orderRelatedStep(),
            eachAttachStep(false)
          ]
        }
      },
      rollbackAll: {
        planHash: HASH,
        transaction: {
          steps: [
            selectRelatedStep(),
            orderRelatedStep(),
            eachAttachStep(true)
          ]
        }
      },
      isolateBodyResults: {
        planHash: HASH,
        transaction: {
          steps: [
            selectRelatedStep(),
            orderRelatedStep(),
            eachResultIsolationStep()
          ]
        }
      }
    }
  };
  return finalizePlanHashes(mechanics);
}

function selectRelatedStep(): CubicaMechanicsIRV1Alpha1["plans"][string]["transaction"]["steps"][number] {
  return {
    id: "selected",
    kind: "query",
    op: "core.entities.select",
    selector: {
      collection: "relatedObjects",
      objectTypes: ["fixture.related"],
      facets: {
        availability: { op: "value.literal", value: "active" }
      },
      cardinality: { min: 2, max: 2 }
    }
  };
}

function orderRelatedStep(): CubicaMechanicsIRV1Alpha1["plans"][string]["transaction"]["steps"][number] {
  return {
    id: "ordered",
    kind: "command",
    op: "core.entities.order",
    selection: { op: "value.result", stepId: "selected" },
    keys: [{
      source: { kind: "current-field", field: "rank" },
      direction: "descending",
      missing: "error"
    }],
    tieBreak: { kind: "canonical-id" }
  };
}

function eachAttachStep(
  rejectLast: boolean
): EntitiesEachStep {
  const attachOne: RelationAttachStep = {
    id: "attachOne",
    kind: "command" as const,
    op: "relation.attach" as const,
    networkId: "main",
    primary: { op: "value.literal" as const, value: "primary" },
    related: [{
      op: "value.item" as const,
      area: "identity" as const,
      field: "id" as const
    }]
  };
  const rejectOmega: AssertStep = {
    id: "rejectOmega",
    kind: "assert" as const,
    op: "core.assert" as const,
    predicate: {
      op: "predicate.compare" as const,
      operator: "ne" as const,
      left: {
        op: "value.item" as const,
        area: "identity" as const,
        field: "id" as const
      },
      right: { op: "value.literal" as const, value: "omega" }
    },
    errorCode: "FIXTURE_REJECTED"
  };
  return {
    id: "attachEach",
    kind: "command",
    op: "core.entities.each",
    selection: { op: "value.result", stepId: "ordered" },
    // Writing the two bounded tuple variants explicitly keeps this test
    // aligned with the generated 1..16 body contract.
    body: rejectLast ? [attachOne, rejectOmega] : [attachOne]
  };
}

function eachResultIsolationStep(): EntitiesEachStep {
  return {
    id: "isolateEach",
    kind: "command",
    op: "core.entities.each",
    selection: { op: "value.result", stepId: "ordered" },
    body: [
      {
        id: "conditionallySelectedPrimary",
        kind: "query",
        op: "core.entities.select",
        when: {
          op: "predicate.compare",
          operator: "eq",
          left: { op: "value.item", area: "identity", field: "id" },
          right: { op: "value.literal", value: "alpha" }
        },
        selector: {
          collection: "primaryObjects",
          cardinality: { min: 1, max: 1 }
        }
      },
      {
        id: "consumeCurrentIterationSelection",
        kind: "command",
        op: "core.entities.update",
        selection: {
          op: "value.result",
          stepId: "conditionallySelectedPrimary"
        },
        attributeValues: {
          nodeId: { op: "value.literal", value: "changed" }
        }
      }
    ]
  };
}

function finalizePlanHashes(
  mechanics: CubicaMechanicsIRV1Alpha1
): CubicaMechanicsIRV1Alpha1 {
  for (const [planId, plan] of Object.entries(mechanics.plans)) {
    plan.planHash = mechanicsSha256({
      apiVersion: mechanics.apiVersion,
      budgetProfile: mechanics.budgetProfile,
      moduleLock: mechanics.moduleLock,
      stateModel: mechanics.stateModel,
      objectModels: {},
      networkModels: NETWORK_MODELS,
      planId,
      transaction: plan.transaction
    });
  }
  return mechanics;
}

function createState() {
  return {
    public: {
      sequence: 0,
      nodes: {
        node: {
          objectType: "fixture.node",
          facets: { availability: "open" },
          attributes: {
            networkId: "main",
            position: { x: 0, y: 0 }
          }
        }
      },
      edges: {},
      primaryObjects: {
        primary: {
          objectType: "fixture.primary",
          facets: { availability: "active" },
          attributes: {
            networkId: "main",
            nodeId: "node"
          }
        }
      },
      // Reverse insertion and rank order prove that `each` does not inherit
      // either JavaScript object order or the preceding ordering result.
      relatedObjects: {
        omega: {
          objectType: "fixture.related",
          facets: { availability: "active" },
          attributes: {
            networkId: "main",
            nodeId: "node",
            attachedPrimaryId: null,
            rank: 2
          }
        },
        alpha: {
          objectType: "fixture.related",
          facets: { availability: "active" },
          attributes: {
            networkId: "main",
            nodeId: "node",
            attachedPrimaryId: null,
            rank: 1
          }
        }
      }
    }
  };
}

test("schema and checker admit bounded relation composition with exact multiplied cost", () => {
  const mechanics = createMechanics();
  const schema = validateMechanicsSchema(mechanics);
  assert.equal(schema.valid, true, JSON.stringify(schema.errors));

  const checked = checkMechanicsBundle(mechanics, {
    networkModels: NETWORK_MODELS
  });
  assert.deepEqual(
    {
      steps: checked.costs.attachAll.steps,
      expressionNodes: checked.costs.attachAll.expressionNodes,
      algorithmWork: checked.costs.attachAll.algorithmWork,
      scannedEntities: checked.costs.attachAll.scannedEntities,
      writes: checked.costs.attachAll.writes
    },
    {
      // Three top-level steps plus one body step for each of two entities.
      steps: 5,
      // One selector expression plus two body expressions multiplied by two.
      expressionNodes: 5,
      // Eight ordering units plus four canonical-iteration units.
      algorithmWork: 12,
      // Select/order scan four each; relation scans four twice.
      scannedEntities: 16,
      writes: 2
    }
  );
});

test("authoring derives body module dependencies instead of locking only the outer core step", () => {
  const published = createMechanics();
  const source = {
    apiVersion: published.apiVersion,
    budgetProfile: published.budgetProfile,
    stateModel: published.stateModel,
    plans: Object.fromEntries(
      Object.entries(published.plans).map(([planId, plan]) => [
        planId,
        { transaction: structuredClone(plan.transaction) }
      ])
    )
  };
  const lowered = lowerMechanicsAuthoring(
    source,
    "/virtual/neutral-each.authoring.json"
  );

  assert.ok(lowered.mechanics.moduleLock["cubica.core"]);
  assert.ok(lowered.mechanics.moduleLock["cubica.ordering"]);
  assert.ok(lowered.mechanics.moduleLock["cubica.relations"]);
});

test("runtime canonicalizes iteration and exposes only trusted item identity", () => {
  const mechanics = createMechanics();
  const original = createState();
  const output = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.attachAll,
    state: original,
    actorContext: { sessionRole: "player" },
    networkModels: NETWORK_MODELS
  });

  const related = (
    output.candidateState.public as {
      relatedObjects: Record<string, {
        attributes: { attachedPrimaryId: string | null };
      }>;
    }
  ).relatedObjects;
  assert.equal(related.alpha.attributes.attachedPrimaryId, "primary");
  assert.equal(related.omega.attributes.attachedPrimaryId, "primary");
  assert.deepEqual(output.result, {
    kind: "entities-each",
    collectionId: "relatedObjects",
    count: 2
  });
  const relationAudit = output.audit.filter(
    (entry) => entry.operation === "relation.attach"
  );
  assert.deepEqual(
    relationAudit.map((entry) => entry.stepId),
    [
      "attachEach[0].attachOne",
      "attachEach[1].attachOne"
    ]
  );
  assert.deepEqual(
    relationAudit.map((entry) =>
      (entry.result as { relatedIds: Array<string> }).relatedIds[0]),
    ["alpha", "omega"],
    "audit operation results must prove canonical entity-id order"
  );
});

test("failure in a later canonical iteration rolls back all earlier mutations", () => {
  const mechanics = createMechanics();
  const original = createState();

  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.rollbackAll,
      state: original,
      actorContext: { sessionRole: "player" },
      networkModels: NETWORK_MODELS
    }),
    (error: unknown) =>
      error instanceof MechanicsExecutionError &&
      error.code === "FIXTURE_REJECTED"
  );

  assert.equal(
    original.public.relatedObjects.alpha.attributes.attachedPrimaryId,
    null
  );
  assert.equal(
    original.public.relatedObjects.omega.attributes.attachedPrimaryId,
    null
  );
});

test("a skipped body producer cannot expose the previous iteration result", () => {
  const mechanics = createMechanics();
  assert.doesNotThrow(() =>
    checkMechanicsBundle(mechanics, { networkModels: NETWORK_MODELS }));
  const original = createState();

  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.isolateBodyResults,
      state: original,
      actorContext: { sessionRole: "player" },
      networkModels: NETWORK_MODELS
    }),
    (error: unknown) =>
      error instanceof MechanicsExecutionError &&
      error.code === "MECHANICS_RESULT_TYPE_MISMATCH"
  );

  // Alpha's first iteration did update the candidate, but omega receives the
  // current skipped sentinel rather than alpha's protected selection. The
  // resulting failure discards the whole candidate and leaves input untouched.
  assert.equal(
    original.public.primaryObjects.primary.attributes.nodeId,
    "node"
  );
});

test("nested iteration is schema-invalid and semantic traversal rejects it without recursion", () => {
  const mechanics = createMechanics();
  const each = mechanics.plans.attachAll.transaction.steps[2];
  assert.equal(each.op, "core.entities.each");
  if (each.op !== "core.entities.each") return;

  const nested = structuredClone(each);
  each.body = [nested as never];
  assert.equal(validateMechanicsSchema(mechanics).valid, false);
  assert.throws(
    () => checkMechanicsBundle(mechanics, { networkModels: NETWORK_MODELS }),
    (error: unknown) =>
      error instanceof MechanicsSemanticError &&
      error.code === "MECHANICS_EACH_NESTED"
  );

  // The schema body points to the non-iteration union, so a very deep value
  // below the rejected nested object is never recursively interpreted as Step.
  let deep: Record<string, unknown> = { terminal: true };
  for (let index = 0; index < 10_000; index += 1) deep = { child: deep };
  (nested as unknown as Record<string, unknown>).untrustedDepth = deep;
  assert.doesNotThrow(() => validateMechanicsSchema(mechanics));
  assert.equal(validateMechanicsSchema(mechanics).valid, false);
});

test("checker rejects conditional sources and multiplication above the selected budget", () => {
  const conditional = createMechanics();
  const conditionalSource = conditional.plans.attachAll.transaction.steps[1];
  assert.equal(conditionalSource.op, "core.entities.order");
  if (conditionalSource.op !== "core.entities.order") return;
  conditionalSource.when = {
    op: "predicate.constant",
    value: true
  };
  finalizePlanHashes(conditional);
  assert.throws(
    () => checkMechanicsBundle(conditional, { networkModels: NETWORK_MODELS }),
    (error: unknown) =>
      error instanceof MechanicsSemanticError &&
      error.code === "MECHANICS_EACH_SOURCE_CONDITIONAL"
  );

  const oversized = createMechanics();
  const related = oversized.stateModel.collections.relatedObjects;
  related.capacity = 4_096;
  const selected = oversized.plans.attachAll.transaction.steps[0];
  assert.equal(selected.op, "core.entities.select");
  if (selected.op !== "core.entities.select") return;
  selected.selector.cardinality.max = 4_096;
  const ordered = oversized.plans.attachAll.transaction.steps[1];
  assert.equal(ordered.op, "core.entities.order");
  if (ordered.op !== "core.entities.order") return;
  finalizePlanHashes(oversized);
  assert.throws(
    () => checkMechanicsBundle(oversized, { networkModels: NETWORK_MODELS }),
    (error: unknown) =>
      error instanceof MechanicsSemanticError &&
      error.code === "MECHANICS_STATIC_BUDGET_EXCEEDED"
  );
});
