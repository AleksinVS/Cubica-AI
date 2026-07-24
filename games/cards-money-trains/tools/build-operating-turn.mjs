#!/usr/bin/env node
/**
 * Build the repeatable operating-turn skeleton for «Карты, деньги, поезда».
 *
 * This game-local generator connects the already executable 4–12-team setup and
 * physical card lifecycle to mandatory maintenance and the repeatable vehicle
 * market. It also supplies explicit phase boundaries for a turn in which the
 * facilitator builds nothing, so unfinished construction content cannot
 * prevent multi-turn testing. Reporting/reflection content remains an explicit
 * blocker.
 * The generator composes accepted neutral Mechanics operations only and never
 * adds a game-specific Runtime branch.
 *
 * Ownership boundary:
 * - this file owns actions/plans prefixed with `session.play.` or `maintenance.`;
 * - it owns the exact four vehicle-market actions plus
 *   `market.phase.finish` and `reporting.phase.finish`;
 * - setup owns vehicle creation and therefore initializes vehicle maintenance;
 * - the card lifecycle owns cargo creation and initializes cargo maintenance;
 * - this file owns the shared maintenance fields and the repeatable phase
 *   skeleton, while game-specific market/construction content stays separate.
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
const ownedActionPrefixes = ["session.play.", "maintenance."];
const ownedExactActionIds = new Set([
  "market.purchase.wagon",
  "market.purchase.locomotive",
  "market.sell.wagon",
  "market.sell.locomotive",
  "market.phase.finish",
  "reporting.phase.finish"
]);
const ownedBoardActionIds = new Set([
  "session-play-start",
  "maintenance-pay-locomotive",
  "maintenance-pay-wagon",
  "maintenance-pay-held-cargo",
  "maintenance-phase-finish",
  "market-purchase-wagon",
  "market-purchase-locomotive",
  "market-sell-wagon",
  "market-sell-locomotive",
  "market-phase-finish",
  "reporting-phase-finish"
]);
const lifecyclePrefixes = [
  // Movement is the next game-local generated block. Recognizing it here
  // prevents a later maintenance rebuild from moving operating actions behind
  // the already generated movement boundary.
  "movement.",
  "cards.lifecycle.",
  "cargo.offer.",
  "news.lifecycle.",
  "news.cargo-addition.",
  "news.effect."
];
const operatingFlowStepId = "facilitator.operating-turn-start-maintenance";
const marketFlowStepId = "facilitator.market-boundary";
const reportingFlowStepId = "facilitator.reporting-boundary";
const ownedFlowStepIds = new Set([
  operatingFlowStepId,
  marketFlowStepId,
  reportingFlowStepId
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
const entityValue = (collection, entityId, field) => ({
  op: "value.entity",
  entity: { collection, entityId },
  field
});
const itemId = () => ({ op: "value.item", area: "identity", field: "id" });
const itemAttribute = (field) => ({
  op: "value.item",
  area: "attribute",
  field
});
const arithmetic = (operator, ...items) => ({ op: operator, items });
const compare = (operator, left, right) => ({
  op: "predicate.compare",
  operator,
  left,
  right
});
const all = (...items) => ({ op: "predicate.all", items });
const any = (...items) => ({ op: "predicate.any", items });
const not = (item) => ({ op: "predicate.not", item });
const noParamsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
  required: []
};

/** Create one facilitator-only Game Intent backed by a Mechanics plan. */
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

/** Describe a bounded public object reference without trusting its owner. */
const objectReferenceParams = ({ parameterName, collection, objectType }) => ({
  type: "object",
  additionalProperties: false,
  properties: {
    [parameterName]: {
      type: "string",
      maxLength: 128,
      "x-cubica-ref": {
        kind: "object",
        collection,
        allowedTypes: [objectType],
        visibility: "public"
      }
    }
  },
  required: [parameterName]
});

/** Describe a configured team plus one open terminal selected by the facilitator. */
const marketPurchaseParams = {
  type: "object",
  additionalProperties: false,
  properties: {
    teamId: {
      type: "string",
      maxLength: 128,
      "x-cubica-ref": {
        kind: "object",
        collection: "teams",
        allowedTypes: ["game.team"],
        visibility: "public"
      }
    },
    stationId: {
      type: "string",
      maxLength: 128,
      "x-cubica-ref": {
        kind: "object",
        collection: "networkNodes",
        network: "main",
        allowedTypes: ["transport.terminal"],
        visibility: "public"
      }
    }
  },
  required: ["teamId", "stationId"]
};

/** Guard every normal-session operating action against technical fixtures. */
const normalPhaseGuard = (phase) => all(
  compare("eq", state("public.session.fixtureId"), literal(normalFixtureId)),
  compare("eq", state("public.session.phase"), literal(phase))
);

const maintenanceExempt = () =>
  compare(
    "eq",
    state("public.turnEffects.vehicleAndCargoMaintenanceExempt"),
    literal(true)
  );

const progressiveAssetTaxActive = () =>
  compare(
    "eq",
    state("public.ruleModifiers.progressiveAssetTaxActive"),
    literal(true)
  );

/**
 * Start the playable lifecycle only after setup and protected decks are ready.
 *
 * The first turn still enters the news phase so the existing author-confirmed
 * `news.lifecycle.first-turn.skip` plan performs and journals the explicit
 * no-news boundary without consuming a card or random value.
 */
const buildSessionStart = () => {
  const id = "session.play.start";
  return {
    action: action({
      id,
      label: "Начать первый ход",
      semantics:
        "После полной расстановки и подготовки колод переводит обычную партию к явному пропуску новости первого хода."
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: all(
              compare("eq", state("public.session.fixtureId"), literal(normalFixtureId)),
              compare("eq", state("public.setup.status"), literal("complete")),
              compare("eq", state("public.session.phase"), literal("setup-complete")),
              compare("eq", state("public.cards.initialized"), literal(true)),
              compare("eq", state("public.session.turnNumber"), literal(1)),
              compare("eq", state("public.news.currentCardId"), literal(null)),
              compare("eq", state("public.news.remaining"), literal(34))
            ),
            errorCode: "SESSION_PLAY_START_UNAVAILABLE"
          },
          {
            id: "start",
            kind: "command",
            op: "core.state.patch",
            patches: [
              {
                operation: "set",
                target: { endpoint: "public.session.status" },
                value: literal("running")
              },
              {
                operation: "set",
                target: { endpoint: "public.session.phase" },
                value: literal("news")
              }
            ]
          },
          {
            id: "journal",
            kind: "command",
            op: "core.event.emit",
            eventType: "session.play.started",
            summary: literal("Ведущий начал первый обычный ход"),
            audience: "public",
            data: {
              kind: literal("session"),
              turnNumber: state("public.session.turnNumber")
            }
          }
        ]
      }
    }
  };
};

/** Shared server-derived guard for a locomotive or wagon maintenance payment. */
const assetMaintenanceGuard = ({
  collection,
  parameterName,
  objectType
}) => {
  const entityId = param(parameterName);
  return all(
    normalPhaseGuard("maintenance"),
    {
      op: "predicate.entity.matches",
      entity: { collection, entityId },
      objectType,
      facets: {
        availability: literal("active")
      }
    },
    {
      op: "predicate.exists",
      value: entityValue(collection, entityId, "ownerTeamId"),
      exists: true
    },
    compare(
      "ne",
      entityValue(collection, entityId, "maintenancePaidTurn"),
      state("public.session.turnNumber")
    )
  );
};

/** Shared server-derived guard for a cargo card retained by a team. */
const heldCargoMaintenanceGuard = (parameterName) => {
  const entityId = param(parameterName);
  const matchesStatus = (status) => ({
    op: "predicate.entity.matches",
    entity: { collection: "cargoOrders", entityId },
    objectType: "transport.cargo",
    facets: {
      status: literal(status)
    }
  });
  return all(
    normalPhaseGuard("maintenance"),
    any(matchesStatus("available"), matchesStatus("in_transit")),
    {
      op: "predicate.exists",
      value: entityValue("cargoOrders", entityId, "holderTeamId"),
      exists: true
    },
    compare(
      "ne",
      entityValue("cargoOrders", entityId, "maintenancePaidTurn"),
      state("public.session.turnNumber")
    )
  );
};

