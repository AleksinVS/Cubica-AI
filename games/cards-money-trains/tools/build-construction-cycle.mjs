#!/usr/bin/env node
/**
 * Build the normal-session construction cycle for «Карты, деньги, поезда».
 *
 * This game-local generator composes only accepted, generic Mechanics
 * operations: bounded entity selection/iteration, arithmetic, resource
 * transfer, graph planning/splitting, state patches and events. The temporary
 * vertical regions below are explicitly non-publishable test data. They prove
 * the workflow while the author's exact closed region contours remain the
 * publication gate.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptFile = fileURLToPath(import.meta.url);
const toolsRoot = path.dirname(scriptFile);
const gameRoot = path.resolve(toolsRoot, "..");
const authoringPath = path.join(gameRoot, "authoring", "game.authoring.json");

const normalFixtureId = "normal-start-policy";
const constructionActionPrefix = "construction.";
const constructionFlowStepId = "facilitator.construction";
const ownedBoardActionIds = new Set([
  "construction-contribution-set",
  "construction-mode-road",
  "construction-mode-waypoint",
  "construction-road-build",
  "construction-waypoint-build",
  "construction-phase-finish"
]);
const technicalRegionCount = 20;
const boardWidth = 5079;
const boardHeight = 3627;
const constructionPendingReason = "construction-pending";

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));
const literal = (value) => ({ op: "value.literal", value });
const param = (name) => ({ op: "value.param", name });
const state = (endpoint, bindings) => ({
  op: "value.state",
  ref: { endpoint, ...(bindings ? { bindings } : {}) }
});
const result = (stepId, resultPath) => ({
  op: "value.result",
  stepId,
  ...(resultPath ? { path: resultPath } : {})
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
const arithmetic = (op, ...items) => ({ op, items });
const compare = (operator, left, right) => ({
  op: "predicate.compare",
  operator,
  left,
  right
});
const all = (...items) => ({ op: "predicate.all", items });

const noParamsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
  required: []
};

const teamReferenceSchema = {
  type: "string",
  maxLength: 128,
  "x-cubica-ref": {
    kind: "object",
    collection: "teams",
    allowedTypes: ["game.team"],
    visibility: "public"
  }
};

const nodeReferenceSchema = {
  type: "string",
  maxLength: 128,
  "x-cubica-ref": {
    kind: "object",
    collection: "networkNodes",
    network: "main",
    allowedTypes: ["transport.terminal", "transport.waypoint"],
    visibility: "public"
  }
};

const edgeReferenceSchema = {
  type: "string",
  maxLength: 128,
  "x-cubica-ref": {
    kind: "object",
    collection: "networkEdges",
    network: "main",
    allowedTypes: ["transport.edge"],
    visibility: "public"
  }
};

const contributionParamsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    teamId: teamReferenceSchema,
    amount: {
      type: "integer",
      minimum: 0,
      maximum: 1_000_000_000
    }
  },
  required: ["teamId", "amount"]
};

const roadParamsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    fromNodeId: nodeReferenceSchema,
    toNodeId: nodeReferenceSchema
  },
  required: ["fromNodeId", "toNodeId"]
};

const waypointParamsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    edgeId: edgeReferenceSchema,
    positionT: {
      type: "number",
      exclusiveMinimum: 0,
      exclusiveMaximum: 1
    }
  },
  required: ["edgeId", "positionT"]
};

const action = ({ id, label, semantics, paramsSchema = noParamsSchema }) => ({
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

const constructionGuard = (mode) => all(
  compare("eq", state("public.session.fixtureId"), literal(normalFixtureId)),
  compare("eq", state("public.session.phase"), literal("construction")),
  compare("eq", state("public.construction.available"), literal(true)),
  ...(mode
    ? [compare("eq", state("public.construction.mode"), literal(mode))]
    : [])
);

const setStateExpressions = (id, patches, when) => ({
  id,
  kind: "command",
  op: "core.state.patch",
  patches: patches.map(([endpoint, value]) => ({
    operation: "set",
    target: { endpoint },
    value
  })),
  ...(when ? { when } : {})
});

const selectAllTeams = (id, attributes) => ({
  id,
  kind: "query",
  op: "core.entities.select",
  selector: {
    collection: "teams",
    objectTypes: ["game.team"],
    ...(attributes ? { attributes } : {}),
    cardinality: { min: 0, max: 12 }
  }
});

const clearSelectedPledges = (selectionStepId, id = "clear-pledges") => ({
  id,
  kind: "command",
  op: "core.entities.update",
  selection: result(selectionStepId),
  attributeValues: {
    constructionPledge: literal(0)
  }
});

const transferSelectedPledges = (selectionStepId) => ({
  id: "collect-pledges",
  kind: "command",
  op: "core.entities.each",
  selection: result(selectionStepId),
  body: [
    {
      id: "collect-team-pledge",
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
      amount: itemAttribute("constructionPledge"),
      onInsufficient: "fail"
    }
  ]
});

const buildContributionSet = () => {
  const id = "construction.contribution.set";
  const teamId = param("teamId");
  const amount = param("amount");
  const oldAmount = entityValue("teams", teamId, "constructionPledge");
  return {
    action: action({
      id,
      label: "Установить вклад команды",
      semantics:
        "Сохраняет предварительный вклад выбранной команды без списания денег и пересчитывает общую сумму соглашения.",
      paramsSchema: contributionParamsSchema
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: all(
              constructionGuard(),
              {
                op: "predicate.entity.matches",
                entity: { collection: "teams", entityId: teamId },
                objectType: "game.team"
              }
            ),
            errorCode: "CONSTRUCTION_CONTRIBUTION_UNAVAILABLE"
          },
          setStateExpressions("update-total", [
            [
              "public.construction.totalPledged",
              arithmetic(
                "number.add",
                arithmetic(
                  "number.subtract",
                  state("public.construction.totalPledged"),
                  oldAmount
                ),
                amount
              )
            ]
          ]),
          {
            id: "update-team-pledge",
            kind: "command",
            op: "core.entity.attributes.patch",
            entity: { collection: "teams", entityId: teamId },
            patches: [{
              operation: "set",
              path: ["constructionPledge"],
              value: amount
            }]
          },
          {
            id: "journal",
            kind: "command",
            op: "core.event.emit",
            eventType: "construction.contribution.updated",
            summary: literal("Ведущий обновил предварительный вклад команды"),
            audience: "public",
            data: {
              kind: literal("construction-contribution"),
              teamId,
              amount,
              totalPledged: state("public.construction.totalPledged"),
              turnNumber: state("public.session.turnNumber")
            }
          }
        ]
      }
    }
  };
};

const buildMode = (mode, label) => {
  const id = `construction.mode.${mode}`;
  return {
    action: action({
      id,
      label,
      semantics:
        `Выбирает режим ${mode === "road" ? "дороги" : "полустанка"} без оплаты и без завершения строительной фазы.`
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: constructionGuard(),
            errorCode: "CONSTRUCTION_MODE_UNAVAILABLE"
          },
          setStateExpressions("set-mode", [
            ["public.construction.mode", literal(mode)]
          ])
        ]
      }
    }
  };
};

const roadExpressions = () => {
  const baseSegments = result("route", ["regionSegments"]);
  const discountedSegments = arithmetic(
    "number.min",
    baseSegments,
    state("public.turnEffects.firstRoadFreeSegments")
  );
  const payableSegments = arithmetic(
    "number.max",
    arithmetic("number.subtract", baseSegments, discountedSegments),
    literal(0)
  );
  return {
    baseSegments,
    discountedSegments,
    payableSegments,
    constructionCost: arithmetic(
      "number.multiply",
      payableSegments,
      literal(2)
    )
  };
};

const buildRoad = () => {
  const id = "construction.road.build";
  const fromNodeId = param("fromNodeId");
  const toNodeId = param("toNodeId");
  const cost = roadExpressions();
  return {
    action: action({
      id,
      label: "Построить дорогу",
      semantics:
        "Сервер выбирает минимальный региональный маршрут, проверяет точное общее финансирование и атомарно списывает все вклады и создаёт закрытую до N+2 дорогу.",
      paramsSchema: roadParamsSchema
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: constructionGuard("road"),
            errorCode: "CONSTRUCTION_ROAD_UNAVAILABLE"
          },
          {
            id: "route",
            kind: "command",
            op: "graph.regions.route.plan",
            networkId: "main",
            fromNode: fromNodeId,
            toNode: toNodeId
          },
          {
            id: "exact-cost",
            kind: "assert",
            op: "core.assert",
            predicate: compare(
              "eq",
              state("public.construction.totalPledged"),
              cost.constructionCost
            ),
            errorCode: "CONSTRUCTION_COST_MISMATCH"
          },
          selectAllTeams("contributing-teams", {
            constructionPledge: {
              operator: "gt",
              value: literal(0)
            }
          }),
          transferSelectedPledges("contributing-teams"),
          {
            id: "allocate-edge-id",
            kind: "command",
            op: "core.collection.id.allocate",
            collection: "networkEdges",
            sequence: { endpoint: "public.transportNetworks.main.sequence" },
            prefix: "main:edge"
          },
          {
            id: "create-edge",
            kind: "command",
            op: "core.entity.create",
            visibility: "public",
            collection: "networkEdges",
            entityId: result("allocate-edge-id", ["id"]),
            objectType: "transport.edge",
            facets: {
              state: literal("building")
            },
            attributes: {
              networkId: literal("main"),
              fromNodeId: result("route", ["fromNodeId"]),
              toNodeId: result("route", ["toNodeId"]),
              geometry: result("route", ["geometry"]),
              constructionCost: cost.constructionCost,
              regionSegments: cost.baseSegments,
              discountedRegionSegments: cost.discountedSegments,
              payableRegionSegments: cost.payableSegments,
              routePlan: result("route", ["routePlan"]),
              splitFromEdgeId: literal(""),
              createdTurn: state("public.session.turnNumber"),
              activationTurn: arithmetic(
                "number.add",
                state("public.session.turnNumber"),
                literal(2)
              ),
              blockingReasons: literal([constructionPendingReason])
            }
          },
          ...[
            result("route", ["fromNodeId"]),
            result("route", ["toNodeId"])
          ].flatMap((nodeId, index) => [
            {
              id: `block-endpoint-${index + 1}`,
              kind: "command",
              op: "core.entity.facet.set",
              entity: {
                collection: "networkNodes",
                entityId: nodeId
              },
              facet: "availability",
              // `building` remains a valid endpoint for another project in
              // this phase, but every movement/cargo graph guard treats it as
              // closed. This is what permits overlapping projects without
              // making the station operational.
              value: literal("building")
            },
            {
              id: `extend-endpoint-${index + 1}-closure`,
              kind: "command",
              op: "core.entity.attributes.patch",
              entity: {
                collection: "networkNodes",
                entityId: nodeId
              },
              patches: [
                {
                  operation: "set",
                  path: ["activationTurn"],
                  value: arithmetic(
                    "number.max",
                    entityValue("networkNodes", nodeId, "activationTurn"),
                    arithmetic(
                      "number.add",
                      state("public.session.turnNumber"),
                      literal(2)
                    )
                  )
                },
                {
                  operation: "set-add",
                  path: ["blockingReasons"],
                  value: literal(constructionPendingReason)
                }
              ]
            }
          ]),
          clearSelectedPledges("contributing-teams"),
          setStateExpressions("finish-road-accounting", [
            ["public.construction.totalPledged", literal(0)],
            ["public.turnEffects.firstRoadFreeSegments", literal(0)]
          ]),
          {
            id: "journal",
            kind: "command",
            op: "core.event.emit",
            eventType: "construction.road.built",
            summary: literal("Ведущий подтвердил и полностью оплатил новую дорогу"),
            audience: "public",
            data: {
              kind: literal("construction-road"),
              edgeId: result("allocate-edge-id", ["id"]),
              fromNodeId: result("route", ["fromNodeId"]),
              toNodeId: result("route", ["toNodeId"]),
              baseSegments: cost.baseSegments,
              discountedSegments: cost.discountedSegments,
              payableSegments: cost.payableSegments,
              constructionCost: cost.constructionCost,
              turnNumber: state("public.session.turnNumber"),
              activationTurn: arithmetic(
                "number.add",
                state("public.session.turnNumber"),
                literal(2)
              )
            }
          }
        ]
      }
    }
  };
};

const lifecyclePatches = (blockingReasonOperation = "set-add") => [
  {
    operation: "set",
    path: ["createdTurn"],
    value: state("public.session.turnNumber")
  },
  {
    operation: "set",
    path: ["activationTurn"],
    value: arithmetic(
      "number.add",
      state("public.session.turnNumber"),
      literal(2)
    )
  },
  {
    operation: blockingReasonOperation,
    path: ["blockingReasons"],
    value: literal(
      blockingReasonOperation === "set"
        ? [constructionPendingReason]
        : constructionPendingReason
    )
  }
];

const setFacet = (id, collection, entityId, facet, value) => ({
  id,
  kind: "command",
  op: "core.entity.facet.set",
  entity: { collection, entityId },
  facet,
  value: literal(value)
});

const patchLifecycle = (
  id,
  collection,
  entityId,
  extraPatches = [],
  blockingReasonOperation = "set-add"
) => ({
  id,
  kind: "command",
  op: "core.entity.attributes.patch",
  entity: { collection, entityId },
  patches: [
    ...extraPatches,
    ...lifecyclePatches(blockingReasonOperation)
  ]
});

const buildWaypoint = () => {
  const id = "construction.waypoint.build";
  const edgeId = param("edgeId");
  return {
    action: action({
      id,
      label: "Построить полустанок",
      semantics:
        "Проверяет точку на существующей дороге, атомарно списывает пять монет согласованных вкладов и делит дорогу на закрытые до N+2 части.",
      paramsSchema: waypointParamsSchema
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: all(
              constructionGuard("waypoint"),
              compare(
                "eq",
                state("public.construction.totalPledged"),
                literal(5)
              )
            ),
            errorCode: "CONSTRUCTION_WAYPOINT_UNAVAILABLE"
          },
          {
            id: "inspect-position",
            kind: "algorithm",
            op: "graph.edge.position.inspect",
            networkId: "main",
            edge: edgeId,
            position: param("positionT")
          },
          {
            id: "outside-endpoint-regions",
            kind: "assert",
            op: "core.assert",
            predicate: {
              op: "predicate.set.disjoint",
              left: result("inspect-position", ["pointRegionIds"]),
              right: result("inspect-position", ["endpoints", "regionIds"])
            },
            errorCode: "CONSTRUCTION_WAYPOINT_IN_ENDPOINT_REGION"
          },
          selectAllTeams("contributing-teams", {
            constructionPledge: {
              operator: "gt",
              value: literal(0)
            }
          }),
          transferSelectedPledges("contributing-teams"),
          {
            id: "split-edge",
            kind: "command",
            op: "graph.edge.split",
            networkId: "main",
            proof: result("inspect-position")
          },
          setFacet(
            "mark-node-building",
            "networkNodes",
            result("split-edge", ["nodeId"]),
            "availability",
            "building"
          ),
          patchLifecycle(
            "mark-node-lifecycle",
            "networkNodes",
            result("split-edge", ["nodeId"]),
            [
              {
                operation: "set",
                path: ["constructionCost"],
                value: literal(5)
              },
              {
                operation: "set",
                path: ["splitFromEdgeId"],
                value: result("split-edge", ["replacedEdgeId"])
              },
              // `countryId` is immutable authored content. Until approved
              // polygons can classify a new waypoint, the optional reference
              // stays absent instead of weakening the read-only field.
            ],
            // graph.edge.split creates a fresh waypoint without this set.
            // Initialise it, while child edges below use set-add so inherited
            // independent blockers on the replaced road are preserved.
            "set"
          ),
          ...[0, 1].flatMap((index) => {
            const childId = result("split-edge", ["edgeIds", String(index)]);
            return [
              setFacet(
                `mark-child-${index + 1}-building`,
                "networkEdges",
                childId,
                "state",
                "building"
              ),
              patchLifecycle(
                `mark-child-${index + 1}-lifecycle`,
                "networkEdges",
                childId
              )
            ];
          }),
          clearSelectedPledges("contributing-teams"),
          setStateExpressions("finish-waypoint-accounting", [
            ["public.construction.totalPledged", literal(0)]
          ]),
          {
            id: "journal",
            kind: "command",
            op: "core.event.emit",
            eventType: "construction.waypoint.built",
            summary: literal("Ведущий подтвердил и полностью оплатил полустанок"),
            audience: "public",
            data: {
              kind: literal("construction-waypoint"),
              nodeId: result("split-edge", ["nodeId"]),
              replacedEdgeId: result("split-edge", ["replacedEdgeId"]),
              constructionCost: literal(5),
              turnNumber: state("public.session.turnNumber"),
              activationTurn: arithmetic(
                "number.add",
                state("public.session.turnNumber"),
                literal(2)
              )
            }
          }
        ]
      }
    }
  };
};

const buildPhaseFinish = () => {
  const id = "construction.phase.finish";
  return {
    action: action({
      id,
      label: "Завершить этап строительства",
      semantics:
        "Отменяет оставшиеся предварительные вклады без списания, закрывает строительные управления и отдельно переводит ход к отчёту."
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: constructionGuard(),
            errorCode: "CONSTRUCTION_PHASE_UNAVAILABLE"
          },
          selectAllTeams("all-teams"),
          clearSelectedPledges("all-teams"),
          setStateExpressions("finish", [
            ["public.construction.totalPledged", literal(0)],
            ["public.construction.mode", literal(null)],
            ["public.construction.available", literal(false)],
            ["public.session.phase", literal("reporting")]
          ]),
          {
            id: "journal",
            kind: "command",
            op: "core.event.emit",
            eventType: "construction.phase.finished",
            summary: literal("Ведущий завершил этап строительства"),
            audience: "public",
            data: {
              kind: literal("construction-phase"),
              turnNumber: state("public.session.turnNumber")
            }
          }
        ]
      }
    }
  };
};

/**
 * Build a deterministic technical region graph over the existing 5079×3627
 * coordinate system. These strips are not an interpretation of the author's
 * countries; their only purpose is to exercise multi-region construction.
 */
