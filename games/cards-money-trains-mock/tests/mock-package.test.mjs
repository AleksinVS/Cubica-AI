/** Focused tests for the game-local annotation pipeline and runtime transcript. */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateGameManifest } from "../../../services/runtime-api/src/modules/content/manifestValidation.ts";
import {
  getGameAssetFile,
  getGameAssetIndex,
  getPublishedPlayerWebPluginBundleSource,
  loadPlayerFacingContent
} from "../../../services/runtime-api/src/modules/content/contentService.ts";
import { dispatchRuntimeAction } from "../../../services/runtime-api/src/modules/runtime/actionDispatcher.ts";
import { InMemorySessionStore } from "../../../services/runtime-api/src/modules/session/inMemorySessionStore.ts";
import {
  toManifestFragment,
  toReviewOverlaySvg,
  validateAnnotation
} from "../tools/convert-map-annotation.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(packageRoot, relativePath), "utf8"));

test("mock annotation validates and reproduces the committed manifest fragment", async () => {
  const annotationPath = path.join(packageRoot, "annotations", "map-annotation.mock.json");
  const annotation = await validateAnnotation(await readJson("annotations/map-annotation.mock.json"), annotationPath);
  const fragment = toManifestFragment(annotation);
  assert.deepEqual(fragment, await readJson("generated/network.manifest-fragment.json"));
  assert.equal(fragment.networkModels.main.regions[0].polygon.length, 4);
  assert.notDeepEqual(fragment.networkModels.main.regions[0].polygon[0], fragment.networkModels.main.regions[0].polygon.at(-1));
});

test("review overlay contains the source image underneath regions, roads and nodes", async () => {
  const annotation = await readJson("annotations/map-annotation.mock.json");
  const svg = toReviewOverlaySvg(annotation, { backgroundHref: "../assets/images/mock-board.svg" });
  assert.match(svg, /<image href="\.\.\/assets\/images\/mock-board\.svg"/);
  assert.match(svg, /<polygon /);
  assert.match(svg, /<line /);
  assert.match(svg, /<circle /);
  assert.ok(svg.indexOf("<image ") < svg.indexOf("<polygon "), "background must be emitted before annotations");
  assert.throws(() => toReviewOverlaySvg(annotation, { backgroundHref: "https://example.invalid/map.png" }), /local relative path/);
});

test("semantic validation rejects dangling references, out-of-bounds points and self-intersections", async () => {
  const source = await readJson("annotations/map-annotation.mock.json");
  const inputPath = path.join(packageRoot, "annotations", "map-annotation.mock.json");

  const dangling = structuredClone(source);
  dangling.edges[0].toNodeId = "missing-node";
  await assert.rejects(validateAnnotation(dangling, inputPath), /missing toNodeId/);

  const outside = structuredClone(source);
  outside.nodes[0].position.x = 99999;
  await assert.rejects(validateAnnotation(outside, inputPath), /outside/);

  const crossed = structuredClone(source);
  crossed.regions[0].polygon = [
    { x: 50, y: 50 }, { x: 400, y: 400 }, { x: 50, y: 400 }, { x: 350, y: 50 }, { x: 50, y: 50 }
  ];
  await assert.rejects(validateAnnotation(crossed, inputPath), /self-intersects/);
});

test("compiled mock executes the documented operating and construction transcript", async () => {
  const manifest = validateGameManifest(await readJson("game.manifest.json"));
  const transcript = await readJson("fixtures/control-transcript.json");
  const store = new InMemorySessionStore();
  const session = await store.createSession({
    gameId: manifest.meta.id,
    sessionRole: "facilitator",
    initialState: structuredClone(manifest.state)
  });
  const bundle = { gameId: manifest.meta.id, manifest };

  for (const step of transcript.steps) {
    await dispatchRuntimeAction({
      sessionStore: store,
      bundle,
      input: {
        sessionId: session.sessionId,
        actionId: step.actionId,
        ...(step.params ? { params: step.params } : {})
      }
    });
  }

  const current = await store.getSession(session.sessionId);
  const publicState = current.state.public;
  assert.equal(current.version.stateVersion, 7);
  assert.equal(publicState.session.phase, "reporting");
  assert.equal(publicState.construction.available, false);
  assert.deepEqual(
    Object.fromEntries(Object.entries(publicState.teams).map(([id, team]) => [id, team.coins])),
    { "white-logistics": 10, "red-logistics": 4, "purple-guild": 10, "green-guild": 8 }
  );
  assert.equal(publicState.objects.networkEdges["mock-edge-c-d"].facets.state, "blocked");
  assert.equal(publicState.objects.locomotives["mock-locomotive-purple-1"].attributes.nodeId, "mock-terminal-c");
  assert.equal(publicState.objects.locomotives["mock-locomotive-purple-1"].attributes.actionPoints, 4);
  assert.equal(publicState.objects.wagons["mock-wagon-white-1"].attributes.attachedVehicleId, null);
  assert.equal(publicState.objects.wagons["mock-wagon-white-1"].attributes.cargoId, null);
  assert.equal(publicState.objects.cargoOrders["mock-cargo-b-c"].facets.status, "delivered");
  assert.equal(publicState.log.length, 5);
  assert.equal(publicState.objects.networkEdges["mock-edge-a-b"], undefined);
  assert.equal(publicState.objects.networkEdges["main:edge:1001"].attributes.constructionCost, 6);
  assert.equal(publicState.objects.networkNodes["main:node:1002"].objectType, "transport.waypoint");
});

