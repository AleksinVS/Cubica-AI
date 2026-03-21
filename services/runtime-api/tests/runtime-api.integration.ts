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

test("POST /actions progresses from first board through i7 to second board after opening.card.3", async () => {
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

  const { response: boardAdvanceResponse, body: boardAdvanceBody } = await dispatchAction(
    created.sessionId,
    "intro-flow",
    "opening.card.3.advance"
  );
  assert.equal(boardAdvanceResponse.status, 200);
  const boardAdvanceAction = boardAdvanceBody as ActionResponse;
  const boardAdvanceLogEntry =
    boardAdvanceAction.state.public.log[boardAdvanceAction.state.public.log.length - 1] ?? {};

  assert.equal(boardAdvanceAction.state.public.timeline.stepIndex, 10);
  assert.equal(boardAdvanceAction.state.public.timeline.step_index, 10);
  assert.equal(boardAdvanceAction.state.public.timeline.stageId, "stage_intro");
  assert.equal(boardAdvanceAction.state.public.timeline.stage_id, "stage_intro");
  assert.equal(boardAdvanceAction.state.public.timeline.screenId, "S1");
  assert.equal(boardAdvanceAction.state.public.timeline.screen_id, "S1");
  assert.equal(boardAdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(boardAdvanceAction.state.secret?.opening?.selectedCardId, "3");
  assert.equal(boardAdvanceLogEntry.actionId, "opening.card.3.advance");
  assert.equal(boardAdvanceLogEntry.kind, "opening-card-advance");
  assert.equal(boardAdvanceLogEntry.cardId, "3");

  const { response: i7AdvanceResponse, body: i7AdvanceBody } = await dispatchAction(
    created.sessionId,
    "intro-flow",
    "opening.info.i7.advance"
  );
  assert.equal(i7AdvanceResponse.status, 200);
  const i7AdvanceAction = i7AdvanceBody as ActionResponse;
  const i7AdvanceLogEntry = i7AdvanceAction.state.public.log[i7AdvanceAction.state.public.log.length - 1] ?? {};

  assert.equal(i7AdvanceAction.state.public.timeline.stepIndex, 11);
  assert.equal(i7AdvanceAction.state.public.timeline.step_index, 11);
  assert.equal(i7AdvanceAction.state.public.timeline.stageId, "stage_intro");
  assert.equal(i7AdvanceAction.state.public.timeline.stage_id, "stage_intro");
  assert.equal(i7AdvanceAction.state.public.timeline.screenId, "S2");
  assert.equal(i7AdvanceAction.state.public.timeline.screen_id, "S2");
  assert.equal(i7AdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(i7AdvanceAction.state.secret?.opening?.selectedCardId, "3");
  assert.equal(i7AdvanceLogEntry.actionId, "opening.info.i7.advance");
  assert.equal(i7AdvanceLogEntry.kind, "opening-info-advance");

  const { response: replayAdvanceResponse, body: replayAdvanceBody } = await dispatchAction(
    created.sessionId,
    "intro-flow",
    "opening.card.3.advance"
  );
  assert.equal(replayAdvanceResponse.status, 400);
  const replayAdvanceErrorBody = replayAdvanceBody as { error: string };
  assert.match(replayAdvanceErrorBody.error, /guard failed/);
});

test("POST /actions allows non-go opening card before opening.card.3 and rejects non-go replay", async () => {
  const created = await createSession({ playerId: "multi-card-path" });
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

  for (const actionId of introActions) {
    const { response } = await dispatchAction(created.sessionId, "multi-card-path", actionId);
    assert.equal(response.status, 200);
  }

  const { response: card4Response, body: card4Body } = await dispatchAction(
    created.sessionId,
    "multi-card-path",
    "opening.card.4"
  );
  assert.equal(card4Response.status, 200);
  const card4Action = card4Body as ActionResponse;
  const card4State = (card4Action.state.public.flags.cards["4"] ?? {}) as { selected?: boolean; resolved?: boolean };
  const lastCard4LogEntry = card4Action.state.public.log[card4Action.state.public.log.length - 1] ?? {};

  assert.equal(card4Action.state.public.timeline.stepIndex, 9);
  assert.equal(card4Action.state.public.timeline.step_index, 9);
  assert.equal(card4Action.state.public.timeline.canAdvance, false);
  assert.equal(card4Action.state.secret?.opening?.selectedCardId, undefined);
  assert.equal(card4Action.state.public.metrics?.pro, 2);
  assert.equal(card4Action.state.public.metrics?.rep, 0);
  assert.equal(card4Action.state.public.metrics?.time, 3);
  assert.equal(card4Action.state.public.metrics?.score, 57);
  assert.equal(card4State.selected, true);
  assert.equal(card4State.resolved, true);
  assert.equal(lastCard4LogEntry.actionId, "opening.card.4");
  assert.equal(lastCard4LogEntry.kind, "opening-card-resolution");
  assert.equal(lastCard4LogEntry.cardId, "4");

  const { response: replayResponse, body: replayBody } = await dispatchAction(
    created.sessionId,
    "multi-card-path",
    "opening.card.4"
  );
  assert.equal(replayResponse.status, 400);
  const replayErrorBody = replayBody as { error: string };
  assert.match(replayErrorBody.error, /guard failed/);

  const { response: card3Response, body: card3Body } = await dispatchAction(
    created.sessionId,
    "multi-card-path",
    "opening.card.3"
  );
  assert.equal(card3Response.status, 200);
  const card3Action = card3Body as ActionResponse;
  const card3State = (card3Action.state.public.flags.cards["3"] ?? {}) as { selected?: boolean; resolved?: boolean };

  assert.equal(card3Action.state.public.timeline.stepIndex, 9);
  assert.equal(card3Action.state.public.timeline.step_index, 9);
  assert.equal(card3Action.state.public.timeline.canAdvance, true);
  assert.equal(card3Action.state.secret?.opening?.selectedCardId, "3");
  assert.equal(card3Action.state.public.metrics?.pro, 3);
  assert.equal(card3Action.state.public.metrics?.rep, 2);
  assert.equal(card3Action.state.public.metrics?.lid, 1);
  assert.equal(card3Action.state.public.metrics?.stat, 1);
  assert.equal(card3Action.state.public.metrics?.time, 4);
  assert.equal(card3Action.state.public.metrics?.score, 56);
  assert.equal(card3State.selected, true);
  assert.equal(card3State.resolved, true);
});

test("POST /actions allows second-board non-go opening.card.12 before go opening.card.9 and rejects replay", async () => {
  const created = await createSession({ playerId: "second-board-path" });
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
    "opening.card.3",
    "opening.card.3.advance",
    "opening.info.i7.advance"
  ];

  for (const actionId of introActions) {
    const { response } = await dispatchAction(created.sessionId, "second-board-path", actionId);
    assert.equal(response.status, 200);
  }

  const { response: card12Response, body: card12Body } = await dispatchAction(
    created.sessionId,
    "second-board-path",
    "opening.card.12"
  );
  assert.equal(card12Response.status, 200);
  const card12Action = card12Body as ActionResponse;
  const card12State = (card12Action.state.public.flags.cards["12"] ?? {}) as { selected?: boolean; resolved?: boolean };
  const card12LogEntry = card12Action.state.public.log[card12Action.state.public.log.length - 1] ?? {};

  assert.equal(card12Action.state.public.timeline.stepIndex, 11);
  assert.equal(card12Action.state.public.timeline.step_index, 11);
  assert.equal(card12Action.state.public.timeline.canAdvance, false);
  assert.equal(card12Action.state.secret?.opening?.selectedCardId, "3");
  assert.equal(card12Action.state.public.metrics?.pro, 2);
  assert.equal(card12Action.state.public.metrics?.rep, 1);
  assert.equal(card12Action.state.public.metrics?.time, 2);
  assert.equal(card12Action.state.public.metrics?.score, 58);
  assert.equal(card12State.selected, true);
  assert.equal(card12State.resolved, true);
  assert.equal(card12LogEntry.actionId, "opening.card.12");
  assert.equal(card12LogEntry.kind, "opening-card-resolution");
  assert.equal(card12LogEntry.cardId, "12");

  const { response: replayCard12Response, body: replayCard12Body } = await dispatchAction(
    created.sessionId,
    "second-board-path",
    "opening.card.12"
  );
  assert.equal(replayCard12Response.status, 400);
  const replayCard12Error = replayCard12Body as { error: string };
  assert.match(replayCard12Error.error, /guard failed/);

  const { response: card9Response, body: card9Body } = await dispatchAction(
    created.sessionId,
    "second-board-path",
    "opening.card.9"
  );
  assert.equal(card9Response.status, 200);
  const card9Action = card9Body as ActionResponse;
  const card9State = (card9Action.state.public.flags.cards["9"] ?? {}) as { selected?: boolean; resolved?: boolean };
  const card9LogEntry = card9Action.state.public.log[card9Action.state.public.log.length - 1] ?? {};

  assert.equal(card9Action.state.public.timeline.stepIndex, 11);
  assert.equal(card9Action.state.public.timeline.step_index, 11);
  assert.equal(card9Action.state.public.timeline.canAdvance, true);
  assert.equal(card9Action.state.secret?.opening?.selectedCardId, "9");
  assert.equal(card9Action.state.public.metrics?.pro, 3);
  assert.equal(card9Action.state.public.metrics?.rep, 3);
  assert.equal(card9Action.state.public.metrics?.time, 4);
  assert.equal(card9Action.state.public.metrics?.score, 56);
  assert.equal(card9State.selected, true);
  assert.equal(card9State.resolved, true);
  assert.equal(card9LogEntry.actionId, "opening.card.9");
  assert.equal(card9LogEntry.kind, "opening-card-resolution");
  assert.equal(card9LogEntry.cardId, "9");
});

test("POST /actions advances from opening.card.9 to the team-selection boundary and rejects non-go replay", async () => {
  const created = await createSession({ playerId: "third-board-path" });
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
    "opening.card.3",
    "opening.card.3.advance",
    "opening.info.i7.advance"
  ];

  for (const actionId of introActions) {
    const { response } = await dispatchAction(created.sessionId, "third-board-path", actionId);
    assert.equal(response.status, 200);
  }

  const { response: card9Response, body: card9Body } = await dispatchAction(
    created.sessionId,
    "third-board-path",
    "opening.card.9"
  );
  assert.equal(card9Response.status, 200);
  const card9Action = card9Body as ActionResponse;
  const card9State = (card9Action.state.public.flags.cards["9"] ?? {}) as { selected?: boolean; resolved?: boolean };
  const card9LogEntry = card9Action.state.public.log[card9Action.state.public.log.length - 1] ?? {};

  assert.equal(card9Action.state.public.timeline.stepIndex, 11);
  assert.equal(card9Action.state.public.timeline.step_index, 11);
  assert.equal(card9Action.state.public.timeline.canAdvance, true);
  assert.equal(card9Action.state.secret?.opening?.selectedCardId, "9");
  assert.equal(card9Action.state.public.metrics?.pro, 2);
  assert.equal(card9Action.state.public.metrics?.rep, 4);
  assert.equal(card9Action.state.public.metrics?.time, 3);
  assert.equal(card9Action.state.public.metrics?.score, 57);
  assert.equal(card9State.selected, true);
  assert.equal(card9State.resolved, true);
  assert.equal(card9LogEntry.actionId, "opening.card.9");
  assert.equal(card9LogEntry.kind, "opening-card-resolution");
  assert.equal(card9LogEntry.cardId, "9");

  const { response: card9AdvanceResponse, body: card9AdvanceBody } = await dispatchAction(
    created.sessionId,
    "third-board-path",
    "opening.card.9.advance"
  );
  assert.equal(card9AdvanceResponse.status, 200);
  const card9AdvanceAction = card9AdvanceBody as ActionResponse;
  const card9AdvanceLogEntry =
    card9AdvanceAction.state.public.log[card9AdvanceAction.state.public.log.length - 1] ?? {};

  assert.equal(card9AdvanceAction.state.public.timeline.stepIndex, 12);
  assert.equal(card9AdvanceAction.state.public.timeline.step_index, 12);
  assert.equal(card9AdvanceAction.state.public.timeline.stageId, "stage_intro");
  assert.equal(card9AdvanceAction.state.public.timeline.stage_id, "stage_intro");
  assert.equal(card9AdvanceAction.state.public.timeline.screenId, "S1");
  assert.equal(card9AdvanceAction.state.public.timeline.screen_id, "S1");
  assert.equal(card9AdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(card9AdvanceAction.state.secret?.opening?.selectedCardId, "9");
  assert.equal(card9AdvanceLogEntry.actionId, "opening.card.9.advance");
  assert.equal(card9AdvanceLogEntry.kind, "opening-card-advance");
  assert.equal(card9AdvanceLogEntry.cardId, "9");

  const { response: i8AdvanceResponse, body: i8AdvanceBody } = await dispatchAction(
    created.sessionId,
    "third-board-path",
    "opening.info.i8.advance"
  );
  assert.equal(i8AdvanceResponse.status, 200);
  const i8AdvanceAction = i8AdvanceBody as ActionResponse;
  const i8AdvanceLogEntry = i8AdvanceAction.state.public.log[i8AdvanceAction.state.public.log.length - 1] ?? {};

  assert.equal(i8AdvanceAction.state.public.timeline.stepIndex, 13);
  assert.equal(i8AdvanceAction.state.public.timeline.step_index, 13);
  assert.equal(i8AdvanceAction.state.public.timeline.stageId, "stage_intro");
  assert.equal(i8AdvanceAction.state.public.timeline.stage_id, "stage_intro");
  assert.equal(i8AdvanceAction.state.public.timeline.screenId, "S2");
  assert.equal(i8AdvanceAction.state.public.timeline.screen_id, "S2");
  assert.equal(i8AdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(i8AdvanceAction.state.secret?.opening?.selectedCardId, "9");
  assert.equal(i8AdvanceLogEntry.actionId, "opening.info.i8.advance");
  assert.equal(i8AdvanceLogEntry.kind, "opening-info-advance");

  const { response: card13Response, body: card13Body } = await dispatchAction(
    created.sessionId,
    "third-board-path",
    "opening.card.13"
  );
  assert.equal(card13Response.status, 200);
  const card13Action = card13Body as ActionResponse;
  const card13State = (card13Action.state.public.flags.cards["13"] ?? {}) as {
    selected?: boolean;
    resolved?: boolean;
  };
  const card13LogEntry = card13Action.state.public.log[card13Action.state.public.log.length - 1] ?? {};

  assert.equal(card13Action.state.public.timeline.stepIndex, 13);
  assert.equal(card13Action.state.public.timeline.step_index, 13);
  assert.equal(card13Action.state.public.timeline.canAdvance, false);
  assert.equal(card13Action.state.secret?.opening?.selectedCardId, "9");
  assert.equal(card13Action.state.public.metrics?.pro, 2);
  assert.equal(card13Action.state.public.metrics?.rep, -1);
  assert.equal(card13Action.state.public.metrics?.time, 6);
  assert.equal(card13Action.state.public.metrics?.score, 54);
  assert.equal(card13State.selected, true);
  assert.equal(card13State.resolved, true);
  assert.equal(card13LogEntry.actionId, "opening.card.13");
  assert.equal(card13LogEntry.kind, "opening-card-resolution");
  assert.equal(card13LogEntry.cardId, "13");

  const { response: replayCard13Response, body: replayCard13Body } = await dispatchAction(
    created.sessionId,
    "third-board-path",
    "opening.card.13"
  );
  assert.equal(replayCard13Response.status, 400);
  const replayCard13Error = replayCard13Body as { error: string };
  assert.match(replayCard13Error.error, /guard failed/);

  const { response: card18Response, body: card18Body } = await dispatchAction(
    created.sessionId,
    "third-board-path",
    "opening.card.18"
  );
  assert.equal(card18Response.status, 200);
  const card18Action = card18Body as ActionResponse;
  const card18State = (card18Action.state.public.flags.cards["18"] ?? {}) as {
    selected?: boolean;
    resolved?: boolean;
  };
  const card18LogEntry = card18Action.state.public.log[card18Action.state.public.log.length - 1] ?? {};

  assert.equal(card18Action.state.public.timeline.stepIndex, 13);
  assert.equal(card18Action.state.public.timeline.step_index, 13);
  assert.equal(card18Action.state.public.timeline.canAdvance, true);
  assert.equal(card18Action.state.secret?.opening?.selectedCardId, "18");
  assert.equal(card18Action.state.public.metrics?.pro, 4);
  assert.equal(card18Action.state.public.metrics?.rep, 1);
  assert.equal(card18Action.state.public.metrics?.time, 7);
  assert.equal(card18Action.state.public.metrics?.score, 53);
  assert.equal(card18State.selected, true);
  assert.equal(card18State.resolved, true);
  assert.equal(card18LogEntry.actionId, "opening.card.18");
  assert.equal(card18LogEntry.kind, "opening-card-resolution");
  assert.equal(card18LogEntry.cardId, "18");

  const { response: card18AdvanceResponse, body: card18AdvanceBody } = await dispatchAction(
    created.sessionId,
    "third-board-path",
    "opening.card.18.advance"
  );
  assert.equal(card18AdvanceResponse.status, 200);
  const card18AdvanceAction = card18AdvanceBody as ActionResponse;
  const card18AdvanceLogEntry =
    card18AdvanceAction.state.public.log[card18AdvanceAction.state.public.log.length - 1] ?? {};

  assert.equal(card18AdvanceAction.state.public.timeline.stepIndex, 14);
  assert.equal(card18AdvanceAction.state.public.timeline.step_index, 14);
  assert.equal(card18AdvanceAction.state.public.timeline.stageId, "stage_intro");
  assert.equal(card18AdvanceAction.state.public.timeline.stage_id, "stage_intro");
  assert.equal(card18AdvanceAction.state.public.timeline.screenId, "S1");
  assert.equal(card18AdvanceAction.state.public.timeline.screen_id, "S1");
  assert.equal(card18AdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(card18AdvanceAction.state.secret?.opening?.selectedCardId, "18");
  assert.equal(card18AdvanceLogEntry.actionId, "opening.card.18.advance");
  assert.equal(card18AdvanceLogEntry.kind, "opening-card-advance");
  assert.equal(card18AdvanceLogEntry.cardId, "18");

  const { response: i9AdvanceResponse, body: i9AdvanceBody } = await dispatchAction(
    created.sessionId,
    "third-board-path",
    "opening.info.i9.advance"
  );
  assert.equal(i9AdvanceResponse.status, 200);
  const i9AdvanceAction = i9AdvanceBody as ActionResponse;
  const i9AdvanceLogEntry = i9AdvanceAction.state.public.log[i9AdvanceAction.state.public.log.length - 1] ?? {};

  assert.equal(i9AdvanceAction.state.public.timeline.stepIndex, 15);
  assert.equal(i9AdvanceAction.state.public.timeline.step_index, 15);
  assert.equal(i9AdvanceAction.state.public.timeline.stageId, "stage_intro");
  assert.equal(i9AdvanceAction.state.public.timeline.stage_id, "stage_intro");
  assert.equal(i9AdvanceAction.state.public.timeline.screenId, "S2");
  assert.equal(i9AdvanceAction.state.public.timeline.screen_id, "S2");
  assert.equal(i9AdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(i9AdvanceAction.state.secret?.opening?.selectedCardId, "18");
  assert.equal(i9AdvanceLogEntry.actionId, "opening.info.i9.advance");
  assert.equal(i9AdvanceLogEntry.kind, "opening-info-advance");
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
