#!/usr/bin/env node
/**
 * Build the game-local facilitator economy for «Карты, деньги, поезда».
 *
 * Classification:
 * - game-specific rules: explicit loans, discretionary team exclusion and the
 *   facilitator's manual money-correction table;
 * - general existing mechanics: bounded entity selection/iteration, atomic
 *   resource transfers, typed attribute/facet updates and journal events.
 *
 * No runtime branch or public platform contract is introduced here. The
 * generator owns only `facilitator.economy.*` actions/plans, its team debt
 * field and economy journal declarations. It deliberately keeps mandatory
 * payments fail-closed: the facilitator first issues an explicit loan or
 * excludes the team, then retries the original payment if the team remains.
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
const ownedActionPrefix = "facilitator.economy.";
const economyActionIds = [
  "facilitator.economy.adjust.credit",
  "facilitator.economy.adjust.debit",
  "facilitator.economy.loan.issue",
  "facilitator.economy.loan.repay",
  "facilitator.economy.team.exclude"
];
const economyBoardActionIds = new Set(
  economyActionIds.map((actionId) => actionId.replaceAll(".", "-"))
);
const maximumAdjustment = 1_000_000;

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
const itemAttribute = (field) => ({
  op: "value.item",
  area: "attribute",
  field
});
const entityValue = (collection, entityId, field) => ({
  op: "value.entity",
  entity: { collection, entityId },
  field
});
const coalesce = (...items) => ({ op: "value.coalesce", items });
const compare = (operator, left, right) => ({
  op: "predicate.compare",
  operator,
  left,
  right
});
const all = (...items) => ({ op: "predicate.all", items });
const any = (...items) => ({ op: "predicate.any", items });
const exists = (value, expected = true) => ({
  op: "predicate.exists",
  value,
  exists: expected
});

const teamReference = {
  type: "string",
  maxLength: 128,
  "x-cubica-ref": {
    kind: "object",
    collection: "teams",
    allowedTypes: ["game.team"],
    visibility: "public"
  }
};

const teamParamsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    teamId: teamReference
  },
  required: ["teamId"]
};

const moneyParamsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    teamId: teamReference,
    // The table accepts whole non-negative values. A zero entry is a valid
    // explicit correction and still produces an auditable journal record.
    amount: {
      type: "integer",
      minimum: 0,
      maximum: maximumAdjustment
    }
  },
  required: ["teamId", "amount"]
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
  paramsSchema,
  binding: {
    kind: "mechanics-plan",
    planRef: id
  }
});

/** Money controls are available only for a placed, non-excluded normal team. */
const activeTeamGuard = (teamId) => all(
  compare("eq", state("public.session.fixtureId"), literal(normalFixtureId)),
  any(
    compare("eq", state("public.session.status"), literal("active")),
    compare("eq", state("public.session.status"), literal("running"))
  ),
  {
    op: "predicate.entity.matches",
    entity: { collection: "teams", entityId: teamId },
    objectType: "game.team",
    facets: { placementStatus: literal("placed") }
  }
);

/** Exclusion is a resolution for a mandatory payment, not a setup command. */
const exclusionGuard = (teamId) => all(
  activeTeamGuard(teamId),
  any(
    compare("eq", state("public.session.phase"), literal("news")),
    compare("eq", state("public.session.phase"), literal("maintenance")),
    compare("eq", state("public.session.phase"), literal("operations")),
    compare("eq", state("public.session.phase"), literal("settlement"))
  ),
  any(
    compare("ne", state("public.session.phase"), literal("operations")),
    exists(state("public.movement.currentLocomotiveId"))
  )
);

const teamCoinsEndpoint = (teamId) => ({
  endpoint: "public.teams.bound.coins",
  bindings: { teamId }
});
const teamDebtEndpoint = (teamId) => ({
  endpoint: "public.teams.bound.outstandingDebt",
  bindings: { teamId }
});

