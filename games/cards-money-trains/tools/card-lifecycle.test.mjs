/**
 * Focused runtime proof for the author-confirmed physical card lifecycle.
 *
 * These tests use a fixed seed only inside the test session so the protected
 * order is reproducible. Production session materialization replaces the
 * authoring seed with cryptographic randomness before any deck action runs.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import authoringCompiler from "../../../scripts/manifest-tools/authoring-compiler.cjs";
import { createImmutableBundleContent } from "../../../services/runtime-api/src/modules/content/immutableBundle.ts";
import { validateGameManifest } from "../../../services/runtime-api/src/modules/content/manifestValidation.ts";
import { dispatchRuntimeAction } from "../../../services/runtime-api/src/modules/runtime/actionDispatcher.ts";
import { InMemorySessionStore } from "../../../services/runtime-api/src/modules/session/inMemorySessionStore.ts";
import {
  authoringPath,
  buildFromDisk,
  intakePath,
  terminalIds
} from "./build-card-lifecycle.mjs";

const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const gameRoot = path.resolve(toolsRoot, "..");
const repoRoot = path.resolve(gameRoot, "..", "..");
const credentialSha256 = "c".repeat(64);
const { compileAuthoringText } = authoringCompiler;
const admissionController = {
  async assertNewCommandAdmitted() {}
};
let commandSequence = 0;

const readJson = async (absolutePath) =>
  JSON.parse(await readFile(absolutePath, "utf8"));

const nextCommandId = () => {
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32BE(++commandSequence, 12);
  return `cli_${bytes.toString("base64url")}`;
};

/**
 * Compile the freshly generated authoring in memory for generator-focused
 * runtime tests. This proves the new contract before the integration step
 * rewrites the repository's shared manifest and source map.
 */
const loadGeneratedManifest = async () => {
  const output = compileAuthoringText(
    {
      kind: "game",
      sourceFile: authoringPath,
      outputFile: path.join(repoRoot, ".tmp", "cmt-card-lifecycle.manifest.json"),
      sourceMapFile: path.join(
        repoRoot,
        ".tmp",
        "cmt-card-lifecycle.manifest.source-map.json"
      )
    },
    await readFile(authoringPath, "utf8")
  );
  return validateGameManifest(output.manifest);
};

const createSession = async (manifest) => {
  const store = new InMemorySessionStore();
  const created = await store.createSession({
    gameId: manifest.meta.id,
    sessionRole: "facilitator",
    initialState: structuredClone(manifest.state),
    immutableBundle: createImmutableBundleContent(manifest.meta.id, manifest),
    principal: {
      principalId: "card-lifecycle-test-facilitator",
      kind: "local-controller",
      role: "facilitator",
      actorScope: { kind: "all-session-actors" },
      credentialSha256
    }
  });
  return { store, sessionId: created.session.sessionId };
};

const dispatch = async ({ store, sessionId, actionId, params = {} }) => {
  const current = await store.getSession(sessionId);
  return dispatchRuntimeAction({
    sessionStore: store,
    credentialSha256,
    admissionController,
    input: {
      sessionId,
      actionId,
      commandId: nextCommandId(),
      expectedStateVersion: current.version.stateVersion,
      params
    }
  });
};

/**
 * Change only scenario setup facts between normal commands.
 *
 * The test does not add a production setup/market shortcut. It advances phase
 * and turn fields through the store's ordinary version contract so each
 * lifecycle action still runs through the protected runtime dispatcher.
 */
const updateScenario = async ({ store, sessionId }, mutate) => {
  const current = await store.getSession(sessionId);
  const updated = structuredClone(current);
  mutate(updated.state);
  updated.version.stateVersion += 1;
  updated.updatedAt = new Date();
  await store.updateSession(updated, {
    expectedStateVersion: current.version.stateVersion
  });
};

const testTeamColors = [
  "cobalt",
  "orange",
  "emerald",
  "magenta",
  "cyan",
  "amber"
];

const initialize = async (manifest, logisticsTeamCount = 1) => {
  const session = await createSession(manifest);
  // The normal package no longer contains the obsolete fixed four-team map.
  // Create a real dynamic team through the public setup action so cargo
  // ownership is tested against the same entity model used by a session.
  for (let index = 0; index < logisticsTeamCount; index += 1) {
    const teamOutcome = await dispatch({
      ...session,
      actionId: "session.setup.team.add.logistics-company",
      params: {
        name: `Тестовый перевозчик ${index + 1}`,
        colorId: testTeamColors[index]
      }
    });
    assert.equal(teamOutcome.result.ok, true);
  }
  const outcome = await dispatch({
    ...session,
    actionId: "cards.lifecycle.initialize"
  });
  assert.equal(outcome.result.ok, true);
  return session;
};

