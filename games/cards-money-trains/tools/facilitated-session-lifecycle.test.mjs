/**
 * Focused Runtime proof for the two persisted learning pauses.
 *
 * The current authoring is compiled only in memory, so this test exercises the
 * exact generic Game Intent → Mechanics dispatcher without rewriting the
 * shared production manifest. Direct state setup supplies only the safe
 * reporting boundary and turn number; every pause transition itself is a
 * protected facilitator action.
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
  buildFacilitatedSessionAuthoring
} from "./build-facilitated-session.mjs";

const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const gameRoot = path.resolve(toolsRoot, "..");
const repoRoot = path.resolve(gameRoot, "..", "..");
const credentialSha256 = "e".repeat(64);
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

/** Compile once for all behavior tests; generated files remain virtual. */
const loadManifest = async () => {
  manifestPromise ??= (async () => {
    const output = compileAuthoringText(
      {
        kind: "game",
        sourceFile: authoringPath,
        outputFile: path.join(
          repoRoot,
          ".tmp",
          "cmt-facilitated-session.manifest.json"
        ),
        sourceMapFile: path.join(
          repoRoot,
          ".tmp",
          "cmt-facilitated-session.source-map.json"
        )
      },
      await readFile(authoringPath, "utf8")
    );
    return validateGameManifest(output.manifest);
  })();
  return manifestPromise;
};

/** Build a normal-session state at one atomically safe reporting boundary. */
const reportingState = (manifest, turnNumber) => {
  const state = structuredClone(manifest.state);
  state.public.session.fixtureId = "normal-start-policy";
  state.public.session.status = "running";
  state.public.session.phase = "reporting";
  state.public.session.turnNumber = turnNumber;
  state.public.session.finishConfirmationPending = false;
  state.public.construction.mode = null;
  state.public.construction.available = false;
  state.public.log = [];
  return state;
};

/** Create one isolated facilitator session from a supplied persisted snapshot. */
const createSession = async (manifest, state) => {
  const store = new InMemorySessionStore();
  const created = await store.createSession({
    gameId: manifest.meta.id,
    sessionRole: "facilitator",
    initialState: structuredClone(state),
    immutableBundle: createImmutableBundleContent(manifest.meta.id, manifest),
    principal: {
      principalId: "facilitated-session-test-facilitator",
      kind: "local-controller",
      role: "facilitator",
      actorScope: { kind: "all-session-actors" },
      credentialSha256
    }
  });
  return { store, sessionId: created.session.sessionId };
};

/** Dispatch one optimistic-concurrency protected Game Intent. */
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

/** Mutate only bounded upstream facts while preserving state-version rules. */
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

/** Prove a refused lifecycle command leaves state and version untouched. */
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

test("generator is idempotent and publishes exactly the six bounded pause intents", async () => {
  const source = await readJson(authoringPath);
  assert.deepEqual(buildFacilitatedSessionAuthoring(source), source);
  assert.deepEqual(
    source.root.content.data.facilitatedSession.finalReflectionGuide,
    {
      workflowStatus: "pending-author-answers",
      preparationMinutes: { min: 5, max: 15 },
      presentationMinutesMax: 2,
      conclusionCount: { min: 2, max: 3 },
      questions: [
        "Какая была стратегия изначально?",
        "К чему нужно было адаптироваться?",
        "К чему удалось адаптироваться? За счет чего?",
        "К чему адаптироваться не удалось? Почему?",
        "Как бы вы оценили результаты игры для вас и для других команд?"
      ]
    }
  );

  const manifest = await loadManifest();
  assert.deepEqual(
    Object.keys(manifest.actions)
      .filter((id) => id.startsWith("methodology.pause."))
      .sort(),
    [
      "methodology.pause.first.complete",
      "methodology.pause.first.defer",
      "methodology.pause.first.start",
      "methodology.pause.second.complete",
      "methodology.pause.second.defer",
      "methodology.pause.second.start"
    ]
  );
  assert.equal(manifest.state.public.methodology.activePauseId, null);
  assert.equal(manifest.state.public.methodology.pauses.first.dueTurn, 3);
  assert.equal(manifest.state.public.methodology.pauses.second.dueTurn, 5);
  assert.equal(
    manifest.state.public.methodology.pauses.first.prompts.length,
    5
  );
  assert.equal(
    manifest.state.public.methodology.pauses.second.prompts.length,
    6
  );
  const boardActions = manifest.state.public.board.availableActions;
  assert.match(
    boardActions.find((item) =>
      item.id === "methodology-pause-first-start"
    )?.description ?? "",
    /длительность паузы — 15–30 минут.*Что вы наблюдаете/u
  );
  assert.match(
    boardActions.find((item) =>
      item.id === "methodology-pause-second-complete"
    )?.description ?? "",
    /длительность паузы — около 30 минут.*Какова текущая ситуация/u
  );
});

