#!/usr/bin/env node
/**
 * Build the author-confirmed cargo/news lifecycle into normative game authoring.
 *
 * The XLSX intake is the content source of truth. This generator owns only the
 * card catalogue, protected deck sources, lifecycle state, actions and plans.
 * It deliberately implements only author-confirmed news effects that can be
 * expressed through the accepted Mechanics operation catalogue. Setup, the
 * actual market settlement and publication readiness remain outside this
 * generator. In particular, it must preserve the dynamic team entity
 * collection owned by `build-session-setup.mjs`. Keeping that boundary here
 * prevents a later import from silently erasing physical-card multiplicity,
 * restoring the obsolete fixed-team record map, or inventing disputed rules.
 */

import assert from "node:assert/strict";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateIntake } from "./import-cargo-news.mjs";

const scriptFile = fileURLToPath(import.meta.url);
const toolsRoot = path.dirname(scriptFile);
const gameRoot = path.resolve(toolsRoot, "..");
const authoringPath = path.join(gameRoot, "authoring", "game.authoring.json");
const intakePath = path.join(gameRoot, "authoring", "fixtures", "cargo-news.intake.json");
const normalFixtureId = "normal-start-policy";
const newsFlowStepId = "facilitator.news-lifecycle";
const lifecycleActionPrefixes = [
  "cards.lifecycle.",
  "cargo.queue.",
  "cargo.offer.",
  "news.lifecycle.",
  "news.cargo-addition.",
  "news.effect."
];
const terminalIds = Array.from({ length: 23 }, (_, index) => `terminal-${index + 1}`);

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));
const literal = (value) => ({ op: "value.literal", value });
const stateValue = (endpoint, bindings) => ({
  op: "value.state",
  ref: {
    endpoint,
    ...(bindings ? { bindings } : {})
  }
});
const paramValue = (name) => ({ op: "value.param", name });
const resultValue = (stepId, pathSegments) => ({
  op: "value.result",
  stepId,
  ...(pathSegments ? { path: pathSegments } : {})
});
const coalesce = (...items) => ({ op: "value.coalesce", items });
const itemId = () => ({ op: "value.item", area: "identity", field: "id" });
const itemAttribute = (field) => ({ op: "value.item", area: "attribute", field });
const compare = (operator, left, right) => ({
  op: "predicate.compare",
  operator,
  left,
  right
});
const all = (...items) => ({ op: "predicate.all", items });
const entityValue = (collection, entityId, field) => ({
  op: "value.entity",
  entity: { collection, entityId },
  field
});
const cargoRemainingEndpoint = "public.cards.cargo.remaining.bound";
// A terminal identifier intentionally doubles as its protected deck id. That
// lets one bounded action parameter select both the server-only deck and the
// matching public remaining-card counter without duplicating 23 action plans.
const terminalDeckId = (terminalId) => terminalId;
const terminalStreamId = (terminalId) => `deck.cargo.${terminalId}`;
const sourceCollectionId = (terminalId) =>
  `cargoSourceTerminal${String(Number(terminalId.slice("terminal-".length))).padStart(2, "0")}`;
const activeNetworkClosureReasonEndpoint =
  "public.news.activeNetworkClosureReason";

/**
 * Exact author-confirmed one-turn network closures.
 *
 * This table is deliberately game-local: card numbers and Guinea terminal
 * labels are content rules, while blockingReasons/set-add and the graph
 * consumers remain neutral platform mechanics.
 */
const networkClosureNewsByNumber = new Map([
  [11, [{ collection: "networkEdges", entityId: "road-1-9" }]],
  [12, [{ collection: "networkEdges", entityId: "road-3-3-14" }]],
  [13, [{ collection: "networkEdges", entityId: "road-8-waypoint-9-3-4" }]],
  [15, [{ collection: "networkEdges", entityId: "road-1-2" }]],
  [17, [{ collection: "networkEdges", entityId: "road-4-7" }]],
  [18, [{ collection: "networkNodes", entityId: "terminal-11" }]],
  [20, [{ collection: "networkNodes", entityId: "terminal-12" }]],
  [
    21,
    [
      { collection: "networkNodes", entityId: "terminal-5" },
      { collection: "networkNodes", entityId: "terminal-7" }
    ]
  ]
]);

const action = ({ id, label, semantics, planRef = id, paramsSchema }) => ({
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
    planRef
  }
});

/** Explicitly state that an action accepts no client-controlled authority. */
const noParamsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {}
};

const terminalParameterSchema = {
  type: "string",
  maxLength: 16,
  enum: terminalIds
};

const cargoOfferParamsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    terminalId: terminalParameterSchema
  },
  required: ["terminalId"]
};

const cargoSelectionParamsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    terminalId: terminalParameterSchema,
    cargoId: {
      type: "string",
      maxLength: 128,
      "x-cubica-ref": {
        kind: "object",
        collection: "cargoOrders",
        allowedTypes: ["transport.cargo"],
        visibility: "public"
      }
    }
  },
  required: ["terminalId", "cargoId"]
};

const normalLifecycleGuardItems = () => [
  compare("eq", stateValue("public.session.fixtureId"), literal(normalFixtureId)),
  compare("eq", stateValue("public.cards.initialized"), literal(true))
];

const cargoQueueTurn = () => stateValue("public.session.turnNumber");
const currentCargoWagon = () =>
  stateValue("public.cards.cargo.currentWagonId");
const cargoQueueIsActive = () => all(
  compare(
    "eq",
    stateValue("public.cards.cargo.preparedTurn"),
    cargoQueueTurn()
  ),
  {
    op: "predicate.exists",
    value: currentCargoWagon(),
    exists: true
  }
);

const setFacet = (id, collection, entityId, facet, value, when) => ({
  id,
  kind: "command",
  op: "core.entity.facet.set",
  entity: { collection, entityId },
  facet,
  value: literal(value),
  ...(when ? { when } : {})
});

const setState = (id, patches) => ({
  id,
  kind: "command",
  op: "core.state.patch",
  patches: patches.map(([endpoint, value]) => ({
    operation: "set",
    target: { endpoint },
    value: literal(value)
  }))
});

/** Patch state with already typed expressions instead of literal-only values. */
const setStateExpressions = (id, patches, when) => ({
  id,
  kind: "command",
  op: "core.state.patch",
  patches: patches.map(([target, value]) => ({
    operation: "set",
    target,
    value
  })),
  ...(when ? { when } : {})
});

const remainingStateRef = (terminalId) => ({
  endpoint: cargoRemainingEndpoint,
  bindings: { terminalId }
});

const networkClosureFacet = (collection) =>
  collection === "networkEdges"
    ? { name: "state", blocked: "blocked", open: "open" }
    : { name: "availability", blocked: "closed", open: "open" };

/**
 * Remove the previous card's reason without erasing construction or manual
 * blockers, then reopen only objects whose reason set is truly empty.
 *
 * The optional state endpoint is coalesced to an impossible empty reason while
 * no closure is active. That keeps the selector value typed as a string and
 * lets the same bounded transaction handle both ordinary and no-op resets.
 */
const buildNetworkClosureResetSteps = () => {
  const activeReason = coalesce(
    stateValue(activeNetworkClosureReasonEndpoint),
    literal("")
  );
  return ["networkNodes", "networkEdges"].flatMap((collection) => {
    const suffix = collection === "networkEdges" ? "edges" : "nodes";
    const facet = networkClosureFacet(collection);
    const selectedStepId = `select-previous-news-blocked-${suffix}`;
    const releasableStepId = `select-releasable-${suffix}`;
    return [
      {
        id: selectedStepId,
        kind: "query",
        op: "core.entities.select",
        selector: {
          collection,
          attributes: {
            networkId: literal("main"),
            blockingReasons: {
              operator: "contains",
              value: activeReason
            }
          },
          cardinality: { min: 0, max: 64 }
        }
      },
      {
        id: `remove-previous-news-block-from-${suffix}`,
        kind: "command",
        op: "core.entities.update",
        selection: resultValue(selectedStepId),
        attributeSetRemovals: {
          blockingReasons: activeReason
        }
      },
      {
        id: releasableStepId,
        kind: "query",
        op: "core.entities.select",
        selector: {
          collection,
          within: resultValue(selectedStepId),
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
        id: `open-releasable-${suffix}`,
        kind: "command",
        op: "core.entities.update",
        selection: resultValue(releasableStepId),
        facetValues: {
          [facet.name]: literal(facet.open)
        }
      }
    ];
  });
};

/**
 * Build the game-local reset performed when a later turn enters its news path.
 *
 * These values last for exactly one turn. Persistent market base prices are
 * intentionally absent: news №34 changes them until the end of the game.
 */
const buildTemporaryNewsEffectResetSteps = () => [
  setState("reset-previous-turn-news-effects", [
    ["public.turnEffects.deliveryPayoutBonus", 0],
    ["public.turnEffects.locomotiveMovementLevy", 0],
    ["public.turnEffects.vehicleAndCargoMaintenanceExempt", false],
    // News №26 is consumed only by a successful first road. If no road was
    // built, its unused allowance still expires at the next news boundary.
    ["public.turnEffects.firstRoadFreeSegments", 0],
    ["public.turnEffects.purchasePermissions.wagon", true],
    ["public.turnEffects.purchasePermissions.locomotive", true],
    ["public.turnEffects.purchasePriceOverrides.wagon", null],
    ["public.turnEffects.purchasePriceOverrides.locomotive", null]
  ]),
  ...buildNetworkClosureResetSteps(),
  setState("clear-previous-network-closure-reason", [
    [activeNetworkClosureReasonEndpoint, null]
  ])
];

const scalarNewsEffectPatchesByNumber = new Map([
  [22, [["public.turnEffects.locomotiveMovementLevy", 1]]],
  [23, [["public.turnEffects.deliveryPayoutBonus", -2]]],
  [24, [["public.turnEffects.deliveryPayoutBonus", 3]]],
  [25, [["public.turnEffects.vehicleAndCargoMaintenanceExempt", true]]],
  [30, [["public.turnEffects.purchasePermissions.wagon", false]]],
  [31, [["public.turnEffects.purchasePermissions.locomotive", false]]],
  [32, [["public.turnEffects.purchasePriceOverrides.wagon", 4]]],
  [33, [["public.turnEffects.purchasePriceOverrides.locomotive", 8]]],
  [
    34,
    [
      ["public.market.basePurchasePrices.wagon", 6],
      ["public.market.basePurchasePrices.locomotive", 12]
    ]
  ]
]);

const buildInitialization = () => {
  const id = "cards.lifecycle.initialize";
  return {
    action: action({
      id,
      label: "Подготовить колоды грузов и новостей",
      semantics: "Один раз создаёт защищённый случайный порядок 23 колод терминалов и 34 одноразовых новостей, не меняя этап подготовки партии."
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: all(
              compare("eq", stateValue("public.session.fixtureId"), literal(normalFixtureId)),
              compare("eq", stateValue("public.session.phase"), literal("setup")),
              compare("eq", stateValue("public.cards.initialized"), literal(false))
            ),
            errorCode: "CARD_LIFECYCLE_ALREADY_INITIALIZED"
          },
          {
            id: "shuffle-news",
            kind: "command",
            op: "deck.shuffle",
            deckId: "news",
            sourceCollection: "newsCards",
            stream: "deck.news"
          },
          ...terminalIds.map((terminalId) => ({
            id: `shuffle-${terminalId}`,
            kind: "command",
            op: "deck.shuffle",
            deckId: terminalDeckId(terminalId),
            sourceCollection: sourceCollectionId(terminalId),
            stream: terminalStreamId(terminalId)
          })),
          setState("mark-ready", [
            ["public.cards.initialized", true],
            ["public.news.status", "first-turn-pending"]
          ])
        ]
      }
    }
  };
};

