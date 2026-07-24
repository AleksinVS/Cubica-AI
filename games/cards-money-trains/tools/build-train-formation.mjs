#!/usr/bin/env node
/**
 * Build game-local, refresh-safe train formation for the current locomotive.
 *
 * The facilitator selects or unselects wagons one scalar id at a time. The selected target
 * locomotive is stored on each wagon in public session state, so a refresh
 * cannot lose the draft and no Game Intent needs an array parameter. Final
 * confirmation selects the marked group on the server, validates every member,
 * attaches each wagon through the neutral bounded `core.entities.each`
 * operation, spends exactly one locomotive action point and clears the markers
 * in one atomic transaction.
 *
 * This generator owns only `movement.train.*` actions, plans, state fields,
 * board controls and the formation journal event. It composes after the four
 * existing Cards Money Trains generators and does not change Runtime contracts.
 */

import assert from "node:assert/strict";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptFile = fileURLToPath(import.meta.url);
const toolsRoot = path.dirname(scriptFile);
const gameRoot = path.resolve(toolsRoot, "..");
const authoringPath = path.join(gameRoot, "authoring", "game.authoring.json");

const normalFixtureId = "normal-start-policy";
const formationActionIds = new Set([
  "movement.train.wagon.select",
  "movement.train.wagon.unselect",
  "movement.train.attach.selected"
]);
// The first draft exposed one conditional toggle intent.  It is intentionally
// owned here only for migration cleanup: it must never be reinserted because
// its two conditional writes can observe different candidate states.
const ownedFormationActionIds = new Set([
  ...formationActionIds,
  "movement.train.wagon.toggle"
]);
const injectedSkipStepIds = new Set([
  "formation-selected-for-skipped-locomotive",
  "formation-clear-skipped-selection"
]);

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));
const literal = (value) => ({ op: "value.literal", value });
const param = (name) => ({ op: "value.param", name });
const state = (endpoint) => ({ op: "value.state", ref: { endpoint } });
const result = (stepId, pathSegments) => ({
  op: "value.result",
  stepId,
  ...(pathSegments ? { path: pathSegments } : {})
});
const itemId = () => ({ op: "value.item", area: "identity", field: "id" });
const entityValue = (collection, entityId, field) => ({
  op: "value.entity",
  entity: { collection, entityId },
  field
});
const compare = (operator, left, right) => ({
  op: "predicate.compare",
  operator,
  left,
  right
});
const all = (...items) => ({ op: "predicate.all", items });

/** Create one facilitator-only action backed by a game-local Mechanics plan. */
const action = ({ id, label, semantics, paramsSchema }) => ({
  id,
  _type: "game.Action",
  _label: label,
  _semantics: semantics,
  capabilityFamily: "runtime.server",
  capability: id,
  displayName: label,
  allowedSessionRoles: ["facilitator"],
  ...(paramsSchema ? { paramsSchema } : {}),
  binding: {
    kind: "mechanics-plan",
    planRef: id
  }
});

/** The client may identify one public wagon but never the current locomotive. */
const wagonParams = {
  type: "object",
  additionalProperties: false,
  properties: {
    wagonId: {
      type: "string",
      maxLength: 128,
      "x-cubica-ref": {
        kind: "object",
        collection: "wagons",
        network: "main",
        allowedTypes: ["transport.wagon"],
        visibility: "public"
      }
    }
  },
  required: ["wagonId"]
};

const currentLocomotiveId = () =>
  state("public.movement.currentLocomotiveId");
const turnNumber = () => state("public.session.turnNumber");

/** Common fail-closed predicate for every current-locomotive formation action. */
const currentLocomotiveGuard = () => all(
  compare("eq", state("public.session.fixtureId"), literal(normalFixtureId)),
  compare("eq", state("public.session.phase"), literal("operations")),
  {
    op: "predicate.entity.matches",
    entity: {
      collection: "locomotives",
      entityId: currentLocomotiveId()
    },
    objectType: "transport.locomotive",
    facets: { availability: literal("active") },
    attributes: { turnOrderCount: literal(1) }
  },
  compare(
    "ne",
    entityValue(
      "locomotives",
      currentLocomotiveId(),
      "movementResolvedTurn"
    ),
    turnNumber()
  )
);

/**
 * Prove that public current still belongs to the immutable server order.
 *
 * The result is intentionally unused: `core.sequence.next` rejects a missing
 * current reference before any marker, relation or action-point write.
 */