test("facilitator can start before the reminder turn, but cannot defer before it", async () => {
  const manifest = await loadManifest();
  const beforeDue = await createSession(manifest, reportingState(manifest, 2));
  await assertRejectedWithoutMutation(
    beforeDue,
    "methodology.pause.first.defer"
  );

  const started = await dispatch({
    ...beforeDue,
    actionId: "methodology.pause.first.start"
  });
  assert.equal(started.result.ok, true);
  let snapshot = await beforeDue.store.getSession(beforeDue.sessionId);
  assert.equal(snapshot.state.public.session.phase, "methodology-pause");
  assert.equal(snapshot.state.public.methodology.pauses.first.status, "active");

  const completed = await dispatch({
    ...beforeDue,
    actionId: "methodology.pause.first.complete"
  });
  assert.equal(completed.result.ok, true);
  snapshot = await beforeDue.store.getSession(beforeDue.sessionId);
  assert.equal(snapshot.state.public.session.phase, "reporting");
  assert.equal(
    snapshot.state.public.methodology.pauses.first.status,
    "completed"
  );
});

test("first reminder is non-blocking, can be deferred, survives a store restart and never repeats", async () => {
  const manifest = await loadManifest();
  const session = await createSession(manifest, reportingState(manifest, 3));
  const deferred = await dispatch({
    ...session,
    actionId: "methodology.pause.first.defer"
  });
  assert.equal(deferred.result.ok, true);
  let snapshot = await session.store.getSession(session.sessionId);
  assert.equal(snapshot.state.public.session.phase, "reporting");
  assert.equal(
    snapshot.state.public.methodology.pauses.first.status,
    "scheduled"
  );
  assert.equal(snapshot.state.public.methodology.pauses.first.dueTurn, 4);
  assert.deepEqual(snapshot.state.public.log.at(-1)?.data, {
    kind: "methodology",
    pauseId: "reflection-after-turn-3",
    turnNumber: 3,
    dueTurn: 4
  });
  await updateScenario(session, (state) => {
    state.public.session.turnNumber = 4;
  });
  const started = await dispatch({
    ...session,
    actionId: "methodology.pause.first.start"
  });
  assert.equal(started.result.ok, true);
  snapshot = await session.store.getSession(session.sessionId);
  assert.equal(snapshot.state.public.session.phase, "methodology-pause");
  assert.equal(
    snapshot.state.public.methodology.activePauseId,
    "reflection-after-turn-3"
  );
  assert.equal(snapshot.state.public.methodology.pauses.first.status, "active");

  // The in-memory store cannot reopen an existing process-level record. A new
  // store/session created from the exact persisted state is the nearest focused
  // game proof; the platform's PostgreSQL tests own durable row recovery.
  const restarted = await createSession(manifest, snapshot.state);
  let restored = await restarted.store.getSession(restarted.sessionId);
  assert.equal(restored.state.public.session.phase, "methodology-pause");
  assert.equal(
    restored.state.public.methodology.activePauseId,
    "reflection-after-turn-3"
  );

  const completed = await dispatch({
    ...restarted,
    actionId: "methodology.pause.first.complete"
  });
  assert.equal(completed.result.ok, true);
  restored = await restarted.store.getSession(restarted.sessionId);
  assert.equal(restored.state.public.session.phase, "reporting");
  assert.equal(restored.state.public.methodology.activePauseId, null);
  assert.equal(
    restored.state.public.methodology.pauses.first.status,
    "completed"
  );
  await assertRejectedWithoutMutation(
    restarted,
    "methodology.pause.first.start"
  );
  await assertRejectedWithoutMutation(
    restarted,
    "methodology.pause.first.defer"
  );
  await assertRejectedWithoutMutation(
    restarted,
    "methodology.pause.first.complete"
  );
});

test("a due reminder never stops turn advancement and the second pause follows the first", async () => {
  const manifest = await loadManifest();
  const ignored = await createSession(manifest, reportingState(manifest, 3));
  const advanced = await dispatch({
    ...ignored,
    actionId: "reporting.phase.finish"
  });
  assert.equal(advanced.result.ok, true);
  let snapshot = await ignored.store.getSession(ignored.sessionId);
  assert.equal(snapshot.state.public.session.phase, "news");
  assert.equal(snapshot.state.public.session.turnNumber, 4);
  assert.equal(
    snapshot.state.public.methodology.pauses.first.status,
    "scheduled"
  );
  assert.equal(snapshot.state.public.methodology.pauses.first.dueTurn, 3);

  const second = reportingState(manifest, 5);
  const blockedSecond = await createSession(manifest, second);
  await assertRejectedWithoutMutation(
    blockedSecond,
    "methodology.pause.second.start"
  );

  second.public.methodology.pauses.first.status = "completed";
  const session = await createSession(manifest, second);
  const started = await dispatch({
    ...session,
    actionId: "methodology.pause.second.start"
  });
  assert.equal(started.result.ok, true);
  snapshot = await session.store.getSession(session.sessionId);
  assert.equal(snapshot.state.public.session.phase, "methodology-pause");
  assert.equal(
    snapshot.state.public.methodology.activePauseId,
    "reflection-after-turn-5"
  );
  assert.equal(snapshot.state.public.methodology.pauses.second.status, "active");

  const completed = await dispatch({
    ...session,
    actionId: "methodology.pause.second.complete"
  });
  assert.equal(completed.result.ok, true);
  snapshot = await session.store.getSession(session.sessionId);
  assert.equal(snapshot.state.public.session.phase, "reporting");
  assert.equal(
    snapshot.state.public.methodology.pauses.second.status,
    "completed"
  );
  await assertRejectedWithoutMutation(
    session,
    "methodology.pause.second.start"
  );
});
