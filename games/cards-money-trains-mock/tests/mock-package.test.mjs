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
import { createCanonicalReplayFingerprint } from "../../../services/runtime-api/src/modules/runtime/replayFingerprint.ts";
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
  assert.equal(current.version.stateVersion, transcript.steps.length);
  assert.equal(publicState.session.phase, "debrief");
  assert.equal(publicState.construction.available, false);
  assert.deepEqual(
    Object.fromEntries(Object.entries(publicState.teams).map(([id, team]) => [id, team.coins])),
    transcript.final.balances
  );
  assert.equal(publicState.objects.networkEdges["mock-edge-c-d"].facets.state, "blocked");
  assert.equal(publicState.objects.locomotives["mock-locomotive-purple-1"].attributes.nodeId, "mock-terminal-c");
  assert.equal(publicState.objects.locomotives["mock-locomotive-purple-1"].attributes.actionPoints, 1);
  assert.equal(publicState.objects.wagons["mock-wagon-white-1"].attributes.attachedVehicleId, null);
  assert.equal(publicState.objects.wagons["mock-wagon-white-1"].attributes.cargoId, null);
  assert.equal(publicState.objects.cargoOrders["mock-cargo-b-c"].facets.status, "delivered");
  assert.equal(publicState.objects.cargoOrders["mock-cargo-b-c"].attributes.settledRouteLength, 1);
  assert.equal(publicState.objects.wagons["mock-wagon-white-2"].attributes.cargoId, "mock-cargo-b-f");
  assert.equal(publicState.log.length, 18);
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
    state.public.session.phase = "operations";
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
    state.public.session.phase = "operations";
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
    state.public.session.phase = "operations";
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

  const incompatible = await createSession((state) => {
    state.public.session.phase = "operations";
  });
  await assert.rejects(
    dispatchRuntimeAction({
      sessionStore: incompatible.store,
      bundle,
      input: {
        sessionId: incompatible.session.sessionId,
        actionId: "mock.operations.attach.incompatible",
        params: { vehicleId: "mock-locomotive-purple-1", wagonId: "mock-wagon-red-1" }
      }
    }),
    /incompatible/i
  );
  current = await incompatible.store.getSession(incompatible.session.sessionId);
  assert.equal(current.version.stateVersion, 0);
  assert.equal(current.state.public.objects.locomotives["mock-locomotive-purple-1"].attributes.actionPoints, 5);

  const marketCredit = await createSession((state) => {
    state.public.session.phase = "market";
    state.public.teams["green-guild"].coins = 9;
  });
  await assert.rejects(
    dispatchRuntimeAction({
      sessionStore: marketCredit.store,
      bundle,
      input: { sessionId: marketCredit.session.sessionId, actionId: "mock.market.buy.green-locomotive" }
    }),
    /negative|insufficient/i
  );
  current = await marketCredit.store.getSession(marketCredit.session.sessionId);
  assert.equal(current.version.stateVersion, 0);
  assert.equal(current.state.public.teams["green-guild"].coins, 9);
  assert.equal(
    current.state.public.objects.locomotives["mock-market-locomotive-green-2"].facets.availability,
    "reserve"
  );
});

