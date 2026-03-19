import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createRuntimeApiServer } from "../src/modules/player-api/httpServer.ts";

type SessionVersion = {
  sessionId: string;
  stateVersion: number;
  lastEventSequence: number;
};

type PublicState = {
  timeline: {
    stage_id: string;
  };
  log: Array<Record<string, unknown>>;
};

type RuntimeState = {
  lastActionId?: string;
  lastActionFunction?: string;
};

type SessionState = {
  public: PublicState;
  runtime?: RuntimeState;
};

type SessionResponse = {
  sessionId: string;
  gameId: string;
  version: SessionVersion;
  state: SessionState;
};

type ActionResponse = {
  sessionId: string;
  version: SessionVersion;
  state: SessionState;
};

const runtimeApi = createRuntimeApiServer({ port: 0 });
let baseUrl = "";

const readJson = async <T>(response: Response): Promise<T> => {
  const text = await response.text();

  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
};

const requestJson = async <T>(path: string, init: RequestInit = {}): Promise<{ response: Response; body: T }> => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });

  return {
    response,
    body: await readJson<T>(response)
  };
};

const createSession = async (body: Record<string, unknown> = {}) => {
  const { response, body: session } = await requestJson<SessionResponse>("/sessions", {
    method: "POST",
    body: JSON.stringify({
      gameId: "antarctica",
      playerId: "integration-test",
      ...body
    })
  });

  assert.equal(response.status, 201);
  assert.equal(session.gameId, "antarctica");
  assert.equal(typeof session.sessionId, "string");

  return session;
};

before(async () => {
  await runtimeApi.start();
  baseUrl = `http://127.0.0.1:${runtimeApi.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => runtimeApi.server.close(() => resolve()));
});

test("POST /sessions creates an antarctica session", async () => {
  const session = await createSession();

  assert.equal(session.version.stateVersion, 0);
  assert.equal(session.version.lastEventSequence, 0);
  assert.equal(session.state.public.timeline.stage_id, "stage_intro");
  assert.deepEqual(session.state.public.log, []);
});

test("GET /sessions/:id returns the created session snapshot", async () => {
  const created = await createSession({ playerId: "reader" });
  const { response, body: session } = await requestJson<SessionResponse>(`/sessions/${created.sessionId}`);

  assert.equal(response.status, 200);
  assert.equal(session.sessionId, created.sessionId);
  assert.equal(session.gameId, "antarctica");
  assert.equal(session.version.stateVersion, 0);
  assert.equal(session.state.public.timeline.stage_id, "stage_intro");
});

test("POST /actions applies a deterministic runtime transition", async () => {
  const created = await createSession({ playerId: "actor" });
  const { response, body: action } = await requestJson<ActionResponse>("/actions", {
    method: "POST",
    body: JSON.stringify({
      sessionId: created.sessionId,
      playerId: "actor",
      actionId: "showHint",
      payload: { source: "integration-test" }
    })
  });

  assert.equal(response.status, 200);
  assert.equal(action.sessionId, created.sessionId);
  assert.equal(action.version.stateVersion, 1);
  assert.equal(action.version.lastEventSequence, 1);
  assert.equal(action.state.runtime?.lastActionId, "showHint");
  assert.equal(action.state.runtime?.lastActionFunction, "showHint");

  const log = action.state.public.log;
  assert.equal(log.length, 1);
  assert.equal(log[0].actionId, "showHint");

  const { response: getResponse, body: persisted } = await requestJson<SessionResponse>(`/sessions/${created.sessionId}`);

  assert.equal(getResponse.status, 200);
  assert.equal(persisted.version.stateVersion, 1);
  assert.equal(persisted.state.runtime?.lastActionId, "showHint");
  assert.equal(persisted.state.public.log.length, 1);
});