const allDeckMembers = (deck) => [...deck.order, ...deck.discard, ...deck.held];

test("generator materializes every physical source row and exact remaining gap", async () => {
  const [actualAuthoring, expectedAuthoring, intake, manifest] = await Promise.all([
    readJson(authoringPath),
    buildFromDisk(),
    readJson(intakePath),
    loadGeneratedManifest()
  ]);

  assert.deepEqual(actualAuthoring, expectedAuthoring);
  const cargoActionIds = expectedAuthoring.root.logic.actions
    .map((action) => action.id)
    .filter(
      (actionId) =>
        actionId === "cargo.queue.prepare"
        || actionId.startsWith("cargo.offer.")
    );
  assert.deepEqual(cargoActionIds, [
    "cargo.queue.prepare",
    "cargo.offer.draw",
    "cargo.offer.select",
    "cargo.offer.skip"
  ]);
  assert.ok(
    cargoActionIds.every(
      (actionId) => !/^cargo\.offer\.(?:draw|select|skip)\.terminal-/u.test(actionId)
    ),
    "terminal-specific cargo actions must not survive regeneration"
  );
  const cargoSelectAction = expectedAuthoring.root.logic.actions.find(
    (action) => action.id === "cargo.offer.select"
  );
  assert.deepEqual(cargoSelectAction.paramsSchema.properties.terminalId, {
    type: "string",
    maxLength: 16,
    enum: terminalIds
  });
  assert.deepEqual(cargoSelectAction.paramsSchema.required, [
    "terminalId",
    "cargoId"
  ]);
  assert.equal(
    "teamId" in cargoSelectAction.paramsSchema.properties,
    false,
    "the selected wagon's owner must come from server state"
  );
  for (const actionId of ["cargo.offer.draw", "cargo.offer.skip"]) {
    const cargoAction = expectedAuthoring.root.logic.actions.find(
      (action) => action.id === actionId
    );
    assert.deepEqual(cargoAction.paramsSchema, {
      type: "object",
      additionalProperties: false,
      properties: {
        terminalId: {
          type: "string",
          maxLength: 16,
          enum: terminalIds
        }
      },
      required: ["terminalId"]
    });
  }
  const cargoSelectGuard =
    expectedAuthoring.root.mechanics.plans["cargo.offer.select"]
      .transaction.steps[0].predicate;
  assert.ok(
    cargoSelectGuard.items.some(
      (item) =>
        item.op === "predicate.compare" &&
        item.operator === "eq" &&
        item.left?.op === "value.entity" &&
        item.left?.entity?.collection === "teams" &&
        item.left?.field === "type" &&
        item.right?.op === "value.literal" &&
        item.right?.value === "logistics_company"
    ),
    "the server-derived owner must be a logistics company"
  );
  const remainingEndpoints = Object.keys(
    expectedAuthoring.root.mechanics.stateModel.endpoints
  ).filter((endpointId) => endpointId.startsWith("public.cards.cargo.remaining."));
  assert.deepEqual(remainingEndpoints, ["public.cards.cargo.remaining.bound"]);
  assert.deepEqual(
    expectedAuthoring.root.mechanics.stateModel.endpoints[
      "public.cards.cargo.remaining.bound"
    ].storage.segments,
    ["cards", "cargo", "remaining", { binding: "terminalId" }]
  );
  assert.deepEqual(
    expectedAuthoring.root.state.public.board.availableActions
      .filter((candidate) => candidate.actionId.startsWith("cargo.offer."))
      .map(({ actionId, phase, section, fixedParams }) => ({
        actionId,
        phase,
        section,
        fixedParams
      })),
    [
      {
        actionId: "cargo.offer.draw",
        phase: "cargo",
        section: "cargo",
        fixedParams: undefined
      },
      {
        actionId: "cargo.offer.select",
        phase: "cargo",
        section: "cargo",
        fixedParams: undefined
      },
      {
        actionId: "cargo.offer.skip",
        phase: "cargo",
        section: "cargo",
        fixedParams: undefined
      }
    ]
  );
  assert.deepEqual(
    expectedAuthoring.root.state.public.board.availableActions
      .filter((candidate) => candidate.actionId === "cargo.queue.prepare")
      .map(({ actionId, phase, section, fixedParams }) => ({
        actionId,
        phase,
        section,
        fixedParams
      })),
    [{
      actionId: "cargo.queue.prepare",
      phase: "cargo",
      section: "cargo",
      fixedParams: undefined
    }]
  );
  assert.deepEqual(
    expectedAuthoring.root.logic.flows
      .flatMap((flow) => flow.steps)
      .flatMap((step) => step.actionIds ?? [])
      .filter(
        (actionId) =>
          actionId === "cargo.queue.prepare"
          || actionId.startsWith("cargo.offer.")
      ),
    [
      "cargo.queue.prepare",
      "cargo.offer.draw",
      "cargo.offer.select",
      "cargo.offer.skip"
    ]
  );
  assert.equal(intake.authorConfirmations.oneSourceRowEqualsOneRuntimeCard, true);
  assert.equal(intake.authorConfirmations.runtimeDeckLifecycleApproved, true);
  assert.equal(intake.unresolved.executableNewsMappingComplete, false);
  assert.equal(manifest.config.runtimeReady, false);
  assert.deepEqual(
    manifest.config.runtimeBlockers.filter((item) => /news/u.test(item)),
    []
  );
  assert.equal(Object.keys(manifest.state.public.objects.cargoOrders).length, 174);
  assert.equal(Object.keys(manifest.state.public.objects.newsCards).length, 34);
  assert.ok(
    Object.values(manifest.state.public.objects.cargoOrders).every(
      (card) => card.facets.status === "hidden"
    )
  );
  assert.ok(
    Object.values(manifest.state.public.objects.newsCards).every(
      (card) => card.facets.availability === "hidden"
    )
  );
  assert.deepEqual(manifest.state.secret.decks, {});
  assert.equal(
    Object.values(manifest.state.secret.cargoSources)
      .flatMap((source) => Object.keys(source)).length,
    112
  );
  assert.deepEqual(
    manifest.content.data.cardLifecycle.unresolvedRuleNewsNumbers,
    []
  );
  assert.equal(
    manifest.content.data.cardLifecycle.status,
    "partially-confirmed-executable-draft"
  );
  assert.deepEqual(
    manifest.content.data.cardLifecycle.workingInterpretations,
    [
      "full-cargo-priority-tie-uses-deterministic-seeded-random-until-author-confirmation"
    ]
  );
  assert.ok(
    !manifest.config.runtimeBlockers.includes("single remaining cargo card offer policy")
  );
  assert.deepEqual(
    manifest.content.data.cardLifecycle.executableCargoAdditionNewsNumbers,
    Array.from({ length: 10 }, (_, index) => index + 1)
  );
  assert.deepEqual(
    manifest.content.data.cardLifecycle.executableScalarNewsNumbers,
    [22, 23, 24, 25, 28, 29, 30, 31, 32, 33, 34]
  );
  assert.deepEqual(
    manifest.content.data.cardLifecycle.executableNetworkClosureNewsNumbers,
    [11, 12, 13, 15, 17, 18, 20, 21]
  );
  assert.deepEqual(
    manifest.content.data.cardLifecycle.executableEconomicNewsNumbers,
    [14, 16, 19, 22, 28, 29]
  );
  for (const actionId of [
    "news.effect.apply.14",
    "news.effect.apply.16",
    "news.effect.apply.22",
    "news.effect.apply.28",
    "news.effect.apply.29",
    "news.effect.19.finish"
  ]) {
    assert.deepEqual(manifest.actions[actionId].paramsSchema, {
      type: "object",
      additionalProperties: false,
      properties: {}
    });
  }
  const facilitatorFlow = expectedAuthoring.root.logic.flows.find(
    (flow) => flow.id === "facilitator"
  );
  const newsStepIndex = facilitatorFlow.steps.findIndex(
    (step) => step.id === "facilitator.news-lifecycle"
  );
  const operatingStepIndex = facilitatorFlow.steps.findIndex(
    (step) => step.id === "facilitator.operating-turn-start-maintenance"
  );
  assert.equal(newsStepIndex + 1, operatingStepIndex);
  assert.deepEqual(
    facilitatorFlow.steps
      .filter((step) => step.actionIds.includes("news.lifecycle.first-turn.skip"))
      .map((step) => step.id),
    ["facilitator.operating-turn-start-maintenance"]
  );
  assert.ok(
    facilitatorFlow.steps[newsStepIndex].actionIds.includes(
      "news.effect.apply.16"
    )
  );
  assert.ok(
    facilitatorFlow.steps[newsStepIndex].actionIds.includes(
      "news.effect.apply.22"
    )
  );
});

