#!/usr/bin/env node
/**
 * Build the game-local locomotive order, graph movement and explicit skip path.
 *
 * The author-confirmed order is assembled entirely from accepted neutral
 * Mechanics operations: select active entities, order them by derived and
 * related fields, update a bounded selection, advance through a stored
 * sequence, traverse the declared transport graph, patch state and emit journal
 * events. Loading/unloading and train formation remain outside this deliberately
 * narrow slice, so no game-specific behavior leaks into the shared Runtime.
 *
 * Ownership boundary:
 * - this file owns `movement.*` actions, plans, events and public state;
 * - setup owns locomotive creation and initializes the two movement markers;
 * - future market and team-elimination workflows must reset `turnOrderCount`
 *   to zero when a locomotive stops being active;
 * - this file does not publish the technical review network.
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
const lifecyclePrefixes = [
  "cards.lifecycle.",
  "cargo.offer.",
  "news.lifecycle.",
  "news.cargo-addition.",
  "news.effect."
];
const movementFlowStepId = "facilitator.movement-order-and-skip";
const movementBoardActionIds = new Set([
  "movement.order.prepare",
  "movement.locomotive.traverse",
  "movement.locomotive.skip"
]);
const movementExtensionActionIds = new Set([
  "movement.train.wagon.select",
  "movement.train.wagon.unselect",
  "movement.train.attach.selected"
]);

/** Preserve the first occurrence of each game-local extension in authored order. */
const uniqueBy = (items, getId) => {
  const seen = new Set();
  return items.filter((item) => {
    const id = getId(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

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

/**
 * Publish the three game-local controls that can be rendered by any Player.
 *
 * These records intentionally contain no fixed params. The current locomotive
 * is server-owned, while a client supplies only an edge reference for traverse.
 */
const movementBoardActions = () => [
  {
    id: "movement-order-prepare",
    label: "Подготовить порядок движения",
    actionId: "movement.order.prepare",
    phase: "movement-order",
    section: "movement"
  },
  {
    id: "movement-locomotive-traverse",
    label: "Переместить текущий локомотив",
    actionId: "movement.locomotive.traverse",
    phase: "operations",
    section: "movement"
  },
  {
    id: "movement-locomotive-skip",
    label: "Пропустить движение текущего локомотива",
    actionId: "movement.locomotive.skip",
    phase: "operations",
    section: "movement"
  }
];

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

/**
 * Expose only a public edge reference.
 *
 * The current locomotive is deliberately absent from client parameters. The
 * saved server-owned order is the authority, so a stale or hostile client
 * cannot move another team's locomotive by substituting an object id.
 */
const movementEdgeParams = {
  type: "object",
  additionalProperties: false,
  properties: {
    edgeId: {
      type: "string",
      maxLength: 128,
      "x-cubica-ref": {
        kind: "object",
        collection: "networkEdges",
        network: "main",
        allowedTypes: ["transport.edge"],
        visibility: "public"
      }
    }
  },
  required: ["edgeId"]
};

/** Protect a normal-session action with an exact server-owned phase. */
const normalPhaseGuard = (phase) => all(
  compare("eq", state("public.session.fixtureId"), literal(normalFixtureId)),
  compare("eq", state("public.session.phase"), literal(phase))
);

/** Select the active locomotives that must participate in this turn. */
const activeLocomotiveSelection = (id) => ({
  id,
  kind: "query",
  op: "core.entities.select",
  selector: {
    collection: "locomotives",
    objectTypes: ["transport.locomotive"],
    facets: { availability: literal("active") },
    cardinality: { min: 1, max: 64 }
  }
});

/**
 * Select the independent active-order marker.
 *
 * This selector intentionally does not repeat the active facet. Exact equality
 * with the active selection catches both an active locomotive missing its
 * marker and a stale marker left on reserve/sold equipment.
 */
const orderedLocomotiveMarkerSelection = (id) => ({
  id,
  kind: "query",
  op: "core.entities.select",
  selector: {
    collection: "locomotives",
    objectTypes: ["transport.locomotive"],
    attributes: { turnOrderCount: literal(1) },
    cardinality: { min: 1, max: 64 }
  }
});

/** Build the reproducible order once, then persist it for the whole phase. */
const buildPrepareOrder = () => {
  const id = "movement.order.prepare";
  return {
    action: action({
      id,
      label: "Подготовить порядок движения",
      semantics:
        "Фиксирует порядок активных локомотивов от востока к западу, сбрасывает запас хода и открывает поочерёдные действия."
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "phase-guard",
            kind: "assert",
            op: "core.assert",
            predicate: normalPhaseGuard("movement-order"),
            errorCode: "MOVEMENT_ORDER_UNAVAILABLE"
          },
          activeLocomotiveSelection("active-locomotives"),
          orderedLocomotiveMarkerSelection("marked-locomotives"),
          {
            id: "active-marker-consistency",
            kind: "assert",
            op: "core.assert",
            predicate: compare(
              "eq",
              result("active-locomotives", ["ids"]),
              result("marked-locomotives", ["ids"])
            ),
            errorCode: "MOVEMENT_ACTIVE_MARKER_DRIFT"
          },
          {
            id: "order-locomotives",
            kind: "command",
            op: "core.entities.order",
            selection: result("active-locomotives"),
            keys: [
              {
                source: {
                  kind: "related-field",
                  referenceField: "nodeId",
                  collection: "networkNodes",
                  field: "positionX"
                },
                direction: "descending",
                missing: "error"
              },
              {
                source: {
                  kind: "related-field",
                  referenceField: "ownerTeamId",
                  collection: "teams",
                  field: "coins"
                },
                direction: "descending",
                missing: "error"
              },
              {
                source: {
                  kind: "related-aggregate",
                  collection: "locomotives",
                  join: {
                    current: { kind: "field", field: "ownerTeamId" },
                    relatedField: "ownerTeamId"
                  },
                  aggregate: "sum",
                  valueField: "turnOrderCount"
                },
                direction: "descending",
                missing: "error"
              }
            ],
            tieBreak: {
              kind: "seeded-random",
              stream: "locomotive-order"
            }
          },
          {
            id: "reset-action-points",
            kind: "command",
            op: "core.entities.update",
            selection: result("active-locomotives"),
            attributeValues: {
              actionPoints: literal(5)
            }
          },
          {
            id: "publish-order",
            kind: "command",
            op: "core.state.patch",
            patches: [
              {
                operation: "set",
                target: { endpoint: "public.movement.locomotiveOrder" },
                value: result("order-locomotives", ["ids"])
              },
              {
                operation: "set",
                target: { endpoint: "public.movement.currentLocomotiveId" },
                value: result("order-locomotives", ["ids", "0"])
              },
              {
                operation: "set",
                target: { endpoint: "public.session.phase" },
                value: literal("operations")
              }
            ]
          },
          {
            id: "journal",
            kind: "command",
            op: "core.event.emit",
            eventType: "movement.order.prepared",
            summary: literal("Ведущий зафиксировал порядок движения локомотивов"),
            audience: "public",
            data: {
              kind: literal("movement-order"),
              locomotiveIds: result("order-locomotives", ["ids"]),
              currentLocomotiveId: result("order-locomotives", ["ids", "0"]),
              turnNumber: state("public.session.turnNumber")
            }
          }
        ]
      }
    }
  };
};

/**
 * Move the server-selected current locomotive over one declared open edge.
 *
 * The graph operation is the authority for incident-edge, endpoint, capacity
 * and coupled-wagon rules. Its result is reused for the journal so the event
 * describes the committed movement rather than repeating assumptions from
 * mutable state or untrusted client parameters.
 */
const buildTraverseCurrentLocomotive = () => {
  const id = "movement.locomotive.traverse";
  const currentLocomotiveId = state("public.movement.currentLocomotiveId");
  const turnNumber = state("public.session.turnNumber");
  const ownerTeamId = entityValue(
    "locomotives",
    currentLocomotiveId,
    "ownerTeamId"
  );
  const firstLevyMovement = all(
    compare(
      "eq",
      state("public.turnEffects.locomotiveMovementLevy"),
      literal(1)
    ),
    compare(
      "ne",
      entityValue("locomotives", currentLocomotiveId, "lastMovedTurn"),
      turnNumber
    )
  );

  return {
    action: action({
      id,
      label: "Переместить текущий локомотив",
      semantics:
        "Перемещает выбранный сервером текущий локомотив и прицепленные вагоны по одной открытой дороге, расходуя одну единицу хода.",
      paramsSchema: movementEdgeParams
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "current-guard",
            kind: "assert",
            op: "core.assert",
            predicate: all(
              normalPhaseGuard("operations"),
              {
                op: "predicate.entity.matches",
                entity: {
                  collection: "locomotives",
                  entityId: currentLocomotiveId
                },
                objectType: "transport.locomotive",
                facets: {
                  availability: literal("active")
                },
                attributes: {
                  turnOrderCount: literal(1)
                }
              },
              compare(
                "ne",
                entityValue(
                  "locomotives",
                  currentLocomotiveId,
                  "movementResolvedTurn"
                ),
                turnNumber
              )
            ),
            errorCode: "MOVEMENT_CURRENT_LOCOMOTIVE_INVALID"
          },
          {
            // This query is a fail-closed membership proof, not a request to
            // advance the turn. It rejects a forged current id before writes.
            id: "validate-current-in-saved-order",
            kind: "query",
            op: "core.sequence.next",
            items: state("public.movement.locomotiveOrder"),
            current: currentLocomotiveId,
            exclude: {
              collection: "locomotives",
              field: "movementResolvedTurn",
              values: [turnNumber]
            }
          },
          {
            id: "has-action-point",
            kind: "assert",
            op: "core.assert",
            predicate: compare(
              "gte",
              entityValue(
                "locomotives",
                currentLocomotiveId,
                "actionPoints"
              ),
              literal(1)
            ),
            errorCode: "ACTION_POINTS_EXHAUSTED"
          },
          {
            // News №22 is charged exactly once, together with the first
            // successful movement. A later graph or resource failure rolls
            // this debit back with the rest of the candidate transaction.
            id: "news-22-first-movement-levy",
            kind: "command",
            op: "core.resource.transfer",
            from: {
              kind: "state",
              target: {
                endpoint: "public.teams.bound.coins",
                bindings: { teamId: ownerTeamId }
              }
            },
            to: { kind: "bank" },
            amount: literal(1),
            onInsufficient: "fail",
            when: firstLevyMovement
          },
          {
            id: "news-22-first-movement-journal",
            kind: "command",
            op: "core.event.emit",
            eventType: "news.locomotive.levy.paid",
            summary: literal("Владелец локомотива перечислил разовый сбор в бюджет"),
            audience: "public",
            data: {
              newsId: literal("news-22"),
              locomotiveId: currentLocomotiveId,
              ownerTeamId,
              edgeId: param("edgeId"),
              amount: literal(1),
              // The transfer is the preceding step, so this is the committed
              // post-charge balance if the later movement also succeeds.
              balanceAfter: entityValue("teams", ownerTeamId, "coins"),
              turnNumber
            },
            when: firstLevyMovement
          },
          {
            id: "traverse",
            kind: "command",
            op: "graph.entity.traverse",
            networkId: "main",
            entity: currentLocomotiveId,
            edge: param("edgeId")
          },
          {
            id: "spend-action-point",
            kind: "command",
            op: "core.entity.attributes.patch",
            entity: {
              collection: "locomotives",
              entityId: currentLocomotiveId
            },
            patches: [{
              operation: "increment",
              path: ["actionPoints"],
              value: literal(-1)
            }]
          },
          {
            // This marker is updated for every successful traverse, not only
            // during news №22. It is therefore the single source of truth for
            // whether this locomotive has already moved in the current turn.
            id: "mark-last-movement-turn",
            kind: "command",
            op: "core.entity.attributes.patch",
            entity: {
              collection: "locomotives",
              entityId: currentLocomotiveId
            },
            patches: [{
              operation: "set",
              path: ["lastMovedTurn"],
              value: turnNumber
            }]
          },
          {
            id: "journal-movement",
            kind: "command",
            op: "core.event.emit",
            eventType: "movement.locomotive.traversed",
            summary: literal("Текущий локомотив перешёл по выбранной дороге"),
            audience: "public",
            data: {
              kind: literal("locomotive-traverse"),
              locomotiveId: result("traverse", ["entityId"]),
              edgeId: result("traverse", ["edgeId"]),
              fromNodeId: result("traverse", ["fromNodeId"]),
              toNodeId: result("traverse", ["toNodeId"]),
              relatedIds: result("traverse", ["relatedIds"]),
              ownerTeamId,
              turnNumber
            }
          }
        ]
      }
    }
  };
};

