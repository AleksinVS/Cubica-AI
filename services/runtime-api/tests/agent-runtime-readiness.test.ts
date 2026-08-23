/** Focused policy coverage for optional and required Agent Runtime adapters. */

import assert from "node:assert/strict";
import test from "node:test";
import type { GameManifestAgentRuntimeConfig } from "@cubica/contracts-manifest";

import {
  buildAgentRuntimeUnavailableMessage,
  checkAgentRuntimeReadiness,
  isMockAgentRuntimeEnabled
} from "../src/modules/ai/agentRuntimeReadiness.ts";

test("deterministic games remain ready without any Agent Runtime dependency", () => {
  assert.deepEqual(checkAgentRuntimeReadiness(undefined), {
    status: "ok",
    required: false,
    mode: "not-required"
  });
});

test("a seat-scoped dependency requires the same configured runtime without changing game execution mode", () => {
  const previous = process.env.CUBICA_ENABLE_MOCK_AGENT_RUNTIME;
  try {
    delete process.env.CUBICA_ENABLE_MOCK_AGENT_RUNTIME;
    assert.equal(checkAgentRuntimeReadiness(undefined, { requireConfigured: true }).status, "error");
    const seatRuntime = requiredRuntime("mock");
    seatRuntime.required = false;
    delete seatRuntime.initialActionId;
    assert.equal(checkAgentRuntimeReadiness(seatRuntime, { requireConfigured: true }).status, "error");

    process.env.CUBICA_ENABLE_MOCK_AGENT_RUNTIME = "true";
    assert.equal(checkAgentRuntimeReadiness(seatRuntime, { requireConfigured: true }).status, "ok");
  } finally {
    if (previous === undefined) delete process.env.CUBICA_ENABLE_MOCK_AGENT_RUNTIME;
    else process.env.CUBICA_ENABLE_MOCK_AGENT_RUNTIME = previous;
  }
});

test("the mock adapter is opt-in and a required unknown adapter fails closed", () => {
  const previous = process.env.CUBICA_ENABLE_MOCK_AGENT_RUNTIME;
  try {
    delete process.env.CUBICA_ENABLE_MOCK_AGENT_RUNTIME;
    assert.equal(isMockAgentRuntimeEnabled({ CUBICA_ENABLE_MOCK_AGENT_RUNTIME: "TRUE" }), false);

    const disabled = checkAgentRuntimeReadiness(requiredRuntime("mock"));
    assert.equal(disabled.status, "error");
    assert.equal(disabled.mode, "missing");
    assert.match(disabled.reason ?? "", /CUBICA_ENABLE_MOCK_AGENT_RUNTIME=true/u);

    process.env.CUBICA_ENABLE_MOCK_AGENT_RUNTIME = "true";
    assert.deepEqual(checkAgentRuntimeReadiness(requiredRuntime("mock")), {
      status: "ok",
      required: true,
      mode: "configured",
      agentId: "fixture-agent",
      runtimeId: "mock",
      failurePolicy: "pause"
    });

    const unknown = checkAgentRuntimeReadiness(requiredRuntime("unconfigured-provider"));
    assert.equal(unknown.status, "error");
    assert.equal(unknown.mode, "missing");
    assert.match(unknown.reason ?? "", /adapter is not configured/u);
    assert.equal(
      buildAgentRuntimeUnavailableMessage("fixture-game", unknown),
      'Game "fixture-game" requires Agent Runtime agentId="fixture-agent" failurePolicy="pause" but Agent Runtime is not configured'
    );
  } finally {
    if (previous === undefined) delete process.env.CUBICA_ENABLE_MOCK_AGENT_RUNTIME;
    else process.env.CUBICA_ENABLE_MOCK_AGENT_RUNTIME = previous;
  }
});

function requiredRuntime(runtimeId: string): GameManifestAgentRuntimeConfig {
  return {
    required: true,
    runtimeId,
    agentId: "fixture-agent",
    initialActionId: "fixture.agent.enter",
    allowedCapabilities: ["selectPublishedIntent"],
    failurePolicy: "pause",
    surfaceCatalog: [],
    contextExposurePolicy: {
      publicState: true,
      secretState: "none",
      manifestProjection: ["/meta", "/actions"]
    }
  };
}
