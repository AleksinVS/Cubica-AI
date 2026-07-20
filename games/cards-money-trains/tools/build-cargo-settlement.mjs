#!/usr/bin/env node
/**
 * Build normal-session cargo loading and post-movement settlement.
 *
 * This game-local generator deliberately composes only already accepted
 * Mechanics operations. The browser may identify a public wagon and, while
 * loading, a public cargo card. Ownership, phase, locomotive, route, balances
 * and tariff are always derived from the authoritative session state.
 *
 * Ownership boundary:
 * - this file owns the four normal cargo/settlement actions and plans;
 * - this file strengthens the existing game-local cargo macros used by both
 *   the normal slice and the protected technical replay;
 * - movement still owns locomotive resolution, while this later slice changes
 *   only its final phase destination from construction to settlement;
 * - market sequencing and the one-card terminal policy remain unresolved and
 *   are not invented here.
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
const ownedActionIds = new Set([
  "cargo.load",
  "cargo.phase.finish",
  "settlement.cargo.deliver",
  "settlement.phase.finish"
]);
const ownedFlowStepIds = new Set([
  "facilitator.cargo-loading",
  "facilitator.cargo-settlement"
]);
const broadRuntimeBlockers = new Set([
  "remaining market, movement, settlement, construction and reporting workflows",
  "remaining market, real graph movement, settlement, construction and reporting workflows",
  "remaining market, train formation, cargo handling, settlement, construction and reporting workflows",
  "remaining market, cargo handling, settlement, construction and reporting workflows"
]);
const preciseRuntimeBlocker =
  "remaining market, cargo selection sequencing, construction and reporting workflows";
const postConstructionRuntimeBlocker =
  "remaining market, cargo selection sequencing and reporting workflows";
const postCargoPriorityRuntimeBlocker =
  "remaining market and reporting workflows";
const preConstructionPostCargoPriorityRuntimeBlocker =
  "remaining market, construction and reporting workflows";

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));
const literal = (value) => ({ op: "value.literal", value });
const param = (name) => ({ op: "value.param", name });
const state = (endpoint) => ({ op: "value.state", ref: { endpoint } });
const result = (stepId, pathSegments) => ({
  op: "value.result",
  stepId,
  ...(pathSegments ? { path: pathSegments } : {})
});
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
const exists = (value, expected = true) => ({
  op: "predicate.exists",
  value,
  exists: expected
});
const coalesceString = (value) => ({
  op: "value.coalesce",
  items: [value, literal("")]
});
const add = (...items) => ({ op: "number.add", items });
const multiply = (...items) => ({ op: "number.multiply", items });

/** Create one facilitator-only intent backed by a game-local Mechanics plan. */
const action = ({ id, label, semantics, paramsSchema }) => ({
  id,
  _type: "game.Action",
  _label: label,
  _semantics: semantics,
  capabilityFamily: "runtime.server",
  capability: id,
  displayName: label,
  allowedSessionRoles: ["facilitator"],
  paramsSchema,
  binding: {
    kind: "mechanics-plan",
    planRef: id
  }
});

/** Closed no-parameter input prevents accidental authority from reaching a plan. */
const noParams = {
  type: "object",
  additionalProperties: false,
  properties: {}
};

/** Build one public, typed object reference used by a flat action payload. */
const objectParam = ({ collection, objectType, network }) => ({
  type: "string",
  maxLength: 128,
  "x-cubica-ref": {
    kind: "object",
    collection,
    ...(network ? { network } : {}),
    allowedTypes: [objectType],
    visibility: "public"
  }
});

const loadParams = {
  type: "object",
  additionalProperties: false,
  properties: {
    wagonId: objectParam({
      collection: "wagons",
      objectType: "transport.wagon",
      network: "main"
    }),
    cargoId: objectParam({
      collection: "cargoOrders",
      objectType: "transport.cargo"
    })
  },
  required: ["wagonId", "cargoId"]
};

const deliveryParams = {
  type: "object",
  additionalProperties: false,
  properties: {
    wagonId: objectParam({
      collection: "wagons",
      objectType: "transport.wagon",
      network: "main"
    })
  },
  required: ["wagonId"]
};

