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
    line?: string;
    stepIndex?: number;
    stageId?: string;
    screenId?: string;
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

const OPENING_ACTIONS_TO_TEAM_SELECTION_BOUNDARY = [
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
  "opening.info.i7.advance",
  "opening.card.9",
  "opening.card.9.advance",
  "opening.info.i8.advance",
  "opening.card.18",
  "opening.card.18.advance",
  "opening.info.i9.advance"
] as const;

const dispatchActionSequence = async (
  sessionId: string,
  playerId: string,
  actionIds: ReadonlyArray<string>
) => {
  let lastAction: ActionResponse | null = null;

  for (const actionId of actionIds) {
    const { response, body } = await dispatchAction(sessionId, playerId, actionId);
    assert.equal(response.status, 200);
    lastAction = body as ActionResponse;
  }

  assert.ok(lastAction);
  return lastAction;
};

const reachOpeningStep20InfoI12 = async (
  sessionId: string,
  playerId: string,
  options: {
    teamActions: ReadonlyArray<string>;
    step17GoCardActionId: "opening.card.22" | "opening.card.23";
    step19CardActionIds: ReadonlyArray<string>;
  }
) => {
  await dispatchActionSequence(sessionId, playerId, OPENING_ACTIONS_TO_TEAM_SELECTION_BOUNDARY);
  await dispatchActionSequence(sessionId, playerId, options.teamActions);

  const postConfirmActions = [
    "opening.team.confirm",
    "opening.info.i10.advance",
    options.step17GoCardActionId,
    `${options.step17GoCardActionId}.advance`,
    "opening.info.i11.advance",
    ...options.step19CardActionIds,
    "opening.board.25_30.advance"
  ];

  return dispatchActionSequence(sessionId, playerId, postConfirmActions);
};

const reachOpeningStep21Board = async (
  sessionId: string,
  playerId: string,
  options: Parameters<typeof reachOpeningStep20InfoI12>[2]
) => {
  const step20Action = await reachOpeningStep20InfoI12(sessionId, playerId, options);
  assert.equal(step20Action.state.public.timeline.stepIndex, 20);
  assert.equal(step20Action.state.public.timeline.line, "main");

  const { response, body } = await dispatchAction(sessionId, playerId, "opening.info.i12.advance");
  assert.equal(response.status, 200);
  return body as ActionResponse;
};

const reachOpeningStep23Boundary = async (
  sessionId: string,
  playerId: string,
  options: Parameters<typeof reachOpeningStep20InfoI12>[2] & {
    step21GoCardActionId:
      | "opening.card.31"
      | "opening.card.32"
      | "opening.card.33"
      | "opening.card.35"
      | "opening.card.36";
  }
) => {
  await reachOpeningStep21Board(sessionId, playerId, options);

  const { response: step21CardResponse, body: step21CardBody } = await dispatchAction(
    sessionId,
    playerId,
    options.step21GoCardActionId
  );
  assert.equal(step21CardResponse.status, 200);
  const step21CardAction = step21CardBody as ActionResponse;
  assert.equal(step21CardAction.state.public.timeline.stepIndex, 21);
  assert.equal(step21CardAction.state.public.timeline.canAdvance, true);

  const { response: step21AdvanceResponse } = await dispatchAction(
    sessionId,
    playerId,
    `${options.step21GoCardActionId}.advance`
  );
  assert.equal(step21AdvanceResponse.status, 200);

  const { response, body } = await dispatchAction(sessionId, playerId, "opening.info.i13.advance");
  assert.equal(response.status, 200);
  return body as ActionResponse;
};

const reachOpeningStep26Boundary = async (sessionId: string, playerId: string) => {
  await reachOpeningStep23Boundary(sessionId, playerId, {
    teamActions: [
      "opening.team.select.fedya",
      "opening.team.select.zora",
      "opening.team.select.grisha",
      "opening.team.select.aliona",
      "opening.team.select.leo"
    ],
    step17GoCardActionId: "opening.card.22",
    step19CardActionIds: ["opening.card.25", "opening.card.28", "opening.card.30"],
    step21GoCardActionId: "opening.card.31"
  });

  const { response: card3902Response } = await dispatchAction(sessionId, playerId, "opening.card.3902");
  assert.equal(card3902Response.status, 200);

  const { response: card3902AdvanceResponse } = await dispatchAction(
    sessionId,
    playerId,
    "opening.card.3902.advance"
  );
  assert.equal(card3902AdvanceResponse.status, 200);

  const { response: i14AdvanceResponse } = await dispatchAction(sessionId, playerId, "opening.info.i14.advance");
  assert.equal(i14AdvanceResponse.status, 200);

  const { response: i14_2AdvanceResponse, body } = await dispatchAction(
    sessionId,
    playerId,
    "opening.info.i14_2.advance"
  );
  assert.equal(i14_2AdvanceResponse.status, 200);
  return body as ActionResponse;
};

const reachOpeningStep28Boundary = async (sessionId: string, playerId: string) => {
  await reachOpeningStep26Boundary(sessionId, playerId);

  const { response: card48Response } = await dispatchAction(sessionId, playerId, "opening.card.48");
  assert.equal(card48Response.status, 200);

  const { response: card48AdvanceResponse } = await dispatchAction(sessionId, playerId, "opening.card.48.advance");
  assert.equal(card48AdvanceResponse.status, 200);

  const { response: i15AdvanceResponse, body } = await dispatchAction(
    sessionId,
    playerId,
    "opening.info.i15.advance"
  );
  assert.equal(i15AdvanceResponse.status, 200);
  return body as ActionResponse;
};

const reachOpeningStep30Boundary = async (sessionId: string, playerId: string) => {
  await reachOpeningStep28Boundary(sessionId, playerId);

  const { response: card49Response } = await dispatchAction(sessionId, playerId, "opening.card.49");
  assert.equal(card49Response.status, 200);

  const { response: card49AdvanceResponse } = await dispatchAction(sessionId, playerId, "opening.card.49.advance");
  assert.equal(card49AdvanceResponse.status, 200);

  const { response: i16AdvanceResponse, body } = await dispatchAction(
    sessionId,
    playerId,
    "opening.info.i16.advance"
  );
  assert.equal(i16AdvanceResponse.status, 200);
  return body as ActionResponse;
};

