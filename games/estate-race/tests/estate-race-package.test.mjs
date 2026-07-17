/**
 * End-to-end runtime proof for the first Estate Race gameplay slice.
 *
 * The replay uses a fixed runtime seed. No test-only game branch exists: the
 * same manifest actions, participant guards, reference validation and transfer
 * handler are used by the player UI.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateGameManifest } from "../../../services/runtime-api/src/modules/content/manifestValidation.ts";
import {
  getPublishedPlayerWebPluginBundleSource,
  loadPlayerFacingContent
} from "../../../services/runtime-api/src/modules/content/contentService.ts";
import { createImmutableBundleContent } from "../../../services/runtime-api/src/modules/content/immutableBundle.ts";
import { dispatchRuntimeAction } from "../../../services/runtime-api/src/modules/runtime/actionDispatcher.ts";
import { InMemorySessionStore } from "../../../services/runtime-api/src/modules/session/inMemorySessionStore.ts";
import { initializeTurnBasedSessionState } from "../../../services/runtime-api/src/modules/session/turnBasedSessionState.ts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Under the version-pinned named `session.main` stream this seed yields two
// consecutive [1, 1] rolls, keeping the purchase/rent scenario intentional.
const replaySeed = "00000000000000000000000000000010";
const testCredentialSha256 = "b".repeat(64);
// This package proof covers gameplay semantics. Admission limits are a
// platform boundary with their own focused HTTP/controller regression suite.
const testAdmissionController = {
  async assertNewCommandAdmitted() {}
};
let nextCommandSequence = 1;

const createTestCommandId = () => {
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32BE(nextCommandSequence, 12);
  nextCommandSequence += 1;
  return `cli_${bytes.toString("base64url")}`;
};

const loadManifest = async () => validateGameManifest(
  JSON.parse(await readFile(path.join(packageRoot, "game.manifest.json"), "utf8"))
);

const createReplay = async (mutateState) => {
  const manifest = await loadManifest();
  const initialState = initializeTurnBasedSessionState(manifest, structuredClone(manifest.state), {
    participantCount: 2,
    randomSeed: replaySeed
  });
  mutateState?.(initialState);
  const immutableBundle = createImmutableBundleContent(manifest.meta.id, manifest);
  const store = new InMemorySessionStore();
  const created = await store.createSession({
    gameId: manifest.meta.id,
    sessionRole: "player",
    initialState,
    immutableBundle,
    principal: {
      principalId: "estate-race-test-controller",
      kind: "local-controller",
      role: "player",
      actorScope: { kind: "all-session-actors" },
      credentialSha256: testCredentialSha256
    }
  });
  return { manifest, store, session: created.session };
};

/** The server, not the caller, resolves the active hot-seat participant. */
const act = async (replay, actionId, params = {}) => {
  const current = await replay.store.getSession(replay.session.sessionId);
  return dispatchRuntimeAction({
    sessionStore: replay.store,
    credentialSha256: testCredentialSha256,
    admissionController: testAdmissionController,
    input: {
      sessionId: replay.session.sessionId,
      expectedStateVersion: current.version.stateVersion,
      commandId: createTestCommandId(),
      actionId,
      params
    }
  });
};

/** A rules rejection is persisted and returned as a terminal receipt. */
const assertRejectedAction = async (dispatch, messagePattern) => {
  const outcome = await dispatch;
  assert.equal(outcome.result.ok, false);
  assert.equal(outcome.receipt.status, "rejected");
  assert.match(
    `${outcome.result.error?.code ?? ""} ${outcome.result.error?.message ?? ""}`,
    messagePattern
  );
};