const normalPhaseGuard = (phase) => all(
  compare("eq", state("public.session.fixtureId"), literal(normalFixtureId)),
  compare("eq", state("public.session.phase"), literal(phase))
);

/**
 * Loading is safe before queue preparation or after every saved wagon slot is
 * resolved. While a queue has a current wagon, loading could change eligibility
 * beneath the immutable order, so the server rejects it atomically.
 */
const cargoQueueInactive = () => ({
  op: "predicate.any",
  items: [
    compare(
      "ne",
      state("public.cards.cargo.preparedTurn"),
      state("public.session.turnNumber")
    ),
    all(
      compare(
        "eq",
        state("public.cards.cargo.preparedTurn"),
        state("public.session.turnNumber")
      ),
      compare(
        "eq",
        state("public.cards.cargo.selectionOrder"),
        literal([])
      ),
      compare(
        "eq",
        state("public.cards.cargo.currentWagonId"),
        literal(null)
      ),
      compare(
        "eq",
        state("public.cards.cargo.offer.terminalId"),
        literal(null)
      )
    )
  ]
});

const wagonOwner = (wagonId) =>
  entityValue("wagons", wagonId, "ownerTeamId");
const wagonCargo = (wagonId) =>
  entityValue("wagons", wagonId, "cargoId");
const wagonLocomotive = (wagonId) =>
  entityValue("wagons", wagonId, "attachedVehicleId");
const concreteCargo = (wagonId) => coalesceString(wagonCargo(wagonId));
const concreteLocomotive = (wagonId) => coalesceString(wagonLocomotive(wagonId));
const locomotiveOwner = (wagonId) =>
  entityValue("locomotives", concreteLocomotive(wagonId), "ownerTeamId");
const turnNumber = () => state("public.session.turnNumber");

/**
 * Replace the old proof-oriented load macro with the complete normal rule.
 *
 * An attached wagon is intentionally allowed: trains persist between turns,
 * and the accepted rules define “free wagon” by its empty cargo slot.
 */
const buildLoadMacro = () => {
  const wagonId = { $macroInput: "containerId" };
  const cargoId = { $macroInput: "itemId" };
  const ownerTeamId = wagonOwner(wagonId);
  const originNodeId = entityValue("cargoOrders", cargoId, "fromNodeId");
  return {
    inputs: {
      containerId: { kind: "value-expression" },
      itemId: { kind: "value-expression" }
    },
    steps: [
      {
        id: "validate",
        kind: "assert",
        op: "core.assert",
        predicate: all(
          {
            op: "predicate.entity.matches",
            entity: { collection: "wagons", entityId: wagonId },
            objectType: "transport.wagon",
            facets: { availability: literal("active") },
            attributes: {
              cargoId: literal(null),
              nodeId: originNodeId,
              networkId: entityValue("cargoOrders", cargoId, "networkId")
            }
          },
          {
            op: "predicate.entity.matches",
            entity: { collection: "cargoOrders", entityId: cargoId },
            objectType: "transport.cargo",
            facets: { status: literal("available") },
            attributes: { holderTeamId: ownerTeamId }
          },
          compare(
            "eq",
            entityValue("networkNodes", originNodeId, "availability"),
            literal("open")
          ),
          compare(
            "eq",
            entityValue("teams", ownerTeamId, "type"),
            literal("logistics_company")
          )
        ),
        errorCode: "CARGO_LOAD_INVALID"
      },
      {
        id: "store-item",
        kind: "command",
        op: "core.entity.attributes.patch",
        entity: { collection: "wagons", entityId: wagonId },
        patches: [{
          operation: "set",
          path: ["cargoId"],
          value: cargoId
        }]
      },
      {
        id: "mark-in-transit",
        kind: "command",
        op: "core.entity.facet.set",
        entity: { collection: "cargoOrders", entityId: cargoId },
        facet: "status",
        value: literal("in_transit")
      },
      {
        id: "journal",
        kind: "command",
        op: "core.event.emit",
        eventType: "cargo.loaded",
        summary: literal("Груз загружен в вагон логистической компании"),
        audience: "public",
        data: {
          kind: literal("cargo-load"),
          cargoId,
          wagonId,
          logisticsTeamId: ownerTeamId,
          originNodeId,
          turnNumber: turnNumber()
        }
      }
    ]
  };
};

