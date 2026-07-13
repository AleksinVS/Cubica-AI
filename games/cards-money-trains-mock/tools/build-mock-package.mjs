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
import {
  loadMockTextContent,
  writeImportedMockTextContent
} from "./import-mock-text-content.mjs";

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
  if (gameplay.newsCards.length < 6) throw new Error("mock news deck must contain at least 6 cards");
  if (gameplay.cargoCards.length < 12) throw new Error("mock cargo deck must contain at least 12 cards");
  if (!/^[0-9a-f]{32}$/u.test(gameplay.decks?.controlSeed)) {
    throw new Error("mock deck controlSeed must contain 32 lowercase hexadecimal characters");
  }
  for (const vehicle of gameplay.reservedMarketVehicles ?? []) {
    if (vehicleIds.has(vehicle.id)) throw new Error(`duplicate mock vehicle id "${vehicle.id}"`);
    if (!teamIds.has(vehicle.ownerTeamId)) throw new Error(`market vehicle "${vehicle.id}" references missing team`);
    if (!nodeIds.has(vehicle.nodeId)) throw new Error(`market vehicle "${vehicle.id}" references missing node`);
    vehicleIds.add(vehicle.id);
  }
};

const vehicleCollections = (gameplay) => {
  const locomotives = {};
  const wagons = {};
  for (const team of gameplay.teams) {
    for (const vehicle of team.vehicles) {
      const target = vehicle.kind === "locomotive" ? locomotives : wagons;
      target[vehicle.id] = {
        objectType: vehicle.objectType ??
          (vehicle.kind === "locomotive" ? "transport.locomotive" : "transport.wagon"),
        facets: { availability: "active" },
        attributes: {
          networkId: "main",
          nodeId: vehicle.nodeId,
          ownerTeamId: team.id,
          nominalValue: vehicle.kind === "locomotive"
            ? gameplay.market.prices.locomotive.purchase
            : gameplay.market.prices.wagon.purchase,
          ...(vehicle.kind === "locomotive" ? { actionPoints: vehicle.actionPoints ?? 0 } : {}),
          ...(vehicle.attachedVehicleId ? { attachedVehicleId: vehicle.attachedVehicleId } : {}),
          ...(vehicle.cargoId ? { cargoId: vehicle.cargoId } : {})
        }
      };
    }
  }
  for (const vehicle of gameplay.reservedMarketVehicles ?? []) {
    const target = vehicle.kind === "locomotive" ? locomotives : wagons;
    target[vehicle.id] = {
      objectType: vehicle.kind === "locomotive" ? "transport.locomotive" : "transport.wagon",
      facets: { availability: vehicle.availability ?? "reserve" },
      attributes: {
        networkId: "main",
        nodeId: vehicle.nodeId,
        ownerTeamId: vehicle.ownerTeamId,
        nominalValue: 0,
        ...(vehicle.kind === "locomotive" ? { actionPoints: vehicle.actionPoints ?? 0 } : {})
      }
    };
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
      availability: {
        initial: "active",
        values: {
          active: { visible: true, interactive: true },
          reserve: { visible: false, interactive: false },
          sold: { visible: false, interactive: false }
        }
      }
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
      availability: {
        initial: "active",
        values: {
          active: { visible: true, interactive: true },
          reserve: { visible: false, interactive: false },
          sold: { visible: false, interactive: false }
        }
      }
    }
  },
  "transport.incompatible-wagon": {
    _type: "game.ObjectType",
    _label: "Несовместимый тестовый вагон",
    _semantics: "Существующая единица техники для проверки отклонения несовместимого сцепления без добавления лишних ресурсов.",
    collection: "wagons",
    idField: "id",
    scope: "session",
    facets: {
      availability: {
        initial: "active",
        values: {
          active: { visible: true, interactive: true },
          sold: { visible: false, interactive: false }
        }
      }
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
  },
  "mock.news-card": {
    _type: "game.ObjectType",
    _label: "Тестовая карта новости",
    _semantics: "Скрытый до выдачи элемент воспроизводимой тестовой колоды.",
    collection: "newsCards",
    idField: "id",
    scope: "session",
    facets: {
      availability: { initial: "hidden", values: { hidden: { visible: false, interactive: false } } }
    }
  },
  "mock.cargo-card": {
    _type: "game.ObjectType",
    _label: "Тестовая карта груза",
    _semantics: "Скрытый до предложения элемент воспроизводимой тестовой колоды.",
    collection: "cargoCards",
    idField: "id",
    scope: "session",
    facets: {
      availability: { initial: "hidden", values: { hidden: { visible: false, interactive: false } } }
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
    id: "mock.news.apply.block-road",
    _type: "game.Action",
    _label: "Применить тестовую новость о дороге",
    _semantics: "Применяет уже открытую контрольную карту и переводит дорогу C–D в закрытое состояние.",
    handlerType: "manifest-data",
    capabilityFamily: "runtime.server",
    capability: "transport.edge.state.set",
    displayName: "MOCK: закрыть дорогу C–D",
    allowedSessionRoles: ["facilitator"],
    deterministic: {
      guard: {
        stateConditions: [
          { path: "/public/session/phase", operator: "==", value: "news" },
          { path: "/public/decks/news/currentCardId", operator: "==", value: "mock-news-block-c-d" }
        ]
      },
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
          patches: [{ op: "replace", path: "/public/session/phase", value: "market" }]
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
      guard: { stateConditions: [{ path: "/public/session/phase", operator: "==", value: "operations" }] },
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
        wagonId: { ...refSchema("wagons", ["transport.wagon"]), enum: ["mock-wagon-white-1"] },
        cargoId: { ...refSchema("cargoOrders", ["transport.cargo"]), enum: ["mock-cargo-b-c"] }
      },
      required: ["wagonId", "cargoId"]
    },
    deterministic: {
      guard: { stateConditions: [{ path: "/public/session/phase", operator: "==", value: "operations" }] },
      effects: [
        { op: "transport.cargo.deliver", networkId: "main", wagonParam: "wagonId", cargoParam: "cargoId" },
        { op: "counter.add", path: "/public/teams/white-logistics/maintenanceDue", delta: -1 },
        { op: "log.append", target: "public.log", kind: "delivery", summary: "MOCK: груз B–C доставлен; выплата и тариф рассчитаны по открытому кратчайшему пути" }
      ]
    }
  }
]);

/**
 * Phase and market actions that use already accepted generic effects only.
 * New transport/deck/ranking effects are composed separately after their
 * shared runtime contract is present, so the generated manifest never carries
 * a placeholder operation unknown to the platform.
 */
