import assert from "node:assert/strict";
import { test } from "node:test";
import { createDeterministicHandler } from "../src/modules/runtime/deterministicHandlers.ts";
import { validateGameManifest } from "../src/modules/content/manifestValidation.ts";
import type { RuntimeActionContext } from "@cubica/contracts-runtime";
import type { GameManifestActionDefinition, GameManifestTemplateMap } from "@cubica/contracts-manifest";

const manifestWithTemplates = {
  meta: {
    id: "test-game",
    version: "1.0.0",
    name: "Test Game",
    description: "Testing templates",
    author: "Cubica",
    schemaVersion: "1.1"
  },
  config: {
    players: { min: 1, max: 1 },
    settings: { mode: "singleplayer", locale: "ru-RU" }
  },
  state: {
    public: {
      timeline: { line: "main", stepIndex: 0, stageId: "stage_intro", screenId: "S1", canAdvance: false },
      log: [],
      flags: { cards: {} }
    }
  },
  templates: {
    advance_step: {
      handlerType: "manifest-data",
      deterministic: {
        provenance: [{ sourceKind: "test", sourceFile: "test.js", legacyCardId: "t1" }],
        guard: {
          timeline: { line: "main", stepIndex: "{{current}}", canAdvance: false }
        },
        effects: [
          { op: "timeline.set", stepIndex: "{{next}}" },
          { op: "log.append", kind: "test", summary: "{{summary}}" }
        ]
      }
    }
  } satisfies GameManifestTemplateMap,
  actions: {
    "step.1.advance": {
      handlerType: "manifest-template",
      templateId: "advance_step",
      params: {
        current: 0,
        next: 1,
        summary: "Moved to step 1"
      }
    }
  }
};

test("validateGameManifest accepts manifest with templates", () => {
  const manifest = validateGameManifest(manifestWithTemplates);
  assert.ok(manifest.templates);
  assert.ok(manifest.templates.advance_step);
  assert.equal(manifest.actions["step.1.advance"].templateId, "advance_step");
});

test("deterministicHandler resolves template correctly", async () => {
  const handler = createDeterministicHandler("runtime.server", {
    mode: "manifest-action",
    templates: manifestWithTemplates.templates
  });

  const context: RuntimeActionContext<any> = {
    sessionId: "session-1",
    gameId: "test-game",
    actionId: "step.1.advance",
    state: manifestWithTemplates.state,
    now: new Date(),
    manifestAction: {
      actionId: "step.1.advance",
      handlerType: "manifest-template",
      templateId: "advance_step",
      params: {
        current: 0,
        next: 1,
        summary: "Moved to step 1"
      },
      raw: manifestWithTemplates.actions["step.1.advance"]
    }
  };

  const result = await handler(context);

  assert.ok(result.ok, `Action failed: ${result.error?.message}`);
  const nextState = result.delta?.state as any;
  assert.equal(nextState.public.timeline.stepIndex, 1);
  assert.equal(nextState.public.log[0].summary, "Moved to step 1");
});

test("deterministicHandler handles template with deep merge", async () => {
  const templates = {
    base_action: {
      handlerType: "manifest-data",
      deterministic: {
        provenance: [{ sourceKind: "test", sourceFile: "test.js", legacyCardId: "t1" }],
        guard: {},
        effects: [
          { op: "metric.add", metricId: "score", delta: 10 },
          { op: "log.append", kind: "test", summary: "Default summary" },
          { op: "timeline.set", stepIndex: 1 }
        ]
      }
    }
  } satisfies GameManifestTemplateMap;

  const action = {
    handlerType: "manifest-template",
    templateId: "base_action",
    params: {
        summary: "Overridden summary"
    },
    deterministic: {
      effects: [{ op: "metric.add", metricId: "score", delta: 20 }]
    }
  };

  const handler = createDeterministicHandler("runtime.server", {
    mode: "manifest-action",
    templates: templates
  });

  const context: RuntimeActionContext<any> = {
    sessionId: "session-1",
    gameId: "test-game",
    actionId: "test-action",
    state: manifestWithTemplates.state,
    now: new Date(),
    manifestAction: {
      actionId: "test-action",
      handlerType: "manifest-template",
      templateId: "base_action",
      params: {
          summary: "Overridden summary"
      },
      raw: action
    }
  };

  const result = await handler(context);

  assert.ok(result.ok);
  const nextState = result.delta?.state as any;
  assert.equal(nextState.public.metrics.score, 30);
  assert.equal(nextState.public.log[0].summary, "Default summary");
  assert.equal(nextState.public.timeline.stepIndex, 1);
});