/**
 * Replace the proof macro with a complete, journaled atomic settlement.
 *
 * The explanatory event is emitted after both transfers but before detach.
 * This keeps the server-derived locomotive relation readable; if any later
 * write fails, the surrounding candidate transaction rolls the event and both
 * transfers back together.
 */
const buildDeliveryMacro = () => {
  const wagonId = { $macroInput: "containerId" };
  const cargoId = { $macroInput: "itemId" };
  const payoutBonus = { $macroInput: "payoutBonus" };
  const tariffPerEdge = { $macroInput: "tariffPerEdge" };
  const logisticsTeamId = wagonOwner(wagonId);
  const locomotiveId = coalesceString(wagonLocomotive(wagonId));
  const guildTeamId =
    entityValue("locomotives", locomotiveId, "ownerTeamId");
  const cargoNetworkId =
    entityValue("cargoOrders", cargoId, "networkId");
  const originNodeId =
    entityValue("cargoOrders", cargoId, "fromNodeId");
  const destinationNodeId =
    entityValue("cargoOrders", cargoId, "toNodeId");
  const basePayout =
    entityValue("cargoOrders", cargoId, "payout");
  const grossPayout = add(basePayout, payoutBonus);
  const tariffTotal = multiply(result("route", ["length"]), tariffPerEdge);

  return {
    inputs: {
      containerId: { kind: "value-expression" },
      itemId: { kind: "value-expression" },
      payoutBonus: { kind: "value-expression" },
      tariffPerEdge: { kind: "value-expression" }
    },
    steps: [
      {
        id: "validate",
        kind: "assert",
        op: "core.assert",
        predicate: all(
          {
            op: "predicate.entity.matches",
            entity: { collection: "wagons", entityId: wagonId },
            objectType: "transport.wagon",
            facets: { availability: literal("active") },
            attributes: {
              cargoId,
              nodeId: destinationNodeId,
              networkId: cargoNetworkId
            }
          },
          exists(wagonLocomotive(wagonId)),
          {
            op: "predicate.entity.matches",
            entity: { collection: "cargoOrders", entityId: cargoId },
            objectType: "transport.cargo",
            facets: { status: literal("in_transit") },
            attributes: { holderTeamId: logisticsTeamId }
          },
          compare(
            "eq",
            entityValue("networkNodes", destinationNodeId, "availability"),
            literal("open")
          ),
          compare(
            "eq",
            entityValue("teams", logisticsTeamId, "type"),
            literal("logistics_company")
          ),
          {
            op: "predicate.entity.matches",
            entity: { collection: "locomotives", entityId: locomotiveId },
            objectType: "transport.locomotive",
            facets: { availability: literal("active") },
            attributes: {
              networkId: cargoNetworkId,
              nodeId: destinationNodeId
            }
          },
          compare(
            "eq",
            entityValue("teams", guildTeamId, "type"),
            literal("locomotive_guild")
          )
        ),
        errorCode: "CARGO_DELIVERY_INVALID"
      },
      {
        id: "route",
        kind: "algorithm",
        op: "graph.shortestPath",
        networkId: "main",
        fromNode: originNodeId,
        toNode: destinationNodeId
      },
      {
        id: "payout",
        kind: "command",
        op: "core.resource.transfer",
        from: { kind: "bank" },
        to: {
          kind: "state",
          target: {
            endpoint: "public.teams.bound.coins",
            bindings: { teamId: logisticsTeamId }
          }
        },
        amount: grossPayout,
        onInsufficient: "fail"
      },
      {
        id: "tariff",
        kind: "command",
        op: "core.resource.transfer",
        from: {
          kind: "state",
          target: {
            endpoint: "public.teams.bound.coins",
            bindings: { teamId: logisticsTeamId }
          }
        },
        to: {
          kind: "state",
          target: {
            endpoint: "public.teams.bound.coins",
            bindings: { teamId: guildTeamId }
          }
        },
        amount: tariffTotal,
        onInsufficient: "fail"
      },
      {
        id: "journal",
        kind: "command",
        op: "core.event.emit",
        eventType: "cargo.delivered",
        summary: literal("Груз доставлен, банковская выплата и тариф рассчитаны"),
        audience: "public",
        data: {
          kind: literal("cargo-delivery"),
          cargoId,
          wagonId,
          locomotiveId,
          logisticsTeamId,
          guildTeamId,
          originNodeId,
          destinationNodeId,
          basePayout,
          payoutBonus,
          grossPayout,
          routeLength: result("route", ["length"]),
          tariffPerEdge,
          tariffTotal,
          turnNumber: turnNumber()
        }
      },
      {
        id: "detach",
        kind: "command",
        op: "relation.detach",
        networkId: "main",
        primary: locomotiveId,
        related: [wagonId]
      },
      {
        id: "mark-delivered",
        kind: "command",
        op: "core.entity.facet.set",
        entity: { collection: "cargoOrders", entityId: cargoId },
        facet: "status",
        value: literal("delivered")
      },
      {
        id: "record-settlement",
        kind: "command",
        op: "core.entity.attributes.patch",
        entity: { collection: "cargoOrders", entityId: cargoId },
        patches: [{
          operation: "set",
          path: ["settledRouteLength"],
          value: result("route", ["length"])
        }, {
          operation: "set",
          path: ["holderTeamId"],
          value: literal(null)
        }]
      },
      {
        // `cargoId` is derived from the wagon when every later step executes.
        // Clear the slot last so both cargo writes still address the original
        // card instead of resolving the now-empty slot to an invalid id.
        id: "release-wagon",
        kind: "command",
        op: "core.entity.attributes.patch",
        entity: { collection: "wagons", entityId: wagonId },
        patches: [{
          operation: "set",
          path: ["cargoId"],
          value: literal(null)
        }]
      }
    ]
  };
};