test("cargo queue enforces wagon slots, owner priority, protected offers and atomic forgery rejection", async () => {
  const manifest = await loadGeneratedManifest();

  const preparePriorityScenario = async () => {
    const session = await initialize(manifest, 5);
    await updateScenario(session, (state) => {
      state.public.session.phase = "cargo";
      state.public.session.turnNumber = 3;
      const teams = Object.entries(state.public.objects.teams)
        .sort(([, left], [, right]) =>
          left.attributes.label.localeCompare(right.attributes.label));
      const teamIds = teams.map(([teamId]) => teamId);
      const wagonsByTeam = new Map(teamIds.map((teamId) => [
        teamId,
        Object.entries(state.public.objects.wagons)
          .filter(([, wagon]) => wagon.attributes.ownerTeamId === teamId)
          .map(([wagonId]) => wagonId)
          .sort()
      ]));
      const activate = (wagonId, nodeId, cargoId = null) => {
        const wagon = state.public.objects.wagons[wagonId];
        wagon.facets.availability = "active";
        wagon.attributes.nodeId = nodeId;
        wagon.attributes.cargoId = cargoId;
      };
      const hiddenCargoId = Object.keys(state.public.objects.cargoOrders)[0];

      // Two highest-cash eligible wagons prove that one team receives two
      // independent slots. Their mutual order is the seeded full-tie policy.
      state.public.objects.teams[teamIds[0]].attributes.coins = 30;
      activate(wagonsByTeam.get(teamIds[0])[0], "terminal-1");
      activate(wagonsByTeam.get(teamIds[0])[1], "terminal-2");

      // Equal cash is broken by total active owned wagons, even when the
      // second active wagon is loaded and therefore receives no queue slot.
      state.public.objects.teams[teamIds[1]].attributes.coins = 20;
      activate(wagonsByTeam.get(teamIds[1])[0], "terminal-3");
      state.public.objects.teams[teamIds[2]].attributes.coins = 20;
      activate(wagonsByTeam.get(teamIds[2])[0], "terminal-4");
      activate(wagonsByTeam.get(teamIds[2])[1], "terminal-7", hiddenCargoId);

      state.public.objects.teams[teamIds[3]].attributes.coins = 10;
      activate(wagonsByTeam.get(teamIds[3])[0], "terminal-6");
      activate(wagonsByTeam.get(teamIds[3])[1], "terminal-5");
      state.public.objects.networkNodes["terminal-5"].facets.availability = "closed";

      // Both non-numbered locations must stay outside the queue.
      state.public.objects.teams[teamIds[4]].attributes.coins = 40;
      activate(wagonsByTeam.get(teamIds[4])[0], "terminal-3-14");
      activate(wagonsByTeam.get(teamIds[4])[1], "waypoint-9-3-4");

    });
    const beforePrepare = await session.store.getSession(session.sessionId);
    // Reconstruct ids from public entities, exactly as a runtime projection
    // consumer would, rather than carrying private helper state.
    const teams = Object.entries(beforePrepare.state.public.objects.teams)
      .sort(([, left], [, right]) =>
        left.attributes.label.localeCompare(right.attributes.label));
    const teamIds = teams.map(([teamId]) => teamId);
    const wagonsByTeam = new Map(teamIds.map((teamId) => [
      teamId,
      Object.entries(beforePrepare.state.public.objects.wagons)
        .filter(([, wagon]) => wagon.attributes.ownerTeamId === teamId)
        .map(([wagonId]) => wagonId)
        .sort()
    ]));
    const prepared = await dispatch({
      ...session,
      actionId: "cargo.queue.prepare"
    });
    assert.equal(prepared.result.ok, true);
    return { session, teamIds, wagonsByTeam };
  };

  const { session, teamIds, wagonsByTeam } = await preparePriorityScenario();
  const preparedState = await session.store.getSession(session.sessionId);
  const order = preparedState.state.public.cards.cargo.selectionOrder;
  const ownerOf = (wagonId) =>
    preparedState.state.public.objects.wagons[wagonId].attributes.ownerTeamId;
  assert.equal(order.length, 5);
  assert.deepEqual(order.slice(0, 2).map(ownerOf), [teamIds[0], teamIds[0]]);
  assert.equal(ownerOf(order[2]), teamIds[2], "two active wagons break the cash tie");
  assert.equal(ownerOf(order[3]), teamIds[1]);
  assert.equal(ownerOf(order[4]), teamIds[3]);
  assert.ok(
    !order.some((wagonId) => ownerOf(wagonId) === teamIds[4]),
    "non-numbered terminal and waypoint wagons must be excluded"
  );
  assert.equal(
    preparedState.state.public.cards.cargo.currentWagonId,
    order[0]
  );

  // Identical state and random seed must reproduce the explicitly documented
  // technical full-tie order.
  const second = await preparePriorityScenario();
  const secondPrepared = await second.session.store.getSession(second.session.sessionId);
  assert.deepEqual(
    secondPrepared.state.public.cards.cargo.selectionOrder,
    order
  );

  const repeatBefore = await session.store.getSession(session.sessionId);
  const repeatedPrepare = await dispatch({
    ...session,
    actionId: "cargo.queue.prepare"
  });
  assert.equal(repeatedPrepare.result.ok, false);
  const repeatAfter = await session.store.getSession(session.sessionId);
  assert.deepEqual(repeatAfter.state, repeatBefore.state);

  const currentWagonId =
    preparedState.state.public.cards.cargo.currentWagonId;
  const currentTerminalId =
    preparedState.state.public.objects.wagons[currentWagonId].attributes.nodeId;
  const holderTeamId =
    preparedState.state.public.objects.wagons[currentWagonId].attributes.ownerTeamId;

  const forgedBefore = await session.store.getSession(session.sessionId);
  const forgedTerminal = await dispatch({
    ...session,
    actionId: "cargo.offer.draw",
    params: { terminalId: "terminal-23" }
  });
  assert.equal(forgedTerminal.result.ok, false);
  const forgedAfter = await session.store.getSession(session.sessionId);
  assert.deepEqual(forgedAfter.state, forgedBefore.state);

  const offered = await dispatch({
    ...session,
    actionId: "cargo.offer.draw",
    params: { terminalId: currentTerminalId }
  });
  assert.equal(offered.result.ok, true);
  const afterOffer = await session.store.getSession(session.sessionId);
  const { firstCardId, secondCardId } = afterOffer.state.public.cards.cargo.offer;
  assert.notEqual(firstCardId, secondCardId);
  assert.ok(afterOffer.state.secret.decks[currentTerminalId].held.includes(firstCardId));
  assert.ok(afterOffer.state.secret.decks[currentTerminalId].held.includes(secondCardId));

  const extraAuthorityBefore = await session.store.getSession(session.sessionId);
  await assert.rejects(
    dispatch({
      ...session,
      actionId: "cargo.offer.select",
      params: {
        terminalId: currentTerminalId,
        cargoId: firstCardId,
        teamId: teamIds[4]
      }
    }),
    /must NOT have additional properties/u
  );
  assert.deepEqual(
    (await session.store.getSession(session.sessionId)).state,
    extraAuthorityBefore.state
  );

  const forgedCargoId = Object.keys(
    extraAuthorityBefore.state.public.objects.cargoOrders
  ).find((cargoId) => cargoId !== firstCardId && cargoId !== secondCardId);
  assert.ok(forgedCargoId);
  const forgedCargoBefore = await session.store.getSession(session.sessionId);
  const forgedCargo = await dispatch({
    ...session,
    actionId: "cargo.offer.select",
    params: { terminalId: currentTerminalId, cargoId: forgedCargoId }
  });
  assert.equal(forgedCargo.result.ok, false);
  assert.deepEqual(
    (await session.store.getSession(session.sessionId)).state,
    forgedCargoBefore.state
  );

  const selected = await dispatch({
    ...session,
    actionId: "cargo.offer.select",
    params: { terminalId: currentTerminalId, cargoId: firstCardId }
  });
  assert.equal(selected.result.ok, true);
  let current = await session.store.getSession(session.sessionId);
  assert.equal(
    current.state.public.objects.cargoOrders[firstCardId].attributes.holderTeamId,
    holderTeamId
  );
  assert.equal(
    current.state.public.objects.cargoOrders[firstCardId].facets.status,
    "available"
  );
  assert.equal(
    current.state.public.objects.cargoOrders[secondCardId].facets.status,
    "hidden"
  );
  assert.ok(current.state.secret.decks[currentTerminalId].held.includes(firstCardId));
  assert.ok(current.state.secret.decks[currentTerminalId].discard.includes(secondCardId));

  // Resolve every remaining slot by returning both cards. This proves that a
  // team with two wagons really receives two turns and that the saved queue,
  // rather than client ids, advances the current context.
  while (current.state.public.cards.cargo.currentWagonId !== null) {
    const wagonId = current.state.public.cards.cargo.currentWagonId;
    const terminalId =
      current.state.public.objects.wagons[wagonId].attributes.nodeId;
    const draw = await dispatch({
      ...session,
      actionId: "cargo.offer.draw",
      params: { terminalId }
    });
    assert.equal(draw.result.ok, true);
    const skip = await dispatch({
      ...session,
      actionId: "cargo.offer.skip",
      params: { terminalId }
    });
    assert.equal(skip.result.ok, true);
    current = await session.store.getSession(session.sessionId);
  }
  assert.deepEqual(current.state.public.cards.cargo.selectionOrder, []);

  // A held card is not tied to the queue wagon. After the queue closes it can
  // be loaded into any suitable empty wagon of the same company at its origin.
  const suitableWagonId = wagonsByTeam.get(holderTeamId)[0];
  await updateScenario(session, (state) => {
    const cargo = state.public.objects.cargoOrders[firstCardId];
    const wagon = state.public.objects.wagons[suitableWagonId];
    wagon.facets.availability = "active";
    wagon.attributes.nodeId = cargo.attributes.fromNodeId;
    wagon.attributes.cargoId = null;
  });
  const loaded = await dispatch({
    ...session,
    actionId: "cargo.load",
    params: { wagonId: suitableWagonId, cargoId: firstCardId }
  });
  assert.equal(loaded.result.ok, true);
  const afterLoad = await session.store.getSession(session.sessionId);
  assert.equal(
    afterLoad.state.public.objects.cargoOrders[firstCardId]
      .attributes.carrierWagonId,
    suitableWagonId
  );
  assert.equal(
    afterLoad.state.public.objects.cargoOrders[firstCardId]
      .attributes.originDeparted,
    false
  );
  assert.ok(
    afterLoad.state.secret.decks[currentTerminalId].held.includes(firstCardId),
    "loading must not return a chosen physical card to rotation"
  );

  const finished = await dispatch({
    ...session,
    actionId: "cargo.phase.finish"
  });
  assert.equal(finished.result.ok, true);

  // The author-confirmed one-card edge uses the same protected offer. There is
  // no synthetic card and no direct client access to the deck.
  const oneCardSession = await initialize(manifest);
  await updateScenario(oneCardSession, (state) => {
    state.public.session.phase = "cargo";
    state.public.session.turnNumber = 2;
    const [wagon] = Object.values(state.public.objects.wagons);
    wagon.facets.availability = "active";
    wagon.attributes.nodeId = "terminal-1";
  });
  const prematureFinish = await dispatch({
    ...oneCardSession,
    actionId: "cargo.phase.finish"
  });
  assert.equal(prematureFinish.result.ok, false);
  assert.equal((await dispatch({
    ...oneCardSession,
    actionId: "cargo.queue.prepare"
  })).result.ok, true);
  await updateScenario(oneCardSession, (state) => {
    state.public.cards.cargo.remaining["terminal-1"] = 1;
  });
  const oneCardBefore = await oneCardSession.store.getSession(oneCardSession.sessionId);
  const oneCardDraw = await dispatch({
    ...oneCardSession,
    actionId: "cargo.offer.draw",
    params: { terminalId: "terminal-1" }
  });
  assert.equal(oneCardDraw.result.ok, true);
  const oneCardAfter = await oneCardSession.store.getSession(oneCardSession.sessionId);
  const singleCardId =
    oneCardAfter.state.public.cards.cargo.offer.firstCardId;
  assert.equal(typeof singleCardId, "string");
  assert.equal(
    oneCardAfter.state.public.cards.cargo.offer.secondCardId,
    null
  );
  assert.equal(
    oneCardAfter.state.public.objects.cargoOrders[singleCardId].facets.status,
    "offered"
  );
  assert.equal((await dispatch({
    ...oneCardSession,
    actionId: "cargo.offer.select",
    params: { terminalId: "terminal-1", cargoId: singleCardId }
  })).result.ok, true);
  const oneCardSelected = await oneCardSession.store.getSession(
    oneCardSession.sessionId
  );
  assert.equal(
    oneCardSelected.state.public.objects.cargoOrders[singleCardId].facets.status,
    "available"
  );
  assert.equal(
    oneCardSelected.state.public.cards.cargo.remaining["terminal-1"],
    0
  );
  assert.equal(oneCardSelected.state.public.cards.cargo.currentWagonId, null);
  assert.deepEqual(oneCardSelected.state.public.cards.cargo.selectionOrder, []);

  // Skipping the same one-card shape returns exactly that card and never sends
  // a null second id into deck.return or entity mutation.
  const oneCardSkipSession = await initialize(manifest);
  await updateScenario(oneCardSkipSession, (state) => {
    state.public.session.phase = "cargo";
    state.public.session.turnNumber = 2;
    const [wagon] = Object.values(state.public.objects.wagons);
    wagon.facets.availability = "active";
    wagon.attributes.nodeId = "terminal-1";
  });
  assert.equal((await dispatch({
    ...oneCardSkipSession,
    actionId: "cargo.queue.prepare"
  })).result.ok, true);
  await updateScenario(oneCardSkipSession, (state) => {
    state.public.cards.cargo.remaining["terminal-1"] = 1;
  });
  const oneCardSkipBefore = await oneCardSkipSession.store.getSession(
    oneCardSkipSession.sessionId
  );
  const oneCardDeckBefore = structuredClone(
    oneCardSkipBefore.state.secret.decks["terminal-1"]
  );
  assert.equal((await dispatch({
    ...oneCardSkipSession,
    actionId: "cargo.offer.draw",
    params: { terminalId: "terminal-1" }
  })).result.ok, true);
  assert.equal((await dispatch({
    ...oneCardSkipSession,
    actionId: "cargo.offer.skip",
    params: { terminalId: "terminal-1" }
  })).result.ok, true);
  const oneCardSkipped = await oneCardSkipSession.store.getSession(
    oneCardSkipSession.sessionId
  );
  assert.deepEqual(
    allDeckMembers(oneCardSkipped.state.secret.decks["terminal-1"]).sort(),
    allDeckMembers(oneCardDeckBefore).sort()
  );
  assert.equal(
    oneCardSkipped.state.public.cards.cargo.remaining["terminal-1"],
    1
  );
});