/**
 * Resolve only the server-selected current locomotive as an explicit skip.
 *
 * A preliminary sequence lookup is a membership and shape check: it proves
 * that the public current id belongs to the saved immutable order before any
 * write. After resolution the same neutral sequence operation selects the next
 * unresolved member only when one exists. Neither lookup consumes randomness.
 */
const buildSkipCurrentLocomotive = (finalPhase = "construction") => {
  const id = "movement.locomotive.skip";
  const currentLocomotiveId = state("public.movement.currentLocomotiveId");
  const turnNumber = state("public.session.turnNumber");
  const hasRemaining = compare(
    "ne",
    result("remaining-locomotives", ["ids"]),
    literal([])
  );
  const noRemaining = compare(
    "eq",
    result("remaining-locomotives", ["ids"]),
    literal([])
  );
  const sequenceStep = (stepId, when) => ({
    id: stepId,
    kind: "query",
    op: "core.sequence.next",
    items: state("public.movement.locomotiveOrder"),
    current: currentLocomotiveId,
    exclude: {
      collection: "locomotives",
      field: "movementResolvedTurn",
      values: [turnNumber]
    },
    ...(when ? { when } : {})
  });

  return {
    action: action({
      id,
      label: "Пропустить движение текущего локомотива",
      semantics:
        `Явно завершает действия только текущего локомотива и переводит очередь к следующему; после последнего открывает ${finalPhase === "settlement" ? "расчёты" : "строительство"}.`
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "current-guard",
            kind: "assert",
            op: "core.assert",
            predicate: all(
              normalPhaseGuard("operations"),
              {
                op: "predicate.entity.matches",
                entity: {
                  collection: "locomotives",
                  entityId: currentLocomotiveId
                },
                objectType: "transport.locomotive",
                facets: {
                  availability: literal("active")
                },
                attributes: {
                  turnOrderCount: literal(1)
                }
              },
              compare(
                "ne",
                entityValue(
                  "locomotives",
                  currentLocomotiveId,
                  "movementResolvedTurn"
                ),
                turnNumber
              )
            ),
            errorCode: "MOVEMENT_CURRENT_LOCOMOTIVE_INVALID"
          },
          // This result is not used as the next item. It exists solely to
          // reject a valid-looking current id that is absent from the saved
          // order before the mutation below.
          sequenceStep("validate-current-in-saved-order"),
          {
            id: "mark-current-resolved",
            kind: "command",
            op: "core.entity.attributes.patch",
            entity: {
              collection: "locomotives",
              entityId: currentLocomotiveId
            },
            patches: [{
              operation: "set",
              path: ["movementResolvedTurn"],
              value: turnNumber
            }]
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
          sequenceStep("next-locomotive", hasRemaining),
          {
            // Emit while the public current id still denotes the locomotive
            // that was just resolved. Advancing the endpoint first would make
            // the journal describe the next locomotive (or null on the last
            // skip) instead of the action that actually happened.
            id: "journal-skip",
            kind: "command",
            op: "core.event.emit",
            eventType: "movement.locomotive.skipped",
            summary: literal("Ведущий явно пропустил движение текущего локомотива"),
            audience: "public",
            data: {
              kind: literal("locomotive-skip"),
              locomotiveId: currentLocomotiveId,
              ownerTeamId: entityValue(
                "locomotives",
                currentLocomotiveId,
                "ownerTeamId"
              ),
              turnNumber
            }
          },
          {
            id: "advance-current",
            kind: "command",
            op: "core.state.patch",
            patches: [{
              operation: "set",
              target: { endpoint: "public.movement.currentLocomotiveId" },
              value: result("next-locomotive")
            }],
            when: hasRemaining
          },
          {
            id: "finish-movement",
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
                value: literal(finalPhase)
              },
              ...(finalPhase === "construction"
                ? [{
                    operation: "set",
                    target: { endpoint: "public.construction.available" },
                    value: literal(true)
                  }]
                : [])
            ],
            when: noRemaining
          },
          {
            id: "journal-phase-finished",
            kind: "command",
            op: "core.event.emit",
            eventType: "movement.phase.finished",
            summary: literal(
              finalPhase === "settlement"
                ? "Все локомотивы завершили действия; открыты расчёты"
                : "Все локомотивы завершили действия; открыто строительство"
            ),
            audience: "public",
            data: {
              kind: literal("phase"),
              turnNumber
            },
            when: noRemaining
          }
        ]
      }
    }
  };
};

