/**
 * Neutral contract proof for the typed Mechanics transaction executor.
 *
 * The fixture uses generic counters and entities so the test demonstrates a
 * reusable platform capability, not behavior coupled to one published game.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type {
  CubicaMechanicsIRV1Alpha1,
  GameManifestObjectModelMap,
  GameManifestTransportNetworkModelMap,
  JsonValue,
  StatePatchStep
} from "@cubica/contracts-manifest";

import {
  executeMechanicsTransaction,
  MechanicsExecutionError
} from "../src/modules/mechanics/index.ts";
import { RUNTIME_BUDGETS } from "../src/modules/mechanics/budget.ts";
import {
  initializeCollectionField,
  readCollectionField,
  writeCollectionField
} from "../src/modules/mechanics/stateModel.ts";
import { createSessionRandomStreamsState } from "../src/modules/runtime/sessionRandom.ts";

const require = createRequire(import.meta.url);
const {
  MAX_SESSION_RANDOM_STREAMS,
  hashMechanicsCorpus,
  hashModuleArtifact,
  recommendedModuleLock,
  recommendedModuleLockForOperations
} = require("../../../scripts/manifest-tools/mechanics-modules.cjs") as {
  MAX_SESSION_RANDOM_STREAMS: number;
  hashMechanicsCorpus: (entries: Array<{ name: string; bytes: Uint8Array | string }>) => string;
  hashModuleArtifact: (descriptor: Record<string, unknown>, executionCorpusHash: string) => string;
  recommendedModuleLock: (moduleIds: Array<string>) => CubicaMechanicsIRV1Alpha1["moduleLock"];
  recommendedModuleLockForOperations: (operations: Array<string>) => CubicaMechanicsIRV1Alpha1["moduleLock"];
};
const { validateMechanicsSchema } = require("../../../scripts/manifest-tools/mechanics-validator.cjs") as {
  validateMechanicsSchema: (value: unknown) => { valid: boolean; errors: Array<unknown> };
};
const {
  BUDGET_PROFILES,
  checkMechanicsBundle,
  MechanicsSemanticError
} = require("../../../scripts/manifest-tools/mechanics-checker.cjs") as {
  BUDGET_PROFILES: Record<string, Record<string, number>>;
  MechanicsSemanticError: new (...args: Array<any>) => Error & { code: string };
  checkMechanicsBundle: (value: unknown, options?: {
    actions?: Record<string, unknown>;
    initialState?: Record<string, unknown>;
    objectModels?: GameManifestObjectModelMap;
    networkModels?: GameManifestTransportNetworkModelMap;
  }) => unknown;
};
const { mechanicsSha256 } = require("../../../scripts/manifest-tools/mechanics-canonicalize.cjs") as {
  mechanicsSha256: (value: unknown) => string;
};

const HASH = `sha256:${"0".repeat(64)}`;

test("publication and runtime share the same resource profile boundaries", () => {
  for (const profileId of ["turn-based-standard-v1", "turn-based-large-v1"]) {
    const publication = BUDGET_PROFILES[profileId];
    const runtime = RUNTIME_BUDGETS[profileId];
    assert.equal(publication.maxInputParamsBytes, runtime.maxInputParamsBytes);
    assert.equal(publication.maxIntermediateBytes, runtime.intermediateBytes);
    assert.equal(publication.maxCandidateStateBytes, runtime.maxCandidateStateBytes);
    assert.equal(publication.maxSingleEventBytes, runtime.maxSingleEventBytes);
    assert.equal(publication.maxEventBytes, runtime.eventBytes);
    assert.equal(publication.maxAuditBytes, runtime.auditBytes);
    assert.equal(publication.maxJsonDepth, runtime.maxJsonDepth);
    assert.equal(publication.maxJsonNodes, runtime.maxJsonNodes);
    assert.equal(publication.maxInputParamNodes, runtime.maxInputParamNodes);
    assert.equal(publication.maxCandidateStateNodes, runtime.maxCandidateStateNodes);
    assert.equal(publication.maxEventNodes, runtime.maxEventNodes);
    assert.equal(publication.maxStringUtf8Bytes, runtime.maxStringUtf8Bytes);
  }
});

const createMechanics = (): CubicaMechanicsIRV1Alpha1 => finalizePlanHashes({
  apiVersion: "cubica.dev/mechanics/v1alpha1",
  budgetProfile: "turn-based-standard-v1",
  moduleLock: recommendedModuleLock(["cubica.core"]),
  stateModel: {
    types: {
      "core.boolean": { kind: "boolean" },
      "core.integer": { kind: "integer", minimum: -1_000, maximum: 1_000 },
      "core.string": { kind: "string" },
      "fixture.ids": { kind: "list", itemType: "core.string", maxItems: 32 },
      "fixture.eventPayload": {
        kind: "record",
        fields: { updatedIds: { typeRef: "fixture.ids", optional: false } }
      },
      "fixture.json": {
        kind: "json",
        maxDepth: 16,
        maxNodes: 4_096,
        maxUtf8Bytes: 256 * 1_024
      },
      "fixture.journalEntry": {
        kind: "record",
        fields: {
          eventType: { typeRef: "core.string", optional: false },
          audience: { typeRef: "core.string", optional: false },
          summary: { typeRef: "core.string", optional: false },
          data: { typeRef: "fixture.json", optional: false }
        }
      },
      "fixture.journal": { kind: "list", itemType: "fixture.journalEntry", maxItems: 32 }
    },
    endpoints: {
      counter: {
        audienceRef: "public",
        storage: { root: "public", segments: ["counter"] },
        valueType: "core.integer",
        access: "read-write"
      },
      journal: {
        audienceRef: "public",
        storage: { root: "public", segments: ["journal"] },
        valueType: "fixture.journal",
        access: "read-write"
      }
    },
    collections: {
      pieces: {
        audienceRef: "public",
        storage: { root: "public", segments: ["pieces"] },
        capacity: 32,
        stableKey: "map-key",
        itemTypes: ["fixture.piece"],
        fields: {
          active: {
            storage: { kind: "facet", name: "active" },
            valueType: "core.boolean",
            access: "read-write"
          },
          score: {
            storage: { kind: "attribute", name: "score" },
            valueType: "core.integer",
            access: "read-write"
          }
        }
      }
    },
    events: {
      "fixture.updated": {
        audienceRef: "public",
        payloadType: "fixture.eventPayload",
        journalEndpoint: { endpoint: "journal" }
      }
    }
  },
  plans: {
    updateActive: {
      planHash: HASH,
      transaction: {
        steps: [
          {
            id: "activePieces",
            kind: "query",
            op: "core.entities.select",
            selector: {
              collection: "pieces",
              facets: { active: { op: "value.literal", value: true } },
              cardinality: { min: 1, max: 32 }
            }
          },
          {
            id: "increaseScores",
            kind: "command",
            op: "core.entities.update",
            selection: { op: "value.result", stepId: "activePieces" },
            attributeValues: {
              score: {
                op: "number.add",
                items: [
                  { op: "value.item", area: "attribute", field: "score" },
                  { op: "value.literal", value: 1 }
                ]
              }
            }
          },
          {
            id: "publishEvent",
            kind: "command",
            op: "core.event.emit",
            eventType: "fixture.updated",
            audience: "public",
            summary: { op: "value.literal", value: "Active pieces updated" },
            data: {
              updatedIds: { op: "value.result", stepId: "activePieces", path: ["ids"] }
            }
          }
        ]
      }
    },
    rollback: {
      planHash: HASH,
      transaction: {
        steps: [
          {
            id: "incrementCandidate",
            kind: "command",
            op: "core.number.add",
            target: { endpoint: "counter" },
            delta: { op: "value.literal", value: 1 }
          },
          {
            id: "rejectCandidate",
            kind: "assert",
            op: "core.assert",
            predicate: { op: "predicate.constant", value: false },
            errorCode: "FIXTURE_PRECONDITION_FAILED"
          }
        ]
      }
    }
  }
});

/** Mirror the compiler-owned plan identity for this in-memory neutral fixture. */
function finalizePlanHashes(
  mechanics: CubicaMechanicsIRV1Alpha1,
  models: {
    objectModels?: GameManifestObjectModelMap;
    networkModels?: GameManifestTransportNetworkModelMap;
  } = {}
): CubicaMechanicsIRV1Alpha1 {
  for (const [planId, plan] of Object.entries(mechanics.plans)) {
    plan.planHash = mechanicsSha256({
      apiVersion: mechanics.apiVersion,
      budgetProfile: mechanics.budgetProfile,
      moduleLock: mechanics.moduleLock,
      stateModel: mechanics.stateModel,
      objectModels: models.objectModels || {},
      networkModels: models.networkModels || {},
      planId,
      transaction: plan.transaction
    });
  }
  return mechanics;
}

const isSemanticError = (error: unknown, code: string): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === code;

test("publication rejects aggregate named random streams beyond runtime capacity", () => {
  const mechanics = createMechanics();
  mechanics.moduleLock = recommendedModuleLock(["cubica.core", "cubica.deck"]);

  // Five small neutral plans prove that the bound covers the union across
  // actions, not merely the per-plan step limit. The checker rejects the first
  // stream that runtime could not persist in its shared session counter map.
  const stepsPerPlan = 512;
  const streamCount = MAX_SESSION_RANDOM_STREAMS + 1;
  for (let planIndex = 0; planIndex < Math.ceil(streamCount / stepsPerPlan); planIndex += 1) {
    const firstStreamIndex = planIndex * stepsPerPlan;
    const planSteps = Array.from(
      { length: Math.min(stepsPerPlan, streamCount - firstStreamIndex) },
      (_, localIndex) => {
        const streamIndex = firstStreamIndex + localIndex;
        return {
          id: `shuffle-${streamIndex}`,
          kind: "command" as const,
          op: "deck.shuffle" as const,
          deckId: `deck-${streamIndex}`,
          sourceCollection: "pieces",
          stream: `stream-${streamIndex}`
        };
      }
    );
    const [firstStep, ...remainingSteps] = planSteps;
    assert.ok(firstStep, "every generated random-stream plan must contain a step");
    mechanics.plans[`random-streams-${planIndex}`] = {
      planHash: HASH,
      transaction: { steps: [firstStep, ...remainingSteps] }
    };
  }
  finalizePlanHashes(mechanics);

  assert.throws(
    () => checkMechanicsBundle(mechanics),
    (error) => isSemanticError(error, "MECHANICS_RANDOM_STREAM_LIMIT_EXCEEDED")
  );
});

const createState = () => ({
  public: {
    counter: 4,
    journal: [],
    pieces: {
      zeta: { objectType: "fixture.piece", facets: { active: true }, attributes: { score: 9 } },
      alpha: { objectType: "fixture.piece", facets: { active: true }, attributes: { score: 2 } },
      middle: { objectType: "fixture.piece", facets: { active: false }, attributes: { score: 5 } }
    }
  },
  secret: {}
});

/**
 * Extend the neutral entity fixture with scalar and structural typed sets.
 *
 * This proves the generic patch contract without borrowing names or rules from
 * the game that first required independent closure reasons.
 */