test("news skips turn one, adds cargo once and enters stagnation after depletion", async () => {
  const manifest = await loadGeneratedManifest();
  const firstTurnSession = await initialize(manifest);
  await updateScenario(firstTurnSession, (state) => {
    state.public.session.phase = "news";
  });
  const beforeFirstSkip = await firstTurnSession.store.getSession(firstTurnSession.sessionId);
  const skipped = await dispatch({
    ...firstTurnSession,
    actionId: "news.lifecycle.first-turn.skip"
  });
  assert.equal(skipped.result.ok, true);
  const afterFirstSkip = await firstTurnSession.store.getSession(firstTurnSession.sessionId);
  assert.equal(afterFirstSkip.state.public.news.currentCardId, null);
  assert.equal(afterFirstSkip.state.public.news.remaining, 34);
  assert.equal(afterFirstSkip.state.public.news.status, "first-turn-skipped");
  assert.equal(afterFirstSkip.state.public.session.phase, "maintenance");
  assert.deepEqual(
    afterFirstSkip.state.secret.decks.news,
    beforeFirstSkip.state.secret.decks.news
  );

  const newsSession = await initialize(manifest);
  await updateScenario(newsSession, (state) => {
    state.public.session.phase = "news";
    state.public.session.turnNumber = 2;
    const newsDeck = state.secret.decks.news;
    newsDeck.order = [
      "news-01",
      ...newsDeck.order.filter((cardId) => cardId !== "news-01")
    ];
  });
  const terminalId = "terminal-4";
  const cargoDeckId = terminalId;
  const beforeNews = await newsSession.store.getSession(newsSession.sessionId);
  const initialCargoMembers = allDeckMembers(beforeNews.state.secret.decks[cargoDeckId]);
  const initialRemaining = beforeNews.state.public.cards.cargo.remaining[terminalId];

  const drawn = await dispatch({
    ...newsSession,
    actionId: "news.lifecycle.draw"
  });
  assert.equal(drawn.result.ok, true);
  const afterDraw = await newsSession.store.getSession(newsSession.sessionId);
  assert.equal(afterDraw.state.public.news.currentCardId, "news-01");
  assert.equal(afterDraw.state.public.news.remaining, 33);
  assert.equal(afterDraw.state.public.objects.newsCards["news-01"].facets.availability, "current");
  assert.equal(new Set(allDeckMembers(afterDraw.state.secret.decks.news)).size, 34);
  assert.equal(
    manifest.mechanics.plans["news.lifecycle.draw"].transaction.steps.find(
      (step) => step.id === "draw"
    ).onEmpty,
    "fail"
  );

  const applied = await dispatch({
    ...newsSession,
    actionId: "news.cargo-addition.apply.01"
  });
  assert.equal(applied.result.ok, true);
  const afterApply = await newsSession.store.getSession(newsSession.sessionId);
  const linkedIds =
    afterApply.state.public.objects.newsCards["news-01"].attributes.linkedCargoRecordIds;
  const cargoMembers = allDeckMembers(afterApply.state.secret.decks[cargoDeckId]);
  assert.equal(cargoMembers.length, initialCargoMembers.length + linkedIds.length);
  assert.equal(new Set(cargoMembers).size, cargoMembers.length);
  assert.ok(linkedIds.every((cargoId) => cargoMembers.includes(cargoId)));
  assert.equal(
    afterApply.state.public.cards.cargo.remaining[terminalId],
    initialRemaining + linkedIds.length
  );
  assert.equal(afterApply.state.public.objects.newsCards["news-01"].facets.availability, "resolved");
  assert.equal(afterApply.state.public.news.currentCardId, null);
  assert.equal(afterApply.state.public.session.phase, "maintenance");

  const duplicate = await dispatch({
    ...newsSession,
    actionId: "news.cargo-addition.apply.01"
  });
  assert.equal(duplicate.result.ok, false);
  const afterDuplicate = await newsSession.store.getSession(newsSession.sessionId);
  assert.deepEqual(afterDuplicate.state, afterApply.state);
  assert.equal(
    afterDuplicate.state.public.cards.cargo.remaining[terminalId],
    initialRemaining + linkedIds.length
  );

  await updateScenario(newsSession, (state) => {
    state.public.session.phase = "news";
    state.public.session.turnNumber = 36;
    state.public.news.currentCardId = null;
    state.public.news.remaining = 0;
    const newsDeck = state.secret.decks.news;
    newsDeck.discard = allDeckMembers(newsDeck);
    newsDeck.order = [];
    newsDeck.held = [];
  });
  const stagnation = await dispatch({
    ...newsSession,
    actionId: "news.lifecycle.stagnation"
  });
  assert.equal(stagnation.result.ok, true);
  const afterStagnation = await newsSession.store.getSession(newsSession.sessionId);
  assert.equal(afterStagnation.state.public.news.status, "stagnation");
  assert.equal(afterStagnation.state.public.session.phase, "maintenance");
  assert.equal(new Set(afterStagnation.state.secret.decks.news.discard).size, 34);
});