const mockIndependentSessionActions = (gameplay) => ([
  {
    id: "mock.setup.start",
    _type: "game.Action",
    _label: "Начать тестовую игру",
    _semantics: "Подтверждает заранее проверенные четыре команды и открывает первый обычный ход.",
    handlerType: "manifest-data",
    capabilityFamily: "runtime.server",
    capability: "turn.phase.start",
    displayName: "MOCK: начать игру",
    allowedSessionRoles: ["facilitator"],
    deterministic: {
      guard: { stateConditions: [{ path: "/public/session/phase", operator: "==", value: "setup" }] },
      effects: [
        { op: "deck.shuffle", deckId: "news", source: "collection:newsCards" },
        { op: "deck.shuffle", deckId: "cargo", source: "collection:cargoCards" },
        { op: "state.patch", patches: [{ op: "replace", path: "/public/session/phase", value: "news" }] },
        { op: "log.append", target: "public.log", kind: "setup", summary: "MOCK: ведущий подтвердил четыре команды и начал игру" }
      ]
    }
  },
  {
    id: "mock.market.buy.white-wagon",
    _type: "game.Action",
    _label: "Купить тестовый вагон",
    _semantics: "Атомарно оплачивает и активирует заранее объявленный резервный вагон только на рынке.",
    handlerType: "manifest-data",
    capabilityFamily: "runtime.server",
    capability: "economy.market.buy",
    displayName: "MOCK: Белая покупает вагон по текущей цене",
    allowedSessionRoles: ["facilitator"],
    deterministic: {
      guard: {
        stateConditions: [
          { path: "/public/session/phase", operator: "==", value: "market" },
          { path: "/public/objects/wagons/mock-market-wagon-white-3/facets/availability", operator: "==", value: "reserve" }
        ]
      },
      effects: [
        {
          op: "metric.transfer",
          from: { scope: "state", path: "/public/teams/white-logistics/coins" },
          to: { scope: "bank" },
          amount: { var: "public.market.wagonPurchasePrice" },
          onInsufficient: "fail"
        },
        {
          op: "object.state.set",
          visibility: "public",
          collection: "wagons",
          objectId: "mock-market-wagon-white-3",
          facet: "availability",
          value: "active"
        },
        {
          op: "object.attribute.patch",
          visibility: "public",
          collection: "wagons",
          objectId: "mock-market-wagon-white-3",
          patches: [{ op: "replace", path: "/nominalValue", value: gameplay.market.prices.wagon.purchase }]
        },
        { op: "counter.add", path: "/public/teams/white-logistics/maintenanceDue", delta: 1 },
        { op: "log.append", target: "public.log", kind: "market", summary: "MOCK: Белая команда купила вагон по текущей тестовой цене" }
      ]
    }
  },
  {
    id: "mock.market.buy.green-locomotive",
    _type: "game.Action",
    _label: "Купить тестовый локомотив",
    _semantics: "Негативная контрольная операция: при недостатке монет резерв остается неактивным.",
    handlerType: "manifest-data",
    capabilityFamily: "runtime.server",
    capability: "economy.market.buy",
    displayName: "MOCK: Зеленая покупает локомотив за 10 монет",
    allowedSessionRoles: ["facilitator"],
    deterministic: {
      guard: {
        stateConditions: [
          { path: "/public/session/phase", operator: "==", value: "market" },
          { path: "/public/objects/locomotives/mock-market-locomotive-green-2/facets/availability", operator: "==", value: "reserve" }
        ]
      },
      effects: [
        {
          op: "metric.transfer",
          from: { scope: "state", path: "/public/teams/green-guild/coins" },
          to: { scope: "bank" },
          amount: gameplay.market.prices.locomotive.purchase,
          onInsufficient: "fail"
        },
        {
          op: "object.state.set",
          visibility: "public",
          collection: "locomotives",
          objectId: "mock-market-locomotive-green-2",
          facet: "availability",
          value: "active"
        },
        {
          op: "object.attribute.patch",
          visibility: "public",
          collection: "locomotives",
          objectId: "mock-market-locomotive-green-2",
          patches: [{ op: "replace", path: "/nominalValue", value: gameplay.market.prices.locomotive.purchase }]
        },
        { op: "counter.add", path: "/public/teams/green-guild/maintenanceDue", delta: 1 },
        { op: "log.append", target: "public.log", kind: "market", summary: "MOCK: Зеленая команда купила локомотив" }
      ]
    }
  },
  {
    id: "mock.market.sell.red-wagon",
    _type: "game.Action",
    _label: "Продать тестовый вагон",
    _semantics: "Продажа доступна только на рынке и исключает проданную технику из обслуживания и результата.",
    handlerType: "manifest-data",
    capabilityFamily: "runtime.server",
    capability: "economy.market.sell",
    displayName: "MOCK: Красная продает вагон за 2 монеты",
    allowedSessionRoles: ["facilitator"],
    deterministic: {
      guard: {
        stateConditions: [
          { path: "/public/session/phase", operator: "==", value: "market" },
          { path: "/public/objects/wagons/mock-wagon-red-2/facets/availability", operator: "==", value: "active" }
        ]
      },
      effects: [
        {
          op: "metric.transfer",
          from: { scope: "bank" },
          to: { scope: "state", path: "/public/teams/red-logistics/coins" },
          amount: gameplay.market.prices.wagon.sale,
          onInsufficient: "fail"
        },
        {
          op: "object.state.set",
          visibility: "public",
          collection: "wagons",
          objectId: "mock-wagon-red-2",
          facet: "availability",
          value: "sold"
        },
        {
          op: "object.attribute.patch",
          visibility: "public",
          collection: "wagons",
          objectId: "mock-wagon-red-2",
          patches: [{ op: "replace", path: "/nominalValue", value: 0 }]
        },
        { op: "counter.add", path: "/public/teams/red-logistics/maintenanceDue", delta: -1 },
        { op: "log.append", target: "public.log", kind: "market", summary: "MOCK: Красная команда продала вагон за 2 монеты" }
      ]
    }
  },
  {
    id: "mock.market.finish",
    _type: "game.Action",
    _label: "Завершить рынок",
    _semantics: "Явно завершает тестовый рынок после покупок, продаж или пропуска.",
    handlerType: "manifest-data",
    capabilityFamily: "runtime.server",
    capability: "turn.phase.finish.market",
    displayName: "MOCK: завершить рынок",
    allowedSessionRoles: ["facilitator"],
    deterministic: {
      guard: { stateConditions: [{ path: "/public/session/phase", operator: "==", value: "market" }] },
      effects: [
        { op: "state.patch", patches: [{ op: "replace", path: "/public/session/phase", value: "cargo" }] },
        { op: "log.append", target: "public.log", kind: "phase", summary: "MOCK: ведущий завершил рынок" }
      ]
    }
  },
  {
    id: "mock.cargo.finish",
    _type: "game.Action",
    _label: "Завершить выбор грузов",
    _semantics: "Явно фиксирует отсутствие дополнительного выбора и переходит к операциям.",
    handlerType: "manifest-data",
    capabilityFamily: "runtime.server",
    capability: "turn.phase.finish.cargo",
    displayName: "MOCK: завершить выбор грузов",
    allowedSessionRoles: ["facilitator"],
    deterministic: {
      guard: { stateConditions: [{ path: "/public/session/phase", operator: "==", value: "cargo" }] },
      effects: [
        { op: "state.patch", patches: [{ op: "replace", path: "/public/session/phase", value: "operations" }] },
        { op: "log.append", target: "public.log", kind: "phase", summary: "MOCK: выбор грузов завершен" }
      ]
    }
  },
  {
    id: "mock.operations.finish",
    _type: "game.Action",
    _label: "Завершить операции",
    _semantics: "Явно пропускает оставшиеся единицы действия и открывает повторяемое строительство.",
    handlerType: "manifest-data",
    capabilityFamily: "runtime.server",
    capability: "turn.phase.finish.operations",
    displayName: "MOCK: завершить операции",
    allowedSessionRoles: ["facilitator"],
    deterministic: {
      guard: { stateConditions: [{ path: "/public/session/phase", operator: "==", value: "operations" }] },
      effects: [
        {
          op: "state.patch",
          patches: [
            { op: "replace", path: "/public/session/phase", value: "construction" },
            { op: "replace", path: "/public/construction/available", value: true }
          ]
        },
        { op: "log.append", target: "public.log", kind: "phase", summary: "MOCK: ведущий завершил операции" }
      ]
    }
  },
  {
    id: "mock.construction.open-control-projects",
    _type: "game.Action",
    _label: "Открыть построенную тестовую дорогу",
    _semantics: "На следующем ходу переводит известный проект контрольного сценария из строительства в открытую сеть.",
    handlerType: "manifest-data",
    capabilityFamily: "runtime.server",
    capability: "transport.construction.open",
    displayName: "MOCK: открыть проект предыдущего хода",
    allowedSessionRoles: ["facilitator"],
    deterministic: {
      guard: {
        stateConditions: [
          { path: "/public/session/phase", operator: "==", value: "news" },
          { path: "/public/session/turnNumber", operator: ">=", value: 4 },
          { path: "/public/objects/networkEdges/main:edge:1001/facets/state", operator: "==", value: "building" }
        ]
      },
      effects: [
        {
          op: "object.state.set",
          visibility: "public",
          collection: "networkEdges",
          objectId: "main:edge:1001",
          facet: "state",
          value: "open"
        },
        { op: "log.append", target: "public.log", kind: "construction", summary: "MOCK: дорога прошлого хода открыта для движения" }
      ]
    }
  },
  {
    id: "mock.debrief.pause.start",
    _type: "game.Action",
    _label: "Начать методическую паузу",
    _semantics: "Открывает неперсональный вопрос для обсуждения и не оценивает участников.",
    handlerType: "manifest-data",
    capabilityFamily: "runtime.server",
    capability: "facilitation.pause.start",
    displayName: "MOCK: начать методическую паузу",
    allowedSessionRoles: ["facilitator"],
    deterministic: {
      guard: { stateConditions: [{ path: "/public/session/phase", operator: "==", value: "debrief" }] },
      effects: [
        {
          op: "state.patch",
          patches: [
            { op: "replace", path: "/public/methodology/status", value: "active" },
            { op: "replace", path: "/public/methodology/activePauseId", value: "mock-pause-after-turn-3" }
          ]
        },
        { op: "log.append", target: "public.log", kind: "methodology", summary: "MOCK: ведущий начал методическую паузу" }
      ]
    }
  },
  ...["postpone", "skip"].map((decision) => ({
    id: `mock.debrief.pause.${decision}`,
    _type: "game.Action",
    _label: decision === "postpone" ? "Перенести методическую паузу" : "Пропустить методическую паузу",
    _semantics: "Фиксирует только решение ведущего, без персональной причины или оценки.",
    handlerType: "manifest-data",
    capabilityFamily: "runtime.server",
    capability: `facilitation.pause.${decision}`,
    displayName: decision === "postpone" ? "MOCK: перенести паузу" : "MOCK: пропустить паузу",
    allowedSessionRoles: ["facilitator"],
    deterministic: {
      guard: { stateConditions: [{ path: "/public/session/phase", operator: "==", value: "debrief" }] },
      effects: [
        {
          op: "state.patch",
          patches: [
            { op: "replace", path: "/public/methodology/status", value: decision },
            { op: "replace", path: "/public/methodology/activePauseId", value: null }
          ]
        },
        { op: "log.append", target: "public.log", kind: "methodology", summary: `MOCK: методическая пауза — ${decision}` }
      ]
    }
  })),
  {
    id: "mock.debrief.final-reflection",
    _type: "game.Action",
    _label: "Провести финальную рефлексию",
    _semantics: "Фиксирует факт неперсонального деролинга перед окончательным подтверждением результата.",
    handlerType: "manifest-data",
    capabilityFamily: "runtime.server",
    capability: "facilitation.reflection.final",
    displayName: "MOCK: финальная рефлексия",
    allowedSessionRoles: ["facilitator"],
    deterministic: {
      guard: { stateConditions: [{ path: "/public/session/phase", operator: "==", value: "debrief" }] },
      effects: [
        {
          op: "state.patch",
          patches: [{ op: "replace", path: "/public/methodology/status", value: "final-reflection" }]
        },
        { op: "log.append", target: "public.log", kind: "methodology", summary: "MOCK: проведена финальная рефлексия и деролинг" }
      ]
    }
  },
  {
    id: "mock.debrief.next-turn",
    _type: "game.Action",
    _label: "Начать следующий ход",
    _semantics: "Увеличивает номер хода без проверки лимита и возвращает игру к новостям.",
    handlerType: "manifest-data",
    capabilityFamily: "runtime.server",
    capability: "turn.next",
    displayName: "MOCK: следующий ход",
    allowedSessionRoles: ["facilitator"],
    deterministic: {
      guard: { stateConditions: [{ path: "/public/session/phase", operator: "==", value: "debrief" }] },
      effects: [
        { op: "counter.add", path: "/public/session/turnNumber", delta: 1 },
        {
          op: "state.patch",
          patches: [
            { op: "replace", path: "/public/session/phase", value: "news" },
            { op: "replace", path: "/public/construction/available", value: false },
            { op: "replace", path: "/public/methodology/status", value: "idle" },
            { op: "replace", path: "/public/methodology/activePauseId", value: null },
            { op: "replace", path: "/public/decks/news/currentCardId", value: null },
            { op: "replace", path: "/public/decks/cargo/offer", value: { firstCardId: null, secondCardId: null } }
          ]
        },
        {
          op: "object.attribute.patch",
          visibility: "public",
          collection: "locomotives",
          objectId: "mock-locomotive-purple-1",
          patches: [{ op: "replace", path: "/actionPoints", value: gameplay.operations.actionPointsPerLocomotive }]
        },
        {
          op: "object.attribute.patch",
          visibility: "public",
          collection: "locomotives",
          objectId: "mock-locomotive-green-1",
          patches: [{ op: "replace", path: "/actionPoints", value: gameplay.operations.actionPointsPerLocomotive }]
        },
        { op: "log.append", target: "public.log", kind: "turn", summary: "MOCK: ведущий начал следующий ход" }
      ]
    }
  }
]);

