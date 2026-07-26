/**
 * Focused proof for final scoring and irreversible session completion.
 *
 * Authoring is compiled in memory, so this test never rewrites the checked-in
 * manifest. Direct state preparation supplies a bounded end-of-round fixture;
 * request, cancellation, scoring, ranking and completion still pass through
 * the production Game Intent → Mechanics dispatcher.
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
  buildSessionCompletionAuthoring,
  finishActionIds,
  unvaluedAssetOwner
} from "./build-session-completion.mjs";

const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const gameRoot = path.resolve(toolsRoot, "..");
const repoRoot = path.resolve(gameRoot, "..", "..");
const credentialSha256 = "c".repeat(64);
const { compileAuthoringText } = authoringCompiler;
const admissionController = {
  async assertNewCommandAdmitted() {}
};
let commandSequence = 0;
let manifestPromise;

const readJson = async (filePath) =>
  JSON.parse(await readFile(filePath, "utf8"));

const nextCommandId = () => {
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32BE(++commandSequence, 12);
  return `cli_${bytes.toString("base64url")}`;
};

/** Compile the generated slice once without touching a production artifact. */
const loadManifest = async () => {
  manifestPromise ??= (async () => {
    const source = await readJson(authoringPath);
    const built = buildSessionCompletionAuthoring(source);
    const output = compileAuthoringText(
      {
        kind: "game",
        sourceFile: authoringPath,
        outputFile: path.join(
          repoRoot,
          ".tmp",
          "cmt-session-completion.manifest.json"
        ),
        sourceMapFile: path.join(
          repoRoot,
          ".tmp",
          "cmt-session-completion.source-map.json"
        )
      },
      `${JSON.stringify(built, null, 2)}\n`
    );
    return validateGameManifest(output.manifest);
  })();
  return manifestPromise;
};

const team = ({ type, coins, debt = 0, placementStatus = "placed" }) => ({
  objectType: "game.team",
  facets: { placementStatus },
  attributes: {
    label: type,
    type,
    colorId: "test-color",
    coins,
    outstandingDebt: debt,
    finalScoreBase: 0
  }
});

const wagon = ({ ownerTeamId, availability = "active" }) => ({
  objectType: "transport.wagon",
  facets: { availability },
  attributes: {
    ownerTeamId,
    finalScoreOwnerTeamId: unvaluedAssetOwner,
    finalPurchaseValue: 0
  }
});

const locomotive = ({ ownerTeamId, availability = "active" }) => ({
  objectType: "transport.locomotive",
  facets: { availability },
  attributes: {
    ownerTeamId,
    finalScoreOwnerTeamId: unvaluedAssetOwner,
    finalPurchaseValue: 0
  }
});

/**
 * Prepare a reporting boundary with both a turn-scoped wagon price and a
 * persistent locomotive price. A returned market wagon and an excluded team
 * deliberately carry large values so accidental inclusion is obvious.
 */
const finalRoundState = (manifest) => {
  const state = structuredClone(manifest.state);
  state.public.session = {
    ...state.public.session,
    fixtureId: "normal-start-policy",
    status: "running",
    phase: "reporting",
    turnNumber: 7,
    finishConfirmationPending: false,
    canRequestFinish: true
  };
  state.public.market.basePurchasePrices = {
    wagon: 6,
    locomotive: 12
  };
  state.public.turnEffects.purchasePriceOverrides = {
    wagon: 4,
    locomotive: null
  };
  state.public.objects.teams = {
    "guild-a": team({
      type: "locomotive_guild",
      coins: 6,
      debt: 1
    }),
    "guild-b": team({
      type: "locomotive_guild",
      coins: 29
    }),
    "logistics-a": team({
      type: "logistics_company",
      coins: 20,
      debt: 3
    }),
    "logistics-b": team({
      type: "logistics_company",
      coins: 15
    }),
    "excluded-rich-team": team({
      type: "logistics_company",
      coins: 1_000_000,
      placementStatus: "excluded"
    })
  };
  state.public.objects.wagons = {
    "wagon-a1": wagon({ ownerTeamId: "logistics-a" }),
    "wagon-a2": wagon({ ownerTeamId: "logistics-a" }),
    "wagon-b1": wagon({ ownerTeamId: "logistics-b" }),
    "returned-wagon": wagon({
      ownerTeamId: "logistics-b",
      availability: "sold"
    }),
    "excluded-wagon": wagon({
      ownerTeamId: "excluded-rich-team",
      availability: "sold"
    })
  };
  state.public.objects.locomotives = {
    "locomotive-a1": locomotive({ ownerTeamId: "guild-a" }),
    "locomotive-a2": locomotive({ ownerTeamId: "guild-a" })
  };
  state.public.log = [];
  return state;
};

/** Create one isolated facilitator session from the generated immutable bundle. */
const createSession = async (manifest, state) => {
  const store = new InMemorySessionStore();
  const created = await store.createSession({
    gameId: manifest.meta.id,
    sessionRole: "facilitator",
    initialState: structuredClone(state),
    immutableBundle: createImmutableBundleContent(manifest.meta.id, manifest),
    principal: {
      principalId: "session-completion-test-facilitator",
      kind: "local-controller",
      role: "facilitator",
      actorScope: { kind: "all-session-actors" },
      credentialSha256
    }
  });
  return { store, sessionId: created.session.sessionId };
};

const dispatch = async ({ store, sessionId, actionId }) => {
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
      params: {}
    }
  });
};