/** Emit the common, compact audit record after the candidate mutation. */
const journalStep = ({ id, eventType, summary, kind, teamId, amount }) => ({
  id,
  kind: "command",
  op: "core.event.emit",
  eventType,
  summary: literal(summary),
  audience: "public",
  data: {
    kind: literal(kind),
    teamId,
    amount,
    balanceAfter: entityValue("teams", teamId, "coins"),
    debtAfter: entityValue("teams", teamId, "outstandingDebt"),
    turnNumber: state("public.session.turnNumber")
  }
});

const buildCredit = () => {
  const id = "facilitator.economy.adjust.credit";
  const teamId = param("teamId");
  const amount = param("amount");
  return {
    action: action({
      id,
      label: "Начислить деньги команде",
      semantics:
        "Ведущий явно начисляет выбранной команде целое неотрицательное число монет; долг не меняется.",
      paramsSchema: moneyParamsSchema
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: activeTeamGuard(teamId),
            errorCode: "FACILITATOR_ECONOMY_TEAM_UNAVAILABLE"
          },
          {
            id: "credit",
            kind: "command",
            op: "core.resource.transfer",
            from: { kind: "bank" },
            to: { kind: "state", target: teamCoinsEndpoint(teamId) },
            amount,
            onInsufficient: "fail"
          },
          journalStep({
            id: "journal",
            eventType: "facilitator.economy.adjustment.credited",
            summary: "Ведущий начислил деньги команде",
            kind: "manual-credit",
            teamId,
            amount
          })
        ]
      }
    }
  };
};

const buildDebit = () => {
  const id = "facilitator.economy.adjust.debit";
  const teamId = param("teamId");
  const amount = param("amount");
  return {
    action: action({
      id,
      label: "Списать деньги у команды",
      semantics:
        "Ведущий явно списывает целое неотрицательное число монет; недостаток средств отклоняет всю операцию без отрицательного баланса.",
      paramsSchema: moneyParamsSchema
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: activeTeamGuard(teamId),
            errorCode: "FACILITATOR_ECONOMY_TEAM_UNAVAILABLE"
          },
          {
            id: "debit",
            kind: "command",
            op: "core.resource.transfer",
            from: { kind: "state", target: teamCoinsEndpoint(teamId) },
            to: { kind: "bank" },
            amount,
            onInsufficient: "fail"
          },
          journalStep({
            id: "journal",
            eventType: "facilitator.economy.adjustment.debited",
            summary: "Ведущий списал деньги у команды",
            kind: "manual-debit",
            teamId,
            amount
          })
        ]
      }
    }
  };
};

const buildLoanIssue = () => {
  const id = "facilitator.economy.loan.issue";
  const teamId = param("teamId");
  const amount = param("amount");
  return {
    action: action({
      id,
      label: "Выдать займ команде",
      semantics:
        "Одним атомарным действием увеличивает деньги и непогашенный долг выбранной команды.",
      paramsSchema: moneyParamsSchema
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: activeTeamGuard(teamId),
            errorCode: "FACILITATOR_ECONOMY_TEAM_UNAVAILABLE"
          },
          {
            id: "credit-loan",
            kind: "command",
            op: "core.resource.transfer",
            from: { kind: "bank" },
            to: { kind: "state", target: teamCoinsEndpoint(teamId) },
            amount,
            onInsufficient: "fail"
          },
          {
            id: "increase-debt",
            kind: "command",
            op: "core.number.add",
            target: teamDebtEndpoint(teamId),
            delta: amount
          },
          journalStep({
            id: "journal",
            eventType: "facilitator.economy.loan.issued",
            summary: "Ведущий выдал команде явный займ",
            kind: "loan-issue",
            teamId,
            amount
          })
        ]
      }
    }
  };
};