const fixedRefSchema = (collection, allowedTypes, objectId) => ({
  ...refSchema(collection, allowedTypes),
  enum: [objectId]
});

const phaseAndLogEffects = (phase, kind, summary, before = []) => ([
  ...before,
  { op: "state.patch", patches: [{ op: "replace", path: "/public/session/phase", value: phase }] },
  { op: "log.append", target: "public.log", kind, summary }
]);

/** Compose the accepted reusable deck, transport and ranking effects. */
const mockSharedContractActions = (gameplay) => {
  const newsApply = ({ id, cardId, summary, effects = [] }) => ({
    id,
    _type: "game.Action",
    _label: "Применить открытую test-only новость",
    _semantics: "Проверяет идентификатор уже открытой карты и применяет только объявленный ею mock-эффект.",
    handlerType: "manifest-data",
    capabilityFamily: "runtime.server",
    capability: "deck.news.apply",
    displayName: summary,
    allowedSessionRoles: ["facilitator"],
    deterministic: {
      guard: {
        stateConditions: [
          { path: "/public/session/phase", operator: "==", value: "news" },
          { path: "/public/decks/news/currentCardId", operator: "==", value: cardId }
        ]
      },
      effects: phaseAndLogEffects("maintenance", "news", summary, effects)
    }
  });

  return [
    {
      id: "mock.news.draw",
      _type: "game.Action",
      _label: "Открыть следующую тестовую новость",
      _semantics: "Выдает только текущую карту; будущий воспроизводимый порядок остается в secret.decks.",
      handlerType: "manifest-data",
      capabilityFamily: "runtime.server",
      capability: "deck.news.draw",
      displayName: "MOCK: открыть новость",
      allowedSessionRoles: ["facilitator"],
      deterministic: {
        guard: {
          stateConditions: [
            { path: "/public/session/phase", operator: "==", value: "news" },
            { path: "/public/decks/news/currentCardId", operator: "==", value: null }
          ]
        },
        effects: [
          {
            op: "deck.draw",
            deckId: "news",
            storePath: "/public/decks/news/currentCardId",
            onEmpty: "reshuffle-discard"
          },
          { op: "log.append", target: "public.log", kind: "news", summary: "MOCK: ведущий открыл следующую новость" }
        ]
      }
    },
    newsApply({
      id: "mock.news.apply.open-road",
      cardId: "mock-news-open-c-d",
      summary: "MOCK: новость снова открыла дорогу C–D",
      effects: [{
        op: "object.state.set",
        visibility: "public",
        collection: "networkEdges",
        objectId: "mock-edge-c-d",
        facet: "state",
        value: "open"
      }]
    }),
    newsApply({
      id: "mock.news.apply.held-cargo-prompt",
      cardId: "mock-news-costly-service",
      summary: "MOCK: открыта подсказка об удержании груза"
    }),
    newsApply({
      id: "mock.news.apply.cheap-wagons",
      cardId: "mock-news-cheap-wagons",
      summary: "MOCK: текущая цена покупки вагона снижена до 4 монет",
      effects: [{
        op: "state.patch",
        patches: [{ op: "replace", path: "/public/market/wagonPurchasePrice", value: 4 }]
      }]
    }),
    newsApply({
      id: "mock.news.apply.construction-prompt",
      cardId: "mock-news-construction-window",
      summary: "MOCK: открыта подсказка о совместном строительстве"
    }),
    newsApply({
      id: "mock.news.apply.stable-day",
      cardId: "mock-news-stable-day",
      summary: "MOCK: сеть работает без дополнительных изменений"
    }),
    {
      id: "mock.cargo.draw-offer",
      _type: "game.Action",
      _label: "Открыть две тестовые карты груза",
      _semantics: "Два последовательных server draw записывают только предложение; будущий порядок не раскрывается.",
      handlerType: "manifest-data",
      capabilityFamily: "runtime.server",
      capability: "deck.cargo.offer.draw",
      displayName: "MOCK: открыть два груза",
      allowedSessionRoles: ["facilitator"],
      deterministic: {
        guard: {
          stateConditions: [
            { path: "/public/session/phase", operator: "==", value: "cargo" },
            { path: "/public/decks/cargo/offer/firstCardId", operator: "==", value: null },
            { path: "/public/decks/cargo/offer/secondCardId", operator: "==", value: null }
          ]
        },
        effects: [
          {
            op: "deck.draw",
            deckId: "cargo",
            storePath: "/public/decks/cargo/offer/firstCardId",
            onEmpty: "reshuffle-discard"
          },
          {
            op: "deck.draw",
            deckId: "cargo",
            storePath: "/public/decks/cargo/offer/secondCardId",
            onEmpty: "reshuffle-discard"
          },
          { op: "log.append", target: "public.log", kind: "cargo", summary: "MOCK: ведущий открыл две карты груза" }
        ]
      }
    },
    {
      id: "mock.cargo.load.white",
      _type: "game.Action",
      _label: "Загрузить тестовый груз в свободный вагон",
      _semantics: "Общий эффект проверяет свободный вагон, состояние груза и совпадение узла отправления.",
      handlerType: "manifest-data",
      capabilityFamily: "runtime.server",
      capability: "transport.cargo.load",
      displayName: "MOCK: загрузить груз B–F в белый вагон",
      allowedSessionRoles: ["facilitator"],
      paramsSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          wagonId: fixedRefSchema("wagons", ["transport.wagon"], "mock-wagon-white-2"),
          cargoId: fixedRefSchema("cargoOrders", ["transport.cargo"], "mock-cargo-b-f")
        },
        required: ["wagonId", "cargoId"]
      },
      deterministic: {
        guard: {
          stateConditions: [
            { path: "/public/session/phase", operator: "==", value: "cargo" },
            {
              path: "/public/decks/cargo/offer/firstCardId",
              operator: "==",
              value: "mock-cargo-b-f"
            }
          ]
        },
        effects: [
          { op: "transport.cargo.load", networkId: "main", wagonParam: "wagonId", cargoParam: "cargoId" },
          {
            op: "counter.add",
            path: "/public/teams/white-logistics/maintenanceDue",
            delta: gameplay.maintenance.coinsPerHeldCargo
          },
          { op: "log.append", target: "public.log", kind: "cargo", summary: "MOCK: груз B–F загружен в белый вагон" }
        ]
      }
    },
    {
      id: "mock.cargo.deliver.b-f",
      _type: "game.Action",
      _label: "Доставить второй тестовый груз",
      _semantics: "Расчет использует кратчайший открытый маршрут B–F, затем автоматически отцепляет вагон и снимает обслуживание груза.",
      handlerType: "manifest-data",
      capabilityFamily: "runtime.server",
      capability: "transport.cargo.deliver",
      displayName: "MOCK: доставить груз B–F",
      allowedSessionRoles: ["facilitator"],
      paramsSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          wagonId: fixedRefSchema("wagons", ["transport.wagon"], "mock-wagon-white-2"),
          cargoId: fixedRefSchema("cargoOrders", ["transport.cargo"], "mock-cargo-b-f")
        },
        required: ["wagonId", "cargoId"]
      },
      deterministic: {
        guard: { stateConditions: [{ path: "/public/session/phase", operator: "==", value: "operations" }] },
        effects: [
          { op: "transport.cargo.deliver", networkId: "main", wagonParam: "wagonId", cargoParam: "cargoId" },
          {
            op: "counter.add",
            path: "/public/teams/white-logistics/maintenanceDue",
            delta: -gameplay.maintenance.coinsPerHeldCargo
          },
          { op: "log.append", target: "public.log", kind: "delivery", summary: "MOCK: груз B–F доставлен по кратчайшему открытому маршруту" }
        ]
      }
    },
    ...["attach", "detach"].map((operation) => ({
      id: `mock.operations.${operation}.white`,
      _type: "game.Action",
      _label: operation === "attach" ? "Прицепить тестовый вагон" : "Отцепить тестовый вагон",
      _semantics: "Общий транспортный эффект проверяет узел, совместимость и списывает одну единицу действия.",
      handlerType: "manifest-data",
      capabilityFamily: "runtime.server",
      capability: `transport.vehicle.${operation}`,
      displayName: operation === "attach" ? "MOCK: прицепить белый вагон" : "MOCK: отцепить белый вагон",
      allowedSessionRoles: ["facilitator"],
      paramsSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          vehicleId: fixedRefSchema("locomotives", ["transport.locomotive"], "mock-locomotive-purple-1"),
          wagonId: fixedRefSchema("wagons", ["transport.wagon"], "mock-wagon-white-2")
        },
        required: ["vehicleId", "wagonId"]
      },
      deterministic: {
        guard: { stateConditions: [{ path: "/public/session/phase", operator: "==", value: "operations" }] },
        effects: [
          {
            op: `transport.vehicle.${operation}`,
            networkId: "main",
            vehicleParam: "vehicleId",
            coupledVehicleParams: ["wagonId"]
          },
          { op: "log.append", target: "public.log", kind: "operations", summary: `MOCK: вагон ${operation === "attach" ? "прицеплен" : "отцеплен"}` }
        ]
      }
    })),
    {
      id: "mock.operations.attach.incompatible",
      _type: "game.Action",
      _label: "Попытаться прицепить несовместимый вагон",
      _semantics: "Негативная контрольная операция использует существующую технику и должна быть полностью отклонена.",
      handlerType: "manifest-data",
      capabilityFamily: "runtime.server",
      capability: "transport.vehicle.attach",
      displayName: "MOCK: проверить несовместимое сцепление",
      allowedSessionRoles: ["facilitator"],
      paramsSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          vehicleId: fixedRefSchema("locomotives", ["transport.locomotive"], "mock-locomotive-purple-1"),
          wagonId: fixedRefSchema("wagons", ["transport.incompatible-wagon"], "mock-wagon-red-1")
        },
        required: ["vehicleId", "wagonId"]
      },
      deterministic: {
        guard: { stateConditions: [{ path: "/public/session/phase", operator: "==", value: "operations" }] },
        effects: [{
          op: "transport.vehicle.attach",
          networkId: "main",
          vehicleParam: "vehicleId",
          coupledVehicleParams: ["wagonId"]
        }]
      }
    },
    {
      id: "mock.ranking.compute",
      _type: "game.Action",
      _label: "Рассчитать тестовые итоги",
      _semantics: "Общий расчет складывает деньги и объявленную номинальную стоимость активной техники отдельно по двум типам команд.",
      handlerType: "manifest-data",
      capabilityFamily: "runtime.server",
      capability: "ranking.compute",
      displayName: "MOCK: рассчитать два рейтинга",
      allowedSessionRoles: ["facilitator"],
      deterministic: {
        guard: { stateConditions: [{ path: "/public/session/phase", operator: "==", value: "debrief" }] },
        effects: [
          {
            op: "ranking.compute",
            participantCollectionPath: "/public/teams",
            balanceAttribute: "coins",
            groups: [
              { id: "logistics", participantIds: ["white-logistics", "red-logistics"] },
              { id: "guilds", participantIds: ["purple-guild", "green-guild"] }
            ],
            assetSources: [
              { collectionPath: "/public/objects/locomotives", ownerAttribute: "ownerTeamId", valueAttribute: "nominalValue" },
              { collectionPath: "/public/objects/wagons", ownerAttribute: "ownerTeamId", valueAttribute: "nominalValue" }
            ],
            storePath: "/public/ranking"
          },
          { op: "log.append", target: "public.log", kind: "ranking", summary: "MOCK: итоги рассчитаны отдельно для перевозчиков и гильдий" }
        ]
      }
    }
  ];
};