function createSetAddMechanics(): CubicaMechanicsIRV1Alpha1 {
  const mechanics = createMechanics();
  Object.assign(mechanics.stateModel.types, {
    "fixture.tag": {
      kind: "enum",
      values: ["alpha", "beta", "gamma", "delta"]
    },
    "fixture.tags": {
      kind: "set",
      itemType: "fixture.tag",
      maxItems: 3
    },
    "fixture.marker": {
      kind: "record",
      fields: {
        label: { typeRef: "core.string", optional: false },
        active: { typeRef: "core.boolean", optional: false }
      }
    },
    "fixture.markers": {
      kind: "set",
      itemType: "fixture.marker",
      maxItems: 1
    }
  });
  Object.assign(mechanics.stateModel.collections.pieces.fields, {
    tags: {
      storage: { kind: "attribute", name: "tags" },
      valueType: "fixture.tags",
      access: "read-write"
    },
    markers: {
      storage: { kind: "attribute", name: "markers" },
      valueType: "fixture.markers",
      access: "read-write"
    }
  });
  mechanics.plans.addTag = {
    planHash: HASH,
    transaction: {
      steps: [{
        id: "add-tag",
        kind: "command",
        op: "core.entity.attributes.patch",
        entity: {
          collection: "pieces",
          entityId: { op: "value.literal", value: "alpha" }
        },
        patches: [{
          operation: "set-add",
          path: ["tags"],
          value: { op: "value.literal", value: "gamma" }
        }]
      }]
    }
  };
  mechanics.plans.addMarker = {
    planHash: HASH,
    transaction: {
      steps: [{
        id: "add-marker",
        kind: "command",
        op: "core.entity.attributes.patch",
        entity: {
          collection: "pieces",
          entityId: { op: "value.literal", value: "alpha" }
        },
        patches: [{
          operation: "set-add",
          path: ["markers"],
          // Reversed property insertion order proves that equality follows the
          // canonical typed-set identity, not object construction history.
          value: {
            op: "value.literal",
            value: { active: true, label: "same" }
          }
        }]
      }]
    }
  };
  mechanics.plans.rollbackTag = {
    planHash: HASH,
    transaction: {
      steps: [
        structuredClone(mechanics.plans.addTag.transaction.steps[0]),
        {
          id: "reject-tag",
          kind: "assert",
          op: "core.assert",
          predicate: { op: "predicate.constant", value: false },
          errorCode: "FIXTURE_SET_ADD_ROLLBACK"
        }
      ]
    }
  };
  return finalizePlanHashes(mechanics);
}

function createSetAddState(options: {
  tags?: Array<string>;
  markers?: Array<{ label: string; active: boolean }>;
} = {}) {
  const state = createState();
  const attributes = state.public.pieces.alpha.attributes as Record<string, unknown>;
  attributes.tags = options.tags ?? [];
  attributes.markers = options.markers ?? [];
  return state;
}

test("schema-valid generic query, update, event and journal execute on one candidate clone", () => {
  const mechanics = createMechanics();
  const schemaResult = validateMechanicsSchema(mechanics);
  assert.equal(schemaResult.valid, true, JSON.stringify(schemaResult.errors));
  assert.doesNotThrow(() => checkMechanicsBundle(mechanics));

  const original = createState();
  const output = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.updateActive,
    state: original,
    actorContext: { sessionRole: "player" }
  });

  assert.deepEqual(original, createState(), "the authoritative input snapshot must stay immutable");
  const pieces = (output.candidateState.public as typeof original.public).pieces;
  assert.equal(pieces.alpha.attributes.score, 3);
  assert.equal(pieces.middle.attributes.score, 5);
  assert.equal(pieces.zeta.attributes.score, 10);
  assert.deepEqual(output.events, [{
    eventType: "fixture.updated",
    audience: "public",
    summary: "Active pieces updated",
    data: { updatedIds: ["alpha", "zeta"] }
  }]);
  assert.deepEqual((output.candidateState.public as typeof original.public).journal, [{
    eventType: "fixture.updated",
    audience: "public",
    summary: "Active pieces updated",
    data: { updatedIds: ["alpha", "zeta"] }
  }]);
});

/**
 * ADR-092 neutral fixture: adds two public metric endpoints, declares an
 * optional `metricChanges` field on the journal entry record, and provides one
 * plan that changes a metric and emits a public journal event plus one plan that
 * emits a server-only event. No published game name or rule leaks into this
 * platform contract proof.
 */
function createMetricAuditMechanics(): CubicaMechanicsIRV1Alpha1 {
  const mechanics = createMechanics();
  Object.assign(mechanics.stateModel.endpoints, {
    "public.metrics.alpha": {
      audienceRef: "public",
      storage: { root: "public", segments: ["metrics", "alpha"] },
      valueType: "core.integer",
      access: "read-write"
    },
    "public.metrics.beta": {
      audienceRef: "public",
      storage: { root: "public", segments: ["metrics", "beta"] },
      valueType: "core.integer",
      access: "read-write"
    }
  });
  // The stored journal entry is a closed record; declaring the optional
  // metricChanges field is exactly the additive change ADR-092 needs in a game.
  (mechanics.stateModel.types["fixture.journalEntry"] as { fields: Record<string, unknown> }).fields
    .metricChanges = { typeRef: "fixture.json", optional: true };
  Object.assign(mechanics.stateModel.events, {
    "fixture.server-note": {
      audienceRef: "server",
      payloadType: "fixture.eventPayload"
    }
  });
  mechanics.plans.bumpAndPublish = {
    planHash: HASH,
    transaction: {
      steps: [
        {
          id: "bumpAlpha",
          kind: "command",
          op: "core.number.add",
          target: { endpoint: "public.metrics.alpha" },
          delta: { op: "value.literal", value: 3 }
        },
        {
          // A conditional step whose predicate is false is skipped, proving the
          // snapshot reflects the applied candidate state, not authored deltas.
          id: "bumpAlphaSkipped",
          kind: "command",
          op: "core.number.add",
          target: { endpoint: "public.metrics.alpha" },
          delta: { op: "value.literal", value: 10 },
          when: {
            op: "predicate.compare",
            operator: "eq",
            left: { op: "value.literal", value: 1 },
            right: { op: "value.literal", value: 2 }
          }
        },
        {
          id: "publishEvent",
          kind: "command",
          op: "core.event.emit",
          eventType: "fixture.updated",
          audience: "public",
          summary: { op: "value.literal", value: "metrics changed" },
          data: { updatedIds: { op: "value.literal", value: [] } }
        }
      ]
    }
  };
  mechanics.plans.bumpAndPublishServer = {
    planHash: HASH,
    transaction: {
      steps: [
        {
          id: "bumpAlpha",
          kind: "command",
          op: "core.number.add",
          target: { endpoint: "public.metrics.alpha" },
          delta: { op: "value.literal", value: 3 }
        },
        {
          id: "publishServer",
          kind: "command",
          op: "core.event.emit",
          eventType: "fixture.server-note",
          audience: "server",
          summary: { op: "value.literal", value: "server only" },
          data: { updatedIds: { op: "value.literal", value: [] } }
        }
      ]
    }
  };
  return finalizePlanHashes(mechanics);
}

const createMetricState = () => {
  const state = createState() as { public: Record<string, unknown>; secret: Record<string, unknown> };
  state.public.metrics = { alpha: 4, beta: 20 };
  return state;
};

const NEUTRAL_PUBLIC_METRICS = [
  { metricId: "alpha", statePath: "public.metrics.alpha" },
  { metricId: "beta", statePath: "public.metrics.beta" }
];

test("ADR-092 attaches whole-transaction public metric deltas to public events and journal entries", () => {
  const mechanics = createMetricAuditMechanics();
  const output = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.bumpAndPublish,
    state: createMetricState(),
    actorContext: { sessionRole: "player" },
    publicMetrics: NEUTRAL_PUBLIC_METRICS
  });

  const expectedChanges = [
    { metricId: "alpha", before: 4, after: 7 },
    { metricId: "beta", before: 20, after: 20 }
  ];
  // The skipped +10 is not applied, so `after` is 7, not 17: the block reflects
  // the actually committed state (ADR-092), not the sum of authored deltas.
  assert.equal((output.candidateState.public as { metrics: { alpha: number } }).metrics.alpha, 7);
  assert.deepEqual(output.events[0].metricChanges, expectedChanges);
  const journal = (output.candidateState.public as { journal: Array<Record<string, unknown>> }).journal;
  assert.deepEqual(journal[0].metricChanges, expectedChanges);
});

test("ADR-092 omits metric deltas when the game declares no public metric catalog", () => {
  const mechanics = createMetricAuditMechanics();
  const output = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.bumpAndPublish,
    state: createMetricState(),
    actorContext: { sessionRole: "player" }
    // No publicMetrics: the game has no public metric catalog.
  });

  assert.equal(output.events[0].metricChanges, undefined);
  const journal = (output.candidateState.public as { journal: Array<Record<string, unknown>> }).journal;
  assert.equal("metricChanges" in journal[0], false);
});

test("ADR-092 does not enrich non-public events even with a public metric catalog", () => {
  const mechanics = createMetricAuditMechanics();
  const output = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.bumpAndPublishServer,
    state: createMetricState(),
    actorContext: { sessionRole: "player" },
    publicMetrics: NEUTRAL_PUBLIC_METRICS
  });

  assert.equal(output.events[0].audience, "server");
  assert.equal(output.events[0].metricChanges, undefined);
});

test("system schedule operations emit only protected atomic mutations", () => {
  const mechanics = createMechanics();
  mechanics.moduleLock = recommendedModuleLock(["cubica.core", "cubica.system"]);
  mechanics.plans.scheduleLifecycle = {
    planHash: HASH,
    transaction: {
      steps: [
        {
          id: "registerSchedule",
          kind: "command",
          op: "system.schedule.register",
          actionId: "fixture.system",
          params: {
            count: { op: "value.literal", value: 2 },
            enabled: { op: "value.literal", value: true }
          },
          trigger: { op: "predicate.constant", value: true },
          falsePolicy: "defer",
          maxOccurrences: 3
        },
        {
          id: "cancelSchedule",
          kind: "command",
          op: "system.schedule.cancel",
          scheduleId: {
            op: "value.result",
            stepId: "registerSchedule",
            path: ["scheduleId"]
          }
        }
      ]
    }
  };
  finalizePlanHashes(mechanics);
  const schemaResult = validateMechanicsSchema(mechanics);
  assert.equal(schemaResult.valid, true, JSON.stringify(schemaResult.errors));
  const original = createState();

  const output = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.scheduleLifecycle,
    state: original,
    actorContext: { sessionRole: "player" },
    createScheduleId: () => "ABCDEFGHIJKLMNOPQRSTUV"
  });

  assert.deepEqual(output.candidateState, original);
  assert.deepEqual(output.systemScheduleMutations, [
    {
      kind: "register",
      scheduleId: "ABCDEFGHIJKLMNOPQRSTUV",
      actionId: "fixture.system",
      params: { count: 2, enabled: true },
      trigger: { op: "predicate.constant", value: true },
      falsePolicy: "defer",
      maxOccurrences: 3
    },
    { kind: "cancel", scheduleId: "ABCDEFGHIJKLMNOPQRSTUV" }
  ]);
  assert.equal(output.cost.writes, 2);
  assert.deepEqual(output.audit.map(({ operation }) => operation), [
    "system.schedule.register",
    "system.schedule.cancel"
  ]);
});

test("a later failed assertion discards all earlier candidate writes", () => {
  const mechanics = createMechanics();
  const original = createState();

  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.rollback,
      state: original,
      actorContext: { sessionRole: "player" }
    }),
    (error) => error instanceof MechanicsExecutionError &&
      error.code === "FIXTURE_PRECONDITION_FAILED" && error.stepId === "rejectCandidate"
  );
  assert.deepEqual(original, createState());
});

test("set-add appends one typed member and charges the members actually scanned", () => {
  const mechanics = createSetAddMechanics();
  const schema = validateMechanicsSchema(mechanics);
  assert.equal(schema.valid, true, JSON.stringify(schema.errors));
  const original = createSetAddState({ tags: ["alpha", "beta"] });

  const output = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.addTag,
    state: original,
    actorContext: { sessionRole: "player" }
  });

  const attributes = (
    output.candidateState.public as {
      pieces: { alpha: { attributes: Record<string, unknown> } };
    }
  ).pieces.alpha.attributes;
  assert.deepEqual(attributes.tags, ["alpha", "beta", "gamma"]);
  assert.equal(output.cost.algorithmWork, 2);
  assert.equal(output.cost.writes, 1);
  assert.deepEqual(
    (original.public.pieces.alpha.attributes as Record<string, unknown>).tags,
    ["alpha", "beta"],
    "the authoritative input snapshot remains unchanged"
  );
});

