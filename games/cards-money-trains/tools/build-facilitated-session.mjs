#!/usr/bin/env node
/**
 * Build the two confirmed learning pauses for «Карты, деньги, поезда».
 *
 * A learning pause is a facilitator-led discussion between ordinary game
 * actions. The reminder is deliberately non-blocking: a due pause is visible
 * while the session remains in `reporting`, and the facilitator may either
 * start it, defer it to the next turn, or continue the game without clicking
 * either action. Starting a pause temporarily moves the session into
 * `methodology-pause`; completing it returns to the same reporting boundary.
 *
 * The complete lifecycle lives in public persisted session state. Runtime
 * therefore resumes the exact reminder or active pause after a restart without
 * asking the browser to reconstruct learning state from turn numbers.
 *
 * Ownership boundary:
 * - this file owns actions and plans prefixed with `methodology.pause.`;
 * - it owns the public `methodology` state subtree and its Mechanics endpoints;
 * - it owns one facilitator flow step and six board action descriptions;
 * - it composes accepted neutral state, number, assertion and event operations;
 * - it does not own reporting advancement, final scoring, timers, meeting
 *   purchases, manual detachment or any platform contract.
 */

import assert from "node:assert/strict";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptFile = fileURLToPath(import.meta.url);
const toolsRoot = path.dirname(scriptFile);
const gameRoot = path.resolve(toolsRoot, "..");
const authoringPath = path.join(gameRoot, "authoring", "game.authoring.json");

const normalFixtureId = "normal-start-policy";
const ownedActionPrefix = "methodology.pause.";
const ownedBoardActionPrefix = "methodology-pause-";
const ownedFlowStepId = "facilitator.methodology-pauses";
const methodologyEventType = "game.methodology-pause-event";
const methodologyEvents = {
  started: "methodology.pause.started",
  deferred: "methodology.pause.deferred",
  completed: "methodology.pause.completed"
};

/**
 * Confirmed questions from slide 47 of the author's presentation.
 *
 * The questions and time boxes are publishable immutable content. The overall
 * final-reflection workflow remains explicitly pending until the author answers
 * the unresolved facilitation questions recorded in project documentation.
 */
const finalReflectionGuide = {
  workflowStatus: "pending-author-answers",
  preparationMinutes: {
    min: 5,
    max: 15
  },
  presentationMinutesMax: 2,
  conclusionCount: {
    min: 2,
    max: 3
  },
  questions: [
    "Какая была стратегия изначально?",
    "К чему нужно было адаптироваться?",
    "К чему удалось адаптироваться? За счет чего?",
    "К чему адаптироваться не удалось? Почему?",
    "Как бы вы оценили результаты игры для вас и для других команд?"
  ]
};

const pauses = [
  {
    key: "first",
    id: "reflection-after-turn-3",
    targetTurn: 3,
    title: "Первая учебная пауза",
    timing:
      "Ориентир автора: около завершения третьего хода; длительность паузы — 15–30 минут, обсуждение команд — около 10 минут.",
    prompts: [
      "Что вы наблюдаете?",
      "Какие изменения происходят?",
      "Какие действия вы предпринимаете?",
      "Какой результат ожидаете?",
      "Что хотите сообщить другим командам?"
    ]
  },
  {
    key: "second",
    id: "reflection-after-turn-5",
    targetTurn: 5,
    title: "Вторая учебная пауза",
    timing:
      "Ориентир автора: около завершения пятого хода; длительность паузы — около 30 минут, обсуждение команд — около 10 минут.",
    prompts: [
      "Какова текущая ситуация?",
      "С какими вызовами вы столкнулись?",
      "Какие стратегии используют другие команды?",
      "Какова ваша собственная стратегия?",
      "Какой результат ожидаете?",
      "Что хотите сообщить другим командам?"
    ],
    prerequisiteKey: "first"
  }
];

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));
const literal = (value) => ({ op: "value.literal", value });
const state = (endpoint) => ({ op: "value.state", ref: { endpoint } });
const compare = (operator, left, right) => ({
  op: "predicate.compare",
  operator,
  left,
  right
});
const all = (...items) => ({ op: "predicate.all", items });
const noParamsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
  required: []
};

const statusEndpoint = (pause) =>
  `public.methodology.pauses.${pause.key}.status`;
const dueTurnEndpoint = (pause) =>
  `public.methodology.pauses.${pause.key}.dueTurn`;