const buildTechnicalRegions = () => {
  const width = boardWidth / technicalRegionCount;
  const regions = Array.from({ length: technicalRegionCount }, (_, index) => {
    const left = index * width;
    const right = index === technicalRegionCount - 1
      ? boardWidth
      : (index + 1) * width;
    return {
      id: `technical-placeholder-region-${String(index + 1).padStart(2, "0")}`,
      polygon: [
        { x: left, y: 0 },
        { x: right, y: 0 },
        { x: right, y: boardHeight },
        { x: left, y: boardHeight }
      ]
    };
  });
  const portals = Array.from(
    { length: technicalRegionCount - 1 },
    (_, index) => {
      const x = (index + 1) * width;
      const leftId = regions[index].id;
      const rightId = regions[index + 1].id;
      return {
        id: `portal:${leftId}:${rightId}:1`,
        regionIds: [leftId, rightId],
        from: { x, y: 0 },
        to: { x, y: boardHeight }
      };
    }
  );
  // Runtime hashes the canonical planning contract, not just raw geometry:
  // the same polygons interpreted by a different algorithm or boundary rule
  // are intentionally a different authoritative route model.
  const geometryHash = `sha256:${createHash("sha256")
    .update(JSON.stringify({
      algorithmVersion: "region-segment-minimum-v1",
      boundaryPolicy: "lowest-region-id",
      regions,
      portals
    }))
    .digest("hex")}`;
  return { regions, portals, geometryHash };
};