const buildLoadAction = () => {
  const id = "cargo.load";
  return {
    action: action({
      id,
      label: "Загрузить груз",
      semantics:
        "Загружает выбранный удерживаемый груз в пустой активный вагон той же логистической компании на открытом исходном терминале.",
      paramsSchema: loadParams
    }),
    plan: {
      transaction: {
        steps: [{
          id: "phase-guard",
          kind: "assert",
          op: "core.assert",
          predicate: all(normalPhaseGuard("cargo"), cargoQueueInactive()),
          errorCode: "CARGO_LOAD_PHASE_UNAVAILABLE"
        }, {
          id: "load",
          kind: "macro",
          macro: "cmt.cargo.load",
          args: {
            containerId: param("wagonId"),
            itemId: param("cargoId")
          }
        }]
      }
    }
  };
};

const buildCargoFinishAction = () => {
  const id = "cargo.phase.finish";
  return {
    action: action({
      id,
      label: "Завершить выбор и погрузку грузов",
      semantics:
        "Завершает грузовой этап только после разрешения открытого предложения и переводит партию к подготовке порядка локомотивов.",
      paramsSchema: noParams
    }),
    plan: {
      transaction: {
        steps: [{
          id: "phase-guard",
          kind: "assert",
          op: "core.assert",
          predicate: all(
            normalPhaseGuard("cargo"),
            compare(
              "eq",
              state("public.cards.cargo.preparedTurn"),
              state("public.session.turnNumber")
            ),
            compare(
              "eq",
              state("public.cards.cargo.selectionOrder"),
              literal([])
            ),
            compare(
              "eq",
              state("public.cards.cargo.currentWagonId"),
              literal(null)
            )
          ),
          errorCode: "CARGO_PHASE_UNAVAILABLE"
        }, {
          id: "offered-cargo",
          kind: "query",
          op: "core.entities.select",
          selector: {
            collection: "cargoOrders",
            objectTypes: ["transport.cargo"],
            facets: { status: literal("offered") },
            cardinality: { min: 0, max: 256 }
          }
        }, {
          id: "offer-resolved",
          kind: "assert",
          op: "core.assert",
          predicate: all(
            compare(
              "eq",
              state("public.cards.cargo.offer.terminalId"),
              literal(null)
            ),
            compare(
              "eq",
              state("public.cards.cargo.offer.firstCardId"),
              literal(null)
            ),
            compare(
              "eq",
              state("public.cards.cargo.offer.secondCardId"),
              literal(null)
            ),
            compare("eq", result("offered-cargo", ["ids"]), literal([]))
          ),
          errorCode: "CARGO_OFFER_UNRESOLVED"
        }, {
          id: "continue-to-movement-order",
          kind: "command",
          op: "core.state.patch",
          patches: [{
            operation: "set",
            target: { endpoint: "public.session.phase" },
            value: literal("movement-order")
          }]
        }, {
          id: "journal",
          kind: "command",
          op: "core.event.emit",
          eventType: "cargo.phase.finished",
          summary: literal("Ведущий завершил выбор и погрузку грузов"),
          audience: "public",
          data: {
            kind: literal("phase"),
            turnNumber: turnNumber()
          }
        }]
      }
    }
  };
};

