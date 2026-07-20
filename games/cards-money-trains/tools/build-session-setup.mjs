#!/usr/bin/env node
/**
 * Build the bounded, game-local session setup for «Карты, деньги, поезда».
 *
 * The generator deliberately composes already accepted generic Mechanics
 * operations. It does not add a setup-specific runtime branch, publish the
 * review network, decide the unresolved even-team rule, or implement market
 * stock. Keeping this transformation separate from the card lifecycle gives
 * each generator one clear ownership boundary and prevents either import from
 * restoring the obsolete four-team record map.
 */

import assert from "node:assert/strict";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptFile = fileURLToPath(import.meta.url);
const toolsRoot = path.dirname(scriptFile);
const gameRoot = path.resolve(toolsRoot, "..");
const authoringPath = path.join(gameRoot, "authoring", "game.authoring.json");
const networkPath = path.join(gameRoot, "annotations", "initial-network.review.json");

const normalFixtureId = "normal-start-policy";
const setupActionPrefix = "session.setup.";
const lifecyclePrefixes = [
  // Setup must stay before the game-local playable-turn boundary. Treating
  // these prefixes as the next generated block keeps all independent
  // generators idempotent regardless of which one is checked last.
  "session.play.",
  "maintenance.",
  "movement.",
  "cards.lifecycle.",
  "cargo.queue.",
  "cargo.offer.",
  "news.lifecycle.",
  "news.cargo-addition.",
  "news.effect."
];
const supportedOddTeamCounts = [5, 7, 9, 11];
const contrastColorIds = [
  "cobalt",
  "orange",
  "emerald",
  "magenta",
  "cyan",
  "amber",
  "violet",
  "lime",
  "rose",
  "navy",
  "coral",
  "charcoal"
];
const setupTeamActionIds = [
  "session.setup.team.add.logistics-company",
  "session.setup.team.add.locomotive-guild"
];
const ownedSetupBoardActionIds = new Set([
  ...setupTeamActionIds,
  "session.setup.finalize",
  "session.setup.place.wagon",
  "session.setup.place.locomotive"
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
const compare = (operator, left, right) => ({
  op: "predicate.compare",
  operator,
  left,
  right
});
const all = (...items) => ({ op: "predicate.all", items });
const any = (...items) => ({ op: "predicate.any", items });
const not = (item) => ({ op: "predicate.not", item });

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

const setupGuard = () => all(
  compare("eq", state("public.session.fixtureId"), literal(normalFixtureId)),
  compare("eq", state("public.session.phase"), literal("setup"))
);

const boundedTeamParams = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: {
      type: "string",
      minLength: 1,
      maxLength: 80,
      pattern: ".*\\S.*"
    },
    colorId: {
      type: "string",
      maxLength: 32,
      enum: contrastColorIds
    }
  },
  required: ["name", "colorId"]
};

const teamEntity = (entityId) => ({
  collection: "teams",
  entityId
});

const assetRefSchema = (collection, objectType) => ({
  type: "string",
  maxLength: 128,
  "x-cubica-ref": {
    kind: "object",
    collection,
    network: "main",
    allowedTypes: [objectType],
    visibility: "public"
  }
});

const terminalRefSchema = {
  type: "string",
  maxLength: 128,
  "x-cubica-ref": {
    kind: "object",
    collection: "networkNodes",
    network: "main",
    allowedTypes: ["transport.terminal"],
    visibility: "public"
  }
};

const placementParams = (collection, objectType, parameterName) => ({
  type: "object",
  additionalProperties: false,
  properties: {
    [parameterName]: assetRefSchema(collection, objectType),
    stationId: terminalRefSchema
  },
  required: [parameterName, "stationId"]
});

const selectExistingTeamsForCapacity = () => ({
  id: "select-existing-teams",
  kind: "query",
  op: "core.entities.select",
  selector: {
    collection: "teams",
    // Eleven existing teams may receive the twelfth. Twelve existing teams
    // fail before any sequence or entity write can happen.
    cardinality: { min: 0, max: 11 }
  }
});

const selectUsedColor = () => ({
  id: "select-used-color",
  kind: "query",
  op: "core.entities.select",
  selector: {
    collection: "teams",
    attributes: {
      colorId: param("colorId")
    },
    cardinality: { min: 0, max: 1 }
  }
});

const assertUnusedColor = () => ({
  id: "assert-unused-color",
  kind: "assert",
  op: "core.assert",
  predicate: compare("eq", result("select-used-color", ["ids"]), literal([])),
  errorCode: "SESSION_SETUP_COLOR_ALREADY_USED"
});

const allocateId = (id, collection, sequenceEndpoint, prefix) => ({
  id,
  kind: "command",
  op: "core.collection.id.allocate",
  collection,
  sequence: { endpoint: sequenceEndpoint },
  prefix
});

