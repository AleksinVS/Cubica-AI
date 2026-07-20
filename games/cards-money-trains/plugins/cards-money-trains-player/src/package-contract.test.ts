/** Focused invariants for the compiled game package and its bounded fixtures. */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const readJson = (relativePath: string) =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as Record<string, unknown>;

test("compiled manifest exposes safe setup and server-owned movement controls", () => {
  const manifest = readJson("../../../game.manifest.json");
  const config = manifest.config as Record<string, unknown>;
  const actions = manifest.actions as Record<string, Record<string, unknown>>;
  const networkModels = manifest.networkModels as Record<string, Record<string, unknown>>;
  const mainNetwork = networkModels.main;
  const regions = mainNetwork.regions as Array<Record<string, unknown>>;
  const content = manifest.content as Record<string, unknown>;
  const contentData = content.data as Record<string, unknown>;
  const constructionCycle = contentData.constructionCycle as Record<string, unknown>;
  const regionData = constructionCycle.regionData as Record<string, unknown>;
  const state = manifest.state as Record<string, unknown>;
  const publicState = state.public as Record<string, unknown>;
  const session = publicState.session as Record<string, unknown>;
  const construction = publicState.construction as Record<string, unknown>;
  const board = publicState.board as Record<string, unknown>;
  const boardActions = board.availableActions as Array<Record<string, unknown>>;
  const objects = publicState.objects as Record<string, unknown>;
  const teams = objects.teams as Record<string, Record<string, unknown>>;
  const setup = publicState.setup as Record<string, unknown>;

  assert.equal(config.sessionMode, "facilitated");
  assert.equal(mainNetwork.nodeCollection, "networkNodes");
  assert.equal(mainNetwork.edgeCollection, "networkEdges");
  // Construction currently proves server-side multi-region routing with
  // explicitly non-publishable strips. The exact author polygons replace
  // these fixtures before publication; one whole-board region is no longer
  // an accurate representation of the executable technical package.
  assert.equal(regions.length, 20);
  assert.deepEqual(
    regions.map((region) => region.id),
    Array.from(
      { length: 20 },
      (_, index) => `technical-placeholder-region-${String(index + 1).padStart(2, "0")}`
    )
  );
  assert.deepEqual(regionData, {
    provenance: "generated technical placeholder; not author geography",
    geometryVersion: "technical-placeholder-vertical-strips-v1",
    regionCount: 20,
    replaceBeforePublication: true
  });
  assert.equal(config.runtimeReady, false);
  assert.deepEqual(
    (actions["construction.road.build"]?.paramsSchema as Record<string, unknown>)
      ?.required,
    ["fromNodeId", "toNodeId"]
  );
  assert.deepEqual(
    actions["construction.road.build"]?.allowedSessionRoles,
    ["facilitator"]
  );
  assert.equal(
    (actions["construction.road.build"]?.binding as Record<string, unknown>)
      ?.planRef,
    "construction.road.build"
  );
  assert.deepEqual(
    (actions["construction.waypoint.build"]?.paramsSchema as Record<string, unknown>)
      ?.required,
    ["edgeId", "positionT"]
  );
  assert.deepEqual(
    actions["construction.waypoint.build"]?.allowedSessionRoles,
    ["facilitator"]
  );
  assert.deepEqual(
    (actions["movement.locomotive.traverse"]?.paramsSchema as Record<string, unknown>)
      ?.required,
    ["edgeId"]
  );
  assert.deepEqual(
    actions["movement.locomotive.traverse"]?.allowedSessionRoles,
    ["facilitator"]
  );
  assert.deepEqual(actions["construction.phase.finish"]?.allowedSessionRoles, ["facilitator"]);
  assert.deepEqual(actions["session.finish.confirm"]?.allowedSessionRoles, ["facilitator"]);
  assert.equal(session.fixtureId, "normal-start-policy");
  assert.equal(session.phase, "setup");
  assert.equal(construction.available, false);
  assert.deepEqual(teams, {});
  assert.equal(setup.status, "configuration");
  assert.deepEqual(setup.placementOrder, []);
  assert.equal(setup.currentTeamId, "");
  assert.deepEqual(
    boardActions.filter((candidate) =>
      typeof candidate.actionId === "string"
      && candidate.actionId.startsWith("movement.")),
    [
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
        id: "movement-train-wagon-select",
        label: "Отметить вагон",
        description:
          "Выберите один публичный вагон; текущий локомотив и допустимость проверит сервер.",
        actionId: "movement.train.wagon.select",
        phase: "operations",
        section: "movement"
      },
      {
        id: "movement-train-wagon-unselect",
        label: "Снять отметку с вагона",
        description: "Выберите ранее отмеченный вагон текущего локомотива.",
        actionId: "movement.train.wagon.unselect",
        phase: "operations",
        section: "movement"
      },
      {
        id: "movement-train-attach-selected",
        label: "Прицепить отмеченные вагоны",
        description:
          "Подтверждает всю серверную группу за одну единицу хода текущего локомотива.",
        actionId: "movement.train.attach.selected",
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
    ]
  );
  assert.deepEqual(
    (actions["movement.train.wagon.select"]?.paramsSchema as Record<string, unknown>)
      ?.required,
    ["wagonId"]
  );
  assert.deepEqual(
    (actions["movement.train.wagon.unselect"]?.paramsSchema as Record<string, unknown>)
      ?.required,
    ["wagonId"]
  );
  assert.deepEqual(actions["movement.train.attach.selected"]?.paramsSchema, {
    type: "object",
    additionalProperties: false,
    properties: {},
    required: []
  });
  assert.equal(actions["session.setup.team.add.logistics-company"]?.paramsSchema !== undefined, true);
  assert.equal(
    (actions["session.setup.finalize"]?.binding as Record<string, unknown> | undefined)
      ?.planRef,
    "session.setup.finalize"
  );
});