/**
 * Give pre-existing straight test edges a complete route plan for the same
 * technical strips.
 *
 * `graph.edge.split` validates and divides a stored route plan. The earlier
 * review placeholder stored prose in that field, which was useful provenance
 * but not executable geometry. This normalization inserts strip-boundary
 * vertices while preserving every author-derived endpoint and edge id.
 */
const normalizeTechnicalInitialEdges = (
  root,
  regions,
  geometryHash
) => {
  const regionWidth = boardWidth / technicalRegionCount;
  const nodes = root.state.public.objects.networkNodes;
  for (const [edgeId, edge] of Object.entries(
    root.state.public.objects.networkEdges
  )) {
    const from = nodes[edge.attributes.fromNodeId]?.attributes.position;
    const to = nodes[edge.attributes.toNodeId]?.attributes.position;
    assert.ok(from && to, `${edgeId} must reference two positioned nodes`);
    const parameters = [0, 1];
    if (from.x !== to.x) {
      for (let index = 1; index < technicalRegionCount; index += 1) {
        const boundaryX = index * regionWidth;
        const parameter = (boundaryX - from.x) / (to.x - from.x);
        if (parameter > 0 && parameter < 1) parameters.push(parameter);
      }
    }
    parameters.sort((left, right) => left - right);
    const points = parameters.map((parameter) => ({
      x: from.x + (to.x - from.x) * parameter,
      y: from.y + (to.y - from.y) * parameter
    }));
    const passages = Array.from(
      { length: points.length - 1 },
      (_, index) => {
        const midpointX = (points[index].x + points[index + 1].x) / 2;
        const regionIndex = Math.min(
          technicalRegionCount - 1,
          Math.max(0, Math.floor(midpointX / regionWidth))
        );
        return {
          regionId: regions[regionIndex].id,
          fromPointIndex: index,
          toPointIndex: index + 1
        };
      }
    );
    edge.attributes.geometry = {
      from,
      to,
      polyline: points
    };
    edge.attributes.regionSegments = passages.length;
    edge.attributes.routePlan = {
      mode: "region-segment-minimum",
      algorithmVersion: "region-segment-minimum-v1",
      geometryVersion: "technical-placeholder-vertical-strips-v1",
      geometryHash,
      boundaryPolicy: "lowest-region-id",
      regionSequence: passages.map((passage) => passage.regionId),
      passages,
      tieBreak: {
        policy: "technical-straight-initial-network",
        candidateCount: 1,
        selectedCandidateIndex: 0
      },
      source: "technical-initial-network-review",
      geometryStatus: "awaiting-author-overlay-confirmation"
    };
  }
};