const createTeamStep = (teamType) => ({
  id: "create-team",
  kind: "command",
  op: "core.entity.create",
  visibility: "public",
  collection: "teams",
  entityId: result("allocate-team-id", ["id"]),
  objectType: "game.team",
  facets: {
    placementStatus: literal("configured")
  },
  attributes: {
    label: param("name"),
    type: literal(teamType),
    colorId: param("colorId"),
    coins: literal(10),
    // A pledge is only a reversible agreement for the next construction
    // object. Money remains on the team until the construction transaction
    // validates the exact total and can create the object atomically.
    constructionPledge: literal(0),
    // A constant key intentionally creates one complete tie group. The named
    // seeded stream below then supplies the reproducible random order.
    placementOrderKey: literal(0),
    // News №14 rebuilds these neutral scratch counters from authoritative
    // active vehicles inside maintenance completion. Setup initializes them
    // because this is the only normal-session path that creates teams.
    progressiveTaxLocomotiveCount: literal(0),
    progressiveTaxWagonCount: literal(0)
  }
});

const createWagonStep = (idStep, createStep) => ({
  id: createStep,
  kind: "command",
  op: "core.entity.create",
  visibility: "public",
  collection: "wagons",
  entityId: result(idStep, ["id"]),
  objectType: "transport.wagon",
  facets: {
    availability: literal("reserve")
  },
  attributes: {
    networkId: literal("main"),
    nodeId: literal(null),
    ownerTeamId: result("allocate-team-id", ["id"]),
    attachedVehicleId: literal(null),
    cargoId: literal(null),
    // Turn zero means that the new asset has not yet been maintained in any
    // playable turn. The operating-turn generator owns the field contract,
    // while setup owns the only normal-session path that creates vehicles.
    maintenancePaidTurn: literal(0),
    // Cargo selection is server-queued per wagon. Explicit zero baselines
    // make a newly created reserve wagon ineligible until a cargo-phase
    // preparation transaction proves its terminal, owner and active status.
    cargoOfferEligibleTurn: literal(0),
    cargoOfferResolvedTurn: literal(0),
    cargoPriorityActiveCount: literal(0)
  }
});

const createLocomotiveStep = () => ({
  id: "create-locomotive",
  kind: "command",
  op: "core.entity.create",
  visibility: "public",
  collection: "locomotives",
  entityId: result("allocate-locomotive-id", ["id"]),
  objectType: "transport.locomotive",
  facets: {
    availability: literal("reserve")
  },
  attributes: {
    networkId: literal("main"),
    nodeId: literal(null),
    ownerTeamId: result("allocate-team-id", ["id"]),
    actionPoints: literal(5),
    // These two movement markers are explicit even while the locomotive is
    // still in reserve. The movement generator can therefore fail closed on
    // missing or stale markers instead of interpreting absence as zero.
    turnOrderCount: literal(0),
    movementResolvedTurn: literal(0),
    // News №22 charges only the first successful movement in a turn. Keeping
    // the last real movement turn on every dynamically created locomotive
    // makes repeated traversals replay-safe without a client-supplied flag.
    lastMovedTurn: literal(0),
    // See createWagonStep: setup must initialize every newly created asset so
    // a later maintenance selector never has to interpret a missing value.
    maintenancePaidTurn: literal(0)
  }
});

const incrementSetupCounts = (teamCountEndpoint) => ({
  id: "increment-setup-counts",
  kind: "command",
  op: "core.state.patch",
  patches: [
    {
      operation: "increment",
      target: { endpoint: "public.setup.teamCount" },
      value: literal(1)
    },
    {
      operation: "increment",
      target: { endpoint: teamCountEndpoint },
      value: literal(1)
    }
  ]
});

const buildAddLogisticsCompany = () => {
  const id = "session.setup.team.add.logistics-company";
  return {
    action: action({
      id,
      label: "Добавить компанию-перевозчика",
      semantics: "Атомарно создаёт команду с 10 монетами и двумя вагонами в резерве; цвет нельзя повторить.",
      paramsSchema: boundedTeamParams
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: setupGuard(),
            errorCode: "SESSION_SETUP_NOT_CONFIGURABLE"
          },
          selectExistingTeamsForCapacity(),
          selectUsedColor(),
          assertUnusedColor(),
          allocateId("allocate-team-id", "teams", "public.setup.teamSequence", "team"),
          createTeamStep("logistics_company"),
          allocateId("allocate-wagon-1-id", "wagons", "public.setup.assetSequence", "wagon"),
          createWagonStep("allocate-wagon-1-id", "create-wagon-1"),
          allocateId("allocate-wagon-2-id", "wagons", "public.setup.assetSequence", "wagon"),
          createWagonStep("allocate-wagon-2-id", "create-wagon-2"),
          incrementSetupCounts("public.setup.logisticsCompanyCount")
        ]
      }
    }
  };
};