/**
 * Build one atomic per-object maintenance settlement.
 *
 * Ownership never comes from action parameters: both the debit endpoint and
 * the journal payload read the owner from the selected server-side object.
 * News №25 skips only the debit; the same object is still marked as handled so
 * phase completion remains exact and replay-safe.
 */
const buildMaintenancePayment = ({
  id,
  label,
  semantics,
  collection,
  parameterName,
  objectType,
  guard
}) => {
  const entityId = param(parameterName);
  const exempt = maintenanceExempt();
  const ownerField = collection === "cargoOrders" ? "holderTeamId" : "ownerTeamId";
  const rawOwnerTeamId = entityValue(collection, entityId, ownerField);
  // Cargo stores an optional holder because cards start unowned. The guard
  // proves a real holder exists; coalesce makes that narrowing explicit to the
  // schema-first type checker without trusting a client-supplied team id.
  const ownerTeamId = collection === "cargoOrders"
    ? {
        op: "value.coalesce",
        items: [rawOwnerTeamId, literal("")]
      }
    : rawOwnerTeamId;
  return {
    action: action({
      id,
      label,
      semantics,
      paramsSchema: objectReferenceParams({
        parameterName,
        collection,
        objectType
      })
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: guard,
            errorCode: "MAINTENANCE_PAYMENT_UNAVAILABLE"
          },
          {
            id: "debit",
            kind: "command",
            op: "core.resource.transfer",
            from: {
              kind: "state",
              target: {
                endpoint: "public.teams.bound.coins",
                bindings: {
                  teamId: ownerTeamId
                }
              }
            },
            to: { kind: "bank" },
            amount: literal(1),
            onInsufficient: "fail",
            when: not(exempt)
          },
          {
            id: "mark-paid",
            kind: "command",
            op: "core.entity.attributes.patch",
            entity: {
              collection,
              entityId
            },
            patches: [
              {
                operation: "set",
                path: ["maintenancePaidTurn"],
                value: state("public.session.turnNumber")
              }
            ]
          },
          {
            id: "journal-paid",
            kind: "command",
            op: "core.event.emit",
            eventType: "maintenance.unit.settled",
            summary: literal("Оплачено обязательное обслуживание одной единицы"),
            audience: "public",
            data: {
              kind: literal("maintenance"),
              entityId,
              ownerTeamId,
              chargedAmount: literal(1),
              exempt: literal(false),
              turnNumber: state("public.session.turnNumber")
            },
            when: not(exempt)
          },
          {
            id: "journal-exempt",
            kind: "command",
            op: "core.event.emit",
            eventType: "maintenance.unit.settled",
            summary: literal("Единица обслужена по бесплатному купону"),
            audience: "public",
            data: {
              kind: literal("maintenance"),
              entityId,
              ownerTeamId,
              chargedAmount: literal(0),
              exempt: literal(true),
              turnNumber: state("public.session.turnNumber")
            },
            when: exempt
          }
        ]
      }
    }
  };
};

/** Create the three typed per-object maintenance actions. */
const buildMaintenancePayments = () => [
  buildMaintenancePayment({
    id: "maintenance.pay.locomotive",
    label: "Обслужить локомотив",
    semantics:
      "Списывает одну монету с серверно определённого владельца активного локомотива либо применяет бесплатное обслуживание новости №25.",
    collection: "locomotives",
    parameterName: "locomotiveId",
    objectType: "transport.locomotive",
    guard: assetMaintenanceGuard({
      collection: "locomotives",
      parameterName: "locomotiveId",
      objectType: "transport.locomotive"
    })
  }),
  buildMaintenancePayment({
    id: "maintenance.pay.wagon",
    label: "Обслужить вагон",
    semantics:
      "Списывает одну монету с серверно определённого владельца активного вагона либо применяет бесплатное обслуживание новости №25.",
    collection: "wagons",
    parameterName: "wagonId",
    objectType: "transport.wagon",
    guard: assetMaintenanceGuard({
      collection: "wagons",
      parameterName: "wagonId",
      objectType: "transport.wagon"
    })
  }),
  buildMaintenancePayment({
    id: "maintenance.pay.held-cargo",
    label: "Оплатить хранение груза",
    semantics:
      "Списывает одну монету с команды, которая по серверному состоянию удерживает доступный или находящийся в пути груз, либо применяет купон новости №25.",
    collection: "cargoOrders",
    parameterName: "cargoId",
    objectType: "transport.cargo",
    guard: heldCargoMaintenanceGuard("cargoId")
  })
];

/** Select one bounded class of objects still unpaid in the current turn. */
const unpaidSelection = ({
  id,
  collection,
  max,
  objectType,
  facet,
  attributes = {}
}) => ({
  id,
  kind: "query",
  op: "core.entities.select",
  selector: {
    collection,
    objectTypes: [objectType],
    facets: facet,
    attributes: {
      ...attributes,
      maintenancePaidTurn: {
        operator: "ne",
        value: state("public.session.turnNumber")
      }
    },
    cardinality: { min: 0, max }
  }
});

/**
 * Finish maintenance only after every currently chargeable object is handled.
 *
 * A zero result is proved by comparing the protected selection result with an
 * empty list. News №25 is the explicit exception: its complete one-turn coupon
 * permits the facilitator to finish immediately without clicking every unit.
 * News №14 then derives its progressive tax from the authoritative active
 * vehicle collections. Two neutral per-team counters are scratch state:
 * Runtime clears and rebuilds them inside this same transaction, so they can
 * never become trusted stale input. If any taxable team cannot pay, the
 * dispatcher rolls back every counter, transfer, journal event and phase
 * change together; it does not invent the author's still discretionary loan
 * or elimination choice.
 */