const declareConstructionState = (root) => {
  root.state.public.construction = {
    ...(root.state.public.construction ?? {}),
    mode: root.state.public.construction?.mode ?? null,
    available: root.state.public.construction?.available ?? false,
    sequence: root.state.public.construction?.sequence ?? 0,
    totalPledged: 0
  };
  root.state.public.turnEffects = {
    ...(root.state.public.turnEffects ?? {}),
    firstRoadFreeSegments:
      root.state.public.turnEffects?.firstRoadFreeSegments ?? 0
  };
  root.state.public.transportNetworks.main.excludedRegionIds = [];

  const stateModel = root.mechanics.stateModel;
  stateModel.collections.teams.fields.constructionPledge = {
    storage: { kind: "attribute", name: "constructionPledge" },
    valueType: "core.integer",
    access: "read-write"
  };
  Object.assign(stateModel.collections.networkNodes.fields, {
    constructionCost: {
      storage: { kind: "attribute", name: "constructionCost" },
      valueType: "core.integer",
      access: "read-write"
    },
    splitFromEdgeId: {
      storage: { kind: "attribute", name: "splitFromEdgeId" },
      valueType: "core.string",
      access: "read-write"
    }
  });
  Object.assign(stateModel.collections.networkEdges.fields, {
    discountedRegionSegments: {
      storage: { kind: "attribute", name: "discountedRegionSegments" },
      valueType: "core.integer",
      access: "read-write"
    },
    payableRegionSegments: {
      storage: { kind: "attribute", name: "payableRegionSegments" },
      valueType: "core.integer",
      access: "read-write"
    }
  });

  Object.assign(stateModel.endpoints, {
    "public.construction.totalPledged": {
      audienceRef: "public",
      storage: {
        root: "public",
        segments: ["construction", "totalPledged"]
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
    "public.transportNetworks.main.excludedRegionIds": {
      audienceRef: "public",
      storage: {
        root: "public",
        segments: ["transportNetworks", "main", "excludedRegionIds"]
      },
      valueType: "core.string-set",
      access: "read-write"
    }
  });
};

const declareConstructionEvents = (root) => {
  const { types, events } = root.mechanics.stateModel;
  Object.assign(types, {
    "game.construction-contribution-event": {
      kind: "record",
      fields: {
        kind: { typeRef: "core.string", optional: false },
        teamId: { typeRef: "core.string", optional: false },
        amount: { typeRef: "core.integer", optional: false },
        totalPledged: { typeRef: "core.integer", optional: false },
        turnNumber: { typeRef: "core.integer", optional: false }
      }
    },
    "game.construction-road-event": {
      kind: "record",
      fields: {
        kind: { typeRef: "core.string", optional: false },
        edgeId: { typeRef: "core.string", optional: false },
        fromNodeId: { typeRef: "core.string", optional: false },
        toNodeId: { typeRef: "core.string", optional: false },
        baseSegments: { typeRef: "core.integer", optional: false },
        discountedSegments: { typeRef: "core.integer", optional: false },
        payableSegments: { typeRef: "core.integer", optional: false },
        constructionCost: { typeRef: "core.integer", optional: false },
        turnNumber: { typeRef: "core.integer", optional: false },
        activationTurn: { typeRef: "core.integer", optional: false }
      }
    },
    "game.construction-waypoint-event": {
      kind: "record",
      fields: {
        kind: { typeRef: "core.string", optional: false },
        nodeId: { typeRef: "core.string", optional: false },
        replacedEdgeId: { typeRef: "core.string", optional: false },
        constructionCost: { typeRef: "core.integer", optional: false },
        turnNumber: { typeRef: "core.integer", optional: false },
        activationTurn: { typeRef: "core.integer", optional: false }
      }
    },
    "game.construction-phase-event": {
      kind: "record",
      fields: {
        kind: { typeRef: "core.string", optional: false },
        turnNumber: { typeRef: "core.integer", optional: false }
      }
    }
  });
  Object.assign(events, {
    "construction.contribution.updated": {
      audienceRef: "public",
      payloadType: "game.construction-contribution-event",
      journalEndpoint: { endpoint: "public.log" }
    },
    "construction.road.built": {
      audienceRef: "public",
      payloadType: "game.construction-road-event",
      journalEndpoint: { endpoint: "public.log" }
    },
    "construction.waypoint.built": {
      audienceRef: "public",
      payloadType: "game.construction-waypoint-event",
      journalEndpoint: { endpoint: "public.log" }
    },
    "construction.phase.finished": {
      audienceRef: "public",
      payloadType: "game.construction-phase-event",
      journalEndpoint: { endpoint: "public.log" }
    }
  });
};

const constructionBoardActions = () => [
  {
    id: "construction-contribution-set",
    label: "Изменить вклад команды",
    description:
      "Выберите команду и предварительную сумму. Деньги будут списаны только при успешном строительстве.",
    actionId: "construction.contribution.set",
    phase: "construction",
    section: "construction"
  },
  {
    id: "construction-mode-road",
    label: "Выбрать строительство дороги",
    actionId: "construction.mode.road",
    phase: "construction",
    section: "construction"
  },
  {
    id: "construction-mode-waypoint",
    label: "Выбрать строительство полустанка",
    actionId: "construction.mode.waypoint",
    phase: "construction",
    section: "construction"
  },
  {
    id: "construction-road-build",
    label: "Подтвердить дорогу",
    description:
      "Выберите две станции; маршрут, сегменты и итоговую стоимость рассчитает сервер.",
    actionId: "construction.road.build",
    phase: "construction",
    section: "construction"
  },
  {
    id: "construction-waypoint-build",
    label: "Подтвердить полустанок",
    description:
      "Выберите существующую дорогу и внутреннюю точку. Сервер проверит ограничение областей.",
    actionId: "construction.waypoint.build",
    phase: "construction",
    section: "construction"
  },
  {
    id: "construction-phase-finish",
    label: "Завершить строительство",
    actionId: "construction.phase.finish",
    phase: "construction",
    section: "construction"
  }
];

/**
 * Apply only the construction-owned transformation.
 *
 * Cloning the input allows tests and `--check` to prove deterministic,
 * idempotent composition with every earlier game-local generator.
 */
const buildConstructionCycleAuthoring = (sourceAuthoring) => {
  const authoring = structuredClone(sourceAuthoring);
  const root = authoring.root;
  assert.ok(root.mechanics.stateModel.collections.teams, "dynamic team collection is required");
  assert.ok(root.networkModels?.main, "main network model is required");

  declareConstructionState(root);
  declareConstructionEvents(root);

  const { regions, portals, geometryHash } = buildTechnicalRegions();
  normalizeTechnicalInitialEdges(root, regions, geometryHash);
  root.networkModels.main.regions = regions;
  root.networkModels.main.buildableNodeStates = ["open", "building"];
  root.networkModels.main.roadPlanning = {
    mode: "region-segment-minimum",
    algorithmVersion: "region-segment-minimum-v1",
    geometryVersion: "technical-placeholder-vertical-strips-v1",
    geometryHash,
    tieBreak: "session-random",
    boundaryPolicy: "lowest-region-id",
    excludedRegionIdsEndpoint:
      "public.transportNetworks.main.excludedRegionIds",
    navigationGraph: { portals }
  };
  root.objectTypes["transport.waypoint"].facets.availability.values.building = {
    visible: true,
    interactive: false,
    view: { visualState: "pending" }
  };
  const generated = [
    buildContributionSet(),
    buildMode("road", "Строить дорогу"),
    buildMode("waypoint", "Строить полустанок"),
    buildRoad(),
    buildWaypoint(),
    buildPhaseFinish()
  ];
  root.logic.actions = [
    ...root.logic.actions.filter(
      (candidate) => !candidate.id.startsWith(constructionActionPrefix)
    ),
    ...generated.map((item) => item.action)
  ];
  root.mechanics.plans = Object.fromEntries([
    ...Object.entries(root.mechanics.plans).filter(
      ([planId]) => !planId.startsWith(constructionActionPrefix)
    ),
    ...generated.map((item) => [item.action.id, item.plan])
  ]);
  delete root.mechanics.macros["cmt.construction.road"];
  delete root.mechanics.macros["cmt.construction.waypoint"];

  const board = root.state.public.board;
  assert.ok(Array.isArray(board?.availableActions), "board action list is required");
  const constructionActionIds = new Set(
    generated.map((item) => item.action.id)
  );
  board.availableActions = [
    ...board.availableActions.filter(
      (candidate) =>
        !ownedBoardActionIds.has(candidate.id)
        && !constructionActionIds.has(candidate.actionId)
        && !candidate.actionId.startsWith(constructionActionPrefix)
    ),
    ...constructionBoardActions()
  ];

  const facilitatorFlow = root.logic.flows.find((flow) => flow.id === "facilitator");
  assert.ok(facilitatorFlow, "facilitator flow is required");
  const finishActionIds = [
    "session.finish.request",
    "session.finish.confirm",
    "session.finish.cancel"
  ];
  const existingStep = facilitatorFlow.steps.find(
    (step) => step.id === constructionFlowStepId
  );
  if (existingStep) {
    existingStep._label = "Строительство";
    existingStep._semantics =
      "Ведущий задаёт предварительные вклады, строит несколько объектов и отдельно закрывает этап.";
    existingStep.actionIds = [
      ...generated.map((item) => item.action.id),
      ...finishActionIds
    ];
  } else {
    const reportingIndex = facilitatorFlow.steps.findIndex(
      (step) => step.id === "facilitator.reporting-boundary"
    );
    const insertionIndex =
      reportingIndex === -1 ? facilitatorFlow.steps.length : reportingIndex;
    facilitatorFlow.steps.splice(insertionIndex, 0, {
      id: constructionFlowStepId,
      _type: "game.Step",
      _label: "Строительство",
      _semantics:
        "Ведущий задаёт предварительные вклады, строит несколько объектов и отдельно закрывает этап.",
      screenId: "facilitator",
      actionIds: [
        ...generated.map((item) => item.action.id),
        ...finishActionIds
      ]
    });
  }

  root.content.data.constructionActionIntent = {
    status: "executable-technical-region-draft",
    publishable: false,
    road: {
      actionId: "construction.road.build",
      trustedInput: ["fromNodeId", "toNodeId"],
      routeAndCostAuthority: "server",
      pricePerRegionSegment: 2
    },
    waypoint: {
      actionId: "construction.waypoint.build",
      trustedInput: ["edgeId", "positionT"],
      serverValidatedPrice: 5
    },
    contributions: {
      actionId: "construction.contribution.set",
      semantics: "agreement-only-until-atomic-build"
    }
  };
  root.content.data.constructionCycle = {
    status: "executable-on-non-publishable-technical-regions",
    publishable: false,
    regionData: {
      provenance: "generated technical placeholder; not author geography",
      geometryVersion: "technical-placeholder-vertical-strips-v1",
      regionCount: technicalRegionCount,
      replaceBeforePublication: true
    },
    pricing: {
      roadCoinsPerRegionSegment: 2,
      waypointCoins: 5,
      news26FirstRoadFreeSegments: 6
    },
    lifecycle: {
      ordinaryActivation: "start-of-N-plus-2",
      independentBlockingReason: constructionPendingReason
    },
    invariants: [
      "pledges-do-not-debit-before-build",
      "exact-total-and-all-debits-and-object-create-are-atomic",
      "multiple-builds-per-phase",
      "explicit-phase-finish",
      "waypoint-does-not-consume-news-26",
      "failed-road-does-not-consume-news-26"
    ]
  };

  const broadBlocker =
    "remaining market, cargo selection sequencing, construction and reporting workflows";
  const preciseBlocker =
    "remaining market, cargo selection sequencing and reporting workflows";
  const postCargoPriorityBlocker =
    "remaining market and reporting workflows";
  const blockers = new Set(root.config.runtimeBlockers);
  blockers.delete(broadBlocker);
  blockers.delete(preciseBlocker);
  blockers.delete(postCargoPriorityBlocker);
  blockers.add(
    root.content.data.cardLifecycle?.cargoSelectionPriority
      ? postCargoPriorityBlocker
      : preciseBlocker
  );
  root.config.runtimeBlockers = [...blockers];
  root.config.runtimeReady = false;
  return authoring;
};

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

const buildFromDisk = async () =>
  buildConstructionCycleAuthoring(await readJson(authoringPath));

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
    throw new Error("usage: build-construction-cycle.mjs [--check]");
  }
  const sourceText = await readFile(authoringPath, "utf8");
  const builtText = serialize(await buildFromDisk());
  if (checkOnly) {
    assert.equal(
      sourceText,
      builtText,
      "construction-cycle authoring is stale; run build-construction-cycle.mjs"
    );
  } else {
    await writeAtomically(authoringPath, builtText);
  }
  process.stdout.write(
    `cards-money-trains: ${checkOnly ? "verified" : "built"} dynamic construction on technical placeholder regions\n`
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
  buildConstructionCycleAuthoring,
  buildFromDisk,
  buildTechnicalRegions
};
