#!/usr/bin/env node
/**
 * Build a runnable, separately addressed mock game from the normative shell.
 *
 * The normative game remains untouched. This adapter copies its currently
 * accepted platform wiring and injects only explicitly marked development
 * content. Re-running the builder makes drift visible in generated diffs.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { toManifestFragment, toReviewOverlaySvg, validateAnnotation } from "./convert-map-annotation.mjs";

const scriptFile = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(scriptFile), "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const normativeRoot = path.join(repoRoot, "games", "cards-money-trains");

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));
const writeJson = async (filePath, value) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const assertGameplayReferences = (gameplay, annotation) => {
  const nodeIds = new Set(annotation.nodes.map((node) => node.id));
  const edgeIds = new Set(annotation.edges.map((edge) => edge.id));
  const teamIds = new Set();
  const vehicleIds = new Set();
  for (const team of gameplay.teams) {
    if (teamIds.has(team.id)) throw new Error(`duplicate mock team id "${team.id}"`);
    teamIds.add(team.id);
    for (const vehicle of team.vehicles) {
      if (vehicleIds.has(vehicle.id)) throw new Error(`duplicate mock vehicle id "${vehicle.id}"`);
      vehicleIds.add(vehicle.id);
      if (!nodeIds.has(vehicle.nodeId)) throw new Error(`vehicle "${vehicle.id}" references missing node "${vehicle.nodeId}"`);
    }
  }
  for (const cargo of gameplay.cargoCards) {
    if (!nodeIds.has(cargo.fromNodeId) || !nodeIds.has(cargo.toNodeId)) {
      throw new Error(`cargo "${cargo.id}" references a missing endpoint`);
    }
    if (!Number.isSafeInteger(cargo.payout) || cargo.payout < 0) {
      throw new Error(`cargo "${cargo.id}" payout must be a non-negative integer`);
    }
  }
  for (const news of gameplay.newsCards) {
    if (news.effect?.kind === "edge-state" && !edgeIds.has(news.effect.edgeId)) {
      throw new Error(`news "${news.id}" references missing edge "${news.effect.edgeId}"`);
    }
  }
};

const vehicleCollections = (gameplay) => {
  const locomotives = {};
  const wagons = {};
  for (const team of gameplay.teams) {
    for (const vehicle of team.vehicles) {
      const target = vehicle.kind === "locomotive" ? locomotives : wagons;
      target[vehicle.id] = {
        objectType: vehicle.kind === "locomotive" ? "transport.locomotive" : "transport.wagon",
        facets: { availability: "active" },
        attributes: {
          networkId: "main",
          nodeId: vehicle.nodeId,
          ownerTeamId: team.id,
          ...(vehicle.kind === "locomotive" ? { actionPoints: vehicle.actionPoints ?? 0 } : {}),
          ...(vehicle.attachedVehicleId ? { attachedVehicleId: vehicle.attachedVehicleId } : {}),
          ...(vehicle.cargoId ? { cargoId: vehicle.cargoId } : {})
        }
      };
    }
  }
  return { locomotives, wagons };
};

const operationObjectTypes = {
  "transport.locomotive": {
    _type: "game.ObjectType",
    _label: "Локомотив",
    _semantics: "Авторитетная единица тяги с позицией и остатком единиц действия.",
    collection: "locomotives",
    idField: "id",
    scope: "session",
    facets: {
      availability: { initial: "active", values: { active: { visible: true, interactive: true } } }
    }
  },
  "transport.wagon": {
    _type: "game.ObjectType",
    _label: "Вагон",
    _semantics: "Перемещается вместе с объявленным локомотивом и несёт не более одного груза.",
    collection: "wagons",
    idField: "id",
    scope: "session",
    facets: {
      availability: { initial: "active", values: { active: { visible: true, interactive: true } } }
    }
  },
  "transport.cargo": {
    _type: "game.ObjectType",
    _label: "Грузовой заказ",
    _semantics: "Содержит пункт назначения и проверяемое состояние доставки.",
    collection: "cargoOrders",
    idField: "id",
    scope: "session",
    facets: {
      status: {
        initial: "in_transit",
        values: {
          available: { visible: true, interactive: false },
          in_transit: { visible: true, interactive: true },
          delivered: { visible: true, interactive: false }
        }
      }
    }
  }
};

const refSchema = (collection, allowedTypes) => ({
  type: "string",
  maxLength: 128,
  "x-cubica-ref": {
    kind: "object",
    collection,
    network: "main",
    allowedTypes,
    visibility: "public"
  }
});

const mockOperatingActions = () => ([
  {
    id: "mock.news.block-road",
    _type: "game.Action",
    _label: "Применить тестовую новость",
    _semantics: "Переводит существующую дорогу C–D в закрытое состояние на сервере.",
    handlerType: "manifest-data",
    capabilityFamily: "runtime.server",
    capability: "transport.edge.state.set",
    displayName: "MOCK: закрыть дорогу C–D",
    allowedSessionRoles: ["facilitator"],
    deterministic: {
      guard: { stateConditions: [{ path: "/public/session/phase", operator: "==", value: "news" }] },
      effects: [
        {
          op: "object.state.set",
          visibility: "public",
          collection: "networkEdges",
          objectId: "mock-edge-c-d",
          facet: "state",
          value: "blocked"
        },
        {
          op: "state.patch",
          patches: [{ op: "replace", path: "/public/session/phase", value: "maintenance" }]
        },
        { op: "log.append", target: "public.log", kind: "news", summary: "MOCK: новость закрыла дорогу C–D" }
      ]
    }
  },
  {
    id: "mock.maintenance.pay",
    _type: "game.Action",
    _label: "Оплатить тестовое обслуживание",
    _semantics: "Одним атомарным действием списывает с каждой команды стоимость её техники.",
    handlerType: "manifest-data",
    capabilityFamily: "runtime.server",
    capability: "economy.maintenance.pay",
    displayName: "MOCK: оплатить обслуживание",
    allowedSessionRoles: ["facilitator"],
    deterministic: {
      guard: { stateConditions: [{ path: "/public/session/phase", operator: "==", value: "maintenance" }] },
      effects: [
        ...["white-logistics", "red-logistics", "purple-guild", "green-guild"].map((teamId) => ({
          op: "metric.transfer",
          from: { scope: "state", path: `/public/teams/${teamId}/coins` },
          to: { scope: "bank" },
          amount: { var: `public.teams.${teamId}.maintenanceDue` },
          onInsufficient: "fail"
        })),
        {
          op: "state.patch",
          patches: [{ op: "replace", path: "/public/session/phase", value: "movement" }]
        },
        { op: "log.append", target: "public.log", kind: "maintenance", summary: "MOCK: обслуживание всей техники оплачено" }
      ]
    }
  },
  {
    id: "mock.locomotive.move",
    _type: "game.Action",
    _label: "Переместить тестовый локомотив",
    _semantics: "Проверяет открытую дорогу, соседство, единицы действия и вместимость терминала.",
    handlerType: "manifest-data",
    capabilityFamily: "runtime.server",
    capability: "transport.vehicle.move",
    displayName: "MOCK: перейти по дороге",
    allowedSessionRoles: ["facilitator"],
    paramsSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        vehicleId: refSchema("locomotives", ["transport.locomotive"]),
        edgeId: refSchema("networkEdges", ["transport.edge"])
      },
      required: ["vehicleId", "edgeId"]
    },
    deterministic: {
      guard: { stateConditions: [{ path: "/public/session/phase", operator: "==", value: "movement" }] },
      effects: [
        { op: "transport.vehicle.move", networkId: "main", vehicleParam: "vehicleId", edgeParam: "edgeId" },
        { op: "log.append", target: "public.log", kind: "movement", summary: "MOCK: локомотив перешёл по открытому ребру" }
      ]
    }
  },
  {
    id: "mock.cargo.deliver",
    _type: "game.Action",
    _label: "Доставить тестовый груз",
    _semantics: "Атомарно выполняет выплату банка, оплату перевозки и освобождение вагона.",
    handlerType: "manifest-data",
    capabilityFamily: "runtime.server",
    capability: "transport.cargo.deliver",
    displayName: "MOCK: доставить груз B–C",
    allowedSessionRoles: ["facilitator"],
    paramsSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        wagonId: refSchema("wagons", ["transport.wagon"]),
        cargoId: refSchema("cargoOrders", ["transport.cargo"])
      },
      required: ["wagonId", "cargoId"]
    },
    deterministic: {
      guard: { stateConditions: [{ path: "/public/session/phase", operator: "==", value: "movement" }] },
      effects: [
        {
          op: "metric.transfer",
          from: { scope: "bank" },
          to: { scope: "state", path: "/public/teams/white-logistics/coins" },
          amount: { var: "public.objects.cargoOrders.mock-cargo-b-c.attributes.payout" },
          onInsufficient: "fail"
        },
        {
          op: "metric.transfer",
          from: { scope: "state", path: "/public/teams/white-logistics/coins" },
          to: { scope: "state", path: "/public/teams/purple-guild/coins" },
          amount: { var: "public.objects.cargoOrders.mock-cargo-b-c.attributes.transportFee" },
          onInsufficient: "fail"
        },
        { op: "transport.cargo.deliver", networkId: "main", wagonParam: "wagonId", cargoParam: "cargoId" },
        {
          op: "state.patch",
          patches: [
            { op: "replace", path: "/public/session/phase", value: "construction" },
            { op: "replace", path: "/public/construction/available", value: true }
          ]
        },
        { op: "log.append", target: "public.log", kind: "delivery", summary: "MOCK: груз B–C доставлен и расчёты завершены" }
      ]
    }
  }
]);

const replaceUiText = (node) => {
  if (!node || typeof node !== "object") return;
  if (node.id === "facilitator.content-gate") {
    node._label = "Предупреждение о тестовых данных";
    node._semantics = "Не дает ведущему принять вымышленный контент за сведения автора игры.";
    node.props.html = "<p><strong>MOCK — только разработка:</strong> сеть, области, грузы, выплаты и контрольные ходы вымышлены. Они будут полностью заменены после подтверждения автора.</p>";
  }
  if (Array.isArray(node.children)) node.children.forEach(replaceUiText);
};

const build = async () => {
  const annotationPath = path.join(packageRoot, "annotations", "map-annotation.mock.json");
  const gameplayPath = path.join(packageRoot, "fixtures", "mock-gameplay-data.json");
  const annotation = await validateAnnotation(await readJson(annotationPath), annotationPath);
  const gameplay = await readJson(gameplayPath);
  assertGameplayReferences(gameplay, annotation);
  const network = toManifestFragment(annotation);

  const game = structuredClone(await readJson(path.join(normativeRoot, "authoring", "game.authoring.json")));
  game.root._label = "[MOCK] Карты, деньги, поезда";
  game.root._semantics = "Отдельная запускаемая тестовая копия на вымышленных данных; не является авторской версией игры.";
  game.root.meta.id = "cards-money-trains-mock";
  game.root.meta.version = "0.1.0-mock.1";
  game.root.meta.name = "[MOCK] Карты, деньги, поезда";
  game.root.meta.description = "Тестовый контур для непрерывной разработки до получения авторской сети и контента.";
  game.root.meta.tags = [...new Set([...(game.root.meta.tags ?? []), "mock", "test-only", "not-for-publication"])];
  game.root.content.data.mockNotice = {
    testOnly: true,
    normativeGameId: "cards-money-trains",
    replaceBeforePublication: true,
    warning: annotation.warning
  };
  game.root.content.data.board.deliveryAssetId = "board-guinea-optimized";
  game.root.content.data.board.designWidth = annotation.coordinateSystem.width;
  game.root.content.data.board.designHeight = annotation.coordinateSystem.height;
  game.root.content.data.contentGates = {
    runtimeReady: true,
    mockOnly: true,
    missing: [],
    replaceWithAuthorContent: ["transport topology", "coordinates", "regions", "cargo payouts", "news", "control transcript"]
  };
  game.root.content.data.mapAnnotation = network.generatedFrom;
  game.root.content.data.mockGameplay = gameplay;
  // The generated annotation fragment must remain a pure converter output.
  // Operation bindings are mock-package composition, so mutate a clone only.
  game.root.networkModels = structuredClone(network.networkModels);
  game.root.networkModels.main.movement = {
    vehicleCollection: "locomotives",
    vehicleObjectTypes: ["transport.locomotive"],
    locationAttribute: "nodeId",
    actionPointsAttribute: "actionPoints",
    traversableNodeStates: ["open"],
    traversableEdgeStates: ["open"],
    capacityCollection: "locomotives",
    capacityObjectTypes: ["transport.locomotive"],
    capacityLocationAttribute: "nodeId",
    maxVehiclesPerNode: game.root.content.data.rules.movement.terminalLocomotiveCapacity,
    coupledCollection: "wagons",
    coupledObjectTypes: ["transport.wagon"],
    coupledVehicleAttribute: "attachedVehicleId",
    coupledLocationAttribute: "nodeId"
  };
  game.root.networkModels.main.cargoDelivery = {
    wagonCollection: "wagons",
    wagonObjectTypes: ["transport.wagon"],
    cargoCollection: "cargoOrders",
    cargoObjectTypes: ["transport.cargo"],
    locationAttribute: "nodeId",
    cargoReferenceAttribute: "cargoId",
    attachedVehicleAttribute: "attachedVehicleId",
    cargoDestinationAttribute: "toNodeId",
    cargoStateFacet: "status",
    deliverableCargoStates: ["in_transit"],
    deliveredCargoState: "delivered"
  };
  game.root.objectTypes = { ...game.root.objectTypes, ...operationObjectTypes };

  const publicState = game.root.state.public;
  publicState.session.fixtureId = "development-mock";
  publicState.session.contentMode = "mock";
  publicState.session.phase = "news";
  publicState.construction.available = false;
  publicState.transportNetworks = network.state.public.transportNetworks;
  publicState.teams = Object.fromEntries(gameplay.teams.map((team) => [team.id, {
    label: team.label,
    type: team.type,
    coins: team.coins,
    maintenanceDue: team.vehicles.length * gameplay.maintenance.coinsPerVehicle
  }]));
  const vehicles = vehicleCollections(gameplay);
  const cargoOrders = Object.fromEntries(gameplay.cargoCards.map((cargo) => [cargo.id, {
    objectType: "transport.cargo",
    facets: { status: cargo.id === "mock-cargo-b-c" ? "in_transit" : "available" },
    attributes: {
      networkId: "main",
      fromNodeId: cargo.fromNodeId,
      toNodeId: cargo.toNodeId,
      payout: cargo.payout,
      transportFee: cargo.transportFee ?? 0
    }
  }]));
  publicState.objects = {
    networkNodes: network.state.public.objects.networkNodes,
    networkEdges: network.state.public.objects.networkEdges,
    locomotives: vehicles.locomotives,
    wagons: vehicles.wagons,
    cargoOrders
  };
  publicState.board = {
    ...publicState.board,
    ...network.state.public.board,
    availableActions: [
      {
        id: "mock-apply-news",
        label: "MOCK: применить новость о дороге C–D",
        actionId: "mock.news.block-road"
      },
      {
        id: "mock-pay-maintenance",
        label: "MOCK: оплатить обслуживание техники",
        actionId: "mock.maintenance.pay"
      },
      {
        id: "mock-move-purple-b-c",
        label: "MOCK: перевести фиолетовый локомотив B–C",
        actionId: "mock.locomotive.move",
        params: { vehicleId: "mock-locomotive-purple-1", edgeId: "mock-edge-b-c" }
      },
      {
        id: "mock-deliver-b-c",
        label: "MOCK: доставить груз B–C",
        actionId: "mock.cargo.deliver",
        params: { wagonId: "mock-wagon-white-1", cargoId: "mock-cargo-b-c" }
      },
      {
        id: "mock-build-road-b-d",
        label: "MOCK: построить дорогу B–D (6 монет)",
        description: "Вымышленный контроль: три области, по 2 монеты за сегмент.",
        actionId: "construction.road.build",
        params: {
          fromNodeId: "mock-terminal-b",
          toNodeId: "mock-terminal-d",
          whiteContribution: 2,
          redContribution: 2,
          purpleContribution: 1,
          greenContribution: 1
        }
      },
      {
        id: "mock-build-waypoint-a-b",
        label: "MOCK: поставить полустанок на A–B (5 монет)",
        description: "Вымышленный контроль: точка посередине существующей дороги.",
        actionId: "construction.waypoint.build",
        params: {
          edgeId: "mock-edge-a-b",
          positionT: 0.5,
          whiteContribution: 3,
          redContribution: 2,
          purpleContribution: 0,
          greenContribution: 0
        }
      }
    ]
  };

  const pending = game.root.logic.pendingActions ?? [];
  const operatingActions = mockOperatingActions();
  game.root.logic.actions = [...operatingActions, ...pending, ...game.root.logic.actions];
  delete game.root.logic.pendingActions;
  delete game.root.logic.pendingActionReason;
  for (const flow of game.root.logic.flows ?? []) {
    for (const step of flow.steps ?? []) {
      if (step.id === "facilitator.setup") {
        step.actionIds = [...operatingActions.map((action) => action.id), ...step.actionIds];
      }
      if (step.id === "facilitator.construction") {
        step.actionIds = ["construction.road.build", "construction.waypoint.build", ...step.actionIds];
      }
    }
  }

  const ui = structuredClone(await readJson(path.join(normativeRoot, "authoring", "ui", "web.authoring.json")));
  ui.root._label = "[MOCK] Общий экран ведущего";
  ui.root.meta.id = "cards-money-trains-mock.ui.web";
  ui.root.meta.game_id = "cards-money-trains-mock";
  ui.root.meta.game_manifest_version = game.root.meta.version;
  for (const screen of ui.root.screens) {
    screen.title = `[MOCK] ${screen.title}`;
    replaceUiText(screen.root);
  }

  await writeJson(path.join(packageRoot, "generated", "network.manifest-fragment.json"), network);
  await writeJson(path.join(packageRoot, "authoring", "game.authoring.json"), game);
  await writeJson(path.join(packageRoot, "authoring", "ui", "web.authoring.json"), ui);
  await writeFile(
    path.join(packageRoot, "generated", "annotation-review-overlay.svg"),
    toReviewOverlaySvg(annotation, { backgroundHref: "../assets/images/mock-board.svg" }),
    "utf8"
  );
  process.stdout.write("cards-money-trains-mock: authoring package rebuilt from validated mock annotation\n");
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  build().catch((error) => {
    process.stderr.write(`cards-money-trains-mock: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export { build };
