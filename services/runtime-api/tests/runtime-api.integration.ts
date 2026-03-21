import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createRuntimeApiServer } from "../src/modules/player-api/httpServer.ts";

type SessionVersion = {
  sessionId: string;
  stateVersion: number;
  lastEventSequence: number;
};

type PublicState = {
  metrics?: {
    score?: number;
    time?: number;
    [key: string]: unknown;
  };
  timeline: {
    stepIndex?: number;
    stageId?: string;
    screenId?: string;
    canAdvance?: boolean;
    stage_id: string;
    step_index?: number;
    screen_id?: string;
  };
  flags: {
    cards: Record<string, unknown>;
  };
  ui?: {
    lastCapabilityFamily?: string;
    lastCapability?: string;
    activePanel?: string;
    activeScreen?: string;
    serverRequested?: boolean;
  };
  log: Array<Record<string, unknown>>;
};

type SecretState = {
  stagePicks?: Record<string, unknown>;
  stage_picks?: Record<string, unknown>;
  opening?: {
    selectedCardId?: string;
  };
};

type RuntimeState = {
  lastActionId?: string;
  lastActionFunction?: string;
  lastCapabilityFamily?: string;
  lastCapability?: string;
};

type SessionState = {
  public: PublicState;
  secret?: SecretState;
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

const dispatchAction = async (
  sessionId: string,
  playerId: string,
  actionId: string,
  payload?: unknown
) =>
  requestJson<ActionResponse | { error: string }>("/actions", {
    method: "POST",
    body: JSON.stringify({
      sessionId,
      playerId,
      actionId,
      payload
    })
  });

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
  assert.equal(session.state.public.timeline.stageId, "stage_intro");
  assert.equal(session.state.public.timeline.stage_id, "stage_intro");
  assert.equal(session.state.public.timeline.stepIndex, 0);
  assert.equal(session.state.public.timeline.canAdvance, false);
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
  assert.match(body.error, /gameId must be a non-empty string/);
});

test("GET /sessions/:id returns the created session snapshot", async () => {
  const created = await createSession({ playerId: "reader" });
  const { response, body: session } = await requestJson<SessionResponse>(`/sessions/${created.sessionId}`);

  assert.equal(response.status, 200);
  assert.equal(session.sessionId, created.sessionId);
  assert.equal(session.gameId, "antarctica");
  assert.equal(session.version.stateVersion, 0);
  assert.equal(session.state.public.timeline.stageId, "stage_intro");
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
  assert.equal(action.state.runtime?.lastCapabilityFamily, "ui.panel");
  assert.equal(action.state.runtime?.lastCapability, "ui.panel.hint");
  assert.equal(action.state.public.ui?.lastCapabilityFamily, "ui.panel");
  assert.equal(action.state.public.ui?.activePanel, "hint");

  const log = action.state.public.log;
  assert.equal(log.length, 1);
  assert.equal(log[0].actionId, "showHint");
  assert.equal(log[0].capabilityFamily, "ui.panel");
  assert.equal(log[0].capability, "ui.panel.hint");

  const { response: getResponse, body: persisted } = await requestJson<SessionResponse>(`/sessions/${created.sessionId}`);

  assert.equal(getResponse.status, 200);
  assert.equal(persisted.version.stateVersion, 1);
  assert.equal(persisted.state.runtime?.lastActionId, "showHint");
  assert.equal(persisted.state.runtime?.lastCapabilityFamily, "ui.panel");
  assert.equal(persisted.state.public.log.length, 1);
});

test("POST /actions routes different Antarctica actions through manifest capability families", async () => {
  const created = await createSession({ playerId: "router" });
  const { response, body: action } = await requestJson<ActionResponse>("/actions", {
    method: "POST",
    body: JSON.stringify({
      sessionId: created.sessionId,
      playerId: "router",
      actionId: "showScreenWithLeftSideBar",
      payload: { source: "integration-test" }
    })
  });

  assert.equal(response.status, 200);
  assert.equal(action.state.runtime?.lastCapabilityFamily, "ui.screen");
  assert.equal(action.state.runtime?.lastCapability, "ui.screen.left-sidebar");
  assert.equal(action.state.public.ui?.activeScreen, "left-sidebar");
  assert.equal(action.state.public.ui?.lastCapabilityFamily, "ui.screen");
});