test("duplicate set-add succeeds at full capacity and stops at the matching member", () => {
  const mechanics = createSetAddMechanics();
  const patch = mechanics.plans.addTag.transaction.steps[0];
  assert.equal(patch.op, "core.entity.attributes.patch");
  if (patch.op !== "core.entity.attributes.patch") return;
  const addition = patch.patches[0];
  assert.notEqual(addition.operation, "remove");
  if (addition.operation === "remove") return;
  addition.value = { op: "value.literal", value: "beta" };
  finalizePlanHashes(mechanics);
  const original = createSetAddState({ tags: ["alpha", "beta", "gamma"] });

  const output = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.addTag,
    state: original,
    actorContext: { sessionRole: "player" }
  });

  const attributes = (
    output.candidateState.public as {
      pieces: { alpha: { attributes: Record<string, unknown> } };
    }
  ).pieces.alpha.attributes;
  assert.deepEqual(attributes.tags, ["alpha", "beta", "gamma"]);
  assert.equal(output.cost.algorithmWork, 2);
  assert.equal(output.cost.writes, 1);
});

test("canonical structural duplicate is a no-op even when its set is full", () => {
  const mechanics = createSetAddMechanics();
  const original = createSetAddState({
    markers: [{ label: "same", active: true }]
  });

  const output = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.addMarker,
    state: original,
    actorContext: { sessionRole: "player" }
  });

  const attributes = (
    output.candidateState.public as {
      pieces: { alpha: { attributes: Record<string, unknown> } };
    }
  ).pieces.alpha.attributes;
  assert.deepEqual(attributes.markers, [{ label: "same", active: true }]);
  assert.equal(output.cost.algorithmWork, 1);
});

test("set-add rejects a distinct member at capacity without mutating input", () => {
  const mechanics = createSetAddMechanics();
  const patch = mechanics.plans.addTag.transaction.steps[0];
  assert.equal(patch.op, "core.entity.attributes.patch");
  if (patch.op !== "core.entity.attributes.patch") return;
  const addition = patch.patches[0];
  assert.notEqual(addition.operation, "remove");
  if (addition.operation === "remove") return;
  addition.value = { op: "value.literal", value: "delta" };
  finalizePlanHashes(mechanics);
  const original = createSetAddState({ tags: ["alpha", "beta", "gamma"] });
  const before = structuredClone(original);

  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.addTag,
      state: original,
      actorContext: { sessionRole: "player" }
    }),
    (error) =>
      error instanceof MechanicsExecutionError &&
      error.code === "MECHANICS_SET_CAPACITY_EXCEEDED"
  );
  assert.deepEqual(original, before);
});

test("set-add validates a runtime element before retaining it", () => {
  const mechanics = createSetAddMechanics();
  const patch = mechanics.plans.addTag.transaction.steps[0];
  assert.equal(patch.op, "core.entity.attributes.patch");
  if (patch.op !== "core.entity.attributes.patch") return;
  const addition = patch.patches[0];
  assert.notEqual(addition.operation, "remove");
  if (addition.operation === "remove") return;
  addition.value = { op: "value.literal", value: 42 };
  finalizePlanHashes(mechanics);
  const original = createSetAddState();

  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.addTag,
      state: original,
      actorContext: { sessionRole: "player" }
    }),
    (error) =>
      error instanceof MechanicsExecutionError &&
      error.code === "MECHANICS_VALUE_TYPE_MISMATCH"
  );
  assert.deepEqual(
    (original.public.pieces.alpha.attributes as Record<string, unknown>).tags,
    []
  );
});

test("a later failure rolls back an earlier successful set-add", () => {
  const mechanics = createSetAddMechanics();
  const original = createSetAddState({ tags: ["alpha", "beta"] });
  const before = structuredClone(original);

  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.rollbackTag,
      state: original,
      actorContext: { sessionRole: "player" }
    }),
    (error) =>
      error instanceof MechanicsExecutionError &&
      error.code === "FIXTURE_SET_ADD_ROLLBACK"
  );
  assert.deepEqual(original, before);
});

test("set disjoint fails closed when a direct runtime caller supplies unlike item classes", () => {
  const mechanics = createMechanics();
  mechanics.plans.runtimeSetTypeMismatch = {
    planHash: HASH,
    transaction: {
      steps: [{
        id: "reject-unlike-sets",
        kind: "assert",
        op: "core.assert",
        predicate: {
          op: "predicate.set.disjoint",
          left: { op: "value.literal", value: ["one"] },
          right: { op: "value.literal", value: [1] }
        },
        errorCode: "FIXTURE_UNREACHABLE"
      }]
    }
  } as CubicaMechanicsIRV1Alpha1["plans"][string];
  finalizePlanHashes(mechanics);

  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.runtimeSetTypeMismatch,
      state: createState(),
      actorContext: { sessionRole: "player" }
    }),
    (error) => error instanceof MechanicsExecutionError &&
      error.code === "MECHANICS_SET_TYPE_MISMATCH" &&
      error.stepId === "reject-unlike-sets"
  );
});

test("runtime rejects a write outside the declared state type without mutating input", () => {
  const mechanics = createMechanics();
  const integerType = mechanics.stateModel.types["core.integer"];
  assert.equal(integerType.kind, "integer");
  if (integerType.kind === "integer") integerType.maximum = 4;
  finalizePlanHashes(mechanics);
  const original = createState();

  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.rollback,
      state: original,
      actorContext: { sessionRole: "player" }
    }),
    (error) => error instanceof MechanicsExecutionError && error.code === "MECHANICS_VALUE_TYPE_MISMATCH"
  );
  assert.deepEqual(original, createState());
});

test("the pre-commit pass validates every available endpoint and closed collection", () => {
  const mechanics = createMechanics();
  mechanics.plans.incrementOnly = {
    planHash: HASH,
    transaction: {
      steps: [{
        id: "incrementOnly",
        kind: "command",
        op: "core.number.add",
        target: { endpoint: "counter" },
        delta: { op: "value.literal", value: 1 }
      }]
    }
  };
  finalizePlanHashes(mechanics);

  const original = createState();
  (original.public.pieces.middle.attributes as Record<string, unknown>).undeclared = "corrupt";
  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.incrementOnly,
      state: original,
      actorContext: { sessionRole: "player" }
    }),
    (error) => error instanceof MechanicsExecutionError && error.code === "MECHANICS_ENTITY_FIELD_UNDECLARED"
  );
  assert.equal(original.public.counter, 4, "failed final validation must not publish the candidate clone");

  const overCapacity = createState();
  const pieces = overCapacity.public.pieces as Record<string, {
    objectType: string;
    facets: { active: boolean };
    attributes: { score: number };
  }>;
  for (let index = Object.keys(pieces).length; index < 33; index += 1) {
    pieces[`extra-${index}`] = {
      objectType: "fixture.piece",
      facets: { active: false },
      attributes: { score: index }
    };
  }
  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.incrementOnly,
      state: overCapacity,
      actorContext: { sessionRole: "player" }
    }),
    (error) => error instanceof MechanicsExecutionError && error.code === "MECHANICS_COLLECTION_CAPACITY"
  );
});

test("the pre-commit pass expands actor storage across all stored participants", () => {
  const mechanics = createMechanics();
  mechanics.stateModel.endpoints["actor.score"] = {
    audienceRef: "actor",
    storage: { root: "players", segments: [{ context: "actor" }] },
    valueType: "core.integer",
    access: "read-write"
  };
  mechanics.plans.incrementOnly = {
    planHash: HASH,
    transaction: {
      steps: [{
        id: "incrementOnly",
        kind: "command",
        op: "core.number.add",
        target: { endpoint: "counter" },
        delta: { op: "value.literal", value: 1 }
      }]
    }
  };
  finalizePlanHashes(mechanics);
  const original = {
    ...createState(),
    players: { alice: 1, bob: "corrupt" }
  };

  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.incrementOnly,
      state: original,
      actorContext: { actorPlayerId: "alice", sessionRole: "player" }
    }),
    (error) => error instanceof MechanicsExecutionError && error.code === "MECHANICS_VALUE_TYPE_MISMATCH"
  );
  assert.equal(original.public.counter, 4);
});

test("record-map collections validate closed paths and expose generic typed field access", () => {
  const mechanics = createMechanics();
  mechanics.stateModel.collections.participants = {
    itemShape: "record",
    audienceRef: "server",
    storage: { root: "players", segments: [] },
    capacity: 4,
    stableKey: "map-key",
    fields: {
      score: {
        storage: { kind: "path", path: ["metrics", "score"] },
        valueType: "core.integer",
        access: "read-write"
      },
      status: {
        storage: { kind: "path", path: ["status"] },
        valueType: "core.string",
        access: "read-only"
      }
    }
  } as any;
  mechanics.plans.incrementOnly = {
    planHash: HASH,
    transaction: {
      steps: [{
        id: "incrementOnly",
        kind: "command",
        op: "core.number.add",
        target: { endpoint: "counter" },
        delta: { op: "value.literal", value: 1 }
      }]
    }
  };
  finalizePlanHashes(mechanics);
  const state = {
    ...createState(),
    players: {
      alice: { metrics: { score: 3 }, status: "ready" }
    }
  };
  const model = mechanics.stateModel.collections.participants;
  const alice = state.players.alice;
  assert.equal(readCollectionField(model, alice, "score"), 3);

  const context = {
    stateModel: mechanics.stateModel,
    state,
    preActionState: state,
    params: {},
    actor: { sessionRole: "player" as const },
    limits: RUNTIME_BUDGETS[mechanics.budgetProfile]
  };
  writeCollectionField(context, model, alice, "score", 4);
  assert.equal(alice.metrics.score, 4);
  assert.throws(
    () => writeCollectionField(context, model, alice, "status", "changed"),
    (error) => error instanceof MechanicsExecutionError && error.code === "MECHANICS_FIELD_NOT_WRITABLE"
  );
  const detached: Record<string, unknown> = {};
  initializeCollectionField(context, model, detached, "status", "new");
  assert.deepEqual(detached, { status: "new" });
  assert.throws(
    () => initializeCollectionField(context, model, alice, "status", "changed"),
    (error) => error instanceof MechanicsExecutionError && error.code === "MECHANICS_FIELD_NOT_INITIALIZABLE"
  );

  const validOutput = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.incrementOnly,
    state,
    actorContext: { sessionRole: "player" }
  });
  assert.equal((validOutput.candidateState.public as { counter: number }).counter, 5);

  const corrupt = structuredClone(state);
  (corrupt.players.alice.metrics as Record<string, unknown>).undeclared = true;
  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.incrementOnly,
      state: corrupt,
      actorContext: { sessionRole: "player" }
    }),
    (error) => error instanceof MechanicsExecutionError && error.code === "MECHANICS_ENTITY_FIELD_UNDECLARED"
  );
});