test("fixed replay completes first purchase and first rent", async () => {
  const replay = await createReplay();

  await act(replay, "turn.roll");
  let current = await replay.store.getSession(replay.session.sessionId);
  assert.deepEqual(current.state.public.board.lastRoll.values, [1, 1]);
  assert.equal(current.state.players.p1.metrics.position, 2);
  assert.equal(current.state.public.turn.phase, "acquire");

  await act(replay, "property.buy.cell-02", { cellId: "cell-02" });
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.players.p1.metrics.cash, 780);
  assert.equal(current.state.public.objects.boardCells["cell-02"].attributes.ownerPlayerId, "p1");

  const finishedFirstTurn = await act(replay, "turn.finish");
  assert.equal(
    finishedFirstTurn.actorPlayerId,
    "p2",
    "the successful response must project the actor selected by the explicit turn plan"
  );
  await act(replay, "turn.roll");
  current = await replay.store.getSession(replay.session.sessionId);
  assert.deepEqual(current.state.public.board.lastRoll.values, [1, 1]);
  assert.equal(current.state.players.p2.metrics.position, 2);
  assert.equal(current.state.public.turn.phase, "rent");

  await act(replay, "property.rent.cell-02", { cellId: "cell-02" });
  current = await replay.store.getSession(replay.session.sessionId);
  assert.equal(current.state.players.p1.metrics.cash, 798);
  assert.equal(current.state.players.p2.metrics.cash, 882);
  assert.equal(current.state.public.turn.phase, "finish");
  assert.ok(current.state.public.log.some((entry) => entry.data?.kind === "purchase"));
  assert.ok(current.state.public.log.some((entry) => entry.data?.kind === "rent"));
});

test("compiled gameplay contains no legacy actor, resource or turn shortcuts", async () => {
  const manifest = await loadManifest();
  const serializedManifest = JSON.stringify(manifest);
  const turnSteps = manifest.mechanics.plans["turn.finish"].transaction.steps;

  assert.ok(turnSteps.some((step) => step.op === "core.sequence.next"));
  assert.doesNotMatch(serializedManifest, /"op":"turn\.advance"/u);
  assert.doesNotMatch(serializedManifest, /"kind":"player-metric"/u);
  assert.doesNotMatch(serializedManifest, /"op":"value\.param","name":"actor"/u);
});

test("server-selected actor and insufficient purchase preserve the trust and atomicity boundaries", async () => {
  const actorReplay = await createReplay();
  await act(actorReplay, "turn.roll");
  const actorState = await actorReplay.store.getSession(actorReplay.session.sessionId);
  assert.equal(actorState.state.players.p1.metrics.position, 2);
  assert.equal(actorState.state.players.p2.metrics.position, 0);

  const poorReplay = await createReplay((state) => {
    state.players.p1.metrics.cash = 100;
  });
  await act(poorReplay, "turn.roll");
  const beforeBuy = structuredClone(await poorReplay.store.getSession(poorReplay.session.sessionId));
  await assertRejectedAction(
    act(poorReplay, "property.buy.cell-02", { cellId: "cell-02" }),
    /MECHANICS_RESOURCE_INSUFFICIENT/
  );
  const afterBuy = await poorReplay.store.getSession(poorReplay.session.sessionId);
  assert.deepEqual(afterBuy.state, beforeBuy.state);
  assert.equal(afterBuy.version.stateVersion, beforeBuy.version.stateVersion);
});

test("player-facing repository publishes the web screen and immutable field plugin", async () => {
  const { content } = await loadPlayerFacingContent({ gameId: "estate-race" });
  assert.equal(content.ui.id, "estate-race.ui.web");
  assert.equal(content.ui.entryPoint, "table");
  assert.equal(content.pluginBundles.length, 1);
  const plugin = content.pluginBundles[0];
  assert.equal(plugin.pluginId, "estate-race-player");

  const source = await getPublishedPlayerWebPluginBundleSource({
    gameId: plugin.gameId,
    pluginId: plugin.pluginId,
    contentHash: plugin.contentHash
  });
  assert.match(source, /estate-race/);
  assert.doesNotMatch(source, /state\.secret/u);
});