const buildLoanRepay = () => {
  const id = "facilitator.economy.loan.repay";
  const teamId = param("teamId");
  const amount = param("amount");
  return {
    action: action({
      id,
      label: "Погасить займ команды",
      semantics:
        "Списывает деньги и на ту же сумму уменьшает непогашенный долг; переплата и отрицательный баланс запрещены.",
      paramsSchema: moneyParamsSchema
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: all(
              activeTeamGuard(teamId),
              compare(
                "gte",
                entityValue("teams", teamId, "outstandingDebt"),
                amount
              )
            ),
            errorCode: "FACILITATOR_ECONOMY_LOAN_REPAY_INVALID"
          },
          {
            id: "debit-repayment",
            kind: "command",
            op: "core.resource.transfer",
            from: { kind: "state", target: teamCoinsEndpoint(teamId) },
            to: { kind: "bank" },
            amount,
            onInsufficient: "fail"
          },
          {
            id: "decrease-debt",
            kind: "command",
            op: "core.number.add",
            target: teamDebtEndpoint(teamId),
            delta: {
              op: "number.subtract",
              items: [literal(0), amount]
            }
          },
          journalStep({
            id: "journal",
            eventType: "facilitator.economy.loan.repaid",
            summary: "Команда погасила часть явного займа",
            kind: "loan-repay",
            teamId,
            amount
          })
        ]
      }
    }
  };
};

/**
 * Exclude one team and reconcile every durable object it can still own.
 *
 * The current market has unlimited supply and represents returned equipment
 * with the existing `sold` facet. Historical `ownerTeamId` is read-only and is
 * intentionally retained for audit; sold objects are absent from every active
 * movement, maintenance, market and cargo selector.
 */
