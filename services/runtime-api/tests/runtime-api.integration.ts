/**
 * Cross-boundary HTTP checks for runtime-api.
 *
 * The harness deliberately behaves like an untrusted player client: session
 * creation receives a one-time credential, every session-bound request uses
 * that Bearer credential, and gameplay mutations use the closed canonical
 * command envelope. Game-specific rule matrices belong in game tests; this
 * file verifies platform routing, trust boundaries and a few vertical slices.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { PlayerFacingContent } from "@cubica/contracts-manifest";
import type { PublicSessionCommandReceipt } from "@cubica/contracts-session";

import { createRuntimeApiServer } from "../src/modules/player-api/httpServer.ts";
import { InMemorySessionStore } from "../src/modules/session/inMemorySessionStore.ts";

type SessionVersion = {
  sessionId: string;
  stateVersion: number;
  lastEventSequence: number;
};

type PublicState = {
  objects?: { cards?: Record<string, { facets?: { selection?: string; resolution?: string; availability?: string } }> };
  metrics?: {
    score?: number;
    time?: number;
    [key: string]: unknown;
  };
  timeline: {
    line?: string;
    stepIndex?: number;
    stageId?: string;
    screenId?: string;
    activeInfoId?: string;
    canAdvance?: boolean;
    stage_id: string;
    step_index?: number;
    screen_id?: string;
  };
  flags: {
    cards: Record<
      string,
      {
        selected?: boolean;
        resolved?: boolean;
        locked?: boolean;
        available?: boolean;
      }
    >;
    team?: Record<string, { selected?: boolean }>;
  };
  teamSelection?: {
    pickCount?: number;
    selectedMemberIds?: Array<string>;
  };
  ui?: {
    activePanel?: string;
    activeScreen?: string;
    serverRequested?: boolean;
  };
  /** Mechanics event journal stored in state; event payload is nested in `data`. */
  log: Array<{
    eventType: string;
    audience: string;
    summary: string;
    data: Record<string, unknown>;
  }>;
};

type SecretState = {
  stagePicks?: Record<string, unknown>;
  stage_picks?: Record<string, unknown>;
  opening?: {
    selectedCardId?: string;
  };
};

type SessionState = {
  public: PublicState;
  secret?: SecretState;
};

type SessionResponse = {
  sessionId: string;
  gameId: string;
  version: SessionVersion;
  state: SessionState;
};

type CreateSessionResponse = SessionResponse & {
  credential: string;
};

type ActionResponse = {
  sessionId: string;
  version: SessionVersion;
  state: SessionState;
  receipt: PublicSessionCommandReceipt;
};

type TransportRoadPreviewResponse = {
  sessionId: string;
  actionId: string;
  usedStateVersion: number;
  paramsFingerprint: string;
  definitionHash: string;
  networkId: string;
  fromNodeId: string;
  toNodeId: string;
  polyline: Array<{ x: number; y: number }>;
  regionSequence: Array<string>;
  regionSegments: number;
  candidateCount: number;
};

const runtimeApi = createRuntimeApiServer({
  port: 0,
  sessionStore: new InMemorySessionStore<Record<string, unknown>>()
});
let baseUrl = "";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const previewContentRoot = path.join(repoRoot, ".tmp", "editor-worktrees", "runtime-content-source-test");
const sessionCredentials = new Map<string, string>();
let commandSequence = 0;

const readJson = async <T>(response: Response): Promise<T> => {
  const text = await response.text();

  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
};

const requestJson = async <T>(path: string, init: RequestInit = {}): Promise<{ response: Response; body: T }> => {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers
  });

  return {
    response,
    body: await readJson<T>(response)
  };
};

const nextCommandId = (): string => {
  commandSequence += 1;
  return `cli_${commandSequence.toString(36).padStart(22, "0")}`;
};

const requireSessionCredential = (sessionId: string): string => {
  const credential = sessionCredentials.get(sessionId);
  assert.ok(credential, `Test harness has no credential for session ${sessionId}`);
  return credential;
};

const authenticatedRequestJson = async <T>(
  sessionId: string,
  path: string,
  init: RequestInit = {}
): Promise<{ response: Response; body: T }> => {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${requireSessionCredential(sessionId)}`);
  return requestJson<T>(path, { ...init, headers });
};

const createSession = async (body: Record<string, unknown> = {}) => {
  const gameId = typeof body.gameId === "string" ? body.gameId : "antarctica";
  const { response, body: session } = await requestJson<CreateSessionResponse>("/sessions", {
    method: "POST",
    body: JSON.stringify({
      gameId,
      ...body
    })
  });

  assert.equal(response.status, 201, JSON.stringify(session));
  assert.equal(session.gameId, gameId);
  assert.equal(typeof session.sessionId, "string");
  assert.equal(typeof session.credential, "string");
  sessionCredentials.set(session.sessionId, session.credential);

  return session;
};

const getSession = async (sessionId: string) => authenticatedRequestJson<SessionResponse>(
  sessionId,
  `/sessions/${encodeURIComponent(sessionId)}`
);

type DispatchOptions = {
  commandId?: string;
  expectedStateVersion?: number;
  params?: Record<string, unknown>;
};

const dispatchAction = async (
  sessionId: string,
  actionId: string,
  options: DispatchOptions = {}
) => {
  const snapshot = options.expectedStateVersion === undefined
    ? await getSession(sessionId)
    : undefined;
  if (snapshot !== undefined) {
    assert.equal(snapshot.response.status, 200);
  }
  return authenticatedRequestJson<ActionResponse | { error: string }>(sessionId, "/actions", {
    method: "POST",
    body: JSON.stringify({
      sessionId,
      actionId,
      commandId: options.commandId ?? nextCommandId(),
      expectedStateVersion: options.expectedStateVersion ?? snapshot!.body.version.stateVersion,
      params: options.params ?? {}
    })
  });
};

const writePreviewContentRoot = async (
  transformManifest: (manifest: Record<string, any>) => void = () => {}
) => {
  const sourceGameDir = path.join(repoRoot, "games", "simple-choice");
  const targetGameDir = path.join(previewContentRoot, "games", "simple-choice");
  await rm(previewContentRoot, { recursive: true, force: true });
  await mkdir(path.join(targetGameDir, "ui", "web"), { recursive: true });

  const gameManifest = JSON.parse(await readFile(path.join(sourceGameDir, "game.manifest.json"), "utf8")) as Record<string, any>;
  gameManifest.meta.name = "Simple Choice Preview Source";
  gameManifest.state.public.choice = { ...(gameManifest.state.public.choice ?? {}), outcome: "preview-source" };
  transformManifest(gameManifest);

  await writeFile(path.join(targetGameDir, "game.manifest.json"), `${JSON.stringify(gameManifest, null, 2)}\n`, "utf8");
  await writeFile(
    path.join(targetGameDir, "ui", "web", "ui.manifest.json"),
    await readFile(path.join(sourceGameDir, "ui", "web", "ui.manifest.json"), "utf8"),
    "utf8"
  );
};

before(async () => {
  await runtimeApi.start();
  baseUrl = `http://127.0.0.1:${runtimeApi.port}`;
});

after(async () => {
  await runtimeApi.close();
  sessionCredentials.clear();
  await rm(previewContentRoot, { recursive: true, force: true });
});

// ============================================================
// Health and Readiness Tests
// ============================================================

test("GET /health returns 200 with correct payload", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);

  const body = await readJson<{ status: string; service: string }>(response);
  assert.equal(body.status, "ok");
  assert.equal(body.service, "runtime-api");
});

test("GET /health is fast under normal conditions", async () => {
  const start = performance.now();
  const response = await fetch(`${baseUrl}/health`);
  const elapsed = performance.now() - start;

  assert.equal(response.status, 200);
  // Allow headroom for shared CI/agent environments while keeping the endpoint
  // bounded to a quick in-process response.
  assert.ok(elapsed < 100, `Expected health check to be fast, took ${elapsed}ms`);
});

test("GET /readiness returns 200 with correct payload when runtime is healthy", async () => {
  const response = await fetch(`${baseUrl}/readiness`);
  assert.equal(response.status, 200);

  const body = await readJson<{
    ready: boolean;
    service: string;
    dependencies: {
      content: { status: string };
      sessionStore: { status: string; mode: string };
    };
  }>(response);

  assert.equal(body.ready, true);
  assert.equal(body.service, "runtime-api");
  assert.equal(body.dependencies.content.status, "ok");
  assert.equal(body.dependencies.sessionStore.status, "ok");
  assert.equal(body.dependencies.sessionStore.mode, "in-memory");
});

test("GET /readiness is reachable without authentication", async () => {
  const response = await fetch(`${baseUrl}/readiness`);
  // Should succeed without any auth headers
  assert.equal(response.status, 200);
});

test("GET /readiness has machine-readable payload", async () => {
  const response = await fetch(`${baseUrl}/readiness`);
  assert.equal(response.status, 200);

  const text = await response.text();
  const body = JSON.parse(text); // Should be valid JSON

  // Verify all required fields exist
  assert.equal(typeof body.ready, "boolean");
  assert.equal(body.service, "runtime-api");
  assert.equal(typeof body.dependencies, "object");
  assert.equal(typeof body.dependencies.content, "object");
  assert.equal(typeof body.dependencies.sessionStore, "object");
});

test("GET /games/:id/readiness keeps deterministic games independent from Agent Runtime", async () => {
  const { response, body } = await requestJson<{
    ready: boolean;
    executionMode: string;
    dependencies: {
      gameContent: { status: string };
      agentRuntime: { status: string; required: boolean; mode: string };
    };
  }>("/games/antarctica/readiness");

  assert.equal(response.status, 200);
  assert.equal(body.ready, true);
  assert.equal(body.executionMode, "deterministic");
  assert.equal(body.dependencies.gameContent.status, "ok");
  assert.equal(body.dependencies.agentRuntime.status, "ok");
  assert.equal(body.dependencies.agentRuntime.required, false);
  assert.equal(body.dependencies.agentRuntime.mode, "not-required");
});

test("GET /games/:id/readiness reports required Agent Runtime as unavailable for AI-driven preview content", async () => {
  await writePreviewContentRoot((gameManifest) => {
    gameManifest.executionMode = "ai-driven";
    gameManifest.agentRuntime = {
      agentId: "scenario-agent",
      initialActionId: "choice.accept",
      required: true,
      allowedCapabilities: ["selectPublishedIntent"],
      surfaceCatalog: ["cubica.choiceList"],
      failurePolicy: "pause",
      contextExposurePolicy: {
        publicState: true,
        secretState: "none",
        manifestProjection: ["/meta", "/actions"]
      }
    };
  });

  const sourceId = "runtime-ai-readiness-test";
  const { response: reloadResponse } = await requestJson<{ ok: boolean }>("/content/reload", {
    method: "POST",
    body: JSON.stringify({
      gameId: "simple-choice",
      contentSourceId: sourceId,
      contentRoot: previewContentRoot
    })
  });
  assert.equal(reloadResponse.status, 200);

  const { response, body } = await requestJson<{
    ready: boolean;
    executionMode: string;
    dependencies: {
      agentRuntime: {
        status: string;
        required: boolean;
        mode: string;
        agentId: string;
        failurePolicy: string;
      };
    };
  }>(`/games/simple-choice/readiness?contentSourceId=${sourceId}`);

  assert.equal(response.status, 503);
  assert.equal(body.ready, false);
  assert.equal(body.executionMode, "ai-driven");
  assert.equal(body.dependencies.agentRuntime.status, "error");
  assert.equal(body.dependencies.agentRuntime.required, true);
  assert.equal(body.dependencies.agentRuntime.mode, "missing");
  assert.equal(body.dependencies.agentRuntime.agentId, "scenario-agent");
  assert.equal(body.dependencies.agentRuntime.failurePolicy, "pause");
});