const buildAddLocomotiveGuild = () => {
  const id = "session.setup.team.add.locomotive-guild";
  return {
    action: action({
      id,
      label: "Добавить паровозную гильдию",
      semantics: "Атомарно создаёт команду с 10 монетами и одним локомотивом в резерве; цвет нельзя повторить.",
      paramsSchema: boundedTeamParams
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: setupGuard(),
            errorCode: "SESSION_SETUP_NOT_CONFIGURABLE"
          },
          selectExistingTeamsForCapacity(),
          selectUsedColor(),
          assertUnusedColor(),
          allocateId("allocate-team-id", "teams", "public.setup.teamSequence", "team"),
          createTeamStep("locomotive_guild"),
          allocateId(
            "allocate-locomotive-id",
            "locomotives",
            "public.setup.assetSequence",
            "locomotive"
          ),
          createLocomotiveStep(),
          incrementSetupCounts("public.setup.locomotiveGuildCount")
        ]
      }
    }
  };
};

const buildFinalize = () => {
  const id = "session.setup.finalize";
  const supportedCount = any(...supportedOddTeamCounts.map((count) =>
    compare("eq", state("public.setup.teamCount"), literal(count))
  ));
  return {
    action: action({
      id,
      label: "Зафиксировать состав и порядок размещения",
      semantics: "Принимает только подтверждённые нечётные составы и создаёт воспроизводимую случайную очередь размещения."
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: all(
              setupGuard(),
              supportedCount,
              compare(
                "eq",
                state("public.setup.logisticsCompanyCount"),
                {
                  op: "number.add",
                  items: [
                    state("public.setup.locomotiveGuildCount"),
                    literal(1)
                  ]
                }
              )
            ),
            errorCode: "SESSION_SETUP_TEAM_COMPOSITION_UNCONFIRMED"
          },
          {
            id: "select-teams",
            kind: "query",
            op: "core.entities.select",
            selector: {
              collection: "teams",
              cardinality: { min: 5, max: 11 }
            }
          },
          {
            id: "order-teams",
            kind: "command",
            op: "core.entities.order",
            selection: result("select-teams"),
            keys: [{
              source: { kind: "current-field", field: "placementOrderKey" },
              direction: "ascending",
              missing: "error"
            }],
            tieBreak: {
              kind: "seeded-random",
              stream: "session-setup-placement-order"
            }
          },
          {
            id: "start-placement",
            kind: "command",
            op: "core.state.patch",
            patches: [
              {
                operation: "set",
                target: { endpoint: "public.setup.placementOrder" },
                value: result("order-teams", ["ids"])
              },
              {
                operation: "set",
                target: { endpoint: "public.setup.currentTeamId" },
                value: result("order-teams", ["ids", "0"])
              },
              {
                operation: "set",
                target: { endpoint: "public.setup.status" },
                value: literal("placement")
              },
              {
                operation: "set",
                target: { endpoint: "public.session.phase" },
                value: literal("setup-placement")
              }
            ]
          }
        ]
      }
    }
  };
};

const assetMatchesCurrentTeam = (collection, parameterName, objectType) => ({
  op: "predicate.entity.matches",
  entity: {
    collection,
    entityId: param(parameterName)
  },
  objectType,
  facets: {
    availability: literal("reserve")
  },
  attributes: {
    networkId: literal("main"),
    ownerTeamId: state("public.setup.currentTeamId")
  }
});