test("deterministicHandler resolves template with overrides.deterministic pattern", async () => {
  const templates = {
    "card-resolution": {
      deterministic: {
        guard: {
          timeline: { line: "main", stepIndex: "{{stepIndex}}", canAdvance: false }
        },
        effects: [
          { op: "timeline.set", canAdvance: false },
          { op: "flag.set", path: "/public/flags/cards/{{cardId}}", values: { selected: true, resolved: true } },
          { op: "log.append", kind: "card-resolution", cardId: "{{cardId}}", summary: "{{summary}}" }
        ]
      }
    }
  } satisfies GameManifestTemplateMap;

  const actionDef = {
    handlerType: "manifest-data",
    templateId: "card-resolution",
    capabilityFamily: "test",
    capability: "test.card.1",
    params: { cardId: "1", stepIndex: 5, summary: "Card 1 resolved" },
    overrides: {
      deterministic: {
        guard: {
          card: { id: "1", selected: false, resolved: false }
        },
        effects: [
          { op: "metric.add", metricId: "score", delta: 10 },
          { op: "state.patch", patches: [{ op: "replace", path: "/secret/opening/selectedCardId", value: "1" }] }
        ]
      }
    }
  };

  const handler = createDeterministicHandler("runtime.server", {
    mode: "manifest-action",
    templates
  });

  const context: RuntimeActionContext<any> = {
    sessionId: "session-1",
    gameId: "test-game",
    actionId: "test.card.1",
    state: {
      public: {
        timeline: { line: "main", stepIndex: 5, canAdvance: false },
        log: [],
        flags: { cards: { "1": { selected: false, resolved: false } } }
      }
    },
    now: new Date(),
    manifestAction: {
      actionId: "test.card.1",
      handlerType: "manifest-data",
      templateId: "card-resolution",
      params: actionDef.params,
      raw: actionDef
    }
  };

  const result = await handler(context);

  assert.ok(result.ok, `Action failed: ${result.error?.message}`);
  const nextState = result.delta?.state as any;

  assert.equal(nextState.public.metrics?.score, 10);

  // cardFlags from template applied (cardId resolved from params)
  assert.equal(nextState.public.flags.cards["1"]?.selected, true);
  assert.equal(nextState.public.flags.cards["1"]?.resolved, true);

  // selectedCardId from overrides applied
  assert.equal(nextState.secret?.opening?.selectedCardId, "1");

  // log from template applied (cardId resolved from params)
  assert.equal(nextState.public.log[0].cardId, "1");
  assert.equal(nextState.public.log[0].summary, "Card 1 resolved");
});

test("deterministicHandler concatenates template and action timeline effects", async () => {
  const templates = {
    "timeline-advance": {
      deterministic: {
        guard: {
          timeline: { line: "main", stepIndex: "{{currentStep}}", canAdvance: true }
        },
        effects: [
          {
            op: "timeline.set",
            canAdvance: false,
            stepIndex: "{{nextStep}}",
            stageId: "stage_intro",
            screenId: "S1"
          },
          { op: "log.append", kind: "timeline", summary: "{{summary}}" }
        ]
      }
    }
  } satisfies GameManifestTemplateMap;

  const actionDef = {
    handlerType: "manifest-data",
    templateId: "timeline-advance",
    capabilityFamily: "game.timeline.advance",
    capability: "game.timeline.advance",
    params: {
      currentStep: 3,
      nextStep: 4,
      summary: "Moved to the next info screen"
    },
    deterministic: {
      effects: [
        {
          op: "timeline.set",
          activeInfoId: "i4"
        }
      ]
    }
  } satisfies GameManifestActionDefinition;

  const handler = createDeterministicHandler("game.timeline.advance", {
    mode: "manifest-action",
    templates
  });

  const result = await handler({
    sessionId: "session-1",
    gameId: "test-game",
    actionId: "opening.info.i3.advance",
    state: {
      public: {
        timeline: {
          line: "main",
          stepIndex: 3,
          stageId: "stage_intro",
          screenId: "S1",
          canAdvance: true
        },
        log: []
      }
    },
    now: new Date(),
    manifestAction: {
      actionId: "opening.info.i3.advance",
      handlerType: "manifest-data",
      templateId: "timeline-advance",
      params: actionDef.params,
      raw: actionDef
    }
  });

  assert.ok(result.ok, `Action failed: ${result.error?.message}`);
  const nextState = result.delta?.state as any;
  assert.equal(nextState.public.timeline.stepIndex, 4);
  assert.equal(nextState.public.timeline.step_index, 4);
  assert.equal(nextState.public.timeline.stageId, "stage_intro");
  assert.equal(nextState.public.timeline.stage_id, "stage_intro");
  assert.equal(nextState.public.timeline.screenId, "S1");
  assert.equal(nextState.public.timeline.screen_id, "S1");
  assert.equal(nextState.public.timeline.activeInfoId, "i4");
  assert.equal(nextState.public.timeline.canAdvance, false);
  assert.equal(result.effects?.filter((effect) => effect.target === "public.timeline").length, 2);
});

