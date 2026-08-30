#!/usr/bin/env node
/**
 * Build the normal-session construction cycle for «Карты, деньги, поезда».
 *
 * This game-local generator composes only accepted, generic Mechanics
 * operations: bounded entity selection/iteration, arithmetic, resource
 * transfer, graph planning/splitting, state patches and events. The regions
 * and the ten initial roads below are the real author map (ADR-100): the
 * regions and the roads the author actually drew, converted from the
 * author-confirmed annotation `annotations/initial-network-with-regions.
 * review.json` by the shared map-annotation pipeline — not an interpretation
 * invented by this generator. `config.runtimeReady` still stays `false`
 * because of remaining market, cargo and reporting workflows this generator
 * does not own (see the blocker bookkeeping near the end of this file), not
 * because of the map.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateMapAnnotation } from "../../../scripts/map-annotation/map-annotation.mjs";
import { toManifestFragment } from "./convert-map-annotation.mjs";

// `REGION_ROAD_PLANNING_MODE` is the one road-planning constant this file
// still needs directly: every stored road, whether traced from the author's
// drawing or found later by the planner, declares the same `mode` (ADR-081
// §4.1/ADR-100 §4.1 — the goal, "fewest regions", does not change; only how
// it is achieved does). Everything else about the map's geometry —
// canonicalisation, border crossings, the published checksum — is derived
// exactly once, inside the shared pipeline imported above, and must not be
// re-derived here: a game package that computed its own checksum with its
// own copy of those rules would produce a package the runtime silently
// refuses the moment the shared rules changed, with no hint that two
// implementations had drifted apart. A CI guard
// (scripts/ci/validate-game-agnostic.js) fails the build if a game file
// calls the shared derivation functions by name without importing them from
// one of the two places that actually define them.
import { REGION_ROAD_PLANNING_MODE } from "../../../services/runtime-api/src/modules/runtime/regionRoadGeometry.ts";

const scriptFile = fileURLToPath(import.meta.url);
const toolsRoot = path.dirname(scriptFile);
const gameRoot = path.resolve(toolsRoot, "..");
const authoringPath = path.join(gameRoot, "authoring", "game.authoring.json");
const annotationPath = path.join(
  gameRoot,
  "annotations",
  "initial-network-with-regions.review.json"
);
// Непубликуемый черновик разбиения (`cmt_region_partition.py`) — единственное
// место, где решается, какие области стали непроходимой местностью (см.
// `impassableTerrain.regionIds` и games/cards-money-trains/annotations/
// README.md, раздел «Непроходимая местность и река»). Публикуемая аннотация
// `initial-network-with-regions.review.json`, в отличие от него, не несёт
// собственного признака непроходимости на области (общая схема аннотации не
// расширялась под этот частный, специфичный для этой игры факт — расширять
// её означало бы протащить игровое правило в общий контракт, который читают
// все игры), поэтому этот список читается напрямую из черновика, а не
// выводится из аннотации.
const regionPartitionDraftPath = path.join(
  gameRoot,
  "annotations",
  "vector-map.region-partition.draft.json"
);
const roadPassagesPath = path.join(
  gameRoot,
  "annotations",
  "initial-network.road-passages.json"
);

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
    // An excluded team remains in the public audit collection, but it is no
    // longer a participant and must never contribute to a later build.
    facets: { placementStatus: literal("placed") },
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
                objectType: "game.team",
                facets: { placementStatus: literal("placed") }
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
            ["public.session.phase", literal("reporting")],
            ["public.session.canRequestFinish", literal(true)]
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
 * Load the real author map: the region polygons and the `roadPlanning`
 * contract derived from them (ADR-100), by running the annotation through
 * the same shared conversion the map-annotation intake pipeline always uses.
 *
 * This is the map's *only* derivation. `toManifestFragment` (imported from
 * `convert-map-annotation.mjs`, the game's thin adapter over the shared
 * pipeline) canonicalises the polygons, derives the border crossings between
 * them and hashes the result — this function must not compute any of that
 * itself, because the whole point of the shared pipeline is that there is
 * exactly one place a mistake in that computation could live (see the CI
 * guard referenced in the import comment above).
 *
 * The road-passages file pins the exact annotation bytes it was traced from
 * (`generatedFrom.sha256`); this loader re-checks that pin rather than
 * trusting that `build-initial-road-passages.mjs` was already re-run after
 * the annotation last changed, because a silently stale pin would mean the
 * roads below claim to cross regions that are not the ones this run just
 * published.
 */