const buildMaintenanceFinish = () => {
  const id = "maintenance.phase.finish";
  const selectionIds = [
    "unpaid-locomotives",
    "unpaid-wagons",
    "unpaid-available-cargo",
    "unpaid-in-transit-cargo"
  ];
  return {
    action: action({
      id,
      label: "Завершить обслуживание",
      semantics:
        "После обработки всей техники и грузов атомарно взимает действующий прогрессивный налог и переводит ход к рынку."
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "phase-guard",
            kind: "assert",
            op: "core.assert",
            predicate: normalPhaseGuard("maintenance"),
            errorCode: "MAINTENANCE_PHASE_UNAVAILABLE"
          },
          unpaidSelection({
            id: "unpaid-locomotives",
            collection: "locomotives",
            max: 64,
            objectType: "transport.locomotive",
            facet: { availability: literal("active") }
          }),
          unpaidSelection({
            id: "unpaid-wagons",
            collection: "wagons",
            max: 64,
            objectType: "transport.wagon",
            facet: { availability: literal("active") }
          }),
          unpaidSelection({
            id: "unpaid-available-cargo",
            collection: "cargoOrders",
            max: 256,
            objectType: "transport.cargo",
            facet: { status: literal("available") },
            attributes: {
              holderTeamId: {
                operator: "ne",
                value: literal(null)
              }
            }
          }),
          unpaidSelection({
            id: "unpaid-in-transit-cargo",
            collection: "cargoOrders",
            max: 256,
            objectType: "transport.cargo",
            facet: { status: literal("in_transit") },
            attributes: {
              holderTeamId: {
                operator: "ne",
                value: literal(null)
              }
            }
          }),
          {
            id: "all-units-settled",
            kind: "assert",
            op: "core.assert",
            predicate: any(
              maintenanceExempt(),
              all(...selectionIds.map((stepId) =>
                compare("eq", result(stepId, ["ids"]), literal([]))
              ))
            ),
            errorCode: "MAINTENANCE_UNITS_REMAIN"
          },
          {
            id: "all-teams",
            kind: "query",
            op: "core.entities.select",
            selector: {
              collection: "teams",
              objectTypes: ["game.team"],
              cardinality: { min: 0, max: 12 }
            }
          },
          {
            id: "reset-progressive-tax-counts",
            kind: "command",
            op: "core.entities.update",
            selection: result("all-teams"),
            attributeValues: {
              progressiveTaxLocomotiveCount: literal(0),
              progressiveTaxWagonCount: literal(0)
            }
          },
          {
            id: "active-tax-locomotives",
            kind: "query",
            op: "core.entities.select",
            selector: {
              collection: "locomotives",
              objectTypes: ["transport.locomotive"],
              facets: { availability: literal("active") },
              cardinality: { min: 0, max: 64 }
            }
          },
          {
            id: "count-active-tax-locomotives",
            kind: "command",
            op: "core.entities.each",
            selection: result("active-tax-locomotives"),
            body: [{
              id: "increment-owner-locomotive-count",
              kind: "command",
              op: "core.number.add",
              target: {
                endpoint: "public.teams.bound.progressiveTaxLocomotiveCount",
                bindings: { teamId: itemAttribute("ownerTeamId") }
              },
              delta: literal(1),
              when: progressiveAssetTaxActive()
            }]
          },
          {
            id: "active-tax-wagons",
            kind: "query",
            op: "core.entities.select",
            selector: {
              collection: "wagons",
              objectTypes: ["transport.wagon"],
              facets: { availability: literal("active") },
              cardinality: { min: 0, max: 64 }
            }
          },
          {
            id: "count-active-tax-wagons",
            kind: "command",
            op: "core.entities.each",
            selection: result("active-tax-wagons"),
            body: [{
              id: "increment-owner-wagon-count",
              kind: "command",
              op: "core.number.add",
              target: {
                endpoint: "public.teams.bound.progressiveTaxWagonCount",
                bindings: { teamId: itemAttribute("ownerTeamId") }
              },
              delta: literal(1),
              when: progressiveAssetTaxActive()
            }]
          },
          {
            id: "collect-progressive-asset-tax",
            kind: "command",
            op: "core.entities.each",
            selection: result("all-teams"),
            body: [
              {
                id: "debit-guild-locomotive-tax",
                kind: "command",
                op: "core.resource.transfer",
                from: {
                  kind: "state",
                  target: {
                    endpoint: "public.teams.bound.coins",
                    bindings: { teamId: itemId() }
                  }
                },
                to: { kind: "bank" },
                amount: arithmetic(
                  "number.subtract",
                  itemAttribute("progressiveTaxLocomotiveCount"),
                  literal(3)
                ),
                onInsufficient: "fail",
                when: all(
                  progressiveAssetTaxActive(),
                  compare(
                    "eq",
                    itemAttribute("type"),
                    literal("locomotive_guild")
                  ),
                  compare(
                    "gt",
                    itemAttribute("progressiveTaxLocomotiveCount"),
                    literal(3)
                  )
                )
              },
              {
                id: "journal-guild-locomotive-tax",
                kind: "command",
                op: "core.event.emit",
                eventType: "maintenance.progressive-asset-tax.paid",
                summary: literal("Паровозная гильдия уплатила прогрессивный налог"),
                audience: "public",
                data: {
                  kind: literal("progressive-asset-tax"),
                  newsId: literal("news-14"),
                  teamId: itemId(),
                  teamType: literal("locomotive_guild"),
                  assetKind: literal("locomotive"),
                  ownedUnitCount: itemAttribute("progressiveTaxLocomotiveCount"),
                  threshold: literal(3),
                  taxableUnitCount: arithmetic(
                    "number.subtract",
                    itemAttribute("progressiveTaxLocomotiveCount"),
                    literal(3)
                  ),
                  chargedAmount: arithmetic(
                    "number.subtract",
                    itemAttribute("progressiveTaxLocomotiveCount"),
                    literal(3)
                  ),
                  balanceAfter: itemAttribute("coins"),
                  turnNumber: state("public.session.turnNumber")
                },
                when: all(
                  progressiveAssetTaxActive(),
                  compare(
                    "eq",
                    itemAttribute("type"),
                    literal("locomotive_guild")
                  ),
                  compare(
                    "gt",
                    itemAttribute("progressiveTaxLocomotiveCount"),
                    literal(3)
                  )
                )
              },
              {
                id: "debit-company-wagon-tax",
                kind: "command",
                op: "core.resource.transfer",
                from: {
                  kind: "state",
                  target: {
                    endpoint: "public.teams.bound.coins",
                    bindings: { teamId: itemId() }
                  }
                },
                to: { kind: "bank" },
                amount: arithmetic(
                  "number.subtract",
                  itemAttribute("progressiveTaxWagonCount"),
                  literal(5)
                ),
                onInsufficient: "fail",
                when: all(
                  progressiveAssetTaxActive(),
                  compare(
                    "eq",
                    itemAttribute("type"),
                    literal("logistics_company")
                  ),
                  compare(
                    "gt",
                    itemAttribute("progressiveTaxWagonCount"),
                    literal(5)
                  )
                )
              },
              {
                id: "journal-company-wagon-tax",
                kind: "command",
                op: "core.event.emit",
                eventType: "maintenance.progressive-asset-tax.paid",
                summary: literal("Компания-перевозчик уплатила прогрессивный налог"),
                audience: "public",
                data: {
                  kind: literal("progressive-asset-tax"),
                  newsId: literal("news-14"),
                  teamId: itemId(),
                  teamType: literal("logistics_company"),
                  assetKind: literal("wagon"),
                  ownedUnitCount: itemAttribute("progressiveTaxWagonCount"),
                  threshold: literal(5),
                  taxableUnitCount: arithmetic(
                    "number.subtract",
                    itemAttribute("progressiveTaxWagonCount"),
                    literal(5)
                  ),
                  chargedAmount: arithmetic(
                    "number.subtract",
                    itemAttribute("progressiveTaxWagonCount"),
                    literal(5)
                  ),
                  balanceAfter: itemAttribute("coins"),
                  turnNumber: state("public.session.turnNumber")
                },
                when: all(
                  progressiveAssetTaxActive(),
                  compare(
                    "eq",
                    itemAttribute("type"),
                    literal("logistics_company")
                  ),
                  compare(
                    "gt",
                    itemAttribute("progressiveTaxWagonCount"),
                    literal(5)
                  )
                )
              }
            ]
          },
          {
            id: "continue-to-market",
            kind: "command",
            op: "core.state.patch",
            patches: [
              {
                operation: "set",
                target: { endpoint: "public.session.phase" },
                value: literal("market")
              }
            ]
          },
          {
            id: "journal",
            kind: "command",
            op: "core.event.emit",
            eventType: "maintenance.phase.finished",
            summary: literal("Ведущий завершил обязательное обслуживание"),
            audience: "public",
            data: {
              kind: literal("phase"),
              turnNumber: state("public.session.turnNumber")
            }
          }
        ]
      }
    }
  };
};

/** Resolve a turn-scoped news price first and the persistent market price second. */
const marketPurchasePrice = (assetKind) => ({
  op: "value.coalesce",
  items: [
    state(`public.turnEffects.purchasePriceOverrides.${assetKind}`),
    state(`public.market.basePurchasePrices.${assetKind}`)
  ]
});

/** Prove that a public team exists, finished placement, and may own this asset kind. */
const marketTeamMatches = (teamId, teamType) => ({
  op: "predicate.entity.matches",
  entity: {
    collection: "teams",
    entityId: teamId
  },
  objectType: "game.team",
  facets: {
    placementStatus: literal("placed")
  },
  attributes: {
    type: literal(teamType)
  }
});

