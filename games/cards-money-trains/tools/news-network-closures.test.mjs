/**
 * Focused Runtime proof for author-confirmed one-turn network news closures.
 *
 * The test chooses real cards deterministically but dispatches every draw and
 * effect through the production command boundary. It proves that a news card
 * owns one set member rather than the whole blocker list, so construction or
 * facilitator reasons survive the next-turn cleanup.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createImmutableBundleContent } from "../../../services/runtime-api/src/modules/content/immutableBundle.ts";
import { validateGameManifest } from "../../../services/runtime-api/src/modules/content/manifestValidation.ts";
import { dispatchRuntimeAction } from "../../../services/runtime-api/src/modules/runtime/actionDispatcher.ts";
import { InMemorySessionStore } from "../../../services/runtime-api/src/modules/session/inMemorySessionStore.ts";

const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const gameRoot = path.resolve(toolsRoot, "..");
const credentialSha256 = "6".repeat(64);
const admissionController = {
  async assertNewCommandAdmitted() {}
};
let commandSequence = 0;

const closures = [
  {
    number: 11,
    targets: [{ collection: "networkEdges", id: "road-1-9" }]
  },
  {
    number: 12,
    targets: [{ collection: "networkEdges", id: "road-3-3-14" }]
  },
  {
    number: 13,
    targets: [
      { collection: "networkEdges", id: "road-8-waypoint-9-3-4" }
    ]
  },
  {
    number: 15,
    targets: [{ collection: "networkEdges", id: "road-1-2" }]
  },
  {
    number: 17,
    targets: [{ collection: "networkEdges", id: "road-4-7" }]
  },
  {
    number: 18,
    targets: [{ collection: "networkNodes", id: "terminal-11" }]
  },
  {
    number: 20,
    targets: [{ collection: "networkNodes", id: "terminal-12" }]
  },
  {
    number: 21,
    targets: [
      { collection: "networkNodes", id: "terminal-5" },
      { collection: "networkNodes", id: "terminal-7" }
    ]
  }
];

const readJson = async (filePath) =>
  JSON.parse(await readFile(filePath, "utf8"));

const nextCommandId = () => {
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32BE(++commandSequence, 12);
  return `cli_${bytes.toString("base64url")}`;
};

const createSession = async (manifest) => {
  const store = new InMemorySessionStore();
  const created = await store.createSession({
    gameId: manifest.meta.id,
    sessionRole: "facilitator",
    initialState: structuredClone(manifest.state),
    immutableBundle: createImmutableBundleContent(manifest.meta.id, manifest),
    principal: {
      principalId: "news-network-closures-test-facilitator",
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

/** Change only upstream test facts under the normal version contract. */
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

const allDeckMembers = (deck) => [
  ...deck.order,
  ...deck.discard,
  ...deck.held
];

const drawNews = async (session, newsNumber, turnNumber) => {
  const newsId = `news-${String(newsNumber).padStart(2, "0")}`;
  await updateScenario(session, (state) => {
    state.public.session.phase = "news";
    state.public.session.turnNumber = turnNumber;
    state.public.news.currentCardId = null;
    const deck = state.secret.decks.news;
    deck.order = [newsId, ...deck.order.filter((cardId) => cardId !== newsId)];
    deck.discard = deck.discard.filter((cardId) => cardId !== newsId);
    deck.held = deck.held.filter((cardId) => cardId !== newsId);
  });
  const outcome = await dispatch({
    ...session,
    actionId: "news.lifecycle.draw"
  });
  assert.equal(outcome.result.ok, true);
  return session.store.getSession(session.sessionId);
};

const targetState = (state, target) =>
  state.public.objects[target.collection][target.id];

const expectedFacet = (target, blocked) =>
  target.collection === "networkEdges"
    ? { name: "state", value: blocked ? "blocked" : "open" }
    : { name: "availability", value: blocked ? "closed" : "open" };