/** Declare bounded public state and derived fields used by movement ordering. */
const declareMovementState = (root) => {
  root.state.public.movement = {
    locomotiveOrder: [],
    currentLocomotiveId: null
  };

  const stateModel = root.mechanics.stateModel;
  Object.assign(stateModel.types, {
    "game.map-coordinate": {
      kind: "finite-number",
      minimum: -1_000_000_000,
      maximum: 1_000_000_000
    },
    "game.locomotive-order": {
      kind: "list",
      itemType: "core.string",
      maxItems: 64
    },
    "game.turn-order-count": {
      kind: "integer",
      minimum: 0,
      maximum: 1
    }
  });

  const locomotiveFields = stateModel.collections.locomotives?.fields;
  const nodeFields = stateModel.collections.networkNodes?.fields;
  assert.ok(locomotiveFields, "locomotives collection is required");
  assert.ok(nodeFields, "networkNodes collection is required");
  locomotiveFields.turnOrderCount = {
    storage: { kind: "attribute", name: "turnOrderCount" },
    valueType: "game.turn-order-count",
    access: "read-write"
  };
  locomotiveFields.movementResolvedTurn = {
    storage: { kind: "attribute", name: "movementResolvedTurn" },
    valueType: "core.integer",
    access: "read-write"
  };
  locomotiveFields.lastMovedTurn = {
    storage: { kind: "attribute", name: "lastMovedTurn" },
    valueType: "core.integer",
    access: "read-write"
  };
  nodeFields.positionX = {
    source: {
      kind: "nested-field",
      field: "position",
      path: ["x"]
    },
    valueType: "game.map-coordinate",
    access: "read-only"
  };

  Object.assign(stateModel.endpoints, {
    "public.movement.locomotiveOrder": {
      audienceRef: "public",
      storage: {
        root: "public",
        segments: ["movement", "locomotiveOrder"]
      },
      valueType: "game.locomotive-order",
      access: "read-write"
    },
    "public.movement.currentLocomotiveId": {
      audienceRef: "public",
      storage: {
        root: "public",
        segments: ["movement", "currentLocomotiveId"]
      },
      valueType: "core.optional-string",
      access: "read-write"
    },
    "projection.public.movement": {
      audienceRef: "public",
      storage: {
        root: "public",
        segments: ["movement"]
      },
      valueType: "core.player-projection-json",
      access: "read-only",
      usage: "projection-only"
    }
  });
};