test("derived fields read exact nested values, validate input state, and reject every write path", () => {
  const mechanics = createMechanics();
  mechanics.stateModel.types["fixture.coordinate"] = {
    kind: "finite-number",
    minimum: -1_000_000_000,
    maximum: 1_000_000_000
  };
  mechanics.stateModel.collections.pieces.fields.position = {
    storage: { kind: "attribute", name: "position" },
    valueType: "fixture.json",
    access: "read-write"
  };
  mechanics.stateModel.collections.pieces.fields.positionX = {
    source: { kind: "nested-field", field: "position", path: ["x"] },
    valueType: "fixture.coordinate",
    access: "read-only"
  };
  mechanics.plans.incrementOnly = {
    planHash: HASH,
    transaction: {
      steps: [{
        id: "incrementOnly",
        kind: "command",
        op: "core.number.add",
        target: { endpoint: "counter" },
        delta: { op: "value.literal", value: 1 }
      }]
    }
  };
  finalizePlanHashes(mechanics);

  const state = createState();
  const coordinates: Record<string, number> = {
    alpha: 987_654_321.1234567,
    middle: -0,
    zeta: 987_654_321.1234568
  };
  for (const [id, item] of Object.entries(state.public.pieces)) {
    (item.attributes as Record<string, unknown>).position = { x: coordinates[id], y: 0 };
  }
  const model = mechanics.stateModel.collections.pieces;
  assert.equal(
    readCollectionField(model, state.public.pieces.alpha, "positionX"),
    987_654_321.1234567
  );

  const context = {
    stateModel: mechanics.stateModel,
    state,
    preActionState: state,
    params: {},
    actor: { sessionRole: "player" as const },
    limits: RUNTIME_BUDGETS[mechanics.budgetProfile]
  };
  assert.throws(
    () => writeCollectionField(context, model, state.public.pieces.alpha, "positionX", 1),
    (error) => error instanceof MechanicsExecutionError &&
      error.code === "MECHANICS_FIELD_NOT_WRITABLE"
  );
  assert.throws(
    () => initializeCollectionField(context, model, {}, "positionX", 1),
    (error) => error instanceof MechanicsExecutionError &&
      error.code === "MECHANICS_FIELD_NOT_WRITABLE"
  );

  const valid = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.incrementOnly,
    state,
    actorContext: { sessionRole: "player" }
  });
  assert.equal((valid.candidateState.public as { counter: number }).counter, 5);

  for (const [invalidX, expectedCode] of [
    [undefined, "MECHANICS_INPUT_STATE_LIMIT"],
    ["invalid", "MECHANICS_VALUE_TYPE_MISMATCH"],
    [1_000_000_001, "MECHANICS_VALUE_TYPE_MISMATCH"],
    [Number.POSITIVE_INFINITY, "MECHANICS_INPUT_STATE_LIMIT"]
  ] as const) {
    const corrupt = structuredClone(state);
    (
      (corrupt.public.pieces.alpha.attributes as Record<string, unknown>).position as
        Record<string, unknown>
    ).x = invalidX;
    let caught: unknown;
    try {
      executeMechanicsTransaction({
        mechanics,
        plan: mechanics.plans.incrementOnly,
        state: corrupt,
        actorContext: { sessionRole: "player" }
      });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof MechanicsExecutionError);
    assert.equal(
      caught.code,
      expectedCode,
      `input projection must reject ${String(invalidX)} before any mutation`
    );
    assert.equal(corrupt.public.counter, 4);
  }
});

test("actor identity is available only through value.actor, never injected into params", () => {
  const mechanics = createMechanics();
  mechanics.stateModel.endpoints.actorSink = {
    audienceRef: "public",
    storage: { root: "public", segments: ["actorSink"] },
    valueType: "core.string",
    access: "read-write"
  };
  mechanics.plans.copyActorParam = {
    planHash: HASH,
    transaction: {
      steps: [{
        id: "copyActorParam",
        kind: "command",
        op: "core.state.patch",
        patches: [{
          operation: "set",
          target: { endpoint: "actorSink" },
          value: { op: "value.param", name: "actor" }
        }]
      }]
    }
  };
  finalizePlanHashes(mechanics);
  const original = { ...createState(), public: { ...createState().public, actorSink: "before" } };

  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.copyActorParam,
      state: original,
      actorContext: { actorPlayerId: "alice", sessionRole: "player" }
    }),
    (error) => error instanceof MechanicsExecutionError && error.code === "MECHANICS_VALUE_TYPE_MISMATCH"
  );
  assert.equal(original.public.actorSink, "before");
});

test("typed StateRef bindings resolve exactly one declared dynamic storage segment", () => {
  const mechanics = createMechanics();
  mechanics.stateModel.endpoints.dynamicScore = {
    audienceRef: "public",
    storage: { root: "public", segments: ["dynamicScores", { binding: "slot" }] },
    valueType: "core.integer",
    access: "read-only"
  };
  mechanics.plans.readDynamicScore = {
    planHash: HASH,
    transaction: {
      steps: [{
        id: "readDynamicScore",
        kind: "command",
        op: "core.state.patch",
        patches: [{
          operation: "set",
          target: { endpoint: "counter" },
          value: {
            op: "value.state",
            ref: {
              endpoint: "dynamicScore",
              bindings: { slot: { op: "value.literal", value: "alpha" } }
            }
          }
        }]
      }]
    }
  };
  finalizePlanHashes(mechanics);
  const original = {
    ...createState(),
    public: { ...createState().public, dynamicScores: { alpha: 17 } }
  };

  const output = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.readDynamicScore,
    state: original,
    actorContext: { sessionRole: "player" }
  });
  assert.equal((output.candidateState.public as { counter: number }).counter, 17);

  const step = mechanics.plans.readDynamicScore.transaction.steps[0];
  assert.equal(step.op, "core.state.patch");
  if (step.op !== "core.state.patch" || step.patches[0].operation === "remove") return;
  const expression = step.patches[0].value;
  assert.equal(expression?.op, "value.state");
  if (expression?.op !== "value.state") return;
  expression.ref.bindings = {
    slot: { op: "value.literal", value: "alpha" },
    unused: { op: "value.literal", value: "beta" }
  };
  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.readDynamicScore,
      state: original,
      actorContext: { sessionRole: "player" }
    }),
    (error) => error instanceof MechanicsExecutionError && error.code === "MECHANICS_STATE_BINDING_UNUSED"
  );
  expression.ref.bindings = undefined;
  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.readDynamicScore,
      state: original,
      actorContext: { sessionRole: "player" }
    }),
    (error) => error instanceof MechanicsExecutionError && error.code === "MECHANICS_STATE_BINDING_MISSING"
  );
});

test("value.entity reads only a declared typed collection field", () => {
  const mechanics = createMechanics();
  mechanics.plans.readEntityScore = {
    planHash: HASH,
    transaction: {
      steps: [{
        id: "readEntityScore",
        kind: "command",
        op: "core.state.patch",
        patches: [{
          operation: "set",
          target: { endpoint: "counter" },
          value: {
            op: "value.entity",
            entity: {
              collection: "pieces",
              entityId: { op: "value.literal", value: "alpha" }
            },
            field: "score"
          }
        }]
      }]
    }
  };
  finalizePlanHashes(mechanics);

  const output = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.readEntityScore,
    state: createState(),
    actorContext: { sessionRole: "player" }
  });
  assert.equal((output.candidateState.public as { counter: number }).counter, 2);
});

test("expression and predicate depth accepts the boundary and rejects one level beyond it", () => {
  const mechanics = createMechanics();
  const nestedPredicate = (notCount: number): any => {
    let predicate: any = { op: "predicate.constant", value: true };
    for (let index = 0; index < notCount; index += 1) {
      predicate = { op: "predicate.not", item: predicate };
    }
    return predicate;
  };
  mechanics.plans.depthBoundary = {
    planHash: HASH,
    transaction: {
      steps: [{
        id: "depthBoundary",
        kind: "assert",
        op: "core.assert",
        predicate: nestedPredicate(64),
        errorCode: "UNEXPECTED_FALSE"
      }]
    }
  };
  mechanics.plans.depthOverflow = {
    planHash: HASH,
    transaction: {
      steps: [{
        id: "depthOverflow",
        kind: "assert",
        op: "core.assert",
        predicate: nestedPredicate(65),
        errorCode: "UNEXPECTED_FALSE"
      }]
    }
  };
  finalizePlanHashes(mechanics);

  assert.doesNotThrow(() => executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.depthBoundary,
    state: createState(),
    actorContext: { sessionRole: "player" }
  }));
  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.depthOverflow,
      state: createState(),
      actorContext: { sessionRole: "player" }
    }),
    (error) => error instanceof MechanicsExecutionError &&
      error.code === "MECHANICS_RUNTIME_BUDGET_EXCEEDED" &&
      /depth budget exceeded/u.test(error.message)
  );
});

test("publication rejects oversized and over-deep JSON literals deterministically", () => {
  const oversized = createMechanics();
  const rollbackStep = oversized.plans.rollback.transaction.steps[0];
  assert.equal(rollbackStep.op, "core.number.add");
  if (rollbackStep.op === "core.number.add") {
    rollbackStep.delta = { op: "value.literal", value: "я".repeat(8_193) };
  }
  finalizePlanHashes(oversized);
  assert.equal(validateMechanicsSchema(oversized).valid, true);
  assert.throws(
    () => checkMechanicsBundle(oversized),
    /MECHANICS_LITERAL_STRING_LIMIT/u,
    "the checker counts UTF-8 bytes, not JavaScript UTF-16 code units"
  );

  const tooDeep = createMechanics();
  let nested: JsonValue = { leaf: true };
  for (let depth = 0; depth < 33; depth += 1) nested = { child: nested };
  const deepStep = tooDeep.plans.rollback.transaction.steps[0];
  assert.equal(deepStep.op, "core.number.add");
  if (deepStep.op === "core.number.add") {
    deepStep.delta = { op: "value.literal", value: nested };
  }
  finalizePlanHashes(tooDeep);
  assert.equal(validateMechanicsSchema(tooDeep).valid, true);
  assert.throws(() => checkMechanicsBundle(tooDeep), /MECHANICS_LITERAL_DEPTH_LIMIT/u);
});

test("closed record values reject undeclared fields at the runtime mutation boundary", () => {
  const mechanics = createMechanics();
  mechanics.stateModel.types["fixture.closed"] = {
    kind: "record",
    fields: { known: { typeRef: "core.string", optional: false } }
  };
  mechanics.stateModel.endpoints.closed = {
    audienceRef: "public",
    storage: { root: "public", segments: ["closed"] },
    valueType: "fixture.closed",
    access: "read-write"
  };
  mechanics.plans.writeClosed = {
    planHash: HASH,
    transaction: {
      steps: [{
        id: "writeClosed",
        kind: "command",
        op: "core.state.patch",
        patches: [{
          operation: "set",
          target: { endpoint: "closed" },
          value: { op: "value.literal", value: { known: "ok", undeclared: "blocked" } }
        }]
      }]
    }
  };
  finalizePlanHashes(mechanics);
  const original = { ...createState(), public: { ...createState().public, closed: { known: "before" } } };

  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.writeClosed,
      state: original,
      actorContext: { sessionRole: "player" }
    }),
    (error) => error instanceof MechanicsExecutionError && error.code === "MECHANICS_VALUE_TYPE_MISMATCH"
  );
  assert.deepEqual(original.public.closed, { known: "before" });
});

test("publication rejects undeclared fields in authored collection entities", () => {
  const mechanics = createMechanics();
  const initialState = createState();
  (initialState.public.pieces.alpha.attributes as Record<string, unknown>).undeclared =
    "must fail before publication";
  assert.throws(
    () => checkMechanicsBundle(mechanics, { initialState }),
    /MECHANICS_ENTITY_FIELD_UNDECLARED/u
  );
});

test("publication rejects a missing required initial endpoint value", () => {
  const mechanics = createMechanics();
  const initialState = createState();
  delete (initialState.public as Partial<typeof initialState.public>).counter;

  assert.throws(
    () => checkMechanicsBundle(mechanics, { initialState }),
    /MECHANICS_INITIAL_STATE_TYPE_MISMATCH.*initial endpoint does not match declared type "core\.integer"/u
  );
});

test("publication rejects action references outside the Mechanics collection model", () => {
  const mechanics = createMechanics();
  const actionId = "fixture.select";
  const definition = {
    invocation: "external" as const,
    allowedSessionRoles: ["player"],
    paramsSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        entityId: {
          type: "string",
          maxLength: 128,
          "x-cubica-ref": {
            kind: "object",
            collection: "undeclared",
            allowedTypes: ["fixture.piece"],
            visibility: "public"
          }
        }
      }
    },
    binding: { kind: "mechanics-plan", planRef: "rollback" }
  };
  const action = {
    ...definition,
    definitionHash: mechanicsSha256({
      apiVersion: mechanics.apiVersion,
      actionId,
      definition,
      planHash: mechanics.plans.rollback.planHash
    })
  };
  assert.throws(
    () => checkMechanicsBundle(mechanics, { actions: { [actionId]: action } }),
    /MECHANICS_COLLECTION_REF_UNKNOWN/u
  );
});