/** Purchases may place a new vehicle only on an open terminal of the main network. */
const marketStationMatches = () => ({
  op: "predicate.entity.matches",
  entity: {
    collection: "networkNodes",
    entityId: param("stationId")
  },
  objectType: "transport.terminal",
  facets: {
    availability: literal("open")
  },
  attributes: {
    networkId: literal("main")
  }
});

/**
 * Build the complete initial state of a newly purchased vehicle.
 *
 * Later game-local generators extend every creation path with their own
 * markers. The optional flags preserve those fields when this earlier
 * generator is rebuilt over a fully composed authoring document.
 */
const purchasedVehicleAttributes = ({
  assetKind,
  includeFormationTarget,
  includeNews19Marker
}) => {
  const common = {
    networkId: literal("main"),
    nodeId: param("stationId"),
    ownerTeamId: param("teamId"),
    maintenancePaidTurn: state("public.session.turnNumber")
  };
  if (assetKind === "locomotive") {
    return {
      ...common,
      actionPoints: literal(5),
      turnOrderCount: literal(1),
      movementResolvedTurn: literal(0),
      lastMovedTurn: literal(0),
      ...(includeNews19Marker
        ? { news19ConfiscatedTurn: literal(0) }
        : {})
    };
  }
  return {
    ...common,
    attachedVehicleId: literal(null),
    cargoId: literal(null),
    cargoOfferEligibleTurn: literal(0),
    cargoOfferResolvedTurn: literal(0),
    cargoPriorityActiveCount: literal(0),
    ...(includeFormationTarget
      ? { formationTargetLocomotiveId: literal(null) }
      : {}),
    ...(includeNews19Marker
      ? { news19ConfiscatedTurn: literal(0) }
      : {})
  };
};

/**
 * Buy one vehicle without inventing a finite game market.
 *
 * Collection capacity remains the platform's bounded-execution safety limit,
 * not a game rule. The shared monotonic setup sequence creates a deterministic
 * collision-free identifier, while the whole debit-and-create transaction
 * rolls back if funds, permissions, terminal validity or capacity fail.
 */
const buildMarketPurchase = ({
  assetKind,
  collection,
  objectType,
  teamType,
  label,
  includeFormationTarget,
  includeNews19Marker
}) => {
  const id = `market.purchase.${assetKind}`;
  const price = marketPurchasePrice(assetKind);
  const allocateStepId = `allocate-${assetKind}-id`;
  const capacitySteps = assetKind === "locomotive"
    ? [{
        id: "select-locomotives-at-terminal",
        kind: "query",
        op: "core.entities.select",
        selector: {
          collection: "locomotives",
          objectTypes: ["transport.locomotive"],
          facets: { availability: literal("active") },
          attributes: {
            networkId: literal("main"),
            nodeId: param("stationId")
          },
          // Two existing locomotives exceed this declared maximum and abort
          // before the shared id sequence or money can change.
          cardinality: { min: 0, max: 1 }
        }
      }]
    : [];
  return {
    action: action({
      id,
      label,
      semantics:
        `Покупает один ${assetKind === "wagon" ? "вагон" : "локомотив"} разрешённому типу команды по серверной цене и сразу размещает его на открытом терминале.`,
      paramsSchema: marketPurchaseParams
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: all(
              normalPhaseGuard("market"),
              compare(
                "eq",
                state(`public.turnEffects.purchasePermissions.${assetKind}`),
                literal(true)
              ),
              marketTeamMatches(param("teamId"), teamType),
              marketStationMatches()
            ),
            errorCode: "MARKET_PURCHASE_UNAVAILABLE"
          },
          ...capacitySteps,
          {
            id: allocateStepId,
            kind: "command",
            op: "core.collection.id.allocate",
            collection,
            sequence: { endpoint: "public.setup.assetSequence" },
            prefix: assetKind
          },
          {
            id: "debit",
            kind: "command",
            op: "core.resource.transfer",
            from: {
              kind: "state",
              target: {
                endpoint: "public.teams.bound.coins",
                bindings: {
                  teamId: param("teamId")
                }
              }
            },
            to: { kind: "bank" },
            amount: price,
            onInsufficient: "fail"
          },
          {
            id: "create-vehicle",
            kind: "command",
            op: "core.entity.create",
            visibility: "public",
            collection,
            entityId: result(allocateStepId, ["id"]),
            objectType,
            facets: {
              availability: literal("active")
            },
            attributes: purchasedVehicleAttributes({
              assetKind,
              includeFormationTarget,
              includeNews19Marker
            })
          },
          {
            id: "journal",
            kind: "command",
            op: "core.event.emit",
            eventType: "market.vehicle.purchased",
            summary: literal(
              assetKind === "wagon"
                ? "Команда купила вагон"
                : "Команда купила локомотив"
            ),
            audience: "public",
            data: {
              kind: literal("market-purchase"),
              assetKind: literal(assetKind),
              teamId: param("teamId"),
              vehicleId: result(allocateStepId, ["id"]),
              amount: price,
              turnNumber: state("public.session.turnNumber")
            }
          }
        ]
      }
    }
  };
};

/** Prove that the server-owned selected vehicle is saleable by its team type. */
const marketSaleGuard = ({
  collection,
  parameterName,
  objectType,
  teamType,
  includeFormationTarget
}) => {
  const vehicleId = param(parameterName);
  const neutralAttributes = collection === "wagons"
    ? {
        networkId: literal("main"),
        cargoId: literal(null),
        attachedVehicleId: literal(null),
        ...(includeFormationTarget
          ? { formationTargetLocomotiveId: literal(null) }
          : {})
      }
    : { networkId: literal("main") };
  return all(
    normalPhaseGuard("market"),
    {
      op: "predicate.entity.matches",
      entity: { collection, entityId: vehicleId },
      objectType,
      facets: {
        availability: literal("active")
      },
      attributes: neutralAttributes
    },
    marketTeamMatches(
      entityValue(collection, vehicleId, "ownerTeamId"),
      teamType
    )
  );
};

/**
 * Sell one eligible vehicle back to the unbounded market.
 *
 * Ownership is derived from the selected object and is never accepted as a
 * client parameter. Sold objects remain in the immutable session history but
 * leave the map and all current-turn participation.
 */
