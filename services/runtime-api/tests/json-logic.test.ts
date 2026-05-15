import assert from "node:assert/strict";
import { test } from "node:test";
import { createDeterministicHandler } from "../src/modules/runtime/deterministicHandlers.ts";
import type { RuntimeActionContext } from "@cubica/contracts-runtime";

const makeContext = (
  actionId: string,
  state: Record<string, unknown>,
  manifestAction: Record<string, unknown>
): RuntimeActionContext<any> => ({
  sessionId: "session-1",
  gameId: "test-game",
  actionId,
  state,
  now: new Date(),
  manifestAction: {
    ...manifestAction,
    // In the real flow, `raw` is the full action object from the manifest.
    // Set it to the manifestAction itself so resolveTemplate can access overrides.
    raw: manifestAction
  }
});

const templates = {
  "json-guard-action": {
    deterministic: {
      guard: {},
      metricDeltas: [],
      log: { kind: "test", summary: "JsonLogic test" },
      stateUpdate: {}
    }
  }
};

test("JsonLogic guard passes when expression evaluates to true", async () => {
  const handler = createDeterministicHandler("runtime.server", {
    mode: "manifest-action",
    templates
  });

  const actionDef = {
    handlerType: "manifest-data",
    templateId: "json-guard-action",
    capabilityFamily: "test",
    capability: "test.json",
    overrides: {
      deterministic: {
        guard: {
          jsonLogic: { ">": [{ "var": "public.metrics.pro" }, 10] }
        }
      }
    }
  };

  const context = makeContext("test.json", {
    public: {
      timeline: { line: "main", stepIndex: 0 },
      log: [],
      metrics: { pro: 50 }
    }
  }, actionDef);

  const result = await handler(context);
  assert.ok(result.ok, `Action should pass: ${result.error?.message}`);
});

test("JsonLogic guard fails when expression evaluates to false", async () => {
  const handler = createDeterministicHandler("runtime.server", {
    mode: "manifest-action",
    templates
  });

  const actionDef = {
    handlerType: "manifest-data",
    templateId: "json-guard-action",
    capabilityFamily: "test",
    capability: "test.json",
    overrides: {
      deterministic: {
        guard: {
          jsonLogic: { ">": [{ "var": "public.metrics.pro" }, 100] }
        }
      }
    }
  };

  const context = makeContext("test.json", {
    public: {
      timeline: { line: "main", stepIndex: 0 },
      log: [],
      metrics: { pro: 50 }
    }
  }, actionDef);

  const result = await handler(context);
  assert.ok(!result.ok, "Action should fail when JsonLogic guard is false");
  assert.ok(result.error?.message?.includes("JsonLogic"), "Error should mention JsonLogic");
});

test("JsonLogic guard coexists with hardcoded guards", async () => {
  const handler = createDeterministicHandler("runtime.server", {
    mode: "manifest-action",
    templates
  });

  const actionDef = {
    handlerType: "manifest-data",
    templateId: "json-guard-action",
    capabilityFamily: "test",
    capability: "test.json",
    overrides: {
      deterministic: {
        guard: {
          timeline: { line: "main", stepIndex: 0, canAdvance: false },
          jsonLogic: { ">": [{ "var": "public.metrics.pro" }, 10] }
        }
      }
    }
  };

  // Both timeline and JsonLogic pass
  const context1 = makeContext("test.json", {
    public: {
      timeline: { line: "main", stepIndex: 0, canAdvance: false },
      log: [],
      metrics: { pro: 50 }
    }
  }, actionDef);

  const result1 = await handler(context1);
  assert.ok(result1.ok, "Both guards pass");

  // Timeline passes, JsonLogic fails
  const context2 = makeContext("test.json", {
    public: {
      timeline: { line: "main", stepIndex: 0, canAdvance: false },
      log: [],
      metrics: { pro: 5 }
    }
  }, actionDef);

  const result2 = await handler(context2);
  assert.ok(!result2.ok, "JsonLogic guard fails even when timeline passes");
});

test("JsonLogic expression in metricDeltas computes dynamic value", async () => {
  const handler = createDeterministicHandler("runtime.server", {
    mode: "manifest-action",
    templates: {
      "json-delta-action": {
        deterministic: {
          guard: {},
          metricDeltas: [
            {
              metricId: "score",
              delta: { "*": [{ "var": "public.metrics.pro" }, 2] }
            }
          ],
          log: { kind: "test", summary: "JsonLogic delta test" },
          stateUpdate: {}
        }
      }
    }
  });

  const actionDef = {
    handlerType: "manifest-data",
    templateId: "json-delta-action",
    capabilityFamily: "test",
    capability: "test.json-delta"
  };

  const context = makeContext("test.json-delta", {
    public: {
      timeline: { line: "main", stepIndex: 0 },
      log: [],
      metrics: { pro: 15 }
    }
  }, actionDef);

  const result = await handler(context);
  assert.ok(result.ok, `Action failed: ${result.error?.message}`);
  const nextState = result.delta?.state as any;
  // pro=15, delta = 15*2 = 30, so score = 0 + 30 = 30
  assert.equal(nextState.public.metrics?.score, 30);
});

test("JsonLogic 'var' reads nested state path", async () => {
  const handler = createDeterministicHandler("runtime.server", {
    mode: "manifest-action",
    templates
  });

  const actionDef = {
    handlerType: "manifest-data",
    templateId: "json-guard-action",
    capabilityFamily: "test",
    capability: "test.json",
    overrides: {
      deterministic: {
        guard: {
          jsonLogic: { ">": [{ "var": "public.metrics.pro" }, 10] }
        }
      }
    }
  };

  const context = makeContext("test.json", {
    public: {
      timeline: { line: "main", stepIndex: 0 },
      log: [],
      metrics: { pro: 50 }
    }
  }, actionDef);

  const result = await handler(context);
  assert.ok(result.ok, `var should read nested path: ${result.error?.message}`);
});