test("normal-start policy and demonstration fixture stay explicitly distinct", () => {
  const normal = readJson("../../../authoring/fixtures/normal-start-policy.json");
  const demonstration = readJson("../../../authoring/fixtures/demonstration-start.json");
  const teamTypes = normal.teamTypes as Record<string, Record<string, unknown>>;
  const teams = demonstration.teams as Array<Record<string, unknown>>;

  assert.equal(normal.startingCoinsPerTeam, 10);
  assert.equal(teamTypes.logistics_company?.startingWagons, 2);
  assert.equal(teamTypes.locomotive_guild?.startingLocomotives, 1);
  assert.equal(demonstration.specialFixture, true);
  assert.deepEqual(teams.map((team) => team.coins), [10, 2, 1, 5]);
  assert.equal((demonstration.contentStatus as Record<string, unknown>).initialTopology, "not-provided");
});

test("ADR-063 registry stays minimal while provenance verifies the optimized derivative", () => {
  const registry = readJson("../../../assets/assets.json");
  const provenance = readJson("../../../asset-provenance.json");
  const assets = registry.assets as Array<Record<string, unknown>>;
  const asset = assets[0];
  const delivery = provenance.delivery as Record<string, unknown>;
  const image = readFileSync(new URL("../../../assets/images/guinea-map.webp", import.meta.url));
  const digest = createHash("sha256").update(image).digest("hex");

  assert.deepEqual(Object.keys(registry).sort(), ["assets", "gameId"]);
  assert.deepEqual(Object.keys(asset ?? {}).sort(), ["file", "id", "kind", "origin"]);
  assert.equal(asset?.id, "board-guinea-optimized");
  assert.equal(asset?.file, "images/guinea-map.webp");
  assert.equal(digest, delivery.sha256);
  assert.equal((provenance.rights as Record<string, unknown>).status, "confirmed");
  assert.equal((provenance.rights as Record<string, unknown>).publicationAllowed, true);
  assert.equal((provenance.rights as Record<string, unknown>).modificationAllowed, true);
});

test("normative board declarations stay aligned with the 5079 by 3627 author plane", () => {
  const manifest = readJson("../../../game.manifest.json");
  const ui = readJson("../../../ui/web/ui.manifest.json");
  const provenance = readJson("../../../asset-provenance.json");
  const content = ((manifest.content as Record<string, unknown>).data as Record<string, unknown>);
  const board = content.board as Record<string, unknown>;
  const state = manifest.state as Record<string, unknown>;
  const publicState = state.public as Record<string, unknown>;
  const runtimeBoard = publicState.board as Record<string, unknown>;
  const bounds = runtimeBoard.canonicalBounds as Record<string, unknown>;
  const screens = ui.screens as Record<string, Record<string, unknown>>;
  const root = screens.facilitator.root as Record<string, unknown>;
  const children = root.children as Array<Record<string, unknown>>;
  const boardZone = children.find((child) =>
    (child.props as Record<string, unknown> | undefined)?.workspaceSlot === "board"
  );
  const surface = (boardZone?.children as Array<Record<string, unknown>> | undefined)?.[0];
  const surfaceProps = surface?.props as Record<string, unknown> | undefined;
  const source = provenance.source as Record<string, unknown>;

  assert.deepEqual(
    { width: board.designWidth, height: board.designHeight },
    { width: 5079, height: 3627 }
  );
  assert.deepEqual(
    { width: surfaceProps?.designWidth, height: surfaceProps?.designHeight },
    { width: board.designWidth, height: board.designHeight }
  );
  assert.deepEqual(
    { width: bounds.maxX, height: bounds.maxY },
    { width: board.designWidth, height: board.designHeight }
  );
  assert.deepEqual(
    { width: source.width, height: source.height },
    { width: board.designWidth, height: board.designHeight }
  );
});