const buildMarketSale = ({
  assetKind,
  collection,
  parameterName,
  objectType,
  teamType,
  label,
  salePrice,
  includeFormationTarget
}) => {
  const id = `market.sell.${assetKind}`;
  const vehicleId = param(parameterName);
  const ownerTeamId = entityValue(collection, vehicleId, "ownerTeamId");
  const locomotiveAttachmentSteps = assetKind === "locomotive"
    ? [{
        id: "select-attached-wagons",
        kind: "query",
        op: "core.entities.select",
        selector: {
          collection: "wagons",
          objectTypes: ["transport.wagon"],
          facets: { availability: literal("active") },
          attributes: {
            attachedVehicleId: vehicleId
          },
          cardinality: { min: 0, max: 64 }
        }
      }, {
        id: "assert-no-attached-wagons",
        kind: "assert",
        op: "core.assert",
        predicate: compare(
          "eq",
          result("select-attached-wagons", ["ids"]),
          literal([])
        ),
        errorCode: "MARKET_SALE_ATTACHED_WAGONS"
      }]
    : [];
  const resetPatches = assetKind === "locomotive"
    ? [{
        operation: "set",
        path: ["nodeId"],
        value: literal(null)
      }, {
        operation: "set",
        path: ["actionPoints"],
        value: literal(0)
      }, {
        operation: "set",
        path: ["turnOrderCount"],
        value: literal(0)
      }, {
        operation: "set",
        path: ["movementResolvedTurn"],
        value: literal(0)
      }, {
        operation: "set",
        path: ["lastMovedTurn"],
        value: literal(0)
      }]
    : [{
        operation: "set",
        path: ["nodeId"],
        value: literal(null)
      }, {
        operation: "set",
        path: ["cargoOfferEligibleTurn"],
        value: literal(0)
      }, {
        operation: "set",
        path: ["cargoOfferResolvedTurn"],
        value: literal(0)
      }, {
        operation: "set",
        path: ["cargoPriorityActiveCount"],
        value: literal(0)
      }];
  return {
    action: action({
      id,
      label,
      semantics:
        `Продаёт пустой и свободный ${assetKind === "wagon" ? "вагон" : "локомотив"} его серверно определённого владельца и возвращает фиксированную сумму.`,
      paramsSchema: objectReferenceParams({
        parameterName,
        collection,
        objectType
      })
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: marketSaleGuard({
              collection,
              parameterName,
              objectType,
              teamType,
              includeFormationTarget
            }),
            errorCode: "MARKET_SALE_UNAVAILABLE"
          },
          ...locomotiveAttachmentSteps,
          {
            id: "credit",
            kind: "command",
            op: "core.resource.transfer",
            from: { kind: "bank" },
            to: {
              kind: "state",
              target: {
                endpoint: "public.teams.bound.coins",
                bindings: {
                  teamId: ownerTeamId
                }
              }
            },
            amount: literal(salePrice),
            onInsufficient: "fail"
          },
          {
            id: "remove-from-map",
            kind: "command",
            op: "core.entity.attributes.patch",
            entity: {
              collection,
              entityId: vehicleId
            },
            patches: resetPatches
          },
          {
            id: "mark-sold",
            kind: "command",
            op: "core.entity.facet.set",
            entity: {
              collection,
              entityId: vehicleId
            },
            facet: "availability",
            value: literal("sold")
          },
          {
            id: "journal",
            kind: "command",
            op: "core.event.emit",
            eventType: "market.vehicle.sold",
            summary: literal(
              assetKind === "wagon"
                ? "Команда продала вагон"
                : "Команда продала локомотив"
            ),
            audience: "public",
            data: {
              kind: literal("market-sale"),
              assetKind: literal(assetKind),
              teamId: ownerTeamId,
              vehicleId,
              amount: literal(salePrice),
              turnNumber: state("public.session.turnNumber")
            }
          }
        ]
      }
    }
  };
};

/**
 * Leave the market after any number of trades, including zero.
 *
 * This remains a separate facilitator decision: all purchase and sale actions
 * keep the phase open so the group can repeat them before continuing.
 */
const buildMarketFinish = () => {
  const id = "market.phase.finish";
  return {
    action: action({
      id,
      label: "Завершить рынок",
      semantics:
        "Явно завершает рыночный этап после любого количества покупок и продаж техники.",
      paramsSchema: noParamsSchema
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: normalPhaseGuard("market"),
            errorCode: "MARKET_PHASE_UNAVAILABLE"
          },
          {
            id: "continue-to-cargo",
            kind: "command",
            op: "core.state.patch",
            patches: [{
              operation: "set",
              target: { endpoint: "public.session.phase" },
              value: literal("cargo")
            }]
          },
          {
            id: "journal",
            kind: "command",
            op: "core.event.emit",
            eventType: "market.phase.finished",
            summary: literal("Ведущий завершил рынок"),
            audience: "public",
            data: {
              kind: literal("phase"),
              phase: literal("market"),
              turnNumber: state("public.session.turnNumber")
            }
          }
        ]
      }
    }
  };
};

/**
 * Close reporting and start the news phase of the next numbered turn.
 *
 * Turn-scoped markers deliberately stay untouched: maintenance and movement
 * compare them with the incremented turn number. Temporary news effects are
 * reset later by the protected draw/stagnation action, while persistent prices
 * and future construction objects must survive this boundary.
 */
const buildReportingFinish = () => {
  const id = "reporting.phase.finish";
  return {
    action: action({
      id,
      label: "Завершить отчёт и начать следующий ход",
      semantics:
        "Фиксирует окончание текущего хода, увеличивает его номер ровно на один и открывает новостной этап следующего хода.",
      paramsSchema: noParamsSchema
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: all(
              normalPhaseGuard("reporting"),
              compare(
                "eq",
                state("public.construction.mode"),
                literal(null)
              ),
              compare(
                "eq",
                state("public.construction.available"),
                literal(false)
              )
            ),
            errorCode: "REPORTING_PHASE_UNAVAILABLE"
          },
          {
            // Emit before the increment so the journal names the completed
            // turn. The whole plan is still one atomic transaction.
            id: "journal",
            kind: "command",
            op: "core.event.emit",
            eventType: "reporting.phase.finished",
            summary: literal("Ведущий завершил отчёт текущего хода"),
            audience: "public",
            data: {
              kind: literal("phase"),
              phase: literal("reporting"),
              turnNumber: state("public.session.turnNumber")
            }
          },
          {
            id: "advance-turn-number",
            kind: "command",
            op: "core.number.add",
            target: { endpoint: "public.session.turnNumber" },
            delta: literal(1)
          },
          ...buildDueConstructionActivationSteps(),
          {
            id: "construction-activation-journal",
            kind: "command",
            op: "core.event.emit",
            eventType: "construction.activation.checked",
            summary: literal(
              "Runtime проверил готовность построенных объектов к открытию"
            ),
            audience: "public",
            data: {
              kind: literal("construction-activation"),
              turnNumber: state("public.session.turnNumber")
            }
          },
          {
            id: "start-next-news-phase",
            kind: "command",
            op: "core.state.patch",
            patches: [{
              operation: "set",
              target: { endpoint: "public.session.phase" },
              value: literal("news")
            }]
          }
        ]
      }
    }
  };
};

/**
 * Open construction objects whose N+2 boundary has just been reached.
 *
 * `blockingReasons` is the authority: the construction member is removed
 * independently, and a node/edge becomes traversable only when no news or
 * facilitator reason remains. Running this at the reporting boundary means
 * objects built in N stay closed throughout N+1 and open at the start of N+2.
 */
const buildDueConstructionActivationSteps = () =>
  ["networkNodes", "networkEdges"].flatMap((collection) => {
    const suffix = collection === "networkNodes" ? "nodes" : "edges";
    const facet = collection === "networkNodes" ? "availability" : "state";
    const dueId = `construction-due-${suffix}`;
    const releasableId = `construction-releasable-${suffix}`;
    return [
      {
        id: dueId,
        kind: "query",
        op: "core.entities.select",
        selector: {
          collection,
          attributes: {
            networkId: literal("main"),
            activationTurn: {
              operator: "lte",
              value: state("public.session.turnNumber")
            },
            blockingReasons: {
              operator: "contains",
              value: literal("construction-pending")
            }
          },
          cardinality: { min: 0, max: 64 }
        }
      },
      {
        id: `construction-unblock-${suffix}`,
        kind: "command",
        op: "core.entities.update",
        selection: result(dueId),
        attributeSetRemovals: {
          blockingReasons: literal("construction-pending")
        }
      },
      {
        id: releasableId,
        kind: "query",
        op: "core.entities.select",
        selector: {
          collection,
          within: result(dueId),
          attributes: {
            blockingReasons: {
              operator: "isEmpty",
              value: literal(null)
            }
          },
          cardinality: { min: 0, max: 64 }
        }
      },
      {
        id: `construction-open-${suffix}`,
        kind: "command",
        op: "core.entities.update",
        selection: result(releasableId),
        facetValues: {
          [facet]: literal("open")
        }
      }
    ];
  });

/** Declare one writable integer field in an existing object collection. */
const declareMaintenanceField = (collection, collectionId) => {
  assert.ok(collection, `missing Mechanics collection ${collectionId}`);
  collection.fields.maintenancePaidTurn = {
    storage: { kind: "attribute", name: "maintenancePaidTurn" },
    valueType: "core.integer",
    access: "read-write"
  };
};