test("all ten cargo news cards add their exact physical rows once", async () => {
  const manifest = await loadGeneratedManifest();
  const session = await initialize(manifest);
  const expectedAddedCargo = new Set();

  for (let newsNumber = 1; newsNumber <= 10; newsNumber += 1) {
    const newsId = `news-${String(newsNumber).padStart(2, "0")}`;
    await updateScenario(session, (state) => {
      state.public.session.phase = "news";
      state.public.session.turnNumber = newsNumber + 1;
      const newsDeck = state.secret.decks.news;
      newsDeck.order = [
        newsId,
        ...newsDeck.order.filter((cardId) => cardId !== newsId)
      ];
      newsDeck.discard = newsDeck.discard.filter(
        (cardId) => cardId !== newsId
      );
      newsDeck.held = newsDeck.held.filter((cardId) => cardId !== newsId);
    });

    const before = await session.store.getSession(session.sessionId);
    const linkedCargoIds =
      before.state.public.objects.newsCards[newsId].attributes
        .linkedCargoRecordIds;
    assert.ok(linkedCargoIds.length > 0, `${newsId} must link cargo rows`);

    const expectedByTerminal = new Map();
    for (const cargoId of linkedCargoIds) {
      assert.ok(
        !expectedAddedCargo.has(cargoId),
        `${cargoId} must be introduced by only one news card`
      );
      expectedAddedCargo.add(cargoId);
      const terminalId =
        before.state.public.objects.cargoOrders[cargoId].attributes.fromNodeId;
      const group = expectedByTerminal.get(terminalId) ?? [];
      group.push(cargoId);
      expectedByTerminal.set(terminalId, group);
    }

    const beforeRemaining = structuredClone(
      before.state.public.cards.cargo.remaining
    );
    const beforeMembers = new Map(
      terminalIds.map((terminalId) => [
        terminalId,
        allDeckMembers(before.state.secret.decks[terminalId])
      ])
    );

    const drawn = await dispatch({
      ...session,
      actionId: "news.lifecycle.draw"
    });
    assert.equal(drawn.result.ok, true);
    const applied = await dispatch({
      ...session,
      actionId: `news.cargo-addition.apply.${String(newsNumber).padStart(2, "0")}`
    });
    assert.equal(applied.result.ok, true);

    const after = await session.store.getSession(session.sessionId);
    for (const terminalId of terminalIds) {
      const expectedAtTerminal = expectedByTerminal.get(terminalId) ?? [];
      const previousMembers = beforeMembers.get(terminalId);
      const currentMembers = allDeckMembers(
        after.state.secret.decks[terminalId]
      );

      assert.equal(
        currentMembers.length,
        previousMembers.length + expectedAtTerminal.length,
        `${newsId} must change ${terminalId} only by its linked rows`
      );
      assert.equal(
        new Set(currentMembers).size,
        currentMembers.length,
        `${terminalId} must never contain a physical card twice`
      );
      assert.ok(
        expectedAtTerminal.every((cargoId) =>
          currentMembers.includes(cargoId)
        ),
        `${newsId} linked rows must enter ${terminalId}`
      );
      assert.equal(
        after.state.public.cards.cargo.remaining[terminalId],
        beforeRemaining[terminalId] + expectedAtTerminal.length,
        `${terminalId} public count must match its protected deck`
      );
    }

    assert.equal(
      after.state.public.objects.newsCards[newsId].facets.availability,
      "resolved"
    );
    assert.equal(after.state.public.news.currentCardId, null);
    assert.equal(after.state.public.session.phase, "maintenance");
  }

  assert.equal(
    expectedAddedCargo.size,
    62,
    "the ten source news cards must introduce all 62 added physical cargo rows"
  );
  const final = await session.store.getSession(session.sessionId);
  assert.equal(final.state.public.news.remaining, 24);
  assert.ok(
    [...expectedAddedCargo].every((cargoId) =>
      terminalIds.some((terminalId) =>
        allDeckMembers(final.state.secret.decks[terminalId]).includes(cargoId)
      )
    )
  );
});
