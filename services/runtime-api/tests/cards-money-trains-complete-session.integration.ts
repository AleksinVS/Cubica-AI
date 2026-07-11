/**
 * Public-boundary acceptance for the complete Cards Money Trains mock session.
 *
 * The game-specific sequence lives in its fixture; this test deliberately uses
 * only the ordinary HTTP API and the generic session-store port. That division
 * proves the platform can load the game as data and that neither this test nor
 * Runtime API needs game-id branches to conduct the session.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { SessionStorePort } from "@cubica/contracts-session";
import { Pool } from "pg";

import { createRuntimeApiServer } from "../src/modules/player-api/httpServer.ts";
import { InMemorySessionStore } from "../src/modules/session/inMemorySessionStore.ts";
import { createSessionStoreFromEnvironment } from "../src/modules/session/sessionStoreFactory.ts";

type RuntimeState = Record<string, unknown>;

interface SessionSnapshot {
  readonly sessionId: string;
  /** Present on create/GET responses; action responses intentionally omit it. */
  readonly gameId?: string;
  readonly version: {
    readonly sessionId: string;
    readonly stateVersion: number;
    readonly lastEventSequence: number;
  };
  readonly state: RuntimeState;
}

interface TranscriptStep {
  readonly order: number;
  readonly actionId: string;
  readonly params?: Record<string, unknown> | null;
  readonly restartAfter?: boolean;
  readonly checkpointId?: string;
  readonly expected: {
    readonly phase: string;
    readonly turnNumber: number;
    readonly status?: "active" | "finished";
    readonly finishConfirmationPending?: boolean;
  };
}

interface CompleteSessionTranscript {
  readonly fixtureKind: "complete-mock-session";
  readonly gameId: "cards-money-trains-mock";
  readonly steps: ReadonlyArray<TranscriptStep>;
  readonly rejectionProbes: ReadonlyArray<RejectionProbe>;
  readonly final: {
    readonly phase: "finished";
    readonly status: "finished";
    readonly turnNumber: number;
    readonly minTurnNumber: number;
    readonly balances: Readonly<Record<string, number>>;
    readonly winners: Readonly<Record<string, ReadonlyArray<string>>>;
  };
}

interface RejectionProbe {
  readonly id:
    | "wrong-phase"
    | "insufficient-money"
    | "closed-road"
    | "full-terminal"
    | "incompatible-wagon"
    | "premature-delivery"
    | "incomplete-financing";
  /** Run against the state after this successful transcript step; zero means initial state. */
  readonly afterStepOrder: number;
  readonly actionId: string;
  readonly params?: Record<string, unknown> | null;
  readonly expectedError: string;
  readonly expectedStateVersionDelta: 0;
}