const buildDeliveryAction = () => {
  const id = "settlement.cargo.deliver";
  const wagonId = param("wagonId");
  return {
    action: action({
      id,
      label: "Рассчитать доставку",
      semantics:
        "По серверному состоянию определяет груз, тягу и команды, затем атомарно проводит выплату, тариф, доставку и отцепление вагона.",
      paramsSchema: deliveryParams
    }),
    plan: {
      transaction: {
        steps: [{
          id: "phase-guard",
          kind: "assert",
          op: "core.assert",
          predicate: normalPhaseGuard("settlement"),
          errorCode: "SETTLEMENT_PHASE_UNAVAILABLE"
        }, {
          // This prefix rejects an empty relation before coalescing optional
          // fields into concrete macro identifiers for the schema checker.
          id: "wagon-relation-guard",
          kind: "assert",
          op: "core.assert",
          predicate: all(
            exists(wagonCargo(wagonId)),
            exists(wagonLocomotive(wagonId))
          ),
          errorCode: "CARGO_DELIVERY_RELATION_MISSING"
        }, {
          id: "deliver",
          kind: "macro",
          macro: "cmt.cargo.deliver",
          args: {
            containerId: wagonId,
            itemId: concreteCargo(wagonId),
            payoutBonus: state("public.turnEffects.deliveryPayoutBonus"),
            tariffPerEdge: literal(2)
          }
        }]
      }
    }
  };
};

const buildSettlementFinishAction = () => {
  const id = "settlement.phase.finish";
  return {
    action: action({
      id,
      label: "Завершить расчёты",
      semantics:
        "Завершает расчётный этап и открывает строительство, не блокируя ход из-за доставки, отклонённой при недостатке денег.",
      paramsSchema: noParams
    }),
    plan: {
      transaction: {
        steps: [{
          id: "phase-guard",
          kind: "assert",
          op: "core.assert",
          predicate: normalPhaseGuard("settlement"),
          errorCode: "SETTLEMENT_PHASE_UNAVAILABLE"
        }, {
          id: "continue-to-construction",
          kind: "command",
          op: "core.state.patch",
          patches: [
            {
              operation: "set",
              target: { endpoint: "public.session.phase" },
              value: literal("construction")
            },
            {
              // The phase and the public control availability are separate
              // facts. Publishing both in the same transaction prevents a
              // valid settlement completion from leaving the map controls
              // permanently disabled.
              operation: "set",
              target: { endpoint: "public.construction.available" },
              value: literal(true)
            }
          ]
        }, {
          id: "journal",
          kind: "command",
          op: "core.event.emit",
          eventType: "settlement.phase.finished",
          summary: literal("Ведущий завершил расчёты и открыл строительство"),
          audience: "public",
          data: {
            kind: literal("phase"),
            turnNumber: turnNumber()
          }
        }]
      }
    }
  };
};