const validateCurrentOrderStep = () => ({
  id: "formation-validate-current-in-order",
  kind: "query",
  op: "core.sequence.next",
  items: state("public.movement.locomotiveOrder"),
  current: currentLocomotiveId(),
  exclude: {
    collection: "locomotives",
    field: "movementResolvedTurn",
    values: [turnNumber()]
  }
});

const actionPointGuardStep = () => ({
  id: "formation-has-action-point",
  kind: "assert",
  op: "core.assert",
  predicate: compare(
    "gte",
    entityValue("locomotives", currentLocomotiveId(), "actionPoints"),
    literal(1)
  ),
  errorCode: "ACTION_POINTS_EXHAUSTED"
});

/** Select one eligible wagon without accepting a locomotive id. */
const buildSelectWagon = () => {
  const id = "movement.train.wagon.select";
  const eligibleToSelect = all(
    {
      op: "predicate.entity.matches",
      entity: {
        collection: "wagons",
        entityId: param("wagonId")
      },
      objectType: "transport.wagon",
      facets: { availability: literal("active") },
      attributes: {
        networkId: literal("main"),
        nodeId: entityValue(
          "locomotives",
          currentLocomotiveId(),
          "nodeId"
        ),
        attachedVehicleId: literal(null),
        formationTargetLocomotiveId: literal(null)
      }
    }
  );

  return {
    action: action({
      id,
      label: "Отметить вагон",
      semantics:
        "Сохраняет серверный маркер одного свободного вагона для текущего локомотива; окончательное сцепление выполняется отдельным групповым подтверждением.",
      paramsSchema: wagonParams
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "formation-select-current-guard",
            kind: "assert",
            op: "core.assert",
            predicate: currentLocomotiveGuard(),
            errorCode: "TRAIN_FORMATION_CURRENT_INVALID"
          },
          validateCurrentOrderStep(),
          actionPointGuardStep(),
          {
            id: "formation-select-wagon-guard",
            kind: "assert",
            op: "core.assert",
            predicate: eligibleToSelect,
            errorCode: "TRAIN_FORMATION_WAGON_INVALID"
          },
          {
            id: "formation-mark-one-selection",
            kind: "command",
            op: "core.entity.attributes.patch",
            entity: {
              collection: "wagons",
              entityId: param("wagonId")
            },
            patches: [{
              operation: "set",
              path: ["formationTargetLocomotiveId"],
              value: currentLocomotiveId()
            }]
          }
        ]
      }
    }
  };
};

/**
 * Remove one marker with a separate intent.
 *
 * Select and unselect cannot safely be two conditional patches in one plan:
 * each `when` is evaluated against the evolving candidate transaction, so the
 * first patch could make the opposite branch true. Separate guarded intents
 * keep the transition unambiguous and preserve atomicity.
 */
const buildUnselectWagon = () => {
  const id = "movement.train.wagon.unselect";
  return {
    action: action({
      id,
      label: "Снять отметку с вагона",
      semantics:
        "Удаляет серверный маркер одного вагона текущего локомотива, не изменяя состав и запас хода.",
      paramsSchema: wagonParams
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "formation-unselect-current-guard",
            kind: "assert",
            op: "core.assert",
            predicate: currentLocomotiveGuard(),
            errorCode: "TRAIN_FORMATION_CURRENT_INVALID"
          },
          validateCurrentOrderStep(),
          actionPointGuardStep(),
          {
            id: "formation-unselect-wagon-guard",
            kind: "assert",
            op: "core.assert",
            predicate: {
              op: "predicate.entity.matches",
              entity: {
                collection: "wagons",
                entityId: param("wagonId")
              },
              objectType: "transport.wagon",
              attributes: {
                formationTargetLocomotiveId: currentLocomotiveId()
              }
            },
            errorCode: "TRAIN_FORMATION_WAGON_NOT_SELECTED"
          },
          {
            id: "formation-clear-one-selection",
            kind: "command",
            op: "core.entity.attributes.patch",
            entity: {
              collection: "wagons",
              entityId: param("wagonId")
            },
            patches: [{
              operation: "set",
              path: ["formationTargetLocomotiveId"],
              value: literal(null)
            }]
          }
        ]
      }
    }
  };
};

/**
 * Attach the complete server-selected group for one action point.
 *
 * Raw and valid selections are compared before the loop. A stale, moved,
 * attached or incompatible marked wagon therefore aborts before any relation
 * write; the transaction would also roll back atomically if a later neutral
 * capacity check rejects one iteration.
 */