/** Create one facilitator-only Game Intent backed by an existing Mechanics plan. */
const action = ({ id, label, semantics }) => ({
  id,
  _type: "game.Action",
  _label: label,
  _semantics: semantics,
  capabilityFamily: "runtime.server",
  capability: id,
  displayName: label,
  allowedSessionRoles: ["facilitator"],
  paramsSchema: noParamsSchema,
  binding: {
    kind: "mechanics-plan",
    planRef: id
  }
});

/** Guard a due reminder without blocking the ordinary reporting transition. */
const dueGuard = (pause) => all(
  compare("eq", state("public.session.fixtureId"), literal(normalFixtureId)),
  compare("eq", state("public.session.status"), literal("running")),
  compare("eq", state("public.session.phase"), literal("reporting")),
  compare(
    "eq",
    state("public.session.finishConfirmationPending"),
    literal(false)
  ),
  compare("eq", state(statusEndpoint(pause)), literal("scheduled")),
  compare(
    "gte",
    state("public.session.turnNumber"),
    state(dueTurnEndpoint(pause))
  ),
  ...(pause.prerequisiteKey
    ? [compare(
      "eq",
      state(`public.methodology.pauses.${pause.prerequisiteKey}.status`),
      literal("completed")
    )]
    : [])
);

/**
 * Allow the facilitator to start a scheduled pause before its reminder turn.
 *
 * The author describes turns three and five as orientation points rather than
 * hard gates. Deferral still requires a due reminder, while an early start is
 * a deliberate facilitator choice at the same safe reporting boundary.
 */
const startGuard = (pause) => all(
  compare("eq", state("public.session.fixtureId"), literal(normalFixtureId)),
  compare("eq", state("public.session.status"), literal("running")),
  compare("eq", state("public.session.phase"), literal("reporting")),
  compare(
    "eq",
    state("public.session.finishConfirmationPending"),
    literal(false)
  ),
  compare("eq", state(statusEndpoint(pause)), literal("scheduled")),
  ...(pause.prerequisiteKey
    ? [compare(
      "eq",
      state(`public.methodology.pauses.${pause.prerequisiteKey}.status`),
      literal("completed")
    )]
    : [])
);

/** Emit one concise public journal record for the facilitator and later review. */
const eventStep = ({ id, eventType, summary, pause }) => ({
  id,
  kind: "command",
  op: "core.event.emit",
  eventType,
  summary: literal(summary),
  audience: "public",
  data: {
    kind: literal("methodology"),
    pauseId: literal(pause.id),
    turnNumber: state("public.session.turnNumber"),
    dueTurn: state(dueTurnEndpoint(pause))
  }
});

/**
 * Start one scheduled pause and preserve the exact return boundary in state.
 *
 * The return phase is intentionally fixed to `reporting`: the accepted game
 * design permits these two pauses only at that atomically safe boundary.
 */
const buildStart = (pause) => {
  const id = `${ownedActionPrefix}${pause.key}.start`;
  return {
    action: action({
      id,
      label: `Начать: ${pause.title.toLowerCase()}`,
      semantics:
        "Начинает подтверждённую учебную паузу в безопасной отчётной фазе; ведущий может начать её раньше сохранённого хода напоминания."
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: startGuard(pause),
            errorCode: "METHODOLOGY_PAUSE_START_UNAVAILABLE"
          },
          {
            id: "start-pause",
            kind: "command",
            op: "core.state.patch",
            patches: [
              {
                operation: "set",
                target: { endpoint: statusEndpoint(pause) },
                value: literal("active")
              },
              {
                operation: "set",
                target: { endpoint: "public.methodology.activePauseId" },
                value: literal(pause.id)
              },
              {
                operation: "set",
                target: { endpoint: "public.session.phase" },
                value: literal("methodology-pause")
              }
            ]
          },
          eventStep({
            id: "journal",
            eventType: methodologyEvents.started,
            summary: `Ведущий начал учебную паузу «${pause.title}»`,
            pause
          })
        ]
      }
    }
  };
};

/**
 * Move a due reminder to the next numbered turn.
 *
 * The endpoint is first aligned with the current turn and then incremented.
 * This matters when a reminder was ignored for several turns: “next turn”
 * still means the turn after the facilitator's current decision, not merely
 * the original due turn plus one.
 */