test("POST /sessions rejects AI-driven game launch when required Agent Runtime is unavailable", async () => {
  await writePreviewContentRoot((gameManifest) => {
    gameManifest.executionMode = "ai-driven";
    gameManifest.agentRuntime = {
      agentId: "scenario-agent",
      initialActionId: "choice.accept",
      required: true,
      allowedCapabilities: ["selectPublishedIntent"],
      surfaceCatalog: ["cubica.choiceList"],
      failurePolicy: "pause",
      contextExposurePolicy: {
        publicState: true,
        secretState: "none",
        manifestProjection: ["/meta", "/actions"]
      }
    };
  });

  const sourceId = "runtime-ai-session-gate-test";
  const { response: reloadResponse } = await requestJson<{ ok: boolean }>("/content/reload", {
    method: "POST",
    body: JSON.stringify({
      gameId: "simple-choice",
      contentSourceId: sourceId,
      contentRoot: previewContentRoot
    })
  });
  assert.equal(reloadResponse.status, 200);

  const { response, body } = await requestJson<{ error: string }>("/sessions", {
    method: "POST",
    body: JSON.stringify({
      gameId: "simple-choice",
      contentSourceId: sourceId
    })
  });

  assert.equal(response.status, 503);
  assert.match(body.error, /requires Agent Runtime/);
  assert.match(body.error, /scenario-agent/);
});

test("POST /sessions allows explicit deterministic fallback when Agent Runtime is unavailable", async () => {
  await writePreviewContentRoot((gameManifest) => {
    gameManifest.executionMode = "ai-driven";
    gameManifest.agentRuntime = {
      agentId: "scenario-agent",
      initialActionId: "choice.accept",
      required: true,
      allowedCapabilities: ["selectPublishedIntent"],
      surfaceCatalog: ["cubica.choiceList"],
      failurePolicy: "deterministicFallback",
      deterministicFallbackActionId: "choice.accept",
      contextExposurePolicy: {
        publicState: true,
        secretState: "none",
        manifestProjection: ["/meta", "/actions"]
      }
    };
  });

  const sourceId = "runtime-ai-deterministic-fallback-test";
  const { response: reloadResponse } = await requestJson<{ ok: boolean }>("/content/reload", {
    method: "POST",
    body: JSON.stringify({
      gameId: "simple-choice",
      contentSourceId: sourceId,
      contentRoot: previewContentRoot
    })
  });
  assert.equal(reloadResponse.status, 200);

  const body = await createSession({ gameId: "simple-choice", contentSourceId: sourceId });
  assert.equal(body.gameId, "simple-choice");
});

test("runtimeReady blocks the incomplete normative package without exposing authoring blockers", async () => {
  const { response: readinessResponse, body: readiness } = await requestJson<{
    ready: boolean;
    dependencies: {
      gameContent: {
        status: string;
        message?: string;
      };
    };
  }>("/games/cards-money-trains/readiness");

  assert.equal(readinessResponse.status, 503);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.dependencies.gameContent.status, "error");
  assert.equal(readiness.dependencies.gameContent.message, "Game content is not ready for runtime sessions.");
  assert.equal(JSON.stringify(readiness).includes("runtimeBlockers"), false);

  const { response: sessionResponse, body: sessionError } = await requestJson<{ error: string }>("/sessions", {
    method: "POST",
    body: JSON.stringify({ gameId: "cards-money-trains" })
  });
  assert.equal(sessionResponse.status, 409);
  assert.equal(sessionError.error, "Game \"cards-money-trains\" is not ready to start a runtime session.");
  assert.equal(sessionError.error.includes("runtimeBlockers"), false);
});

// Agent Turn command execution is covered by agent-intent-selection.test.ts,
// which uses the authenticated canonical envelope and the real command ledger.
test("committed ai-driven-choice fixture reports Agent Runtime unavailable until mock is enabled", async () => {
  const previousMockFlag = process.env.CUBICA_ENABLE_MOCK_AGENT_RUNTIME;
  delete process.env.CUBICA_ENABLE_MOCK_AGENT_RUNTIME;

  try {
    const { response: readinessResponse, body: readiness } = await requestJson<{
      ready: boolean;
      executionMode: string;
      dependencies: {
        agentRuntime: {
          status: string;
          mode: string;
          runtimeId: string;
          reason?: string;
        };
      };
    }>("/games/ai-driven-choice/readiness");

    assert.equal(readinessResponse.status, 503);
    assert.equal(readiness.ready, false);
    assert.equal(readiness.executionMode, "ai-driven");
    assert.equal(readiness.dependencies.agentRuntime.status, "error");
    assert.equal(readiness.dependencies.agentRuntime.mode, "missing");
    assert.equal(readiness.dependencies.agentRuntime.runtimeId, "mock");
    assert.match(readiness.dependencies.agentRuntime.reason ?? "", /CUBICA_ENABLE_MOCK_AGENT_RUNTIME/);

    const { response: sessionResponse, body: sessionError } = await requestJson<{ error: string }>("/sessions", {
      method: "POST",
      body: JSON.stringify({
        gameId: "ai-driven-choice"
      })
    });

    assert.equal(sessionResponse.status, 503);
    assert.match(sessionError.error, /requires Agent Runtime/);
  } finally {
    if (previousMockFlag === undefined) {
      delete process.env.CUBICA_ENABLE_MOCK_AGENT_RUNTIME;
    } else {
      process.env.CUBICA_ENABLE_MOCK_AGENT_RUNTIME = previousMockFlag;
    }
  }
});

test("POST /sessions creates an antarctica session", async () => {
  const session = await createSession();
  const expectedTeamMemberIds = [
    "fedya",
    "aliona",
    "leo",
    "grisha",
    "liza",
    "zenya",
    "zora",
    "arkadii",
    "vasya",
    "tima"
  ];

  assert.equal(session.version.stateVersion, 0);
  assert.equal(session.version.lastEventSequence, 0);
  assert.equal(session.state.public.timeline.stageId, "stage_intro");
  assert.equal(session.state.public.timeline.stage_id, "stage_intro");
  assert.equal(session.state.public.timeline.stepIndex, 0);
  assert.equal(session.state.public.timeline.canAdvance, false);
  assert.equal(session.state.public.teamSelection?.pickCount, 0);
  assert.deepEqual(session.state.public.teamSelection?.selectedMemberIds, []);
  for (const memberId of expectedTeamMemberIds) {
    assert.equal(session.state.public.flags.team?.[memberId]?.selected, false);
  }
  assert.deepEqual(session.state.public.log, []);
});

test("POST /sessions rejects invalid request bodies", async () => {
  const { response, body } = await requestJson<{ error: string }>("/sessions", {
    method: "POST",
    body: JSON.stringify({
      gameId: 42
    })
  });

  assert.equal(response.status, 400);
  assert.match(body.error, /gameId must match/);
});

test("POST /sessions with an empty body responds 400 (not 500)", async () => {
  // Regression: a missing gameId used to reach the service layer, which threw a
  // plain Error mapped to HTTP 500. It must now be rejected as a 400 client error.
  const { response, body } = await requestJson<{ error: string }>("/sessions", {
    method: "POST",
    body: JSON.stringify({})
  });

  assert.equal(response.status, 400);
  assert.match(body.error, /gameId is required/);
});

test("POST /sessions with a completely empty request body responds 400", async () => {
  // No JSON body at all: readJsonBody yields {}, so gameId is still missing.
  const response = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });
  const body = (await readJson<{ error: string }>(response));

  assert.equal(response.status, 400);
  assert.match(body.error, /gameId is required/);
});

test("runtime ingress rejects oversized JSON bodies with and without Content-Length", async () => {
  const oversized = "x".repeat(2 * 1024 * 1024 + 1);
  const declared = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: oversized
  });
  assert.equal(declared.status, 413);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(oversized));
      controller.close();
    }
  });
  const chunked = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: stream,
    duplex: "half"
  } as RequestInit & { duplex: "half" });
  assert.equal(chunked.status, 413);
});

test("POST /sessions rejects unsafe game ids before repository lookup", async () => {
  const { response, body } = await requestJson<{ error: string }>("/sessions", {
    method: "POST",
    body: JSON.stringify({
      gameId: "../antarctica"
    })
  });

  assert.equal(response.status, 400);
  assert.match(body.error, /gameId must match/);
});

test("simple-choice creates a session and dispatches a manifest action", async () => {
  const session = await createSession({ gameId: "simple-choice" });
  assert.equal(session.gameId, "simple-choice");
  assert.equal(session.state.public.timeline.screenId, "intro");
  assert.equal(session.state.public.metrics?.score, 0);

  const { response: actionResponse, body: action } = await dispatchAction(session.sessionId, "choice.accept");

  assert.equal(actionResponse.status, 200);
  const actionBody = action as ActionResponse;
  assert.equal(actionBody.state.public.timeline.screenId, "result");
  assert.equal(actionBody.state.public.timeline.stepIndex, 1);
  assert.equal(actionBody.state.public.metrics?.score, 1);
  assert.equal((actionBody.state.public as unknown as { choice: { outcome: string } }).choice.outcome, "accepted");
  assert.match(actionBody.state.public.log[0].eventType, /^choice\.accept\.event\./u);
  assert.equal(actionBody.state.public.log[0].data.displayMode, "summary");
  assert.equal(actionBody.state.public.log[0].data.entityType, "choice");
  assert.equal(actionBody.receipt.status, "applied");
  assert.equal(actionBody.receipt.actionId, "choice.accept");
  assert.deepEqual(actionBody.receipt.eventRefs, [`${session.sessionId}:1`]);
});

test("GET /sessions/:id returns the created session snapshot", async () => {
  const created = await createSession();
  const { response, body: session } = await getSession(created.sessionId);

  assert.equal(response.status, 200);
  assert.equal(session.sessionId, created.sessionId);
  assert.equal(session.gameId, "antarctica");
  assert.equal(session.version.stateVersion, 0);
  assert.equal(session.state.public.timeline.stageId, "stage_intro");
  assert.equal(session.state.public.timeline.stage_id, "stage_intro");
});

test("POST /actions executes a published Antarctica Mechanics plan", async () => {
  const created = await createSession();
  const { response, body: actionBody } = await dispatchAction(
    created.sessionId,
    "opening.info.i0.advance",
    { expectedStateVersion: created.version.stateVersion }
  );

  assert.equal(response.status, 200);
  const action = actionBody as ActionResponse;
  assert.equal(action.sessionId, created.sessionId);
  assert.equal(action.version.stateVersion, 1);
  assert.equal(action.version.lastEventSequence, 1);
  assert.equal(action.state.public.timeline.stepIndex, 1);

  const log = action.state.public.log;
  assert.equal(log.length, 1);
  assert.match(log[0].eventType, /^opening\.info\.i0\.advance\.event\./u);
  assert.equal(log[0].audience, "public");
  assert.equal(log[0].data.kind, "opening-info-advance");
  assert.equal(log[0].data.stageId, "stage_intro");
  assert.equal(action.receipt.status, "applied");
  assert.equal(action.receipt.stateVersionBefore, 0);
  assert.equal(action.receipt.stateVersionAfter, 1);
  assert.deepEqual(action.receipt.eventRefs, [`${created.sessionId}:1`]);
  assert.match(action.receipt.planHash ?? "", /^sha256:[a-f0-9]{64}$/u);

  const { response: getResponse, body: persisted } = await getSession(created.sessionId);

  assert.equal(getResponse.status, 200);
  assert.equal(persisted.version.stateVersion, 1);
  assert.equal(persisted.state.public.log.length, 1);
});