const buildAttachSelected = (networkCapacity) => {
  const id = "movement.train.attach.selected";
  return {
    action: action({
      id,
      label: "Прицепить отмеченные вагоны",
      semantics:
        "Атомарно прицепляет все отмеченные сервером вагоны к текущему локомотиву и списывает одну единицу хода за всю группу."
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "formation-confirm-current-guard",
            kind: "assert",
            op: "core.assert",
            predicate: currentLocomotiveGuard(),
            errorCode: "TRAIN_FORMATION_CURRENT_INVALID"
          },
          validateCurrentOrderStep(),
          actionPointGuardStep(),
          {
            id: "formation-selected-wagons-raw",
            kind: "query",
            op: "core.entities.select",
            selector: {
              collection: "wagons",
              attributes: {
                formationTargetLocomotiveId: currentLocomotiveId()
              },
              cardinality: { min: 1, max: networkCapacity }
            }
          },
          {
            id: "formation-selected-wagons-valid",
            kind: "query",
            op: "core.entities.select",
            selector: {
              collection: "wagons",
              objectTypes: ["transport.wagon"],
              facets: { availability: literal("active") },
              attributes: {
                networkId: literal("main"),
                nodeId: entityValue(
                  "locomotives",
                  currentLocomotiveId(),
                  "nodeId"
                ),
                attachedVehicleId: literal(null),
                formationTargetLocomotiveId: currentLocomotiveId()
              },
              cardinality: { min: 0, max: networkCapacity }
            }
          },
          {
            id: "formation-selected-wagons-consistent",
            kind: "assert",
            op: "core.assert",
            predicate: compare(
              "eq",
              result("formation-selected-wagons-raw", ["ids"]),
              result("formation-selected-wagons-valid", ["ids"])
            ),
            errorCode: "TRAIN_FORMATION_SELECTION_INVALID"
          },
          {
            id: "formation-attach-each-selected",
            kind: "command",
            op: "core.entities.each",
            selection: result("formation-selected-wagons-valid"),
            body: [{
              id: "formation-attach-selected-item",
              kind: "command",
              op: "relation.attach",
              networkId: "main",
              primary: currentLocomotiveId(),
              related: [itemId()]
            }]
          },
          {
            id: "formation-spend-group-action",
            kind: "command",
            op: "core.entity.attributes.patch",
            entity: {
              collection: "locomotives",
              entityId: currentLocomotiveId()
            },
            patches: [{
              operation: "increment",
              path: ["actionPoints"],
              value: literal(-1)
            }]
          },
          {
            id: "formation-clear-successful-selection",
            kind: "command",
            op: "core.entities.update",
            selection: result("formation-selected-wagons-valid"),
            attributeValues: {
              formationTargetLocomotiveId: literal(null)
            }
          },
          {
            id: "formation-journal",
            kind: "command",
            op: "core.event.emit",
            eventType: "movement.train.formed",
            summary: literal("Отмеченные вагоны прицеплены к текущему локомотиву"),
            audience: "public",
            data: {
              kind: literal("train-formation"),
              locomotiveId: currentLocomotiveId(),
              wagonIds: result("formation-selected-wagons-valid", ["ids"]),
              wagonCount: result("formation-attach-each-selected", ["count"]),
              actionPointCost: literal(1),
              ownerTeamId: entityValue(
                "locomotives",
                currentLocomotiveId(),
                "ownerTeamId"
              ),
              turnNumber: turnNumber()
            }
          }
        ]
      }
    }
  };
};

/** Declare the persisted marker and exact public journal payload. */
const declareFormationState = (root) => {
  const stateModel = root.mechanics.stateModel;
  const wagonFields = stateModel.collections.wagons?.fields;
  assert.ok(wagonFields, "wagons collection is required");
  wagonFields.formationTargetLocomotiveId = {
    storage: {
      kind: "attribute",
      name: "formationTargetLocomotiveId"
    },
    valueType: "core.optional-string",
    access: "read-write"
  };

  Object.assign(stateModel.types, {
    "game.train-formation-wagon-ids": {
      kind: "list",
      itemType: "core.string",
      maxItems: root.networkModels.main.movement.maxCoupledVehicles
    },
    "game.train-formed-event": {
      kind: "record",
      fields: {
        kind: { typeRef: "core.string", optional: false },
        // Assertions prove a concrete current id, but the compiler deliberately
        // does not narrow optional state endpoints across transaction steps.
        locomotiveId: { typeRef: "core.optional-string", optional: false },
        wagonIds: { typeRef: "game.train-formation-wagon-ids", optional: false },
        wagonCount: { typeRef: "core.integer", optional: false },
        actionPointCost: { typeRef: "core.integer", optional: false },
        ownerTeamId: { typeRef: "core.string", optional: false },
        turnNumber: { typeRef: "core.integer", optional: false }
      }
    }
  });
  stateModel.events["movement.train.formed"] = {
    audienceRef: "public",
    payloadType: "game.train-formed-event",
    journalEndpoint: { endpoint: "public.log" }
  };

  for (const wagon of Object.values(root.state.public.objects.wagons)) {
    wagon.attributes.formationTargetLocomotiveId = null;
  }

  // Setup owns dynamic wagon creation. Injecting the field into every matching
  // create step keeps the ownership boundary intact without editing setup code.
  for (const plan of Object.values(root.mechanics.plans)) {
    for (const step of plan.transaction.steps) {
      if (step.op === "core.entity.create" && step.collection === "wagons") {
        step.attributes.formationTargetLocomotiveId = literal(null);
      }
    }
  }
};

