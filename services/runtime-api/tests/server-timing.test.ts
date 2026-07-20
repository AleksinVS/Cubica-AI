/**
 * Focused unit coverage for the action-latency response header.
 *
 * These tests keep observability outside the public JSON contract and prove
 * that only fixed names and safe decimal durations can reach HTTP headers.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { formatServerTimingHeader } from "../src/modules/player-api/httpServer.ts";

test("formats action latency buckets in a fixed canonical order", () => {
  assert.equal(
    formatServerTimingHeader({
      dispatchMs: 12.34567,
      schedulerMs: 2,
      reloadMs: 0.1254,
      projectionMs: 0,
      actionAvailabilityMs: 1.1,
      totalMs: 16
    }),
    [
      "dispatch;dur=12.346",
      "scheduler;dur=2.000",
      "reload;dur=0.125",
      "projection;dur=0.000",
      "action-availability;dur=1.100",
      "total;dur=16.000"
    ].join(", ")
  );
});

test("omits scheduler and reload when no post-commit pass ran", () => {
  assert.equal(
    formatServerTimingHeader({
      dispatchMs: 1,
      projectionMs: 2,
      actionAvailabilityMs: 3,
      totalMs: 6
    }),
    [
      "dispatch;dur=1.000",
      "projection;dur=2.000",
      "action-availability;dur=3.000",
      "total;dur=6.000"
    ].join(", ")
  );
});

test("never serializes invalid numbers or attacker-shaped values", () => {
  assert.equal(formatServerTimingHeader({
    dispatchMs: Number.NaN,
    schedulerMs: Number.POSITIVE_INFINITY,
    reloadMs: -1,
    projectionMs: Number.MAX_SAFE_INTEGER + 1,
    actionAvailabilityMs: "1\r\nX-Injected: yes" as unknown as number
  }), undefined);
});