test("deterministicHandler applies conditional timeline effect after baseline timeline effect", async () => {
  const actionDef = {
    handlerType: "manifest-data",
    capabilityFamily: "game.timeline.advance",
    capability: "game.timeline.advance",
    deterministic: {
      guard: {
        timeline: { line: "main", stepIndex: 1, canAdvance: true }
      },
      effects: [
        {
          op: "timeline.set",
          canAdvance: false,
          stepIndex: 2,
          stageId: "base-stage",
          screenId: "base-screen",
          activeInfoId: "base-info"
        },
        {
          op: "timeline.set",
          line: "main",
          stepIndex: 9,
          stageId: "branch-stage",
          screenId: "branch-screen",
          activeInfoId: "branch-info",
          canAdvance: true,
          when: { metric: { metricId: "signal", operator: ">", threshold: 0 } }
        }
      ]
    }
  } satisfies GameManifestActionDefinition;

  const handler = createDeterministicHandler("game.timeline.advance", {
    mode: "manifest-action"
  });

  const result = await handler({
    sessionId: "session-1",
    gameId: "test-game",
    actionId: "timeline.branch",
    state: {
      public: {
        metrics: { signal: 1 },
        timeline: {
          line: "main",
          stepIndex: 1,
          stageId: "intro",
          screenId: "start",
          canAdvance: true
        },
        log: []
      }
    },
    now: new Date(),
    manifestAction: {
      actionId: "timeline.branch",
      handlerType: "manifest-data",
      raw: actionDef
    }
  });

  assert.ok(result.ok, `Action failed: ${result.error?.message}`);
  const nextState = result.delta?.state as any;
  assert.equal(nextState.public.timeline.stepIndex, 9);
  assert.equal(nextState.public.timeline.step_index, 9);
  assert.equal(nextState.public.timeline.stageId, "branch-stage");
  assert.equal(nextState.public.timeline.screenId, "branch-screen");
  assert.equal(nextState.public.timeline.activeInfoId, "branch-info");
  assert.equal(nextState.public.timeline.canAdvance, true);
});

test("deterministicHandler applies ordered generic effects with current-state conditions", async () => {
  const actionDef = {
    handlerType: "manifest-data",
    capabilityFamily: "game.card.resolve",
    capability: "game.card.resolve",
    deterministic: {
      effects: [
        {
          op: "flag.set",
          path: "/public/flags/cards/1",
          values: { resolved: true, selected: true }
        },
        {
          op: "state.patch",
          patches: [{ op: "replace", path: "/secret/opening/selectedCardId", value: "1" }]
        },
        {
          op: "timeline.set",
          canAdvance: true,
          when: {
            collectionCount: {
              path: "/public/flags/cards",
              ids: ["1", "2"],
              field: "resolved",
              equals: true,
              countAtLeast: 2
            }
          }
        },
        {
          op: "counter.add",
          path: "/public/teamSelection/pickCount",
          delta: 1
        },
        {
          op: "collection.append",
          path: "/public/teamSelection/selectedMemberIds",
          value: "fedya"
        }
      ]
    }
  } satisfies GameManifestActionDefinition;

  const handler = createDeterministicHandler("game.card.resolve", {
    mode: "manifest-action"
  });

  const result = await handler({
    sessionId: "session-1",
    gameId: "test-game",
    actionId: "card.1.resolve",
    state: {
      public: {
        timeline: { line: "main", stepIndex: 1, canAdvance: false },
        flags: { cards: { "2": { resolved: true } } },
        teamSelection: { pickCount: 0, selectedMemberIds: [] },
        log: []
      },
      secret: { opening: {} }
    },
    now: new Date(),
    manifestAction: {
      actionId: "card.1.resolve",
      handlerType: "manifest-data",
      raw: actionDef
    }
  });

  assert.ok(result.ok, `Action failed: ${result.error?.message}`);
  const nextState = result.delta?.state as any;
  assert.equal(nextState.public.flags.cards["1"].resolved, true);
  assert.equal(nextState.public.flags.cards["1"].selected, true);
  assert.equal(nextState.secret.opening.selectedCardId, "1");
  assert.equal(nextState.public.timeline.canAdvance, true);
  assert.equal(nextState.public.teamSelection.pickCount, 1);
  assert.deepEqual(nextState.public.teamSelection.selectedMemberIds, ["fedya"]);
});