/** Register the four journal payloads emitted by this bounded workflow. */
const declareMovementEvents = (stateModel) => {
  Object.assign(stateModel.types, {
    "game.movement-order-prepared-event": {
      kind: "record",
      fields: {
        kind: { typeRef: "core.string", optional: false },
        locomotiveIds: { typeRef: "game.locomotive-order", optional: false },
        currentLocomotiveId: { typeRef: "core.string", optional: false },
        turnNumber: { typeRef: "core.integer", optional: false }
      }
    },
    "game.movement-locomotive-skipped-event": {
      kind: "record",
      fields: {
        kind: { typeRef: "core.string", optional: false },
        // The endpoint is nullable outside the operations phase. The runtime
        // guard proves it is a real active locomotive before the event, but
        // the static compiler deliberately does not narrow endpoint types
        // across assertions. Matching the endpoint type here keeps the plan
        // sound; every successfully emitted event still has a non-null id.
        locomotiveId: { typeRef: "core.optional-string", optional: false },
        ownerTeamId: { typeRef: "core.string", optional: false },
        turnNumber: { typeRef: "core.integer", optional: false }
      }
    },
    "game.movement-related-ids": {
      kind: "list",
      itemType: "core.string",
      maxItems: 64
    },
    "game.movement-locomotive-traversed-event": {
      kind: "record",
      fields: {
        kind: { typeRef: "core.string", optional: false },
        locomotiveId: { typeRef: "core.string", optional: false },
        edgeId: { typeRef: "core.string", optional: false },
        fromNodeId: { typeRef: "core.string", optional: false },
        toNodeId: { typeRef: "core.string", optional: false },
        relatedIds: {
          typeRef: "game.movement-related-ids",
          optional: false
        },
        ownerTeamId: { typeRef: "core.string", optional: false },
        turnNumber: { typeRef: "core.integer", optional: false }
      }
    },
    "game.movement-phase-finished-event": {
      kind: "record",
      fields: {
        kind: { typeRef: "core.string", optional: false },
        turnNumber: { typeRef: "core.integer", optional: false }
      }
    },
    "game.news-locomotive-levy-event": {
      kind: "record",
      fields: {
        newsId: { typeRef: "core.string", optional: false },
        locomotiveId: { typeRef: "core.optional-string", optional: false },
        ownerTeamId: { typeRef: "core.string", optional: false },
        edgeId: { typeRef: "core.string", optional: false },
        amount: { typeRef: "core.integer", optional: false },
        balanceAfter: { typeRef: "core.integer", optional: false },
        turnNumber: { typeRef: "core.integer", optional: false }
      }
    }
  });
  Object.assign(stateModel.events, {
    "movement.order.prepared": {
      audienceRef: "public",
      payloadType: "game.movement-order-prepared-event",
      journalEndpoint: { endpoint: "public.log" }
    },
    "movement.locomotive.skipped": {
      audienceRef: "public",
      payloadType: "game.movement-locomotive-skipped-event",
      journalEndpoint: { endpoint: "public.log" }
    },
    "movement.locomotive.traversed": {
      audienceRef: "public",
      payloadType: "game.movement-locomotive-traversed-event",
      journalEndpoint: { endpoint: "public.log" }
    },
    "movement.phase.finished": {
      audienceRef: "public",
      payloadType: "game.movement-phase-finished-event",
      journalEndpoint: { endpoint: "public.log" }
    },
    "news.locomotive.levy.paid": {
      audienceRef: "public",
      payloadType: "game.news-locomotive-levy-event",
      journalEndpoint: { endpoint: "public.log" }
    }
  });
};