const buildTeamExclude = (finalMovementPhase) => {
  const id = "facilitator.economy.team.exclude";
  const teamId = param("teamId");
  const turnNumber = state("public.session.turnNumber");
  const currentLocomotiveId = state("public.movement.currentLocomotiveId");
  const concreteCurrentLocomotiveId = coalesce(
    currentLocomotiveId,
    literal("")
  );
  const currentOwnedByTeam = all(
    compare("eq", state("public.session.phase"), literal("operations")),
    exists(currentLocomotiveId),
    compare(
      "eq",
      entityValue("locomotives", concreteCurrentLocomotiveId, "ownerTeamId"),
      teamId
    )
  );
  const hasRemainingLocomotives = compare(
    "ne",
    result("remaining-locomotives", ["ids"]),
    literal([])
  );
  const noRemainingLocomotives = compare(
    "eq",
    result("remaining-locomotives", ["ids"]),
    literal([])
  );
  const carriedCargoPickupNode = coalesce(
    entityValue(
      "wagons",
      coalesce(itemAttribute("carrierWagonId"), literal("")),
      "nodeId"
    ),
    itemAttribute("availableAtNodeId"),
    itemAttribute("fromNodeId")
  );

  return {
    action: action({
      id,
      label: "Исключить команду",
      semantics:
        "По решению ведущего исключает команду при обязательном дефиците, списывает долг, возвращает технику на рынок и оставляет незавершённые грузы на текущих терминалах.",
      paramsSchema: teamParamsSchema
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: exclusionGuard(teamId),
            errorCode: "FACILITATOR_ECONOMY_EXCLUSION_UNAVAILABLE"
          },
          {
            id: "carried-team-cargo",
            kind: "query",
            op: "core.entities.select",
            selector: {
              collection: "cargoOrders",
              objectTypes: ["transport.cargo"],
              attributes: {
                holderTeamId: teamId,
                carrierWagonId: {
                  operator: "ne",
                  value: literal(null)
                }
              },
              cardinality: { min: 0, max: 256 }
            }
          },
          {
            id: "release-carried-team-cargo",
            kind: "command",
            op: "core.entities.update",
            selection: result("carried-team-cargo"),
            // A single bounded bulk update stays below the static plan budget.
            // The excluded team's wagon cargo slots are cleared by the later
            // `return-team-wagons` update in the same atomic transaction.
            facetValues: {
              status: literal("available")
            },
            attributeValues: {
              holderTeamId: literal(null),
              carrierWagonId: literal(null),
              availableAtNodeId: carriedCargoPickupNode,
              activeLegFromNodeId: carriedCargoPickupNode
            }
          },
          {
            id: "uncarried-team-cargo",
            kind: "query",
            op: "core.entities.select",
            selector: {
              collection: "cargoOrders",
              objectTypes: ["transport.cargo"],
              attributes: {
                holderTeamId: teamId,
                carrierWagonId: literal(null)
              },
              cardinality: { min: 0, max: 256 }
            }
          },
          {
            id: "release-uncarried-team-cargo",
            kind: "command",
            op: "core.entities.update",
            selection: result("uncarried-team-cargo"),
            facetValues: {
              status: literal("available")
            },
            attributeValues: {
              holderTeamId: literal(null),
              activeLegFromNodeId: itemAttribute("availableAtNodeId")
            }
          },
          {
            id: "attached-wagons",
            kind: "query",
            op: "core.entities.select",
            selector: {
              collection: "wagons",
              objectTypes: ["transport.wagon"],
              attributes: {
                attachedVehicleId: {
                  operator: "ne",
                  value: literal(null)
                }
              },
              cardinality: { min: 0, max: 64 }
            }
          },
          {
            id: "detach-affected-wagons",
            kind: "command",
            op: "core.entities.each",
            selection: result("attached-wagons"),
            body: [{
              id: "detach-wagon",
              kind: "command",
              op: "relation.detach",
              networkId: "main",
              primary: coalesce(
                itemAttribute("attachedVehicleId"),
                literal("")
              ),
              related: [itemId()],
              when: any(
                compare("eq", itemAttribute("ownerTeamId"), teamId),
                compare(
                  "eq",
                  entityValue(
                    "locomotives",
                    coalesce(
                      itemAttribute("attachedVehicleId"),
                      literal("")
                    ),
                    "ownerTeamId"
                  ),
                  teamId
                )
              )
            }]
          },
          {
            id: "formation-draft-wagons",
            kind: "query",
            op: "core.entities.select",
            selector: {
              collection: "wagons",
              objectTypes: ["transport.wagon"],
              attributes: {
                formationTargetLocomotiveId: {
                  operator: "ne",
                  value: literal(null)
                }
              },
              cardinality: { min: 0, max: 64 }
            }
          },
          {
            id: "clear-affected-formation-drafts",
            kind: "command",
            op: "core.entities.each",
            selection: result("formation-draft-wagons"),
            body: [{
              id: "clear-draft",
              kind: "command",
              op: "core.entity.attributes.patch",
              entity: { collection: "wagons", entityId: itemId() },
              patches: [{
                operation: "set",
                path: ["formationTargetLocomotiveId"],
                value: literal(null)
              }],
              when: any(
                compare("eq", itemAttribute("ownerTeamId"), teamId),
                compare(
                  "eq",
                  entityValue(
                    "locomotives",
                    coalesce(
                      itemAttribute("formationTargetLocomotiveId"),
                      literal("")
                    ),
                    "ownerTeamId"
                  ),
                  teamId
                )
              )
            }]
          },
          {
            id: "team-locomotives",
            kind: "query",
            op: "core.entities.select",
            selector: {
              collection: "locomotives",
              objectTypes: ["transport.locomotive"],
              attributes: { ownerTeamId: teamId },
              cardinality: { min: 0, max: 64 }
            }
          },
          {
            id: "return-team-locomotives",
            kind: "command",
            op: "core.entities.update",
            selection: result("team-locomotives"),
            facetValues: { availability: literal("sold") },
            attributeValues: {
              nodeId: literal(null),
              actionPoints: literal(0),
              turnOrderCount: literal(0),
              movementResolvedTurn: turnNumber,
              lastMovedTurn: literal(0)
            }
          },
          {
            id: "team-wagons",
            kind: "query",
            op: "core.entities.select",
            selector: {
              collection: "wagons",
              objectTypes: ["transport.wagon"],
              attributes: { ownerTeamId: teamId },
              cardinality: { min: 0, max: 64 }
            }
          },
          {
            id: "return-team-wagons",
            kind: "command",
            op: "core.entities.update",
            selection: result("team-wagons"),
            facetValues: { availability: literal("sold") },
            attributeValues: {
              nodeId: literal(null),
              attachedVehicleId: literal(null),
              cargoId: literal(null),
              formationTargetLocomotiveId: literal(null),
              cargoOfferEligibleTurn: literal(0),
              cargoOfferResolvedTurn: literal(0),
              cargoPriorityActiveCount: literal(0)
            }
          },
          {
            id: "exclude-team",
            kind: "command",
            op: "core.entity.facet.set",
            entity: { collection: "teams", entityId: teamId },
            facet: "placementStatus",
            value: literal("excluded")
          },
          {
            id: "clear-team-financial-obligations",
            kind: "command",
            op: "core.entity.attributes.patch",
            entity: { collection: "teams", entityId: teamId },
            patches: [
              {
                operation: "set",
                path: ["outstandingDebt"],
                value: literal(0)
              },
              {
                operation: "set",
                path: ["constructionPledge"],
                value: literal(0)
              },
              {
                operation: "set",
                path: ["progressiveTaxLocomotiveCount"],
                value: literal(0)
              },
              {
                operation: "set",
                path: ["progressiveTaxWagonCount"],
                value: literal(0)
              }
            ]
          },
          {
            id: "remaining-locomotives",
            kind: "query",
            op: "core.entities.select",
            selector: {
              collection: "locomotives",
              objectTypes: ["transport.locomotive"],
              facets: { availability: literal("active") },
              attributes: {
                turnOrderCount: literal(1),
                movementResolvedTurn: {
                  operator: "ne",
                  value: turnNumber
                }
              },
              cardinality: { min: 0, max: 64 }
            }
          },
          {
            id: "next-locomotive",
            kind: "query",
            op: "core.sequence.next",
            items: state("public.movement.locomotiveOrder"),
            current: currentLocomotiveId,
            exclude: {
              collection: "locomotives",
              field: "movementResolvedTurn",
              values: [turnNumber]
            },
            when: all(currentOwnedByTeam, hasRemainingLocomotives)
          },
          {
            id: "advance-current-locomotive",
            kind: "command",
            op: "core.state.patch",
            patches: [{
              operation: "set",
              target: { endpoint: "public.movement.currentLocomotiveId" },
              value: result("next-locomotive")
            }],
            when: all(currentOwnedByTeam, hasRemainingLocomotives)
          },
          {
            id: "finish-empty-movement",
            kind: "command",
            op: "core.state.patch",
            patches: [
              {
                operation: "set",
                target: { endpoint: "public.movement.currentLocomotiveId" },
                value: literal(null)
              },
              {
                operation: "set",
                target: { endpoint: "public.session.phase" },
                value: literal(finalMovementPhase)
              },
              ...(finalMovementPhase === "construction"
                ? [{
                    operation: "set",
                    target: { endpoint: "public.construction.available" },
                    value: literal(true)
                  }]
                : [])
            ],
            when: all(currentOwnedByTeam, noRemainingLocomotives)
          },
          journalStep({
            id: "journal",
            eventType: "facilitator.economy.team.excluded",
            summary: "Ведущий исключил команду из партии",
            kind: "team-exclusion",
            teamId,
            amount: literal(0)
          })
        ]
      }
    }
  };
};