const buildDefer = (pause) => {
  const id = `${ownedActionPrefix}${pause.key}.defer`;
  return {
    action: action({
      id,
      label: `Перенести: ${pause.title.toLowerCase()}`,
      semantics:
        "Оставляет игру в отчётной фазе и переносит сохранённое напоминание ровно на следующий номер хода."
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: dueGuard(pause),
            errorCode: "METHODOLOGY_PAUSE_DEFER_UNAVAILABLE"
          },
          {
            id: "align-due-turn",
            kind: "command",
            op: "core.state.patch",
            patches: [{
              operation: "set",
              target: { endpoint: dueTurnEndpoint(pause) },
              value: state("public.session.turnNumber")
            }]
          },
          {
            id: "defer-to-next-turn",
            kind: "command",
            op: "core.number.add",
            target: { endpoint: dueTurnEndpoint(pause) },
            delta: literal(1)
          },
          eventStep({
            id: "journal",
            eventType: methodologyEvents.deferred,
            summary: `Ведущий перенёс учебную паузу «${pause.title}» на следующий ход`,
            pause
          })
        ]
      }
    }
  };
};

/** Complete the active pause and resume the reporting boundary atomically. */
const buildComplete = (pause) => {
  const id = `${ownedActionPrefix}${pause.key}.complete`;
  return {
    action: action({
      id,
      label: `Завершить: ${pause.title.toLowerCase()}`,
      semantics:
        "Помечает текущую учебную паузу завершённой и возвращает ведущего к отчёту того же хода."
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: all(
              compare(
                "eq",
                state("public.session.fixtureId"),
                literal(normalFixtureId)
              ),
              compare("eq", state("public.session.status"), literal("running")),
              compare(
                "eq",
                state("public.session.phase"),
                literal("methodology-pause")
              ),
              compare(
                "eq",
                state("public.session.finishConfirmationPending"),
                literal(false)
              ),
              compare(
                "eq",
                state("public.methodology.activePauseId"),
                literal(pause.id)
              ),
              compare("eq", state(statusEndpoint(pause)), literal("active"))
            ),
            errorCode: "METHODOLOGY_PAUSE_COMPLETE_UNAVAILABLE"
          },
          {
            id: "complete-pause",
            kind: "command",
            op: "core.state.patch",
            patches: [
              {
                operation: "set",
                target: { endpoint: statusEndpoint(pause) },
                value: literal("completed")
              },
              {
                operation: "set",
                target: { endpoint: "public.methodology.activePauseId" },
                value: literal(null)
              },
              {
                operation: "set",
                target: { endpoint: "public.session.phase" },
                value: literal("reporting")
              }
            ]
          },
          eventStep({
            id: "journal",
            eventType: methodologyEvents.completed,
            summary: `Ведущий завершил учебную паузу «${pause.title}»`,
            pause
          })
        ]
      }
    }
  };
};

/** Declare only the mutable public fields; prompt text remains immutable content. */
const declareState = (root) => {
  root.state.public.methodology = {
    activePauseId: null,
    pauses: Object.fromEntries(pauses.map((pause) => [pause.key, {
      id: pause.id,
      title: pause.title,
      timing: pause.timing,
      prompts: [...pause.prompts],
      status: "scheduled",
      dueTurn: pause.targetTurn
    }]))
  };

  const generatedEndpoints = {
    "public.methodology.activePauseId": {
      audienceRef: "public",
      storage: {
        root: "public",
        segments: ["methodology", "activePauseId"]
      },
      valueType: "core.optional-string",
      access: "read-write"
    }
  };
  for (const pause of pauses) {
    generatedEndpoints[statusEndpoint(pause)] = {
      audienceRef: "public",
      storage: {
        root: "public",
        segments: ["methodology", "pauses", pause.key, "status"]
      },
      valueType: "core.string",
      access: "read-write"
    };
    generatedEndpoints[dueTurnEndpoint(pause)] = {
      audienceRef: "public",
      storage: {
        root: "public",
        segments: ["methodology", "pauses", pause.key, "dueTurn"]
      },
      valueType: "core.integer",
      access: "read-write"
    };
  }

  /*
   * The card generator intentionally deletes and re-adds its one bounded
   * terminal endpoint, placing it last. Insert our stable endpoints immediately
   * before that boundary so both independent generators serialize to the same
   * canonical key order and every `--check` remains valid.
   */
  const terminalRemainingEndpoint = "public.cards.cargo.remaining.bound";
  const ownedEndpointIds = new Set(Object.keys(generatedEndpoints));
  const preservedEndpoints = Object.entries(
    root.mechanics.stateModel.endpoints
  ).filter(([endpointId]) => !ownedEndpointIds.has(endpointId));
  const terminalRemainingIndex = preservedEndpoints.findIndex(
    ([endpointId]) => endpointId === terminalRemainingEndpoint
  );
  const insertionIndex =
    terminalRemainingIndex === -1
      ? preservedEndpoints.length
      : terminalRemainingIndex;
  root.mechanics.stateModel.endpoints = Object.fromEntries([
    ...preservedEndpoints.slice(0, insertionIndex),
    ...Object.entries(generatedEndpoints),
    ...preservedEndpoints.slice(insertionIndex)
  ]);
};