const stationIsOpenMainTerminal = () => ({
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

const completedCurrentTeam = () => all(
  compare("eq", result("remaining-current-wagons", ["ids"]), literal([])),
  compare("eq", result("remaining-current-locomotives", ["ids"]), literal([]))
);

/**
 * Common tail for wagon and locomotive placement.
 *
 * Every step observes the candidate transaction produced by earlier steps.
 * Therefore the last reserve asset marks the team placed, while any earlier
 * asset leaves the current team unchanged. The final team completes setup
 * instead of cycling back to the first entry.
 */
const placementAdvanceSteps = () => {
  const completed = completedCurrentTeam();
  const hasRemainingTeam = compare(
    "ne",
    result("remaining-unplaced-teams", ["ids"]),
    literal([])
  );
  return [
    {
      id: "remaining-current-wagons",
      kind: "query",
      op: "core.entities.select",
      selector: {
        collection: "wagons",
        facets: { availability: literal("reserve") },
        attributes: { ownerTeamId: state("public.setup.currentTeamId") },
        cardinality: { min: 0, max: 24 }
      }
    },
    {
      id: "remaining-current-locomotives",
      kind: "query",
      op: "core.entities.select",
      selector: {
        collection: "locomotives",
        facets: { availability: literal("reserve") },
        attributes: { ownerTeamId: state("public.setup.currentTeamId") },
        cardinality: { min: 0, max: 12 }
      }
    },
    {
      id: "mark-current-team-placed",
      kind: "command",
      op: "core.entity.facet.set",
      entity: teamEntity(state("public.setup.currentTeamId")),
      facet: "placementStatus",
      value: literal("placed"),
      when: completed
    },
    {
      id: "remaining-unplaced-teams",
      kind: "query",
      op: "core.entities.select",
      selector: {
        collection: "teams",
        facets: { placementStatus: literal("configured") },
        cardinality: { min: 0, max: 12 }
      }
    },
    {
      id: "next-team",
      kind: "query",
      op: "core.sequence.next",
      items: state("public.setup.placementOrder"),
      current: state("public.setup.currentTeamId"),
      exclude: {
        collection: "teams",
        field: "placementStatus",
        values: [literal("placed")]
      },
      when: all(completed, hasRemainingTeam)
    },
    {
      id: "advance-placement",
      kind: "command",
      op: "core.state.patch",
      patches: [{
        operation: "set",
        target: { endpoint: "public.setup.currentTeamId" },
        value: result("next-team")
      }],
      when: all(completed, hasRemainingTeam)
    },
    {
      id: "complete-placement",
      kind: "command",
      op: "core.state.patch",
      patches: [
        {
          operation: "set",
          target: { endpoint: "public.setup.currentTeamId" },
          value: literal("")
        },
        {
          operation: "set",
          target: { endpoint: "public.setup.status" },
          value: literal("complete")
        },
        {
          operation: "set",
          target: { endpoint: "public.session.phase" },
          value: literal("setup-complete")
        }
      ],
      when: all(completed, not(hasRemainingTeam))
    }
  ];
};

const buildPlaceWagon = () => {
  const id = "session.setup.place.wagon";
  return {
    action: action({
      id,
      label: "Разместить вагон текущей команды",
      semantics: "Ведущий размещает собственный резервный вагон текущей команды на открытом терминале технической сети.",
      paramsSchema: placementParams("wagons", "transport.wagon", "wagonId")
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
              compare("eq", state("public.session.phase"), literal("setup-placement")),
              assetMatchesCurrentTeam("wagons", "wagonId", "transport.wagon"),
              stationIsOpenMainTerminal()
            ),
            errorCode: "SESSION_SETUP_WAGON_PLACEMENT_REJECTED"
          },
          {
            id: "place-wagon-node",
            kind: "command",
            op: "core.entity.attributes.patch",
            entity: {
              collection: "wagons",
              entityId: param("wagonId")
            },
            patches: [{
              operation: "set",
              path: ["nodeId"],
              value: param("stationId")
            }]
          },
          {
            id: "activate-wagon",
            kind: "command",
            op: "core.entity.facet.set",
            entity: {
              collection: "wagons",
              entityId: param("wagonId")
            },
            facet: "availability",
            value: literal("active")
          },
          ...placementAdvanceSteps()
        ]
      }
    }
  };
};

const buildPlaceLocomotive = () => {
  const id = "session.setup.place.locomotive";
  return {
    action: action({
      id,
      label: "Разместить локомотив текущей команды",
      semantics: "Ведущий размещает резервный локомотив текущей гильдии и не может создать третий локомотив на одном терминале.",
      paramsSchema: placementParams(
        "locomotives",
        "transport.locomotive",
        "locomotiveId"
      )
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
              compare("eq", state("public.session.phase"), literal("setup-placement")),
              assetMatchesCurrentTeam(
                "locomotives",
                "locomotiveId",
                "transport.locomotive"
              ),
              stationIsOpenMainTerminal()
            ),
            errorCode: "SESSION_SETUP_LOCOMOTIVE_PLACEMENT_REJECTED"
          },
          {
            id: "select-existing-locomotives-at-station",
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
              // Zero or one existing locomotive is safe. Two existing
              // locomotives abort before the reserve asset is modified.
              cardinality: { min: 0, max: 1 }
            }
          },
          {
            id: "place-locomotive-node",
            kind: "command",
            op: "core.entity.attributes.patch",
            entity: {
              collection: "locomotives",
              entityId: param("locomotiveId")
            },
            patches: [{
              operation: "set",
              path: ["nodeId"],
              value: param("stationId")
            }, {
              // Placement and activation belong to one Mechanics transaction.
              // Marking the locomotive here prevents an active asset from
              // becoming invisible to the later fail-closed order selector.
              operation: "set",
              path: ["turnOrderCount"],
              value: literal(1)
            }]
          },
          {
            id: "activate-locomotive",
            kind: "command",
            op: "core.entity.facet.set",
            entity: {
              collection: "locomotives",
              entityId: param("locomotiveId")
            },
            facet: "availability",
            value: literal("active")
          },
          ...placementAdvanceSteps()
        ]
      }
    }
  };
};

const hasExecutableRoutePlan = (edge) => {
  const routePlan = edge?.attributes?.routePlan;
  return (
    routePlan?.mode === "region-segment-minimum" &&
    typeof routePlan.algorithmVersion === "string" &&
    typeof routePlan.geometryVersion === "string" &&
    typeof routePlan.geometryHash === "string" &&
    typeof routePlan.boundaryPolicy === "string" &&
    Array.isArray(routePlan.regionSequence) &&
    Array.isArray(routePlan.passages) &&
    routePlan.tieBreak !== null &&
    typeof routePlan.tieBreak === "object"
  );
};