const loadAuthorMapNetwork = async () => {
  const annotationText = await readFile(annotationPath, "utf8");
  const validatedAnnotation = await validateMapAnnotation(
    JSON.parse(annotationText),
    annotationPath
  );
  const fragment = toManifestFragment(validatedAnnotation);
  const { regions, roadPlanning } = fragment.networkModels.main;

  const roadPassages = JSON.parse(await readFile(roadPassagesPath, "utf8"));
  const actualAnnotationSha256 = createHash("sha256")
    .update(annotationText)
    .digest("hex");
  assert.equal(
    roadPassages.generatedFrom.sha256,
    actualAnnotationSha256,
    `${roadPassagesPath} was traced from a different annotation than the one ` +
    `currently on disk; rerun build-initial-road-passages.mjs before ` +
    "build-construction-cycle.mjs"
  );

  // Непроходимая местность (см. константу regionPartitionDraftPath выше):
  // список id читается из черновика разбиения, а затем проверяется против
  // самих регионов этого запуска — каждый заявленный id обязан существовать
  // среди regions, иначе excludedRegionIds сослался бы на несуществующую
  // область, а road-planning-контракт (см. regionRoadPlanner.ts)
  // отказался бы компилировать пакет с понятной, но поздней ошибкой вместо
  // ранней и точной.
  const regionPartitionDraft = JSON.parse(
    await readFile(regionPartitionDraftPath, "utf8")
  );
  const excludedRegionIds = regionPartitionDraft.impassableTerrain?.regionIds;
  assert.ok(
    Array.isArray(excludedRegionIds) && excludedRegionIds.length > 0,
    `${regionPartitionDraftPath} does not declare impassableTerrain.regionIds; ` +
    "rerun cmt_region_partition.py before build-construction-cycle.mjs"
  );
  const knownRegionIds = new Set(regions.map((region) => region.id));
  for (const regionId of excludedRegionIds) {
    assert.ok(
      knownRegionIds.has(regionId),
      `impassableTerrain.regionIds references "${regionId}", which is not among ` +
      `the ${regions.length} regions this run just built from ${annotationPath}; ` +
      "the draft and the annotation are out of sync — rerun the chain from " +
      "cmt_region_partition.py forward"
    );
  }

  return {
    regions,
    roadPlanning,
    excludedRegionIds,
    roadsByEdgeId: new Map(roadPassages.roads.map((road) => [road.id, road])),
    tracingAlgorithmVersion: roadPassages.generatedFrom.algorithmVersion
  };
};

/**
 * Store each author-drawn initial road's real geometry and route plan.
 *
 * `graph.edge.split` validates and divides a stored route plan, so every
 * initial edge needs one from the start. Earlier this field held a straight
 * line re-cut at technical strip boundaries; now it holds the author's own
 * polyline together with the region passages `build-initial-road-passages.mjs`
 * traced across the real map, matched to each edge by id.
 *
 * ADR-100 §4.8 is why `algorithmVersion` below is the *tracing tool's* own
   * version and not the planner's `region-segment-minimum-v3`: measured on this
 * map, the planner routes these same ten roads through fewer regions than the
 * author did (seven instead of thirteen on the longest one), because the
 * author drew a straight line while the planner minimises regions. A stored
 * road claiming the planner's version would therefore be unreproducible by
 * that version — exactly what ADR-081 §4.3 promises never happens. `mode`
 * still stays `region-segment-minimum` (`build-session-setup.mjs`'s
 * `hasExecutableRoutePlan` checks this): the road is still described as a
 * sequence of paid region passages, only *found* differently.
 */
const normalizeAuthorInitialEdges = (
  root,
  { roadsByEdgeId, roadPlanning, tracingAlgorithmVersion }
) => {
  for (const [edgeId, edge] of Object.entries(
    root.state.public.objects.networkEdges
  )) {
    const road = roadsByEdgeId.get(edgeId);
    assert.ok(
      road,
      `${edgeId} has no traced region passages in ${roadPassagesPath}; ` +
      "rerun build-initial-road-passages.mjs"
    );
    edge.attributes.geometry = {
      from: road.polyline[0],
      to: road.polyline[road.polyline.length - 1],
      polyline: road.polyline
    };
    edge.attributes.regionSegments = road.passages.length;
    edge.attributes.routePlan = {
      mode: REGION_ROAD_PLANNING_MODE,
      algorithmVersion: tracingAlgorithmVersion,
      geometryVersion: roadPlanning.geometryVersion,
      geometryHash: roadPlanning.geometryHash,
      boundaryPolicy: roadPlanning.boundaryPolicy,
      regionSequence: road.regionSequence,
      passages: road.passages,
      // There is no candidate list to break a tie among: the author drew
      // this exact line by hand, so "which shape won" is not a question the
      // tie-break policies of ADR-100 §4.6 (which choose among candidates
      // the *planner* found) answer. "author-drawn" names the true way this
      // road's shape was decided, instead of borrowing a planner policy name
      // that would misdescribe it.
      tieBreak: { policy: "author-drawn" },
      source: "author-confirmed-initial-network-review",
      geometryStatus: "author-confirmed"
    };
  }
};