/** Declare scratch counters rebuilt from active vehicles at phase completion. */
const declareProgressiveTaxTeamFields = (stateModel) => {
  const teams = stateModel.collections.teams;
  assert.ok(teams, "missing Mechanics collection teams");
  for (const field of [
    "progressiveTaxLocomotiveCount",
    "progressiveTaxWagonCount"
  ]) {
    teams.fields[field] = {
      storage: { kind: "attribute", name: field },
      valueType: "core.integer",
      access: "read-write"
    };
    stateModel.endpoints[`public.teams.bound.${field}`] = {
      audienceRef: "public",
      storage: {
        root: "public",
        segments: [
          "objects",
          "teams",
          { binding: "teamId" },
          "attributes",
          field
        ]
      },
      valueType: "core.integer",
      access: "read-write"
    };
  }
};

/** Register the public journal payloads emitted by this bounded workflow. */
const declareEvents = (stateModel) => {
  Object.assign(stateModel.types, {
    "game.session-play-start-event": {
      kind: "record",
      fields: {
        kind: { typeRef: "core.string", optional: false },
        turnNumber: { typeRef: "core.integer", optional: false }
      }
    },
    "game.maintenance-unit-settled-event": {
      kind: "record",
      fields: {
        kind: { typeRef: "core.string", optional: false },
        entityId: { typeRef: "core.string", optional: false },
        ownerTeamId: { typeRef: "core.string", optional: false },
        chargedAmount: { typeRef: "core.integer", optional: false },
        exempt: { typeRef: "core.boolean", optional: false },
        turnNumber: { typeRef: "core.integer", optional: false }
      }
    },
    "game.maintenance-phase-finished-event": {
      kind: "record",
      fields: {
        kind: { typeRef: "core.string", optional: false },
        turnNumber: { typeRef: "core.integer", optional: false }
      }
    },
    "game.progressive-asset-tax-paid-event": {
      kind: "record",
      fields: {
        kind: { typeRef: "core.string", optional: false },
        newsId: { typeRef: "core.string", optional: false },
        teamId: { typeRef: "core.string", optional: false },
        teamType: { typeRef: "core.string", optional: false },
        assetKind: { typeRef: "core.string", optional: false },
        ownedUnitCount: { typeRef: "core.integer", optional: false },
        threshold: { typeRef: "core.integer", optional: false },
        taxableUnitCount: { typeRef: "core.integer", optional: false },
        chargedAmount: { typeRef: "core.integer", optional: false },
        balanceAfter: { typeRef: "core.integer", optional: false },
        turnNumber: { typeRef: "core.integer", optional: false }
      }
    },
    "game.market-vehicle-transaction-event": {
      kind: "record",
      fields: {
        kind: { typeRef: "core.string", optional: false },
        assetKind: { typeRef: "core.string", optional: false },
        teamId: { typeRef: "core.string", optional: false },
        vehicleId: { typeRef: "core.string", optional: false },
        amount: { typeRef: "core.integer", optional: false },
        turnNumber: { typeRef: "core.integer", optional: false }
      }
    },
    "game.turn-phase-finished-event": {
      kind: "record",
      fields: {
        kind: { typeRef: "core.string", optional: false },
        phase: { typeRef: "core.string", optional: false },
        turnNumber: { typeRef: "core.integer", optional: false }
      }
    },
    "game.construction-activation-event": {
      kind: "record",
      fields: {
        kind: { typeRef: "core.string", optional: false },
        turnNumber: { typeRef: "core.integer", optional: false }
      }
    }
  });
  Object.assign(stateModel.events, {
    "session.play.started": {
      audienceRef: "public",
      payloadType: "game.session-play-start-event",
      journalEndpoint: { endpoint: "public.log" }
    },
    "maintenance.unit.settled": {
      audienceRef: "public",
      payloadType: "game.maintenance-unit-settled-event",
      journalEndpoint: { endpoint: "public.log" }
    },
    "maintenance.phase.finished": {
      audienceRef: "public",
      payloadType: "game.maintenance-phase-finished-event",
      journalEndpoint: { endpoint: "public.log" }
    },
    "maintenance.progressive-asset-tax.paid": {
      audienceRef: "public",
      payloadType: "game.progressive-asset-tax-paid-event",
      journalEndpoint: { endpoint: "public.log" }
    },
    "market.vehicle.purchased": {
      audienceRef: "public",
      payloadType: "game.market-vehicle-transaction-event",
      journalEndpoint: { endpoint: "public.log" }
    },
    "market.vehicle.sold": {
      audienceRef: "public",
      payloadType: "game.market-vehicle-transaction-event",
      journalEndpoint: { endpoint: "public.log" }
    },
    "market.phase.finished": {
      audienceRef: "public",
      payloadType: "game.turn-phase-finished-event",
      journalEndpoint: { endpoint: "public.log" }
    },
    "reporting.phase.finished": {
      audienceRef: "public",
      payloadType: "game.turn-phase-finished-event",
      journalEndpoint: { endpoint: "public.log" }
    },
    "construction.activation.checked": {
      audienceRef: "public",
      payloadType: "game.construction-activation-event",
      journalEndpoint: { endpoint: "public.log" }
    }
  });
};

const ownsOperatingId = (id) =>
  ownedExactActionIds.has(id)
  || ownedActionPrefixes.some((prefix) => id.startsWith(prefix));

/**
 * Apply only the game-local start and maintenance transformation.
 *
 * The source is cloned so `--check` and focused tests can prove deterministic
 * composition without modifying the parsed input object.
 */
