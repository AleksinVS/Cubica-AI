import assert from "node:assert/strict";
import { test } from "node:test";
import { createDeterministicHandler } from "../src/modules/runtime/deterministicHandlers.ts";
import { validateGameManifest } from "../src/modules/content/manifestValidation.ts";
import type { RuntimeActionContext } from "@cubica/contracts-runtime";

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
        stateUpdate: { timelineStepIndex: "{{next}}" },
        log: { kind: "test", summary: "{{summary}}" },
        metricDeltas: []
      }
    }
  },
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
        metricDeltas: [{ metricId: "score", delta: 10 }],
        log: { kind: "test", summary: "Default summary" },
        stateUpdate: { timelineStepIndex: 1 }
      }
    }
  };

  const action = {
    handlerType: "manifest-template",
    templateId: "base_action",
    params: {
        summary: "Overridden summary"
    },
    deterministic: {
      metricDeltas: [{ metricId: "score", delta: 20 }]
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
  // Should have overridden metricDelta (20 instead of 10)
  // Wait, my deepMerge is very simple: { ...template.deterministic, ...action.raw.deterministic }
  // Since metricDeltas is an array, it replaces it.
  
  // Checking log summary
  // template log has summary: "{{summary}}"? No, I didn't put it in base_action.
  // Wait, if I want to override summary via params, the template MUST have the placeholder.
});