/** Declare the economy-owned fields and shared cargo-location invariants. */
const declareEconomyState = (root) => {
  const stateModel = root.mechanics.stateModel;
  const teams = stateModel.collections.teams;
  assert.ok(teams, "missing Mechanics collection teams");
  assert.ok(root.objectTypes["game.team"], "missing game.team object type");

  const placementType = stateModel.types["game.team-placement-status"];
  assert.equal(placementType?.kind, "enum", "team placement status enum is required");
  placementType.values = [...new Set([...placementType.values, "excluded"])];
  root.objectTypes["game.team"].facets.placementStatus.values.excluded = {
    visible: true,
    interactive: false
  };

  teams.fields.outstandingDebt = {
    storage: { kind: "attribute", name: "outstandingDebt" },
    valueType: "core.integer",
    access: "read-write"
  };
  stateModel.endpoints["public.teams.bound.outstandingDebt"] = {
    audienceRef: "public",
    storage: {
      root: "public",
      segments: [
        "objects",
        "teams",
        { binding: "teamId" },
        "attributes",
        "outstandingDebt"
      ]
    },
    valueType: "core.integer",
    access: "read-write"
  };

  const cargo = stateModel.collections.cargoOrders;
  assert.ok(cargo, "missing Mechanics collection cargoOrders");
  cargo.fields.availableAtNodeId = {
    storage: { kind: "attribute", name: "availableAtNodeId" },
    valueType: "core.string",
    access: "read-write"
  };
  cargo.fields.activeLegFromNodeId = {
    storage: { kind: "attribute", name: "activeLegFromNodeId" },
    valueType: "core.string",
    access: "read-write"
  };

  stateModel.types["game.facilitator-economy-event"] = {
    kind: "record",
    fields: {
      kind: { typeRef: "core.string", optional: false },
      teamId: { typeRef: "core.string", optional: false },
      amount: { typeRef: "core.integer", optional: false },
      balanceAfter: { typeRef: "core.integer", optional: false },
      debtAfter: { typeRef: "core.integer", optional: false },
      turnNumber: { typeRef: "core.integer", optional: false }
    }
  };
  for (const eventType of [
    "facilitator.economy.adjustment.credited",
    "facilitator.economy.adjustment.debited",
    "facilitator.economy.loan.issued",
    "facilitator.economy.loan.repaid",
    "facilitator.economy.team.excluded"
  ]) {
    stateModel.events[eventType] = {
      audienceRef: "public",
      payloadType: "game.facilitator-economy-event",
      journalEndpoint: { endpoint: "public.log" }
    };
  }

  for (const team of Object.values(root.state.public.objects.teams)) {
    team.attributes.outstandingDebt ??= 0;
  }
  for (const cargoObject of Object.values(root.state.public.objects.cargoOrders)) {
    cargoObject.attributes.availableAtNodeId ??=
      cargoObject.attributes.fromNodeId;
    cargoObject.attributes.activeLegFromNodeId ??=
      cargoObject.attributes.availableAtNodeId;
  }
  // Setup and market generators own creation paths. Injecting only the
  // economy-owned default keeps all generator orders idempotent.
  for (const plan of Object.values(root.mechanics.plans)) {
    for (const step of plan.transaction.steps) {
      if (step.op === "core.entity.create" && step.collection === "teams") {
        step.attributes.outstandingDebt = literal(0);
      }
      if (step.op === "core.entity.create" && step.collection === "cargoOrders") {
        step.attributes.availableAtNodeId ??= step.attributes.fromNodeId;
        step.attributes.activeLegFromNodeId ??=
          step.attributes.availableAtNodeId;
      }
    }
  }
};