/**
 * Build the server-owned wagon queue for this turn.
 *
 * The queue contains one entry per active empty carrier wagon standing at an
 * open numbered terminal. It is ordered globally across all terminals by the
 * owner company's money and then by its total active wagon count. A company
 * with two eligible wagons therefore receives two independent queue slots.
 *
 * Two short marker passes keep the selection generic and bounded:
 * open cargo terminals mark location candidates, then logistics-company teams
 * promote only their own candidates to the final eligible set. This avoids
 * trusting a client-provided team, wagon, terminal group, or identifier list.
 */
const buildCargoQueuePrepare = () => {
  const id = "cargo.queue.prepare";
  const turnNumber = cargoQueueTurn();
  const hasEligibleWagons = compare(
    "ne",
    resultValue("eligible-wagons", ["ids"]),
    literal([])
  );
  const hasNoEligibleWagons = compare(
    "eq",
    resultValue("eligible-wagons", ["ids"]),
    literal([])
  );
  return {
    action: action({
      id,
      label: "Подготовить очередь выбора грузов",
      semantics:
        "Сервер один раз на ход фиксирует очередь пустых вагонов на открытых грузовых терминалах: сначала по деньгам компании, затем по числу её активных вагонов, а полный технический паритет разрешает воспроизводимым случайным порядком.",
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
              ...normalLifecycleGuardItems(),
              compare(
                "eq",
                stateValue("public.session.phase"),
                literal("cargo")
              ),
              compare(
                "ne",
                stateValue("public.cards.cargo.preparedTurn"),
                turnNumber
              ),
              compare(
                "eq",
                stateValue("public.cards.cargo.selectionOrder"),
                literal([])
              ),
              compare("eq", currentCargoWagon(), literal(null)),
              compare(
                "eq",
                stateValue("public.cards.cargo.offer.terminalId"),
                literal(null)
              ),
              compare(
                "eq",
                stateValue("public.cards.cargo.offer.firstCardId"),
                literal(null)
              ),
              compare(
                "eq",
                stateValue("public.cards.cargo.offer.secondCardId"),
                literal(null)
              )
            ),
            errorCode: "CARGO_QUEUE_ALREADY_PREPARED"
          },
          {
            id: "all-wagons",
            kind: "query",
            op: "core.entities.select",
            selector: {
              collection: "wagons",
              objectTypes: ["transport.wagon"],
              cardinality: { min: 0, max: 64 }
            }
          },
          {
            id: "reset-queue-markers",
            kind: "command",
            op: "core.entities.update",
            selection: resultValue("all-wagons"),
            attributeValues: {
              cargoOfferEligibleTurn: literal(0),
              cargoPriorityActiveCount: literal(0)
            }
          },
          {
            id: "active-wagons",
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
            id: "mark-active-wagons-for-owner-count",
            kind: "command",
            op: "core.entities.update",
            selection: resultValue("active-wagons"),
            attributeValues: {
              cargoPriorityActiveCount: literal(1)
            }
          },
          // The 23 protected cargo decks are an accepted finite game-content
          // set. Explicit bounded selectors avoid an ambiguous nested item
          // scope while still composing only neutral selection/update
          // operations. All normal and market-created wagons belong to
          // logistics companies by the separately enforced asset rule; draw,
          // select and skip repeat that owner-type check fail-closed.
          ...terminalIds.flatMap((terminalId, index) => {
            const suffix = String(index + 1).padStart(2, "0");
            const selectionStepId = `eligible-at-terminal-${suffix}`;
            const terminalIsOpen = all(
              compare(
                "eq",
                entityValue(
                  "networkNodes",
                  literal(terminalId),
                  "availability"
                ),
                literal("open")
              ),
              compare(
                "eq",
                entityValue(
                  "networkNodes",
                  literal(terminalId),
                  "networkId"
                ),
                literal("main")
              ),
              compare(
                "eq",
                entityValue(
                  "networkNodes",
                  literal(terminalId),
                  "cargoDeckId"
                ),
                literal(terminalId)
              )
            );
            return [
              {
                id: selectionStepId,
                kind: "query",
                op: "core.entities.select",
                selector: {
                  collection: "wagons",
                  objectTypes: ["transport.wagon"],
                  facets: { availability: literal("active") },
                  attributes: {
                    networkId: literal("main"),
                    nodeId: literal(terminalId),
                    cargoId: literal(null)
                  },
                  cardinality: { min: 0, max: 64 }
                }
              },
              {
                id: `mark-eligible-at-terminal-${suffix}`,
                kind: "command",
                op: "core.entities.update",
                selection: resultValue(selectionStepId),
                attributeValues: {
                  cargoOfferEligibleTurn: turnNumber
                },
                when: terminalIsOpen
              }
            ];
          }),
          {
            id: "eligible-wagons",
            kind: "query",
            op: "core.entities.select",
            selector: {
              collection: "wagons",
              objectTypes: ["transport.wagon"],
              attributes: {
                cargoOfferEligibleTurn: turnNumber,
                cargoOfferResolvedTurn: {
                  operator: "ne",
                  value: turnNumber
                }
              },
              cardinality: { min: 0, max: 64 }
            }
          },
          {
            id: "order-eligible-wagons",
            kind: "command",
            op: "core.entities.order",
            selection: resultValue("eligible-wagons"),
            keys: [
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
                  collection: "wagons",
                  join: {
                    current: { kind: "field", field: "ownerTeamId" },
                    relatedField: "ownerTeamId"
                  },
                  aggregate: "sum",
                  valueField: "cargoPriorityActiveCount"
                },
                direction: "descending",
                missing: "error"
              }
            ],
            tieBreak: {
              kind: "seeded-random",
              stream: "cargo-offer-order"
            },
            when: hasEligibleWagons
          },
          setStateExpressions(
            "publish-nonempty-queue",
            [
              [
                { endpoint: "public.cards.cargo.selectionOrder" },
                resultValue("order-eligible-wagons", ["ids"])
              ],
              [
                { endpoint: "public.cards.cargo.currentWagonId" },
                resultValue("order-eligible-wagons", ["ids", "0"])
              ],
              [
                { endpoint: "public.cards.cargo.preparedTurn" },
                turnNumber
              ]
            ],
            hasEligibleWagons
          ),
          setStateExpressions(
            "publish-empty-queue",
            [
              [
                { endpoint: "public.cards.cargo.selectionOrder" },
                literal([])
              ],
              [
                { endpoint: "public.cards.cargo.currentWagonId" },
                literal(null)
              ],
              [
                { endpoint: "public.cards.cargo.preparedTurn" },
                turnNumber
              ]
            ],
            hasNoEligibleWagons
          )
        ]
      }
    }
  };
};

/**
 * Resolve the current wagon slot and advance to the next unresolved saved id.
 *
 * The client never submits a wagon id. The immutable queue and per-wagon turn
 * marker make select, skip and retry safe against stale or forged requests.
 */
const buildCargoQueueAdvanceSteps = () => {
  const turnNumber = cargoQueueTurn();
  const hasRemaining = compare(
    "ne",
    resultValue("remaining-cargo-wagons", ["ids"]),
    literal([])
  );
  const hasNoRemaining = compare(
    "eq",
    resultValue("remaining-cargo-wagons", ["ids"]),
    literal([])
  );
  return [
    {
      id: "resolve-current-wagon-slot",
      kind: "command",
      op: "core.entity.attributes.patch",
      entity: {
        collection: "wagons",
        entityId: currentCargoWagon()
      },
      patches: [{
        operation: "set",
        path: ["cargoOfferResolvedTurn"],
        value: turnNumber
      }]
    },
    {
      id: "remaining-cargo-wagons",
      kind: "query",
      op: "core.entities.select",
      selector: {
        collection: "wagons",
        objectTypes: ["transport.wagon"],
        attributes: {
          cargoOfferEligibleTurn: turnNumber,
          cargoOfferResolvedTurn: {
            operator: "ne",
            value: turnNumber
          }
        },
        cardinality: { min: 0, max: 64 }
      }
    },
    {
      id: "next-cargo-wagon",
      kind: "query",
      op: "core.sequence.next",
      items: stateValue("public.cards.cargo.selectionOrder"),
      current: currentCargoWagon(),
      exclude: {
        collection: "wagons",
        field: "cargoOfferResolvedTurn",
        values: [turnNumber]
      },
      when: hasRemaining
    },
    setStateExpressions(
      "advance-cargo-wagon",
      [[
        { endpoint: "public.cards.cargo.currentWagonId" },
        resultValue("next-cargo-wagon")
      ]],
      hasRemaining
    ),
    setStateExpressions(
      "close-cargo-queue",
      [
        [
          { endpoint: "public.cards.cargo.selectionOrder" },
          literal([])
        ],
        [
          { endpoint: "public.cards.cargo.currentWagonId" },
          literal(null)
        ]
      ],
      hasNoRemaining
    )
  ];
};