test("full mock data declares hidden reproducible decks and accepted reusable effects", async () => {
  const manifest = validateGameManifest(await readJson("game.manifest.json"));
  const gameplay = await readJson("fixtures/mock-gameplay-data.json");
  const textContent = await readJson("fixtures/mock-text-content.json");
  assert.deepEqual(gameplay.phaseOrder, [
    "setup", "news", "maintenance", "market", "cargo",
    "operations", "construction", "debrief", "finished"
  ]);
  assert.equal(textContent.newsCards.length >= 6, true);
  assert.equal(textContent.cargoCards.length >= 12, true);
  assert.deepEqual(Object.keys(manifest.state.secret).sort(), ["decks", "random"]);
  assert.equal(Object.keys(manifest.state.public.objects.newsCards).length, textContent.newsCards.length);
  assert.equal(Object.keys(manifest.state.public.objects.cargoCards).length, textContent.cargoCards.length);
  assert.deepEqual(manifest.content.data.mockGameplay.roles, textContent.roles);
  assert.equal(manifest.content.data.mockGameplay.newsCards[0].title, textContent.newsCards[0].title);

  const effects = Object.values(manifest.actions).flatMap((action) => action.deterministic?.effects ?? []);
  for (const expected of [
    "deck.shuffle", "deck.draw", "transport.cargo.load", "transport.vehicle.attach",
    "transport.vehicle.detach", "transport.cargo.deliver", "ranking.compute"
  ]) {
    assert.equal(effects.some((effect) => effect.op === expected), true, `${expected} must be composed by the mock`);
  }
  for (const transfer of effects.filter((effect) => effect.op === "metric.transfer")) {
    assert.equal(typeof transfer.from.scope, "string");
    assert.equal(typeof transfer.to.scope, "string");
    assert.equal(transfer.onInsufficient, "fail");
    assert.equal("kind" in transfer.from || "kind" in transfer.to, false);
    assert.equal("insufficientFunds" in transfer, false);
  }

  for (const collection of ["locomotives", "wagons"]) {
    for (const vehicle of Object.values(manifest.state.public.objects[collection])) {
      assert.equal(Number.isSafeInteger(vehicle.attributes.nominalValue), true);
      assert.equal(vehicle.attributes.nominalValue >= 0, true);
    }
  }

  const ui = await readJson("authoring/ui/web.authoring.json");
  const serializedUi = JSON.stringify(ui);
  for (const id of ["facilitator.board", "facilitator.team-status", "facilitator.log"]) {
    assert.match(serializedUi, new RegExp(`\\"${id}\\"`));
  }
});

test("complete seven-turn gameplay is replay-stable and finishes only after facilitator confirmation", async () => {
  const manifest = validateGameManifest(await readJson("game.manifest.json"));
  const transcript = await readJson("fixtures/complete-session-transcript.json");
  assert.equal(transcript.steps.filter((step) => step.restartAfter === true).length, 2);
  assert.equal(transcript.rejectionProbes.length, 7);

  const replay = async () => {
    const store = new InMemorySessionStore();
    const session = await store.createSession({
      gameId: manifest.meta.id,
      sessionRole: "facilitator",
      initialState: structuredClone(manifest.state)
    });
    const bundle = { gameId: manifest.meta.id, manifest };
    let current = session;
    for (const step of transcript.steps) {
      await dispatchRuntimeAction({
        sessionStore: store,
        bundle,
        input: {
          sessionId: session.sessionId,
          expectedStateVersion: current.version.stateVersion,
          actionId: step.actionId,
          ...(step.params ? { params: step.params } : {})
        }
      });
      current = await store.getSession(session.sessionId);
      assert.ok(current);
      assert.equal(current.state.public.session.phase, step.expected.phase, `phase after step ${step.order}`);
      assert.equal(current.state.public.session.turnNumber, step.expected.turnNumber, `turn after step ${step.order}`);
    }
    return current;
  };

  const first = await replay();
  const second = await replay();
  assert.equal(
    createCanonicalReplayFingerprint(first.state),
    createCanonicalReplayFingerprint(second.state)
  );
  assert.equal(first.state.public.session.phase, "finished");
  assert.equal(first.state.public.session.turnNumber, 7);
  assert.deepEqual(
    Object.fromEntries(Object.entries(first.state.public.teams).map(([id, team]) => [id, team.coins])),
    transcript.final.balances
  );
  assert.deepEqual(first.state.public.ranking.groups.logistics.winners, transcript.final.winners.logistics);
  assert.deepEqual(first.state.public.ranking.groups.guilds.winners, transcript.final.winners.guilds);
});

test("published repository loads mock UI, immutable plugin and registered WebP map by ordinary gameId", async () => {
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
  const match = asset.url.match(/\/([a-f0-9]{64})\.(webp)$/u);
  assert.ok(match);
  const delivery = await getGameAssetFile({
    gameId: "cards-money-trains-mock",
    assetId: "board-guinea-optimized",
    contentHash: match[1],
    extension: match[2]
  });
  assert.equal(delivery.contentType, "image/webp");
  const normativeMap = await readFile(
    path.join(packageRoot, "..", "cards-money-trains", "assets", "images", "guinea-map.webp")
  );
  assert.deepEqual(delivery.bytes, normativeMap);
});

test("normative manifest remains separately addressed and contains no mock marker", async () => {
  const normative = JSON.parse(await readFile(path.join(packageRoot, "..", "cards-money-trains", "game.manifest.json"), "utf8"));
  assert.equal(normative.meta.id, "cards-money-trains");
  assert.equal(normative.content.data.mockNotice, undefined);
  assert.equal(normative.networkModels, undefined);
});