/** Clear an abandoned draft when the facilitator skips its locomotive. */
const injectSkipCleanup = (root) => {
  const skipSteps =
    root.mechanics.plans["movement.locomotive.skip"]?.transaction.steps;
  assert.ok(skipSteps, "movement.locomotive.skip plan is required");
  const preserved = skipSteps.filter((step) => !injectedSkipStepIds.has(step.id));
  const resolveIndex = preserved.findIndex(
    (step) => step.id === "mark-current-resolved"
  );
  assert.notEqual(resolveIndex, -1, "skip resolution step is required");
  preserved.splice(resolveIndex, 0, {
    id: "formation-selected-for-skipped-locomotive",
    kind: "query",
    op: "core.entities.select",
    selector: {
      collection: "wagons",
      attributes: {
        formationTargetLocomotiveId: currentLocomotiveId()
      },
      cardinality: { min: 0, max: 64 }
    }
  }, {
    id: "formation-clear-skipped-selection",
    kind: "command",
    op: "core.entities.update",
    selection: result("formation-selected-for-skipped-locomotive"),
    attributeValues: {
      formationTargetLocomotiveId: literal(null)
    }
  });
  root.mechanics.plans["movement.locomotive.skip"].transaction.steps = preserved;
};

/** Insert owned values before skip while preserving every unrelated control. */
const insertBeforeSkip = (items, getId, additions) => {
  const preserved = items.filter(
    (candidate) => !ownedFormationActionIds.has(getId(candidate))
  );
  const skipIndex = preserved.findIndex(
    (candidate) => getId(candidate) === "movement.locomotive.skip"
  );
  const insertionIndex = skipIndex === -1 ? preserved.length : skipIndex;
  return [
    ...preserved.slice(0, insertionIndex),
    ...additions,
    ...preserved.slice(insertionIndex)
  ];
};

/**
 * Apply only the train-formation transformation to an existing four-generator
 * authoring document.
 */