const buildCargoDraw = () => {
  const id = "cargo.offer.draw";
  const firstEndpoint = "public.cards.cargo.offer.firstCardId";
  const secondEndpoint = "public.cards.cargo.offer.secondCardId";
  const terminalId = paramValue("terminalId");
  return {
    action: action({
      id,
      label: "Предложить два груза выбранного терминала",
      semantics: "Открывает ровно две физические карты выбранного терминала, если в его колоде осталось не меньше двух; будущий порядок остаётся в серверном состоянии.",
      paramsSchema: cargoOfferParamsSchema
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: all(
              ...normalLifecycleGuardItems(),
              compare("eq", stateValue("public.session.phase"), literal("cargo")),
              cargoQueueIsActive(),
              {
                op: "predicate.entity.matches",
                entity: {
                  collection: "wagons",
                  entityId: currentCargoWagon()
                },
                objectType: "transport.wagon",
                facets: { availability: literal("active") },
                attributes: {
                  networkId: literal("main"),
                  nodeId: terminalId,
                  cargoId: literal(null),
                  cargoOfferEligibleTurn: cargoQueueTurn()
                }
              },
              compare(
                "ne",
                entityValue(
                  "wagons",
                  currentCargoWagon(),
                  "cargoOfferResolvedTurn"
                ),
                cargoQueueTurn()
              ),
              {
                op: "predicate.entity.matches",
                entity: {
                  collection: "networkNodes",
                  entityId: terminalId
                },
                objectType: "transport.terminal",
                facets: { availability: literal("open") },
                attributes: {
                  networkId: literal("main"),
                  cargoDeckId: terminalId
                }
              },
              compare(
                "eq",
                entityValue(
                  "teams",
                  entityValue(
                    "wagons",
                    currentCargoWagon(),
                    "ownerTeamId"
                  ),
                  "type"
                ),
                literal("logistics_company")
              ),
              compare("eq", stateValue("public.cards.cargo.offer.terminalId"), literal(null)),
              compare("eq", stateValue(firstEndpoint), literal(null)),
              compare("eq", stateValue(secondEndpoint), literal(null)),
              compare(
                "gte",
                stateValue(cargoRemainingEndpoint, { terminalId }),
                literal(2)
              )
            ),
            errorCode: "CARGO_OFFER_UNAVAILABLE"
          },
          {
            id: "draw-first",
            kind: "command",
            op: "deck.draw",
            deckId: terminalId,
            target: { endpoint: firstEndpoint },
            onEmpty: "reshuffle-discard"
          },
          {
            id: "hold-first",
            kind: "command",
            op: "deck.extract",
            deckId: terminalId,
            source: "discard",
            card: stateValue(firstEndpoint)
          },
          {
            id: "draw-second",
            kind: "command",
            op: "deck.draw",
            deckId: terminalId,
            target: { endpoint: secondEndpoint },
            onEmpty: "reshuffle-discard"
          },
          {
            id: "hold-second",
            kind: "command",
            op: "deck.extract",
            deckId: terminalId,
            source: "discard",
            card: stateValue(secondEndpoint)
          },
          setFacet(
            "show-first",
            "cargoOrders",
            stateValue(firstEndpoint),
            "status",
            "offered"
          ),
          setFacet(
            "show-second",
            "cargoOrders",
            stateValue(secondEndpoint),
            "status",
            "offered"
          ),
          setStateExpressions("record-terminal", [
            [
              { endpoint: "public.cards.cargo.offer.terminalId" },
              terminalId
            ]
          ])
        ]
      }
    }
  };
};

const buildCargoSelect = () => {
  const id = "cargo.offer.select";
  const firstEndpoint = "public.cards.cargo.offer.firstCardId";
  const secondEndpoint = "public.cards.cargo.offer.secondCardId";
  const terminalId = paramValue("terminalId");
  const selected = paramValue("cargoId");
  const selectedFirst = compare("eq", selected, stateValue(firstEndpoint));
  const selectedSecond = compare("eq", selected, stateValue(secondEndpoint));
  const returnFirst = compare("ne", selected, stateValue(firstEndpoint));
  const returnSecond = compare("ne", selected, stateValue(secondEndpoint));
  const holderTeamId = entityValue(
    "wagons",
    currentCargoWagon(),
    "ownerTeamId"
  );
  return {
    action: action({
      id,
      label: "Выбрать груз из текущего предложения",
      semantics: "Закрепляет выбранную физическую карту за командой, оставляет её вне оборота и возвращает вторую карту в ту же колоду.",
      paramsSchema: cargoSelectionParamsSchema
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: all(
              ...normalLifecycleGuardItems(),
              compare("eq", stateValue("public.session.phase"), literal("cargo")),
              cargoQueueIsActive(),
              {
                op: "predicate.entity.matches",
                entity: {
                  collection: "wagons",
                  entityId: currentCargoWagon()
                },
                objectType: "transport.wagon",
                facets: { availability: literal("active") },
                attributes: {
                  networkId: literal("main"),
                  nodeId: terminalId,
                  cargoId: literal(null),
                  cargoOfferEligibleTurn: cargoQueueTurn()
                }
              },
              compare(
                "ne",
                entityValue(
                  "wagons",
                  currentCargoWagon(),
                  "cargoOfferResolvedTurn"
                ),
                cargoQueueTurn()
              ),
              compare("eq", stateValue("public.cards.cargo.offer.terminalId"), terminalId),
              {
                op: "predicate.any",
                items: [selectedFirst, selectedSecond]
              },
              compare(
                "eq",
                entityValue("teams", holderTeamId, "type"),
                literal("logistics_company")
              ),
              compare(
                "eq",
                entityValue("cargoOrders", selected, "status"),
                literal("offered")
              )
            ),
            errorCode: "CARGO_SELECTION_INVALID"
          },
          {
            id: "return-first-if-unselected",
            kind: "command",
            op: "deck.return",
            deckId: terminalId,
            card: stateValue(firstEndpoint),
            destination: "discard",
            when: returnFirst
          },
          setFacet(
            "hide-first-if-unselected",
            "cargoOrders",
            stateValue(firstEndpoint),
            "status",
            "hidden",
            returnFirst
          ),
          {
            id: "return-second-if-unselected",
            kind: "command",
            op: "deck.return",
            deckId: terminalId,
            card: stateValue(secondEndpoint),
            destination: "discard",
            when: returnSecond
          },
          setFacet(
            "hide-second-if-unselected",
            "cargoOrders",
            stateValue(secondEndpoint),
            "status",
            "hidden",
            returnSecond
          ),
          setFacet("mark-selected", "cargoOrders", selected, "status", "available"),
          {
            id: "record-holder",
            kind: "command",
            op: "core.entity.attributes.patch",
            entity: {
              collection: "cargoOrders",
              entityId: selected
            },
            patches: [
              {
                operation: "set",
                path: ["holderTeamId"],
                value: holderTeamId
              }
            ]
          },
          setState("clear-offer", [
            ["public.cards.cargo.offer.terminalId", null],
            [firstEndpoint, null],
            [secondEndpoint, null]
          ]),
          {
            id: "remove-selected-from-rotation",
            kind: "command",
            op: "core.number.add",
            target: remainingStateRef(terminalId),
            delta: literal(-1)
          },
          ...buildCargoQueueAdvanceSteps()
        ]
      }
    }
  };
};

const buildCargoSkip = () => {
  const id = "cargo.offer.skip";
  const firstEndpoint = "public.cards.cargo.offer.firstCardId";
  const secondEndpoint = "public.cards.cargo.offer.secondCardId";
  const terminalId = paramValue("terminalId");
  const hasOpenOffer = all(
    compare(
      "eq",
      stateValue("public.cards.cargo.offer.terminalId"),
      terminalId
    ),
    {
      op: "predicate.exists",
      value: stateValue(firstEndpoint),
      exists: true
    },
    {
      op: "predicate.exists",
      value: stateValue(secondEndpoint),
      exists: true
    }
  );
  const hasNoOfferBelowTwo = all(
    compare(
      "eq",
      stateValue("public.cards.cargo.offer.terminalId"),
      literal(null)
    ),
    compare("eq", stateValue(firstEndpoint), literal(null)),
    compare("eq", stateValue(secondEndpoint), literal(null)),
    compare(
      "lt",
      stateValue(cargoRemainingEndpoint, { terminalId }),
      literal(2)
    )
  );
  return {
    action: action({
      id,
      label: "Вернуть оба предложенных груза",
      semantics: "Разрешает текущий серверный слот: возвращает обе открытые карты либо технически пропускает терминал, если в нём осталось меньше двух карт. Остаток колоды не уменьшается.",
      paramsSchema: cargoOfferParamsSchema
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: all(
              ...normalLifecycleGuardItems(),
              compare("eq", stateValue("public.session.phase"), literal("cargo")),
              cargoQueueIsActive(),
              {
                op: "predicate.entity.matches",
                entity: {
                  collection: "wagons",
                  entityId: currentCargoWagon()
                },
                objectType: "transport.wagon",
                facets: { availability: literal("active") },
                attributes: {
                  networkId: literal("main"),
                  nodeId: terminalId,
                  cargoId: literal(null),
                  cargoOfferEligibleTurn: cargoQueueTurn()
                }
              },
              compare(
                "ne",
                entityValue(
                  "wagons",
                  currentCargoWagon(),
                  "cargoOfferResolvedTurn"
                ),
                cargoQueueTurn()
              ),
              {
                op: "predicate.entity.matches",
                entity: {
                  collection: "networkNodes",
                  entityId: terminalId
                },
                objectType: "transport.terminal",
                facets: { availability: literal("open") },
                attributes: {
                  networkId: literal("main"),
                  cargoDeckId: terminalId
                }
              },
              {
                op: "predicate.any",
                items: [hasOpenOffer, hasNoOfferBelowTwo]
              }
            ),
            errorCode: "CARGO_OFFER_UNAVAILABLE"
          },
          {
            id: "return-first",
            kind: "command",
            op: "deck.return",
            deckId: terminalId,
            card: stateValue(firstEndpoint),
            destination: "discard",
            when: hasOpenOffer
          },
          {
            id: "return-second",
            kind: "command",
            op: "deck.return",
            deckId: terminalId,
            card: stateValue(secondEndpoint),
            destination: "discard",
            when: hasOpenOffer
          },
          setFacet(
            "hide-first",
            "cargoOrders",
            stateValue(firstEndpoint),
            "status",
            "hidden",
            hasOpenOffer
          ),
          setFacet(
            "hide-second",
            "cargoOrders",
            stateValue(secondEndpoint),
            "status",
            "hidden",
            hasOpenOffer
          ),
          setState("clear-offer", [
            ["public.cards.cargo.offer.terminalId", null],
            [firstEndpoint, null],
            [secondEndpoint, null]
          ]),
          ...buildCargoQueueAdvanceSteps()
        ]
      }
    }
  };
};

const buildFirstTurnSkip = () => {
  const id = "news.lifecycle.first-turn.skip";
  return {
    action: action({
      id,
      label: "Пропустить новость первого хода",
      semantics: "Подтверждает авторское правило: в первом ходу карта новости не открывается и колода не расходуется."
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: all(
              ...normalLifecycleGuardItems(),
              compare("eq", stateValue("public.session.phase"), literal("news")),
              compare("eq", stateValue("public.session.turnNumber"), literal(1)),
              compare("eq", stateValue("public.news.currentCardId"), literal(null)),
              compare("eq", stateValue("public.news.remaining"), literal(34))
            ),
            errorCode: "FIRST_TURN_NEWS_SKIP_UNAVAILABLE"
          },
          setState("finish", [
            ["public.news.status", "first-turn-skipped"],
            ["public.session.phase", "maintenance"]
          ])
        ]
      }
    }
  };
};