const buildNetworkObjects = (
  network,
  existingNetworkEdges = {},
  existingNetworkNodes = {}
) => {
  assert.equal(network.status, "review-draft");
  assert.equal(network.regions.length, 0);
  const positions = new Map(network.nodes.map((node) => [node.id, node.position]));
  const networkNodes = Object.fromEntries(network.nodes.map((node) => {
    const existingCountryId =
      existingNetworkNodes[node.id]?.attributes?.countryId;
    const hasCountryLink =
      existingCountryId === null || typeof existingCountryId === "string";
    return [
      node.id,
      {
        objectType: node.kind === "waypoint"
          ? "transport.waypoint"
          : "transport.terminal",
        facets: {
          availability: node.state
        },
        attributes: {
          label: node.label,
          networkId: "main",
          position: node.position,
          cargoDeckId:
            node.kind !== "waypoint"
            && /^terminal-(?:[1-9]|1[0-9]|2[0-3])$/u.test(node.id)
              ? node.id
              : null,
          createdTurn: 0,
          activationTurn: 0,
          blockingReasons: [],
          // Country content is owned by a later game-local generator. Preserve
          // its short confirmed reference when setup rebuilds review geometry;
          // never infer one here from unreviewed vector polygons. Keeping this
          // after the setup-owned fields matches the later generator's stable
          // serialization order.
          ...(hasCountryLink ? { countryId: existingCountryId } : {})
        }
      }
    ];
  }));
  const networkEdges = Object.fromEntries(network.edges.map((edge) => {
    const from = positions.get(edge.fromNodeId);
    const to = positions.get(edge.toNodeId);
    assert.ok(from && to, `edge ${edge.id} references an unknown endpoint`);
    const existingEdge = existingNetworkEdges[edge.id];
    const mayPreserveExecutableGeometry =
      existingEdge?.attributes?.networkId === "main" &&
      existingEdge.attributes.fromNodeId === edge.fromNodeId &&
      existingEdge.attributes.toNodeId === edge.toNodeId &&
      hasExecutableRoutePlan(existingEdge);
    return [
      edge.id,
      {
        objectType: "transport.edge",
        facets: {
          state: edge.state
        },
        attributes: {
          networkId: "main",
          fromNodeId: edge.fromNodeId,
          toNodeId: edge.toNodeId,
          geometry: mayPreserveExecutableGeometry
            ? existingEdge.attributes.geometry
            : {
                from,
                to,
                polyline: [from, to]
              },
          constructionCost: 0,
          regionSegments: mayPreserveExecutableGeometry
            ? existingEdge.attributes.regionSegments
            : 0,
          routePlan: mayPreserveExecutableGeometry
            ? existingEdge.attributes.routePlan
            : {
                source: "technical-initial-network-review",
                geometryStatus: "awaiting-author-overlay-confirmation"
              },
          splitFromEdgeId: "",
          createdTurn: 0,
          activationTurn: 0,
          blockingReasons: []
        }
      }
    ];
  }));
  return { networkNodes, networkEdges };
};

const setProjectionEndpoint = (endpoints, endpointId, segments) => {
  endpoints[endpointId] = {
    audienceRef: "public",
    storage: { root: "public", segments },
    valueType: "core.player-projection-json",
    access: "read-only",
    usage: "projection-only"
  };
};

const addEndpoint = (endpoints, endpointId, segments, valueType, access = "read-write") => {
  endpoints[endpointId] = {
    audienceRef: "public",
    storage: { root: "public", segments },
    valueType,
    access
  };
};

const removeObsoleteFixedConstruction = (root) => {
  for (const endpointId of Object.keys(root.mechanics.stateModel.endpoints)) {
    // Historical authoring exposed one concrete endpoint per fixed team.
    // Dynamic `bound` endpoints are the accepted replacement and may be added
    // by construction, maintenance or later game-local slices, so rebuilding
    // setup must preserve every member of that namespace.
    if (
      endpointId.startsWith("public.teams.")
      && !endpointId.startsWith("public.teams.bound.")
    ) {
      delete root.mechanics.stateModel.endpoints[endpointId];
    }
  }
  delete root.mechanics.macros["cmt.construction.road"];
  delete root.mechanics.macros["cmt.construction.waypoint"];
  const constructionActionIds = new Set([
    "construction.road.build",
    "construction.waypoint.build"
  ]);
  const hasFixedContributionParameters = (candidate) =>
    constructionActionIds.has(candidate.id)
    && Object.keys(candidate.paramsSchema?.properties ?? {})
      .some((property) => property.endsWith("Contribution"));

  // Setup may be regenerated after the dynamic construction slice. Remove
  // only the historical fixed-four-team contracts, never the new bounded
  // team-entity actions owned by build-construction-cycle.mjs.
  const removedFixedIds = new Set(
    [...(root.logic.actions ?? []), ...(root.logic.pendingActions ?? [])]
      .filter(hasFixedContributionParameters)
      .map((candidate) => candidate.id)
  );
  root.logic.actions = (root.logic.actions ?? []).filter(
    (candidate) => !removedFixedIds.has(candidate.id)
  );
  root.logic.pendingActions = (root.logic.pendingActions ?? []).filter(
    (candidate) => !removedFixedIds.has(candidate.id)
  );
  for (const actionId of removedFixedIds) {
    delete root.mechanics.plans[actionId];
  }

  if (
    !root.logic.actions.some((candidate) => constructionActionIds.has(candidate.id))
  ) {
    root.content.data.constructionActionIntent = {
      status: "blocked-until-dynamic-team-contributions-and-network-publication",
      road: {
        actionId: "construction.road.build",
        endpointReferenceSemantics: "schema-declared object references",
        payments: "dynamic per-team contribution workflow is outside this setup slice"
      },
      waypoint: {
        actionId: "construction.waypoint.build",
        endpointReferenceSemantics: "schema-declared object references",
        position: "number strictly between 0 and 1",
        payments: "dynamic per-team contribution workflow is outside this setup slice"
      }
    };
  }
};