/** Prove a rejected transition preserves both data and optimistic version. */
const assertRejectedWithoutMutation = async (session, actionId) => {
  const before = await session.store.getSession(session.sessionId);
  let rejected = false;
  try {
    const outcome = await dispatch({ ...session, actionId });
    rejected =
      outcome.result.ok === false && outcome.receipt.status === "rejected";
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, `${actionId} must be rejected`);
  const after = await session.store.getSession(session.sessionId);
  assert.equal(after.version.stateVersion, before.version.stateVersion);
  assert.deepEqual(after.state, before.state);
};

test("generator is idempotent and keeps one closed final action set", async () => {
  const source = await readJson(authoringPath);
  const first = buildSessionCompletionAuthoring(source);
  const second = buildSessionCompletionAuthoring(first);
  assert.deepEqual(second, first);

  const root = first.root;
  assert.deepEqual(
    root.logic.actions
      .filter((candidate) => candidate.id.startsWith("session.finish."))
      .map((candidate) => candidate.id)
      .sort(),
    [...finishActionIds].sort()
  );
  assert.deepEqual(
    Object.keys(root.mechanics.plans)
      .filter((planId) => planId.startsWith("session.finish."))
      .sort(),
    [...finishActionIds].sort()
  );

  const confirmSteps =
    root.mechanics.plans["session.finish.confirm"].transaction.steps;
  assert.deepEqual(
    confirmSteps
      .filter((step) => step.op === "core.entities.score")
      .map((step) => step.selection),
    [{ op: "value.result", stepId: "active-teams" }]
  );
  assert.deepEqual(
    confirmSteps.find((step) => step.op === "core.ranking.stable")?.groups,
    [
      {
        id: "logistics-companies",
        selection: { op: "value.result", stepId: "logistics-teams" }
      },
      {
        id: "locomotive-guilds",
        selection: { op: "value.result", stepId: "guild-teams" }
      }
    ]
  );
});

test("completion is unavailable before reporting and cancellation is reversible", async () => {
  const manifest = await loadManifest();
  const state = finalRoundState(manifest);
  state.public.session.phase = "construction";
  state.public.session.canRequestFinish = false;
  const session = await createSession(manifest, state);
  await assertRejectedWithoutMutation(session, "session.finish.request");

  const current = await session.store.getSession(session.sessionId);
  const reporting = structuredClone(current);
  reporting.state.public.session.phase = "reporting";
  reporting.state.public.session.canRequestFinish = true;
  reporting.version.stateVersion += 1;
  reporting.updatedAt = new Date();
  await session.store.updateSession(reporting, {
    expectedStateVersion: current.version.stateVersion
  });

  const requested = await dispatch({
    ...session,
    actionId: "session.finish.request"
  });
  assert.equal(requested.result.ok, true);
  let snapshot = await session.store.getSession(session.sessionId);
  assert.equal(snapshot.state.public.session.status, "finishing");
  assert.equal(snapshot.state.public.session.finishConfirmationPending, true);

  const cancelled = await dispatch({
    ...session,
    actionId: "session.finish.cancel"
  });
  assert.equal(cancelled.result.ok, true);
  snapshot = await session.store.getSession(session.sessionId);
  assert.equal(snapshot.state.public.session.status, "running");
  assert.equal(snapshot.state.public.session.phase, "reporting");
  assert.equal(snapshot.state.public.session.canRequestFinish, true);
});

test("final score uses effective prices, omits excluded state and preserves ties", async () => {
  const manifest = await loadManifest();
  const session = await createSession(manifest, finalRoundState(manifest));

  assert.equal(
    (await dispatch({ ...session, actionId: "session.finish.request" })).result.ok,
    true
  );
  assert.equal(
    (await dispatch({ ...session, actionId: "session.finish.confirm" })).result.ok,
    true
  );

  const snapshot = await session.store.getSession(session.sessionId);
  assert.equal(snapshot.state.public.session.status, "finished");
  assert.equal(snapshot.state.public.session.phase, "finished");
  assert.equal(snapshot.state.public.finalResults.status, "calculated");
  assert.equal(snapshot.state.public.finalResults.completedTurn, 7);
  assert.deepEqual(snapshot.state.public.finalResults.purchasePrice, {
    wagon: 4,
    locomotive: 12
  });

  const rankings = snapshot.state.public.finalResults.rankings;
  const scores = new Map(
    Object.values(rankings).flatMap((group) => group.standings)
      .map((entry) => [entry.entityId, entry])
  );
  assert.deepEqual([...scores.keys()].sort(), [
    "guild-a",
    "guild-b",
    "logistics-a",
    "logistics-b"
  ]);
  assert.equal(scores.get("logistics-a").score, 25);
  assert.equal(scores.get("logistics-b").score, 19);
  assert.equal(scores.get("guild-a").score, 29);
  assert.equal(scores.get("guild-b").score, 29);
  assert.deepEqual(
    scores.get("logistics-b").relatedItems.map((item) => item.entityId),
    ["wagon-b1"],
    "returned market vehicles must not appear in the explainable breakdown"
  );

  assert.deepEqual(rankings["logistics-companies"].winners, ["logistics-a"]);
  assert.deepEqual(
    rankings["locomotive-guilds"].winners,
    ["guild-a", "guild-b"]
  );
  assert.equal(rankings["locomotive-guilds"].tiedForFirst, true);
  assert.deepEqual(
    rankings["locomotive-guilds"].standings.map((entry) => entry.rank),
    [1, 1]
  );

  await assertRejectedWithoutMutation(session, "session.finish.request");
  await assertRejectedWithoutMutation(session, "session.finish.confirm");
});