/** Declare exact public journal payloads without duplicating settlement state. */
const declareEvents = (root) => {
  const { types, events } = root.mechanics.stateModel;
  Object.assign(types, {
    "game.cargo-loaded-event": {
      kind: "record",
      fields: {
        kind: { typeRef: "core.string", optional: false },
        cargoId: { typeRef: "core.string", optional: false },
        wagonId: { typeRef: "core.string", optional: false },
        logisticsTeamId: { typeRef: "core.string", optional: false },
        originNodeId: { typeRef: "core.string", optional: false },
        turnNumber: { typeRef: "core.integer", optional: false }
      }
    },
    "game.cargo-delivered-event": {
      kind: "record",
      fields: {
        kind: { typeRef: "core.string", optional: false },
        cargoId: { typeRef: "core.string", optional: false },
        wagonId: { typeRef: "core.string", optional: false },
        locomotiveId: { typeRef: "core.string", optional: false },
        logisticsTeamId: { typeRef: "core.string", optional: false },
        guildTeamId: { typeRef: "core.string", optional: false },
        originNodeId: { typeRef: "core.string", optional: false },
        destinationNodeId: { typeRef: "core.string", optional: false },
        basePayout: { typeRef: "core.integer", optional: false },
        payoutBonus: { typeRef: "core.integer", optional: false },
        grossPayout: { typeRef: "core.integer", optional: false },
        routeLength: { typeRef: "core.integer", optional: false },
        tariffPerEdge: { typeRef: "core.integer", optional: false },
        tariffTotal: { typeRef: "core.integer", optional: false },
        turnNumber: { typeRef: "core.integer", optional: false }
      }
    },
    "game.cargo-phase-finished-event": {
      kind: "record",
      fields: {
        kind: { typeRef: "core.string", optional: false },
        turnNumber: { typeRef: "core.integer", optional: false }
      }
    },
    "game.settlement-phase-finished-event": {
      kind: "record",
      fields: {
        kind: { typeRef: "core.string", optional: false },
        turnNumber: { typeRef: "core.integer", optional: false }
      }
    }
  });
  Object.assign(events, {
    "cargo.loaded": {
      audienceRef: "public",
      payloadType: "game.cargo-loaded-event",
      journalEndpoint: { endpoint: "public.log" }
    },
    "cargo.delivered": {
      audienceRef: "public",
      payloadType: "game.cargo-delivered-event",
      journalEndpoint: { endpoint: "public.log" }
    },
    "cargo.phase.finished": {
      audienceRef: "public",
      payloadType: "game.cargo-phase-finished-event",
      journalEndpoint: { endpoint: "public.log" }
    },
    "settlement.phase.finished": {
      audienceRef: "public",
      payloadType: "game.settlement-phase-finished-event",
      journalEndpoint: { endpoint: "public.log" }
    }
  });
};

/** Change only the successful all-locomotives boundary owned by movement. */
const connectMovementToSettlement = (root) => {
  const skipAction = root.logic.actions.find(
    (candidate) => candidate.id === "movement.locomotive.skip"
  );
  assert.ok(skipAction, "movement.locomotive.skip action is required");
  skipAction._semantics =
    "Явно завершает действия только текущего локомотива и переводит очередь к следующему; после последнего открывает расчёты.";

  const steps =
    root.mechanics.plans["movement.locomotive.skip"]?.transaction.steps;
  assert.ok(Array.isArray(steps), "movement.locomotive.skip plan is required");
  const finish = steps.find((step) => step.id === "finish-movement");
  assert.ok(finish?.op === "core.state.patch", "finish-movement patch is required");
  const phasePatch = finish.patches.find(
    (patch) => patch.target?.endpoint === "public.session.phase"
  );
  assert.ok(phasePatch, "movement phase destination patch is required");
  phasePatch.value = literal("settlement");

  const journal = steps.find((step) => step.id === "journal-phase-finished");
  assert.ok(journal?.op === "core.event.emit", "movement phase journal is required");
  journal.summary = literal("Все локомотивы завершили действия; открыты расчёты");
};

const upsertOwnedAtFront = (items, getId, additions) => [
  ...additions,
  ...items.filter((candidate) => !ownedActionIds.has(getId(candidate)))
];