const buildNewsDraw = () => {
  const id = "news.lifecycle.draw";
  return {
    action: action({
      id,
      label: "Открыть следующую одноразовую новость",
      semantics: "Со второго хода открывает одну карту без возврата и без автоматического перемешивания сброса."
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: all(
              ...normalLifecycleGuardItems(),
              compare("eq", stateValue("public.session.phase"), literal("news")),
              compare("gt", stateValue("public.session.turnNumber"), literal(1)),
              compare("eq", stateValue("public.news.currentCardId"), literal(null)),
              compare("gt", stateValue("public.news.remaining"), literal(0))
            ),
            errorCode: "NEWS_DRAW_UNAVAILABLE"
          },
          ...buildTemporaryNewsEffectResetSteps(),
          {
            id: "draw",
            kind: "command",
            op: "deck.draw",
            deckId: "news",
            target: { endpoint: "public.news.currentCardId" },
            onEmpty: "fail"
          },
          setFacet(
            "show-current",
            "newsCards",
            stateValue("public.news.currentCardId"),
            "availability",
            "current"
          ),
          {
            id: "decrement",
            kind: "command",
            op: "core.number.add",
            target: { endpoint: "public.news.remaining" },
            delta: literal(-1)
          },
          setState("mark-current", [["public.news.status", "current"]])
        ]
      }
    }
  };
};

const buildNewsStagnation = () => {
  const id = "news.lifecycle.stagnation";
  return {
    action: action({
      id,
      label: "Продолжить ход без новости",
      semantics: "После исчерпания 34 карт фиксирует период застоя и переводит игру к обслуживанию без повторной новости."
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: all(
              ...normalLifecycleGuardItems(),
              compare("eq", stateValue("public.session.phase"), literal("news")),
              compare("gt", stateValue("public.session.turnNumber"), literal(1)),
              compare("eq", stateValue("public.news.currentCardId"), literal(null)),
              compare("eq", stateValue("public.news.remaining"), literal(0))
            ),
            errorCode: "NEWS_STAGNATION_UNAVAILABLE"
          },
          ...buildTemporaryNewsEffectResetSteps(),
          setState("finish", [
            ["public.news.status", "stagnation"],
            ["public.session.phase", "maintenance"]
          ])
        ]
      }
    }
  };
};

const buildCargoAdditionNews = (news, cargoById) => {
  const id = `news.cargo-addition.apply.${String(news.number).padStart(2, "0")}`;
  const records = news.linkedCargoRecordIds.map((cargoId) => cargoById.get(cargoId));
  const grouped = new Map();
  for (const cargo of records) {
    const items = grouped.get(cargo.originNodeId) ?? [];
    items.push(cargo);
    grouped.set(cargo.originNodeId, items);
  }
  const affectedTerminals = [...grouped.keys()].sort(
    (left, right) => Number(left.slice(9)) - Number(right.slice(9))
  );
  return {
    action: action({
      id,
      label: `Применить новость № ${news.number}: добавить грузы`,
      semantics: `Один раз добавляет ${records.length} подтверждённых физических карт в колоды их терминалов и случайно включает их в будущий порядок.`
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: all(
              ...normalLifecycleGuardItems(),
              compare("eq", stateValue("public.session.phase"), literal("news")),
              compare("eq", stateValue("public.news.currentCardId"), literal(news.id)),
              compare(
                "eq",
                entityValue("newsCards", literal(news.id), "availability"),
                literal("current")
              )
            ),
            errorCode: "NEWS_CARGO_ADDITION_UNAVAILABLE"
          },
          ...records.map((cargo) => ({
            id: `insert-${cargo.id}`,
            kind: "command",
            op: "deck.insert",
            deckId: terminalDeckId(cargo.originNodeId),
            sourceCollection: "cargoOrders",
            card: literal(cargo.id),
            destination: "discard"
          })),
          ...affectedTerminals.map((terminalId) => ({
            id: `shuffle-${terminalId}`,
            kind: "command",
            op: "deck.shuffle",
            deckId: terminalDeckId(terminalId),
            sourceCollection: sourceCollectionId(terminalId),
            stream: terminalStreamId(terminalId)
          })),
          ...affectedTerminals.map((terminalId) => ({
            id: `count-${terminalId}`,
            kind: "command",
            op: "core.number.add",
            target: remainingStateRef(literal(terminalId)),
            delta: literal(grouped.get(terminalId).length)
          })),
          setFacet(
            "resolve-card",
            "newsCards",
            literal(news.id),
            "availability",
            "resolved"
          ),
          setState("finish", [
            ["public.news.currentCardId", null],
            ["public.news.status", "resolved"],
            ["public.session.phase", "maintenance"]
          ])
        ]
      }
    }
  };
};

/**
 * Apply one exact, author-confirmed network closure for the current turn.
 *
 * Each target receives the card id as an independent set member. The facet is
 * only a fast availability projection; `blockingReasons` remains the source of
 * truth that prevents a later news reset from erasing a construction or manual
 * closure.
 */
const buildNetworkClosureNews = (news, targets) => {
  const suffix = String(news.number).padStart(2, "0");
  const id = `news.effect.apply.${suffix}`;
  const reason = news.id;
  return {
    action: action({
      id,
      label: `Применить новость № ${news.number}: закрыть сеть на ход`,
      semantics:
        news.number === 21
          ? "Один раз закрывает подтверждённые терминалы 5 и 7 Белой Гвинеи на текущий ход; геометрия всего региона остаётся отдельной проверкой содержимого."
          : `Один раз закрывает точный подтверждённый объект сети по новости № ${news.number} на текущий ход.`,
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
              ...normalLifecycleGuardItems(),
              compare("eq", stateValue("public.session.phase"), literal("news")),
              compare("eq", stateValue("public.news.currentCardId"), literal(news.id)),
              compare(
                "eq",
                entityValue("newsCards", literal(news.id), "availability"),
                literal("current")
              ),
              compare(
                "eq",
                stateValue(activeNetworkClosureReasonEndpoint),
                literal(null)
              ),
              ...targets.map((target) =>
                compare(
                  "eq",
                  entityValue(
                    target.collection,
                    literal(target.entityId),
                    "networkId"
                  ),
                  literal("main")
                )
              )
            ),
            errorCode: "NEWS_NETWORK_CLOSURE_UNAVAILABLE"
          },
          ...targets.flatMap((target, index) => {
            const facet = networkClosureFacet(target.collection);
            return [
              {
                id: `record-reason-${index + 1}`,
                kind: "command",
                op: "core.entity.attributes.patch",
                entity: {
                  collection: target.collection,
                  entityId: literal(target.entityId)
                },
                patches: [
                  {
                    operation: "set-add",
                    path: ["blockingReasons"],
                    value: literal(reason)
                  }
                ]
              },
              setFacet(
                `block-target-${index + 1}`,
                target.collection,
                literal(target.entityId),
                facet.name,
                facet.blocked
              )
            ];
          }),
          setFacet(
            "resolve-card",
            "newsCards",
            literal(news.id),
            "availability",
            "resolved"
          ),
          setState("finish", [
            [activeNetworkClosureReasonEndpoint, reason],
            ["public.news.currentCardId", null],
            ["public.news.status", "resolved"],
            ["public.session.phase", "maintenance"]
          ])
        ]
      }
    }
  };
};

/**
 * Collect the one-shot news №16 budget fee from every qualifying team.
 *
 * The news phase is the first phase of the turn and admits no money-changing
 * action before this plan, so the authoritative live balance is exactly the
 * previous turn's closing balance. Every selected team has at least 16 coins,
 * making the mandatory five-coin transfer intrinsically payable.
 */
const buildBudgetFeeNews = (news) => {
  const suffix = String(news.number).padStart(2, "0");
  const id = `news.effect.apply.${suffix}`;
  return {
    action: action({
      id,
      label: `Применить новость № ${news.number}: сбор в бюджет`,
      semantics:
        "Один раз списывает по пять монет со всех команд, имевших больше пятнадцати монет по итогам прошлого хода.",
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
              ...normalLifecycleGuardItems(),
              compare("eq", stateValue("public.session.phase"), literal("news")),
              compare("eq", stateValue("public.news.currentCardId"), literal(news.id)),
              compare(
                "eq",
                entityValue("newsCards", literal(news.id), "availability"),
                literal("current")
              )
            ),
            errorCode: "NEWS_EFFECT_UNAVAILABLE"
          },
          {
            id: "qualifying-teams",
            kind: "query",
            op: "core.entities.select",
            selector: {
              collection: "teams",
              objectTypes: ["game.team"],
              attributes: {
                coins: {
                  operator: "gt",
                  value: literal(15)
                }
              },
              cardinality: { min: 0, max: 12 }
            }
          },
          {
            id: "collect-budget-fee",
            kind: "command",
            op: "core.entities.each",
            selection: resultValue("qualifying-teams"),
            body: [
              {
                id: "debit-team",
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
                amount: literal(5),
                onInsufficient: "fail"
              },
              {
                id: "journal-team-fee",
                kind: "command",
                op: "core.event.emit",
                eventType: "news.budget.fee.paid",
                summary: literal("Команда перечислила единоразовый сбор в бюджет"),
                audience: "public",
                data: {
                  newsId: literal(news.id),
                  teamId: itemId(),
                  threshold: literal(15),
                  amount: literal(5),
                  // The event follows the transfer and therefore records the
                  // committed candidate balance, not a stale pre-charge value.
                  balanceAfter: itemAttribute("coins"),
                  turnNumber: stateValue("public.session.turnNumber")
                }
              }
            ]
          },
          setFacet(
            "resolve-card",
            "newsCards",
            literal(news.id),
            "availability",
            "resolved"
          ),
          setState("finish", [
            ["public.news.currentCardId", null],
            ["public.news.status", "resolved"],
            ["public.session.phase", "maintenance"]
          ])
        ]
      }
    }
  };
};

/**
 * Activate the persistent progressive asset tax from news №14.
 *
 * The card changes only a durable game-owned rule modifier. The operating-turn
 * generator consumes that modifier at every later maintenance boundary, where
 * the complete multi-team charge can be committed or rolled back atomically.
 * Keeping activation separate from collection avoids charging the turn that
 * precedes the news and preserves the author's "until game end" duration.
 */