/** Register stable public event shapes for journaling and future reflection export. */
const declareEvents = (stateModel) => {
  stateModel.types[methodologyEventType] = {
    kind: "record",
    fields: {
      kind: { typeRef: "core.string", optional: false },
      pauseId: { typeRef: "core.string", optional: false },
      turnNumber: { typeRef: "core.integer", optional: false },
      dueTurn: { typeRef: "core.integer", optional: false }
    }
  };
  for (const eventType of Object.values(methodologyEvents)) {
    stateModel.events[eventType] = {
      audienceRef: "public",
      payloadType: methodologyEventType,
      journalEndpoint: { endpoint: "public.log" }
    };
  }
};

const promptDescription = (pause) =>
  `${pause.timing} Вопросы: ${pause.prompts.join(" ")}`;

/** Publish controls and exact author prompts through the ordinary accessible UI. */
const boardActions = () => pauses.flatMap((pause) => [
  {
    id: `${ownedBoardActionPrefix}${pause.key}-start`,
    label: `Начать: ${pause.title}`,
    description: promptDescription(pause),
    actionId: `${ownedActionPrefix}${pause.key}.start`,
    phase: "reporting",
    section: "methodology",
    disabledReason:
      "Старт доступен в отчётной фазе, пока пауза не завершена; перед второй паузой нужно завершить первую."
  },
  {
    id: `${ownedBoardActionPrefix}${pause.key}-defer`,
    label: `Перенести до следующего хода: ${pause.title}`,
    description:
      "Напоминание останется в сохранённом состоянии и снова станет доступно в отчёте следующего хода.",
    actionId: `${ownedActionPrefix}${pause.key}.defer`,
    phase: "reporting",
    section: "methodology",
    disabledReason:
      "Перенос доступен только для наступившего напоминания в отчётной фазе."
  },
  {
    id: `${ownedBoardActionPrefix}${pause.key}-complete`,
    label: `Завершить: ${pause.title}`,
    description: promptDescription(pause),
    actionId: `${ownedActionPrefix}${pause.key}.complete`,
    phase: "methodology-pause",
    section: "methodology",
    disabledReason:
      "Завершение доступно только пока эта учебная пауза активна."
  }
]);