test("candidate state is rejected before it can leave the Mechanics transaction", () => {
  const mechanics = createMechanics();
  mechanics.stateModel.types["fixture.largeList"] = {
    kind: "list",
    itemType: "core.string",
    maxItems: 1_024
  };
  mechanics.stateModel.endpoints.largeList = {
    audienceRef: "public",
    storage: { root: "public", segments: ["largeList"] },
    valueType: "fixture.largeList",
    access: "read-write"
  };
  const chunk = "x".repeat(16 * 1_024);
  mechanics.plans.growCandidate = {
    planHash: HASH,
    transaction: {
      steps: [{
        id: "growCandidate",
        kind: "command",
        op: "core.collection.append",
        target: { endpoint: "largeList" },
        value: { op: "value.literal", value: chunk }
      }]
    }
  };
  finalizePlanHashes(mechanics);

  const state = createState() as ReturnType<typeof createState> & { public: { largeList: Array<string> } };
  state.public.largeList = [];
  const candidateLimit = 8 * 1_024 * 1_024;
  while (Buffer.byteLength(JSON.stringify(state), "utf8") + Buffer.byteLength(JSON.stringify(chunk), "utf8") + 1 <= candidateLimit) {
    state.public.largeList.push(chunk);
  }
  assert.ok(state.public.largeList.length < 1_024);
  const originalLength = state.public.largeList.length;

  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.growCandidate,
      state,
      actorContext: { sessionRole: "player" }
    }),
    (error) => error instanceof MechanicsExecutionError && error.code === "MECHANICS_CANDIDATE_STATE_LIMIT"
  );
  assert.equal(state.public.largeList.length, originalLength, "oversized candidate must not mutate the authoritative input");
});

test("one emitted event cannot exceed its profile byte limit", () => {
  const mechanics = createMechanics();
  mechanics.stateModel.types["fixture.eventBlob"] = {
    kind: "json",
    maxDepth: 8,
    maxNodes: 64,
    maxUtf8Bytes: 256 * 1_024
  };
  mechanics.stateModel.types["fixture.largeEventPayload"] = {
    kind: "record",
    fields: { blob: { typeRef: "fixture.eventBlob", optional: false } }
  };
  mechanics.stateModel.endpoints.eventBlob = {
    audienceRef: "public",
    storage: { root: "public", segments: ["eventBlob"] },
    valueType: "fixture.eventBlob",
    access: "read-only"
  };
  mechanics.stateModel.events["fixture.large"] = {
    audienceRef: "public",
    payloadType: "fixture.largeEventPayload"
  };
  mechanics.plans.emitLarge = {
    planHash: HASH,
    transaction: {
      steps: [{
        id: "emitLarge",
        kind: "command",
        op: "core.event.emit",
        eventType: "fixture.large",
        summary: { op: "value.literal", value: "bounded event" },
        audience: "public",
        data: { blob: { op: "value.state", ref: { endpoint: "eventBlob" } } }
      }]
    }
  };
  finalizePlanHashes(mechanics);
  const blob = Array.from({ length: 16 }, () => "x".repeat(16_376));
  assert.ok(Buffer.byteLength(JSON.stringify(blob), "utf8") < 256 * 1_024);
  const state = { ...createState(), public: { ...createState().public, eventBlob: blob } };

  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.emitLarge,
      state,
      actorContext: { sessionRole: "player" }
    }),
    (error) => error instanceof MechanicsExecutionError && error.code === "MECHANICS_EVENT_SIZE_LIMIT"
  );
});

test("repeated bounded parameters still consume the aggregate intermediate budget", () => {
  const mechanics = createMechanics();
  mechanics.stateModel.endpoints.paramSink = {
    audienceRef: "public",
    storage: { root: "public", segments: ["paramSink"] },
    valueType: "core.string",
    access: "read-write"
  };
  const copyParamStep = (index: number): StatePatchStep => ({
    id: `copyParam${index}`,
    kind: "command",
    op: "core.state.patch",
    patches: [{
      operation: "set",
      target: { endpoint: "paramSink" },
      value: { op: "value.param", name: "payload" }
    }]
  });
  mechanics.plans.repeatParam = {
    planHash: HASH,
    transaction: {
      // Keep the non-empty transaction invariant visible to TypeScript instead
      // of weakening the generated tuple contract with an assertion.
      steps: [
        copyParamStep(0),
        ...Array.from({ length: 139 }, (_, offset) => copyParamStep(offset + 1))
      ]
    }
  };
  finalizePlanHashes(mechanics);
  const state = { ...createState(), public: { ...createState().public, paramSink: "" } };

  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.repeatParam,
      state,
      params: { payload: "x".repeat(16_000) },
      actorContext: { sessionRole: "player" }
    }),
    (error) => error instanceof MechanicsExecutionError && error.code === "MECHANICS_RUNTIME_BUDGET_EXCEEDED"
  );
  assert.equal(state.public.paramSink, "");
});

test("publication rejects incompatible value types before runtime", () => {
  const mechanics = createMechanics();
  mechanics.plans.typeMismatch = {
    planHash: HASH,
    transaction: {
      steps: [{
        id: "writeWrongType",
        kind: "command",
        op: "core.state.patch",
        patches: [{
          operation: "set",
          target: { endpoint: "counter" },
          value: { op: "value.literal", value: "not-an-integer" }
        }]
      }]
    }
  } as any;
  finalizePlanHashes(mechanics);

  assert.throws(
    () => checkMechanicsBundle(mechanics),
    /MECHANICS_EXPRESSION_TYPE_MISMATCH/u
  );
});

test("projection-only endpoints cannot become an untyped Mechanics back door", () => {
  const mechanics = createMechanics();
  mechanics.stateModel.endpoints.screenDocument = {
    audienceRef: "public",
    storage: { root: "public", segments: ["screenDocument"] },
    valueType: "fixture.json",
    access: "read-only",
    usage: "projection-only"
  };
  mechanics.plans.readProjection = {
    planHash: HASH,
    transaction: {
      steps: [{
        id: "copyProjection",
        kind: "command",
        op: "core.state.patch",
        patches: [{
          operation: "set",
          target: { endpoint: "counter" },
          value: { op: "value.state", ref: { endpoint: "screenDocument" } }
        }]
      }]
    }
  } as any;
  finalizePlanHashes(mechanics);

  assert.throws(
    () => checkMechanicsBundle(mechanics),
    /MECHANICS_PROJECTION_ENDPOINT_NOT_EXECUTABLE/u
  );
});

test("publication propagates actor and server predicates into public writes", () => {
  const createFlowFixture = (audienceRef: "actor" | "server") => {
    const mechanics = createMechanics();
    mechanics.stateModel.endpoints.privateFlag = {
      audienceRef,
      storage: audienceRef === "actor"
        ? { root: "players", segments: [{ context: "actor" }, "privateFlag"] }
        : { root: "secret", segments: ["privateFlag"] },
      valueType: "core.boolean",
      access: "read-only"
    };
    mechanics.plans.controlledDisclosure = {
      planHash: HASH,
      transaction: {
        steps: [{
          id: "conditionallyWritePublic",
          kind: "command",
          op: "core.state.patch",
          when: {
            op: "predicate.compare",
            operator: "eq",
            left: { op: "value.state", ref: { endpoint: "privateFlag" } },
            right: { op: "value.literal", value: true }
          },
          patches: [{
            operation: "set",
            target: { endpoint: "counter" },
            value: { op: "value.literal", value: 1 }
          }]
        }]
      }
    } as any;
    return finalizePlanHashes(mechanics);
  };

  for (const audience of ["actor", "server"] as const) {
    assert.throws(
      () => checkMechanicsBundle(createFlowFixture(audience)),
      /MECHANICS_INFORMATION_FLOW_VIOLATION/u,
      `${audience} control flow must not implicitly disclose into public state`
    );
  }
});

test("publication rejects executable storage parents that overlap a stricter audience", () => {
  const mechanics = createMechanics();
  mechanics.stateModel.endpoints.publicActorRecord = {
    audienceRef: "public",
    storage: { root: "players", segments: [{ context: "actor" }] },
    valueType: "fixture.json",
    access: "read-only"
  };
  mechanics.stateModel.endpoints.privateHand = {
    audienceRef: "actor",
    storage: { root: "players", segments: [{ context: "actor" }, "privateHand"] },
    valueType: "fixture.json",
    access: "read-only"
  };

  assert.throws(
    () => checkMechanicsBundle(finalizePlanHashes(mechanics)),
    (error: unknown) => isSemanticError(error, "MECHANICS_STORAGE_AUDIENCE_OVERLAP")
  );
});

test("semantic publication rejects an operation whose exact module is not locked", () => {
  const mechanics = createMechanics();
  mechanics.moduleLock = recommendedModuleLock(["cubica.random"]);
  finalizePlanHashes(mechanics);

  assert.throws(
    () => checkMechanicsBundle(mechanics),
    /MECHANICS_MODULE_NOT_LOCKED.*cubica\.core/u
  );
  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.updateActive,
      state: createState(),
      actorContext: { sessionRole: "player" }
    }),
    (error) => error instanceof MechanicsExecutionError && error.code === "MECHANICS_MODULE_NOT_LOCKED"
  );
});

test("module corpus identity changes when one executable source byte changes", () => {
  const descriptor = {
    moduleId: "fixture.module",
    moduleVersion: "1.0.0",
    behaviorVersion: "fixture-v1",
    operations: ["fixture.operation"],
    algorithmVersions: {}
  };
  const original = hashMechanicsCorpus([
    { name: "runtime/example.ts", bytes: "export const value = 1;\n" },
    { name: "schema/example.json", bytes: "{}\n" }
  ]);
  const changed = hashMechanicsCorpus([
    { name: "runtime/example.ts", bytes: "export const value = 2;\n" },
    { name: "schema/example.json", bytes: "{}\n" }
  ]);

  assert.notEqual(original, changed);
  assert.notEqual(
    hashModuleArtifact(descriptor, original),
    hashModuleArtifact(descriptor, changed),
    "a one-byte executable change must invalidate the published module artifact"
  );
});

test("additional deck.news consumption cannot change the independent deck.cargo shuffle", () => {
  const mechanics = createIndependentDeckMechanics();
  const original = createIndependentDeckState();

  const cargoWithoutNews = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.shuffleCargo,
    state: original,
    actorContext: { sessionRole: "player" }
  });
  const newsOnce = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.shuffleNews,
    state: original,
    actorContext: { sessionRole: "player" }
  });
  const newsTwice = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.shuffleNews,
    state: newsOnce.candidateState,
    actorContext: { sessionRole: "player" }
  });
  const cargoAfterExtraNews = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.shuffleCargo,
    state: newsTwice.candidateState,
    actorContext: { sessionRole: "player" }
  });

  const withoutNewsSecret = cargoWithoutNews.candidateState.secret as any;
  const afterNewsSecret = cargoAfterExtraNews.candidateState.secret as any;
  assert.deepEqual(afterNewsSecret.decks.cargo, withoutNewsSecret.decks.cargo);
  assert.equal(afterNewsSecret.random.counters["deck.cargo"], withoutNewsSecret.random.counters["deck.cargo"]);
  assert.ok(afterNewsSecret.random.counters["deck.news"] > 0, "the control branch must really consume news randomness");
  assert.deepEqual(original, createIndependentDeckState(), "all comparison branches must preserve their input snapshots");
});

test("the Mechanics schema rejects random stream ids that are unsafe persisted map keys", () => {
  const mechanics = createIndependentDeckMechanics();
  const step = mechanics.plans.shuffleNews.transaction.steps[0];
  assert.equal(step.op, "deck.shuffle");
  if (step.op === "deck.shuffle") step.stream = "__proto__";

  const validation = validateMechanicsSchema(mechanics);
  assert.equal(validation.valid, false);
});