/** Insert cargo before movement and settlement immediately after movement. */
const declareFlow = (root) => {
  const facilitator = root.logic.flows.find((flow) => flow.id === "facilitator");
  assert.ok(facilitator, "facilitator flow is required");
  const preserved = facilitator.steps.filter(
    (step) => !ownedFlowStepIds.has(step.id)
  );
  const movementIndex = preserved.findIndex(
    (step) => step.id === "facilitator.movement-order-and-skip"
  );
  assert.notEqual(movementIndex, -1, "facilitator movement step is required");
  const finishActions = [
    "session.finish.request",
    "session.finish.confirm",
    "session.finish.cancel"
  ];
  const offerActionIds = root.logic.actions
    .map((candidate) => candidate.id)
    .filter(
      (actionId) =>
        actionId === "cargo.queue.prepare"
        || actionId.startsWith("cargo.offer.")
    );
  const cargoStep = {
    id: "facilitator.cargo-loading",
    _type: "game.Step",
    _label: "Выбор и погрузка грузов",
    _semantics:
      "Ведущий фиксирует серверную очередь вагонов, разрешает каждое предложение, загружает выбранные грузы либо оставляет их у компании и явно завершает этап.",
    screenId: "facilitator",
    actionIds: [
      ...offerActionIds,
      "cargo.load",
      "cargo.phase.finish",
      ...finishActions
    ]
  };
  const settlementStep = {
    id: "facilitator.cargo-settlement",
    _type: "game.Step",
    _label: "Доставка и расчёты",
    _semantics:
      "После движения ведущий рассчитывает доставленные грузы и отдельным действием открывает строительство.",
    screenId: "facilitator",
    actionIds: [
      "settlement.cargo.deliver",
      "settlement.phase.finish",
      ...finishActions
    ]
  };
  facilitator.steps = [
    ...preserved.slice(0, movementIndex),
    cargoStep,
    preserved[movementIndex],
    settlementStep,
    ...preserved.slice(movementIndex + 1)
  ];
  const movementStep = facilitator.steps.find(
    (step) => step.id === "facilitator.movement-order-and-skip"
  );
  movementStep._semantics =
    "Ведущий фиксирует порядок, формирует составы, перемещает текущий локомотив и явно завершает его действия до этапа расчётов.";
};