test("POST /actions returns the durable receipt for an exact command retry", async () => {
  const created = await createSession();
  const commandId = nextCommandId();
  const options = {
    commandId,
    expectedStateVersion: created.version.stateVersion,
    params: {}
  };

  const accepted = await dispatchAction(created.sessionId, "opening.info.i0.advance", options);
  assert.equal(accepted.response.status, 200);
  const acceptedBody = accepted.body as ActionResponse;
  assert.equal(acceptedBody.version.stateVersion, 1);
  assert.equal(acceptedBody.receipt.commandId, commandId);

  const repeated = await dispatchAction(created.sessionId, "opening.info.i0.advance", options);
  assert.equal(repeated.response.status, 200);
  const repeatedBody = repeated.body as ActionResponse;
  assert.deepEqual(repeatedBody.receipt, acceptedBody.receipt);
  assert.equal(repeatedBody.version.stateVersion, 1);
  assert.equal(repeatedBody.version.lastEventSequence, 1);

  const persisted = await getSession(created.sessionId);
  assert.equal(persisted.response.status, 200);
  assert.deepEqual(persisted.body.version, acceptedBody.version);
  assert.deepEqual(persisted.body.state, acceptedBody.state);
});

test("POST /actions classifies a changed unknown action under an existing commandId as reuse", async () => {
  const created = await createSession({ gameId: "simple-choice" });
  const commandId = nextCommandId();
  const accepted = await dispatchAction(created.sessionId, "choice.accept", {
    commandId,
    expectedStateVersion: created.version.stateVersion,
    params: {}
  });
  assert.equal(accepted.response.status, 200);

  const reused = await dispatchAction(created.sessionId, "unknown.action", {
    commandId,
    expectedStateVersion: created.version.stateVersion,
    params: {}
  });
  assert.equal(reused.response.status, 409);
  assert.equal((reused.body as unknown as { code: string }).code, "COMMAND_ID_REUSED");

  const persisted = await getSession(created.sessionId);
  assert.equal(persisted.body.version.stateVersion, 1);
  assert.equal(persisted.body.version.lastEventSequence, 1);
});

test("POST /actions returns the same durable receipt for an admitted gameplay rejection", async () => {
  const created = await createSession({ gameId: "simple-choice" });
  const accepted = await dispatchAction(created.sessionId, "choice.accept", {
    expectedStateVersion: created.version.stateVersion
  });
  assert.equal(accepted.response.status, 200);
  const acceptedBody = accepted.body as ActionResponse;

  // A second logical attempt is structurally valid and authenticated, but the
  // published assertion rejects it because the choice was already resolved.
  const commandId = nextCommandId();
  const rejectionOptions = {
    commandId,
    expectedStateVersion: acceptedBody.version.stateVersion,
    params: {}
  };
  const rejected = await dispatchAction(created.sessionId, "choice.accept", rejectionOptions);
  assert.equal(rejected.response.status, 200);
  const rejectedBody = rejected.body as ActionResponse;
  assert.equal(rejectedBody.receipt.status, "rejected");
  assert.equal(rejectedBody.receipt.commandId, commandId);
  assert.equal(rejectedBody.receipt.stateVersionBefore, acceptedBody.version.stateVersion);
  assert.equal(rejectedBody.receipt.stateVersionAfter, acceptedBody.version.stateVersion);
  assert.deepEqual(rejectedBody.receipt.eventRefs, []);
  assert.deepEqual(rejectedBody.version, acceptedBody.version);
  assert.deepEqual(rejectedBody.state, acceptedBody.state);

  const repeated = await dispatchAction(created.sessionId, "choice.accept", rejectionOptions);
  assert.equal(repeated.response.status, 200);
  const repeatedBody = repeated.body as ActionResponse;
  assert.deepEqual(repeatedBody.receipt, rejectedBody.receipt);
  assert.deepEqual(repeatedBody.version, acceptedBody.version);
  assert.deepEqual(repeatedBody.state, acceptedBody.state);
});