test("deterministicHandler can evaluate effect metric conditions against pre-action state", async () => {
  const actionDef = {
    handlerType: "manifest-data",
    capabilityFamily: "game.timeline.advance",
    capability: "game.timeline.advance",
    deterministic: {
      effects: [
        {
          op: "metric.add",
          metricId: "time",
          delta: 10
        },
        {
          op: "timeline.set",
          activeInfoId: "pre-action-branch",
          when: {
            metric: { metricId: "time", operator: "<", threshold: 54 },
            readFrom: "preAction"
          }
        }
      ]
    }
  } satisfies GameManifestActionDefinition;

  const handler = createDeterministicHandler("game.timeline.advance", {
    mode: "manifest-action"
  });

  const result = await handler({
    sessionId: "session-1",
    gameId: "test-game",
    actionId: "timeline.pre-action-branch",
    state: {
      public: {
        metrics: { time: 50 },
        timeline: { line: "main", stepIndex: 1, canAdvance: true },
        log: []
      }
    },
    now: new Date(),
    manifestAction: {
      actionId: "timeline.pre-action-branch",
      handlerType: "manifest-data",
      raw: actionDef
    }
  });

  assert.ok(result.ok, `Action failed: ${result.error?.message}`);
  const nextState = result.delta?.state as any;
  assert.equal(nextState.public.metrics.time, 60);
  assert.equal(nextState.public.timeline.activeInfoId, "pre-action-branch");
});

test("deterministicHandler records metric snapshots for audited log effects", async () => {
  const actionDef = {
    handlerType: "manifest-data",
    capabilityFamily: "game.card.resolve",
    capability: "game.card.resolve",
    deterministic: {
      effects: [
        { op: "metric.add", metricId: "score", delta: 2 },
        { op: "log.append", kind: "card-resolution", summary: "Card resolved", auditMetrics: true }
      ]
    }
  } satisfies GameManifestActionDefinition;

  const handler = createDeterministicHandler("game.card.resolve", {
    mode: "manifest-action"
  });

  const result = await handler({
    sessionId: "session-1",
    gameId: "test-game",
    actionId: "card.audit",
    state: {
      public: {
        metrics: { score: 5 },
        timeline: { line: "main", stepIndex: 1, canAdvance: false },
        log: []
      }
    },
    now: new Date(),
    manifestAction: {
      actionId: "card.audit",
      handlerType: "manifest-data",
      raw: actionDef
    }
  });

  assert.ok(result.ok, `Action failed: ${result.error?.message}`);
  const nextState = result.delta?.state as any;
  assert.deepEqual(nextState.public.log[0].metricsBefore, { score: 5 });
  assert.deepEqual(nextState.public.log[0].metricsAfter, { score: 7 });
  assert.deepEqual(nextState.public.log[0].metricChanges, [{ metricId: "score", delta: 2 }]);
});

test("deterministicHandler leaves plain log effects without metric snapshots", async () => {
  const actionDef = {
    handlerType: "manifest-data",
    capabilityFamily: "ui.panel",
    capability: "ui.panel.open",
    deterministic: {
      effects: [
        { op: "metric.add", metricId: "score", delta: 2 },
        { op: "log.append", kind: "ui-panel-open", summary: "Hint opened" }
      ]
    }
  } satisfies GameManifestActionDefinition;

  const handler = createDeterministicHandler("ui.panel", {
    mode: "manifest-action"
  });

  const result = await handler({
    sessionId: "session-1",
    gameId: "test-game",
    actionId: "ui.hint",
    state: {
      public: {
        metrics: { score: 5 },
        timeline: { line: "main", stepIndex: 1, canAdvance: false },
        log: []
      }
    },
    now: new Date(),
    manifestAction: {
      actionId: "ui.hint",
      handlerType: "manifest-data",
      raw: actionDef
    }
  });

  assert.ok(result.ok, `Action failed: ${result.error?.message}`);
  const nextState = result.delta?.state as any;
  assert.equal(nextState.public.log[0].metricsBefore, undefined);
  assert.equal(nextState.public.log[0].metricsAfter, undefined);
  assert.equal(nextState.public.log[0].metricChanges, undefined);
});

test("deterministicHandler rejects generic effects that write outside manifest state", async () => {
  const actionDef = {
    handlerType: "manifest-data",
    capabilityFamily: "game.card.resolve",
    capability: "game.card.resolve",
    deterministic: {
      effects: [
        {
          op: "state.patch",
          patches: [{ op: "replace", path: "/runtime/internal", value: true }]
        }
      ]
    }
  } satisfies GameManifestActionDefinition;

  const handler = createDeterministicHandler("game.card.resolve", {
    mode: "manifest-action"
  });

  const result = await handler({
    sessionId: "session-1",
    gameId: "test-game",
    actionId: "card.unsafe",
    state: { public: { log: [] } },
    now: new Date(),
    manifestAction: {
      actionId: "card.unsafe",
      handlerType: "manifest-data",
      raw: actionDef
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "RUNTIME_ACTION_EFFECT_FAILED");
});