test("POST /actions applies deterministic intro advances to board step 9 and resolves opening.card.3", async () => {
  const created = await createSession({ playerId: "intro-flow" });
  const introActions = [
    "opening.info.i0.advance",
    "opening.info.i02.advance",
    "opening.info.i03.advance",
    "opening.info.i1.advance",
    "opening.info.i2.advance",
    "opening.info.i3.advance",
    "opening.info.i4.advance",
    "opening.info.i5.advance",
    "opening.info.i6.advance"
  ];

  let currentStepIndex = 0;
  for (const actionId of introActions) {
    const { response, body } = await dispatchAction(created.sessionId, "intro-flow", actionId);
    assert.equal(response.status, 200);
    const action = body as ActionResponse;
    currentStepIndex += 1;
    assert.equal(action.state.public.timeline.stepIndex, currentStepIndex);
    assert.equal(action.state.public.timeline.step_index, currentStepIndex);
    assert.equal(action.state.public.timeline.stageId, "stage_intro");
    assert.equal(action.state.public.timeline.stage_id, "stage_intro");
    assert.equal(action.state.public.timeline.screenId, currentStepIndex === 9 ? "S2" : "S1");
    assert.equal(action.state.public.timeline.screen_id, currentStepIndex === 9 ? "S2" : "S1");
    assert.equal(action.state.public.timeline.canAdvance, false);
  }

  const { response: cardResponse, body: cardBody } = await dispatchAction(
    created.sessionId,
    "intro-flow",
    "opening.card.3"
  );

  assert.equal(cardResponse.status, 200);
  const cardAction = cardBody as ActionResponse;
  const cardState = (cardAction.state.public.flags.cards["3"] ?? {}) as { selected?: boolean; resolved?: boolean };
  const lastLogEntry = cardAction.state.public.log[cardAction.state.public.log.length - 1] ?? {};

  assert.equal(cardAction.state.public.timeline.stepIndex, 9);
  assert.equal(cardAction.state.public.timeline.step_index, 9);
  assert.equal(cardAction.state.public.timeline.stageId, "stage_intro");
  assert.equal(cardAction.state.public.timeline.stage_id, "stage_intro");
  assert.equal(cardAction.state.public.timeline.screenId, "S2");
  assert.equal(cardAction.state.public.timeline.screen_id, "S2");
  assert.equal(cardAction.state.public.timeline.canAdvance, true);
  assert.equal(cardState.selected, true);
  assert.equal(cardState.resolved, true);
  assert.equal(cardAction.state.secret?.opening?.selectedCardId, "3");
  assert.equal(cardAction.state.public.metrics?.time, 1);
  assert.equal(cardAction.state.public.metrics?.score, 59);
  assert.equal(lastLogEntry.actionId, "opening.card.3");
  assert.equal(lastLogEntry.kind, "opening-card-resolution");
  assert.equal(lastLogEntry.cardId, "3");
});

test("POST /actions rejects replay of opening.card.3 with HTTP 400", async () => {
  const created = await createSession({ playerId: "card-replay" });
  const introActions = [
    "opening.info.i0.advance",
    "opening.info.i02.advance",
    "opening.info.i03.advance",
    "opening.info.i1.advance",
    "opening.info.i2.advance",
    "opening.info.i3.advance",
    "opening.info.i4.advance",
    "opening.info.i5.advance",
    "opening.info.i6.advance",
    "opening.card.3"
  ];

  for (const actionId of introActions) {
    const { response } = await dispatchAction(created.sessionId, "card-replay", actionId);
    assert.equal(response.status, 200);
  }

  const { response, body } = await dispatchAction(created.sessionId, "card-replay", "opening.card.3");
  assert.equal(response.status, 400);
  const errorBody = body as { error: string };
  assert.match(errorBody.error, /guard failed/);
});

test("POST /actions rejects opening.card.3 before intro reaches step 9 with HTTP 400", async () => {
  const created = await createSession({ playerId: "card-early" });
  const { response, body } = await dispatchAction(created.sessionId, "card-early", "opening.card.3");
  assert.equal(response.status, 400);
  const errorBody = body as { error: string };
  assert.match(errorBody.error, /public\.timeline\.stepIndex expected 9/);
});

test("POST /actions rejects invalid request bodies", async () => {
  const created = await createSession({ playerId: "validator" });
  const { response, body } = await requestJson<{ error: string }>("/actions", {
    method: "POST",
    body: JSON.stringify({
      sessionId: created.sessionId,
      actionId: 123
    })
  });

  assert.equal(response.status, 400);
  assert.match(body.error, /actionId is required and must be a non-empty string/);
});

test("GET /games/:gameId/player-content returns player-facing content DTO", async () => {
  const { response, body } = await requestJson<{
    gameId: string;
    version: string;
    name: string;
    description: string;
    locale: string;
    playerConfig: { min: number; max: number };
    training?: { format: string };
    actions: Array<{ actionId: string; displayName: string; capabilityFamily: string | null; capability: string | null }>;
    mockups: Array<{ id: string; name: string; description: string; type: string; imagePath: string }>;
  }>("/games/antarctica/player-content");

  assert.equal(response.status, 200);
  assert.equal(body.gameId, "antarctica");
  assert.equal(typeof body.version, "string");
  assert.equal(typeof body.name, "string");
  assert.equal(typeof body.description, "string");
  assert.equal(body.locale, "ru-RU");
  assert.deepEqual(body.playerConfig, { min: 1, max: 1 });
  assert.ok(Array.isArray(body.actions));
  assert.ok(body.actions.length > 0);
  const showHintAction = body.actions.find((a) => a.actionId === "showHint");
  assert.ok(showHintAction);
  assert.equal(showHintAction.displayName, "Show hint");
  assert.equal(showHintAction.capabilityFamily, "ui.panel");
  assert.equal(showHintAction.capability, "ui.panel.hint");
  assert.ok(Array.isArray(body.mockups));
  assert.ok(body.mockups.length > 0);
  const firstMockup = body.mockups[0];
  assert.equal(typeof firstMockup.id, "string");
  assert.equal(typeof firstMockup.name, "string");
  assert.equal(typeof firstMockup.description, "string");
  assert.equal(typeof firstMockup.type, "string");
  assert.equal(typeof firstMockup.imagePath, "string");
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