const buildProgressiveAssetTaxNews = (news) => {
  const id = "news.effect.apply.14";
  return {
    action: action({
      id,
      label: "Применить новость № 14: прогрессивный налог",
      semantics:
        "До конца партии включает налог, взимаемый каждый ход с локомотивов гильдий сверх трёх и вагонов перевозчиков сверх пяти.",
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
              ...normalLifecycleGuardItems(),
              compare("eq", stateValue("public.session.phase"), literal("news")),
              compare("eq", stateValue("public.news.currentCardId"), literal(news.id)),
              compare(
                "eq",
                entityValue("newsCards", literal(news.id), "availability"),
                literal("current")
              )
            ),
            errorCode: "NEWS_EFFECT_UNAVAILABLE"
          },
          setState("activate-progressive-asset-tax", [
            ["public.ruleModifiers.progressiveAssetTaxActive", true]
          ]),
          {
            id: "journal-activation",
            kind: "command",
            op: "core.event.emit",
            eventType: "news.progressive-asset-tax.activated",
            summary: literal("Новость № 14 включила прогрессивный налог до конца партии"),
            audience: "public",
            data: {
              newsId: literal(news.id),
              active: literal(true),
              turnNumber: stateValue("public.session.turnNumber")
            }
          },
          setFacet(
            "resolve-card",
            "newsCards",
            literal(news.id),
            "availability",
            "resolved"
          ),
          setState("finish", [
            ["public.news.currentCardId", null],
            ["public.news.status", "resolved"],
            ["public.session.phase", "maintenance"]
          ])
        ]
      }
    }
  };
};

/**
 * Materialize one author-confirmed scalar news effect.
 *
 * The effect changes only game-owned state. The market and maintenance
 * workflows will consume these typed values later; this generator does not
 * invent those still-unimplemented settlements.
 */
const buildScalarNewsEffect = (news, patches) => {
  const suffix = String(news.number).padStart(2, "0");
  const id = `news.effect.apply.${suffix}`;
  return {
    action: action({
      id,
      label: `Применить новость № ${news.number}`,
      semantics: `Один раз применяет подтверждённый эффект новости № ${news.number}, закрывает точную карту и переводит ход к обслуживанию.`,
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
              ...normalLifecycleGuardItems(),
              compare("eq", stateValue("public.session.phase"), literal("news")),
              compare("eq", stateValue("public.news.currentCardId"), literal(news.id)),
              compare(
                "eq",
                entityValue("newsCards", literal(news.id), "availability"),
                literal("current")
              )
            ),
            errorCode: "NEWS_EFFECT_UNAVAILABLE"
          },
          setState("apply-effect", patches),
          setFacet(
            "resolve-card",
            "newsCards",
            literal(news.id),
            "availability",
            "resolved"
          ),
          setState("finish", [
            ["public.news.currentCardId", null],
            ["public.news.status", "resolved"],
            ["public.session.phase", "maintenance"]
          ])
        ]
      }
    }
  };
};

/**
 * Apply the one-turn first-road allowance from news №26.
 *
 * Construction, rather than the card, consumes the allowance after a
 * successful road. A waypoint or rejected road leaves it intact; the next
 * news boundary resets any unused remainder to zero.
 */
const buildFirstRoadDiscountNews = (news) => {
  const id = "news.effect.apply.26";
  return {
    action: action({
      id,
      label: "Применить новость № 26: шесть бесплатных сегментов",
      semantics:
        "Даёт первой успешно построенной дороге текущего хода до шести бесплатных сегментов; остаток не переносится.",
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
              ...normalLifecycleGuardItems(),
              compare("eq", stateValue("public.session.phase"), literal("news")),
              compare("eq", stateValue("public.news.currentCardId"), literal(news.id)),
              compare(
                "eq",
                entityValue("newsCards", literal(news.id), "availability"),
                literal("current")
              )
            ),
            errorCode: "NEWS_EFFECT_UNAVAILABLE"
          },
          setState("apply-effect", [
            ["public.turnEffects.firstRoadFreeSegments", 6]
          ]),
          setFacet(
            "resolve-card",
            "newsCards",
            literal(news.id),
            "availability",
            "resolved"
          ),
          setState("finish", [
            ["public.news.currentCardId", null],
            ["public.news.status", "resolved"],
            ["public.session.phase", "maintenance"]
          ])
        ]
      }
    }
  };
};

/**
 * Apply news №27 as an idempotent state-funded road.
 *
 * The two directed lookups implement undirected duplicate detection. Every
 * graph mutation step is conditional on both lookups being empty; card
 * resolution is unconditional, so an already existing road is the required
 * safe no-op and never consumes a random route choice or collection id.
 */
const buildGovernmentRoadNews = (news) => {
  const id = "news.effect.apply.27";
  const noExistingRoad = all(
    compare("eq", resultValue("find-forward", ["ids"]), literal([])),
    compare("eq", resultValue("find-reverse", ["ids"]), literal([]))
  );
  const existingRoad = {
    op: "predicate.not",
    item: noExistingRoad
  };
  return {
    action: action({
      id,
      label: "Применить новость № 27: государственная дорога 12–22",
      semantics:
        "Создаёт дорогу 12–22 с открытием в следующем ходу либо безопасно ничего не меняет, если связь уже существует.",
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
              ...normalLifecycleGuardItems(),
              compare("eq", stateValue("public.session.phase"), literal("news")),
              compare("eq", stateValue("public.news.currentCardId"), literal(news.id)),
              compare(
                "eq",
                entityValue("newsCards", literal(news.id), "availability"),
                literal("current")
              )
            ),
            errorCode: "NEWS_EFFECT_UNAVAILABLE"
          },
          {
            id: "find-forward",
            kind: "query",
            op: "core.entities.select",
            selector: {
              collection: "networkEdges",
              attributes: {
                networkId: literal("main"),
                fromNodeId: literal("terminal-12"),
                toNodeId: literal("terminal-22")
              },
              cardinality: { min: 0, max: 1 }
            }
          },
          {
            id: "find-reverse",
            kind: "query",
            op: "core.entities.select",
            selector: {
              collection: "networkEdges",
              attributes: {
                networkId: literal("main"),
                fromNodeId: literal("terminal-22"),
                toNodeId: literal("terminal-12")
              },
              cardinality: { min: 0, max: 1 }
            }
          },
          {
            id: "route",
            kind: "command",
            op: "graph.regions.route.plan",
            networkId: "main",
            fromNode: literal("terminal-12"),
            toNode: literal("terminal-22"),
            when: noExistingRoad
          },
          {
            id: "allocate-edge-id",
            kind: "command",
            op: "core.collection.id.allocate",
            collection: "networkEdges",
            sequence: { endpoint: "public.transportNetworks.main.sequence" },
            prefix: "main:edge",
            when: noExistingRoad
          },
          {
            id: "create-edge",
            kind: "command",
            op: "core.entity.create",
            visibility: "public",
            collection: "networkEdges",
            entityId: resultValue("allocate-edge-id", ["id"]),
            objectType: "transport.edge",
            facets: { state: literal("building") },
            attributes: {
              networkId: literal("main"),
              fromNodeId: resultValue("route", ["fromNodeId"]),
              toNodeId: resultValue("route", ["toNodeId"]),
              geometry: resultValue("route", ["geometry"]),
              constructionCost: literal(0),
              regionSegments: resultValue("route", ["regionSegments"]),
              discountedRegionSegments: literal(0),
              payableRegionSegments: literal(0),
              routePlan: resultValue("route", ["routePlan"]),
              splitFromEdgeId: literal(""),
              createdTurn: stateValue("public.session.turnNumber"),
              activationTurn: {
                op: "number.add",
                items: [
                  stateValue("public.session.turnNumber"),
                  literal(1)
                ]
              },
              blockingReasons: literal(["construction-pending"])
            },
            when: noExistingRoad
          },
          ...["terminal-12", "terminal-22"].flatMap((nodeId, index) => [
            setFacet(
              `block-government-road-endpoint-${index + 1}`,
              "networkNodes",
              literal(nodeId),
              "availability",
              "building",
              noExistingRoad
            ),
            {
              id: `extend-government-road-endpoint-${index + 1}-closure`,
              kind: "command",
              op: "core.entity.attributes.patch",
              entity: {
                collection: "networkNodes",
                entityId: literal(nodeId)
              },
              patches: [
                {
                  operation: "set",
                  path: ["activationTurn"],
                  value: {
                    op: "number.max",
                    items: [
                      entityValue(
                        "networkNodes",
                        literal(nodeId),
                        "activationTurn"
                      ),
                      {
                        op: "number.add",
                        items: [
                          stateValue("public.session.turnNumber"),
                          literal(1)
                        ]
                      }
                    ]
                  }
                },
                {
                  operation: "set-add",
                  path: ["blockingReasons"],
                  value: literal("construction-pending")
                }
              ],
              when: noExistingRoad
            }
          ]),
          {
            id: "journal-created",
            kind: "command",
            op: "core.event.emit",
            eventType: "news.government-road.applied",
            summary: literal(
              "Государство построило дорогу 12–22 с открытием в следующем ходу"
            ),
            audience: "public",
            data: {
              newsId: literal(news.id),
              created: literal(true),
              fromNodeId: literal("terminal-12"),
              toNodeId: literal("terminal-22"),
              turnNumber: stateValue("public.session.turnNumber")
            },
            when: noExistingRoad
          },
          {
            id: "journal-existing",
            kind: "command",
            op: "core.event.emit",
            eventType: "news.government-road.applied",
            summary: literal(
              "Дорога 12–22 уже существовала; новость не изменила сеть"
            ),
            audience: "public",
            data: {
              newsId: literal(news.id),
              created: literal(false),
              fromNodeId: literal("terminal-12"),
              toNodeId: literal("terminal-22"),
              turnNumber: stateValue("public.session.turnNumber")
            },
            when: existingRoad
          },
          setFacet(
            "resolve-card",
            "newsCards",
            literal(news.id),
            "availability",
            "resolved"
          ),
          setState("finish", [
            ["public.news.currentCardId", null],
            ["public.news.status", "resolved"],
            ["public.session.phase", "maintenance"]
          ])
        ]
      }
    }
  };
};

const assertIntakeSemantics = (intake) => {
  assert.equal(intake.publishable, false, "intake must remain non-publishable");
  assert.equal(intake.authorConfirmations?.oneSourceRowEqualsOneRuntimeCard, true);
  assert.equal(intake.authorConfirmations?.runtimeDeckLifecycleApproved, true);
  assert.equal(intake.unresolved?.executableNewsMappingComplete, false);
  assert.equal(intake.cargoRecords.length, 174);
  assert.equal(intake.newsRecords.length, 34);
  assert.equal(new Set(intake.cargoRecords.map((item) => item.id)).size, 174);
  assert.deepEqual(
    intake.newsRecords.map((item) => item.number),
    Array.from({ length: 34 }, (_, index) => index + 1)
  );
  const base = intake.cargoRecords.filter((item) => item.deck.kind === "base-terminal");
  const added = intake.cargoRecords.filter((item) => item.deck.kind === "news-addition");
  assert.equal(base.length, 112);
  assert.equal(added.length, 62);
  for (const terminalId of terminalIds) {
    assert.ok(base.some((item) => item.deck.terminalId === terminalId), `${terminalId} base deck`);
  }
  const linked = intake.newsRecords.slice(0, 10).flatMap((item) => item.linkedCargoRecordIds);
  assert.deepEqual(new Set(linked), new Set(added.map((item) => item.id)));
};