/** Insert actions and plans before the normal playable lifecycle. */
const insertEconomy = (items, getId, additions) => {
  const preserved = items.filter(
    (candidate) => !getId(candidate).startsWith(ownedActionPrefix)
  );
  const lifecycleIndex = preserved.findIndex(
    (candidate) => getId(candidate).startsWith("session.play.")
  );
  const insertionIndex =
    lifecycleIndex === -1 ? preserved.length : lifecycleIndex;
  return [
    ...preserved.slice(0, insertionIndex),
    ...additions,
    ...preserved.slice(insertionIndex)
  ];
};

/**
 * Publish the backend intents on the common facilitator screen.
 *
 * `phase: "any"` is presentation metadata only. The host consumes Runtime's
 * action-availability verdict and never treats this board declaration as
 * permission to execute an economy command.
 */
const publishEconomyBoardActions = (root, generated) => {
  const board = root.state.public.board;
  assert.ok(
    Array.isArray(board?.availableActions),
    "public board availableActions must be an array"
  );
  const preserved = board.availableActions.filter(
    (candidate) =>
      !economyActionIds.includes(candidate.actionId)
      && !economyBoardActionIds.has(candidate.id)
  );
  const playableIndex = preserved.findIndex(
    (candidate) =>
      typeof candidate.actionId === "string"
      && candidate.actionId.startsWith("session.play.")
  );
  const insertionIndex =
    playableIndex === -1 ? preserved.length : playableIndex;
  const descriptions = {
    "facilitator.economy.adjust.credit":
      "Выберите действующую команду и целую неотрицательную сумму начисления.",
    "facilitator.economy.adjust.debit":
      "Выберите действующую команду и сумму списания; отрицательный баланс запрещён.",
    "facilitator.economy.loan.issue":
      "Выдайте явный займ: деньги и непогашенный долг увеличатся одновременно.",
    "facilitator.economy.loan.repay":
      "Погасите часть займа: деньги и непогашенный долг уменьшатся одновременно.",
    "facilitator.economy.team.exclude":
      "Исключите команду при обязательном дефиците; Runtime проверит допустимый этап."
  };
  const additions = generated.map(({ action: candidate }) => ({
    id: candidate.id.replaceAll(".", "-"),
    label: candidate.displayName,
    description: descriptions[candidate.id],
    actionId: candidate.id,
    phase: "any",
    section: "economy"
  }));
  board.availableActions = [
    ...preserved.slice(0, insertionIndex),
    ...additions,
    ...preserved.slice(insertionIndex)
  ];
};

