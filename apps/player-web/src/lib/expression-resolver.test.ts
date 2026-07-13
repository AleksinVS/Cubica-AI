/**
 * Focused data-binding tests for turn-based UI state and action parameters.
 */

import { describe, expect, it } from "vitest";

import {
  resolveExpression,
  resolveExpressions,
  resolvePayloadExpressions
} from "./expression-resolver";

const state = {
  players: {
    p1: { metrics: { cash: 900 } }
  }
};

describe("turn-based expression bindings", () => {
  it("resolves player metrics through the declarative game.state alias", () => {
    expect(resolveExpressions("{{game.state.players.p1.metrics.cash}}", state)).toBe(900);
  });

  it("preserves an object bound as complete action params", () => {
    expect(resolvePayloadExpressions(
      { actionId: "property.buy", params: "{{boardAction.params}}" },
      state,
      { boardAction: { params: { cellId: "cell-02" } } }
    )).toEqual({
      actionId: "property.buy",
      params: { cellId: "cell-02" }
    });
  });

  it("uses the same fallback semantics for text and action payload bindings", () => {
    const expression = "{{state.public.missing || fallback}}";

    expect(resolveExpression(expression, { public: {} })).toBe("fallback");
    expect(resolveExpressions(`Result: ${expression}`, { public: {} })).toBe("Result: fallback");
    expect(resolvePayloadExpressions(
      { value: expression, quoted: "{{state.public.missing || 'not set'}}" },
      { public: {} }
    )).toEqual({ value: "fallback", quoted: "not set" });
  });
});