test("POST /action-previews/transport-road is read-only, schema-bounded and stale-safe", async () => {
  const store = new InMemorySessionStore<Record<string, unknown>>();
  const previewApi = createRuntimeApiServer({
    port: 0,
    sessionStore: store,
    createSessionRandomSeed: () => "00112233445566778899aabbccddeeff"
  });
  await previewApi.start();
  const previewBaseUrl = `http://127.0.0.1:${previewApi.port}`;
  const localRequest = async <T>(
    urlPath: string,
    body: Record<string, unknown>,
    credential?: string
  ) => {
    const response = await fetch(`${previewBaseUrl}${urlPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(credential === undefined ? {} : { Authorization: `Bearer ${credential}` })
      },
      body: JSON.stringify(body)
    });
    return { response, body: await readJson<T>(response) };
  };

  try {
    const created = await localRequest<CreateSessionResponse>("/sessions", {
      gameId: "cards-money-trains-mock"
    });
    assert.equal(created.response.status, 201);
    const sessionId = created.body.sessionId;
    const credential = created.body.credential;

    // Enter the construction phase through the trusted test seam. The HTTP
    // assertions below still exercise real content lookup, action guards,
    // schema-declared references, planner and response/error mapping.
    await store.withLockedSession(sessionId, async (current) => {
      assert.ok(current);
      const state = structuredClone(current.state) as any;
      state.public.session.phase = "construction";
      return {
        updatedSession: {
          ...current,
          state,
          version: {
            sessionId,
            stateVersion: current.version.stateVersion + 1,
            // This trusted setup mutates only gameplay state. Protected event
            // ids remain store-owned and advance only with committed events.
            lastEventSequence: current.version.lastEventSequence
          },
          updatedAt: new Date()
        },
        result: undefined
      };
    });
    const before = await store.getSession(sessionId);
    assert.ok(before);
    const randomBefore = structuredClone((before.state as any).secret.random);
    const previewRequest = {
      sessionId,
      expectedStateVersion: before.version.stateVersion,
      actionId: "construction.road.build",
      params: { fromNodeId: "mock-terminal-a", toNodeId: "mock-terminal-d" }
    };

    const preview = await localRequest<TransportRoadPreviewResponse>(
      "/action-previews/transport-road",
      previewRequest,
      credential
    );
    assert.equal(preview.response.status, 200);
    assert.equal(preview.body.usedStateVersion, before.version.stateVersion);
    assert.equal(preview.body.networkId, "main");
    assert.equal(
      preview.body.paramsFingerprint,
      `sha256:${createHash("sha256").update(JSON.stringify(previewRequest.params)).digest("hex")}`
    );
    assert.match(preview.body.definitionHash, /^sha256:[a-f0-9]{64}$/u);
    assert.ok(preview.body.polyline.length >= 2);
    assert.equal(preview.body.regionSegments, preview.body.regionSequence.length);
    assert.ok(preview.body.candidateCount >= 1);
    assert.equal(JSON.stringify(preview.body).includes("randomCounter"), false);
    const afterPreview = await store.getSession(sessionId);
    assert.deepEqual(afterPreview?.version, before.version);
    assert.deepEqual((afterPreview?.state as any).secret.random, randomBefore);

    const unsupportedParam = await localRequest<{ error: string }>(
      "/action-previews/transport-road",
      {
        ...previewRequest,
        params: { ...previewRequest.params, whiteContribution: preview.body.regionSegments * 2 }
      },
      credential
    );
    assert.equal(unsupportedParam.response.status, 400);
    assert.match(unsupportedParam.body.error, /additional properties|schema validation/iu);

    // Price is game content, not a property of the neutral route planner. This
    // fixture's published plan charges two units per traversed region.
    const constructionCost = preview.body.regionSegments * 2;
    const contributions = [
      Math.min(10, constructionCost),
      Math.min(10, Math.max(0, constructionCost - 10)),
      Math.min(10, Math.max(0, constructionCost - 20)),
      Math.max(0, constructionCost - 30)
    ];
    const confirmed = await localRequest<ActionResponse>("/actions", {
      sessionId,
      actionId: "construction.road.build",
      commandId: nextCommandId(),
      expectedStateVersion: preview.body.usedStateVersion,
      params: {
        fromNodeId: "mock-terminal-a",
        toNodeId: "mock-terminal-d",
        whiteContribution: contributions[0],
        redContribution: contributions[1],
        purpleContribution: contributions[2],
        greenContribution: contributions[3]
      }
    }, credential);
    assert.equal(confirmed.response.status, 200);
    assert.equal(confirmed.body.receipt.status, "applied");
    const persisted = await store.getSession(sessionId);
    assert.ok(persisted);
    const builtEdge = Object.values((persisted.state as any).public.objects.networkEdges)
      .map((candidate: any) => candidate?.attributes)
      .find((attributes: any) =>
        attributes?.fromNodeId === "mock-terminal-a" && attributes?.toNodeId === "mock-terminal-d");
    assert.ok(builtEdge);
    assert.deepEqual(builtEdge.geometry.polyline, preview.body.polyline);
    assert.deepEqual(builtEdge.routePlan.regionSequence, preview.body.regionSequence);

    const stale = await localRequest<{ error: string }>(
      "/action-previews/transport-road",
      previewRequest,
      credential
    );
    assert.equal(stale.response.status, 409);
    assert.match(stale.body.error, /changed after version/iu);
  } finally {
    await previewApi.close();
  }
});

test("ADR-092 card-61 metricChanges reflects the applied conditional effect in both history branches", async () => {
  // Card 61 (Antarctica) applies time +7 unconditionally and +5 more when card
  // 57 is not yet resolved. Two sessions with different card-57 history prove the
  // runtime records the actually applied conditional value, not an authored
  // constant. pro=60 makes the pro<60 and pro<45 branches inert, isolating the
  // card-57 conditional. Reaching board 61 by real play is impractical, so the
  // trusted store seam arranges the precondition state (as the transport-road
  // preview test does); the HTTP path still runs real admission and the plan.
  const store = new InMemorySessionStore<Record<string, unknown>>();
  const api = createRuntimeApiServer({
    port: 0,
    sessionStore: store,
    createSessionRandomSeed: () => "00112233445566778899aabbccddeeff"
  });
  await api.start();
  const localBaseUrl = `http://127.0.0.1:${api.port}`;

  const localCreate = async (): Promise<CreateSessionResponse> => {
    const res = await fetch(`${localBaseUrl}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId: "antarctica" })
    });
    return readJson<CreateSessionResponse>(res);
  };

  const arrangeCard61 = async (sessionId: string, card57Resolved: boolean) => {
    await store.withLockedSession(sessionId, async (current) => {
      assert.ok(current);
      const state = structuredClone(current.state) as {
        public: {
          timeline: Record<string, unknown>;
          metrics: Record<string, number>;
          objects: { cards: Record<string, { facets: Record<string, string> }> };
        };
      };
      const timeline = state.public.timeline;
      timeline.line = "main";
      timeline.stepIndex = 32;
      timeline.step_index = 32;
      timeline.screenId = "S2";
      timeline.screen_id = "S2";
      timeline.canAdvance = false;
      state.public.metrics.pro = 60;
      state.public.metrics.time = 5;
      state.public.objects.cards["57"].facets.resolution = card57Resolved ? "resolved" : "idle";
      return {
        updatedSession: {
          ...current,
          state: state as unknown as Record<string, unknown>,
          version: {
            sessionId,
            stateVersion: current.version.stateVersion + 1,
            lastEventSequence: current.version.lastEventSequence
          },
          updatedAt: new Date()
        },
        result: undefined
      };
    });
  };

  const dispatchCard61 = async (session: CreateSessionResponse): Promise<ActionResponse> => {
    const current = await store.getSession(session.sessionId);
    assert.ok(current);
    const res = await fetch(`${localBaseUrl}/actions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.credential}`
      },
      body: JSON.stringify({
        sessionId: session.sessionId,
        actionId: "opening.card.61",
        commandId: nextCommandId(),
        expectedStateVersion: current.version.stateVersion,
        params: {}
      })
    });
    return readJson<ActionResponse>(res);
  };

  type MetricChange = { metricId: string; before: number; after: number };
  const lastLogEntry = (action: ActionResponse): { metricChanges?: Array<MetricChange> } => {
    const log = (action.state.public as unknown as { log: Array<{ metricChanges?: Array<MetricChange> }> }).log;
    return log[log.length - 1];
  };
  const timeChange = (action: ActionResponse): MetricChange => {
    const entry = lastLogEntry(action);
    assert.ok(entry.metricChanges, "public card event must carry metricChanges");
    const time = entry.metricChanges.find((change) => change.metricId === "time");
    assert.ok(time, "metricChanges must include the time metric");
    return time;
  };

  try {
    const resolvedSession = await localCreate();
    await arrangeCard61(resolvedSession.sessionId, true);
    const resolvedAction = await dispatchCard61(resolvedSession);
    assert.equal(resolvedAction.receipt.status, "applied", JSON.stringify(resolvedAction));
    // Card 57 already resolved: only the unconditional +7 applies.
    assert.deepEqual(timeChange(resolvedAction), { metricId: "time", before: 5, after: 12 });

    const idleSession = await localCreate();
    await arrangeCard61(idleSession.sessionId, false);
    const idleAction = await dispatchCard61(idleSession);
    assert.equal(idleAction.receipt.status, "applied", JSON.stringify(idleAction));
    // Card 57 not resolved: the +5 conditional also applies (5 -> 17).
    assert.deepEqual(timeChange(idleAction), { metricId: "time", before: 5, after: 17 });

    // Every declared public state metric appears, in manifest catalog order.
    assert.deepEqual(
      lastLogEntry(idleAction).metricChanges?.map((change) => change.metricId),
      ["time", "pro", "rep", "lid", "man", "stat", "cont", "constr"]
    );
  } finally {
    await api.close();
  }
});

test("ADR-092 omits metricChanges for a game without a public metric catalog (simple-choice)", async () => {
  const session = await createSession({ gameId: "simple-choice" });
  const { response, body } = await dispatchAction(session.sessionId, "choice.accept");
  assert.equal(response.status, 200);
  const action = body as ActionResponse;
  const entry = (action.state.public as unknown as { log: Array<Record<string, unknown>> }).log[0];
  assert.ok(entry, "expected a simple-choice log entry");
  // simple-choice emits a public event but declares no metric catalog, so no
  // metric block is attached even though the game has a public.metrics.score.
  assert.equal("metricChanges" in entry, false);
});

test("GET /games/:id/player-content returns dataUi manifest for Antarctica", async () => {
  const { response, body } = await requestJson<PlayerFacingContent>("/games/antarctica/player-content");

  assert.equal(response.status, 200);
  assert.equal(body.gameId, "antarctica");
  assert.ok(body.ui);
  assert.equal(body.ui.id, "antarctica.ui.web");
  assert.equal(body.ui.entryPoint, "S1");
  // Multi-screen interface: screens["S1"] replaces the deprecated single-screen field
  assert.ok(body.ui.screens);
  assert.ok(body.ui.screens["S1"]);
  assert.equal(body.ui.screens["S1"].type, "screen");
  assert.ok(body.ui.screens["S1"].root);
  assert.equal(body.ui.screens["S1"].root.type, "screenComponent");
});

test("GET /games/:id/player-content returns Antarctica game-owned metric catalog", async () => {
  const { response, body } = await requestJson<PlayerFacingContent>("/games/antarctica/player-content");

  assert.equal(response.status, 200);
  const contentData = body.content?.data as {
    metrics?: Array<{ metricId?: string; kind?: string; computed?: unknown }>;
    rules?: { dayLimit?: number };
  };
  const metricIds = contentData.metrics?.map((metric) => metric.metricId);

  assert.deepEqual(metricIds, [
    "time",
    "remainingDays",
    "pro",
    "rep",
    "lid",
    "man",
    "stat",
    "cont",
    "constr"
  ]);
  assert.equal(contentData.rules?.dayLimit, 60);
  assert.equal(contentData.metrics?.find((metric) => metric.metricId === "remainingDays")?.kind, "computed");

  // TSK-20260719 R7 (ARC-008): the UI manifest now also publishes metric_specs
  // (captions/aliases/asset:<id> images) so player-web can derive
  // fallbackMetrics from the manifest instead of a plugin-owned dictionary.
  // This is a *second*, UI-facing metric catalog (SafeModeRenderer/legacy
  // fallback shape) distinct from the game-owned metric catalog asserted
  // above; both are expected to coexist.
  const metricSpecs = (body.ui as { metricSpecs?: Array<{ id?: string; images?: { sidebar?: string; topbar?: string } }> } | undefined)
    ?.metricSpecs;
  assert.ok(metricSpecs, "expected games/antarctica UI content to publish metric_specs");
  assert.deepEqual(
    metricSpecs?.map((spec) => spec.id),
    ["remainingDays", "pro", "rep", "lid", "man", "stat", "cont", "constr"]
  );
  // Images are asset:<id> references (ADR-063), never a baked-in /images/... path.
  for (const spec of metricSpecs ?? []) {
    assert.match(spec.images?.sidebar ?? "", /^asset:/u);
    assert.match(spec.images?.topbar ?? "", /^asset:/u);
  }
});

test("GET /games/:id/player-content returns published player-web plugin bundle references", async () => {
  const { response, body } = await requestJson<PlayerFacingContent>("/games/antarctica/player-content");

  assert.equal(response.status, 200);
  assert.equal(body.pluginBundles?.length, 1);
  const bundle = body.pluginBundles?.[0];
  assert.ok(bundle);
  assert.equal(bundle.pluginId, "antarctica-player");
  assert.equal(bundle.gameId, "antarctica");
  assert.equal(bundle.apiVersion, "2.0");
  assert.equal(bundle.target, "player-web");
  assert.equal(bundle.scope, "published");
  assert.match(bundle.contentHash, /^[a-f0-9]{64}$/u);
  assert.match(bundle.integrity ?? "", /^sha256-/u);
  assert.equal(
    bundle.url,
    `/published-plugin-bundles/antarctica/antarctica-player/${bundle.contentHash}.mjs`
  );
});

test("GET /published-plugin-bundles serves immutable verified bundle bytes", async () => {
  const { body } = await requestJson<PlayerFacingContent>("/games/antarctica/player-content");
  const bundle = body.pluginBundles?.[0];
  assert.ok(bundle);

  const response = await fetch(`${baseUrl}${bundle.url}`);
  const source = await response.text();
  const contentHash = createHash("sha256").update(source, "utf8").digest("hex");

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(response.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal(contentHash, bundle.contentHash);
  assert.match(source, /export const activate = __entry\.activate/);
});

test("GET /games/:id/player-content returns simple-choice UI manifest", async () => {
  const { response, body } = await requestJson<PlayerFacingContent>("/games/simple-choice/player-content");

  assert.equal(response.status, 200);
  assert.equal(body.gameId, "simple-choice");
  assert.equal(body.ui?.entryPoint, "intro");
  assert.ok(body.ui?.screens.intro);
  assert.ok(body.ui?.screens.result);
  assert.equal(body.ui?.metricSpecs?.[0]?.id, "score");
  assert.equal(body.pluginBundles, undefined);
});

test("editor preview content source serves generated manifests from a registered worktree", async () => {
  await writePreviewContentRoot();

  const sourceId = "runtime-content-source-test";
  const { response: reloadResponse } = await requestJson<{ ok: boolean }>("/content/reload", {
    method: "POST",
    body: JSON.stringify({
      gameId: "simple-choice",
      contentSourceId: sourceId,
      contentRoot: previewContentRoot
    })
  });
  assert.equal(reloadResponse.status, 200);

  const { response: contentResponse, body: content } = await requestJson<PlayerFacingContent>(
    `/games/simple-choice/player-content?contentSourceId=${sourceId}`
  );
  assert.equal(contentResponse.status, 200);
  assert.equal(content.name, "Simple Choice Preview Source");

  const session = await createSession({ gameId: "simple-choice", contentSourceId: sourceId });
  assert.equal((session.state.public as { choice?: { outcome?: string } }).choice?.outcome, "preview-source");
});

test("POST /sessions/:id/preview-restore rewinds only editor preview sessions", async () => {
  await writePreviewContentRoot();

  const sourceId = "runtime-preview-restore-test";
  const { response: reloadResponse } = await requestJson<{ ok: boolean }>("/content/reload", {
    method: "POST",
    body: JSON.stringify({
      gameId: "simple-choice",
      contentSourceId: sourceId,
      contentRoot: previewContentRoot
    })
  });
  assert.equal(reloadResponse.status, 200);

  const initial = await createSession({ gameId: "simple-choice", contentSourceId: sourceId });
  assert.equal(initial.version.stateVersion, 0);
  assert.equal(initial.version.lastEventSequence, 0);

  const { response: actionResponse, body: accepted } = await dispatchAction(initial.sessionId, "choice.accept");
  assert.equal(actionResponse.status, 200);
  assert.equal((accepted as ActionResponse).version.stateVersion, 1);
  assert.equal((accepted as ActionResponse).version.lastEventSequence, 1);
  assert.equal((accepted as ActionResponse).state.public.timeline.screenId, "result");
  assert.deepEqual((accepted as ActionResponse).receipt.eventRefs, [`${initial.sessionId}:1`]);

  const mismatchedTarget = await authenticatedRequestJson<{ error: string }>(
    initial.sessionId,
    `/sessions/${initial.sessionId}/preview-restore`,
    {
      method: "POST",
      body: JSON.stringify({
        state: initial.state,
        version: initial.version,
        targetEventSequence: 1
      })
    }
  );
  assert.equal(mismatchedTarget.response.status, 400);
  assert.match(mismatchedTarget.body.error, /must match version.lastEventSequence/u);

  const invalidState = structuredClone(initial.state) as SessionState;
  if (invalidState.public.metrics) invalidState.public.metrics.score = "corrupt" as unknown as number;
  const invalidRestore = await authenticatedRequestJson<{ error: string }>(
    initial.sessionId,
    `/sessions/${initial.sessionId}/preview-restore`,
    {
      method: "POST",
      body: JSON.stringify({
        state: invalidState,
        version: initial.version,
        targetEventSequence: 0
      })
    }
  );
  assert.equal(invalidRestore.response.status, 400);
  assert.match(invalidRestore.body.error, /does not match the Mechanics state model/u);

  const { response: restoreResponse, body: restored } = await authenticatedRequestJson<SessionResponse & { restored: true }>(
    initial.sessionId,
    `/sessions/${initial.sessionId}/preview-restore`,
    {
      method: "POST",
      body: JSON.stringify({
        state: initial.state,
        version: initial.version,
        targetEventSequence: 0,
        reason: "editor-preview-rollback"
      })
    }
  );
  assert.equal(restoreResponse.status, 200);
  assert.equal(restored.restored, true);
  assert.equal(restored.sessionId, initial.sessionId);
  assert.equal(restored.version.stateVersion, 2);
  assert.equal(restored.version.lastEventSequence, 1);
  assert.equal(restored.state.public.timeline.screenId, "intro");
  assert.equal(restored.state.public.metrics?.score, 0);

  const { response: replayResponse, body: replayed } = await dispatchAction(initial.sessionId, "choice.accept");
  assert.equal(replayResponse.status, 200);
  assert.equal((replayed as ActionResponse).version.stateVersion, 3);
  assert.equal((replayed as ActionResponse).version.lastEventSequence, 2);
  assert.equal((replayed as ActionResponse).state.public.timeline.screenId, "result");
  assert.deepEqual((replayed as ActionResponse).receipt.eventRefs, [`${initial.sessionId}:2`]);

  const production = await createSession({ gameId: "simple-choice" });

  const rejected = await authenticatedRequestJson<{ error: string }>(
    production.sessionId,
    `/sessions/${production.sessionId}/preview-restore`,
    {
      method: "POST",
      body: JSON.stringify({
        state: production.state,
        version: production.version,
        targetEventSequence: 0
      })
    }
  );
  assert.equal(rejected.response.status, 403);
  assert.match(rejected.body.error, /only for editor preview sessions/);
});

test("POST /actions rejects invalid request bodies", async () => {
  const created = await createSession();
  const { response, body } = await authenticatedRequestJson<{ error: string }>(created.sessionId, "/actions", {
    method: "POST",
    body: JSON.stringify({
      sessionId: created.sessionId,
      actionId: 123,
      commandId: nextCommandId(),
      expectedStateVersion: created.version.stateVersion,
      params: {}
    })
  });

  assert.equal(response.status, 400);
  assert.match(body.error, /actionId.*string|runtime command schema/iu);
});

test("POST /actions requires a non-negative integer expectedStateVersion", async () => {
  const created = await createSession();
  for (const expectedStateVersion of [undefined, -1, 0.5, "0"]) {
    const requestBody: Record<string, unknown> = {
      sessionId: created.sessionId,
      actionId: "opening.info.i0.advance",
      commandId: nextCommandId(),
      params: {}
    };
    if (expectedStateVersion !== undefined) {
      requestBody.expectedStateVersion = expectedStateVersion;
    }
    const { response, body } = await authenticatedRequestJson<{ error: string }>(created.sessionId, "/actions", {
      method: "POST",
      body: JSON.stringify(requestBody)
    });
    assert.equal(response.status, 400);
    assert.match(body.error, /expectedStateVersion/u);
  }
});

test("GET /games/:gameId/player-content returns player-facing content DTO", async () => {
  const { response, body } = await requestJson<Record<string, unknown>>("/games/antarctica/player-content");

  assert.equal(response.status, 200);
  assert.equal(body.gameId, "antarctica");
  assert.equal(typeof body.version, "string");
  assert.equal(typeof body.name, "string");
  assert.equal(typeof body.description, "string");
  assert.equal(body.locale, "ru-RU");
  assert.deepEqual(body.playerConfig, { min: 1, max: 1 });
  assert.ok(Array.isArray(body.actions));
  assert.ok(body.actions.length > 0);
  assert.equal(body.actions.some((a) => a.actionId === "showHint"), false);
  const infoAdvanceAction = body.actions.find((a) => a.actionId === "opening.info.i0.advance");
  assert.ok(infoAdvanceAction);
  assert.equal(infoAdvanceAction.capabilityFamily, "game.info.advance");
  assert.equal(infoAdvanceAction.capability, "game.info.advance");
  const ui = body.ui as { panels?: Record<string, unknown> } | undefined;
  assert.ok(ui?.panels?.hint);
  assert.ok(Array.isArray(body.mockups));
  assert.ok(body.mockups.length > 0);
  const firstMockup = body.mockups[0];
  assert.equal(typeof firstMockup.id, "string");
  assert.equal(typeof firstMockup.name, "string");
  assert.equal(typeof firstMockup.description, "string");
  assert.equal(typeof firstMockup.type, "string");
  assert.equal(typeof firstMockup.imagePath, "string");
  const content = body.content as Record<string, unknown>;
  const antarcticaContent = content.data as Record<string, unknown>;
  assert.ok(antarcticaContent);
  assert.ok(Array.isArray(antarcticaContent.infos));
  assert.ok(Array.isArray(antarcticaContent.teamSelections));
  assert.ok(Array.isArray(antarcticaContent.boards));
  assert.ok(Array.isArray(antarcticaContent.cards));
  const infoI0 = (antarcticaContent.infos as Array<{ id: string }>).find((entry: any) => entry.id === "i0");
  const infoI8 = (antarcticaContent.infos as Array<{ id: string }>).find((entry: any) => entry.id === "i8");
  const infoI9 = (antarcticaContent.infos as Array<{ id: string }>).find((entry: any) => entry.id === "i9");
  const infoI10 = (antarcticaContent.infos as Array<{ id: string }>).find((entry: any) => entry.id === "i10");
  const infoI11 = (antarcticaContent.infos as Array<{ id: string }>).find((entry: any) => entry.id === "i11");
  const infoI12 = (antarcticaContent.infos as Array<{ id: string }>).find((entry: any) => entry.id === "i12");
  const infoI13 = (antarcticaContent.infos as Array<{ id: string }>).find((entry: any) => entry.id === "i13");
  const infoI14 = (antarcticaContent.infos as Array<{ id: string }>).find((entry: any) => entry.id === "i14");
  const infoI14_2 = (antarcticaContent.infos as Array<{ id: string }>).find((entry: any) => entry.id === "i14_2");
  const infoI15 = (antarcticaContent.infos as Array<{ id: string }>).find((entry: any) => entry.id === "i15");
  const infoI16 = (antarcticaContent.infos as Array<{ id: string }>).find((entry: any) => entry.id === "i16");
  const teamSelection = (antarcticaContent.teamSelections as Array<{ stepIndex: number; id: string }>).find((entry: any) => entry.stepIndex === 15);
  assert.ok(infoI0);
  assert.ok(infoI8);
  assert.ok(infoI9);
  assert.ok(infoI10);
  assert.ok(infoI11);
  assert.ok(infoI12);
  assert.ok(infoI13);
  assert.ok(infoI14);
  assert.ok(infoI14_2);
  assert.ok(infoI15);
  assert.ok(infoI16);
  assert.ok(teamSelection);
  assert.equal((infoI0 as any).stepIndex, 0);
  assert.equal((infoI0 as any).screenId, "S1");
  assert.equal((infoI0 as any).advanceActionId, "opening.info.i0.advance");
  assert.equal((infoI8 as any).stepIndex, 12);
  assert.equal((infoI8 as any).screenId, "S1");
  assert.equal((infoI8 as any).title, "Что скажет народ?");
  assert.equal((infoI8 as any).advanceActionId, "opening.info.i8.advance");
  assert.equal((infoI9 as any).stepIndex, 14);
  assert.equal((infoI9 as any).screenId, "S1");
  assert.equal((infoI9 as any).title, "Создание «штаба»");
  assert.equal((infoI9 as any).advanceActionId, "opening.info.i9.advance");
  assert.equal((infoI10 as any).stepIndex, 16);
  assert.equal((infoI10 as any).screenId, "S1");
  assert.equal((infoI10 as any).title, "Работаем «в одной упряжке»");
  assert.equal((infoI10 as any).advanceActionId, "opening.info.i10.advance");
  assert.equal((infoI11 as any).stepIndex, 18);
  assert.equal((infoI11 as any).screenId, "S1");
  assert.equal((infoI11 as any).title, "Первые шаги");
  assert.equal(
    (infoI11 as any).body,
    "<p>Теперь, когда команда почувствовала в себе силы для свершений, нужно все-таки что-то сделать. Это желание вместе со странным параличом, сковавшим мысли, привели к тому, что команда просидела молча несколько часов.</p><p>«Ну, хватит! Кальмары уже переварились, пора задать жару!» Несмотря на то, что никакого смысла в этой фразе не было, она произвела волшебный эффект. Все вскочили и как будто бы стало ясно, что нужно делать.</p>"
  );
  assert.equal((infoI11 as any).advanceActionId, "opening.info.i11.advance");
  assert.equal((infoI12 as any).stepIndex, 20);
  assert.equal((infoI12 as any).screenId, "S1");
  assert.equal((infoI12 as any).title, "Разброд и шатание");
  assert.equal(
    (infoI12 as any).body,
    "<p>С одной стороны, жизнь пингвинов осталась прежней. С другой – коренным образом изменилась. Ощущение надвигающейся угрозы давило незаметно, но зато каждый день и каждый час. Кто-то пытался игнорировать это, кто-то, наоборот, позволял этом чувству взять верх, а кто-то даже наслаждался им.</p><p>От первого шока пингвины были как бы в состоянии легкой анестезии, которая быстро кончалась. Пока в штабе продумывали решения, в стае с каждым днем становилось тревожнее. Появились радикально настроенные формирования, слухи о грядущем конце света. Даже у Григория возникли свои последователи, которые все отрицали. Некоторые отрицали даже авторитет руководства, а некоторые - отрицали саму идею отрицания перспектив жизни на айсберге. В литературе пингвинов стали отчетливо видны признаки пост-модернизма и декадентства.</p><p>В общем, нужно было спешить, пока не грянул гром… Нужно ли тратить время на борьбу с паникой?</p>"
  );
  assert.equal((infoI12 as any).advanceActionId, "opening.info.i12.advance");
  assert.equal((infoI13 as any).stepIndex, 22);
  assert.equal((infoI13 as any).screenId, "S1");
  assert.equal((infoI13 as any).title, "Вперед-вперед!");
  assert.equal(
    (infoI13 as any).body,
    "<p>Сдержав волну паники, команда изменений смогла продолжить работу. </p><p>Уже начинала сказываться усталость от напряженной работы, но пингвины были полны решимости и энтузиазма. Они не хотели останавливаться. Только вперед! Только победа!</p>"
  );
  assert.equal((infoI13 as any).advanceActionId, "opening.info.i13.advance");
  assert.equal((infoI14 as any).stepIndex, 24);
  assert.equal((infoI14 as any).screenId, "S1");
  assert.equal((infoI14 as any).title, "Открытие");
  assert.equal(
    (infoI14 as any).body,
    "<p>Большинство пингвинов никогда не видели чайку вблизи. Они стояли в замешательстве и пытались понять, что это значит - быть чайкой? </p><p>\"Интересно, а как она держится в воздухе?\"... \"Кружится ли у нее голова, когда она летает?\"... \"Почему ее не сдувает ветром?\"... \"А где отдыхают чайки, когда устанут?\"... \"Есть ли у них дом?\"... \"Есть ли у них стая?\"... \"Можем ли мы с ней поговорить?\"... Эти и многие другие вопросы возникли в головах у пингвинов.</p><p>Хотя многие считают, что чайки и пингвины никогда не смогут ни о чем договориться, на самом деле это не так. Во-первых, пингвины в меру тактичны и не в меру любознательны, во-вторых, чайки достаточно общительны, в-третьих, далеко не все чайки являются природными врагами пингвинов (да и то лишь для некоторых видов пингвинов). </p><p>Пингвины дружно поздоровались и оказалось, что чайка говорит на языке очень похожем на пингвиний. \"Меньше отличий, чем между испанским и португальским!\" - подумал Федор, а Профессор подумал что-то про санскрит, но это была очень сложная мысль и ее здесь невозможно полностью сформулировать. В общем, они смогли поговорить с чайкой и задать ей все волнующие их вопросы. Оказалось, что чайку зовут Иннокентий, а работает он навигатором-разведчиком, это у чаек означает лететь впереди стаи и искать варианты нового места жительства. Стало понятно, что летают чайки с помощью крыльев, ветер иногда их все-таки сдувает, а образ жизни у них близок к кочевому.  Удалось понять,  чем  чайки  питаются  и  что  значит  быть  разведчиком. Вскоре  Иннокентий сказал, что у него дедлайн и он вынужден попрощаться и улететь. </p><p>Пингвины сразу поняли две вещи: первое, что это пока единственное реалистичное решение их нынешней проблемы, второе, что есть обоснованные сомнения в возможности применить решение к пингвинам. </p><p>\"Мы не такие, как чайки\"...  \"Они  летают\"... \"Они  используют другую технологию\"... \"У них другой метаболизм\"... \"Пингвины так не делали никогда, возможно, тому есть причины\"... Надежда и сомнения слились в головах пингвинов в адский коктейль.</p>"
  );
  assert.equal((infoI14 as any).advanceActionId, "opening.info.i14.advance");
  assert.equal((infoI14_2 as any).stepIndex, 25);
  assert.equal((infoI14_2 as any).screenId, "S1");
  assert.equal((infoI14_2 as any).title, "Открытие (продолжение)");
  assert.ok((infoI14_2 as any).body.includes("Но открытие случилось, оно изменило представление пингвинов о мире и потрясло их."));
  assert.ok((infoI14_2 as any).body.includes("Мы все живем в наших собственных легендах"));
  assert.ok((infoI14_2 as any).body.includes("Ну, за работу!"));
  assert.equal((infoI14_2 as any).advanceActionId, "opening.info.i14_2.advance");
  assert.equal((infoI15 as any).stepIndex, 27);
  assert.equal((infoI15 as any).screenId, "S1");
  assert.equal((infoI15 as any).title, "Для тех, кто не в курсе…");
  assert.equal(
    (infoI15 as any).body,
    "<p>Пожалуй, решение подоспело вовремя. Кажется, что по айсбергу пошла небольшая трещина. Хотя, это может быть, просто игра света из-за низкого, уже почти зимнего, солнца…</p><p>После того, как решение было найдено появился определенный оптимизм. Массовый оптимизм. Однако уже на собрании стало ясно, что некоторые пингвины не вполне поняли, что их ждет, некоторые отнеслись скептически. Естественно, была небольшая часть пингвинов, посчитавших происходящие абсурдом и противной самой сути пингвинов ересью.</p><p>Теперь, после собрания, когда одни задачи вроде бы уже решены, добавились новые. На месте одной решенной - по три новых. \"Какая-то гидра многозадачная...\" - растерянно пробормотала Алена, но тут же взяла себя в руки и предложила \"окутать всех пингвинов нежной, но плотной шкурой пропаганды\". Она объяснила, что пингвинам не стоит здесь оставлять возможность для лишних сомнений, тем более, что кто-то что-то не понял, а кого-то, возможно и не было на собрании. </p><p>Может быть, так и надо сделать? Может быть, надо, но совсем чуть-чуть? Или она перегибает льдину?..</p>"
  );
  assert.equal((infoI15 as any).advanceActionId, "opening.info.i15.advance");
  assert.equal((infoI16 as any).stepIndex, 29);
  assert.equal((infoI16 as any).screenId, "S1");
  assert.equal((infoI16 as any).title, "Предвкушение приключений. С привкусом страха и боли.");
  assert.equal(
    (infoI16 as any).body,
    "<p>Общее собрание, обсуждение того, что \"пингвины не равно айсберг, айсберг не равно пингвины\", рассказ о чайке, романтика приключений, представленная в массовых коммуникациях и все прочие действия - шаг за шагом, мысль за мыслью - эти идеи укоренились в сознании пингвинов. Несколько десятков наиболее активных (и отважных!) начали работать вместе с командой изменений, в небольших группах они стали прорабатывать основные разделы плана: подбор разведчиков, поиск и оценку новых айсбергов, логистику перемещения всей колонии. Профессор подсчитал, что переезд всех пингвинов займет примерно неделю (более далекие айсберги выбирать бессмысленно, потому что тогда невозможно будет перевезти всех пингвинов).</p><p>Несколько пингвинов вызвались быть разведчиками и отправиться реализовывать часть плана, связанную с поиском и оценкой новых айсбергов. Это было хорошо. Плохо было то, что это были, в основном, молодые пингвины, недостаточно опытные, ищущие больше адреналин, чем новый дом для колонии.</p><p>С разведчиками был связан еще один сложный момент, решения которого пока не было. Пингвины к зиме накапливают значительный объем жира, который позволяет им выдерживать морозы и возможный недостаток пищи. Разведчики, выполняя свою работу, неизбежно потеряют почти весь свой зимний жир, и для выживания зимой им потребуется набрать жир заново и при этом ускоренным темпом, для чего нужна обильная пищи. Проблема в том, что тысячелетняя традиция пингвинов предписывает делиться пищей только с детьми, но никак не с другими взрослыми пингвинами, а вернувшиеся из экспедиции разведчики не смогут сами обеспечить себя необходимым объемом пищи.</p><p>Были и другие сложности. Григорий и его сторонники явно активизировались, теперь они проповедовали отказ от переезда. Они предвещали штормы, ужасные подводные течения, безжалостных чудовищ, которые должны покарать пингвинов, предавших свой айсберг, предназначенный им судьбой... Большинство к ним не особо прислушивались, но некоторых пингвинов это пугало. И это влияние понемногу росло.</p><p>Кроме того, некоторым молодым пингвинам стали сниться ночные кошмары. Возможно, одной из причин этого были рассказы напуганной воспитательницы детского сада или школьного учителя, может быть, тревога поселилась в некоторых семьях пингвинов. В любом случае, детские страхи очень тревожили взрослых, в том числе активистов перемен и самих будущих разведчиков.</p>"
  );
  assert.equal((infoI16 as any).advanceActionId, "opening.info.i16.advance");
  assert.equal((teamSelection as any).id, "opening.team.selection");
  assert.equal((teamSelection as any).screenId, "S2");
  assert.equal((teamSelection as any).requiredPickCount, 5);
  assert.equal((teamSelection as any).confirmActionId, "opening.team.confirm");
  assert.equal((teamSelection as any).members.length, 10);
  assert.equal((teamSelection as any).members[0].memberId, "fedya");
  assert.equal((teamSelection as any).members[0].name, "Федор");
  assert.equal((teamSelection as any).members[0].selectActionId, "opening.team.select.fedya");
  const board = (antarcticaContent.boards as Array<{ id: string }>).find((entry: any) => entry.id === "opening.board.1_6");
  const secondBoard = (antarcticaContent.boards as Array<{ id: string }>).find((entry: any) => entry.id === "opening.board.7_12");
  const thirdBoard = (antarcticaContent.boards as Array<{ id: string }>).find((entry: any) => entry.id === "opening.board.13_18");
  const fourthBoard = (antarcticaContent.boards as Array<{ id: string }>).find((entry: any) => entry.id === "opening.board.19_24");
  const fifthBoard = (antarcticaContent.boards as Array<{ id: string }>).find((entry: any) => entry.id === "opening.board.25_30");
  const sixthBoard = (antarcticaContent.boards as Array<{ id: string }>).find((entry: any) => entry.id === "opening.board.31_36");
  const seventhBoard = (antarcticaContent.boards as Array<{ id: string }>).find((entry: any) => entry.id === "opening.board.37_42");
  const eighthBoard = (antarcticaContent.boards as Array<{ id: string }>).find((entry: any) => entry.id === "opening.board.43_48");
  const ninthBoard = (antarcticaContent.boards as Array<{ id: string }>).find((entry: any) => entry.id === "opening.board.49_54");
  assert.ok(board);
  assert.ok(secondBoard);
  assert.ok(thirdBoard);
  assert.ok(fourthBoard);
  assert.ok(fifthBoard);
  assert.ok(sixthBoard);
  assert.ok(seventhBoard);
  assert.ok(eighthBoard);
  assert.ok(ninthBoard);
  assert.equal((board as any).stepIndex, 9);
  assert.deepEqual((board as any).cardIds, ["1", "2", "3", "4", "5", "6"]);
  assert.equal((secondBoard as any).stepIndex, 11);
  assert.equal((secondBoard as any).screenId, "S2");
  assert.deepEqual((secondBoard as any).cardIds, ["7", "8", "9", "10", "11", "12"]);
  assert.equal((thirdBoard as any).stepIndex, 13);
  assert.equal((thirdBoard as any).screenId, "S2");
  assert.deepEqual((thirdBoard as any).cardIds, ["13", "14", "15", "16", "17", "18"]);
  assert.equal((fourthBoard as any).stepIndex, 17);
  assert.equal((fourthBoard as any).screenId, "S2");
  assert.equal((fourthBoard as any).title, "Выберите четвертый шаг");
  assert.deepEqual((fourthBoard as any).cardIds, ["19", "20", "21", "22", "23", "24"]);
  assert.equal((fifthBoard as any).stepIndex, 19);
  assert.equal((fifthBoard as any).screenId, "S2");
  assert.equal((fifthBoard as any).title, "Выберите пятый шаг");
  assert.deepEqual((fifthBoard as any).cardIds, ["25", "26", "27", "28", "29", "30"]);
  assert.equal((sixthBoard as any).stepIndex, 21);
  assert.equal((sixthBoard as any).screenId, "S2");
  assert.equal((sixthBoard as any).title, "Выберите шестой шаг");
  assert.deepEqual((sixthBoard as any).cardIds, ["31", "32", "33", "34", "35", "36"]);
  assert.equal((seventhBoard as any).stepIndex, 23);
  assert.equal((seventhBoard as any).screenId, "S2");
  assert.equal((seventhBoard as any).title, "Выберите седьмой шаг");
  assert.deepEqual((seventhBoard as any).cardIds, ["37", "38", "39", "3902", "40", "41", "42"]);
  assert.equal((eighthBoard as any).stepIndex, 26);
  assert.equal((eighthBoard as any).screenId, "S2");
  assert.equal((eighthBoard as any).title, "Выберите восьмой шаг");
  assert.deepEqual((eighthBoard as any).cardIds, ["43", "44", "45", "46", "47", "48"]);
  assert.equal((ninthBoard as any).stepIndex, 28);
  assert.equal((ninthBoard as any).screenId, "S2");
  assert.equal((ninthBoard as any).title, "Выберите девятый шаг");
  assert.deepEqual((ninthBoard as any).cardIds, ["49", "50", "51", "52", "53", "54"]);
  const card25 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "25");
  const card26 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "26");
  const card27 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "27");
  const card28 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "28");
  const card29 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "29");
  const card30 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "30");
  const card7 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "7");
  const card9 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "9");
  const card12 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "12");
  const card13 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "13");
  const card18 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "18");
  const card19 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "19");
  const card22 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "22");
  const card23 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "23");
  const card24 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "24");
  const card31 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "31");
  const card32 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "32");
  const card33 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "33");
  const card34 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "34");
  const card35 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "35");
  const card36 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "36");
  const card37 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "37");
  const card38 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "38");
  const card39 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "39");
  const card3902 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "3902");
  const card40 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "40");
  const card41 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "41");
  const card42 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "42");
  const card43 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "43");
  const card44 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "44");
  const card45 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "45");
  const card46 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "46");
  const card47 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "47");
  const card48 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "48");
  const card49 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "49");
  const card50 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "50");
  const card51 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "51");
  const card52 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "52");
  const card53 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "53");
  const card54 = (body.content as any).data.cards.find((entry: any) => entry.cardId === "54");
  assert.ok(card7);
  assert.ok(card9);
  assert.ok(card12);
  assert.ok(card13);
  assert.ok(card18);
  assert.ok(card25);
  assert.ok(card26);
  assert.ok(card27);
  assert.ok(card28);
  assert.ok(card29);
  assert.ok(card30);
  assert.ok(card19);
  assert.ok(card22);
  assert.ok(card23);
  assert.ok(card24);
  assert.ok(card31);
  assert.ok(card32);
  assert.ok(card33);
  assert.ok(card34);
  assert.ok(card35);
  assert.ok(card36);
  assert.ok(card37);
  assert.ok(card38);
  assert.ok(card39);
  assert.ok(card3902);
  assert.ok(card40);
  assert.ok(card41);
  assert.ok(card42);
  assert.ok(card43);
  assert.ok(card44);
  assert.ok(card45);
  assert.ok(card46);
  assert.ok(card47);
  assert.ok(card48);
  assert.ok(card49);
  assert.ok(card50);
  assert.ok(card51);
  assert.ok(card52);
  assert.ok(card53);
  assert.ok(card54);
  assert.equal(
    card7.summary,
    "Алена хочет выступить сама на Совете. Участники Совета доверяют ей. То, что она уже участник Совета, поможет сэкономить время на организации такого выступления."
  );
  assert.equal(
    card9.summary,
    "Для презентации на Совете Федор смастерил модель айсберга в масштабе 1:5000. Было долго, ведь у пингвинов нет рук. Зато очень наглядно: здесь – полость с водой, здесь – треснет…"
  );
  assert.equal(card9.advanceActionId, "opening.card.9.advance");
  assert.equal(
    card12.summary,
    "Федор достал из сумки свой дневник наблюдений и подготовил симпатичную презентацию на основе своих данных. Таблицы и графики не могут не быть убедительными!"
  );
  assert.equal(
    card13.summary,
    "Сразу выдать всю информацию на собрании для всех? Это опасно и не дальновидно. Тимофей предлагает определить уровни доступа и спустить порциями сверху вниз."
  );
  assert.equal(card18.advanceActionId, "opening.card.18.advance");
  assert.equal(
    card19.summary,
    "Глава штаба дает всем участникам задание провести разъяснительную работу среди населения. Для эффективности каждый собирает группу пингвинов для обсуждения."
  );
  assert.equal(card22.advanceActionId, "opening.card.22.advance");
  assert.equal(card23.advanceActionId, "opening.card.23.advance");
  assert.equal(
    card24.summary,
    "Предводитель команды назначает график дежурства, по которому все участники по очереди становятся во главе команды, ставят цели и распределяют задачи."
  );
  assert.equal(card25.selectActionId, "opening.card.25");
  assert.equal(
    card25.summary,
    "Профессор изучает статистику климатических изменений и проводит мета-анализ всех доступных работ, связанных с жизненным циклом айсбергов."
  );
  assert.equal(
    card26.summary,
    "Команда организует работы со всеми пингвинами по сбору идей: как убедиться, что угроза реальна, как можно было бы решить проблему, если она реальна?"
  );
  assert.equal(
    card27.summary,
    "Организуется работа команды с теми пингвинами, которые в прошлом зарекомендовали себя отличными решателями проблем. Все обсуждения тщательно фиксируются."
  );
  assert.equal(
    card28.summary,
    "Команда прорабатывает возможные варианты укрепления айсберга с помощью системы стяжек, также изучается возможность сделать стоки для воды в полостях айсберга."
  );
  assert.equal(
    card29.summary,
    "Формируются группы для проведения консультаций с соседними колониями пингвинов для выявления лучших практик борьбы с расколом айсбергов."
  );
  assert.equal(card30.selectActionId, "opening.card.30");
  assert.equal(
    card30.summary,
    "Штаб решает погрузиться в серию специально организованных мозговых штурмов. Задача: получить как можно больше вариантов действий для спасения айсберга."
  );
  assert.equal(
    card31.title,
    "Создать комитет по борьбе с лже-наукой. Провести детальную разъяснительную работу со всеми пингвинами, чтобы было понятно, в чем проблема. Над чем идет работа."
  );
  // TSK-20260719 W2-D: LGC-013 fix - `summary` is now a short paraphrase of the
  // FRONT side (was a verbatim duplicate of `backText`, a spoiler risk).
  assert.equal(card31.summary, "Комитет разъясняет пингвинам суть проблемы напрямую.");
  assert.equal(card31.selectActionId, "opening.card.31");
  assert.equal(card31.advanceActionId, "opening.card.31.advance");
  assert.equal(
    card32.title,
    "Сделать мотивирующие листовки Айсберг не спасет себя сам! Узнай, что ты можешь сделать? В них объяснить ситуацию, что делается для решения, в чем нужна помощь."
  );
  // TSK-20260719 W2-D: LGC-013 fix - see the note above card31.summary.
  assert.equal(card32.summary, "Листовки объясняют ситуацию и просят о помощи.");
  assert.equal(card32.selectActionId, "opening.card.32");
  assert.equal(card32.advanceActionId, "opening.card.32.advance");
  assert.equal(
    card33.title,
    "Выявить наиболее тревожных пингвинов и провести работу с ними: успокоить, привлечь их к разъяснительной работе, поддержке других тревожных пингвинов."
  );
  // TSK-20260719 W2-D: LGC-013 fix - see the note above card31.summary.
  assert.equal(card33.summary, "Тревожных пингвинов успокаивают и вовлекают в разъяснительную работу.");
  assert.equal(card33.selectActionId, "opening.card.33");
  assert.equal(card33.advanceActionId, "opening.card.33.advance");
  assert.equal(
    card34.title,
    "Разработать и внедрить разумную систему наказаний для тех, кто сеет панику: штрафы за дезинформацию и вбросы, за публичные призывы - изоляция в ледяной пещере."
  );
  // TSK-20260719 W2-D: LGC-013 fix - see the note above card31.summary.
  assert.equal(card34.summary, "За распространение паники вводят наказания.");
  assert.equal(card34.selectActionId, "opening.card.34");
  assert.ok(card34.advanceActionId === undefined);
  assert.equal(
    card35.title,
    "Провести серию выступлений для небольших групп пингвинов, пользуясь более неформальной обстановкой объяснить все простыми словами и успокоить."
  );
  // TSK-20260719 W2-D: LGC-013 fix - see the note above card31.summary.
  assert.equal(card35.summary, "Небольшим группам простыми словами объясняют ситуацию.");
  assert.equal(card35.selectActionId, "opening.card.35");
  assert.equal(card35.advanceActionId, "opening.card.35.advance");
  assert.equal(
    card36.title,
    "Провести разъяснения с каждым пингвином персонально. Для этого подготовить специальную расширенную команду и действовать по строгому расписанию."
  );
  // TSK-20260719 W2-D: LGC-013 fix - see the note above card31.summary.
  assert.equal(card36.summary, "Каждому пингвину дают личные разъяснения по расписанию.");
  assert.equal(card36.selectActionId, "opening.card.36");
  assert.equal(card36.advanceActionId, "opening.card.36.advance");
  assert.equal(
    card37.title,
    "Было столько идей, что может быть, некоторые были пропущены? Нужно проверить записи, сделать каталог идей по рубрикам, возможно, ответ уже найден. За дело!"
  );
  // TSK-20260719 W2-D: LGC-013 fix - see the note above card31.summary.
  assert.equal(card37.summary, "Все прежние идеи сводят в единый каталог.");
  assert.equal(
    card38.title,
    "Можно сделать еще одно общее собрание, но теперь уже с подготовкой – все должны принести не менее трех идей, как решить проблему. Нужно второе дыхание!"
  );
  // TSK-20260719 W2-D: LGC-013 fix - see the note above card31.summary.
  assert.equal(card38.summary, "Собрание проводят с заранее подготовленными идеями участников.");
  assert.equal(
    card39.title,
    "Лидер предлагает оставить пока поиск решения, отдохнуть. Лучше просто понаблюдать за жизнью колонии, за природой, подышать свежим воздухом."
  );
  assert.equal(card39.advanceActionId, "opening.card.39.advance");
  assert.equal(card3902.selectActionId, "opening.card.3902");
  assert.equal(card3902.advanceActionId, "opening.card.3902.advance");
  assert.equal(
    card40.title,
    "Решения не видно и пингвины волнуются. Нужно провести встречи в группах (родственных и по месту работы). Объяснить, что поиск решения идет медленно, но все под контролем."
  );
  assert.equal(
    card41.title,
    "Выбрать случайным образом несколько групп пингвинов и провести с ними разъяснительную работу. Оценить вероятность паники, донести, что проблему решают."
  );
  assert.equal(
    card42.title,
    "Все яснее, что айсберг не спасти. Может быть, вопрос в том, как спасти пингвинов? Нужно разработать спасательные льдины и план экстренной эвакуации."
  );
  assert.equal(
    card43.title,
    "Леонид собирает общее собрание и выступает с призывом сплотиться и преодолеть многовековую оседлость пингвинов, стать отважными переселенцами. Как истинный лидер - он убедителен."
  );
  assert.equal(card43.selectActionId, "opening.card.43");
  assert.equal(card43.advanceActionId, "opening.card.43.advance");
  // TSK-20260719 W2-D: LGC-013 fix - see the note above card31.summary.
  assert.equal(card43.summary, "Леонид призывает пингвинов сплотиться и стать переселенцами.");
  assert.equal(
    card44.title,
    "Леонид собирает общее собрание и выступает с презентацией на основе слайдов Профессора, подробно рассказывает о логике принимаемого решения, о плане реализации."
  );
  assert.equal(card44.selectActionId, "opening.card.44");
  assert.equal(card44.advanceActionId, undefined);
  assert.equal(
    card45.title,
    "Леонид собирает общее собрание, дает слово Евгению и Алене, которые в ярких красках рассказывают о встрече с чайкой и о прекрасном будущем. В резюме Леонид верит в подвиг пингвинов."
  );
  assert.equal(card45.selectActionId, "opening.card.45");
  assert.equal(card45.advanceActionId, "opening.card.45.advance");
  assert.equal(
    card46.title,
    "Совет собирает общее собрание, на котором выступает Профессор. Он подробно рассказывает о логике принимаемого решения, о плане реализации. "
  );
  assert.equal(card46.selectActionId, "opening.card.46");
  assert.equal(card46.advanceActionId, undefined);
  assert.equal(
    card47.title,
    "Совет принимает решение донести информацию через серию собраний. Все члены Совета и Команды изменений соберут по несколько малых групп и расскажут про чайку и возможность смены айсберга."
  );
  assert.equal(card47.selectActionId, "opening.card.47");
  assert.equal(card47.advanceActionId, "opening.card.47.advance");
  assert.equal(
    card48.title,
    "Совет решает распространить решение через персональные письма. В письмах сочетаются сухие факты и эмоциональные призывы к действию, надежда на подвиг пингвинов, а также история чайки-разведчика."
  );
  assert.equal(card48.selectActionId, "opening.card.48");
  assert.equal(card48.advanceActionId, "opening.card.48.advance");
  assert.equal(
    card49.title,
    "Провести работу с лидерами мнений (у Профессора есть как раз свежий социальный граф колонии). Преодолеть сомнения и направить пропаганду через этих лидеров…"
  );
  // TSK-20260719 W2-D: LGC-013 fix - see the note above card31.summary.
  assert.equal(card49.summary, "Информацию распространяют через лидеров мнений колонии.");
  assert.equal(card49.selectActionId, "opening.card.49");
  assert.equal(card49.advanceActionId, "opening.card.49.advance");
  assert.equal(
    card50.title,
    "Провести совещания о будущих переменах по месту работы пингвинов с участием команды перемен и представителей Совета. Предложить задавать самые острые вопросы."
  );
  // TSK-20260719 W2-D: LGC-013 fix - see the note above card31.summary.
  assert.equal(card50.summary, "На рабочих местах пингвины открыто обсуждают перемены с командой.");
  assert.equal(card50.selectActionId, "opening.card.50");
  assert.equal(card50.advanceActionId, "opening.card.50.advance");
  assert.equal(
    card51.title,
    "Организовать семейные ужины - вечерние встречи с семьями пингвинов, узнать об их страхах и сомнениях, заразить их уверенностью и оптимизмом. Рассказать о новых возможностях."
  );
  // TSK-20260719 W2-D: LGC-013 fix - see the note above card31.summary.
  assert.equal(card51.summary, "На семейных ужинах развеивают страхи и вселяют уверенность.");
  assert.equal(card51.selectActionId, "opening.card.51");
  assert.equal(card51.advanceActionId, "opening.card.51.advance");
  assert.equal(
    card52.title,
    "Организовать семинары в детских садах и школах о том, как прекрасны путешествия. Провести конкурсы на лучшие рассказы и рисунки о приключениях странствующих пингвинов."
  );
  // TSK-20260719 W2-D: LGC-013 fix - see the note above card31.summary.
  assert.equal(card52.summary, "Детей вовлекают конкурсами рассказов и рисунков о путешествиях.");
  assert.equal(card52.selectActionId, "opening.card.52");
  assert.equal(card52.advanceActionId, "opening.card.52.advance");
  assert.equal(
    card53.title,
    "Сделать видео-ролик для Айсберг-ТВ и показывать его так часто, как возможно. В ролике рассказать про будущий новый айсберг и показать элементы подготовки к переезду."
  );
  // TSK-20260719 W2-D: LGC-013 fix - see the note above card31.summary.
  assert.equal(card53.summary, "Видеоролик на Айсберг-ТВ рассказывает о будущем новом айсберге.");
  assert.equal(card53.selectActionId, "opening.card.53");
  assert.equal(card53.advanceActionId, "opening.card.53.advance");
  assert.equal(
    // LGC-011 (TSK-20260719-antarctica-alignment, block 2.5a): восстановлено эталонное
    // концевое многоточие "!.." (было "!…" - типографская правка, утраченная при миграции).
    card54.title,
    "Заполнить айсберг жизнеутверждающими постерами о несгибаемости пингвинов, их юморе и любви к приключениям, новом лучшем айсберге. Размещать их также под водой!.."
  );
  // TSK-20260719 W2-D: LGC-013 fix - see the note above card31.summary.
  assert.equal(card54.summary, "Айсберг украшают жизнеутверждающими постерами, даже под водой.");
  assert.equal(card54.selectActionId, "opening.card.54");
  assert.equal(card54.advanceActionId, "opening.card.54.advance");
  const card3 = (antarcticaContent.cards as Array<{ cardId: string }>).find((entry: any) => entry.cardId === "3");
  assert.ok(card3);
  assert.equal((card3 as any).selectActionId, "opening.card.3");
  assert.equal((card3 as any).advanceActionId, "opening.card.3.advance");
});

interface UiComponent {
  type: string;
  id?: string;
  props: Record<string, unknown>;
  children?: UiComponent[];
  title?: string;
  layoutId?: string;
  root?: UiComponent;
}

test("GET /games/antarctica/player-content returns antarcticaUi with S1 screen definition", async () => {
  const { response, body } = await requestJson<Record<string, unknown>>("/games/antarctica/player-content");

  assert.equal(response.status, 200);

  // ui must be present for Antarctica
  assert.ok(body.ui, "ui must be present in player-content for antarctica");
  const ui = body.ui as Record<string, unknown>;

  // Verify UI manifest metadata
  assert.equal(ui.id, "antarctica.ui.web");
  assert.equal(ui.version, "1.1.0");
  assert.equal(ui.gameId, "antarctica");
  assert.equal(ui.entryPoint, "S1");

  // Verify S1 screen definition structure (multi-screen interface: screens["S1"])
  const screens = ui.screens as Record<string, UiComponent>;
  const s1Screen = screens["S1"];
  assert.ok(s1Screen, "S1 screen must exist in screens map");
  assert.equal(s1Screen.type, "screen");
  assert.equal(s1Screen.title, "Antarctica");
  assert.equal(s1Screen.layoutId, "layout.web.s1");

  // Verify screen root (screenComponent)
  assert.equal((s1Screen as any).root.type, "screenComponent");
  assert.ok((s1Screen as any).root.props);
  assert.match(String((s1Screen as any).root.props.cssClass), /\bmain-screen\b/);
  // TSK-20260719 R4b: migrated to the game asset channel (ADR-063).
  assert.equal((s1Screen as any).root.props.backgroundImage, "asset:arctic-background");

  // Verify children exist (areas)
  assert.ok(Array.isArray((s1Screen as any).root.children));
  assert.ok((s1Screen as any).root.children!.length >= 2, "S1 should have at least 2 area children");

  // Find the game-variables-container area
  const variablesArea = (s1Screen as any).root.children!.find(
    (child: any) => child.type === "areaComponent" && String(child.props.cssClass).includes("game-variables-container")
  );
  assert.ok(variablesArea, "game-variables-container area must be present");
  assert.ok(Array.isArray(variablesArea.children));

  // Verify all 8 metric gameVariableComponents are present
  const metricIds = ["remainingDays", "pro", "rep", "lid", "man", "stat", "cont", "constr"];
  const gameVariableComponents = variablesArea.children!.filter(
    (child: any) => child.type === "gameVariableComponent"
  );
  assert.equal(gameVariableComponents.length, 8, "S1 sidebar should have exactly 8 gameVariableComponents");

  // Verify each metric component has the expected structure and binding expression
  for (const metricId of metricIds) {
    const component = gameVariableComponents.find((c: any) => c.id === metricId);
    assert.ok(component, `gameVariableComponent for metric "${metricId}" must be present`);
    assert.equal(component.type, "gameVariableComponent");
    assert.equal(component.props.metricId, metricId);
    assert.equal(component.props.caption, undefined);
    assert.equal(component.props.value, undefined);
  }

  // Find the main-content-area
  const mainArea = (s1Screen as any).root.children!.find(
    (child: any) => child.type === "areaComponent" && String(child.props.cssClass).includes("main-content-area")
  );
  assert.ok(mainArea, "main-content-area area must be present");
  assert.ok(Array.isArray(mainArea.children));

  // Find the cards-container area inside main-content-area
  const cardsArea = mainArea.children!.find(
    (child: any) => child.type === "areaComponent" && String(child.props.cssClass).includes("cards-container")
  );
  assert.ok(cardsArea, "cards-container area must be present inside main-content-area");
  assert.ok(Array.isArray(cardsArea.children));

  // Find the bottom-controls-container area inside main-content-area
  const bottomControlsArea = mainArea.children!.find(
    (child: any) => child.type === "areaComponent" && String(child.props.cssClass).includes("bottom-controls-container")
  );
  assert.ok(bottomControlsArea, "bottom-controls-container area must be present inside main-content-area");
  assert.ok(Array.isArray(bottomControlsArea.children));

  // Verify button components exist for hint and journal
  const buttonComponents = bottomControlsArea.children!.filter((child: any) => child.type === "buttonComponent");
  assert.ok(buttonComponents.length >= 2, "bottom-controls-container should have at least 2 button components");

  const hintButton = buttonComponents.find((b: any) => b.id === "btn-hint");
  assert.ok(hintButton, "btn-hint button must be present");
  // Lowercase captions follow the visual reference (TSK-20260719, UI-003).
  assert.equal(hintButton.props.caption, "подсказка");

  const journalButton = buttonComponents.find((b: any) => b.id === "btn-journal");
  assert.ok(journalButton, "btn-journal button must be present");
  assert.equal(journalButton.props.caption, "журнал ходов");

  // Verify design artifacts registry is present
  const designArtifacts = ui.designArtifacts as Record<string, unknown>;
  assert.ok(designArtifacts, "designArtifacts should be present");
  assert.ok(designArtifacts["left-sidebar-6-cards"], "left-sidebar-6-cards design artifact should be referenced");
});

test("GET /games/antarctica/player-content preserves asset references in antarcticaUi", async () => {
  const { response, body } = await requestJson<Record<string, unknown>>("/games/antarctica/player-content");

  assert.equal(response.status, 200);
  assert.ok(body.ui);

  // Multi-screen interface: screens["S1"].root
  const s1Screen = (body.ui as any)!.screens["S1"];
  assert.ok(s1Screen, "S1 screen must exist");
  const root = (s1Screen as any).root;
  const rootProps = root.props as { backgroundImage?: string };
  // TSK-20260719 R4b: migrated to the game asset channel (ADR-063).
  assert.equal(rootProps.backgroundImage, "asset:arctic-background");

  // Verify metric background images are preserved (not resolved, just data strings)
  const variablesArea = (root.children as Array<Record<string, unknown>>)?.find(
    (child: any) =>
      child.type === "areaComponent" &&
      String((child.props as Record<string, unknown>)?.cssClass).includes("game-variables-container")
  );
  assert.ok(variablesArea);

  const remainingDaysComponent = ((variablesArea.children as Array<Record<string, unknown>>) as Array<{
    type?: string;
    id?: string;
    props: Record<string, unknown>;
  }>)?.find(
    (child: any) => child.type === "gameVariableComponent" && child.id === "remainingDays"
  );
  assert.ok(remainingDaysComponent);
  const remainingDaysProps = remainingDaysComponent.props as { backgroundImage?: string };
  assert.ok(
    typeof remainingDaysProps.backgroundImage === "string" && remainingDaysProps.backgroundImage.length > 0,
    "remainingDays backgroundImage should be a non-empty string asset reference"
  );
});

test("GET /games/:gameId/player-content keeps non-Antarctica games on the generic UI contract", async () => {
  const { response, body } = await requestJson<
    PlayerFacingContent & { antarcticaUi?: unknown }
  >("/games/simple-choice/player-content");

  assert.equal(response.status, 200);
  assert.equal(body.gameId, "simple-choice");
  // Every game exposes presentation through the same `ui` field; a legacy
  // game-named field would leak Antarctica-specific knowledge into the platform DTO.
  assert.equal(body.ui?.entryPoint, "intro");
  assert.ok(body.ui?.screens.intro, "simple-choice intro screen must be present in generic UI data");
  assert.equal(Object.hasOwn(body, "antarcticaUi"), false);
});

test("GET /games/:gameId/player-content returns 404 for non-existent game", async () => {
  const { response, body } = await requestJson<{ error: string }>("/games/non-existent-game/player-content");

  assert.equal(response.status, 404);
  assert.equal(body.error, "Game \"non-existent-game\" was not found");
});

test("POST /sessions returns 404 for non-existent game", async () => {
  const { response, body } = await requestJson<{ error: string }>("/sessions", {
    method: "POST",
    body: JSON.stringify({
      gameId: "non-existent-game"
    })
  });

  assert.equal(response.status, 404);
  assert.equal(body.error, "Game \"non-existent-game\" was not found");
});
