/**
 * Focused data-binding tests for turn-based UI state and action parameters.
 */

import { describe, expect, it } from "vitest";

import { resolveExpressions, resolvePayloadExpressions } from "./expression-resolver";

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
});