test("network news close only exact targets and release only their own reason", async () => {
  const manifest = validateGameManifest(
    await readJson(path.join(gameRoot, "game.manifest.json"))
  );
  const session = await createSession(manifest);
  assert.equal(
    (
      await dispatch({
        ...session,
        actionId: "cards.lifecycle.initialize"
      })
    ).result.ok,
    true
  );

  let previousClosure;
  for (const [index, closure] of closures.entries()) {
    const newsId = `news-${String(closure.number).padStart(2, "0")}`;
    const afterDraw = await drawNews(session, closure.number, index + 2);

    if (previousClosure) {
      for (const previousTarget of previousClosure.targets) {
        const previous = targetState(afterDraw.state, previousTarget);
        const facet = expectedFacet(previousTarget, false);
        if (previousClosure.number === 11) {
          // The manually owned reason remains, so the road must stay blocked.
          assert.deepEqual(previous.attributes.blockingReasons, [
            "manual-inspection"
          ]);
          assert.equal(previous.facets.state, "blocked");
        } else {
          assert.deepEqual(previous.attributes.blockingReasons, []);
          assert.equal(previous.facets[facet.name], facet.value);
        }
      }
    }

    if (closure.number === 11) {
      await updateScenario(session, (state) => {
        const edge = state.public.objects.networkEdges["road-1-9"];
        edge.attributes.blockingReasons = ["manual-inspection"];
        edge.facets.state = "blocked";
      });
      const beforeWrongCard = await session.store.getSession(session.sessionId);
      const wrongCard = await dispatch({
        ...session,
        actionId: "news.effect.apply.12"
      });
      assert.equal(wrongCard.result.ok, false);
      assert.deepEqual(
        (await session.store.getSession(session.sessionId)).state,
        beforeWrongCard.state
      );
    }

    const applied = await dispatch({
      ...session,
      actionId: `news.effect.apply.${String(closure.number).padStart(2, "0")}`
    });
    assert.equal(applied.result.ok, true);
    const afterApply = await session.store.getSession(session.sessionId);
    assert.equal(
      afterApply.state.public.news.activeNetworkClosureReason,
      newsId
    );
    assert.equal(afterApply.state.public.news.currentCardId, null);
    assert.equal(afterApply.state.public.session.phase, "maintenance");

    for (const target of closure.targets) {
      const entity = targetState(afterApply.state, target);
      const facet = expectedFacet(target, true);
      assert.ok(entity.attributes.blockingReasons.includes(newsId));
      assert.equal(entity.facets[facet.name], facet.value);
    }

    for (const collection of ["networkNodes", "networkEdges"]) {
      const actualIds = Object.entries(afterApply.state.public.objects[collection])
        .filter(([, entity]) =>
          entity.attributes.blockingReasons.includes(newsId)
        )
        .map(([entityId]) => entityId)
        .sort();
      const expectedIds = closure.targets
        .filter((target) => target.collection === collection)
        .map((target) => target.id)
        .sort();
      assert.deepEqual(actualIds, expectedIds);
    }

    if (closure.number === 12) {
      assert.equal(
        afterApply.state.public.objects.networkEdges["road-2-3-14"].facets.state,
        "open"
      );
      assert.deepEqual(
        afterApply.state.public.objects.networkEdges["road-2-3-14"].attributes
          .blockingReasons,
        []
      );
    }
    previousClosure = closure;
  }

  await updateScenario(session, (state) => {
    state.public.session.phase = "news";
    state.public.session.turnNumber = closures.length + 2;
    state.public.news.currentCardId = null;
    state.public.news.remaining = 0;
    const deck = state.secret.decks.news;
    deck.discard = allDeckMembers(deck);
    deck.order = [];
    deck.held = [];
  });
  const stagnation = await dispatch({
    ...session,
    actionId: "news.lifecycle.stagnation"
  });
  assert.equal(stagnation.result.ok, true);
  const afterStagnation = await session.store.getSession(session.sessionId);
  assert.equal(
    afterStagnation.state.public.news.activeNetworkClosureReason,
    null
  );
  for (const terminalId of ["terminal-5", "terminal-7"]) {
    const terminal =
      afterStagnation.state.public.objects.networkNodes[terminalId];
    assert.deepEqual(terminal.attributes.blockingReasons, []);
    assert.equal(terminal.facets.availability, "open");
  }
  assert.deepEqual(
    afterStagnation.state.public.objects.networkEdges["road-1-9"].attributes
      .blockingReasons,
    ["manual-inspection"]
  );
  assert.equal(
    afterStagnation.state.public.objects.networkEdges["road-1-9"].facets.state,
    "blocked"
  );
});