interface RunningApi {
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const transcriptPath = path.join(
  repoRoot,
  "games",
  "cards-money-trains-mock",
  "fixtures",
  "complete-session-transcript.json"
);
const migrationPath = path.join(repoRoot, "services", "runtime-api", "migrations", "001_game_sessions.up.sql");
const databaseUrl = process.env.TEST_POSTGRES_DATABASE_URL;
const transcript = await readTranscriptIfReady();

test("ordinary game id conducts the complete facilitated mock session through Runtime API", {
  skip: transcript === null ? "complete mock transcript is being produced by the game-content slice" : false
}, async () => {
  assert.ok(transcript);
  const store = new InMemorySessionStore<RuntimeState>();
  const api = await startApi(store);

  try {
    const created = await createSession(api.baseUrl, transcript.gameId);
    const result = await executeTranscript(api.baseUrl, created, transcript.steps, transcript.rejectionProbes);
    assertCompleteSessionEvidence(result, transcript.final);

    // The client projection hides future decks, while the server-owned state
    // retains them for deterministic continuation and replay.
    const raw = await store.getSession(created.sessionId);
    assert.ok(raw);
    assertHiddenDeckState(raw.state);
  } finally {
    await api.close();
  }
});

// Real duplicate protection is intentionally not simulated in a fixture: the
// current DispatchActionInput/POST /actions contract has neither an expected
// state version nor a durable request identifier. LEGACY-0052 keeps this
// acceptance gap explicit until the public reliability contract is approved.
test("repeating the same action request does not apply money, cards or movement twice", {
  skip: "blocked by LEGACY-0052 until the action precondition contract is approved"
}, () => undefined);

test("the same mock session survives two new Runtime API and PostgreSQL store instances", {
  skip: transcript === null
    ? "complete mock transcript is being produced by the game-content slice"
    : databaseUrl === undefined
      ? "set TEST_POSTGRES_DATABASE_URL to a disposable PostgreSQL database"
      : false
}, async () => {
  assert.ok(transcript);
  assert.ok(databaseUrl);
  await applySessionMigration(databaseUrl);

  let api: RunningApi | null = null;
  let snapshot: SessionSnapshot | null = null;
  let restartCount = 0;

  try {
    api = await startPersistentApi(databaseUrl);
    snapshot = await createSession(api.baseUrl, transcript.gameId);

    for (const step of transcript.steps) {
      const committed = await dispatchAction(api.baseUrl, snapshot, step);
      assertStepExpectation(committed, step);
      snapshot = committed;

      if (step.restartAfter === true) {
        const beforeRestart = snapshot;
        await api.close();
        api = await startPersistentApi(databaseUrl);

        const restored = await getSession(api.baseUrl, beforeRestart.sessionId);
        assertCommittedSnapshot(restored, beforeRestart, `restart after step ${step.order} changed the public snapshot`);
        assert.equal(restored.gameId, transcript.gameId);
        snapshot = restored;
        restartCount += 1;
      }
    }

    assert.equal(restartCount, 2, "GSR-035 requires two independent runtime restart checkpoints");
    assert.ok(snapshot);
    assertCompleteSessionEvidence({
      snapshot,
      observedPhases: collectExpectedPhases(transcript.steps),
      observedActiveTurnAfterSix: transcript.steps.some((step) =>
        step.expected.turnNumber > 6 && (step.expected.status ?? "active") === "active"
      ),
      finishActions: new Set(transcript.steps.map((step) => step.actionId).filter((id) => id.startsWith("session.finish.")))
    }, transcript.final);
  } finally {
    if (api !== null) {
      await api.close();
    }
    if (snapshot !== null) {
      await assertPersistedSecretDecksAndDelete(databaseUrl, snapshot.sessionId);
    }
  }
});

async function readTranscriptIfReady(): Promise<CompleteSessionTranscript | null> {
  try {
    const parsed = JSON.parse(await readFile(transcriptPath, "utf8")) as Partial<CompleteSessionTranscript>;
    if (parsed.fixtureKind !== "complete-mock-session" || parsed.gameId !== "cards-money-trains-mock") {
      return null;
    }
    assert.ok(Array.isArray(parsed.steps) && parsed.steps.length > 0, "complete mock transcript needs steps");
    assert.ok(
      Array.isArray(parsed.rejectionProbes) && parsed.rejectionProbes.length > 0,
      "complete mock transcript needs rejection probes"
    );
    const orders = parsed.steps.map((step) => step.order);
    assert.equal(new Set(orders).size, orders.length, "complete mock transcript step orders must be unique");
    assert.deepEqual(orders, [...orders].sort((left, right) => left - right), "complete mock transcript steps must be ordered");
    assert.equal(
      parsed.steps.filter((step) => step.restartAfter === true).length,
      2,
      "complete mock transcript needs exactly two PostgreSQL restart checkpoints"
    );
    const stepOrders = new Set(orders);
    for (const probe of parsed.rejectionProbes) {
      assert.equal(probe.expectedStateVersionDelta, 0, `${probe.id} must be atomic`);
      assert.ok(stepOrders.has(probe.afterStepOrder), `${probe.id} references an unknown step`);
    }
    return parsed as CompleteSessionTranscript;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function startApi(sessionStore: SessionStorePort<RuntimeState>): Promise<RunningApi> {
  const server = createRuntimeApiServer({ port: 0, sessionStore });
  await server.start();
  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    close: () => server.close()
  };
}

async function startPersistentApi(connectionString: string): Promise<RunningApi> {
  const sessionStore = createSessionStoreFromEnvironment({
    SESSION_STORE: "postgresql",
    DATABASE_URL: connectionString,
    PGPOOL_MAX: "2"
  });
  return startApi(sessionStore);
}

async function createSession(baseUrl: string, gameId: string): Promise<SessionSnapshot> {
  const response = await postJson(baseUrl, "/sessions", {
    gameId,
    playerId: "facilitator-acceptance"
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const snapshot = response.body as SessionSnapshot;
  assert.equal(snapshot.gameId, gameId);
  assertProjectionAndBalances(snapshot);
  return snapshot;
}

async function getSession(baseUrl: string, sessionId: string): Promise<SessionSnapshot> {
  const response = await fetch(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}`);
  const body = await readJson(response);
  assert.equal(response.status, 200, JSON.stringify(body));
  const snapshot = body as SessionSnapshot;
  assertProjectionAndBalances(snapshot);
  return snapshot;
}

async function dispatchAction(
  baseUrl: string,
  previous: SessionSnapshot,
  step: TranscriptStep
): Promise<SessionSnapshot> {
  const response = await postJson(baseUrl, "/actions", {
    sessionId: previous.sessionId,
    playerId: "facilitator-acceptance",
    actionId: step.actionId,
    ...(step.params ? { params: step.params } : {}),
    // An untrusted caller may send extra data, but only the manifest action and
    // persisted server snapshot are authoritative. The test verifies this
    // attempted phase/funds overwrite never appears in the committed state.
    state: {
      public: {
        session: { phase: "finished" },
        teams: { forged: { coins: 1_000_000 } }
      }
    }
  });
  assert.equal(response.status, 200, `step ${step.order} ${step.actionId}: ${JSON.stringify(response.body)}`);
  const snapshot = response.body as SessionSnapshot;
  assert.equal(snapshot.version.stateVersion, previous.version.stateVersion + 1);
  assert.equal(readRecord(readRecord(snapshot.state, "public"), "teams").forged, undefined);
  assertProjectionAndBalances(snapshot);

  // A fresh GET must return exactly the committed response. This detects a UI
  // or test-side shadow state that was never persisted by Runtime API.
  const restored = await getSession(baseUrl, snapshot.sessionId);
  assertCommittedSnapshot(restored, snapshot, `step ${step.order} was not persisted exactly`);
  return snapshot;
}

async function executeTranscript(
  baseUrl: string,
  initial: SessionSnapshot,
  steps: ReadonlyArray<TranscriptStep>,
  rejectionProbes: ReadonlyArray<RejectionProbe>
) {
  let snapshot = initial;
  const observedPhases = new Set<string>([readSession(snapshot).phase as string]);
  const finishActions = new Set<string>();
  const rejectionKinds = new Set<RejectionProbe["id"]>();
  let observedActiveTurnAfterSix = false;

  await runRejectionProbes(baseUrl, snapshot, rejectionProbes, 0, rejectionKinds);

  for (const step of steps) {
    snapshot = await dispatchAction(baseUrl, snapshot, step);
    assertStepExpectation(snapshot, step);
    const session = readSession(snapshot);
    observedPhases.add(String(session.phase));
    if (Number(session.turnNumber) > 6 && session.status === "active") {
      observedActiveTurnAfterSix = true;
    }
    if (step.actionId.startsWith("session.finish.")) {
      finishActions.add(step.actionId);
    }
    await runRejectionProbes(baseUrl, snapshot, rejectionProbes, step.order, rejectionKinds);
  }

  return { snapshot, observedPhases, observedActiveTurnAfterSix, finishActions, rejectionKinds };
}

async function runRejectionProbes(
  baseUrl: string,
  snapshot: SessionSnapshot,
  probes: ReadonlyArray<RejectionProbe>,
  afterStepOrder: number,
  observed: Set<RejectionProbe["id"]>
): Promise<void> {
  for (const probe of probes.filter((candidate) => candidate.afterStepOrder === afterStepOrder)) {
    const before = await getSession(baseUrl, snapshot.sessionId);
    const response = await postJson(baseUrl, "/actions", {
      sessionId: snapshot.sessionId,
      playerId: "facilitator-acceptance",
      actionId: probe.actionId,
      ...(probe.params ? { params: probe.params } : {})
    });
    assert.ok(response.status >= 400 && response.status < 500, `${probe.id}: ${JSON.stringify(response.body)}`);
    const error = readRecordValue(response.body, `${probe.id} error response`).error;
    assert.equal(typeof error, "string", `${probe.id} must return a public error message`);
    assert.match(error as string, new RegExp(probe.expectedError, "iu"), `${probe.id} returned an unexpected error`);

    // Rejected actions must be exactly atomic: not only business fields, but
    // also the concurrency and event cursors remain byte-for-byte equivalent.
    assert.deepEqual(await getSession(baseUrl, snapshot.sessionId), before, `${probe.id} changed the stored snapshot`);
    observed.add(probe.id);
  }
}

function assertStepExpectation(snapshot: SessionSnapshot, step: TranscriptStep): void {
  const session = readSession(snapshot);
  assert.equal(session.phase, step.expected.phase, `phase after step ${step.order}`);
  assert.equal(session.turnNumber, step.expected.turnNumber, `turn after step ${step.order}`);
  if (step.expected.status !== undefined) {
    assert.equal(session.status, step.expected.status, `status after step ${step.order}`);
  }
  if (step.expected.finishConfirmationPending !== undefined) {
    assert.equal(
      session.finishConfirmationPending,
      step.expected.finishConfirmationPending,
      `finish confirmation after step ${step.order}`
    );
  }
}

function assertCompleteSessionEvidence(result: {
  readonly snapshot: SessionSnapshot;
  readonly observedPhases: ReadonlySet<string>;
  readonly observedActiveTurnAfterSix: boolean;
  readonly finishActions: ReadonlySet<string>;
  readonly rejectionKinds?: ReadonlySet<RejectionProbe["id"]>;
}, final: CompleteSessionTranscript["final"]): void {
  const requiredPhases = [
    "setup",
    "news",
    "maintenance",
    "market",
    "cargo",
    "operations",
    "construction",
    "debrief",
    "finished"
  ];
  for (const phase of requiredPhases) {
    assert.ok(result.observedPhases.has(phase), `complete session did not observe phase "${phase}"`);
  }
  assert.equal(result.observedActiveTurnAfterSix, true, "turn 7 must remain active until the facilitator finishes it");
  assert.deepEqual(
    [...result.finishActions].sort(),
    ["session.finish.cancel", "session.finish.confirm", "session.finish.request"],
    "manual finish must prove request, cancellation and explicit confirmation"
  );
  if (result.rejectionKinds !== undefined) {
    assert.deepEqual(
      [...result.rejectionKinds].sort(),
      [
        "closed-road",
        "full-terminal",
        "incompatible-wagon",
        "incomplete-financing",
        "insufficient-money",
        "premature-delivery",
        "wrong-phase"
      ],
      "the complete transcript must execute every required atomic rejection probe"
    );
  }
  const finalSession = readSession(result.snapshot);
  assert.equal(finalSession.phase, final.phase);
  assert.equal(finalSession.status, final.status);
  assert.equal(finalSession.turnNumber, final.turnNumber);
  assert.ok(Number(finalSession.turnNumber) >= final.minTurnNumber);
  const publicState = readRecord(result.snapshot.state, "public");
  const teams = readRecord(publicState, "teams");
  assert.deepEqual(
    Object.fromEntries(Object.entries(final.balances).map(([teamId]) => [teamId, readRecordValue(teams[teamId], teamId).coins])),
    final.balances
  );
  const rankingGroups = readRecord(readRecord(publicState, "ranking"), "groups");
  assert.deepEqual(
    Object.fromEntries(Object.entries(final.winners).map(([groupId]) => [
      groupId,
      readRecordValue(rankingGroups[groupId], `ranking ${groupId}`).winners
    ])),
    final.winners
  );
  assertProjectionAndBalances(result.snapshot);
}

function assertProjectionAndBalances(snapshot: SessionSnapshot): void {
  const secret = snapshot.state.secret;
  if (typeof secret === "object" && secret !== null && !Array.isArray(secret)) {
    assert.equal((secret as Record<string, unknown>).decks, undefined, "player projection exposed future deck order");
  }

  const publicState = readRecord(snapshot.state, "public");
  const teams = readRecord(publicState, "teams");
  for (const [teamId, value] of Object.entries(teams)) {
    const team = readRecordValue(value, `team ${teamId}`);
    if (team.coins !== undefined) {
      assert.equal(typeof team.coins, "number", `${teamId} coins must be numeric`);
      assert.ok(Number.isFinite(team.coins as number) && (team.coins as number) >= 0, `${teamId} has negative coins`);
    }
  }

  const players = readRecord(snapshot.state, "players");
  for (const [playerId, value] of Object.entries(players)) {
    const metrics = readRecord(readRecordValue(value, `player ${playerId}`), "metrics");
    if (metrics.cash !== undefined) {
      assert.equal(typeof metrics.cash, "number", `${playerId} cash must be numeric`);
      assert.ok(Number.isFinite(metrics.cash as number) && (metrics.cash as number) >= 0, `${playerId} has negative cash`);
    }
  }
}

function collectExpectedPhases(steps: ReadonlyArray<TranscriptStep>): Set<string> {
  return new Set(["setup", ...steps.map((step) => step.expected.phase)]);
}

function readSession(snapshot: SessionSnapshot): Record<string, unknown> {
  return readRecord(readRecord(snapshot.state, "public"), "session");
}

function readRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readRecordValue(value: unknown, label: string): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

async function postJson(baseUrl: string, pathname: string, body: unknown) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await readJson(response) };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text === "" ? {} : JSON.parse(text);
}

async function applySessionMigration(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  pool.on("error", () => undefined);
  try {
    await pool.query(await readFile(migrationPath, "utf8"));
  } finally {
    await pool.end();
  }
}

async function assertPersistedSecretDecksAndDelete(connectionString: string, sessionId: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  pool.on("error", () => undefined);
  try {
    const result = await pool.query<{ state: RuntimeState }>("SELECT state FROM game_sessions WHERE id = $1", [sessionId]);
    const persisted = result.rows[0]?.state;
    assert.ok(persisted, "persisted session disappeared before cleanup");
    await pool.query("DELETE FROM game_sessions WHERE id = $1", [sessionId]);
    assertHiddenDeckState(persisted);
  } finally {
    await pool.end();
  }
}

function assertHiddenDeckState(state: RuntimeState): void {
  const decks = readRecord(readRecord(state, "secret"), "decks");
  assert.ok(Object.keys(decks).length > 0, "server snapshot did not retain hidden decks");
}

/** Compare the common create/GET/action response boundary without inventing gameId on action responses. */
function assertCommittedSnapshot(actual: SessionSnapshot, expected: SessionSnapshot, message: string): void {
  assert.deepEqual(
    {
      sessionId: actual.sessionId,
      version: actual.version,
      state: actual.state
    },
    {
      sessionId: expected.sessionId,
      version: expected.version,
      state: expected.state
    },
    message
  );
}