test("closed edge, full terminal, premature delivery and insufficient maintenance fail atomically", async () => {
  const manifest = validateGameManifest(await readJson("game.manifest.json"));
  const bundle = { gameId: manifest.meta.id, manifest };
  const createSession = async (mutate) => {
    const state = structuredClone(manifest.state);
    mutate?.(state);
    const store = new InMemorySessionStore();
    const session = await store.createSession({
      gameId: manifest.meta.id,
      sessionRole: "facilitator",
      initialState: state
    });
    return { store, session };
  };

  const underfunded = await createSession((state) => {
    state.public.session.phase = "maintenance";
    state.public.teams["white-logistics"].coins = 1;
  });
  await assert.rejects(
    dispatchRuntimeAction({
      sessionStore: underfunded.store,
      bundle,
      input: { sessionId: underfunded.session.sessionId, actionId: "mock.maintenance.pay" }
    }),
    /negative|insufficient/i
  );
  let current = await underfunded.store.getSession(underfunded.session.sessionId);
  assert.equal(current.version.stateVersion, 0);
  assert.deepEqual(
    Object.fromEntries(Object.entries(current.state.public.teams).map(([id, team]) => [id, team.coins])),
    { "white-logistics": 1, "red-logistics": 10, "purple-guild": 10, "green-guild": 10 }
  );

  const closed = await createSession((state) => {
    state.public.session.phase = "movement";
    state.public.objects.networkEdges["mock-edge-b-c"].facets.state = "blocked";
  });
  await assert.rejects(
    dispatchRuntimeAction({
      sessionStore: closed.store,
      bundle,
      input: {
        sessionId: closed.session.sessionId,
        actionId: "mock.locomotive.move",
        params: { vehicleId: "mock-locomotive-purple-1", edgeId: "mock-edge-b-c" }
      }
    }),
    /not in an allowed state|unavailable for movement/i
  );
  current = await closed.store.getSession(closed.session.sessionId);
  assert.equal(current.version.stateVersion, 0);
  assert.equal(current.state.public.objects.locomotives["mock-locomotive-purple-1"].attributes.nodeId, "mock-terminal-b");
  assert.equal(current.state.public.objects.locomotives["mock-locomotive-purple-1"].attributes.actionPoints, 5);

  const full = await createSession((state) => {
    state.public.session.phase = "movement";
    state.public.objects.locomotives["capacity-one"] = {
      objectType: "transport.locomotive",
      facets: { availability: "active" },
      attributes: { networkId: "main", nodeId: "mock-terminal-c", actionPoints: 5 }
    };
    state.public.objects.locomotives["capacity-two"] = {
      objectType: "transport.locomotive",
      facets: { availability: "active" },
      attributes: { networkId: "main", nodeId: "mock-terminal-c", actionPoints: 5 }
    };
  });
  await assert.rejects(
    dispatchRuntimeAction({
      sessionStore: full.store,
      bundle,
      input: {
        sessionId: full.session.sessionId,
        actionId: "mock.locomotive.move",
        params: { vehicleId: "mock-locomotive-purple-1", edgeId: "mock-edge-b-c" }
      }
    }),
    /capacity/i
  );
  current = await full.store.getSession(full.session.sessionId);
  assert.equal(current.version.stateVersion, 0);
  assert.equal(current.state.public.objects.locomotives["mock-locomotive-purple-1"].attributes.nodeId, "mock-terminal-b");

  const premature = await createSession((state) => {
    state.public.session.phase = "movement";
  });
  await assert.rejects(
    dispatchRuntimeAction({
      sessionStore: premature.store,
      bundle,
      input: {
        sessionId: premature.session.sessionId,
        actionId: "mock.cargo.deliver",
        params: { wagonId: "mock-wagon-white-1", cargoId: "mock-cargo-b-c" }
      }
    }),
    /not reached its destination/i
  );
  current = await premature.store.getSession(premature.session.sessionId);
  assert.equal(current.version.stateVersion, 0);
  assert.equal(current.state.public.teams["white-logistics"].coins, 10);
  assert.equal(current.state.public.teams["purple-guild"].coins, 10);
  assert.equal(current.state.public.objects.cargoOrders["mock-cargo-b-c"].facets.status, "in_transit");
});

test("published repository loads mock UI, immutable plugin and SVG asset by ordinary gameId", async () => {
  const { content } = await loadPlayerFacingContent({ gameId: "cards-money-trains-mock" });
  assert.equal(content.gameId, "cards-money-trains-mock");
  assert.equal(content.ui.id, "cards-money-trains-mock.ui.web");
  const plugin = content.pluginBundles[0];
  assert.equal(plugin.pluginId, "cards-money-trains-mock-player");
  const pluginSource = await getPublishedPlayerWebPluginBundleSource({
    gameId: plugin.gameId,
    pluginId: plugin.pluginId,
    contentHash: plugin.contentHash
  });
  assert.match(pluginSource, /cards-money-trains-mock/);

  const assetIndex = await getGameAssetIndex("cards-money-trains-mock");
  const asset = assetIndex.assets["board-guinea-optimized"];
  assert.ok(asset);
  const match = asset.url.match(/\/([a-f0-9]{64})\.(svg)$/u);
  assert.ok(match);
  const delivery = await getGameAssetFile({
    gameId: "cards-money-trains-mock",
    assetId: "board-guinea-optimized",
    contentHash: match[1],
    extension: match[2]
  });
  assert.equal(delivery.contentType, "image/svg+xml");
  assert.match(delivery.bytes.toString("utf8"), /ВЫМЫШЛЕННАЯ КАРТА/);
});

test("normative manifest remains separately addressed and contains no mock marker", async () => {
  const normative = JSON.parse(await readFile(path.join(packageRoot, "..", "cards-money-trains", "game.manifest.json"), "utf8"));
  assert.equal(normative.meta.id, "cards-money-trains");
  assert.equal(normative.content.data.mockNotice, undefined);
  assert.equal(normative.networkModels, undefined);
});