test("graph construction composes route planning, explicit payment, id allocation, and entity creation", () => {
  const networkModels = createGraphNetworkModels();
  const objectModels = createGraphObjectModels();
  const mechanics = finalizePlanHashes(createGraphMechanics(), { networkModels, objectModels });
  assert.doesNotThrow(() => checkMechanicsBundle(mechanics, { networkModels, objectModels }));

  const original = createGraphState();
  const inserted = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.insert,
    state: original,
    actorContext: { sessionRole: "player" },
    networkModels,
    objectModels
  });
  assert.deepEqual(inserted.result, {
    kind: "entity",
    collectionId: "edges",
    id: "neutral:edge:42"
  });
  assert.equal((inserted.candidateState.public as ReturnType<typeof createGraphState>["public"]).transport.sequence, 42);
  assert.equal(
    (inserted.candidateState.public as ReturnType<typeof createGraphState>["public"]).wallet,
    2,
    "the graph operation does not price the route; an explicit resource operation owns payment"
  );

  const inspected = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.inspect,
    state: inserted.candidateState,
    actorContext: { sessionRole: "player" },
    networkModels,
    objectModels
  });
  const inspectedPoint = (inspected.result as any).point;
  assert.equal(inspectedPoint.x, 1 + (8 / 3));
  assert.equal(Number.isFinite(inspectedPoint.x), true);
  assert.notEqual(
    inspectedPoint.x,
    Math.round(inspectedPoint.x * 1_000_000) / 1_000_000,
    "the graph contract must not silently round an inspected coordinate to six decimals"
  );
  assert.equal(inspectedPoint.y, 5);
  assert.deepEqual((inspected.result as any).pointRegionIds, ["middle-field"]);
  assert.deepEqual((inspected.result as any).endpoints.regionIds, ["left-field", "right-field"]);
  assert.match((inspected.result as any).edge.geometryFingerprint, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(inspected.audit.at(-1)?.result, {
    kind: "graph-edge-position-inspection",
    proofVersion: "graph-edge-position-proof/v1"
  });
  assert.equal(
    JSON.stringify(inspected.audit).includes("geometryFingerprint"),
    false,
    "durable audit must not disclose the internal geometry proof"
  );

  const split = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.split,
    state: inserted.candidateState,
    actorContext: { sessionRole: "player" },
    networkModels,
    objectModels
  });
  assert.deepEqual(split.result, {
    nodeId: "neutral:node:43",
    edgeIds: ["neutral:edge:44", "neutral:edge:45"],
    replacedEdgeId: "neutral:edge:42"
  });
  assert.equal((split.candidateState.public as ReturnType<typeof createGraphState>["public"]).transport.sequence, 45);
  const splitNodes = (split.candidateState.public as ReturnType<typeof createGraphState>["public"]).nodes as
    Record<string, Record<string, unknown>>;
  const waypoint = splitNodes["neutral:node:43"];
  assert.equal(
    readCollectionField(mechanics.stateModel.collections.nodes, waypoint, "positionX"),
    5,
    "the split node exposes its exact x coordinate without a duplicated stored field"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(waypoint.attributes as Record<string, unknown>, "positionX"),
    false
  );
  const orderedAfterSplit = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.orderNodes,
    state: split.candidateState,
    actorContext: { sessionRole: "player" },
    networkModels,
    objectModels
  });
  assert.deepEqual(
    (orderedAfterSplit.result as { ids: Array<string> }).ids,
    ["right", "destination", "neutral:node:43", "left"],
    "the newly split node is immediately orderable through its derived coordinate"
  );
  assert.equal(original.public.transport.sequence, 41);
});

test("graph split rejects a stale inspection proof and rolls back the intervening mutation", () => {
  const networkModels = createGraphNetworkModels();
  const objectModels = createGraphObjectModels();
  const mechanics = finalizePlanHashes(createGraphMechanics(), { networkModels, objectModels });
  const original = createGraphState();
  const inserted = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.insert,
    state: original,
    actorContext: { sessionRole: "player" },
    networkModels,
    objectModels
  }).candidateState;
  const before = structuredClone(inserted);

  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.staleSplit,
      state: inserted,
      actorContext: { sessionRole: "player" },
      networkModels,
      objectModels
    }),
    (error) => error instanceof MechanicsExecutionError &&
      error.code === "MECHANICS_GRAPH_PROOF_STALE" &&
      error.stepId === "split"
  );
  assert.deepEqual(inserted, before);
});

test("graph split detects endpoint drift covered by the inspection fingerprint", () => {
  const networkModels = createGraphNetworkModels();
  const objectModels = createGraphObjectModels();
  const mechanics = finalizePlanHashes(createGraphMechanics(), { networkModels, objectModels });
  const inserted = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.insert,
    state: createGraphState(),
    actorContext: { sessionRole: "player" },
    networkModels,
    objectModels
  }).candidateState;
  const before = structuredClone(inserted);

  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.staleEndpointSplit,
      state: inserted,
      actorContext: { sessionRole: "player" },
      networkModels,
      objectModels
    }),
    (error) => error instanceof MechanicsExecutionError &&
      error.code === "MECHANICS_GRAPH_PROOF_STALE" &&
      error.stepId === "split"
  );
  assert.deepEqual(inserted, before);
});

test("graph split rejects a same-shaped proof that lacks server provenance", () => {
  const networkModels = createGraphNetworkModels();
  const objectModels = createGraphObjectModels();
  const mechanics = createGraphMechanics();
  mechanics.stateModel.types["fixture.proof-list"] = {
    kind: "list",
    itemType: "core.graph-json",
    maxItems: 4
  };
  mechanics.stateModel.endpoints.proofSink = {
    audienceRef: "public",
    storage: { root: "public", segments: ["proofSink"] },
    valueType: "fixture.proof-list",
    access: "read-write"
  };
  mechanics.plans.forgedSplit = {
    planHash: HASH,
    transaction: {
      steps: [
        {
          id: "lookalike",
          kind: "command",
          op: "core.collection.append",
          target: { endpoint: "proofSink" },
          value: {
            op: "value.literal",
            value: {
              proofVersion: "graph-edge-position-proof/v1",
              networkId: "neutral",
              edge: {
                id: "neutral:edge:42",
                geometryFingerprint: `sha256:${"0".repeat(64)}`
              },
              normalizedPosition: 0.5,
              point: { x: 5, y: 5 },
              pointRegionIds: ["middle-field"],
              endpoints: {
                from: { id: "left", point: { x: 1, y: 5 }, regionIds: ["left-field"] },
                to: { id: "right", point: { x: 9, y: 5 }, regionIds: ["right-field"] },
                regionIds: ["left-field", "right-field"]
              }
            }
          }
        },
        {
          id: "split",
          kind: "command",
          op: "graph.edge.split",
          networkId: "neutral",
          proof: { op: "value.result", stepId: "lookalike" }
        }
      ]
    }
  } as CubicaMechanicsIRV1Alpha1["plans"][string];
  finalizePlanHashes(mechanics, { networkModels, objectModels });
  const state = createGraphState() as ReturnType<typeof createGraphState> & {
    public: ReturnType<typeof createGraphState>["public"] & { proofSink: Array<unknown> };
  };
  state.public.proofSink = [];

  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.forgedSplit,
      state,
      actorContext: { sessionRole: "player" },
      networkModels,
      objectModels
    }),
    (error) => error instanceof MechanicsExecutionError &&
      error.code === "MECHANICS_GRAPH_PROOF_INVALID" &&
      error.stepId === "split"
  );
  assert.deepEqual(state.public.proofSink, []);
});

test("graph split schema accepts only an opaque prior inspection result", () => {
  const networkModels = createGraphNetworkModels();
  const objectModels = createGraphObjectModels();

  const legacy = finalizePlanHashes(createGraphMechanics(), { networkModels, objectModels });
  const legacySplit = legacy.plans.split.transaction.steps.at(-1) as any;
  delete legacySplit.proof;
  legacySplit.edge = { op: "value.literal", value: "neutral:edge:42" };
  legacySplit.position = { op: "value.literal", value: 0.5 };
  finalizePlanHashes(legacy, { networkModels, objectModels });
  assert.equal(validateMechanicsSchema(legacy).valid, false);

  const pathProof = finalizePlanHashes(createGraphMechanics(), { networkModels, objectModels });
  (pathProof.plans.split.transaction.steps.at(-1) as any).proof.path = ["point"];
  finalizePlanHashes(pathProof, { networkModels, objectModels });
  assert.equal(validateMechanicsSchema(pathProof).valid, false);

  const literalProof = finalizePlanHashes(createGraphMechanics(), { networkModels, objectModels });
  (literalProof.plans.split.transaction.steps.at(-1) as any).proof = {
    op: "value.literal",
    value: { client: "forged" }
  };
  finalizePlanHashes(literalProof, { networkModels, objectModels });
  assert.equal(validateMechanicsSchema(literalProof).valid, false);
});

test("semantic checker proves the inspection-to-split chain and typed set operands", () => {
  const networkModels = createGraphNetworkModels();
  const objectModels = createGraphObjectModels();
  const expectCode = (
    mutate: (mechanics: CubicaMechanicsIRV1Alpha1) => void,
    code: string,
    models: GameManifestTransportNetworkModelMap = networkModels
  ): void => {
    const mechanics = createGraphMechanics();
    mutate(mechanics);
    finalizePlanHashes(mechanics, { networkModels: models, objectModels });
    assert.throws(
      () => checkMechanicsBundle(mechanics, {
        networkModels: models,
        objectModels
      }),
      (error) => error instanceof MechanicsSemanticError && error.code === code
    );
  };

  expectCode((mechanics) => {
    (mechanics.plans.split.transaction.steps.at(-1) as any).proof.stepId = "allowed-region";
  }, "MECHANICS_GRAPH_PROOF_SOURCE_INVALID");

  expectCode((mechanics) => {
    (mechanics.plans.split.transaction.steps[0] as any).when = {
      op: "predicate.constant",
      value: true
    };
  }, "MECHANICS_GRAPH_PROOF_SOURCE_CONDITIONAL");

  expectCode((mechanics) => {
    const split = mechanics.plans.split.transaction.steps.at(-1) as any;
    split.proof.stepId = "future-inspect";
  }, "MECHANICS_RESULT_REF_FORWARD_OR_UNKNOWN");

  expectCode((mechanics) => {
    mechanics.stateModel.types["fixture.number-set"] = {
      kind: "set",
      itemType: "core.integer",
      maxItems: 8
    };
    mechanics.stateModel.endpoints.numberSet = {
      audienceRef: "public",
      storage: { root: "public", segments: ["numberSet"] },
      valueType: "fixture.number-set",
      access: "read-only"
    };
    const assertion = mechanics.plans.split.transaction.steps[1] as any;
    assertion.predicate.right = {
      op: "value.state",
      ref: { endpoint: "numberSet" }
    };
  }, "MECHANICS_SET_TYPE_MISMATCH");

  const twoNetworks = {
    ...networkModels,
    other: structuredClone(networkModels.neutral)
  };
  expectCode((mechanics) => {
    (mechanics.plans.split.transaction.steps.at(-1) as any).networkId = "other";
  }, "MECHANICS_GRAPH_PROOF_NETWORK_MISMATCH", twoNetworks);
});

test("graph capacity counts only lifecycle states declared as occupying a node", () => {
  const networkModels = createGraphNetworkModels();
  const objectModels = createGraphObjectModels();
  const mechanics = finalizePlanHashes(createGraphMechanics(), { networkModels, objectModels });
  assert.doesNotThrow(() => checkMechanicsBundle(mechanics, {
    initialState: createGraphState(),
    networkModels,
    objectModels
  }));

  const withReserveAtDestination = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.traverse,
    state: createGraphState(),
    actorContext: { sessionRole: "player" },
    networkModels,
    objectModels
  });
  const movedVehicles = (withReserveAtDestination.candidateState.public as ReturnType<typeof createGraphState>["public"]).vehicles;
  assert.equal(movedVehicles.moving.attributes.nodeId, "destination");
  assert.equal(movedVehicles.moving.attributes.actionPoints, 1);
  assert.equal(movedVehicles.reserve.attributes.nodeId, "destination");

  const occupied = createGraphState();
  occupied.public.vehicles.reserve.facets.availability = "active";
  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.traverse,
      state: occupied,
      actorContext: { sessionRole: "player" },
      networkModels,
      objectModels
    }),
    (error) => error instanceof MechanicsExecutionError && error.code === "MECHANICS_GRAPH_CAPACITY"
  );
  assert.equal(occupied.public.vehicles.moving.attributes.nodeId, "left");
  assert.equal(occupied.public.vehicles.moving.attributes.actionPoints, 2);
});