/**
 * Apply only the movement-order and all-skip transformation.
 *
 * Cloning the input makes repeated generator execution and different generator
 * orders directly testable without mutating caller-owned authoring objects.
 */
const buildMovementOrderAuthoring = (sourceAuthoring) => {
  const authoring = structuredClone(sourceAuthoring);
  const root = authoring.root;
  const stateModel = root.mechanics.stateModel;
  const cargoSettlementReady =
    root.content.data.cargoSettlement !== undefined;
  const cargoPriorityReady =
    root.content.data.cardLifecycle?.cargoSelectionPriority !== undefined;

  declareMovementState(root);
  declareMovementEvents(stateModel);

  const board = root.state.public.board;
  assert.ok(board, "public board projection is required");
  assert.ok(
    Array.isArray(board.availableActions),
    "public board availableActions must be an array"
  );
  // Replace only entries owned by this slice. Unrelated game controls keep
  // their exact order and payload even when generators are composed repeatedly.
  const extensionBoardActions = uniqueBy(
    board.availableActions.filter(
      (candidate) => movementExtensionActionIds.has(candidate.actionId)
    ),
    (candidate) => candidate.actionId
  );
  const preservedBoardActions = board.availableActions.filter(
    (candidate) =>
      !movementBoardActionIds.has(candidate.actionId)
      && !movementExtensionActionIds.has(candidate.actionId)
  );
  const constructionBoardIndex = preservedBoardActions.findIndex(
    (candidate) => candidate.actionId.startsWith("construction.")
  );
  const movementBoardInsertionIndex =
    constructionBoardIndex === -1
      ? preservedBoardActions.length
      : constructionBoardIndex;
  board.availableActions = [
    ...preservedBoardActions.slice(0, movementBoardInsertionIndex),
    ...movementBoardActions().slice(0, 2),
    ...extensionBoardActions,
    ...movementBoardActions().slice(2),
    ...preservedBoardActions.slice(movementBoardInsertionIndex)
  ];

  // Setup is the sole normal-session creator of locomotives. Refusing missing
  // markers here catches generator order drift instead of silently repairing
  // already materialized game state.
  for (const [locomotiveId, locomotive] of Object.entries(
    root.state.public.objects.locomotives
  )) {
    assert.equal(
      locomotive.attributes.turnOrderCount,
      0,
      `${locomotiveId} must start with turnOrderCount=0`
    );
    assert.equal(
      locomotive.attributes.movementResolvedTurn,
      0,
      `${locomotiveId} must start with movementResolvedTurn=0`
    );
    assert.equal(
      locomotive.attributes.lastMovedTurn,
      0,
      `${locomotiveId} must start with lastMovedTurn=0`
    );
  }

  const generated = [
    buildPrepareOrder(),
    buildTraverseCurrentLocomotive(),
    buildSkipCurrentLocomotive(
      cargoSettlementReady ? "settlement" : "construction"
    )
  ];
  // A later game-local slice may extend the owned skip transaction with
  // selection cleanup. Preserve those already-authored steps when this base
  // generator is re-run, while still rebuilding every movement-owned step.
  const formationSkipStepIds = new Set([
    "formation-selected-for-skipped-locomotive",
    "formation-clear-skipped-selection"
  ]);
  const preservedSkipExtensions =
    root.mechanics.plans["movement.locomotive.skip"]?.transaction.steps
      .filter((step) => formationSkipStepIds.has(step.id)) ?? [];
  if (preservedSkipExtensions.length > 0) {
    const generatedSkipSteps = generated
      .find((item) => item.action.id === "movement.locomotive.skip")
      ?.plan.transaction.steps;
    assert.ok(generatedSkipSteps, "generated skip plan is required");
    const resolveIndex = generatedSkipSteps.findIndex(
      (step) => step.id === "mark-current-resolved"
    );
    assert.notEqual(resolveIndex, -1, "generated skip resolution is required");
    generatedSkipSteps.splice(resolveIndex, 0, ...preservedSkipExtensions);
  }
  const extensionActions = uniqueBy(
    root.logic.actions.filter(
      (candidate) => movementExtensionActionIds.has(candidate.id)
    ),
    (candidate) => candidate.id
  );
  const preservedActions = root.logic.actions.filter(
    (candidate) =>
      !movementBoardActionIds.has(candidate.id)
      && !movementExtensionActionIds.has(candidate.id)
  );
  const firstLifecycleAction = preservedActions.findIndex((candidate) =>
    lifecyclePrefixes.some((prefix) => candidate.id.startsWith(prefix))
  );
  const actionInsertionIndex =
    firstLifecycleAction === -1 ? preservedActions.length : firstLifecycleAction;
  root.logic.actions = [
    ...preservedActions.slice(0, actionInsertionIndex),
    ...generated.slice(0, 2).map((item) => item.action),
    ...extensionActions,
    generated[2].action,
    ...preservedActions.slice(actionInsertionIndex)
  ];

  const extensionPlans = Object.entries(root.mechanics.plans).filter(
    ([planId]) => movementExtensionActionIds.has(planId)
  );
  const preservedPlans = Object.entries(root.mechanics.plans).filter(
    ([planId]) =>
      !movementBoardActionIds.has(planId)
      && !movementExtensionActionIds.has(planId)
  );
  const firstLifecyclePlan = preservedPlans.findIndex(([planId]) =>
    lifecyclePrefixes.some((prefix) => planId.startsWith(prefix))
  );
  const planInsertionIndex =
    firstLifecyclePlan === -1 ? preservedPlans.length : firstLifecyclePlan;
  root.mechanics.plans = Object.fromEntries([
    ...preservedPlans.slice(0, planInsertionIndex),
    ...generated.slice(0, 2).map((item) => [item.action.id, item.plan]),
    ...extensionPlans,
    [generated[2].action.id, generated[2].plan],
    ...preservedPlans.slice(planInsertionIndex)
  ]);

  const facilitatorFlow = root.logic.flows.find((flow) => flow.id === "facilitator");
  assert.ok(facilitatorFlow, "facilitator flow is required");
  const previousMovementStep = facilitatorFlow.steps.find(
    (step) => step.id === movementFlowStepId
  );
  const finishActionIds = new Set([
    "session.finish.request",
    "session.finish.confirm",
    "session.finish.cancel"
  ]);
  const preservedMovementActions = uniqueBy(
    (previousMovementStep?.actionIds ?? [])
      .filter((actionId) =>
        !movementBoardActionIds.has(actionId) && !finishActionIds.has(actionId)),
    (actionId) => actionId
  );
  const preservedSteps = facilitatorFlow.steps.filter(
    (step) => step.id !== movementFlowStepId
  );
  const movementBoundaryIndex = preservedSteps.findIndex(
    (step) => step.id === (
      cargoSettlementReady
        ? "facilitator.cargo-settlement"
        : "facilitator.construction"
    )
  );
  const insertionIndex =
    movementBoundaryIndex === -1 ? preservedSteps.length : movementBoundaryIndex;
  facilitatorFlow.steps = [
    ...preservedSteps.slice(0, insertionIndex),
    {
      id: movementFlowStepId,
      _type: "game.Step",
      _label: "Порядок и действия локомотивов",
      _semantics:
        cargoSettlementReady
          ? "Ведущий фиксирует порядок, формирует составы, перемещает текущий локомотив и явно завершает его действия до этапа расчётов."
          : "Ведущий фиксирует подтверждённый порядок, перемещает только текущий локомотив по открытым дорогам и явно завершает его действия до перехода к строительству.",
      screenId: "facilitator",
      actionIds: [
        "movement.order.prepare",
        "movement.locomotive.traverse",
        ...preservedMovementActions,
        "movement.locomotive.skip",
        "session.finish.request",
        "session.finish.confirm",
        "session.finish.cancel"
      ]
    },
    ...preservedSteps.slice(insertionIndex)
  ];

  const trainFormationReady = root.content.data.trainFormation !== undefined;
  root.content.data.movementTurn = {
    status:
      cargoSettlementReady
        ? "executable-order-traversal-formation-through-settlement-boundary"
        : "executable-order-real-graph-traversal-and-all-skip-through-construction-boundary",
    publishable: false,
    supportedSetup: "confirmed odd team counts 5/7/9/11",
    order: [
      "network-node-position-x-descending",
      "owner-team-coins-descending",
      "owner-active-locomotive-count-descending",
      "complete-tie-seeded-random"
    ],
    namedRandomStream: "locomotive-order",
    savedForWholePhase: true,
    actionPointsReset: 5,
    graphTraversal: "main-technical-review-network",
    graphTraversalActionPointCost: 1,
    movementKeepsCurrentLocomotive: true,
    explicitSkip: true,
    boundary: cargoSettlementReady ? "settlement" : "construction",
    unresolvedAfterBoundary: cargoSettlementReady
      ? [
          "publishable-author-confirmed-network-overlay",
          cargoPriorityReady && root.content.data.constructionCycle
            ? "remaining-market-and-reporting-workflows"
            : cargoPriorityReady
              ? "remaining-market-construction-and-reporting-workflows"
            : "remaining-market-cargo-selection-construction-and-reporting-workflows"
        ]
      : [
          trainFormationReady
            ? "loading-unloading-and-delivery"
            : "train-formation-loading-unloading-and-delivery",
          "publishable-author-confirmed-network-overlay",
          "remaining-market-settlement-and-construction-workflows"
        ]
  };

  const blockers = new Set(root.config.runtimeBlockers);
  blockers.delete("remaining market, movement, settlement, construction and reporting workflows");
  blockers.delete(
    "remaining market, real graph movement, settlement, construction and reporting workflows"
  );
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
  blockers.add(cargoSettlementReady
    ? (
        cargoPriorityReady && root.content.data.constructionCycle
          ? "remaining market and reporting workflows"
          : root.content.data.constructionCycle
            ? "remaining market, cargo selection sequencing and reporting workflows"
            : "remaining market, cargo selection sequencing, construction and reporting workflows"
      )
    : trainFormationReady
      ? "remaining market, cargo handling, settlement, construction and reporting workflows"
      : "remaining market, train formation, cargo handling, settlement, construction and reporting workflows");
  root.config.runtimeBlockers = [...blockers];
  root.config.runtimeReady = false;

  return authoring;
};

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** Build from the checked-in authoring source for CLI and focused tests. */
const buildFromDisk = async () =>
  buildMovementOrderAuthoring(await readJson(authoringPath));

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

/** Execute the deterministic build or compare it with the checked-in source. */
const run = async (argv) => {
  const checkOnly = argv.length === 1 && argv[0] === "--check";
  if (argv.length > (checkOnly ? 1 : 0)) {
    throw new Error("usage: build-movement-order.mjs [--check]");
  }
  const sourceText = await readFile(authoringPath, "utf8");
  const builtText = serialize(await buildFromDisk());
  if (checkOnly) {
    assert.equal(
      sourceText,
      builtText,
      "movement-order authoring is stale; run build-movement-order.mjs"
    );
  } else {
    await writeAtomically(authoringPath, builtText);
  }
  process.stdout.write(
    `cards-money-trains: ${checkOnly ? "verified" : "built"} movement order, graph traversal and explicit-skip boundary\n`
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
  buildMovementOrderAuthoring
};