const buildTrainFormationAuthoring = (sourceAuthoring) => {
  const authoring = structuredClone(sourceAuthoring);
  const root = authoring.root;
  const cargoSettlementReady =
    root.content.data.cargoSettlement !== undefined;
  const networkCapacity =
    root.networkModels.main?.movement?.maxCoupledVehicles;
  assert.equal(
    Number.isInteger(networkCapacity) && networkCapacity >= 1 && networkCapacity <= 64,
    true,
    "main network coupling capacity must be an integer from 1 to 64"
  );

  declareFormationState(root);
  injectSkipCleanup(root);

  const generated = [
    buildSelectWagon(),
    buildUnselectWagon(),
    buildAttachSelected(networkCapacity)
  ];
  root.logic.actions = insertBeforeSkip(
    root.logic.actions,
    (candidate) => candidate.id,
    generated.map((candidate) => candidate.action)
  );
  root.mechanics.plans = Object.fromEntries(insertBeforeSkip(
    Object.entries(root.mechanics.plans),
    ([planId]) => planId,
    generated.map((candidate) => [candidate.action.id, candidate.plan])
  ));

  const board = root.state.public.board;
  assert.ok(Array.isArray(board.availableActions), "board actions are required");
  board.availableActions = insertBeforeSkip(
    board.availableActions,
    (candidate) => candidate.actionId,
    [{
      id: "movement-train-wagon-select",
      label: "Отметить вагон",
      description:
        "Выберите один публичный вагон; текущий локомотив и допустимость проверит сервер.",
      actionId: "movement.train.wagon.select",
      phase: "operations",
      section: "movement"
    }, {
      id: "movement-train-wagon-unselect",
      label: "Снять отметку с вагона",
      description:
        "Выберите ранее отмеченный вагон текущего локомотива.",
      actionId: "movement.train.wagon.unselect",
      phase: "operations",
      section: "movement"
    }, {
      id: "movement-train-attach-selected",
      label: "Прицепить отмеченные вагоны",
      description:
        "Подтверждает всю серверную группу за одну единицу хода текущего локомотива.",
      actionId: "movement.train.attach.selected",
      phase: "operations",
      section: "movement"
    }]
  );

  const movementStep = root.logic.flows
    .find((flow) => flow.id === "facilitator")
    ?.steps.find((step) => step.id === "facilitator.movement-order-and-skip");
  assert.ok(movementStep, "facilitator movement step is required");
  movementStep.actionIds = insertBeforeSkip(
    movementStep.actionIds,
    (actionId) => actionId,
    [...formationActionIds]
  );

  root.content.data.trainFormation = {
    status: "executable-refresh-safe-group-attach",
    phase: "operations",
    currentLocomotive: "server-owned-public.movement.currentLocomotiveId",
    selection: "persisted-per-wagon-target-marker",
    scalarSelectionParam: "wagonId",
    selectionIntents: ["select", "unselect"],
    finalParams: "none",
    groupActionPointCost: 1,
    groupIteration: "core.entities.each-canonical-order",
    boundary: "current-locomotive-remains-active-and-unresolved"
  };
  const movementTurn = root.content.data.movementTurn;
  if (movementTurn && Array.isArray(movementTurn.unresolvedAfterBoundary)) {
    movementTurn.unresolvedAfterBoundary =
      movementTurn.unresolvedAfterBoundary.filter(
        (item) =>
          item !== "train-formation-loading-unloading-and-delivery"
          && (
            !cargoSettlementReady
            || item !== "loading-unloading-and-delivery"
          )
      );
    if (
      !cargoSettlementReady
      && !movementTurn.unresolvedAfterBoundary.includes("loading-unloading-and-delivery")
    ) {
      movementTurn.unresolvedAfterBoundary.unshift("loading-unloading-and-delivery");
    }
  }

  const blockers = new Set(root.config.runtimeBlockers);
  blockers.delete(
    "remaining market, train formation, cargo handling, settlement, construction and reporting workflows"
  );
  blockers.delete(
    "remaining market, cargo handling, settlement, construction and reporting workflows"
  );
  blockers.delete(
    "remaining market, cargo selection sequencing, construction and reporting workflows"
  );
  blockers.delete(
    "remaining market, cargo selection sequencing and reporting workflows"
  );
  blockers.delete("remaining market and reporting workflows");
  blockers.delete("remaining reporting workflows");
  const cargoPriorityReady =
    root.content.data.cardLifecycle?.cargoSelectionPriority !== undefined;
  const marketReady =
    root.content.data.operatingTurn?.market?.status === "executable";
  blockers.add(cargoSettlementReady
    ? (
        cargoPriorityReady && root.content.data.constructionCycle
          ? marketReady
            ? "remaining reporting workflows"
            : "remaining market and reporting workflows"
          : root.content.data.constructionCycle
            ? "remaining market, cargo selection sequencing and reporting workflows"
            : cargoPriorityReady
              ? "remaining market, construction and reporting workflows"
              : "remaining market, cargo selection sequencing, construction and reporting workflows"
      )
    : "remaining market, cargo handling, settlement, construction and reporting workflows");
  root.config.runtimeBlockers = [...blockers];
  root.config.runtimeReady = false;

  return authoring;
};

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const buildFromDisk = async () =>
  buildTrainFormationAuthoring(await readJson(authoringPath));

/** Replace generated authoring atomically so interruption cannot truncate it. */
const writeAtomically = async (filePath, content) => {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
};

const run = async (argv) => {
  const checkOnly = argv.length === 1 && argv[0] === "--check";
  if (argv.length > (checkOnly ? 1 : 0)) {
    throw new Error("usage: build-train-formation.mjs [--check]");
  }
  const sourceText = await readFile(authoringPath, "utf8");
  const builtText = serialize(await buildFromDisk());
  if (checkOnly) {
    assert.equal(
      sourceText,
      builtText,
      "train-formation authoring is stale; run build-train-formation.mjs"
    );
  } else {
    await writeAtomically(authoringPath, builtText);
  }
  process.stdout.write(
    `cards-money-trains: ${checkOnly ? "verified" : "built"} refresh-safe group train formation\n`
  );
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  run(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export {
  authoringPath,
  buildFromDisk,
  buildTrainFormationAuthoring
};