test("graph traversal rejects a closed source node without spending movement resources", () => {
  const networkModels = createGraphNetworkModels();
  const objectModels = createGraphObjectModels();
  const mechanics = finalizePlanHashes(createGraphMechanics(), { networkModels, objectModels });
  const closedAtSource = createGraphState();
  closedAtSource.public.nodes.left.facets.availability = "closed";

  assert.throws(
    () => executeMechanicsTransaction({
      mechanics,
      plan: mechanics.plans.traverse,
      state: closedAtSource,
      actorContext: { sessionRole: "player" },
      networkModels,
      objectModels
    }),
    { code: "MECHANICS_GRAPH_STATE", stepId: "traverse" }
  );
  assert.equal(closedAtSource.public.vehicles.moving.attributes.nodeId, "left");
  assert.equal(closedAtSource.public.vehicles.moving.attributes.actionPoints, 2);
});

test("publication rejects incomplete or ill-typed graph capacity bindings", () => {
  const objectModels = createGraphObjectModels();

  const unknownFacetModels = createGraphNetworkModels();
  unknownFacetModels.neutral.movement!.capacityStateFacet = "misspelled";
  assert.throws(
    () => checkMechanicsBundle(
      finalizePlanHashes(createGraphMechanics(), { networkModels: unknownFacetModels, objectModels }),
      { networkModels: unknownFacetModels, objectModels }
    ),
    (error: unknown) => isSemanticError(error, "MECHANICS_GRAPH_CAPACITY_FACET_UNKNOWN")
  );

  const invalidStateModels = createGraphNetworkModels();
  invalidStateModels.neutral.movement!.capacityOccupyingStates = ["unknown"];
  assert.throws(
    () => checkMechanicsBundle(
      finalizePlanHashes(createGraphMechanics(), { networkModels: invalidStateModels, objectModels }),
      { networkModels: invalidStateModels, objectModels }
    ),
    (error: unknown) => isSemanticError(error, "MECHANICS_GRAPH_CAPACITY_STATE_TYPE_MISMATCH")
  );

  const unknownLocationModels = createGraphNetworkModels();
  unknownLocationModels.neutral.movement!.capacityLocationAttribute = "misspelled";
  assert.throws(
    () => checkMechanicsBundle(
      finalizePlanHashes(createGraphMechanics(), { networkModels: unknownLocationModels, objectModels }),
      { networkModels: unknownLocationModels, objectModels }
    ),
    (error: unknown) => isSemanticError(error, "MECHANICS_GRAPH_ATTRIBUTE_UNKNOWN")
  );

  const missingFacetState = createGraphState();
  delete (missingFacetState.public.vehicles.reserve.facets as Record<string, unknown>).availability;
  const networkModels = createGraphNetworkModels();
  assert.throws(
    () => checkMechanicsBundle(
      finalizePlanHashes(createGraphMechanics(), { networkModels, objectModels }),
      { initialState: missingFacetState, networkModels, objectModels }
    ),
    (error: unknown) => isSemanticError(error, "MECHANICS_GRAPH_CAPACITY_STATE_MISSING")
  );
});

test("graph capacity fails closed for corrupt state and respects collection-local ids and graph ownership", () => {
  const objectModels = createGraphObjectModels();
  const networkModels = createGraphNetworkModels();
  const mechanics = createGraphMechanics();
  mechanics.stateModel.collections.occupants = {
    ...structuredClone(mechanics.stateModel.collections.vehicles),
    storage: { root: "public", segments: ["occupants"] }
  };
  networkModels.neutral.movement!.capacityCollection = "occupants";
  const published = finalizePlanHashes(mechanics, { networkModels, objectModels });

  const sameLocalId = createGraphState() as ReturnType<typeof createGraphState> & {
    public: ReturnType<typeof createGraphState>["public"] & { occupants: Record<string, unknown> };
  };
  sameLocalId.public.occupants = {
    moving: {
      objectType: "fixture.vehicle",
      facets: { availability: "active" },
      attributes: { networkId: "neutral", nodeId: "destination", actionPoints: 0 }
    }
  };
  assert.doesNotThrow(() => checkMechanicsBundle(published, {
    initialState: sameLocalId,
    networkModels,
    objectModels
  }));
  assert.throws(
    () => executeMechanicsTransaction({
      mechanics: published,
      plan: published.plans.traverse,
      state: sameLocalId,
      actorContext: { sessionRole: "player" },
      networkModels,
      objectModels
    }),
    (error) => error instanceof MechanicsExecutionError && error.code === "MECHANICS_GRAPH_CAPACITY"
  );

  const foreignGraph = structuredClone(sameLocalId);
  (foreignGraph.public.occupants.moving as any).attributes.networkId = "another-network";
  const moved = executeMechanicsTransaction({
    mechanics: published,
    plan: published.plans.traverse,
    state: foreignGraph,
    actorContext: { sessionRole: "player" },
    networkModels,
    objectModels
  });
  assert.equal((moved.candidateState.public as any).vehicles.moving.attributes.nodeId, "destination");

  const corrupt = structuredClone(sameLocalId);
  delete (corrupt.public.occupants.moving as any).facets.availability;
  assert.throws(
    () => executeMechanicsTransaction({
      mechanics: published,
      plan: published.plans.traverse,
      state: corrupt,
      actorContext: { sessionRole: "player" },
      networkModels,
      objectModels
    }),
    (error) => error instanceof MechanicsExecutionError && error.code === "MECHANICS_GRAPH_CAPACITY_STATE_MISSING"
  );
});

test("domain collection scans charge ignored entries and publication budgets their declared capacity", () => {
  const networkModels = createGraphNetworkModels();
  const objectModels = createGraphObjectModels();
  const mechanics = finalizePlanHashes(createGraphMechanics(), { networkModels, objectModels });
  const checked = checkMechanicsBundle(mechanics, { networkModels, objectModels }) as {
    costs: Record<string, { scannedEntities: number }>;
  };

  assert.equal(
    checked.costs.insert.scannedEntities,
    mechanics.stateModel.collections.edges.capacity * 2,
    "route conflict detection and explicit id allocation each reserve one complete edge scan"
  );

  const state = createGraphState();
  const edges = state.public.edges as Record<string, Record<string, unknown>>;
  edges.foreignA = {
    objectType: "fixture.edge",
    facets: { state: "open" },
    attributes: { networkId: "another-network" }
  };
  edges.foreignB = {
    objectType: "fixture.edge",
    facets: { state: "open" },
    attributes: { networkId: "another-network" }
  };
  const output = executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.insert,
    state,
    actorContext: { sessionRole: "player" },
    networkModels,
    objectModels
  });

  assert.equal(
    output.cost.scannedEntities,
    Object.keys(edges).length,
    "non-matching collection entries are still inspected and must consume runtime budget"
  );
});

function createIndependentDeckMechanics(): CubicaMechanicsIRV1Alpha1 {
  return finalizePlanHashes({
    apiVersion: "cubica.dev/mechanics/v1alpha1",
    budgetProfile: "turn-based-standard-v1",
    moduleLock: recommendedModuleLock(["cubica.deck"]),
    stateModel: {
      types: {},
      endpoints: {},
      collections: {
        newsCards: {
          audienceRef: "server",
          storage: { root: "secret", segments: ["cards", "news"] },
          capacity: 16,
          stableKey: "map-key",
          itemTypes: ["fixture.news-card"],
          fields: {}
        },
        cargoCards: {
          audienceRef: "server",
          storage: { root: "secret", segments: ["cards", "cargo"] },
          capacity: 16,
          stableKey: "map-key",
          itemTypes: ["fixture.cargo-card"],
          fields: {}
        }
      },
      events: {}
    },
    plans: {
      shuffleNews: {
        planHash: HASH,
        transaction: {
          steps: [{
            id: "shuffleNews",
            kind: "command",
            op: "deck.shuffle",
            deckId: "news",
            sourceCollection: "newsCards",
            stream: "deck.news"
          }]
        }
      },
      shuffleCargo: {
        planHash: HASH,
        transaction: {
          steps: [{
            id: "shuffleCargo",
            kind: "command",
            op: "deck.shuffle",
            deckId: "cargo",
            sourceCollection: "cargoCards",
            stream: "deck.cargo"
          }]
        }
      }
    }
  });
}

function createIndependentDeckState(): Record<string, unknown> {
  const card = (objectType: string) => ({ objectType, facets: {}, attributes: {} });
  return {
    public: {},
    secret: {
      random: createSessionRandomStreamsState("0123456789abcdeffedcba9876543210"),
      decks: {},
      cards: {
        news: Object.fromEntries(Array.from({ length: 8 }, (_, index) => `n${index + 1}`)
          .map((id) => [id, card("fixture.news-card")])),
        cargo: Object.fromEntries(Array.from({ length: 8 }, (_, index) => `c${index + 1}`)
          .map((id) => [id, card("fixture.cargo-card")]))
      }
    }
  };
}