const buildCargoObject = (record) => ({
  objectType: "transport.cargo",
  facets: { status: "hidden" },
  attributes: {
    id: record.id,
    sourceRow: record.sourceRow,
    sourceDeckLabel: record.sourceDeckLabel,
    networkId: "main",
    fromNodeId: record.originNodeId,
    toNodeId: record.destinationNodeId,
    payout: record.bankPayout,
    holderTeamId: null,
    settledRouteLength: null,
    // Cargo is charged only after a team starts holding it. Turn zero is the
    // explicit baseline used by the operating-turn maintenance workflow.
    maintenancePaidTurn: 0
  }
});

const buildNewsObject = (record) => ({
  objectType: "content.news-card",
  facets: { availability: "hidden" },
  attributes: {
    id: record.id,
    sourceRow: record.sourceRow,
    number: record.number,
    category: record.category,
    text: record.text,
    linkedCargoRecordIds: record.linkedCargoRecordIds
  }
});

const buildSourceCollectionModel = (terminalId, count) => ({
  itemShape: "record",
  audienceRef: "server",
  storage: {
    root: "secret",
    segments: ["cargoSources", terminalId]
  },
  capacity: count,
  stableKey: "map-key",
  fields: {
    cardId: {
      storage: { kind: "path", path: ["cardId"] },
      valueType: "core.string",
      access: "read-only"
    }
  }
});

const ownsLifecycleAction = (candidate) =>
  lifecycleActionPrefixes.some((prefix) => candidate.id.startsWith(prefix));
const ownsLifecyclePlan = (planId) =>
  lifecycleActionPrefixes.some((prefix) => planId.startsWith(prefix));

/**
 * Keep the older bounded technical replay aligned with the same safe set
 * semantics as the ordinary game path.
 *
 * The replay action predates the card-lifecycle generator, so it remains
 * fixture-scoped. Rewriting only its exact reason step prevents future
 * lifecycle rebuilds from restoring the former whole-set replacement.
 */
const alignTechnicalNews11ReasonPatch = (root) => {
  const plan = root.mechanics.plans["technical.news.apply.11"];
  if (!plan) return;
  const reasonStep = plan.transaction.steps.find(
    (step) => step.id === "record-reason"
  );
  assert.ok(reasonStep, "technical news 11 reason step is required");
  assert.equal(reasonStep.op, "core.entity.attributes.patch");
  assert.equal(reasonStep.entity.collection, "networkEdges");
  assert.deepEqual(reasonStep.entity.entityId, literal("road-1-9"));
  reasonStep.patches = [
    {
      operation: "set-add",
      path: ["blockingReasons"],
      value: literal("news-11")
    }
  ];
};

/** Fail generation if a confirmed card points outside the current network. */
const assertNetworkClosureTargetsExist = (root) => {
  for (const [newsNumber, targets] of networkClosureNewsByNumber) {
    for (const target of targets) {
      const entity = root.state.public.objects[target.collection]?.[target.entityId];
      assert.ok(
        entity,
        `news ${newsNumber} target ${target.collection}/${target.entityId} must exist`
      );
      assert.equal(
        entity.attributes.networkId,
        "main",
        `news ${newsNumber} target ${target.entityId} must belong to main network`
      );
    }
  }
};

/**
 * Return a new authoring document so --check can prove that the transformation
 * is deterministic without mutating the parsed input object.
 */