const replaceUiText = (node) => {
  if (!node || typeof node !== "object") return;
  if (node.id === "facilitator.content-gate") {
    node._label = "Предупреждение о тестовых данных";
    node._semantics = "Не дает ведущему принять вымышленный контент за сведения автора игры.";
    node.props.html = "<p><strong>MOCK — только разработка:</strong> сеть, области, грузы, выплаты и контрольные ходы вымышлены. Они будут полностью заменены после подтверждения автора.</p>";
  }
  if (Array.isArray(node.children)) node.children.forEach(replaceUiText);
};

/**
 * Build the ordinary DOM panels that accompany the Phaser dispatcher map.
 *
 * The mock UI is generated from the normative shell on every rebuild, so
 * game-local improvements must live here rather than only in the generated
 * authoring JSON. Keeping the panels declarative also provides keyboard and
 * screen-reader access to the same public snapshot shown on the canvas.
 */
const dispatcherUiComponents = () => ([
  {
    id: "facilitator.team-status",
    _type: "ui.Component",
    _label: "Команды, деньги и техника",
    _semantics: "Доступный текстовый дубль компактной панели Phaser; показывает только публичные деньги и фактические позиции тестовой техники.",
    type: "areaComponent",
    props: {
      cssClass: "cards-container topbar-cards-container",
      topbarCssClass: "topbar-cards-container"
    },
    children: [
      {
        id: "facilitator.team-status-copy",
        _type: "ui.Component",
        _label: "Текущее состояние четырех тестовых команд",
        _semantics: "Фиксированные идентификаторы принадлежат только тестовой игре; значения приходят из публичного snapshot.",
        type: "richTextComponent",
        props: {
          html: "<h2>Команды</h2><p><strong>Белая:</strong> {{game.state.public.teams.white-logistics.coins}} мон. · вагоны: {{game.state.public.objects.wagons.mock-wagon-white-1.attributes.nodeId}}, {{game.state.public.objects.wagons.mock-wagon-white-2.attributes.nodeId}}</p><p><strong>Красная:</strong> {{game.state.public.teams.red-logistics.coins}} мон. · вагоны: {{game.state.public.objects.wagons.mock-wagon-red-1.attributes.nodeId}}, {{game.state.public.objects.wagons.mock-wagon-red-2.attributes.nodeId}}</p><p><strong>Фиолетовая:</strong> {{game.state.public.teams.purple-guild.coins}} мон. · локомотив: {{game.state.public.objects.locomotives.mock-locomotive-purple-1.attributes.nodeId}}</p><p><strong>Зелёная:</strong> {{game.state.public.teams.green-guild.coins}} мон. · локомотив: {{game.state.public.objects.locomotives.mock-locomotive-green-1.attributes.nodeId}}</p>"
        }
      }
    ]
  },
  {
    id: "facilitator.action-guidance",
    _type: "ui.Component",
    _label: "Подсказка по доступным действиям",
    _semantics: "Объясняет источник доступности без дублирования или вычисления правил на клиенте.",
    type: "richTextComponent",
    props: {
      html: "<h2>Доступные действия</h2><p>Кнопки под картой приходят из игрового состояния. Недоступные операции блокирует сервер и, если передал объяснение, показывает причину рядом с кнопкой.</p>"
    }
  },
  {
    id: "facilitator.log",
    _type: "ui.Component",
    _label: "Журнал подтвержденных действий",
    _semantics: "Доступный текстовый журнал повторяет только записи, уже подтвержденные Runtime API.",
    type: "areaComponent",
    props: { cssClass: "board-game-log" },
    children: [
      {
        id: "facilitator.log-title",
        _type: "ui.Component",
        _label: "Заголовок журнала",
        _semantics: "Отделяет подтвержденную историю от текущих намерений ведущего.",
        type: "richTextComponent",
        props: { html: "<h2>Журнал</h2><p>Записи появляются только после успешного выполнения действия.</p>" }
      },
      {
        id: "facilitator.log-entries",
        _type: "ui.Component",
        _label: "Записи журнала",
        _semantics: "Повторяет публичный журнал по порядку, не интерпретируя правила игры.",
        type: "areaComponent",
        props: { cssClass: "board-game-log-entries" },
        itemTemplate: {
          collection: "{{game.state.public.log}}",
          itemKey: "logEntry"
        },
        children: [
          {
            id: "facilitator.log-entry",
            _type: "ui.Component",
            _label: "Подтвержденное действие",
            _semantics: "Показывает переданные сервером вид события и краткое описание.",
            type: "richTextComponent",
            props: { html: "<p><strong>{{logEntry.kind}}</strong> · {{logEntry.summary}}</p>" }
          }
        ]
      }
    ]
  }
]);