const buildOperatingTurnAuthoring = (sourceAuthoring) => {
  const authoring = structuredClone(sourceAuthoring);
  const root = authoring.root;
  const stateModel = root.mechanics.stateModel;

  declareMaintenanceField(stateModel.collections.locomotives, "locomotives");
  declareMaintenanceField(stateModel.collections.wagons, "wagons");
  declareMaintenanceField(stateModel.collections.cargoOrders, "cargoOrders");
  declareProgressiveTaxTeamFields(stateModel);
  declareEvents(stateModel);

  const cargoOrders = root.state.public.objects.cargoOrders;
  assert.ok(cargoOrders && typeof cargoOrders === "object");
  for (const [cargoId, cargo] of Object.entries(cargoOrders)) {
    assert.equal(
      cargo.attributes.maintenancePaidTurn,
      0,
      `${cargoId} must be initialized by build-card-lifecycle.mjs`
    );
  }

  const generated = [
    buildSessionStart(),
    ...buildMaintenancePayments(),
    buildMaintenanceFinish(),
    buildMarketPurchase({
      assetKind: "wagon",
      collection: "wagons",
      objectType: "transport.wagon",
      teamType: "logistics_company",
      label: "Купить вагон",
      includeFormationTarget:
        stateModel.collections.wagons.fields.formationTargetLocomotiveId !==
        undefined,
      includeNews19Marker:
        stateModel.collections.wagons.fields.news19ConfiscatedTurn !== undefined
    }),
    buildMarketPurchase({
      assetKind: "locomotive",
      collection: "locomotives",
      objectType: "transport.locomotive",
      teamType: "locomotive_guild",
      label: "Купить локомотив",
      includeFormationTarget: false,
      includeNews19Marker:
        stateModel.collections.locomotives.fields.news19ConfiscatedTurn !==
        undefined
    }),
    buildMarketSale({
      assetKind: "wagon",
      collection: "wagons",
      parameterName: "wagonId",
      objectType: "transport.wagon",
      teamType: "logistics_company",
      label: "Продать вагон",
      salePrice: 2,
      includeFormationTarget:
        stateModel.collections.wagons.fields.formationTargetLocomotiveId !==
        undefined
    }),
    buildMarketSale({
      assetKind: "locomotive",
      collection: "locomotives",
      parameterName: "locomotiveId",
      objectType: "transport.locomotive",
      teamType: "locomotive_guild",
      label: "Продать локомотив",
      salePrice: 4,
      includeFormationTarget: false
    }),
    buildMarketFinish(),
    buildReportingFinish()
  ];
  const preservedActions = root.logic.actions.filter(
    (candidate) => !ownsOperatingId(candidate.id)
  );
  const firstLifecycleAction = preservedActions.findIndex((candidate) =>
    lifecyclePrefixes.some((prefix) => candidate.id.startsWith(prefix))
  );
  const actionInsertionIndex =
    firstLifecycleAction === -1 ? preservedActions.length : firstLifecycleAction;
  root.logic.actions = [
    ...preservedActions.slice(0, actionInsertionIndex),
    ...generated.map((item) => item.action),
    ...preservedActions.slice(actionInsertionIndex)
  ];
  const preservedPlans = Object.entries(root.mechanics.plans).filter(
    ([planId]) => !ownsOperatingId(planId)
  );
  const firstLifecyclePlan = preservedPlans.findIndex(([planId]) =>
    lifecyclePrefixes.some((prefix) => planId.startsWith(prefix))
  );
  const planInsertionIndex =
    firstLifecyclePlan === -1 ? preservedPlans.length : firstLifecyclePlan;
  root.mechanics.plans = Object.fromEntries([
    ...preservedPlans.slice(0, planInsertionIndex),
    ...generated.map((item) => [item.action.id, item.plan]),
    ...preservedPlans.slice(planInsertionIndex)
  ]);

  const board = root.state.public.board;
  assert.ok(
    Array.isArray(board?.availableActions),
    "public board availableActions must be an array"
  );
  const preservedBoardActions = board.availableActions.filter(
    (candidate) => !ownedBoardActionIds.has(candidate.id)
  );
  const operatingLifecycleBoardActions = [{
      id: "session-play-start",
      label: "Начать первый ход",
      description:
        "После завершённой расстановки и подготовки колод открывает новостной этап первого хода.",
      actionId: "session.play.start",
      phase: "setup-complete",
      section: "setup"
    },
    {
      id: "maintenance-pay-locomotive",
      label: "Оплатить обслуживание локомотива",
      description:
        "Выберите локомотив; сервер определит владельца, льготу и обязательную сумму.",
      actionId: "maintenance.pay.locomotive",
      phase: "maintenance",
      section: "maintenance"
    },
    {
      id: "maintenance-pay-wagon",
      label: "Оплатить обслуживание вагона",
      description:
        "Выберите вагон; сервер определит владельца, льготу и обязательную сумму.",
      actionId: "maintenance.pay.wagon",
      phase: "maintenance",
      section: "maintenance"
    },
    {
      id: "maintenance-pay-held-cargo",
      label: "Оплатить хранение груза",
      description:
        "Выберите удерживаемый груз; сервер определит владельца и обязательную сумму.",
      actionId: "maintenance.pay.held-cargo",
      phase: "maintenance",
      section: "maintenance"
    },
    {
      id: "maintenance-phase-finish",
      label: "Завершить обслуживание",
      description:
        "Проверяет все обязательные платежи и постоянный налог новости №14, затем открывает рынок.",
      actionId: "maintenance.phase.finish",
      phase: "maintenance",
      section: "maintenance"
    }];
  const phaseBoundaryBoardActions = [{
      id: "market-purchase-wagon",
      label: "Купить вагон",
      description:
        "Выберите команду-перевозчика и открытый терминал; сервер применит новость, цену и проверку денег.",
      actionId: "market.purchase.wagon",
      phase: "market",
      section: "market"
    },
    {
      id: "market-purchase-locomotive",
      label: "Купить локомотив",
      description:
        "Выберите паровозную гильдию и открытый терминал; сервер также не допустит третий локомотив в точке.",
      actionId: "market.purchase.locomotive",
      phase: "market",
      section: "market"
    },
    {
      id: "market-sell-wagon",
      label: "Продать вагон",
      description:
        "Выберите активный пустой и не прицепленный вагон команды-перевозчика.",
      actionId: "market.sell.wagon",
      phase: "market",
      section: "market"
    },
    {
      id: "market-sell-locomotive",
      label: "Продать локомотив",
      description:
        "Выберите активный локомотив паровозной гильдии без прицепленных вагонов.",
      actionId: "market.sell.locomotive",
      phase: "market",
      section: "market"
    },
    {
      id: "market-phase-finish",
      label: "Завершить рынок",
      description:
        "Переходит к грузам после любого количества покупок и продаж, включая ноль.",
      actionId: "market.phase.finish",
      phase: "market",
      section: "market"
    },
    {
      id: "reporting-phase-finish",
      label: "Начать следующий ход",
      description:
        "Завершает текущий отчёт, увеличивает номер хода и открывает следующий новостной этап.",
      actionId: "reporting.phase.finish",
      phase: "reporting",
      section: "reporting"
    }];
  /*
   * Learning-pause controls are intentionally interleaved between
   * maintenance and the market/report boundary. Preserve that stable order
   * regardless of whether this generator or the facilitation generator runs
   * last; otherwise both valid generators can never pass `--check` together.
   */
  const firstMethodologyBoardActionIndex = preservedBoardActions.findIndex(
    (candidate) => candidate.actionId?.startsWith("methodology.pause.")
  );
  const firstMovementBoardActionIndex = preservedBoardActions.findIndex(
    (candidate) => candidate.actionId?.startsWith("movement.")
  );
  const lifecycleInsertionIndex =
    firstMethodologyBoardActionIndex !== -1
      ? firstMethodologyBoardActionIndex
      : firstMovementBoardActionIndex === -1
        ? preservedBoardActions.length
        : firstMovementBoardActionIndex;
  const withOperatingLifecycle = [
    ...preservedBoardActions.slice(0, lifecycleInsertionIndex),
    ...operatingLifecycleBoardActions,
    ...preservedBoardActions.slice(lifecycleInsertionIndex)
  ];
  const boundaryInsertionIndex = withOperatingLifecycle.findIndex(
    (candidate) => candidate.actionId?.startsWith("movement.")
  );
  board.availableActions = [
    ...withOperatingLifecycle.slice(
      0,
      boundaryInsertionIndex === -1
        ? withOperatingLifecycle.length
        : boundaryInsertionIndex
    ),
    ...phaseBoundaryBoardActions,
    ...withOperatingLifecycle.slice(
      boundaryInsertionIndex === -1
        ? withOperatingLifecycle.length
        : boundaryInsertionIndex
    )
  ];

  const facilitatorFlow = root.logic.flows.find((flow) => flow.id === "facilitator");
  assert.ok(facilitatorFlow, "facilitator flow is required");
  const preservedSteps = facilitatorFlow.steps.filter(
    (step) => !ownedFlowStepIds.has(step.id)
  );
  const newsStepIndex = preservedSteps.findIndex(
    (step) => step.id === "facilitator.news-lifecycle"
  );
  const setupStepIndex = preservedSteps.findIndex((step) => step.id === "facilitator.setup");
  // The card generator can run before or after this generator. When its news
  // step already exists, maintenance belongs immediately after it; otherwise
  // this earlier slice temporarily follows setup and a later card rebuild
  // inserts news directly before it.
  const insertionIndex =
    newsStepIndex !== -1
      ? newsStepIndex + 1
      : setupStepIndex === -1
        ? 0
        : setupStepIndex + 1;
  const finishActionIds = [
    "session.finish.request",
    "session.finish.confirm",
    "session.finish.cancel"
  ];
  const stepsThroughMarket = [
    ...preservedSteps.slice(0, insertionIndex),
    {
      id: operatingFlowStepId,
      _type: "game.Step",
      _label: "Первый ход и обслуживание",
      _semantics:
        "Ведущий начинает обычную партию, явно пропускает новость первого хода и пообъектно закрывает обязательное обслуживание.",
      screenId: "facilitator",
      actionIds: [
        "session.play.start",
        "news.lifecycle.first-turn.skip",
        "maintenance.pay.locomotive",
        "maintenance.pay.wagon",
        "maintenance.pay.held-cargo",
        "maintenance.phase.finish",
        ...finishActionIds
      ]
    },
    {
      id: marketFlowStepId,
      _type: "game.Step",
      _label: "Рынок",
      _semantics:
        "Ведущий повторяет разрешённые покупки и продажи техники, затем явно завершает рынок.",
      screenId: "facilitator",
      actionIds: [
        "market.purchase.wagon",
        "market.purchase.locomotive",
        "market.sell.wagon",
        "market.sell.locomotive",
        "market.phase.finish",
        ...finishActionIds
      ]
    },
    ...preservedSteps.slice(insertionIndex)
  ];
  const constructionStepIndex = stepsThroughMarket.findIndex(
    (step) => step.id === "facilitator.construction"
  );
  const reportingInsertionIndex =
    constructionStepIndex === -1
      ? stepsThroughMarket.length
      : constructionStepIndex + 1;
  facilitatorFlow.steps = [
    ...stepsThroughMarket.slice(0, reportingInsertionIndex),
    {
      id: reportingFlowStepId,
      _type: "game.Step",
      _label: "Отчёт и следующий ход",
      _semantics:
        "Ведущий завершает текущий отчёт и открывает новостной этап следующего пронумерованного хода.",
      screenId: "facilitator",
      actionIds: [
        "reporting.phase.finish",
        ...finishActionIds
      ]
    },
    ...stepsThroughMarket.slice(reportingInsertionIndex)
  ];

  const constructionReady = root.content.data.constructionCycle !== undefined;
  const cargoPriorityReady =
    root.content.data.cardLifecycle?.cargoSelectionPriority !== undefined;
  root.content.data.operatingTurn = {
    status: constructionReady
      ? "executable-repeatable-market-cycle-with-construction"
      : "executable-repeatable-market-no-build-cycle",
    publishable: false,
    supportedSetup:
      "confirmed team counts 4–12; even split equally, odd split with one extra logistics company",
    firstTurnNews: "explicit skip without deck or random consumption",
    maintenance: {
      coinsPerActiveVehicle: 1,
      coinsPerHeldCargo: 1,
      heldCargoStatuses: ["available", "in_transit"],
      ownerSource: "server-side object state",
      news25:
        "permits direct journaled phase completion without debit or per-unit clicks",
      news14: {
        duration: "from application through game end",
        locomotiveGuild: {
          threshold: 3,
          coinsPerActiveLocomotiveAboveThreshold: 1
        },
        logisticsCompany: {
          threshold: 5,
          coinsPerActiveWagonAboveThreshold: 1
        },
        settlement:
          "authoritative recount and atomic debit for every team at maintenance finish",
        insufficientFunds:
          "transaction fails without loan, elimination or partial charge"
      }
    },
    market: {
      status: "executable",
      permissions:
        "logistics companies buy/sell wagons; locomotive guilds buy/sell locomotives",
      basePurchasePrices: { wagon: 5, locomotive: 10 },
      salePrices: { wagon: 2, locomotive: 4 },
      turnOverrides:
        "news purchase prohibition and purchase price override are resolved from authoritative turnEffects",
      inventory:
        "no game stock or per-team limit; collection capacity 64 is only a bounded-execution safeguard",
      placement:
        "purchases become active at an open main-network terminal; at most two locomotives per terminal",
      repetition:
        "any number of atomic trades may occur before the facilitator finishes the phase"
    },
    repeatablePhaseCycle: {
      marketToCargo: "explicit-finish-after-repeatable-transactions",
      reportingToNews: "atomic-turn-increment",
      scope: constructionReady ? "market-with-construction" : "market-no-build"
    },
    boundary: "next-turn-news",
    unresolvedAfterBoundary: [
      "author-confirmation-of-initial-network-overlay",
      ...(root.content.data.cardLifecycle?.unresolvedRuleNewsNumbers?.length
        ? ["remaining-news-effects"]
        : []),
      ...(cargoPriorityReady ? [] : ["cargo-selection-priority"]),
      ...(constructionReady ? [] : ["real-construction"]),
      "reporting-and-reflection-content"
    ]
  };
  if (Array.isArray(root.content.data.cargoSettlement?.unresolvedBeforeFullTurn)) {
    root.content.data.cargoSettlement.unresolvedBeforeFullTurn =
      root.content.data.cargoSettlement.unresolvedBeforeFullTurn.filter(
        (item) => item !== "market-entry-to-cargo"
      );
  }

  const blockers = new Set(root.config.runtimeBlockers);
  const broadPreMovementBlocker =
    "remaining market, movement, settlement, construction and reporting workflows";
  const precisePostOrderBlocker =
    "remaining market, real graph movement, settlement, construction and reporting workflows";
  const precisePostTraversalBlocker =
    "remaining market, train formation, cargo handling, settlement, construction and reporting workflows";
  const precisePostFormationBlocker =
    "remaining market, cargo handling, settlement, construction and reporting workflows";
  const precisePostCargoSettlementBlocker =
    "remaining market, cargo selection sequencing, construction and reporting workflows";
  const postConstructionBlocker =
    "remaining market, cargo selection sequencing and reporting workflows";
  const postCargoPriorityBlocker =
    "remaining market and reporting workflows";
  const reportingOnlyBlocker = "remaining reporting workflows";
  blockers.delete(precisePostCargoSettlementBlocker);
  blockers.delete(postConstructionBlocker);
  blockers.delete(postCargoPriorityBlocker);
  blockers.delete(reportingOnlyBlocker);
  if (root.content.data.movementTurn) {
    // A later movement generator may already have proved ordering and the
    // explicit all-skip path, and perhaps real graph traversal as well.
    // Rebuilding this earlier slice must preserve the most precise proven
    // boundary instead of restoring an obsolete broader blocker.
    blockers.delete(broadPreMovementBlocker);
    if (root.content.data.movementTurn.graphTraversal) {
      blockers.delete(precisePostOrderBlocker);
      if (root.content.data.cargoSettlement) {
        blockers.delete(precisePostTraversalBlocker);
        blockers.delete(precisePostFormationBlocker);
        blockers.add(
          cargoPriorityReady && constructionReady
            ? reportingOnlyBlocker
            : constructionReady
              ? postConstructionBlocker
              : precisePostCargoSettlementBlocker
        );
      } else if (root.content.data.trainFormation) {
        blockers.delete(precisePostTraversalBlocker);
        blockers.add(precisePostFormationBlocker);
      } else {
        blockers.add(precisePostTraversalBlocker);
      }
    } else {
      blockers.add(precisePostOrderBlocker);
    }
  } else {
    blockers.add(broadPreMovementBlocker);
  }
  root.config.runtimeBlockers = [...blockers];
  root.config.runtimeReady = false;

  return authoring;
};

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** Build from the checked-in authoring source for CLI and tests. */
const buildFromDisk = async () =>
  buildOperatingTurnAuthoring(await readJson(authoringPath));

/** Replace a generated document atomically so interruption cannot truncate it. */
const writeAtomically = async (filePath, content) => {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
};

/** Execute the deterministic build or compare it with the checked-in source. */
const run = async (argv) => {
  const checkOnly = argv.length === 1 && argv[0] === "--check";
  if (argv.length > (checkOnly ? 1 : 0)) {
    throw new Error("usage: build-operating-turn.mjs [--check]");
  }
  const sourceText = await readFile(authoringPath, "utf8");
  const builtText = serialize(await buildFromDisk());
  if (checkOnly) {
    assert.equal(
      sourceText,
      builtText,
      "operating-turn authoring is stale; run build-operating-turn.mjs"
    );
  } else {
    await writeAtomically(authoringPath, builtText);
  }
  process.stdout.write(
    `cards-money-trains: ${checkOnly ? "verified" : "built"} repeatable market turn cycle\n`
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
  buildOperatingTurnAuthoring
};
