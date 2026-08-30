import { describe, expect, it } from "vitest";
import { normalizeAgentControl } from "./agent-control-validation";

describe("normalizeAgentControl", () => {
  it("distinguishes absent, valid and malformed server projections", () => {
    expect(normalizeAgentControl(undefined)).toEqual({ kind: "absent" });
    expect(normalizeAgentControl({
      playerId: "p2",
      status: "facilitatorTakeover",
      reasonCode: "stepLimit"
    })).toEqual({
      kind: "valid",
      value: {
        playerId: "p2",
        status: "facilitatorTakeover",
        reasonCode: "stepLimit"
      }
    });
    expect(normalizeAgentControl({
      playerId: "p2",
      status: "facilitatorTakeover",
      reasonCode: "unknown"
    })).toEqual({ kind: "invalid" });
  });

  it.each([
    "runtimeUnavailable",
    "invalidAttemptLimit",
    "fallbackUnavailable",
    "stepLimit"
  ] as const)("accepts every paused reason code: %s", (reasonCode) => {
    expect(normalizeAgentControl({
      playerId: "p2",
      status: "paused",
      reasonCode
    }).kind).toBe("valid");
  });

  it.each([
    "runtimeUnavailable",
    "invalidAttemptLimit",
    "fallbackUnavailable",
    "stepLimit"
  ] as const)("accepts every facilitatorTakeover reason code: %s", (reasonCode) => {
    expect(normalizeAgentControl({
      playerId: "p2",
      status: "facilitatorTakeover",
      reasonCode
    }).kind).toBe("valid");
  });

  it.each(["__proto__", "constructor", "prototype"] as const)(
    "rejects forbidden playerId %s",
    (playerId) => {
      expect(normalizeAgentControl({
        playerId,
        status: "paused",
        reasonCode: "runtimeUnavailable"
      })).toEqual({ kind: "invalid" });
    }
  );

  it("rejects extra properties instead of inferring a takeover", () => {
    expect(normalizeAgentControl({
      playerId: "p2",
      status: "facilitatorTakeover",
      reasonCode: "runtimeUnavailable",
      extra: true
    })).toEqual({ kind: "invalid" });
  });
});