const findUiNode = (node, id) => {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findUiNode(child, id);
    if (found) return found;
  }
  return null;
};

const applyMockDispatcherUi = (screenRoot) => {
  const status = findUiNode(screenRoot, "facilitator.status");
  if (status) {
    status._semantics = "Короткая строка ориентации: статус, номер хода и текущая серверная фаза.";
    status.props.html = "<h1>Карты, деньги, поезда</h1><p><strong>Ход:</strong> {{game.state.public.session.turnNumber}} · <strong>Этап:</strong> {{game.state.public.session.phase}} · <strong>Сессия:</strong> {{game.state.public.session.status}} · <strong>Контент:</strong> тестовые данные</p>";
  }

  // Map-first screens no longer wrap the board and panels in the historical
  // `facilitator.main` column. Add mock-only status/log content to the declared
  // context layer so the generator follows the semantic workspace contract,
  // not one obsolete tree shape.
  const contextPanel = findUiNode(screenRoot, "facilitator.context-panel");
  if (!contextPanel || !Array.isArray(contextPanel.children)) {
    throw new Error("normative facilitator UI has no map-first context panel children");
  }
  const generatedIds = new Set(dispatcherUiComponents().map((component) => component.id));
  contextPanel.children = contextPanel.children
    .filter((component) => !generatedIds.has(component.id));
  contextPanel.children.push(...dispatcherUiComponents());
};