/** Apply only the normal cargo and settlement transformation. */
const buildCargoSettlementAuthoring = (sourceAuthoring) => {
  const authoring = structuredClone(sourceAuthoring);
  const root = authoring.root;

  assert.ok(root.mechanics.macros["cmt.cargo.load"], "cargo load macro is required");
  assert.ok(root.mechanics.macros["cmt.cargo.deliver"], "cargo deliver macro is required");
  root.mechanics.macros["cmt.cargo.load"] = buildLoadMacro();
  root.mechanics.macros["cmt.cargo.deliver"] = buildDeliveryMacro();
  declareEvents(root);
  connectMovementToSettlement(root);

  const generated = [
    buildLoadAction(),
    buildCargoFinishAction(),
    buildDeliveryAction(),
    buildSettlementFinishAction()
  ];
  root.logic.actions = upsertOwnedAtFront(
    root.logic.actions,
    (candidate) => candidate.id,
    generated.map((candidate) => candidate.action)
  );
  root.mechanics.plans = Object.fromEntries(upsertOwnedAtFront(
    Object.entries(root.mechanics.plans),
    ([planId]) => planId,
    generated.map((candidate) => [candidate.action.id, candidate.plan])
  ));

  const board = root.state.public.board;
  assert.ok(Array.isArray(board.availableActions), "board actions are required");
  board.availableActions = upsertOwnedAtFront(
    board.availableActions,
    (candidate) => candidate.actionId,
    [{
      id: "cargo-load",
      label: "Загрузить груз",
      description:
        "Выберите вагон и удерживаемую карту; владелец, терминал и допустимость проверяются сервером.",
      actionId: "cargo.load",
      phase: "cargo",
      section: "cargo"
    }, {
      id: "cargo-phase-finish",
      label: "Завершить выбор и погрузку",
      actionId: "cargo.phase.finish",
      phase: "cargo",
      section: "cargo"
    }, {
      id: "settlement-cargo-deliver",
      label: "Рассчитать доставку",
      description:
        "Выберите вагон; груз, локомотив, маршрут и обе команды определит сервер.",
      actionId: "settlement.cargo.deliver",
      phase: "settlement",
      section: "settlement"
    }, {
      id: "settlement-phase-finish",
      label: "Завершить расчёты",
      actionId: "settlement.phase.finish",
      phase: "settlement",
      section: "settlement"
    }]
  );
  declareFlow(root);

  root.content.data.cargoSettlement = {
    status: "executable-prioritized-selection-loading-and-atomic-delivery",
    publishable: false,
    loadPhase: "cargo",
    movementEntryPhase: "movement-order",
    settlementPhase: "settlement",
    constructionEntryPhase: "construction",
    clientAuthority: {
      queuePrepare: [],
      offerDraw: ["terminalId"],
      offerSelect: ["terminalId", "cargoId"],
      offerSkip: ["terminalId"],
      load: ["wagonId", "cargoId"],
      delivery: ["wagonId"]
    },
    ownerAndRouteSource: "server-state",
    tariffPerShortestOpenEdge: 2,
    deliveryOrder: [
      "bank-payout-plus-current-bonus",
      "full-logistics-to-guild-tariff",
      "journal-exact-calculation",
      "detach-wagon",
      "settle-cargo"
    ],
    insufficientFunds: "reject-whole-delivery",
    settlementFinishAllowsUndeliveredCargo: true,
    unresolvedBeforeFullTurn: [
      ...(
        root.content.data.operatingTurn?.repeatablePhaseCycle
          ? []
          : ["market-entry-to-cargo"]
      ),
      "single-remaining-card-policy"
    ]
  };
  const movementTurn = root.content.data.movementTurn;
  if (movementTurn) {
    movementTurn.status =
      "executable-order-traversal-formation-through-settlement-boundary";
    movementTurn.boundary = "settlement";
    movementTurn.unresolvedAfterBoundary = (
      movementTurn.unresolvedAfterBoundary ?? []
    ).filter((item) =>
      item !== "loading-unloading-and-delivery"
      && item !== "train-formation-loading-unloading-and-delivery"
      && item !== "remaining-market-settlement-and-construction-workflows"
      && item !== "remaining-market-cargo-selection-construction-and-reporting-workflows"
      && item !== "remaining-market-construction-and-reporting-workflows"
      && item !== "remaining-market-and-reporting-workflows"
    );
    for (const item of [
      "publishable-author-confirmed-network-overlay",
      root.content.data.constructionCycle
        ? "remaining-market-and-reporting-workflows"
        : "remaining-market-construction-and-reporting-workflows"
    ]) {
      if (!movementTurn.unresolvedAfterBoundary.includes(item)) {
        movementTurn.unresolvedAfterBoundary.push(item);
      }
    }
  }

  const blockers = new Set(root.config.runtimeBlockers);
  for (const blocker of broadRuntimeBlockers) blockers.delete(blocker);
  blockers.delete(preciseRuntimeBlocker);
  blockers.delete(postConstructionRuntimeBlocker);
  blockers.delete(preConstructionPostCargoPriorityRuntimeBlocker);
  blockers.add(
    root.content.data.constructionCycle
      ? postCargoPriorityRuntimeBlocker
      : preConstructionPostCargoPriorityRuntimeBlocker
  );
  root.config.runtimeBlockers = [...blockers];
  root.config.runtimeReady = false;

  return authoring;
};

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const buildFromDisk = async () =>
  buildCargoSettlementAuthoring(await readJson(authoringPath));

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
    throw new Error("usage: build-cargo-settlement.mjs [--check]");
  }
  const sourceText = await readFile(authoringPath, "utf8");
  const builtText = serialize(await buildFromDisk());
  if (checkOnly) {
    assert.equal(
      sourceText,
      builtText,
      "cargo-settlement authoring is stale; run build-cargo-settlement.mjs"
    );
  } else {
    await writeAtomically(authoringPath, builtText);
  }
  process.stdout.write(
    `cards-money-trains: ${checkOnly ? "verified" : "built"} normal cargo loading and atomic settlement\n`
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
  buildCargoSettlementAuthoring,
  buildFromDisk
};