function createGraphMechanics(): CubicaMechanicsIRV1Alpha1 {
  return {
    apiVersion: "cubica.dev/mechanics/v1alpha1",
    budgetProfile: "turn-based-standard-v1",
    moduleLock: recommendedModuleLockForOperations([
      "graph.regions.route.plan",
      "core.collection.id.allocate",
      "core.resource.transfer",
      "core.entity.create",
      "core.entities.order",
      "graph.edge.split",
      "graph.entity.traverse"
    ]),
    stateModel: {
      types: {
        "core.integer": { kind: "integer", minimum: 0, maximum: 1_000 },
        "core.string": { kind: "string" },
        "core.optional-string": { kind: "option", itemType: "core.string" },
        "core.coordinate": { kind: "finite-number", minimum: -1_000_000_000, maximum: 1_000_000_000 },
        "fixture.vehicle-lifecycle": { kind: "enum", values: ["active", "reserve"] },
        "core.graph-json": { kind: "json", maxDepth: 16, maxNodes: 4_096, maxUtf8Bytes: 256 * 1_024 }
      },
      endpoints: {
        wallet: {
          audienceRef: "public",
          storage: { root: "public", segments: ["wallet"] },
          valueType: "core.integer",
          access: "read-write"
        },
        sequence: {
          audienceRef: "public",
          storage: { root: "public", segments: ["transport", "sequence"] },
          valueType: "core.integer",
          access: "read-write"
        }
      },
      collections: {
        nodes: {
          audienceRef: "public",
          storage: { root: "public", segments: ["nodes"] },
          capacity: 32,
          stableKey: "map-key",
          itemTypes: ["fixture.terminal", "fixture.waypoint"],
          fields: {
            availability: {
              storage: { kind: "facet", name: "availability" },
              valueType: "core.string",
              access: "read-only"
            },
            networkId: {
              storage: { kind: "attribute", name: "networkId" },
              valueType: "core.string",
              access: "read-only"
            },
            position: {
              storage: { kind: "attribute", name: "position" },
              valueType: "core.graph-json",
              access: "read-write"
            },
            positionX: {
              source: { kind: "nested-field", field: "position", path: ["x"] },
              valueType: "core.coordinate",
              access: "read-only"
            }
          }
        },
        edges: {
          audienceRef: "public",
          storage: { root: "public", segments: ["edges"] },
          capacity: 32,
          stableKey: "map-key",
          itemTypes: ["fixture.edge"],
          fields: {
            state: {
              storage: { kind: "facet", name: "state" },
              valueType: "core.string",
              access: "read-only"
            },
            networkId: {
              storage: { kind: "attribute", name: "networkId" },
              valueType: "core.string",
              access: "read-only"
            },
            fromNodeId: {
              storage: { kind: "attribute", name: "fromNodeId" },
              valueType: "core.string",
              access: "read-only"
            },
            toNodeId: {
              storage: { kind: "attribute", name: "toNodeId" },
              valueType: "core.string",
              access: "read-only"
            },
            geometry: {
              storage: { kind: "attribute", name: "geometry" },
              valueType: "core.graph-json",
              access: "read-write"
            },
            constructionCost: {
              storage: { kind: "attribute", name: "constructionCost" },
              valueType: "core.integer",
              access: "read-only"
            },
            regionSegments: {
              storage: { kind: "attribute", name: "regionSegments" },
              valueType: "core.integer",
              access: "read-only"
            },
            splitFromEdgeId: {
              storage: { kind: "attribute", name: "splitFromEdgeId" },
              valueType: "core.string",
              access: "read-only"
            }
          }
        },
        vehicles: {
          audienceRef: "public",
          storage: { root: "public", segments: ["vehicles"] },
          capacity: 8,
          stableKey: "map-key",
          itemTypes: ["fixture.vehicle"],
          fields: {
            availability: {
              storage: { kind: "facet", name: "availability" },
              valueType: "fixture.vehicle-lifecycle",
              access: "read-only"
            },
            networkId: {
              storage: { kind: "attribute", name: "networkId" },
              valueType: "core.string",
              access: "read-only"
            },
            nodeId: {
              storage: { kind: "attribute", name: "nodeId" },
              valueType: "core.string",
              access: "read-write"
            },
            actionPoints: {
              storage: { kind: "attribute", name: "actionPoints" },
              valueType: "core.integer",
              access: "read-write"
            }
          }
        },
        trailers: {
          audienceRef: "public",
          storage: { root: "public", segments: ["trailers"] },
          capacity: 8,
          stableKey: "map-key",
          itemTypes: ["fixture.trailer"],
          fields: {
            networkId: {
              storage: { kind: "attribute", name: "networkId" },
              valueType: "core.string",
              access: "read-only"
            },
            attachedVehicleId: {
              storage: { kind: "attribute", name: "attachedVehicleId" },
              valueType: "core.optional-string",
              access: "read-write"
            },
            nodeId: {
              storage: { kind: "attribute", name: "nodeId" },
              valueType: "core.string",
              access: "read-write"
            }
          }
        }
      },
      events: {}
    },
    plans: {
      insert: {
        planHash: HASH,
        transaction: {
          steps: [
            {
              id: "route",
              kind: "command",
              op: "graph.regions.route.plan",
              networkId: "neutral",
              fromNode: { op: "value.literal", value: "left" },
              toNode: { op: "value.literal", value: "right" }
            },
            {
              id: "edge-id",
              kind: "command",
              op: "core.collection.id.allocate",
              collection: "edges",
              sequence: { endpoint: "sequence" },
              prefix: "neutral:edge"
            },
            {
              id: "pay",
              kind: "command",
              op: "core.resource.transfer",
              from: { kind: "state", target: { endpoint: "wallet" } },
              to: { kind: "bank" },
              amount: { op: "value.literal", value: 8 },
              onInsufficient: "fail"
            },
            {
              id: "create-edge",
              kind: "command",
              op: "core.entity.create",
              visibility: "public",
              collection: "edges",
              entityId: { op: "value.result", stepId: "edge-id", path: ["id"] },
              objectType: "fixture.edge",
              facets: {
                state: { op: "value.literal", value: "open" }
              },
              attributes: {
                networkId: { op: "value.literal", value: "neutral" },
                fromNodeId: { op: "value.result", stepId: "route", path: ["fromNodeId"] },
                toNodeId: { op: "value.result", stepId: "route", path: ["toNodeId"] },
                geometry: { op: "value.result", stepId: "route", path: ["geometry"] },
                constructionCost: { op: "value.literal", value: 8 },
                regionSegments: { op: "value.result", stepId: "route", path: ["regionSegments"] }
              }
            }
          ]
        }
      },
      inspect: {
        planHash: HASH,
        transaction: {
          steps: [{
            id: "inspect",
            kind: "algorithm",
            op: "graph.edge.position.inspect",
            networkId: "neutral",
            edge: { op: "value.literal", value: "neutral:edge:42" },
            position: { op: "value.literal", value: 1 / 3 }
          }]
        }
      },
      split: {
        planHash: HASH,
        transaction: {
          steps: [
            {
              id: "inspect",
              kind: "algorithm",
              op: "graph.edge.position.inspect",
              networkId: "neutral",
              edge: { op: "value.literal", value: "neutral:edge:42" },
              position: { op: "value.literal", value: 0.5 }
            },
            {
              id: "allowed-region",
              kind: "assert",
              op: "core.assert",
              predicate: {
                op: "predicate.set.disjoint",
                left: {
                  op: "value.result",
                  stepId: "inspect",
                  path: ["pointRegionIds"]
                },
                right: {
                  op: "value.result",
                  stepId: "inspect",
                  path: ["endpoints", "regionIds"]
                }
              },
              errorCode: "FIXTURE_POINT_TOO_CLOSE"
            },
            {
              id: "split",
              kind: "command",
              op: "graph.edge.split",
              networkId: "neutral",
              proof: { op: "value.result", stepId: "inspect" }
            }
          ]
        }
      },
      orderNodes: {
        planHash: HASH,
        transaction: {
          steps: [
            {
              id: "selected-nodes",
              kind: "query",
              op: "core.entities.select",
              selector: {
                collection: "nodes",
                cardinality: { min: 0, max: 32 }
              }
            },
            {
              id: "ordered-nodes",
              kind: "command",
              op: "core.entities.order",
              selection: { op: "value.result", stepId: "selected-nodes" },
              keys: [{
                source: { kind: "current-field", field: "positionX" },
                direction: "descending",
                missing: "error"
              }],
              tieBreak: { kind: "canonical-id" }
            }
          ]
        }
      },
      staleSplit: {
        planHash: HASH,
        transaction: {
          steps: [
            {
              id: "inspect",
              kind: "algorithm",
              op: "graph.edge.position.inspect",
              networkId: "neutral",
              edge: { op: "value.literal", value: "neutral:edge:42" },
              position: { op: "value.literal", value: 0.5 }
            },
            {
              id: "mutate",
              kind: "command",
              op: "core.entity.attributes.patch",
              entity: {
                collection: "edges",
                entityId: { op: "value.literal", value: "neutral:edge:42" }
              },
              patches: [{
                operation: "set",
                path: ["geometry"],
                value: {
                  op: "value.literal",
                  value: {
                    from: { x: 1, y: 5 },
                    to: { x: 9, y: 5 },
                    polyline: [{ x: 1, y: 5 }, { x: 5, y: 6 }, { x: 9, y: 5 }]
                  }
                }
              }]
            },
            {
              id: "split",
              kind: "command",
              op: "graph.edge.split",
              networkId: "neutral",
              proof: { op: "value.result", stepId: "inspect" }
            }
          ]
        }
      },
      staleEndpointSplit: {
        planHash: HASH,
        transaction: {
          steps: [
            {
              id: "inspect",
              kind: "algorithm",
              op: "graph.edge.position.inspect",
              networkId: "neutral",
              edge: { op: "value.literal", value: "neutral:edge:42" },
              position: { op: "value.literal", value: 0.5 }
            },
            {
              id: "mutate-endpoint",
              kind: "command",
              op: "core.entity.attributes.patch",
              entity: {
                collection: "nodes",
                entityId: { op: "value.literal", value: "right" }
              },
              patches: [{
                operation: "set",
                path: ["position"],
                value: { op: "value.literal", value: { x: 8.5, y: 5 } }
              }]
            },
            {
              id: "split",
              kind: "command",
              op: "graph.edge.split",
              networkId: "neutral",
              proof: { op: "value.result", stepId: "inspect" }
            }
          ]
        }
      },
      traverse: {
        planHash: HASH,
        transaction: {
          steps: [
            {
              id: "traverse",
              kind: "command",
              op: "graph.entity.traverse",
              networkId: "neutral",
              entity: { op: "value.literal", value: "moving" },
              edge: { op: "value.literal", value: "route" }
            },
            {
              id: "spend-action-point",
              kind: "command",
              op: "core.resource.transfer",
              from: {
                kind: "entity-field",
                entity: {
                  collection: "vehicles",
                  entityId: { op: "value.literal", value: "moving" }
                },
                field: "actionPoints"
              },
              to: { kind: "bank" },
              amount: { op: "value.literal", value: 1 },
              onInsufficient: "fail"
            }
          ]
        }
      }
    }
  };
}

function createGraphNetworkModels(): GameManifestTransportNetworkModelMap {
  return {
    neutral: {
      visibility: "public",
      nodeCollection: "nodes",
      edgeCollection: "edges",
      waypointObjectType: "fixture.waypoint",
      edgeObjectType: "fixture.edge",
      nodeStateFacet: "availability",
      buildableNodeStates: ["open"],
      edgeStateFacet: "state",
      splittableEdgeStates: ["open"],
      builtEdgeState: "open",
      sequenceEndpoint: "sequence",
      regions: [
        {
          id: "left-field",
          polygon: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }]
        },
        {
          id: "middle-field",
          polygon: [{ x: 3, y: 0 }, { x: 7, y: 0 }, { x: 7, y: 10 }, { x: 3, y: 10 }, { x: 3, y: 0 }]
        },
        {
          id: "right-field",
          polygon: [{ x: 7, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 7, y: 10 }, { x: 7, y: 0 }]
        }
      ],
      movement: {
        vehicleCollection: "vehicles",
        vehicleObjectTypes: ["fixture.vehicle"],
        vehicleStateFacet: "availability",
        movableVehicleStates: ["active"],
        locationAttribute: "nodeId",
        traversableNodeStates: ["open"],
        traversableEdgeStates: ["open"],
        capacityCollection: "vehicles",
        capacityObjectTypes: ["fixture.vehicle"],
        capacityLocationAttribute: "nodeId",
        capacityStateFacet: "availability",
        capacityOccupyingStates: ["active"],
        maxVehiclesPerNode: 1,
        coupledCollection: "trailers",
        coupledObjectTypes: ["fixture.trailer"],
        coupledVehicleAttribute: "attachedVehicleId",
        coupledLocationAttribute: "nodeId"
      }
    }
  };
}

function createGraphObjectModels(): GameManifestObjectModelMap {
  return {
    "fixture.waypoint": {
      collection: "nodes",
      idField: "id",
      scope: "session",
      facets: { availability: { initial: "open", values: ["open"] } }
    },
    "fixture.edge": {
      collection: "edges",
      idField: "id",
      scope: "session",
      facets: { state: { initial: "open", values: ["open"] } }
    }
  };
}

function createGraphState() {
  return {
    public: {
      transport: { sequence: 41 },
      wallet: 10,
      nodes: {
        left: {
          objectType: "fixture.terminal",
          facets: { availability: "open" },
          attributes: { networkId: "neutral", position: { x: 1, y: 5 } }
        },
        right: {
          objectType: "fixture.terminal",
          facets: { availability: "open" },
          attributes: { networkId: "neutral", position: { x: 9, y: 5 } }
        },
        destination: {
          objectType: "fixture.terminal",
          facets: { availability: "open" },
          attributes: { networkId: "neutral", position: { x: 5, y: 8 } }
        }
      },
      edges: {
        route: {
          objectType: "fixture.edge",
          facets: { state: "open" },
          attributes: {
            networkId: "neutral",
            fromNodeId: "left",
            toNodeId: "destination",
            geometry: { from: { x: 1, y: 5 }, to: { x: 5, y: 8 } }
          }
        }
      },
      vehicles: {
        moving: {
          objectType: "fixture.vehicle",
          facets: { availability: "active" },
          attributes: { networkId: "neutral", nodeId: "left", actionPoints: 2 }
        },
        reserve: {
          objectType: "fixture.vehicle",
          facets: { availability: "reserve" },
          attributes: { networkId: "neutral", nodeId: "destination", actionPoints: 0 }
        }
      },
      trailers: {}
    },
    secret: {}
  };
}