const declareConstructionState = (root, excludedRegionIds) => {
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
  // Initial value of the excluded-region set: the author's dark-brown terrain
  // and the lakes' river (see games/cards-money-trains/annotations/README.md,
  // "Непроходимая местность и река", and impassableTerrain.regionIds in the
  // region-partition draft). These entries are PERMANENT terrain, not a
  // temporary closure — unlike an in-session event that blocks a region for a
  // few turns and later lifts the block, nothing in this game's rules ever
  // removes a terrain region from this set again. Any future rule that reads
  // or writes public.transportNetworks.main.excludedRegionIds (a temporary
  // regional closure event, for instance) MUST treat these ids as a floor: it
  // may add its own region ids on top for the duration of its own effect, but
  // it must never remove one of the ids listed below, because doing so would
  // make the game briefly claim a road can cross drawn terrain or a river.
  root.state.public.transportNetworks.main.excludedRegionIds = [...excludedRegionIds];

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
const buildConstructionCycleAuthoring = async (sourceAuthoring) => {
  const authoring = structuredClone(sourceAuthoring);
  const root = authoring.root;
  assert.ok(root.mechanics.stateModel.collections.teams, "dynamic team collection is required");
  assert.ok(root.networkModels?.main, "main network model is required");

  // Loaded before declareConstructionState() so the initial excluded-region
  // set (permanent terrain — see the comment inside declareConstructionState())
  // can be declared in one place instead of patched in afterwards.
  const mapNetwork = await loadAuthorMapNetwork();
  declareConstructionState(root, mapNetwork.excludedRegionIds);
  declareConstructionEvents(root);

  normalizeAuthorInitialEdges(root, mapNetwork);
  root.networkModels.main.regions = mapNetwork.regions;
  root.networkModels.main.buildableNodeStates = ["open", "building"];
  // No `navigationGraph` here: ADR-100 §4.3 removes it from the contract.
  // Runtime derives the navigation graph itself from `regions` on every load
  // and checks it against `geometryHash`; storing a second copy here would
  // only be a second place for the two to silently disagree. `roadPlanning`
  // itself comes straight from the shared pipeline's fragment (mode,
  // planner algorithmVersion, geometryVersion/geometryHash, tieBreak,
  // boundaryPolicy, excludedRegionIdsEndpoint) — reconstructing it field by
  // field here would be exactly the second derivation ADR-100 forbids.
  root.networkModels.main.roadPlanning = mapNetwork.roadPlanning;
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
    status: "executable-author-confirmed-region-network",
    publishable: true,
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
    status: "executable-on-author-confirmed-regions",
    publishable: true,
    regionData: {
      provenance:
        "author-confirmed partition of the real map (annotations/" +
        "initial-network-with-regions.review.json), compiled by " +
        "convert-map-annotation.mjs; see ADR-100",
      geometryVersion: mapNetwork.roadPlanning.geometryVersion,
      regionCount: mapNetwork.regions.length,
      replaceBeforePublication: false
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
  const reportingOnlyBlocker = "remaining reporting workflows";
  const marketReady =
    root.content.data.operatingTurn?.market?.status === "executable";
  const blockers = new Set(root.config.runtimeBlockers ?? []);
  blockers.delete(broadBlocker);
  blockers.delete(preciseBlocker);
  blockers.delete(postCargoPriorityBlocker);
  blockers.delete(reportingOnlyBlocker);
  if (!root.content.data.sessionCompletion) {
    blockers.add(
      root.content.data.cardLifecycle?.cargoSelectionPriority
        ? marketReady
          ? reportingOnlyBlocker
          : postCargoPriorityBlocker
        : preciseBlocker
    );
  }
  if (root.config.runtimeReady === true && blockers.size === 0) {
    delete root.config.runtimeBlockers;
  } else {
    root.config.runtimeBlockers = [...blockers];
  }
  if (!root.content.data.sessionCompletion) root.config.runtimeReady = false;
  return authoring;
};

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

const buildFromDisk = async () =>
  buildConstructionCycleAuthoring(await readJson(authoringPath));
// (buildConstructionCycleAuthoring is itself async — loading the real map
// requires reading and validating the annotation and road-passages files —
// so this arrow function's returned promise adopts that inner promise; no
// extra `await` is needed here for the resolved value to come out right.)

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
    `cards-money-trains: ${checkOnly ? "verified" : "built"} dynamic construction on the real author map\n`
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
  loadAuthorMapNetwork
};