const buildLifecycleAuthoring = (sourceAuthoring, intake) => {
  assertIntakeSemantics(intake);
  const authoring = structuredClone(sourceAuthoring);
  const root = authoring.root;
  const cargoById = new Map(intake.cargoRecords.map((item) => [item.id, item]));
  const baseByTerminal = Object.fromEntries(terminalIds.map((id) => [id, []]));
  for (const cargo of intake.cargoRecords) {
    if (cargo.deck.kind === "base-terminal") {
      baseByTerminal[cargo.deck.terminalId].push(cargo);
    }
  }
  assertNetworkClosureTargetsExist(root);
  alignTechnicalNews11ReasonPatch(root);

  root.config.runtimeReady = false;
  root.config.runtimeBlockers = [
    "remaining executable news effects 19, 28 and 29",
    "single remaining cargo card offer policy",
    ...root.config.runtimeBlockers.filter(
      (item) =>
        item !== "executable news effects 11-34" &&
        item !== "remaining executable news effects 11-22 and 26-29" &&
        item !== "remaining executable news effects 11-15, 17-21 and 26-29" &&
        item !== "remaining executable news effects 14, 19 and 26-29" &&
        item !== "remaining executable news effects 14, 19, 28 and 29" &&
        item !== "remaining executable news effects 19, 28 and 29" &&
        item !== "single remaining cargo card offer policy" &&
        item !== "remaining market, cargo selection sequencing and reporting workflows" &&
        item !== "remaining market, cargo selection sequencing, construction and reporting workflows" &&
        item !== "executable news effect mapping" &&
        item !== "cargo card multiplicity and executable deck"
    )
  ];

  root.objectTypes["transport.cargo"].facets.status = {
    initial: "hidden",
    values: {
      hidden: { visible: false, interactive: false },
      offered: { visible: true, interactive: true },
      available: { visible: true, interactive: true },
      in_transit: { visible: true, interactive: false },
      delivered: { visible: true, interactive: false }
    }
  };
  root.objectTypes["content.news-card"] = {
    _type: "game.ObjectType",
    _label: "Карта новости",
    _semantics: "Одна физическая одноразовая карта новости; будущий порядок хранится только на сервере.",
    collection: "newsCards",
    idField: "id",
    scope: "session",
    facets: {
      availability: {
        initial: "hidden",
        values: {
          hidden: { visible: false, interactive: false },
          current: { visible: true, interactive: false },
          resolved: { visible: true, interactive: false }
        }
      }
    }
  };

  root.state.public.cards = {
    initialized: false,
    cargo: {
      selectionOrder: [],
      currentWagonId: null,
      preparedTurn: 0,
      offer: {
        terminalId: null,
        firstCardId: null,
        secondCardId: null
      },
      remaining: Object.fromEntries(
        terminalIds.map((terminalId) => [terminalId, baseByTerminal[terminalId].length])
      )
    }
  };
  root.state.public.news = {
    currentCardId: null,
    remaining: 34,
    status: "not-initialized",
    activeNetworkClosureReason: null
  };
  root.state.public.turnEffects = {
    deliveryPayoutBonus: 0,
    locomotiveMovementLevy: 0,
    vehicleAndCargoMaintenanceExempt: false,
    firstRoadFreeSegments: 0,
    purchasePermissions: {
      wagon: true,
      locomotive: true
    },
    purchasePriceOverrides: {
      wagon: null,
      locomotive: null
    }
  };
  root.state.public.ruleModifiers = {
    ...(root.state.public.ruleModifiers ?? {}),
    progressiveAssetTaxActive: false
  };
  root.state.public.market = {
    ...(root.state.public.market ?? {}),
    basePurchasePrices: {
      wagon: 5,
      locomotive: 10
    }
  };
  root.state.public.objects.cargoOrders = Object.fromEntries(
    intake.cargoRecords.map((item) => [item.id, buildCargoObject(item)])
  );
  root.state.public.objects.newsCards = Object.fromEntries(
    intake.newsRecords.map((item) => [item.id, buildNewsObject(item)])
  );
  root.state.secret = {
    random: {
      alg: "xoshiro128ss-streams-v1",
      seed: "0000000000000000000000000000c0de",
      counters: {}
    },
    decks: {},
    cargoSources: Object.fromEntries(
      terminalIds.map((terminalId) => [
        terminalId,
        Object.fromEntries(
          baseByTerminal[terminalId].map((item) => [item.id, { cardId: item.id }])
        )
      ])
    )
  };

  const types = root.mechanics.stateModel.types;
  types["game.transport.cargo-status"].values = [
    "hidden",
    "offered",
    "available",
    "in_transit",
    "delivered"
  ];
  types["game.content.news-status"] = {
    kind: "enum",
    values: ["hidden", "current", "resolved"]
  };
  types["game.cargo-wagon-order"] = {
    kind: "list",
    itemType: "core.string",
    maxItems: 64
  };
  types["game.binary-count"] = {
    kind: "integer",
    minimum: 0,
    maximum: 1
  };
  types["game.news-budget-fee-event"] = {
    kind: "record",
    fields: {
      newsId: { typeRef: "core.string", optional: false },
      teamId: { typeRef: "core.string", optional: false },
      threshold: { typeRef: "core.integer", optional: false },
      amount: { typeRef: "core.integer", optional: false },
      balanceAfter: { typeRef: "core.integer", optional: false },
      turnNumber: { typeRef: "core.integer", optional: false }
    }
  };
  types["game.news-progressive-asset-tax-activation-event"] = {
    kind: "record",
    fields: {
      newsId: { typeRef: "core.string", optional: false },
      active: { typeRef: "core.boolean", optional: false },
      turnNumber: { typeRef: "core.integer", optional: false }
    }
  };
  types["game.news-government-road-event"] = {
    kind: "record",
    fields: {
      newsId: { typeRef: "core.string", optional: false },
      created: { typeRef: "core.boolean", optional: false },
      fromNodeId: { typeRef: "core.string", optional: false },
      toNodeId: { typeRef: "core.string", optional: false },
      turnNumber: { typeRef: "core.integer", optional: false }
    }
  };

  const cargoFields = root.mechanics.stateModel.collections.cargoOrders.fields;
  cargoFields.id = {
    storage: { kind: "attribute", name: "id" },
    valueType: "core.string",
    access: "read-only"
  };
  cargoFields.sourceRow = {
    storage: { kind: "attribute", name: "sourceRow" },
    valueType: "core.integer",
    access: "read-only"
  };
  cargoFields.sourceDeckLabel = {
    storage: { kind: "attribute", name: "sourceDeckLabel" },
    valueType: "core.string",
    access: "read-only"
  };
  cargoFields.holderTeamId = {
    storage: { kind: "attribute", name: "holderTeamId" },
    valueType: "core.optional-string",
    access: "read-write"
  };

  const collections = root.mechanics.stateModel.collections;
  const wagonFields = collections.wagons?.fields;
  const nodeFields = collections.networkNodes?.fields;
  assert.ok(wagonFields, "wagons collection is required");
  assert.ok(nodeFields, "networkNodes collection is required");
  delete wagonFields.cargoOfferCandidateTurn;
  wagonFields.cargoOfferEligibleTurn = {
    storage: { kind: "attribute", name: "cargoOfferEligibleTurn" },
    valueType: "core.integer",
    access: "read-write"
  };
  wagonFields.cargoOfferResolvedTurn = {
    storage: { kind: "attribute", name: "cargoOfferResolvedTurn" },
    valueType: "core.integer",
    access: "read-write"
  };
  wagonFields.cargoPriorityActiveCount = {
    storage: { kind: "attribute", name: "cargoPriorityActiveCount" },
    valueType: "game.binary-count",
    access: "read-write"
  };
  nodeFields.cargoDeckId = {
    storage: { kind: "attribute", name: "cargoDeckId" },
    valueType: "core.optional-string",
    access: "read-only"
  };

  // The numbered terminal id is also its protected deck id. The special
  // terminal 3,14 and the waypoint 9¾ deliberately receive null and therefore
  // cannot enter the cargo-offer queue.
  for (const [nodeId, node] of Object.entries(root.state.public.objects.networkNodes)) {
    node.attributes.cargoDeckId = terminalIds.includes(nodeId) ? nodeId : null;
  }
  for (const wagon of Object.values(root.state.public.objects.wagons)) {
    delete wagon.attributes.cargoOfferCandidateTurn;
    wagon.attributes.cargoOfferEligibleTurn = 0;
    wagon.attributes.cargoOfferResolvedTurn = 0;
    wagon.attributes.cargoPriorityActiveCount = 0;
  }
  // Setup owns dynamic wagon creation. Extending every existing creation plan
  // keeps generator order idempotent without inventing a second creation path.
  for (const plan of Object.values(root.mechanics.plans)) {
    for (const step of plan.transaction.steps) {
      if (step.op === "core.entity.create" && step.collection === "wagons") {
        delete step.attributes.cargoOfferCandidateTurn;
        step.attributes.cargoOfferEligibleTurn = literal(0);
        step.attributes.cargoOfferResolvedTurn = literal(0);
        step.attributes.cargoPriorityActiveCount = literal(0);
      }
    }
  }

  collections.newsCards = {
    audienceRef: "public",
    storage: {
      root: "public",
      segments: ["objects", "newsCards"]
    },
    capacity: 64,
    stableKey: "map-key",
    itemTypes: ["content.news-card"],
    fields: {
      availability: {
        storage: { kind: "facet", name: "availability" },
        valueType: "game.content.news-status",
        access: "read-write"
      },
      id: {
        storage: { kind: "attribute", name: "id" },
        valueType: "core.string",
        access: "read-only"
      },
      sourceRow: {
        storage: { kind: "attribute", name: "sourceRow" },
        valueType: "core.integer",
        access: "read-only"
      },
      number: {
        storage: { kind: "attribute", name: "number" },
        valueType: "core.integer",
        access: "read-only"
      },
      category: {
        storage: { kind: "attribute", name: "category" },
        valueType: "core.string",
        access: "read-only"
      },
      text: {
        storage: { kind: "attribute", name: "text" },
        valueType: "core.string",
        access: "read-only"
      },
      linkedCargoRecordIds: {
        storage: { kind: "attribute", name: "linkedCargoRecordIds" },
        valueType: "core.string-set",
        access: "read-only"
      }
    }
  };
  for (const terminalId of terminalIds) {
    collections[sourceCollectionId(terminalId)] = buildSourceCollectionModel(
      terminalId,
      baseByTerminal[terminalId].length
    );
  }

  const endpoints = root.mechanics.stateModel.endpoints;
  Object.assign(endpoints, {
    "public.cards.initialized": {
      audienceRef: "public",
      storage: { root: "public", segments: ["cards", "initialized"] },
      valueType: "core.boolean",
      access: "read-write"
    },
    "public.cards.cargo.offer.terminalId": {
      audienceRef: "public",
      storage: { root: "public", segments: ["cards", "cargo", "offer", "terminalId"] },
      valueType: "core.optional-string",
      access: "read-write"
    },
    "public.cards.cargo.offer.firstCardId": {
      audienceRef: "public",
      storage: { root: "public", segments: ["cards", "cargo", "offer", "firstCardId"] },
      valueType: "core.optional-string",
      access: "read-write"
    },
    "public.cards.cargo.offer.secondCardId": {
      audienceRef: "public",
      storage: { root: "public", segments: ["cards", "cargo", "offer", "secondCardId"] },
      valueType: "core.optional-string",
      access: "read-write"
    },
    "public.cards.cargo.selectionOrder": {
      audienceRef: "public",
      storage: {
        root: "public",
        segments: ["cards", "cargo", "selectionOrder"]
      },
      valueType: "game.cargo-wagon-order",
      access: "read-write"
    },
    "public.cards.cargo.currentWagonId": {
      audienceRef: "public",
      storage: {
        root: "public",
        segments: ["cards", "cargo", "currentWagonId"]
      },
      valueType: "core.optional-string",
      access: "read-write"
    },
    "public.cards.cargo.preparedTurn": {
      audienceRef: "public",
      storage: {
        root: "public",
        segments: ["cards", "cargo", "preparedTurn"]
      },
      valueType: "core.integer",
      access: "read-write"
    },
    "public.news.remaining": {
      audienceRef: "public",
      storage: { root: "public", segments: ["news", "remaining"] },
      valueType: "core.integer",
      access: "read-write"
    },
    "public.news.status": {
      audienceRef: "public",
      storage: { root: "public", segments: ["news", "status"] },
      valueType: "core.string",
      access: "read-write"
    },
    [activeNetworkClosureReasonEndpoint]: {
      audienceRef: "public",
      storage: {
        root: "public",
        segments: ["news", "activeNetworkClosureReason"]
      },
      valueType: "core.optional-string",
      access: "read-write"
    },
    "public.ruleModifiers.progressiveAssetTaxActive": {
      audienceRef: "public",
      storage: {
        root: "public",
        segments: ["ruleModifiers", "progressiveAssetTaxActive"]
      },
      valueType: "core.boolean",
      access: "read-write"
    },
    "public.turnEffects.vehicleAndCargoMaintenanceExempt": {
      audienceRef: "public",
      storage: {
        root: "public",
        segments: ["turnEffects", "vehicleAndCargoMaintenanceExempt"]
      },
      valueType: "core.boolean",
      access: "read-write"
    },
    "public.turnEffects.locomotiveMovementLevy": {
      audienceRef: "public",
      storage: {
        root: "public",
        segments: ["turnEffects", "locomotiveMovementLevy"]
      },
      valueType: "core.integer",
      access: "read-write"
    },
    "public.turnEffects.firstRoadFreeSegments": {
      audienceRef: "public",
      storage: {
        root: "public",
        segments: ["turnEffects", "firstRoadFreeSegments"]
      },
      valueType: "core.integer",
      access: "read-write"
    },
    "public.turnEffects.purchasePermissions.wagon": {
      audienceRef: "public",
      storage: {
        root: "public",
        segments: ["turnEffects", "purchasePermissions", "wagon"]
      },
      valueType: "core.boolean",
      access: "read-write"
    },
    "public.turnEffects.purchasePermissions.locomotive": {
      audienceRef: "public",
      storage: {
        root: "public",
        segments: ["turnEffects", "purchasePermissions", "locomotive"]
      },
      valueType: "core.boolean",
      access: "read-write"
    },
    "public.turnEffects.purchasePriceOverrides.wagon": {
      audienceRef: "public",
      storage: {
        root: "public",
        segments: ["turnEffects", "purchasePriceOverrides", "wagon"]
      },
      valueType: "core.optional-integer",
      access: "read-write"
    },
    "public.turnEffects.purchasePriceOverrides.locomotive": {
      audienceRef: "public",
      storage: {
        root: "public",
        segments: ["turnEffects", "purchasePriceOverrides", "locomotive"]
      },
      valueType: "core.optional-integer",
      access: "read-write"
    },
    "public.market.basePurchasePrices.wagon": {
      audienceRef: "public",
      storage: {
        root: "public",
        segments: ["market", "basePurchasePrices", "wagon"]
      },
      valueType: "core.integer",
      access: "read-write"
    },
    "public.market.basePurchasePrices.locomotive": {
      audienceRef: "public",
      storage: {
        root: "public",
        segments: ["market", "basePurchasePrices", "locomotive"]
      },
      valueType: "core.integer",
      access: "read-write"
    },
    "projection.public.cards": {
      audienceRef: "public",
      storage: { root: "public", segments: ["cards"] },
      valueType: "core.player-projection-json",
      access: "read-only",
      usage: "projection-only"
    },
    "projection.public.news": {
      audienceRef: "public",
      storage: { root: "public", segments: ["news"] },
      valueType: "core.player-projection-json",
      access: "read-only",
      usage: "projection-only"
    }
  });
  // Remove the former 23 concrete endpoint declarations when rebuilding a
  // previously materialized document, then publish one bounded endpoint.
  for (const endpointId of Object.keys(endpoints)) {
    if (
      endpointId.startsWith("public.cards.cargo.remaining.")
      && endpointId !== cargoRemainingEndpoint
    ) {
      delete endpoints[endpointId];
    }
  }
  endpoints[cargoRemainingEndpoint] = {
    audienceRef: "public",
    storage: {
      root: "public",
      segments: ["cards", "cargo", "remaining", { binding: "terminalId" }]
    },
    valueType: "core.integer",
    access: "read-write"
  };
  root.mechanics.stateModel.events["news.budget.fee.paid"] = {
    audienceRef: "public",
    payloadType: "game.news-budget-fee-event",
    journalEndpoint: { endpoint: "public.log" }
  };
  root.mechanics.stateModel.events["news.progressive-asset-tax.activated"] = {
    audienceRef: "public",
    payloadType: "game.news-progressive-asset-tax-activation-event",
    journalEndpoint: { endpoint: "public.log" }
  };
  root.mechanics.stateModel.events["news.government-road.applied"] = {
    audienceRef: "public",
    payloadType: "game.news-government-road-event",
    journalEndpoint: { endpoint: "public.log" }
  };

  // One initialization transaction and cargo-addition news may scan several
  // protected decks. The already accepted large turn-based budget covers that
  // bounded work without introducing a special operation.
  root.mechanics.budgetProfile = "turn-based-large-v1";

  const generated = [
    buildInitialization(),
    buildCargoQueuePrepare(),
    buildCargoDraw(),
    buildCargoSelect(),
    buildCargoSkip(),
    buildFirstTurnSkip(),
    buildNewsDraw(),
    buildNewsStagnation(),
    ...intake.newsRecords
      .filter((item) => item.number <= 10)
      .map((item) => buildCargoAdditionNews(item, cargoById)),
    ...intake.newsRecords
      .filter((item) => networkClosureNewsByNumber.has(item.number))
      .map((item) =>
        buildNetworkClosureNews(
          item,
          networkClosureNewsByNumber.get(item.number)
        )
      ),
    buildProgressiveAssetTaxNews(
      intake.newsRecords.find((item) => item.number === 14)
    ),
    buildBudgetFeeNews(
      intake.newsRecords.find((item) => item.number === 16)
    ),
    buildFirstRoadDiscountNews(
      intake.newsRecords.find((item) => item.number === 26)
    ),
    buildGovernmentRoadNews(
      intake.newsRecords.find((item) => item.number === 27)
    ),
    ...intake.newsRecords
      .filter((item) => scalarNewsEffectPatchesByNumber.has(item.number))
      .map((item) =>
        buildScalarNewsEffect(item, scalarNewsEffectPatchesByNumber.get(item.number))
      ),
  ];
  const preservedActions = root.logic.actions.filter(
    (candidate) => !ownsLifecycleAction(candidate)
  );
  const constructionActionIndex = preservedActions.findIndex(
    (candidate) => candidate.id.startsWith("construction.")
  );
  const actionInsertionIndex =
    constructionActionIndex === -1
      ? preservedActions.length
      : constructionActionIndex;
  root.logic.actions = [
    ...preservedActions.slice(0, actionInsertionIndex),
    ...generated.map((item) => item.action),
    ...preservedActions.slice(actionInsertionIndex)
  ];
  const preservedPlans = Object.entries(root.mechanics.plans).filter(
    ([planId]) => !ownsLifecyclePlan(planId)
  );
  const constructionPlanIndex = preservedPlans.findIndex(
    ([planId]) => planId.startsWith("construction.")
  );
  const planInsertionIndex =
    constructionPlanIndex === -1
      ? preservedPlans.length
      : constructionPlanIndex;
  root.mechanics.plans = Object.fromEntries([
    ...preservedPlans.slice(0, planInsertionIndex),
    ...generated.map((item) => [item.action.id, item.plan]),
    ...preservedPlans.slice(planInsertionIndex)
  ]);

  // Cargo settlement owns the surrounding facilitator step, while this
  // generator owns the offer actions inside it. Refresh only those references
  // so either generator order remains self-consistent and no removed
  // terminal-specific action id survives in a flow.
  const cargoOfferActionIds = [
    "cargo.queue.prepare",
    "cargo.offer.draw",
    "cargo.offer.select",
    "cargo.offer.skip"
  ];
  for (const flow of root.logic.flows) {
    for (const step of flow.steps) {
      if (
        !Array.isArray(step.actionIds) ||
        !step.actionIds.some(
          (actionId) =>
            actionId.startsWith("cargo.offer.")
            || actionId === "cargo.queue.prepare"
        )
      ) {
        continue;
      }
      step.actionIds = [
        ...cargoOfferActionIds,
        ...step.actionIds.filter(
          (actionId) =>
            !actionId.startsWith("cargo.offer.")
            && actionId !== "cargo.queue.prepare"
        )
      ];
    }
  }

  const board = root.state.public.board;
  assert.ok(
    Array.isArray(board?.availableActions),
    "public board availableActions must be an array"
  );
  /*
   * Publish every executable card/news intent to the ordinary facilitator
   * surface. Runtime's state-only availability projection keeps only the
   * currently relevant action visible; the browser never guesses which card
   * or phase is active.
   */
  const cardLifecycleBoardActions = generated.map(({ action: generatedAction }) => {
    const isInitialization = generatedAction.id === "cards.lifecycle.initialize";
    const isCargo = generatedAction.id.startsWith("cargo.");
    return {
      id: generatedAction.id.replaceAll(".", "-"),
      label: generatedAction.displayName,
      description: generatedAction._semantics,
      actionId: generatedAction.id,
      phase: isInitialization ? "setup" : isCargo ? "cargo" : "news",
      section: isInitialization ? "setup" : isCargo ? "cargo" : "news"
    };
  });
  const preservedBoardActions = board.availableActions.filter(
    (candidate) =>
      !lifecycleActionPrefixes.some((prefix) =>
        candidate.actionId?.startsWith(prefix)
      )
  );
  const setupBoardEnd = preservedBoardActions.findLastIndex(
    (candidate) => candidate.actionId.startsWith("session.setup.")
  ) + 1;
  board.availableActions = [
    ...preservedBoardActions.slice(0, setupBoardEnd),
    ...cardLifecycleBoardActions,
    ...preservedBoardActions.slice(setupBoardEnd)
  ];

  const facilitatorFlow = root.logic.flows.find((flow) => flow.id === "facilitator");
  assert.ok(facilitatorFlow, "facilitator flow is required");
  const preservedFlowSteps = facilitatorFlow.steps.filter(
    (step) => step.id !== newsFlowStepId
  );
  const operatingStepIndex = preservedFlowSteps.findIndex(
    (step) => step.id === "facilitator.operating-turn-start-maintenance"
  );
  const setupStepIndex = preservedFlowSteps.findIndex(
    (step) => step.id === "facilitator.setup"
  );
  const flowInsertionIndex =
    operatingStepIndex !== -1
      ? operatingStepIndex
      : setupStepIndex === -1
        ? 0
        : setupStepIndex + 1;
  const executableNewsActionIds = generated
    .map((item) => item.action.id)
    .filter(
      (actionId) =>
        (
          actionId.startsWith("news.lifecycle.") &&
          actionId !== "news.lifecycle.first-turn.skip"
        ) ||
        actionId.startsWith("news.cargo-addition.") ||
        actionId.startsWith("news.effect.")
    );
  facilitatorFlow.steps = [
    ...preservedFlowSteps.slice(0, flowInsertionIndex),
    {
      id: newsFlowStepId,
      _type: "game.Step",
      _label: "Новости",
      _semantics:
        "Ведущий открывает следующую одноразовую карту и применяет только уже формализованный серверный эффект.",
      screenId: "facilitator",
      actionIds: [
        ...executableNewsActionIds,
        "session.finish.request",
        "session.finish.confirm",
        "session.finish.cancel"
      ]
    },
    ...preservedFlowSteps.slice(flowInsertionIndex)
  ];

  root.content.data.cardLifecycle = {
    status: "partially-confirmed-executable-draft",
    publishable: false,
    sourceFixture: "authoring/fixtures/cargo-news.intake.json",
    physicalCargoCardCount: 174,
    baseCargoCardCount: 112,
    newsAddedCargoCardCount: 62,
    terminalDeckCount: 23,
    oneShotNewsCardCount: 34,
    executableCargoAdditionNewsNumbers: Array.from({ length: 10 }, (_, index) => index + 1),
    executableNetworkClosureNewsNumbers: [
      ...networkClosureNewsByNumber.keys()
    ],
    executableEconomicNewsNumbers: [14, 16, 22],
    executableConstructionNewsNumbers: [26, 27],
    executableScalarNewsNumbers: [...scalarNewsEffectPatchesByNumber.keys()],
    unresolvedRuleNewsNumbers: [19, 28, 29],
    invariants: [
      "one-source-row-is-one-physical-card",
      "future-order-is-server-only",
      "unchosen-card-returns-to-origin-deck",
      "chosen-and-delivered-card-never-returns",
      "one-server-queue-slot-per-active-empty-carrier-wagon-at-an-open-numbered-terminal",
      "cargo-priority-is-owner-money-then-total-active-owned-wagons",
      "cargo-owner-and-current-wagon-are-derived-only-from-the-saved-server-queue",
      "turn-one-has-no-news",
      "news-never-repeats",
      "depleted-news-deck-enters-stagnation",
      "cargo-addition-news-is-one-shot",
      "temporary-news-effects-reset-on-next-news-phase",
      "network-news-remove-only-their-own-blocking-reason",
      "network-objects-reopen-only-with-no-remaining-blocking-reasons",
      "news-21-current-draft-targets-only-terminals-5-and-7",
      "news-14-progressive-asset-tax-persists-until-game-end",
      "news-34-base-purchase-prices-persist-until-game-end"
    ],
    workingInterpretations: [
      "terminal-with-fewer-than-two-cards-skips-its-current-wagon-slot",
      "full-cargo-priority-tie-uses-deterministic-seeded-random-until-author-confirmation"
    ],
    cargoSelectionPriority: {
      status: "executable-with-two-explicit-technical-policies",
      queueSlot: "one-per-eligible-wagon",
      eligibility:
        "active empty logistics-company wagon at an open numbered terminal 1-23",
      ownerPriority: ["coins-descending", "active-owned-wagon-count-descending"],
      fullTiePolicy: "server-seeded-random:cargo-offer-order",
      clientAuthority: {
        prepare: [],
        draw: ["terminalId"],
        select: ["terminalId", "cargoId"],
        skip: ["terminalId"]
      }
    }
  };
  if (root.content.data.realOperatingTurnProof?.unresolved) {
    root.content.data.realOperatingTurnProof.unresolved =
      root.content.data.realOperatingTurnProof.unresolved.filter(
        (item) =>
          item !== "cargo-card-multiplicity" &&
          item !== "deck-lifecycle" &&
          item !== "news-on-first-turn"
      );
  }
  for (const record of root.content.data.realOperatingTurnProof?.cargoRecords ?? []) {
    // The proof used null while multiplicity awaited an author answer. It now
    // points to one of the same physical rows materialized in the full deck.
    record.runtimeCardMultiplicity = 1;
  }
  return authoring;
};

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

const buildFromDisk = async () => {
  const [sourceAuthoring, intake] = await Promise.all([
    readJson(authoringPath),
    readJson(intakePath)
  ]);
  await validateIntake(intake);
  return buildLifecycleAuthoring(sourceAuthoring, intake);
};

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
    throw new Error("usage: build-card-lifecycle.mjs [--check]");
  }
  const sourceText = await readFile(authoringPath, "utf8");
  const built = await buildFromDisk();
  const builtText = serialize(built);
  if (checkOnly) {
    assert.equal(sourceText, builtText, "card lifecycle authoring is stale; run build-card-lifecycle.mjs");
  } else {
    await writeAtomically(authoringPath, builtText);
  }
  process.stdout.write(
    `cards-money-trains: ${checkOnly ? "verified" : "built"} 174 cargo cards, 23 terminal decks and 34 news cards\n`
  );
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  run(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export {
  buildLifecycleAuthoring,
  buildFromDisk,
  intakePath,
  authoringPath,
  terminalIds
};