/** Apply the game-local pause lifecycle without touching platform contracts. */
const buildFacilitatedSessionAuthoring = (sourceAuthoring) => {
  const authoring = structuredClone(sourceAuthoring);
  const root = authoring.root;
  assert.ok(root.mechanics?.stateModel, "Mechanics state model is required");
  assert.ok(root.state?.public?.session, "public session state is required");

  declareState(root);
  declareEvents(root.mechanics.stateModel);

  const generated = pauses.flatMap((pause) => [
    buildStart(pause),
    buildDefer(pause),
    buildComplete(pause)
  ]);

  const preservedActions = root.logic.actions.filter(
    (candidate) => !candidate.id.startsWith(ownedActionPrefix)
  );
  /*
   * Setup and operating-turn regeneration each insert their owned block before
   * the next lifecycle. Keep methodology before setup itself so all three
   * independent generators converge on one serialization order regardless of
   * which one ran last.
   */
  const setupActionIndex = preservedActions.findIndex(
    (candidate) => candidate.id.startsWith("session.setup.")
  );
  const actionInsertionIndex =
    setupActionIndex === -1 ? preservedActions.length : setupActionIndex;
  root.logic.actions = [
    ...preservedActions.slice(0, actionInsertionIndex),
    ...generated.map((item) => item.action),
    ...preservedActions.slice(actionInsertionIndex)
  ];

  const preservedPlans = Object.entries(root.mechanics.plans).filter(
    ([planId]) => !planId.startsWith(ownedActionPrefix)
  );
  const setupPlanIndex = preservedPlans.findIndex(
    ([planId]) => planId.startsWith("session.setup.")
  );
  const planInsertionIndex =
    setupPlanIndex === -1 ? preservedPlans.length : setupPlanIndex;
  root.mechanics.plans = Object.fromEntries([
    ...preservedPlans.slice(0, planInsertionIndex),
    ...generated.map((item) => [item.action.id, item.plan]),
    ...preservedPlans.slice(planInsertionIndex)
  ]);

  const availableActions = root.state.public.board?.availableActions;
  assert.ok(Array.isArray(availableActions), "public board actions are required");
  const preservedBoardActions = availableActions.filter(
    (candidate) => !candidate.id.startsWith(ownedBoardActionPrefix)
  );
  /*
   * Keep the whole learning-pause group before the market group. Anchoring to
   * the first market action, rather than only to the phase-finish action,
   * prevents the operating-turn generator from moving newly added purchase
   * actions across the pause group on the next deterministic rebuild.
   */
  const marketBoardIndex = preservedBoardActions.findIndex(
    (candidate) => candidate.actionId?.startsWith("market.")
  );
  const boardInsertionIndex =
    marketBoardIndex === -1
      ? preservedBoardActions.length
      : marketBoardIndex;
  root.state.public.board.availableActions = [
    ...preservedBoardActions.slice(0, boardInsertionIndex),
    ...boardActions(),
    ...preservedBoardActions.slice(boardInsertionIndex)
  ];

  const facilitatorFlow = root.logic.flows.find(
    (flow) => flow.id === "facilitator"
  );
  assert.ok(facilitatorFlow, "facilitator flow is required");
  const preservedSteps = facilitatorFlow.steps.filter(
    (step) => step.id !== ownedFlowStepId
  );
  const reportingStepIndex = preservedSteps.findIndex(
    (step) => step.id === "facilitator.reporting-boundary"
  );
  const flowInsertionIndex =
    reportingStepIndex === -1 ? preservedSteps.length : reportingStepIndex + 1;
  facilitatorFlow.steps = [
    ...preservedSteps.slice(0, flowInsertionIndex),
    {
      id: ownedFlowStepId,
      _type: "game.Step",
      _label: "Учебные паузы",
      _semantics:
        "Ведущий видит две сохраняемые методические точки, может начать или перенести наступившую паузу и возвращается к отчёту после её завершения.",
      screenId: "facilitator",
      actionIds: [
        ...generated.map((item) => item.action.id),
        "session.finish.request",
        "session.finish.confirm",
        "session.finish.cancel"
      ]
    },
    ...preservedSteps.slice(flowInsertionIndex)
  ];

  root.content.data.facilitatedSession = {
    status: "executable-two-pause-lifecycle",
    publishable: false,
    reminderBehavior: "non-blocking-persisted-due-turn",
    startCanPrecedeReminder: true,
    pausePhase: "methodology-pause",
    returnPhase: "reporting",
    serverTimer: false,
    permanentSkip: false,
    pauses: Object.fromEntries(pauses.map((pause) => [pause.id, {
      targetTurn: pause.targetTurn,
      timing: pause.timing,
      prompts: [...pause.prompts],
      ...(pause.prerequisiteKey
        ? { requiresCompletedPause: pauses.find(
          (candidate) => candidate.key === pause.prerequisiteKey
        )?.id }
        : {})
    }])),
    finalReflectionGuide: structuredClone(finalReflectionGuide)
  };

  return authoring;
};

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** Build from the checked-in authoring source for CLI and focused tests. */
const buildFromDisk = async () =>
  buildFacilitatedSessionAuthoring(await readJson(authoringPath));

/** Replace the generated document atomically so interruption cannot truncate it. */
const writeAtomically = async (filePath, content) => {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
};

/** Execute the deterministic build or compare it with the checked-in source. */
const run = async (argv) => {
  const checkOnly = argv.length === 1 && argv[0] === "--check";
  if (argv.length > (checkOnly ? 1 : 0)) {
    throw new Error("usage: build-facilitated-session.mjs [--check]");
  }
  const sourceText = await readFile(authoringPath, "utf8");
  const builtText = serialize(await buildFromDisk());
  if (checkOnly) {
    assert.equal(
      sourceText,
      builtText,
      "facilitated-session authoring is stale; run build-facilitated-session.mjs"
    );
  } else {
    await writeAtomically(authoringPath, builtText);
  }
  process.stdout.write(
    `cards-money-trains: ${checkOnly ? "verified" : "built"} two persisted learning pauses\n`
  );
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  run(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export {
  authoringPath,
  buildFacilitatedSessionAuthoring,
  buildFromDisk,
  finalReflectionGuide,
  pauses
};