const reachOpeningStep32Boundary = async (sessionId: string, playerId: string) => {
  await reachOpeningStep30Boundary(sessionId, playerId);

  const { response: card60Response } = await dispatchAction(sessionId, playerId, "opening.card.60");
  assert.equal(card60Response.status, 200);

  const { response: card60AdvanceResponse } = await dispatchAction(
    sessionId,
    playerId,
    "opening.card.60.advance"
  );
  assert.equal(card60AdvanceResponse.status, 200);

  const { response: i17AdvanceResponse, body } = await dispatchAction(
    sessionId,
    playerId,
    "opening.info.i17.advance"
  );
  assert.equal(i17AdvanceResponse.status, 200);
  return body as ActionResponse;
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

test("POST /actions applies bounded team selection through the step 18 boundary", async () => {
  const created = await createSession({ playerId: "team-selection-path" });
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
    "opening.info.i7.advance",
    "opening.card.9",
    "opening.card.9.advance",
    "opening.info.i8.advance",
    "opening.card.13",
    "opening.card.18",
    "opening.card.18.advance",
    "opening.info.i9.advance"
  ];

  let boundaryAction: ActionResponse | null = null;
  for (const actionId of introActions) {
    const { response, body } = await dispatchAction(created.sessionId, "team-selection-path", actionId);
    assert.equal(response.status, 200);
    boundaryAction = body as ActionResponse;
  }

  assert.ok(boundaryAction);
  const boundaryMetrics = boundaryAction.state.public.metrics ?? {};
  const baselineTime = typeof boundaryMetrics.time === "number" ? boundaryMetrics.time : 0;
  const baselineMetrics = {
    pro: typeof boundaryMetrics.pro === "number" ? boundaryMetrics.pro : 0,
    man: typeof boundaryMetrics.man === "number" ? boundaryMetrics.man : 0,
    lid: typeof boundaryMetrics.lid === "number" ? boundaryMetrics.lid : 0,
    stat: typeof boundaryMetrics.stat === "number" ? boundaryMetrics.stat : 0,
    constr: typeof boundaryMetrics.constr === "number" ? boundaryMetrics.constr : 0,
    cont: typeof boundaryMetrics.cont === "number" ? boundaryMetrics.cont : 0
  };

  assert.equal(boundaryAction.state.public.timeline.stepIndex, 15);
  assert.equal(boundaryAction.state.public.timeline.stageId, "stage_intro");
  assert.equal(boundaryAction.state.public.timeline.screenId, "S2");
  assert.equal(boundaryAction.state.public.teamSelection?.pickCount, 0);
  assert.deepEqual(boundaryAction.state.public.teamSelection?.selectedMemberIds, []);

  const teamPicks = [
    {
      actionId: "opening.team.select.fedya",
      memberId: "fedya",
      deltas: { pro: 10, man: 5, constr: 5, time: 0.4 }
    },
    {
      actionId: "opening.team.select.aliona",
      memberId: "aliona",
      deltas: { lid: 10, man: 10, stat: 10, constr: 5, time: 0.4 }
    },
    {
      actionId: "opening.team.select.leo",
      memberId: "leo",
      deltas: { lid: 15, man: 5, stat: 10, constr: 10, time: 0.4 }
    },
    {
      actionId: "opening.team.select.grisha",
      memberId: "grisha",
      deltas: { pro: 5, stat: 10, constr: -25, time: 0.4 }
    },
    {
      actionId: "opening.team.select.liza",
      memberId: "liza",
      deltas: { man: 5, stat: 5, cont: 10, constr: 10, time: 0.4 }
    }
  ] as const;

  const expectedMetrics: Record<string, number> = { ...baselineMetrics, time: baselineTime };
  const roundMetric = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

  for (const [index, pick] of teamPicks.slice(0, 4).entries()) {
    const { response, body } = await dispatchAction(created.sessionId, "team-selection-path", pick.actionId);
    assert.equal(response.status, 200);
    const pickAction = body as ActionResponse;
    const expectedPickCount = index + 1;

    expectedMetrics.time = roundMetric(expectedMetrics.time + pick.deltas.time);
    for (const [metricId, delta] of Object.entries(pick.deltas)) {
      if (metricId === "time") {
        continue;
      }
      expectedMetrics[metricId] = (expectedMetrics[metricId] ?? 0) + delta;
    }
    expectedMetrics.score = roundMetric(60 - expectedMetrics.time);

    assert.equal(pickAction.state.public.teamSelection?.pickCount, expectedPickCount);
    assert.deepEqual(pickAction.state.public.teamSelection?.selectedMemberIds, teamPicks.slice(0, expectedPickCount).map((item) => item.memberId));
    assert.equal(
      (pickAction.state.public.flags.team?.[pick.memberId] ?? {}).selected,
      true
    );

    for (const [metricId, metricValue] of Object.entries(expectedMetrics)) {
      assert.equal(pickAction.state.public.metrics?.[metricId], metricValue);
    }
  }

  const { response: replayResponse, body: replayBody } = await dispatchAction(
    created.sessionId,
    "team-selection-path",
    "opening.team.select.fedya"
  );
  assert.equal(replayResponse.status, 400);
  const replayErrorBody = replayBody as { error: string };
  assert.match(replayErrorBody.error, /guard failed/);

  const { response: confirmBeforeFifthResponse, body: confirmBeforeFifthBody } = await dispatchAction(
    created.sessionId,
    "team-selection-path",
    "opening.team.confirm"
  );
  assert.equal(confirmBeforeFifthResponse.status, 400);
  const confirmBeforeFifthErrorBody = confirmBeforeFifthBody as { error: string };
  assert.match(confirmBeforeFifthErrorBody.error, /guard failed/);

  const fifthPick = teamPicks[4];
  const { response: fifthResponse, body: fifthBody } = await dispatchAction(
    created.sessionId,
    "team-selection-path",
    fifthPick.actionId
  );
  assert.equal(fifthResponse.status, 200);
  const fifthAction = fifthBody as ActionResponse;
  expectedMetrics.time = roundMetric(expectedMetrics.time + fifthPick.deltas.time);
  for (const [metricId, delta] of Object.entries(fifthPick.deltas)) {
    if (metricId === "time") {
      continue;
    }
    expectedMetrics[metricId] = (expectedMetrics[metricId] ?? 0) + delta;
  }
  expectedMetrics.score = roundMetric(60 - expectedMetrics.time);

  assert.equal(fifthAction.state.public.teamSelection?.pickCount, 5);
  assert.deepEqual(
    fifthAction.state.public.teamSelection?.selectedMemberIds,
    teamPicks.map((item) => item.memberId)
  );
  assert.equal((fifthAction.state.public.flags.team?.[fifthPick.memberId] ?? {}).selected, true);
  for (const [metricId, metricValue] of Object.entries(expectedMetrics)) {
    assert.equal(fifthAction.state.public.metrics?.[metricId], metricValue);
  }

  const { response: sixthResponse, body: sixthBody } = await dispatchAction(
    created.sessionId,
    "team-selection-path",
    "opening.team.select.zenya"
  );
  assert.equal(sixthResponse.status, 400);
  const sixthErrorBody = sixthBody as { error: string };
  assert.match(sixthErrorBody.error, /guard failed/);

  const { response: confirmResponse, body: confirmBody } = await dispatchAction(
    created.sessionId,
    "team-selection-path",
    "opening.team.confirm"
  );
  assert.equal(confirmResponse.status, 200);
  const confirmAction = confirmBody as ActionResponse;
  assert.equal(confirmAction.state.public.timeline.stepIndex, 16);
  assert.equal(confirmAction.state.public.timeline.stageId, "stage_intro");
  assert.equal(confirmAction.state.public.timeline.screenId, "S1");
  assert.equal(confirmAction.state.public.teamSelection?.pickCount, 5);
  assert.deepEqual(confirmAction.state.public.teamSelection?.selectedMemberIds, teamPicks.map((item) => item.memberId));

  const { response: i10AdvanceResponse, body: i10AdvanceBody } = await dispatchAction(
    created.sessionId,
    "team-selection-path",
    "opening.info.i10.advance"
  );
  assert.equal(i10AdvanceResponse.status, 200);
  const i10AdvanceAction = i10AdvanceBody as ActionResponse;
  assert.equal(i10AdvanceAction.state.public.timeline.stepIndex, 17);
  assert.equal(i10AdvanceAction.state.public.timeline.stageId, "stage_intro");
  assert.equal(i10AdvanceAction.state.public.timeline.screenId, "S2");
  assert.equal(i10AdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(i10AdvanceAction.state.secret?.opening?.selectedCardId, "18");

  const { response: card21Response, body: card21Body } = await dispatchAction(
    created.sessionId,
    "team-selection-path",
    "opening.card.21"
  );
  assert.equal(card21Response.status, 200);
  const card21Action = card21Body as ActionResponse;
  assert.equal(card21Action.state.public.timeline.stepIndex, 17);
  assert.equal(card21Action.state.public.timeline.stageId, "stage_intro");
  assert.equal(card21Action.state.public.timeline.screenId, "S2");
  assert.equal(card21Action.state.public.timeline.canAdvance, false);
  assert.equal(card21Action.state.secret?.opening?.selectedCardId, "18");
  const card21Flags = card21Action.state.public.flags.cards["21"] as { selected?: boolean; resolved?: boolean } | undefined;
  assert.equal(card21Flags?.selected, true);
  assert.equal(card21Flags?.resolved, true);

  const { response: card21ReplayResponse, body: card21ReplayBody } = await dispatchAction(
    created.sessionId,
    "team-selection-path",
    "opening.card.21"
  );
  assert.equal(card21ReplayResponse.status, 400);
  const card21ReplayErrorBody = card21ReplayBody as { error: string };
  assert.match(card21ReplayErrorBody.error, /guard failed/);

  const { response: replaySessionResponse, body: replaySession } = await requestJson<SessionResponse>(
    `/sessions/${created.sessionId}`
  );
  assert.equal(replaySessionResponse.status, 200);
  assert.equal(replaySession.state.public.timeline.stepIndex, 17);
  assert.equal(replaySession.state.public.timeline.stageId, "stage_intro");
  assert.equal(replaySession.state.public.timeline.screenId, "S2");

  const { response: card22Response, body: card22Body } = await dispatchAction(
    created.sessionId,
    "team-selection-path",
    "opening.card.22"
  );
  assert.equal(card22Response.status, 200);
  const card22Action = card22Body as ActionResponse;
  assert.equal(card22Action.state.public.timeline.stepIndex, 17);
  assert.equal(card22Action.state.public.timeline.stageId, "stage_intro");
  assert.equal(card22Action.state.public.timeline.screenId, "S2");
  assert.equal(card22Action.state.public.timeline.canAdvance, true);
  assert.equal(card22Action.state.secret?.opening?.selectedCardId, "22");

  const { response: card22AdvanceResponse, body: card22AdvanceBody } = await dispatchAction(
    created.sessionId,
    "team-selection-path",
    "opening.card.22.advance"
  );
  assert.equal(card22AdvanceResponse.status, 200);
  const card22AdvanceAction = card22AdvanceBody as ActionResponse;
  assert.equal(card22AdvanceAction.state.public.timeline.stepIndex, 18);
  assert.equal(card22AdvanceAction.state.public.timeline.stageId, "stage_intro");
  assert.equal(card22AdvanceAction.state.public.timeline.screenId, "S1");
  assert.equal(card22AdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(card22AdvanceAction.state.secret?.opening?.selectedCardId, "22");

  const { response: i11AdvanceResponse, body: i11AdvanceBody } = await dispatchAction(
    created.sessionId,
    "team-selection-path",
    "opening.info.i11.advance"
  );
  assert.equal(i11AdvanceResponse.status, 200);
  const i11AdvanceAction = i11AdvanceBody as ActionResponse;
  const i11AdvanceLogEntry = i11AdvanceAction.state.public.log[i11AdvanceAction.state.public.log.length - 1] ?? {};

  assert.equal(i11AdvanceAction.state.public.timeline.stepIndex, 19);
  assert.equal(i11AdvanceAction.state.public.timeline.step_index, 19);
  assert.equal(i11AdvanceAction.state.public.timeline.stageId, "stage_intro");
  assert.equal(i11AdvanceAction.state.public.timeline.stage_id, "stage_intro");
  assert.equal(i11AdvanceAction.state.public.timeline.screenId, "S2");
  assert.equal(i11AdvanceAction.state.public.timeline.screen_id, "S2");
  assert.equal(i11AdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(i11AdvanceAction.state.secret?.opening?.selectedCardId, "22");
  assert.equal(i11AdvanceLogEntry.actionId, "opening.info.i11.advance");
  assert.equal(i11AdvanceLogEntry.kind, "opening-info-advance");

  const { response: card25Response, body: card25Body } = await dispatchAction(
    created.sessionId,
    "team-selection-path",
    "opening.card.25"
  );
  assert.equal(card25Response.status, 200);
  const card25Action = card25Body as ActionResponse;
  const card25State = (card25Action.state.public.flags.cards["25"] ?? {}) as { selected?: boolean; resolved?: boolean };
  assert.equal(card25Action.state.public.timeline.stepIndex, 19);
  assert.equal(card25Action.state.public.timeline.step_index, 19);
  assert.equal(card25Action.state.public.timeline.screenId, "S2");
  assert.equal(card25Action.state.public.timeline.screen_id, "S2");
  assert.equal(card25Action.state.public.timeline.canAdvance, false);
  assert.equal(card25State.selected, true);
  assert.equal(card25State.resolved, true);

  const { response: card26Response, body: card26Body } = await dispatchAction(
    created.sessionId,
    "team-selection-path",
    "opening.card.26"
  );
  assert.equal(card26Response.status, 200);
  const card26Action = card26Body as ActionResponse;
  const card26State = (card26Action.state.public.flags.cards["26"] ?? {}) as { selected?: boolean; resolved?: boolean };
  assert.equal(card26Action.state.public.timeline.stepIndex, 19);
  assert.equal(card26Action.state.public.timeline.step_index, 19);
  assert.equal(card26Action.state.public.timeline.screenId, "S2");
  assert.equal(card26Action.state.public.timeline.screen_id, "S2");
  assert.equal(card26Action.state.public.timeline.canAdvance, false);
  assert.equal(card26State.selected, true);
  assert.equal(card26State.resolved, true);

  const { response: advanceBeforeThresholdResponse, body: advanceBeforeThresholdBody } = await dispatchAction(
    created.sessionId,
    "team-selection-path",
    "opening.board.25_30.advance"
  );
  assert.equal(advanceBeforeThresholdResponse.status, 400);
  const advanceBeforeThresholdErrorBody = advanceBeforeThresholdBody as { error: string };
  assert.match(advanceBeforeThresholdErrorBody.error, /guard failed/);

  const { response: card27Response, body: card27Body } = await dispatchAction(
    created.sessionId,
    "team-selection-path",
    "opening.card.27"
  );
  assert.equal(card27Response.status, 200);
  const card27Action = card27Body as ActionResponse;
  const card27State = (card27Action.state.public.flags.cards["27"] ?? {}) as { selected?: boolean; resolved?: boolean };
  assert.equal(card27Action.state.public.timeline.stepIndex, 19);
  assert.equal(card27Action.state.public.timeline.step_index, 19);
  assert.equal(card27Action.state.public.timeline.screenId, "S2");
  assert.equal(card27Action.state.public.timeline.screen_id, "S2");
  assert.equal(card27Action.state.public.timeline.canAdvance, true);
  assert.equal(card27State.selected, true);
  assert.equal(card27State.resolved, true);

  const { response: replayCard26Response, body: replayCard26Body } = await dispatchAction(
    created.sessionId,
    "team-selection-path",
    "opening.card.26"
  );
  assert.equal(replayCard26Response.status, 400);
  const replayCard26ErrorBody = replayCard26Body as { error: string };
  assert.match(replayCard26ErrorBody.error, /guard failed/);

  const { response: boardAdvanceResponse, body: boardAdvanceBody } = await dispatchAction(
    created.sessionId,
    "team-selection-path",
    "opening.board.25_30.advance"
  );
  assert.equal(boardAdvanceResponse.status, 200);
  const boardAdvanceAction = boardAdvanceBody as ActionResponse;
  const boardAdvanceLogEntry = boardAdvanceAction.state.public.log[boardAdvanceAction.state.public.log.length - 1] ?? {};

  assert.equal(boardAdvanceAction.state.public.timeline.stepIndex, 20);
  assert.equal(boardAdvanceAction.state.public.timeline.step_index, 20);
  assert.equal(boardAdvanceAction.state.public.timeline.stageId, "stage_intro");
  assert.equal(boardAdvanceAction.state.public.timeline.stage_id, "stage_intro");
  assert.equal(boardAdvanceAction.state.public.timeline.screenId, "S1");
  assert.equal(boardAdvanceAction.state.public.timeline.screen_id, "S1");
  assert.equal(boardAdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(boardAdvanceAction.state.secret?.opening?.selectedCardId, "22");
  assert.equal(boardAdvanceLogEntry.actionId, "opening.board.25_30.advance");
  assert.equal(boardAdvanceLogEntry.kind, "opening-board-advance");
});

test("POST /actions resolves opening.card.31 with a post-base conditional bonus and reaches the step-23 boundary", async () => {
  const created = await createSession({ playerId: "step-21-mainline" });
  const step21Action = await reachOpeningStep21Board(created.sessionId, "step-21-mainline", {
    teamActions: [
      "opening.team.select.fedya",
      "opening.team.select.aliona",
      "opening.team.select.leo",
      "opening.team.select.grisha",
      "opening.team.select.liza"
    ],
    step17GoCardActionId: "opening.card.22",
    step19CardActionIds: ["opening.card.25", "opening.card.28", "opening.card.30"]
  });

  assert.equal(step21Action.state.public.timeline.line, "main");
  assert.equal(step21Action.state.public.timeline.stepIndex, 21);
  assert.equal(step21Action.state.public.timeline.step_index, 21);
  assert.equal(step21Action.state.public.timeline.screenId, "S2");
  assert.equal(step21Action.state.public.timeline.screen_id, "S2");
  assert.equal(step21Action.state.public.timeline.canAdvance, false);
  assert.equal(step21Action.state.public.metrics?.cont, 10);

  const beforeCard31Time = Number(step21Action.state.public.metrics?.time ?? 0);
  const beforeCard31Rep = Number(step21Action.state.public.metrics?.rep ?? 0);

  const { response: card31Response, body: card31Body } = await dispatchAction(
    created.sessionId,
    "step-21-mainline",
    "opening.card.31"
  );
  assert.equal(card31Response.status, 200);
  const card31Action = card31Body as ActionResponse;
  const card31Flags = card31Action.state.public.flags.cards["31"] as { selected?: boolean; resolved?: boolean } | undefined;

  assert.equal(card31Action.state.public.timeline.line, "main");
  assert.equal(card31Action.state.public.timeline.stepIndex, 21);
  assert.equal(card31Action.state.public.timeline.step_index, 21);
  assert.equal(card31Action.state.public.timeline.canAdvance, true);
  assert.equal(card31Action.state.public.metrics?.rep, beforeCard31Rep + 1);
  assert.equal(card31Action.state.public.metrics?.cont, 11);
  assert.equal(card31Action.state.public.metrics?.time, beforeCard31Time + 2);
  assert.equal(card31Action.state.public.metrics?.score, 60 - (beforeCard31Time + 2));
  assert.equal(card31Action.state.secret?.opening?.selectedCardId, "31");
  assert.equal(card31Flags?.selected, true);
  assert.equal(card31Flags?.resolved, true);

  const { response: card31AdvanceResponse, body: card31AdvanceBody } = await dispatchAction(
    created.sessionId,
    "step-21-mainline",
    "opening.card.31.advance"
  );
  assert.equal(card31AdvanceResponse.status, 200);
  const card31AdvanceAction = card31AdvanceBody as ActionResponse;

  assert.equal(card31AdvanceAction.state.public.timeline.line, "main");
  assert.equal(card31AdvanceAction.state.public.timeline.stepIndex, 22);
  assert.equal(card31AdvanceAction.state.public.timeline.step_index, 22);
  assert.equal(card31AdvanceAction.state.public.timeline.screenId, "S1");
  assert.equal(card31AdvanceAction.state.public.timeline.screen_id, "S1");
  assert.equal(card31AdvanceAction.state.public.timeline.canAdvance, false);

  const { response: i13AdvanceResponse, body: i13AdvanceBody } = await dispatchAction(
    created.sessionId,
    "step-21-mainline",
    "opening.info.i13.advance"
  );
  assert.equal(i13AdvanceResponse.status, 200);
  const i13AdvanceAction = i13AdvanceBody as ActionResponse;
  const i13AdvanceLogEntry =
    i13AdvanceAction.state.public.log[i13AdvanceAction.state.public.log.length - 1] ?? {};

  assert.equal(i13AdvanceAction.state.public.timeline.line, "main");
  assert.equal(i13AdvanceAction.state.public.timeline.stepIndex, 23);
  assert.equal(i13AdvanceAction.state.public.timeline.step_index, 23);
  assert.equal(i13AdvanceAction.state.public.timeline.screenId, "S2");
  assert.equal(i13AdvanceAction.state.public.timeline.screen_id, "S2");
  assert.equal(i13AdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(i13AdvanceLogEntry.actionId, "opening.info.i13.advance");
  assert.equal(i13AdvanceLogEntry.kind, "opening-info-advance");
});

test("POST /actions sends opening.card.34 to the loss line when pre-action stat is below 25", async () => {
  const created = await createSession({ playerId: "step-21-loss-line" });
  const step21Action = await reachOpeningStep21Board(created.sessionId, "step-21-loss-line", {
    teamActions: [
      "opening.team.select.fedya",
      "opening.team.select.zenya",
      "opening.team.select.arkadii",
      "opening.team.select.vasya",
      "opening.team.select.liza"
    ],
    step17GoCardActionId: "opening.card.23",
    step19CardActionIds: ["opening.card.25", "opening.card.28", "opening.card.30"]
  });

  assert.equal(step21Action.state.public.timeline.line, "main");
  assert.equal(step21Action.state.public.timeline.stepIndex, 21);
  assert.equal(step21Action.state.public.metrics?.stat, 6);

  const beforeCard34Rep = Number(step21Action.state.public.metrics?.rep ?? 0);
  const beforeCard34Lid = Number(step21Action.state.public.metrics?.lid ?? 0);
  const beforeCard34Stat = Number(step21Action.state.public.metrics?.stat ?? 0);
  const beforeCard34Time = Number(step21Action.state.public.metrics?.time ?? 0);

  const { response: card34Response, body: card34Body } = await dispatchAction(
    created.sessionId,
    "step-21-loss-line",
    "opening.card.34"
  );
  assert.equal(card34Response.status, 200);
  const card34Action = card34Body as ActionResponse;
  const card34Flags = card34Action.state.public.flags.cards["34"] as { selected?: boolean; resolved?: boolean } | undefined;

  assert.equal(card34Action.state.public.timeline.line, "loss");
  assert.equal(card34Action.state.public.timeline.stepIndex, 0);
  assert.equal(card34Action.state.public.timeline.step_index, 0);
  assert.equal(card34Action.state.public.timeline.stageId, "stage_loss");
  assert.equal(card34Action.state.public.timeline.stage_id, "stage_loss");
  assert.equal(card34Action.state.public.timeline.screenId, "S1");
  assert.equal(card34Action.state.public.timeline.screen_id, "S1");
  assert.equal(card34Action.state.public.timeline.canAdvance, false);
  assert.equal(card34Action.state.public.metrics?.rep, beforeCard34Rep - 5);
  assert.equal(card34Action.state.public.metrics?.lid, beforeCard34Lid - 3);
  assert.equal(card34Action.state.public.metrics?.stat, beforeCard34Stat + 3);
  assert.equal(card34Action.state.public.metrics?.time, beforeCard34Time + 2);
  assert.equal(card34Action.state.public.metrics?.score, 60 - (beforeCard34Time + 2));
  assert.equal(card34Action.state.secret?.opening?.selectedCardId, "34");
  assert.equal(card34Flags?.selected, true);
  assert.equal(card34Flags?.resolved, true);

  const { response: i34AdvanceResponse, body: i34AdvanceBody } = await dispatchAction(
    created.sessionId,
    "step-21-loss-line",
    "opening.info.i34.advance"
  );
  assert.equal(i34AdvanceResponse.status, 200);
  const i34AdvanceAction = i34AdvanceBody as ActionResponse;

  assert.equal(i34AdvanceAction.state.public.timeline.line, "loss");
  assert.equal(i34AdvanceAction.state.public.timeline.stepIndex, 1);
  assert.equal(i34AdvanceAction.state.public.timeline.step_index, 1);
  assert.equal(i34AdvanceAction.state.public.timeline.stageId, "stage_loss");
  assert.equal(i34AdvanceAction.state.public.timeline.stage_id, "stage_loss");
  assert.equal(i34AdvanceAction.state.public.timeline.screenId, "S1");
  assert.equal(i34AdvanceAction.state.public.timeline.screen_id, "S1");
  assert.equal(i34AdvanceAction.state.public.timeline.canAdvance, false);

  const { response: i34_2AdvanceResponse, body: i34_2AdvanceBody } = await dispatchAction(
    created.sessionId,
    "step-21-loss-line",
    "opening.info.i34_2.advance"
  );
  assert.equal(i34_2AdvanceResponse.status, 200);
  const i34_2AdvanceAction = i34_2AdvanceBody as ActionResponse;
  const i34_2AdvanceLogEntry =
    i34_2AdvanceAction.state.public.log[i34_2AdvanceAction.state.public.log.length - 1] ?? {};

  assert.equal(i34_2AdvanceAction.state.public.timeline.line, "loss");
  assert.equal(i34_2AdvanceAction.state.public.timeline.stepIndex, 2);
  assert.equal(i34_2AdvanceAction.state.public.timeline.step_index, 2);
  assert.equal(i34_2AdvanceAction.state.public.timeline.stageId, "stage_loss");
  assert.equal(i34_2AdvanceAction.state.public.timeline.stage_id, "stage_loss");
  assert.equal(i34_2AdvanceAction.state.public.timeline.screenId, "S1");
  assert.equal(i34_2AdvanceAction.state.public.timeline.screen_id, "S1");
  assert.equal(i34_2AdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(i34_2AdvanceLogEntry.actionId, "opening.info.i34_2.advance");
  assert.equal(i34_2AdvanceLogEntry.kind, "opening-info-advance");
});

test("POST /actions keeps opening.card.39 locked until the third resolved step-23 card, then reaches step 26 through i14 and i14_2", async () => {
  const created = await createSession({ playerId: "step-23-low-pro" });
  const step23Action = await reachOpeningStep23Boundary(created.sessionId, "step-23-low-pro", {
    teamActions: [
      "opening.team.select.fedya",
      "opening.team.select.aliona",
      "opening.team.select.leo",
      "opening.team.select.grisha",
      "opening.team.select.liza"
    ],
    step17GoCardActionId: "opening.card.22",
    step19CardActionIds: ["opening.card.25", "opening.card.28", "opening.card.30"],
    step21GoCardActionId: "opening.card.31"
  });

  assert.equal(step23Action.state.public.timeline.line, "main");
  assert.equal(step23Action.state.public.timeline.stepIndex, 23);
  assert.equal(step23Action.state.public.timeline.step_index, 23);
  assert.equal(step23Action.state.public.timeline.screenId, "S2");
  assert.equal(step23Action.state.public.timeline.screen_id, "S2");
  assert.equal(step23Action.state.public.timeline.canAdvance, false);
  assert.ok(Number(step23Action.state.public.metrics?.pro ?? 0) <= 40);
  assert.equal(step23Action.state.public.flags.cards["39"]?.locked, true);
  assert.equal(step23Action.state.public.flags.cards["39"]?.available, false);
  assert.equal(step23Action.state.public.flags.cards["3902"]?.available, false);

  const { response: locked39Response, body: locked39Body } = await dispatchAction(
    created.sessionId,
    "step-23-low-pro",
    "opening.card.39"
  );
  assert.equal(locked39Response.status, 400);
  assert.match((locked39Body as { error: string }).error, /guard failed/);

  for (const actionId of ["opening.card.37", "opening.card.38"] as const) {
    const { response, body } = await dispatchAction(created.sessionId, "step-23-low-pro", actionId);
    assert.equal(response.status, 200);
    const action = body as ActionResponse;
    assert.equal(action.state.public.timeline.stepIndex, 23);
    assert.equal(action.state.public.timeline.canAdvance, false);
    assert.equal(action.state.public.flags.cards["39"]?.locked, true);
    assert.equal(action.state.public.flags.cards["39"]?.available, false);
  }

  const { response: thirdCardResponse, body: thirdCardBody } = await dispatchAction(
    created.sessionId,
    "step-23-low-pro",
    "opening.card.40"
  );
  assert.equal(thirdCardResponse.status, 200);
  const thirdCardAction = thirdCardBody as ActionResponse;

  assert.equal(thirdCardAction.state.public.flags.cards["40"]?.selected, true);
  assert.equal(thirdCardAction.state.public.flags.cards["40"]?.resolved, true);
  assert.equal(thirdCardAction.state.public.flags.cards["39"]?.locked, false);
  assert.equal(thirdCardAction.state.public.flags.cards["39"]?.available, true);

  const beforeCard39Time = Number(thirdCardAction.state.public.metrics?.time ?? 0);
  const { response: card39Response, body: card39Body } = await dispatchAction(
    created.sessionId,
    "step-23-low-pro",
    "opening.card.39"
  );
  assert.equal(card39Response.status, 200);
  const card39Action = card39Body as ActionResponse;
  const card39LogEntry = card39Action.state.public.log[card39Action.state.public.log.length - 1] ?? {};

  assert.equal(card39Action.state.public.timeline.stepIndex, 23);
  assert.equal(card39Action.state.public.timeline.canAdvance, true);
  assert.equal(card39Action.state.public.metrics?.time, beforeCard39Time + 1);
  assert.equal(card39Action.state.public.metrics?.score, 60 - (beforeCard39Time + 1));
  assert.equal(card39Action.state.public.flags.cards["39"]?.selected, true);
  assert.equal(card39Action.state.public.flags.cards["39"]?.resolved, true);
  assert.equal(card39Action.state.secret?.opening?.selectedCardId, "39");
  assert.equal(card39LogEntry.actionId, "opening.card.39");
  assert.equal(card39LogEntry.cardId, "39");

  const { response: card39AdvanceResponse, body: card39AdvanceBody } = await dispatchAction(
    created.sessionId,
    "step-23-low-pro",
    "opening.card.39.advance"
  );
  assert.equal(card39AdvanceResponse.status, 200);
  const card39AdvanceAction = card39AdvanceBody as ActionResponse;
  assert.equal(card39AdvanceAction.state.public.timeline.stepIndex, 24);
  assert.equal(card39AdvanceAction.state.public.timeline.step_index, 24);
  assert.equal(card39AdvanceAction.state.public.timeline.screenId, "S1");
  assert.equal(card39AdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(card39AdvanceAction.state.secret?.opening?.selectedCardId, "39");

  const { response: i14AdvanceResponse, body: i14AdvanceBody } = await dispatchAction(
    created.sessionId,
    "step-23-low-pro",
    "opening.info.i14.advance"
  );
  assert.equal(i14AdvanceResponse.status, 200);
  const i14AdvanceAction = i14AdvanceBody as ActionResponse;
  assert.equal(i14AdvanceAction.state.public.timeline.stepIndex, 25);
  assert.equal(i14AdvanceAction.state.public.timeline.step_index, 25);
  assert.equal(i14AdvanceAction.state.public.timeline.screenId, "S1");
  assert.equal(i14AdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(i14AdvanceAction.state.secret?.opening?.selectedCardId, "39");

  const { response: i14_2AdvanceResponse, body: i14_2AdvanceBody } = await dispatchAction(
    created.sessionId,
    "step-23-low-pro",
    "opening.info.i14_2.advance"
  );
  assert.equal(i14_2AdvanceResponse.status, 200);
  const i14_2AdvanceAction = i14_2AdvanceBody as ActionResponse;
  const i14_2AdvanceLogEntry =
    i14_2AdvanceAction.state.public.log[i14_2AdvanceAction.state.public.log.length - 1] ?? {};

  assert.equal(i14_2AdvanceAction.state.public.timeline.stepIndex, 26);
  assert.equal(i14_2AdvanceAction.state.public.timeline.step_index, 26);
  assert.equal(i14_2AdvanceAction.state.public.timeline.screenId, "S2");
  assert.equal(i14_2AdvanceAction.state.public.timeline.screen_id, "S2");
  assert.equal(i14_2AdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(i14_2AdvanceAction.state.secret?.opening?.selectedCardId, "39");
  assert.equal(i14_2AdvanceLogEntry.actionId, "opening.info.i14_2.advance");
  assert.equal(i14_2AdvanceLogEntry.kind, "opening-info-advance");
});

test("POST /actions exposes opening.card.3902 immediately on a high-pro step-23 entry and reaches step 26 with selectedCardId 3902", async () => {
  const created = await createSession({ playerId: "step-23-high-pro" });
  const step23Action = await reachOpeningStep23Boundary(created.sessionId, "step-23-high-pro", {
    teamActions: [
      "opening.team.select.fedya",
      "opening.team.select.zora",
      "opening.team.select.grisha",
      "opening.team.select.aliona",
      "opening.team.select.leo"
    ],
    step17GoCardActionId: "opening.card.22",
    step19CardActionIds: ["opening.card.25", "opening.card.28", "opening.card.30"],
    step21GoCardActionId: "opening.card.31"
  });

  assert.equal(step23Action.state.public.timeline.line, "main");
  assert.equal(step23Action.state.public.timeline.stepIndex, 23);
  assert.ok(Number(step23Action.state.public.metrics?.pro ?? 0) > 40);
  assert.equal(step23Action.state.public.flags.cards["39"]?.locked, true);
  assert.equal(step23Action.state.public.flags.cards["39"]?.available, false);
  assert.equal(step23Action.state.public.flags.cards["3902"]?.locked, false);
  assert.equal(step23Action.state.public.flags.cards["3902"]?.available, true);

  const { response: base39Response, body: base39Body } = await dispatchAction(
    created.sessionId,
    "step-23-high-pro",
    "opening.card.39"
  );
  assert.equal(base39Response.status, 400);
  assert.match((base39Body as { error: string }).error, /guard failed/);

  const beforeCard3902Time = Number(step23Action.state.public.metrics?.time ?? 0);
  const { response: card3902Response, body: card3902Body } = await dispatchAction(
    created.sessionId,
    "step-23-high-pro",
    "opening.card.3902"
  );
  assert.equal(card3902Response.status, 200);
  const card3902Action = card3902Body as ActionResponse;
  const card3902LogEntry = card3902Action.state.public.log[card3902Action.state.public.log.length - 1] ?? {};

  assert.equal(card3902Action.state.public.timeline.stepIndex, 23);
  assert.equal(card3902Action.state.public.timeline.canAdvance, true);
  assert.equal(card3902Action.state.public.metrics?.time, beforeCard3902Time + 1);
  assert.equal(card3902Action.state.public.metrics?.score, 60 - (beforeCard3902Time + 1));
  assert.equal(card3902Action.state.public.flags.cards["3902"]?.selected, true);
  assert.equal(card3902Action.state.public.flags.cards["3902"]?.resolved, true);
  assert.equal(card3902Action.state.secret?.opening?.selectedCardId, "3902");
  assert.equal(card3902LogEntry.actionId, "opening.card.3902");
  assert.equal(card3902LogEntry.cardId, "3902");

  const { response: card3902AdvanceResponse, body: card3902AdvanceBody } = await dispatchAction(
    created.sessionId,
    "step-23-high-pro",
    "opening.card.3902.advance"
  );
  assert.equal(card3902AdvanceResponse.status, 200);
  const card3902AdvanceAction = card3902AdvanceBody as ActionResponse;
  assert.equal(card3902AdvanceAction.state.public.timeline.stepIndex, 24);
  assert.equal(card3902AdvanceAction.state.public.timeline.step_index, 24);
  assert.equal(card3902AdvanceAction.state.public.timeline.screenId, "S1");
  assert.equal(card3902AdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(card3902AdvanceAction.state.secret?.opening?.selectedCardId, "3902");

  const { response: i14AdvanceResponse, body: i14AdvanceBody } = await dispatchAction(
    created.sessionId,
    "step-23-high-pro",
    "opening.info.i14.advance"
  );
  assert.equal(i14AdvanceResponse.status, 200);
  const i14AdvanceAction = i14AdvanceBody as ActionResponse;
  assert.equal(i14AdvanceAction.state.public.timeline.stepIndex, 25);
  assert.equal(i14AdvanceAction.state.public.timeline.step_index, 25);
  assert.equal(i14AdvanceAction.state.public.timeline.screenId, "S1");
  assert.equal(i14AdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(i14AdvanceAction.state.secret?.opening?.selectedCardId, "3902");

  const { response: i14_2AdvanceResponse, body: i14_2AdvanceBody } = await dispatchAction(
    created.sessionId,
    "step-23-high-pro",
    "opening.info.i14_2.advance"
  );
  assert.equal(i14_2AdvanceResponse.status, 200);
  const i14_2AdvanceAction = i14_2AdvanceBody as ActionResponse;
  assert.equal(i14_2AdvanceAction.state.public.timeline.stepIndex, 26);
  assert.equal(i14_2AdvanceAction.state.public.timeline.step_index, 26);
  assert.equal(i14_2AdvanceAction.state.public.timeline.screenId, "S2");
  assert.equal(i14_2AdvanceAction.state.public.timeline.screen_id, "S2");
  assert.equal(i14_2AdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(i14_2AdvanceAction.state.secret?.opening?.selectedCardId, "3902");
});

test("POST /actions keeps canAdvance false for non-go opening.card.44 on the step-26 public communication board", async () => {
  const created = await createSession({ playerId: "step-26-non-go" });
  const step26Action = await reachOpeningStep26Boundary(created.sessionId, "step-26-non-go");

  assert.equal(step26Action.state.public.timeline.stepIndex, 26);
  assert.equal(step26Action.state.public.timeline.step_index, 26);
  assert.equal(step26Action.state.public.timeline.screenId, "S2");
  assert.equal(step26Action.state.public.timeline.canAdvance, false);

  const previousTime = Number(step26Action.state.public.metrics?.time ?? 0);
  const previousRep = Number(step26Action.state.public.metrics?.rep ?? 0);

  const { response: card44Response, body: card44Body } = await dispatchAction(
    created.sessionId,
    "step-26-non-go",
    "opening.card.44"
  );
  assert.equal(card44Response.status, 200);
  const card44Action = card44Body as ActionResponse;
  const card44LogEntry = card44Action.state.public.log[card44Action.state.public.log.length - 1] ?? {};

  assert.equal(card44Action.state.public.timeline.stepIndex, 26);
  assert.equal(card44Action.state.public.timeline.canAdvance, false);
  assert.equal(card44Action.state.public.metrics?.time, previousTime + 1);
  assert.equal(card44Action.state.public.metrics?.rep, previousRep < 15 ? previousRep - 8 : previousRep - 3);
  assert.equal(card44Action.state.public.flags.cards["44"]?.selected, true);
  assert.equal(card44Action.state.public.flags.cards["44"]?.resolved, true);
  assert.equal(card44Action.state.secret?.opening?.selectedCardId, "3902");
  assert.equal(card44LogEntry.actionId, "opening.card.44");
  assert.equal(card44LogEntry.cardId, "44");
});

test("POST /actions resolves opening.card.48 with its bounded rep hook and reaches step 28 through i15", async () => {
  const created = await createSession({ playerId: "step-26-go" });
  const step26Action = await reachOpeningStep26Boundary(created.sessionId, "step-26-go");

  assert.equal(step26Action.state.public.timeline.stepIndex, 26);
  assert.equal(step26Action.state.secret?.opening?.selectedCardId, "3902");

  const previousRep = Number(step26Action.state.public.metrics?.rep ?? 0);
  const previousTime = Number(step26Action.state.public.metrics?.time ?? 0);
  const previousCont = Number(step26Action.state.public.metrics?.cont ?? 0);

  const { response: card48Response, body: card48Body } = await dispatchAction(
    created.sessionId,
    "step-26-go",
    "opening.card.48"
  );
  assert.equal(card48Response.status, 200);
  const card48Action = card48Body as ActionResponse;
  const card48LogEntry = card48Action.state.public.log[card48Action.state.public.log.length - 1] ?? {};

  assert.equal(card48Action.state.public.timeline.stepIndex, 26);
  assert.equal(card48Action.state.public.timeline.canAdvance, true);
  assert.equal(card48Action.state.public.metrics?.cont, previousCont - 5);
  assert.equal(card48Action.state.public.metrics?.rep, previousRep < 15 ? previousRep - 5 : previousRep);
  assert.equal(card48Action.state.public.metrics?.time, previousTime + 2);
  assert.equal(card48Action.state.public.flags.cards["48"]?.selected, true);
  assert.equal(card48Action.state.public.flags.cards["48"]?.resolved, true);
  assert.equal(card48Action.state.secret?.opening?.selectedCardId, "48");
  assert.equal(card48LogEntry.actionId, "opening.card.48");
  assert.equal(card48LogEntry.cardId, "48");

  const { response: card48AdvanceResponse, body: card48AdvanceBody } = await dispatchAction(
    created.sessionId,
    "step-26-go",
    "opening.card.48.advance"
  );
  assert.equal(card48AdvanceResponse.status, 200);
  const card48AdvanceAction = card48AdvanceBody as ActionResponse;

  assert.equal(card48AdvanceAction.state.public.timeline.stepIndex, 27);
  assert.equal(card48AdvanceAction.state.public.timeline.step_index, 27);
  assert.equal(card48AdvanceAction.state.public.timeline.screenId, "S1");
  assert.equal(card48AdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(card48AdvanceAction.state.secret?.opening?.selectedCardId, "48");

  const { response: i15AdvanceResponse, body: i15AdvanceBody } = await dispatchAction(
    created.sessionId,
    "step-26-go",
    "opening.info.i15.advance"
  );
  assert.equal(i15AdvanceResponse.status, 200);
  const i15AdvanceAction = i15AdvanceBody as ActionResponse;
  const i15AdvanceLogEntry = i15AdvanceAction.state.public.log[i15AdvanceAction.state.public.log.length - 1] ?? {};

  assert.equal(i15AdvanceAction.state.public.timeline.stepIndex, 28);
  assert.equal(i15AdvanceAction.state.public.timeline.step_index, 28);
  assert.equal(i15AdvanceAction.state.public.timeline.screenId, "S2");
  assert.equal(i15AdvanceAction.state.public.timeline.screen_id, "S2");
  assert.equal(i15AdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(i15AdvanceAction.state.secret?.opening?.selectedCardId, "48");
  assert.equal(i15AdvanceLogEntry.actionId, "opening.info.i15.advance");
  assert.equal(i15AdvanceLogEntry.kind, "opening-info-advance");
});

test("POST /actions resolves opening.card.49 with its bounded cont hook and reaches step 30 through i16", async () => {
  const created = await createSession({ playerId: "step-28-go" });
  const step28Action = await reachOpeningStep28Boundary(created.sessionId, "step-28-go");

  assert.equal(step28Action.state.public.timeline.stepIndex, 28);
  assert.equal(step28Action.state.public.timeline.step_index, 28);
  assert.equal(step28Action.state.public.timeline.screenId, "S2");
  assert.equal(step28Action.state.public.timeline.canAdvance, false);

  const previousCont = Number(step28Action.state.public.metrics?.cont ?? 0);
  const previousRep = Number(step28Action.state.public.metrics?.rep ?? 0);
  const previousConstr = Number(step28Action.state.public.metrics?.constr ?? 0);
  const previousTime = Number(step28Action.state.public.metrics?.time ?? 0);

  const { response: card49Response, body: card49Body } = await dispatchAction(
    created.sessionId,
    "step-28-go",
    "opening.card.49"
  );
  assert.equal(card49Response.status, 200);
  const card49Action = card49Body as ActionResponse;
  const card49LogEntry = card49Action.state.public.log[card49Action.state.public.log.length - 1] ?? {};

  assert.equal(card49Action.state.public.timeline.stepIndex, 28);
  assert.equal(card49Action.state.public.timeline.canAdvance, true);
  assert.equal(card49Action.state.public.metrics?.rep, previousRep + 2);
  assert.equal(card49Action.state.public.metrics?.constr, previousConstr + 1);
  assert.equal(card49Action.state.public.metrics?.time, previousTime + (previousCont < 10 ? 4 : 2));
  assert.equal(card49Action.state.public.flags.cards["49"]?.selected, true);
  assert.equal(card49Action.state.public.flags.cards["49"]?.resolved, true);
  assert.equal(card49Action.state.secret?.opening?.selectedCardId, "49");
  assert.equal(card49LogEntry.actionId, "opening.card.49");
  assert.equal(card49LogEntry.cardId, "49");

  const { response: card49AdvanceResponse, body: card49AdvanceBody } = await dispatchAction(
    created.sessionId,
    "step-28-go",
    "opening.card.49.advance"
  );
  assert.equal(card49AdvanceResponse.status, 200);
  const card49AdvanceAction = card49AdvanceBody as ActionResponse;

  assert.equal(card49AdvanceAction.state.public.timeline.stepIndex, 29);
  assert.equal(card49AdvanceAction.state.public.timeline.step_index, 29);
  assert.equal(card49AdvanceAction.state.public.timeline.screenId, "S1");
  assert.equal(card49AdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(card49AdvanceAction.state.secret?.opening?.selectedCardId, "49");

  const { response: i16AdvanceResponse, body: i16AdvanceBody } = await dispatchAction(
    created.sessionId,
    "step-28-go",
    "opening.info.i16.advance"
  );
  assert.equal(i16AdvanceResponse.status, 200);
  const i16AdvanceAction = i16AdvanceBody as ActionResponse;
  const i16AdvanceLogEntry = i16AdvanceAction.state.public.log[i16AdvanceAction.state.public.log.length - 1] ?? {};

  assert.equal(i16AdvanceAction.state.public.timeline.stepIndex, 30);
  assert.equal(i16AdvanceAction.state.public.timeline.step_index, 30);
  assert.equal(i16AdvanceAction.state.public.timeline.screenId, "S2");
  assert.equal(i16AdvanceAction.state.public.timeline.screen_id, "S2");
  assert.equal(i16AdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(i16AdvanceAction.state.secret?.opening?.selectedCardId, "49");
  assert.equal(i16AdvanceLogEntry.actionId, "opening.info.i16.advance");
  assert.equal(i16AdvanceLogEntry.kind, "opening-info-advance");
});

test("POST /actions keeps canAdvance false for non-go opening.card.56 on the step-30 acceleration board", async () => {
  const created = await createSession({ playerId: "step-30-non-go" });
  const step30Action = await reachOpeningStep30Boundary(created.sessionId, "step-30-non-go");

  assert.equal(step30Action.state.public.timeline.stepIndex, 30);
  assert.equal(step30Action.state.public.timeline.step_index, 30);
  assert.equal(step30Action.state.public.timeline.screenId, "S2");
  assert.equal(step30Action.state.public.timeline.canAdvance, false);

  const previousMan = Number(step30Action.state.public.metrics?.man ?? 0);
  const previousConstr = Number(step30Action.state.public.metrics?.constr ?? 0);
  const previousTime = Number(step30Action.state.public.metrics?.time ?? 0);

  const { response: card56Response, body: card56Body } = await dispatchAction(
    created.sessionId,
    "step-30-non-go",
    "opening.card.56"
  );
  assert.equal(card56Response.status, 200);
  const card56Action = card56Body as ActionResponse;
  const card56LogEntry = card56Action.state.public.log[card56Action.state.public.log.length - 1] ?? {};

  assert.equal(card56Action.state.public.timeline.stepIndex, 30);
  assert.equal(card56Action.state.public.timeline.canAdvance, false);
  assert.equal(card56Action.state.public.metrics?.man, previousMan + 2);
  assert.equal(card56Action.state.public.metrics?.constr, previousConstr + 2);
  assert.equal(card56Action.state.public.metrics?.time, previousTime + 1);
  assert.equal(card56Action.state.public.flags.cards["56"]?.selected, true);
  assert.equal(card56Action.state.public.flags.cards["56"]?.resolved, true);
  assert.equal(card56Action.state.secret?.opening?.selectedCardId, "49");
  assert.equal(card56LogEntry.actionId, "opening.card.56");
  assert.equal(card56LogEntry.cardId, "56");
});

test("POST /actions resolves opening.card.60 with bounded time gates and reaches step 32 through i17", async () => {
  const created = await createSession({ playerId: "step-30-go" });
  const step30Action = await reachOpeningStep30Boundary(created.sessionId, "step-30-go");

  assert.equal(step30Action.state.public.timeline.stepIndex, 30);
  assert.equal(step30Action.state.secret?.opening?.selectedCardId, "49");

  const previousRep = Number(step30Action.state.public.metrics?.rep ?? 0);
  const previousMan = Number(step30Action.state.public.metrics?.man ?? 0);
  const previousStat = Number(step30Action.state.public.metrics?.stat ?? 0);
  const previousPro = Number(step30Action.state.public.metrics?.pro ?? 0);
  const previousConstr = Number(step30Action.state.public.metrics?.constr ?? 0);
  const previousTime = Number(step30Action.state.public.metrics?.time ?? 0);
  let extraTime = 0;
  if (previousRep < 25) {
    extraTime += 1;
  }
  if (previousMan < 20) {
    extraTime += 1;
  }
  if (previousStat < 25) {
    extraTime += 1;
  }

  const { response: card60Response, body: card60Body } = await dispatchAction(
    created.sessionId,
    "step-30-go",
    "opening.card.60"
  );
  assert.equal(card60Response.status, 200);
  const card60Action = card60Body as ActionResponse;
  const card60LogEntry = card60Action.state.public.log[card60Action.state.public.log.length - 1] ?? {};

  assert.equal(card60Action.state.public.timeline.stepIndex, 30);
  assert.equal(card60Action.state.public.timeline.canAdvance, true);
  assert.equal(card60Action.state.public.metrics?.pro, previousPro + 20);
  assert.equal(card60Action.state.public.metrics?.rep, previousRep + 1);
  assert.equal(card60Action.state.public.metrics?.constr, previousConstr + 2);
  assert.equal(card60Action.state.public.metrics?.time, previousTime + 2 + extraTime);
  assert.equal(card60Action.state.public.flags.cards["60"]?.selected, true);
  assert.equal(card60Action.state.public.flags.cards["60"]?.resolved, true);
  assert.equal(card60Action.state.secret?.opening?.selectedCardId, "60");
  assert.equal(card60LogEntry.actionId, "opening.card.60");
  assert.equal(card60LogEntry.cardId, "60");

  const { response: card60AdvanceResponse, body: card60AdvanceBody } = await dispatchAction(
    created.sessionId,
    "step-30-go",
    "opening.card.60.advance"
  );
  assert.equal(card60AdvanceResponse.status, 200);
  const card60AdvanceAction = card60AdvanceBody as ActionResponse;

  assert.equal(card60AdvanceAction.state.public.timeline.stepIndex, 31);
  assert.equal(card60AdvanceAction.state.public.timeline.step_index, 31);
  assert.equal(card60AdvanceAction.state.public.timeline.screenId, "S1");
  assert.equal(card60AdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(card60AdvanceAction.state.secret?.opening?.selectedCardId, "60");

  const { response: i17AdvanceResponse, body: i17AdvanceBody } = await dispatchAction(
    created.sessionId,
    "step-30-go",
    "opening.info.i17.advance"
  );
  assert.equal(i17AdvanceResponse.status, 200);
  const i17AdvanceAction = i17AdvanceBody as ActionResponse;
  const i17AdvanceLogEntry = i17AdvanceAction.state.public.log[i17AdvanceAction.state.public.log.length - 1] ?? {};

  assert.equal(i17AdvanceAction.state.public.timeline.stepIndex, 32);
  assert.equal(i17AdvanceAction.state.public.timeline.step_index, 32);
  assert.equal(i17AdvanceAction.state.public.timeline.screenId, "S2");
  assert.equal(i17AdvanceAction.state.public.timeline.screen_id, "S2");
  assert.equal(i17AdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(i17AdvanceAction.state.secret?.opening?.selectedCardId, "60");
  assert.equal(i17AdvanceLogEntry.actionId, "opening.info.i17.advance");
  assert.equal(i17AdvanceLogEntry.kind, "opening-info-advance");
});

test("POST /actions unlocks opening.card.66 after opening.card.62 on the step-32 scout dispatch board", async () => {
  const created = await createSession({ playerId: "step-32-unlock" });
  const step32Action = await reachOpeningStep32Boundary(created.sessionId, "step-32-unlock");

  assert.equal(step32Action.state.public.timeline.stepIndex, 32);
  assert.equal(step32Action.state.public.timeline.step_index, 32);
  assert.equal(step32Action.state.public.timeline.screenId, "S2");
  assert.equal(step32Action.state.public.timeline.canAdvance, false);
  assert.equal(step32Action.state.secret?.opening?.selectedCardId, "60");
  assert.equal(step32Action.state.public.flags.cards["66"]?.locked, true);
  assert.equal(step32Action.state.public.flags.cards["66"]?.available, false);

  const previousTime = Number(step32Action.state.public.metrics?.time ?? 0);

  const { response: card62Response, body: card62Body } = await dispatchAction(
    created.sessionId,
    "step-32-unlock",
    "opening.card.62"
  );
  assert.equal(card62Response.status, 200);
  const card62Action = card62Body as ActionResponse;
  const card62LogEntry = card62Action.state.public.log[card62Action.state.public.log.length - 1] ?? {};

  assert.equal(card62Action.state.public.timeline.stepIndex, 32);
  assert.equal(card62Action.state.public.timeline.canAdvance, false);
  assert.equal(card62Action.state.public.metrics?.time, previousTime + 1);
  assert.equal(card62Action.state.public.flags.cards["62"]?.selected, true);
  assert.equal(card62Action.state.public.flags.cards["62"]?.resolved, true);
  assert.equal(card62Action.state.public.flags.cards["66"]?.locked, false);
  assert.equal(card62Action.state.public.flags.cards["66"]?.available, true);
  assert.equal(card62Action.state.secret?.opening?.selectedCardId, "60");
  assert.equal(card62LogEntry.actionId, "opening.card.62");
  assert.equal(card62LogEntry.cardId, "62");
});

test("POST /actions resolves opening.card.66 with bounded card-history bonuses and reaches step 34 through i18", async () => {
  const created = await createSession({ playerId: "step-32-go" });
  const step32Action = await reachOpeningStep32Boundary(created.sessionId, "step-32-go");

  assert.equal(step32Action.state.public.timeline.stepIndex, 32);
  assert.equal(step32Action.state.secret?.opening?.selectedCardId, "60");

  const { response: card62Response, body: card62Body } = await dispatchAction(
    created.sessionId,
    "step-32-go",
    "opening.card.62"
  );
  assert.equal(card62Response.status, 200);
  const card62Action = card62Body as ActionResponse;

  const previousTime = Number(card62Action.state.public.metrics?.time ?? 0);
  const previousPro = Number(card62Action.state.public.metrics?.pro ?? 0);
  let extraTime = 0;
  if (previousPro < 60) {
    extraTime += 2;
  }
  if (previousPro < 45) {
    extraTime += 3;
  }
  extraTime += 5;
  extraTime += 5;

  const { response: card66Response, body: card66Body } = await dispatchAction(
    created.sessionId,
    "step-32-go",
    "opening.card.66"
  );
  assert.equal(card66Response.status, 200);
  const card66Action = card66Body as ActionResponse;
  const card66LogEntry = card66Action.state.public.log[card66Action.state.public.log.length - 1] ?? {};

  assert.equal(card66Action.state.public.timeline.stepIndex, 32);
  assert.equal(card66Action.state.public.timeline.canAdvance, true);
  assert.equal(card66Action.state.public.metrics?.time, previousTime + 6 + extraTime);
  assert.equal(card66Action.state.public.flags.cards["66"]?.selected, true);
  assert.equal(card66Action.state.public.flags.cards["66"]?.resolved, true);
  assert.equal(card66Action.state.public.flags.cards["66"]?.locked, false);
  assert.equal(card66Action.state.public.flags.cards["66"]?.available, true);
  assert.equal(card66Action.state.secret?.opening?.selectedCardId, "66");
  assert.equal(card66LogEntry.actionId, "opening.card.66");
  assert.equal(card66LogEntry.cardId, "66");

  const { response: card66AdvanceResponse, body: card66AdvanceBody } = await dispatchAction(
    created.sessionId,
    "step-32-go",
    "opening.card.66.advance"
  );
  assert.equal(card66AdvanceResponse.status, 200);
  const card66AdvanceAction = card66AdvanceBody as ActionResponse;

  assert.equal(card66AdvanceAction.state.public.timeline.stepIndex, 33);
  assert.equal(card66AdvanceAction.state.public.timeline.step_index, 33);
  assert.equal(card66AdvanceAction.state.public.timeline.screenId, "S1");
  assert.equal(card66AdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(card66AdvanceAction.state.secret?.opening?.selectedCardId, "66");

  const { response: i18AdvanceResponse, body: i18AdvanceBody } = await dispatchAction(
    created.sessionId,
    "step-32-go",
    "opening.info.i18.advance"
  );
  assert.equal(i18AdvanceResponse.status, 200);
  const i18AdvanceAction = i18AdvanceBody as ActionResponse;
  const i18AdvanceLogEntry = i18AdvanceAction.state.public.log[i18AdvanceAction.state.public.log.length - 1] ?? {};

  assert.equal(i18AdvanceAction.state.public.timeline.stepIndex, 34);
  assert.equal(i18AdvanceAction.state.public.timeline.step_index, 34);
  assert.equal(i18AdvanceAction.state.public.timeline.screenId, "S2");
  assert.equal(i18AdvanceAction.state.public.timeline.screen_id, "S2");
  assert.equal(i18AdvanceAction.state.public.timeline.canAdvance, false);
  assert.equal(i18AdvanceAction.state.secret?.opening?.selectedCardId, "66");
  assert.equal(i18AdvanceLogEntry.actionId, "opening.info.i18.advance");
  assert.equal(i18AdvanceLogEntry.kind, "opening-info-advance");
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