const build = async () => {
  const annotationPath = path.join(packageRoot, "annotations", "map-annotation.mock.json");
  const gameplayPath = path.join(packageRoot, "fixtures", "mock-gameplay-data.json");
  const annotation = await validateAnnotation(await readJson(annotationPath), annotationPath);
  const gameplayCore = await readJson(gameplayPath);
  const textContent = await loadMockTextContent();
  for (const importedField of ["newsCards", "cargoCards", "methodicalPauses", "roles", "instructions"]) {
    if (Object.hasOwn(gameplayCore, importedField)) {
      throw new Error(`mock-gameplay-data.json must not duplicate imported field "${importedField}"`);
    }
  }
  // Keep mechanical tuning separate from author-facing words. The merged
  // object preserves the manifest shape while the text input remains the
  // only editable source for cards, pauses, roles and instructions.
  const gameplay = {
    ...gameplayCore,
    newsCards: textContent.newsCards,
    cargoCards: textContent.cargoCards,
    methodicalPauses: textContent.methodicalPauses,
    roles: textContent.roles,
    instructions: textContent.instructions
  };
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
  game.root.content.data.rules.construction.roadGeometry =
    "server-planned-region-segment-minimum-v1";
  game.root.content.data.mockGameplay = gameplay;
  game.root.content.data.rules.movement.terminalLocomotiveCapacity =
    gameplay.operations.terminalLocomotiveCapacity;
  game.root.content.data.integrationReadiness = {
    status: "integrated-shared-runtime-contracts",
    requiredEffects: [
      "deck.shuffle",
      "deck.draw",
      "transport.cargo.load",
      "transport.vehicle.attach",
      "transport.vehicle.detach",
      "transport.cargo.deliver (shortest-route settlement)",
      "ranking.compute"
    ],
    invariant: "Only schema-validated reusable effects are emitted into the compiled manifest."
  };
  // The generated annotation fragment must remain a pure converter output.
  // Operation bindings are mock-package composition, so mutate a clone only.
  game.root.networkModels = structuredClone(network.networkModels);
  game.root.networkModels.main.movement = {
    vehicleCollection: "locomotives",
    vehicleObjectTypes: ["transport.locomotive"],
    vehicleStateFacet: "availability",
    movableVehicleStates: ["active"],
    locationAttribute: "nodeId",
    actionPointsAttribute: "actionPoints",
    traversableNodeStates: ["open"],
    traversableEdgeStates: ["open"],
    capacityCollection: "locomotives",
    capacityObjectTypes: ["transport.locomotive"],
    capacityLocationAttribute: "nodeId",
    maxVehiclesPerNode: gameplay.operations.terminalLocomotiveCapacity,
    coupledCollection: "wagons",
    coupledObjectTypes: ["transport.wagon", "transport.incompatible-wagon"],
    coupledStateFacet: "availability",
    couplableVehicleStates: ["active"],
    coupledVehicleAttribute: "attachedVehicleId",
    coupledLocationAttribute: "nodeId",
    compatibleCouplings: [
      { vehicleObjectType: "transport.locomotive", coupledObjectTypes: ["transport.wagon"] }
    ],
    maxCoupledVehicles: 8
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
    cargoOriginAttribute: "fromNodeId",
    cargoStateFacet: "status",
    loadableCargoStates: ["available"],
    loadedCargoState: "in_transit",
    deliverableCargoStates: ["in_transit"],
    deliveredCargoState: "delivered",
    payoutAttribute: "payout",
    ownerParticipantIdAttribute: "ownerTeamId",
    participantCollectionPath: "/public/teams",
    participantBalanceAttribute: "coins",
    tariffPerEdge: gameplay.operations.tariffPerShortestRouteEdge,
    settledRouteLengthAttribute: "settledRouteLength"
  };
  game.root.objectTypes = { ...game.root.objectTypes, ...operationObjectTypes };

  const publicState = game.root.state.public;
  publicState.session.fixtureId = "development-mock";
  publicState.session.contentMode = "mock";
  publicState.session.phase = "setup";
  publicState.construction.available = false;
  publicState.methodology = { status: "idle", activePauseId: null };
  publicState.market = { wagonPurchasePrice: gameplay.market.prices.wagon.purchase };
  publicState.ranking = null;
  publicState.decks = {
    news: { currentCardId: null },
    cargo: {
      offer: { firstCardId: null, secondCardId: null }
    }
  };
  // Package composition adds mutable session state that is intentionally not
  // part of the reusable annotation fragment. Clone the converter output so
  // this addition cannot mutate `network` through a shared object reference
  // before the pure fragment is written below.
  publicState.transportNetworks = structuredClone(network.state.public.transportNetworks);
  publicState.transportNetworks.main.excludedRegionIds = [];
  publicState.teams = Object.fromEntries(gameplay.teams.map((team) => [team.id, {
    label: team.label,
    type: team.type,
    coins: team.coins,
    maintenanceDue:
      team.vehicles.length * gameplay.maintenance.coinsPerVehicle +
      team.vehicles.filter((vehicle) => vehicle.cargoId).length * gameplay.maintenance.coinsPerHeldCargo
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
      settledRouteLength: null
    }
  }]));
  publicState.objects = {
    networkNodes: network.state.public.objects.networkNodes,
    networkEdges: network.state.public.objects.networkEdges,
    locomotives: vehicles.locomotives,
    wagons: vehicles.wagons,
    cargoOrders,
    // The card catalogue is public; only the shuffled future order is secret.
    // This avoids relying on legacy projection behavior for arbitrary secret
    // object collections while still protecting the next card.
    newsCards: Object.fromEntries(gameplay.newsCards.map((card) => [card.id, {
      objectType: "mock.news-card",
      facets: { availability: "hidden" },
      attributes: structuredClone(card)
    }])),
    cargoCards: Object.fromEntries(gameplay.cargoCards.map((card) => [card.id, {
      objectType: "mock.cargo-card",
      facets: { availability: "hidden" },
      attributes: structuredClone(card)
    }]))
  };
  game.root.state.secret = {
    random: {
      alg: "xoshiro128ss-v1",
      seed: gameplay.decks.controlSeed,
      counter: 0
    },
    decks: {}
  };
  publicState.board = {
    ...publicState.board,
    ...network.state.public.board,
    availableActions: [
      {
        id: "mock-start-session",
        label: "MOCK: подтвердить команды и начать игру",
        actionId: "mock.setup.start",
        phase: "setup",
        section: "session"
      },
      {
        id: "mock-draw-news",
        label: "MOCK: открыть следующую новость",
        actionId: "mock.news.draw",
        phase: "news",
        section: "news",
        disabledReason: "Сначала примените уже открытую новость."
      },
      {
        id: "mock-apply-news-block-road",
        label: "Применить открытую карту: закрыть C–D",
        actionId: "mock.news.apply.block-road",
        phase: "news",
        section: "news",
        disabledReason: "Сначала откройте эту новость."
      },
      ...[
        ["open-road", "Применить открытую карту: открыть C–D"],
        ["held-cargo-prompt", "Применить открытую карту: обсуждение груза"],
        ["cheap-wagons", "Применить открытую карту: дешёвые вагоны"],
        ["construction-prompt", "Применить открытую карту: обсудить строительство"],
        ["stable-day", "Применить открытую карту: стабильная работа"]
      ].map(([id, label]) => ({
        id: `mock-apply-news-${id}`,
        label,
        actionId: `mock.news.apply.${id}`,
        phase: "news",
        section: "news",
        disabledReason: "Сначала откройте эту новость."
      })),
      {
        id: "mock-pay-maintenance",
        label: "MOCK: оплатить обслуживание техники",
        actionId: "mock.maintenance.pay",
        phase: "maintenance",
        section: "economy"
      },
      {
        id: "mock-buy-white-wagon",
        label: "MOCK: Белая покупает вагон за 5 монет",
        actionId: "mock.market.buy.white-wagon",
        phase: "market",
        section: "market"
      },
      {
        id: "mock-sell-red-wagon",
        label: "MOCK: Красная продает вагон за 2 монеты",
        actionId: "mock.market.sell.red-wagon",
        phase: "market",
        section: "market"
      },
      {
        id: "mock-finish-market",
        label: "MOCK: завершить рынок",
        actionId: "mock.market.finish",
        phase: "market",
        section: "phase"
      },
      {
        id: "mock-draw-cargo-offer",
        label: "MOCK: открыть две карты груза",
        actionId: "mock.cargo.draw-offer",
        phase: "cargo",
        section: "cargo"
      },
      {
        id: "mock-load-white-cargo",
        label: "MOCK: загрузить груз B–F в белый вагон",
        actionId: "mock.cargo.load.white",
        phase: "cargo",
        section: "cargo",
        params: { wagonId: "mock-wagon-white-2", cargoId: "mock-cargo-b-f" }
      },
      {
        id: "mock-finish-cargo",
        label: "MOCK: завершить выбор грузов",
        actionId: "mock.cargo.finish",
        phase: "cargo",
        section: "phase"
      },
      {
        id: "mock-attach-white-wagon",
        label: "MOCK: прицепить второй белый вагон",
        actionId: "mock.operations.attach.white",
        phase: "operations",
        section: "operations",
        params: { vehicleId: "mock-locomotive-purple-1", wagonId: "mock-wagon-white-2" }
      },
      {
        id: "mock-detach-white-wagon",
        label: "MOCK: отцепить второй белый вагон",
        actionId: "mock.operations.detach.white",
        phase: "operations",
        section: "operations",
        params: { vehicleId: "mock-locomotive-purple-1", wagonId: "mock-wagon-white-2" }
      },
      {
        id: "mock-move-purple-b-c",
        label: "MOCK: перевести фиолетовый локомотив B–C",
        actionId: "mock.locomotive.move",
        phase: "operations",
        section: "operations",
        params: { vehicleId: "mock-locomotive-purple-1", edgeId: "mock-edge-b-c" }
      },
      {
        id: "mock-deliver-b-c",
        label: "MOCK: доставить груз B–C",
        actionId: "mock.cargo.deliver",
        phase: "operations",
        section: "operations",
        params: { wagonId: "mock-wagon-white-1", cargoId: "mock-cargo-b-c" }
      },
      {
        id: "mock-deliver-b-f",
        label: "MOCK: доставить груз B–F",
        actionId: "mock.cargo.deliver.b-f",
        phase: "operations",
        section: "operations",
        params: { wagonId: "mock-wagon-white-2", cargoId: "mock-cargo-b-f" }
      },
      {
        id: "mock-finish-operations",
        label: "MOCK: завершить операции",
        actionId: "mock.operations.finish",
        phase: "operations",
        section: "phase"
      },
      {
        id: "mock-build-road-b-d",
        label: "MOCK: построить дорогу B–D (6 монет)",
        description: "Вымышленный контроль: три области, по 2 монеты за сегмент.",
        actionId: "construction.road.build",
        phase: "construction",
        section: "construction",
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
        phase: "construction",
        section: "construction",
        params: {
          edgeId: "mock-edge-a-b",
          positionT: 0.5,
          whiteContribution: 3,
          redContribution: 2,
          purpleContribution: 0,
          greenContribution: 0
        }
      },
      {
        id: "mock-finish-construction",
        label: "Завершить строительство",
        actionId: "construction.phase.finish",
        phase: "construction",
        section: "phase"
      },
      {
        id: "mock-start-methodical-pause",
        label: "MOCK: начать методическую паузу",
        actionId: "mock.debrief.pause.start",
        phase: "debrief",
        section: "methodology"
      },
      {
        id: "mock-postpone-methodical-pause",
        label: "MOCK: перенести методическую паузу",
        actionId: "mock.debrief.pause.postpone",
        phase: "debrief",
        section: "methodology"
      },
      {
        id: "mock-skip-methodical-pause",
        label: "MOCK: пропустить методическую паузу",
        actionId: "mock.debrief.pause.skip",
        phase: "debrief",
        section: "methodology"
      },
      {
        id: "mock-next-turn",
        label: "Начать следующий ход",
        actionId: "mock.debrief.next-turn",
        phase: "debrief",
        section: "session"
      },
      {
        id: "mock-compute-ranking",
        label: "MOCK: рассчитать итоги по двум группам",
        actionId: "mock.ranking.compute",
        phase: "debrief",
        section: "session"
      },
      {
        id: "mock-final-reflection",
        label: "MOCK: провести финальную рефлексию",
        actionId: "mock.debrief.final-reflection",
        phase: "debrief",
        section: "methodology"
      },
      {
        id: "mock-request-finish",
        label: "Завершить игру…",
        actionId: "session.finish.request",
        phase: "debrief",
        section: "session"
      }
    ]
  };

  const pending = game.root.logic.pendingActions ?? [];
  const operatingActions = mockOperatingActions();
  const independentActions = mockIndependentSessionActions(gameplay);
  const sharedContractActions = mockSharedContractActions(gameplay);
  game.root.logic.actions = [
    ...independentActions,
    ...sharedContractActions,
    ...operatingActions,
    ...pending,
    ...game.root.logic.actions
  ];
  const finishConstruction = game.root.logic.actions.find((action) => action.id === "construction.phase.finish");
  const finishConstructionPhasePatch = finishConstruction?.deterministic?.effects
    ?.find((effect) => effect.op === "state.patch")?.patches
    ?.find((patch) => patch.path === "/public/session/phase");
  if (!finishConstructionPhasePatch) throw new Error("construction finish phase patch is missing");
  finishConstructionPhasePatch.value = "debrief";
  delete game.root.logic.pendingActions;
  delete game.root.logic.pendingActionReason;
  for (const flow of game.root.logic.flows ?? []) {
    for (const step of flow.steps ?? []) {
      if (step.id === "facilitator.setup") {
        step.actionIds = [
          ...independentActions.map((action) => action.id),
          ...sharedContractActions.map((action) => action.id),
          ...operatingActions.map((action) => action.id),
          ...step.actionIds
        ];
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
    applyMockDispatcherUi(screen.root);
  }

  await writeImportedMockTextContent();
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