/**
 * Apply only the setup-owned transformation.
 *
 * The input is cloned so focused tests can prove idempotence without touching
 * the checked-in authoring file.
 */
const buildSessionSetupAuthoring = (sourceAuthoring, network) => {
  const authoring = structuredClone(sourceAuthoring);
  const root = authoring.root;
  const { networkNodes, networkEdges } = buildNetworkObjects(
    network,
    root.state.public.objects?.networkEdges,
    root.state.public.objects?.networkNodes
  );

  root.objectTypes["game.team"] = {
    _type: "game.ObjectType",
    _label: "Команда",
    _semantics: "Динамическая команда одной сессии; тип определяет стартовую технику и допустимые рыночные действия.",
    collection: "teams",
    idField: "id",
    scope: "session",
    facets: {
      placementStatus: {
        initial: "configured",
        values: {
          configured: { visible: true, interactive: true },
          placed: { visible: true, interactive: false }
        }
      }
    }
  };

  root.state.public.setup = {
    status: "configuration",
    teamSequence: 0,
    assetSequence: 0,
    teamCount: 0,
    logisticsCompanyCount: 0,
    locomotiveGuildCount: 0,
    placementOrder: [],
    currentTeamId: ""
  };
  delete root.state.public.teams;
  root.state.public.objects = {
    ...root.state.public.objects,
    networkNodes,
    networkEdges,
    teams: {},
    locomotives: {},
    wagons: {}
  };

  const types = root.mechanics.stateModel.types;
  Object.assign(types, {
    "game.team-type": {
      kind: "enum",
      values: ["logistics_company", "locomotive_guild"]
    },
    "game.team-color": {
      kind: "enum",
      values: contrastColorIds
    },
    "game.team-placement-status": {
      kind: "enum",
      values: ["configured", "placed"]
    },
    "game.session-setup-status": {
      kind: "enum",
      values: ["configuration", "placement", "complete"]
    },
    "game.session-setup-order": {
      kind: "list",
      itemType: "core.string",
      maxItems: 12
    },
    // Setup writes the binary active-order marker during placement. Declaring
    // its narrow type here keeps this generator valid even when it is applied
    // before the movement generator that preserves the same contract.
    "game.turn-order-count": {
      kind: "integer",
      minimum: 0,
      maximum: 1
    },
    "game.binary-count": {
      kind: "integer",
      minimum: 0,
      maximum: 1
    }
  });

  const collections = root.mechanics.stateModel.collections;
  collections.teams = {
    audienceRef: "public",
    storage: {
      root: "public",
      segments: ["objects", "teams"]
    },
    capacity: 12,
    stableKey: "map-key",
    itemTypes: ["game.team"],
    fields: {
      label: {
        storage: { kind: "attribute", name: "label" },
        valueType: "core.string",
        access: "read-only"
      },
      type: {
        storage: { kind: "attribute", name: "type" },
        valueType: "game.team-type",
        access: "read-only"
      },
      colorId: {
        storage: { kind: "attribute", name: "colorId" },
        // The action schema constrains the public palette. Mechanics sees a
        // bounded string parameter and therefore stores the same neutral type.
        valueType: "core.string",
        access: "read-only"
      },
      placementStatus: {
        storage: { kind: "facet", name: "placementStatus" },
        valueType: "game.team-placement-status",
        access: "read-write"
      },
      coins: {
        storage: { kind: "attribute", name: "coins" },
        valueType: "core.integer",
        access: "read-write"
      },
      constructionPledge: {
        storage: { kind: "attribute", name: "constructionPledge" },
        valueType: "core.integer",
        access: "read-write"
      },
      placementOrderKey: {
        storage: { kind: "attribute", name: "placementOrderKey" },
        valueType: "core.integer",
        access: "read-only"
      },
      progressiveTaxLocomotiveCount: {
        storage: {
          kind: "attribute",
          name: "progressiveTaxLocomotiveCount"
        },
        valueType: "core.integer",
        access: "read-write"
      },
      progressiveTaxWagonCount: {
        storage: {
          kind: "attribute",
          name: "progressiveTaxWagonCount"
        },
        valueType: "core.integer",
        access: "read-write"
      }
    }
  };
  collections.networkNodes.fields.label = {
    storage: { kind: "attribute", name: "label" },
    valueType: "core.string",
    access: "read-only"
  };
  collections.networkNodes.fields.cargoDeckId = {
    storage: { kind: "attribute", name: "cargoDeckId" },
    valueType: "core.optional-string",
    access: "read-only"
  };
  // Reserve assets have no board location. Optional location remains safe for
  // graph movement because only the active facet is traversable or capacity-
  // occupying, and placement writes a real terminal before activation.
  collections.locomotives.fields.nodeId.valueType = "core.optional-string";
  collections.wagons.fields.nodeId.valueType = "core.optional-string";
  collections.wagons.fields.cargoOfferEligibleTurn = {
    storage: { kind: "attribute", name: "cargoOfferEligibleTurn" },
    valueType: "core.integer",
    access: "read-write"
  };
  collections.wagons.fields.cargoOfferResolvedTurn = {
    storage: { kind: "attribute", name: "cargoOfferResolvedTurn" },
    valueType: "core.integer",
    access: "read-write"
  };
  collections.wagons.fields.cargoPriorityActiveCount = {
    storage: { kind: "attribute", name: "cargoPriorityActiveCount" },
    valueType: "game.binary-count",
    access: "read-write"
  };
  // Setup owns locomotive creation and placement, so it also preserves the
  // movement generator's explicit markers when generators run in any order.
  collections.locomotives.fields.turnOrderCount = {
    storage: { kind: "attribute", name: "turnOrderCount" },
    valueType: "game.turn-order-count",
    access: "read-write"
  };
  collections.locomotives.fields.movementResolvedTurn = {
    storage: { kind: "attribute", name: "movementResolvedTurn" },
    valueType: "core.integer",
    access: "read-write"
  };
  collections.locomotives.fields.lastMovedTurn = {
    storage: { kind: "attribute", name: "lastMovedTurn" },
    valueType: "core.integer",
    access: "read-write"
  };

  const endpoints = root.mechanics.stateModel.endpoints;
  endpoints["public.teams.bound.coins"] = {
    audienceRef: "public",
    storage: {
      root: "public",
      segments: [
        "objects",
        "teams",
        { binding: "teamId" },
        "attributes",
        "coins"
      ]
    },
    valueType: "core.integer",
    access: "read-write"
  };
  addEndpoint(endpoints, "public.setup.status", ["setup", "status"], "game.session-setup-status");
  addEndpoint(endpoints, "public.setup.teamSequence", ["setup", "teamSequence"], "core.integer");
  addEndpoint(endpoints, "public.setup.assetSequence", ["setup", "assetSequence"], "core.integer");
  addEndpoint(endpoints, "public.setup.teamCount", ["setup", "teamCount"], "core.integer");
  addEndpoint(
    endpoints,
    "public.setup.logisticsCompanyCount",
    ["setup", "logisticsCompanyCount"],
    "core.integer"
  );
  addEndpoint(
    endpoints,
    "public.setup.locomotiveGuildCount",
    ["setup", "locomotiveGuildCount"],
    "core.integer"
  );
  addEndpoint(
    endpoints,
    "public.setup.placementOrder",
    ["setup", "placementOrder"],
    "game.session-setup-order"
  );
  addEndpoint(
    endpoints,
    "public.setup.currentTeamId",
    ["setup", "currentTeamId"],
    "core.string"
  );
  setProjectionEndpoint(endpoints, "projection.public.setup", ["setup"]);
  setProjectionEndpoint(endpoints, "projection.public.teams", ["objects", "teams"]);

  removeObsoleteFixedConstruction(root);

  const generated = [
    buildAddLogisticsCompany(),
    buildAddLocomotiveGuild(),
    buildFinalize(),
    buildPlaceWagon(),
    buildPlaceLocomotive()
  ];
  if (root.content.data.trainFormation) {
    // The later formation slice owns this persisted marker. When setup is
    // regenerated over a completed authoring document, preserve it on the only
    // normal-session wagon creation path instead of erasing that extension.
    for (const generatedPlan of generated.map((item) => item.plan)) {
      for (const step of generatedPlan.transaction.steps) {
        if (step.op === "core.entity.create" && step.collection === "wagons") {
          step.attributes.formationTargetLocomotiveId = literal(null);
        }
      }
    }
  }
  const preservedActions = root.logic.actions.filter(
    (candidate) => !candidate.id.startsWith(setupActionPrefix)
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
    ([planId]) => !planId.startsWith(setupActionPrefix)
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
  /*
   * Advertise the complete setup lifecycle. The player plugin supplies
   * accessible input fields from public objects, while Runtime remains the
   * authority for order, station capacity, ownership and final readiness.
   */
  const existingSetupIndex = board.availableActions.findIndex(
    (candidate) => ownedSetupBoardActionIds.has(candidate.actionId)
  );
  const preservedBoardActions = board.availableActions.filter(
    (candidate) => !ownedSetupBoardActionIds.has(candidate.actionId)
  );
  const setupInsertionIndex =
    existingSetupIndex === -1
      ? 0
      : Math.min(existingSetupIndex, preservedBoardActions.length);
  board.availableActions = [
    ...preservedBoardActions.slice(0, setupInsertionIndex),
    {
      id: "setup-add-logistics-company",
      label: "Добавить компанию-перевозчика",
      actionId: setupTeamActionIds[0],
      phase: "setup",
      section: "setup"
    },
    {
      id: "setup-add-locomotive-guild",
      label: "Добавить паровозную гильдию",
      actionId: setupTeamActionIds[1],
      phase: "setup",
      section: "setup"
    },
    {
      id: "setup-finalize",
      label: "Зафиксировать команды и очередь расстановки",
      description:
        "Проверяет подтверждённый состав команд, создаёт стартовую технику и случайно определяет очередь её расстановки.",
      actionId: "session.setup.finalize",
      phase: "setup",
      section: "setup"
    },
    {
      id: "setup-place-wagon",
      label: "Разместить вагон",
      description:
        "Выберите вагон текущей команды и станцию; сервер проверит очередь и вместимость.",
      actionId: "session.setup.place.wagon",
      phase: "setup",
      section: "setup"
    },
    {
      id: "setup-place-locomotive",
      label: "Разместить локомотив",
      description:
        "Выберите локомотив текущей команды и станцию; сервер проверит очередь и ограничение на локомотивы.",
      actionId: "session.setup.place.locomotive",
      phase: "setup",
      section: "setup"
    },
    ...preservedBoardActions.slice(setupInsertionIndex)
  ];

  const setupStep = root.logic.flows
    .flatMap((flow) => flow.steps)
    .find((step) => step.id === "facilitator.setup");
  if (setupStep) {
    setupStep._semantics =
      "Ведущий создаёт подтверждённый нечётный состав, фиксирует случайную очередь и размещает всю стартовую технику.";
    setupStep.actionIds = [
      ...generated.map((item) => item.action.id),
      ...setupStep.actionIds.filter((actionId) => !actionId.startsWith(setupActionPrefix))
    ];
  }

  root.content.data.rules.teams.supportedOddCounts = supportedOddTeamCounts;
  root.content.data.rules.teams.oddComposition =
    "logistics_company_count = locomotive_guild_count + 1";
  root.content.data.rules.teams.contrastColorIds = contrastColorIds;
  root.content.data.sessionSetup = {
    status: "executable-technical-draft",
    publishable: false,
    sourceNetwork: "annotations/initial-network.review.json",
    networkUse: "technical placement only until author overlay confirmation",
    supportedTeamCounts: supportedOddTeamCounts,
    initialResources: {
      coinsPerTeam: 10,
      logisticsCompany: { wagons: 2, locomotives: 0 },
      locomotiveGuild: { wagons: 0, locomotives: 1 }
    },
    placement: {
      order: "server-seeded-random",
      controller: "facilitator",
      targets: "open terminals in the main technical network",
      maximumLocomotivesPerTerminal: 2,
      advancesOnlyAfterAllCurrentTeamAssetsArePlaced: true
    },
    unresolved: [
      "R-28-even-team-composition",
      "R-26-finite-market-stock-or-explicit-no-extra-limit",
      "dynamic-team-construction-contributions",
      "author-confirmation-of-initial-network-overlay"
    ]
  };
  if (root.content.data.realOperatingTurnProof?.unresolved) {
    root.content.data.realOperatingTurnProof.unresolved =
      root.content.data.realOperatingTurnProof.unresolved.filter(
        (item) =>
          item !== "normal-team-configuration" &&
          item !== "initial-vehicle-placement"
      );
  }

  const blockers = new Set(root.config.runtimeBlockers);
  blockers.delete("team configuration and initial transport assets");
  blockers.delete("accessible free-text team-name entry");
  blockers.add("R-28 even-team composition");
  blockers.add("R-26 finite market stock or explicit no-extra-limit confirmation");
  root.config.runtimeBlockers = [...blockers];
  root.config.runtimeReady = false;

  return authoring;
};

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

const buildFromDisk = async () => {
  const [sourceAuthoring, network] = await Promise.all([
    readJson(authoringPath),
    readJson(networkPath)
  ]);
  return buildSessionSetupAuthoring(sourceAuthoring, network);
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
    throw new Error("usage: build-session-setup.mjs [--check]");
  }
  const sourceText = await readFile(authoringPath, "utf8");
  const builtText = serialize(await buildFromDisk());
  if (checkOnly) {
    assert.equal(
      sourceText,
      builtText,
      "session setup authoring is stale; run build-session-setup.mjs"
    );
  } else {
    await writeAtomically(authoringPath, builtText);
  }
  process.stdout.write(
    `cards-money-trains: ${checkOnly ? "verified" : "built"} bounded odd-team session setup\n`
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
  buildSessionSetupAuthoring,
  contrastColorIds,
  networkPath,
  supportedOddTeamCounts
};
