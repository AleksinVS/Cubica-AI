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
          ...(vehicle.kind === "locomotive"
            ? {
                actionPoints: vehicle.actionPoints ?? 0,
                // Active owned locomotives contribute to the team's turn-order
                // count. A numeric flag makes the later aggregate declarative.
                turnOrderCount: 1
              }
            : {}),
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
        ...(vehicle.kind === "locomotive"
          ? {
              actionPoints: vehicle.actionPoints ?? 0,
              // Reserve stock already names its future owner for purchasing,
              // but must not strengthen that team's ordering tie-break yet.
              turnOrderCount: 0
            }
          : {})
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
            props: { html: "<p><strong>{{logEntry.data.kind}}</strong> · {{logEntry.summary}}</p>" }
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
  const mechanicsPath = path.join(packageRoot, "authoring", "mechanics.source.json");
  const annotation = await validateAnnotation(await readJson(annotationPath), annotationPath);
  const gameplayCore = await readJson(gameplayPath);
  // Game actions and plans are maintained as declarative data. The builder
  // composes them with generated content without recreating an imperative,
  // game-specific effect language in this tool.
  const mechanicsSource = await readJson(mechanicsPath);
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
  // Session launch reads only the schema-backed config gate. The mock has a
  // complete synthetic vertical slice, so it intentionally overrides the
  // normative package's authoring blockers without copying a second marker.
  game.root.config.runtimeReady = true;
  delete game.root.config.runtimeBlockers;
  game.root.content.data.mockNotice = {
    testOnly: true,
    normativeGameId: "cards-money-trains",
    replaceBeforePublication: true,
    warning: annotation.warning
  };
  game.root.content.data.board.deliveryAssetId = "board-guinea-optimized";
  game.root.content.data.board.designWidth = annotation.coordinateSystem.width;
  game.root.content.data.board.designHeight = annotation.coordinateSystem.height;
  game.root.content.data.mapAnnotation = network.generatedFrom;
  game.root.content.data.rules.construction.roadGeometry =
    "server-planned-region-segment-minimum-v1";
  game.root.content.data.mockGameplay = gameplay;
  game.root.content.data.rules.movement.terminalLocomotiveCapacity =
    gameplay.operations.terminalLocomotiveCapacity;
  game.root.content.data.integrationReadiness = {
    status: "integrated-shared-runtime-contracts",
    requiredMechanicsOperations: [
      "core.collection.id.allocate",
      "core.entities.order",
      "core.entities.score",
      "deck.shuffle",
      "deck.draw",
      "deck.extract",
      "deck.return",
      "graph.regions.route.plan",
      "graph.edge.position.inspect",
      "graph.edge.split",
      "graph.entity.traverse",
      "graph.shortestPath",
      "relation.attach",
      "relation.detach",
      "core.ranking.stable"
    ],
    invariant: "Only schema-validated, module-locked Mechanics IR plans are emitted into the compiled manifest."
  };
  // The generated annotation fragment must remain a pure converter output.
  // Operation bindings are mock-package composition, so mutate a clone only.
  game.root.networkModels = structuredClone(network.networkModels);
  // Construction prices and lifecycle are game rules lowered into Mechanics
  // plans. Keeping them out of the graph model prevents the universal graph
  // module from silently charging money or advancing game-specific phases.
  game.root.networkModels.main.buildableNodeStates = ["open", "building"];
  game.root.networkModels.main.movement = {
    vehicleCollection: "locomotives",
    vehicleObjectTypes: ["transport.locomotive"],
    vehicleStateFacet: "availability",
    movableVehicleStates: ["active"],
    locationAttribute: "nodeId",
    traversableNodeStates: ["open"],
    traversableEdgeStates: ["open"],
    capacityCollection: "locomotives",
    capacityObjectTypes: ["transport.locomotive"],
    capacityLocationAttribute: "nodeId",
    capacityStateFacet: "availability",
    capacityOccupyingStates: ["active"],
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
  game.root.objectTypes = { ...game.root.objectTypes, ...operationObjectTypes };
  // The optional lifecycle uses a visible but non-interactive waypoint state
  // until its declared activation turn. The runtime knows only the declarative
  // facet value, while presentation remains game authoring data.
  game.root.objectTypes["transport.waypoint"].facets.availability.values.building = {
    visible: true,
    interactive: false,
    view: { visualState: "pending" }
  };

  const publicState = game.root.state.public;
  publicState.session.fixtureId = "development-mock";
  publicState.session.contentMode = "mock";
  publicState.session.phase = "setup";
  // Runtime calculates this list from active objects when cargo selection
  // finishes. The browser only presents the saved authoritative result.
  publicState.session.locomotiveOrder = [];
  publicState.construction.available = false;
  publicState.methodology = { status: "idle", activePauseId: null };
  publicState.market = { wagonPurchasePrice: gameplay.market.prices.wagon.purchase };
  // Ranking is a typed record from session creation onward. The game plan
  // composes neutral scoring and stable-order operations, then replaces this
  // empty group map atomically; no nullable compatibility shape is needed.
  publicState.ranking = { groups: {} };
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
      alg: "xoshiro128ss-streams-v1",
      seed: gameplay.decks.controlSeed,
      counters: {}
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
        label: "MOCK: загрузить предложенный груз",
        description: "Выберите активный вагон и одну из двух открытых карт груза.",
        actionId: "mock.cargo.load.white",
        phase: "cargo",
        section: "cargo"
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
        label: "MOCK: прицепить выбранный вагон",
        description: "Выберите активный локомотив и активный вагон; допустимость сцепления проверит сервер.",
        actionId: "mock.operations.attach.white",
        phase: "operations",
        section: "operations"
      },
      {
        id: "mock-detach-white-wagon",
        label: "MOCK: отцепить выбранный вагон",
        description: "Выберите активный локомотив и активный вагон; текущее сцепление проверит сервер.",
        actionId: "mock.operations.detach.white",
        phase: "operations",
        section: "operations"
      },
      {
        id: "mock-move-locomotive",
        label: "MOCK: переместить выбранный локомотив",
        description: "Сначала выберите активный локомотив и существующую дорогу на карте или в форме.",
        actionId: "mock.locomotive.move",
        phase: "operations",
        section: "operations"
      },
      {
        id: "mock-deliver-cargo",
        label: "MOCK: доставить выбранный груз",
        description: "Выберите активный вагон и публичный грузовой заказ; маршрут и право доставки проверит сервер.",
        actionId: "mock.cargo.deliver",
        phase: "operations",
        section: "operations"
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
        id: "mock-build-waypoint-e-f",
        label: "MOCK: поставить полустанок на E–F (5 монет)",
        description: "Вымышленный контроль: точка посередине дороги лежит вне областей обоих конечных терминалов.",
        actionId: "construction.waypoint.build",
        phase: "construction",
        section: "construction",
        params: {
          edgeId: "mock-edge-e-f",
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

  game.root.logic.actions = structuredClone(mechanicsSource.actions);
  game.root.mechanics = structuredClone(mechanicsSource.mechanics);
  delete game.root.logic.pendingActions;
  delete game.root.logic.pendingActionReason;
  for (const flow of game.root.logic.flows ?? []) {
    for (const step of flow.steps ?? []) {
      const actionIds = mechanicsSource.flowActionIds?.[step.id];
      if (Array.isArray(actionIds)) step.actionIds = [...actionIds];
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