/** Apply only the game-local facilitator-economy transformation. */
const buildFacilitatorEconomyAuthoring = (sourceAuthoring) => {
  const authoring = structuredClone(sourceAuthoring);
  const root = authoring.root;
  declareEconomyState(root);

  const finalMovementPhase =
    root.content.data.cargoSettlement === undefined
      ? "construction"
      : "settlement";
  const generated = [
    buildCredit(),
    buildDebit(),
    buildLoanIssue(),
    buildLoanRepay(),
    buildTeamExclude(finalMovementPhase)
  ];

  root.logic.actions = insertEconomy(
    root.logic.actions,
    (candidate) => candidate.id,
    generated.map((candidate) => candidate.action)
  );
  root.mechanics.plans = Object.fromEntries(insertEconomy(
    Object.entries(root.mechanics.plans),
    ([planId]) => planId,
    generated.map((candidate) => [candidate.action.id, candidate.plan])
  ));
  publishEconomyBoardActions(root, generated);

  root.content.data.rules.economy.creditAllowed = false;
  root.content.data.rules.economy.negativeBalanceAllowed = false;
  root.content.data.rules.economy.mandatoryPaymentDeficit =
    "facilitator-explicit-loan-or-team-exclusion";
  root.content.data.facilitatorEconomy = {
    status: "executable-game-local",
    actions: economyActionIds,
    manualCorrection: "explicit-credit-or-fail-closed-debit",
    loan: "explicit-principal-issue-and-explicit-repayment",
    exclusion: {
      participationFacet: "placementStatus=excluded",
      equipmentReturn: "existing-sold-market-state-with-audit-owner-retained",
      outstandingDebt: "written-off",
      unfinishedCargo: "available-at-current-carrier-terminal"
    },
    platformOperations:
      "existing-bounded-select-each-transfer-update-event-composition"
  };

  return authoring;
};

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const buildFromDisk = async () =>
  buildFacilitatorEconomyAuthoring(await readJson(authoringPath));

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
    throw new Error("usage: build-facilitator-economy.mjs [--check]");
  }
  const sourceText = await readFile(authoringPath, "utf8");
  const builtText = serialize(await buildFromDisk());
  if (checkOnly) {
    assert.equal(
      sourceText,
      builtText,
      "facilitator economy authoring is stale; run build-facilitator-economy.mjs"
    );
  } else {
    await writeAtomically(authoringPath, builtText);
  }
  process.stdout.write(
    `cards-money-trains: ${checkOnly ? "verified" : "built"} facilitator economy\n`
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
  buildFacilitatorEconomyAuthoring,
  buildFromDisk,
  economyActionIds,
  maximumAdjustment
};
