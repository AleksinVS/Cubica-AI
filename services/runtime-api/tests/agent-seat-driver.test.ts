/** Neutral proof of the server-owned local agent-seat transaction flow. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import type { CubicaAgentTurnInput, CubicaAgentTurnResult } from "@cubica/contracts-ai";
import type {
  CubicaMechanicsIRV1Alpha1,
  GameManifest,
  Step
} from "@cubica/contracts-manifest";
import type { SessionCommandReceipt } from "@cubica/contracts-session";

import {
  AgentSeatDriver,
  MAX_AGENT_SEAT_DRIVER_STEPS
} from "../src/modules/ai/agentSeatDriver.ts";
import { AgentTurnService, type AgentRuntimeRunner } from "../src/modules/ai/agentRuntime.ts";
import { createImmutableBundleContent } from "../src/modules/content/immutableBundle.ts";
import { RuntimeService } from "../src/modules/runtime/runtime.service.ts";
import { BoundedInMemoryCommandAdmissionController } from "../src/modules/runtime/commandAdmission.ts";
import { InMemorySessionStore } from "../src/modules/session/inMemorySessionStore.ts";
import { createLocalSessionAccess } from "../src/modules/session/sessionAuthentication.ts";
import { SessionService } from "../src/modules/session/session.service.ts";
import {
  createDurableCommandResult,
  readAgentSeatControl
} from "../src/modules/session/commandIdentity.ts";

const require = createRequire(import.meta.url);
const { recommendedModuleLock } = require("../../../scripts/manifest-tools/mechanics-modules.cjs") as {
  recommendedModuleLock: (ids: string[]) => CubicaMechanicsIRV1Alpha1["moduleLock"];
};
const { mechanicsSha256 } = require("../../../scripts/manifest-tools/mechanics-canonicalize.cjs") as {
  mechanicsSha256: (value: unknown) => string;
};

test("ordinary human action automatically drives the next immutable agent participant fairly", async () => {
  let calls = 0;
  let captured: CubicaAgentTurnInput | undefined;
  const fixture = await createFixture(async (input) => {
    calls += 1;
    captured = structuredClone(input);
    return selected(input, "turn.to-human");
  });
  try {
    const result = await fixture.runtime.dispatch({
      sessionStore: fixture.store,
      accessToken: fixture.access.accessToken,
      input: humanCommand(fixture.sessionId)
    });
    assert.equal(result.response.version.stateVersion, 2);
    assert.equal(activePlayer(result.response.state), "p1");
    assert.equal(calls, 1);
    assert.equal(result.response.agentControl, undefined);
    assert.equal(captured?.executionMode, "deterministic");
    assert.equal(captured?.playerId, "p2");
    assert.equal("secret" in (captured?.stateScope ?? {}), false);
    assert.deepEqual(captured?.stateScope.actor, { privateNote: "p2-only" });
    assert.equal(JSON.stringify(captured).includes("p1-only"), false);
    assert.ok(captured?.availableIntents.some((intent) => intent.actionId === "turn.to-human"));
  } finally {
    await fixture.store.close();
  }
});

test("the same bounded driver handles a session whose initial active participant is an agent", async () => {
  let calls = 0;
  const fixture = await createFixture(async (input) => {
    calls += 1;
    return selected(input, "turn.to-agent");
  }, { activePlayerId: "p1", agentPlayerIds: ["p1"] });
  try {
    const driven = await fixture.driver.drive({
      sessionStore: fixture.store,
      credentialSha256: fixture.access.principal.credentialSha256,
      sessionId: fixture.sessionId
    });
    assert.equal(calls, 1);
    assert.equal(driven.snapshot.version.stateVersion, 1);
    assert.equal(activePlayer(driven.snapshot.state), "p2");
  } finally {
    await fixture.store.close();
  }
});

test("73 ordered fallbacks reject ordinary guard and parameter failures before the final atomic commit", async () => {
  let calls = 0;
  const fallbacks = Array.from(
    { length: 72 },
    (_, index) => index % 2 === 0
      ? { actionId: "turn.only-human", params: {} }
      : { actionId: "turn.with-param", params: {} }
  );
  fallbacks.push({ actionId: "turn.to-human", params: {} });
  assert.equal(fallbacks.length, 73);
  const fixture = await createFixture(async (input) => {
    calls += 1;
    return calls === 1
      ? selected(input, "unpublished.intent")
      : selected(input, "turn.with-param");
  }, {
    invalidAttemptLimit: 2,
    fallbacks
  });
  try {
    const command = humanCommand(fixture.sessionId);
    const result = await fixture.runtime.dispatch({
      sessionStore: fixture.store,
      accessToken: fixture.access.accessToken,
      input: command
    });
    assert.equal(calls, 2);
    assert.equal(result.response.version.stateVersion, 2);
    assert.equal(
      readCount(result.response.state),
      2,
      "rejected candidate states must not leak a partial mutation"
    );
    assert.equal(activePlayer(result.response.state), "p1");

    const retry = await fixture.runtime.dispatch({
      sessionStore: fixture.store,
      accessToken: fixture.access.accessToken,
      input: command
    });
    assert.equal(calls, 2, "the exact receipt must suppress provider and fallback replay");
    assert.deepEqual(retry.response, result.response);
  } finally {
    await fixture.store.close();
  }
});

test("unavailable fallbacks pause durably and exact retry does not call provider again", async () => {
  let calls = 0;
  const fixture = await createFixture(async (input) => {
    calls += 1;
    return selected(input, "unpublished.intent");
  }, {
    fallbacks: [{ actionId: "turn.only-human", params: {} }]
  });
  try {
    const command = humanCommand(fixture.sessionId);
    const first = await fixture.runtime.dispatch({
      sessionStore: fixture.store,
      accessToken: fixture.access.accessToken,
      input: command
    });
    assert.equal(first.response.version.stateVersion, 1);
    assert.deepEqual(first.response.agentControl, {
      playerId: "p2",
      status: "paused",
      reasonCode: "fallbackUnavailable"
    });
    const read = await new SessionService({ sessionStore: fixture.store }).getSession(
      fixture.sessionId,
      fixture.access.accessToken
    );
    assert.deepEqual(read.agentControl, first.response.agentControl);
    const retry = await fixture.runtime.dispatch({
      sessionStore: fixture.store,
      accessToken: fixture.access.accessToken,
      input: command
    });
    assert.equal(retry.response.version.stateVersion, 1);
    assert.deepEqual(retry.response.agentControl, first.response.agentControl);
    assert.equal(calls, 2, "the durable seat receipt must suppress provider replay");
  } finally {
    await fixture.store.close();
  }
});

test("provider outage never uses gameplay fallback and facilitator takeover alone permits local control", async (t) => {
  for (const policy of ["pause", "facilitatorTakeover"] as const) {
    await t.test(policy, async () => {
      let calls = 0;
      const fixture = await createFixture(async () => {
        calls += 1;
        throw new Error("provider offline");
      }, { failurePolicy: policy });
      try {
        const first = await fixture.runtime.dispatch({
          sessionStore: fixture.store,
          accessToken: fixture.access.accessToken,
          input: humanCommand(fixture.sessionId)
        });
        assert.equal(first.response.version.stateVersion, 1);
        assert.deepEqual(first.response.agentControl, {
          playerId: "p2",
          status: policy === "pause" ? "paused" : policy,
          reasonCode: "runtimeUnavailable"
        });
        assert.equal(calls, 1);

        const takeoverCommand = {
          sessionId: fixture.sessionId,
          expectedStateVersion: 1,
          actionId: "turn.to-human",
          commandId: `cli_${(policy === "pause" ? "P" : "T").repeat(22)}`,
          params: {}
        };
        if (policy === "pause") {
          await assert.rejects(
            fixture.runtime.dispatch({
              sessionStore: fixture.store,
              accessToken: fixture.access.accessToken,
              input: takeoverCommand
            }),
            /not allowed/u
          );
        } else {
          const taken = await fixture.runtime.dispatch({
            sessionStore: fixture.store,
            accessToken: fixture.access.accessToken,
            input: takeoverCommand
          });
          assert.equal(taken.response.version.stateVersion, 2);
          assert.equal(activePlayer(taken.response.state), "p1");
          assert.equal(taken.response.agentControl, undefined);
        }
      } finally {
        await fixture.store.close();
      }
    });
  }
});

test("consecutive agent turns stop at the global step bound with a durable generic status", async () => {
  let calls = 0;
  const fixture = await createFixture(async (input) => {
    calls += 1;
    return selected(input, "turn.stay-agent");
  });
  try {
    const result = await fixture.runtime.dispatch({
      sessionStore: fixture.store,
      accessToken: fixture.access.accessToken,
      input: humanCommand(fixture.sessionId)
    });
    assert.equal(calls, MAX_AGENT_SEAT_DRIVER_STEPS);
    assert.equal(result.response.version.stateVersion, 1 + MAX_AGENT_SEAT_DRIVER_STEPS);
    assert.deepEqual(result.response.agentControl, {
      playerId: "p2",
      status: "paused",
      reasonCode: "stepLimit"
    });
  } finally {
    await fixture.store.close();
  }
});

test("admission exhaustion persists stepLimit instead of stranding a high-cost consecutive agent", async () => {
  let calls = 0;
  const fixture = await createFixture(async (input) => {
    calls += 1;
    return selected(input, "turn.stay-agent");
  }, { invalidAttemptLimit: 16 });
  try {
    const command = humanCommand(fixture.sessionId);
    const first = await fixture.runtime.dispatch({
      sessionStore: fixture.store,
      accessToken: fixture.access.accessToken,
      input: command
    });
    assert.equal(calls, 1, "rejected admission must happen before a second provider call");
    assert.equal(first.response.version.stateVersion, 2);
    assert.equal(readCount(first.response.state), 2);
    assert.deepEqual(first.response.agentControl, {
      playerId: "p2",
      status: "paused",
      reasonCode: "stepLimit"
    });

    const retry = await fixture.runtime.dispatch({
      sessionStore: fixture.store,
      accessToken: fixture.access.accessToken,
      input: command
    });
    assert.equal(calls, 1);
    assert.equal(retry.response.version.stateVersion, 2);
    assert.deepEqual(retry.response.agentControl, first.response.agentControl);

    const read = await new SessionService({ sessionStore: fixture.store }).getSession(
      fixture.sessionId,
      fixture.access.accessToken
    );
    assert.deepEqual(read.agentControl, first.response.agentControl);
  } finally {
    await fixture.store.close();
  }
});

test("durable control parsing delegates the complete public shape to the generated validator", () => {
  const receiptFor = (control: unknown) => ({
    result: createDurableCommandResult("agent-turn", { control })
  }) as SessionCommandReceipt;

  assert.deepEqual(readAgentSeatControl(receiptFor({
    playerId: "p2",
    status: "paused",
    reasonCode: "stepLimit"
  })), {
    playerId: "p2",
    status: "paused",
    reasonCode: "stepLimit"
  });
  for (const malformed of [
    { playerId: "p2", status: "pause", reasonCode: "stepLimit" },
    { playerId: "p2", status: "paused", reasonCode: "quota" },
    { playerId: "p2", status: "paused", reasonCode: "stepLimit", privateDiagnostics: [] }
  ]) {
    assert.throws(() => readAgentSeatControl(receiptFor(malformed)), /invalid/u);
  }
});

async function createFixture(
  runner: AgentRuntimeRunner,
  options: {
    invalidAttemptLimit?: number;
    fallbacks?: Array<{ actionId: string; params: Record<string, unknown> }>;
    failurePolicy?: "pause" | "retry" | "deterministicFallback" | "facilitatorTakeover";
    activePlayerId?: "p1" | "p2";
    agentPlayerIds?: ReadonlyArray<"p1" | "p2">;
  } = {}
) {
  const manifest = neutralManifest(options);
  const immutableBundle = createImmutableBundleContent(
    manifest.meta.id,
    manifest as unknown as Record<string, unknown>
  );
  const access = createLocalSessionAccess("player");
  const store = new InMemorySessionStore<Record<string, unknown>>();
  const agentPlayerIds = new Set(options.agentPlayerIds ?? ["p2"]);
  const activePlayerId = options.activePlayerId ?? "p1";
  const created = await store.createSession({
    gameId: manifest.meta.id,
    participants: [
      { seatId: "p1", playerId: "p1", kind: agentPlayerIds.has("p1") ? "agent" : "human", joinState: "local" },
      { seatId: "p2", playerId: "p2", kind: agentPlayerIds.has("p2") ? "agent" : "human", joinState: "local" }
    ],
    initialState: {
      public: {
        turn: { order: ["p1", "p2"], activePlayerId, phase: "act", turnNumber: 1 },
        count: 0
      },
      players: {
        p1: { privateNote: "p1-only" },
        p2: { privateNote: "p2-only" }
      },
      secret: { providerKey: "must-not-leak" }
    },
    sessionRole: "player",
    immutableBundle,
    principal: access.principal
  });
  const admission = new BoundedInMemoryCommandAdmissionController();
  const turnService = new AgentTurnService(admission, runner);
  const driver = new AgentSeatDriver(turnService);
  const runtime = new RuntimeService(admission, undefined, driver);
  return { store, access, sessionId: created.session.sessionId, runtime, driver };
}

function neutralManifest(options: {
  invalidAttemptLimit?: number;
  fallbacks?: Array<{ actionId: string; params: Record<string, unknown> }>;
  failurePolicy?: "pause" | "retry" | "deterministicFallback" | "facilitatorTakeover";
}): GameManifest {
  const manifest = JSON.parse(readFileSync(
    new URL("../../../games/simple-choice/game.manifest.json", import.meta.url),
    "utf8"
  )) as GameManifest;
  manifest.meta.id = "neutral-agent-seat-fixture";
  manifest.meta.name = "Neutral agent seat fixture";
  manifest.executionMode = "deterministic";
  manifest.config.players = {
    min: 2,
    max: 2,
    agentSeats: {
      max: 1,
      invalidAttemptLimit: options.invalidAttemptLimit ?? 2,
      deterministicFallbackCandidates: (options.fallbacks ?? [
        { actionId: "turn.to-human", params: {} }
      ]) as unknown as NonNullable<
        GameManifest["config"]["players"]["agentSeats"]
      >["deterministicFallbackCandidates"]
    }
  };
  manifest.config.turnModel = { phases: ["act"] };
  manifest.agentRuntime = {
    agentId: "neutral-seat-agent",
    runtimeId: "mock",
    required: false,
    allowedCapabilities: ["selectPublishedIntent"],
    surfaceCatalog: [],
    failurePolicy: options.failurePolicy ?? "pause",
    contextExposurePolicy: {
      publicState: true,
      secretState: "none",
      manifestProjection: ["/meta", "/actions"]
    }
  };
  manifest.state = {
    public: { count: 0 },
    secret: { providerKey: "must-not-leak" },
    playersTemplate: {
      metrics: { score: 0 },
      flags: {},
      status: "active",
      visibility: { metrics: "public", flags: "private" }
    }
  } as unknown as GameManifest["state"];
  manifest.objectModels = {};
  manifest.actions = Object.fromEntries([
    action("turn.to-agent", "turn.to-agent"),
    action("turn.to-human", "turn.to-human"),
    action("turn.only-human", "turn.only-human"),
    action("turn.stay-agent", "turn.stay-agent"),
    action("turn.with-param", "turn.to-human", {
      type: "object",
      additionalProperties: false,
      properties: { choice: { type: "string", maxLength: 64 } },
      required: ["choice"]
    })
  ]);
  manifest.mechanics = {
    apiVersion: "cubica.dev/mechanics/v1alpha1",
    budgetProfile: "turn-based-standard-v1",
    moduleLock: recommendedModuleLock(["cubica.core"]),
    stateModel: {
      types: {
        "core.string": { kind: "string" },
        "core.integer": { kind: "integer", minimum: 0, maximum: 1000 },
        "fixture.participant-order": { kind: "list", itemType: "core.string", maxItems: 2 },
        "fixture.turn-phase": { kind: "enum", values: ["act"] }
      },
      endpoints: {
        "public.turn.order": {
          audienceRef: "public",
          storage: { root: "public", segments: ["turn", "order"] },
          valueType: "fixture.participant-order",
          access: "read-write"
        },
        "public.turn.activePlayerId": {
          audienceRef: "public",
          storage: { root: "public", segments: ["turn", "activePlayerId"] },
          valueType: "core.string",
          access: "read-write"
        },
        "public.count": {
          audienceRef: "public",
          storage: { root: "public", segments: ["count"] },
          valueType: "core.integer",
          access: "read-write"
        },
        "public.turn.phase": {
          audienceRef: "public",
          storage: { root: "public", segments: ["turn", "phase"] },
          valueType: "fixture.turn-phase",
          access: "read-write"
        },
        "public.turn.turnNumber": {
          audienceRef: "public",
          storage: { root: "public", segments: ["turn", "turnNumber"] },
          valueType: "core.integer",
          access: "read-write"
        },
        "actor.privateNote": {
          audienceRef: "actor",
          storage: { root: "players", segments: [{ context: "actor" }, "privateNote"] },
          valueType: "core.string",
          access: "read-only"
        },
        "server.providerKey": {
          audienceRef: "server",
          storage: { root: "secret", segments: ["providerKey"] },
          valueType: "core.string",
          access: "read-only"
        }
      },
      collections: {},
      events: {}
    },
    plans: {
      "turn.to-agent": plan("p2"),
      "turn.to-human": plan("p1"),
      "turn.only-human": plan("p1", true),
      "turn.stay-agent": plan("p2")
    }
  };
  finalizeHashes(manifest);
  return manifest;
}

function action(actionId: string, planRef: string, paramsSchema: Record<string, unknown> = {
  type: "object", additionalProperties: false, properties: {}, required: []
}) {
  return [actionId, {
    invocation: "external" as const,
    definitionHash: `sha256:${"0".repeat(64)}`,
    binding: { kind: "mechanics-plan" as const, planRef },
    paramsSchema
  }];
}

function plan(
  targetPlayerId: string,
  humanOnly = false
): GameManifest["mechanics"]["plans"][string] {
  const steps = [
    ...(humanOnly ? [{
      id: "require-human",
      kind: "assert" as const,
      op: "core.assert" as const,
      predicate: {
        op: "predicate.compare" as const,
        operator: "eq" as const,
        left: { op: "value.actor" as const },
        right: { op: "value.literal" as const, value: "p1" }
      },
      errorCode: "NOT_HUMAN_ACTOR"
    }] : []),
    {
      id: "count",
      kind: "command" as const,
      op: "core.number.add" as const,
      target: { endpoint: "public.count" },
      delta: { op: "value.literal" as const, value: 1 }
    },
    {
      id: "advance",
      kind: "command" as const,
      op: "core.state.patch" as const,
      patches: [{
        operation: "set" as const,
        target: { endpoint: "public.turn.activePlayerId" },
        value: { op: "value.literal" as const, value: targetPlayerId }
      }]
    }
  ] as unknown as [Step, ...Step[]];
  return {
    planHash: `sha256:${"0".repeat(64)}`,
    transaction: {
      steps
    }
  };
}

function finalizeHashes(manifest: GameManifest): void {
  const networkModelsHash = mechanicsSha256(manifest.networkModels ?? {});
  for (const [planId, value] of Object.entries(manifest.mechanics.plans)) {
    value.planHash = mechanicsSha256({
      apiVersion: manifest.mechanics.apiVersion,
      budgetProfile: manifest.mechanics.budgetProfile,
      moduleLock: manifest.mechanics.moduleLock,
      stateModel: manifest.mechanics.stateModel,
      objectModels: manifest.objectModels ?? {},
      networkModelsHash,
      planId,
      transaction: value.transaction
    });
  }
  for (const [actionId, value] of Object.entries(manifest.actions)) {
    const definition = structuredClone(value);
    delete (definition as Partial<typeof definition>).definitionHash;
    value.definitionHash = mechanicsSha256({
      apiVersion: manifest.mechanics.apiVersion,
      actionId,
      definition,
      planHash: manifest.mechanics.plans[value.binding.planRef]!.planHash
    });
  }
}

function selected(input: CubicaAgentTurnInput, actionId: string): CubicaAgentTurnResult {
  return {
    schemaVersion: "1.0.0",
    turnId: input.turnId,
    agentId: input.agentId,
    ok: true,
    selectedIntent: { actionId, params: {} },
    audit: { source: "mock", createdAt: new Date().toISOString() }
  };
}

function humanCommand(sessionId: string) {
  return {
    sessionId,
    expectedStateVersion: 0,
    actionId: "turn.to-agent",
    commandId: `cli_${"H".repeat(22)}`,
    params: {}
  };
}

function activePlayer(state: Record<string, unknown>): unknown {
  return ((state.public as Record<string, unknown>).turn as Record<string, unknown>).activePlayerId;
}

function readCount(state: Record<string, unknown>): unknown {
  return (state.public as Record<string, unknown>).count;
}
