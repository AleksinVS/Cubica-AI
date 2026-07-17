/**
 * AI-driven gameplay proof for the Game Intent boundary.
 *
 * The test uses the committed AI fixture and the real authenticated in-memory
 * command transaction. It proves that Agent Runtime chooses a published
 * action, Mechanics IR owns the state change, and an exact transport retry
 * returns the durable receipt without applying the selected intent twice.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { CubicaMechanicsIRV1Alpha1, GameManifest } from "@cubica/contracts-manifest";

import { AgentTurnService } from "../src/modules/ai/agentRuntime.ts";
import { createImmutableBundleContent } from "../src/modules/content/immutableBundle.ts";
import { listManifestActionDefinitions } from "../src/modules/runtime/manifestActions.ts";
import { BoundedInMemoryCommandAdmissionController } from "../src/modules/runtime/commandAdmission.ts";
import { InMemorySessionStore } from "../src/modules/session/inMemorySessionStore.ts";
import { createLocalSessionAccess } from "../src/modules/session/sessionAuthentication.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(import.meta.url);
const { recommendedModuleLock } = require("../../../scripts/manifest-tools/mechanics-modules.cjs") as {
  recommendedModuleLock: (moduleIds: Array<string>) => CubicaMechanicsIRV1Alpha1["moduleLock"];
};
const { mechanicsSha256 } = require("../../../scripts/manifest-tools/mechanics-canonicalize.cjs") as {
  mechanicsSha256: (value: unknown) => string;
};

/** Re-publish compiler-owned hashes after this test mutates its in-memory fixture. */
const republishFixtureHashes = (manifest: GameManifest): void => {
  for (const [planId, plan] of Object.entries(manifest.mechanics.plans)) {
    plan.planHash = mechanicsSha256({
      apiVersion: manifest.mechanics.apiVersion,
      budgetProfile: manifest.mechanics.budgetProfile,
      moduleLock: manifest.mechanics.moduleLock,
      stateModel: manifest.mechanics.stateModel,
      objectModels: manifest.objectModels ?? {},
      networkModels: manifest.networkModels ?? {},
      planId,
      transaction: plan.transaction
    });
  }

  for (const [actionId, action] of Object.entries(manifest.actions)) {
    const { definitionHash: _previousHash, ...definition } = action;
    const referencedPlan = manifest.mechanics.plans[action.binding.planRef]!;
    action.definitionHash = mechanicsSha256({
      apiVersion: manifest.mechanics.apiVersion,
      actionId,
      definition,
      planHash: referencedPlan.planHash
    });
  }
};

class TrackingAgentAdmissionController {
  calls = 0;

  async assertNewCommandAdmitted(): Promise<void> {
    this.calls += 1;
  }
}

type AgentManifestMutation = (manifest: GameManifest) => void;

/** Prove an invalid entry intent cannot charge admission or reach the provider. */
const assertEntryRejectedBeforeAgentCall = async (options: {
  mutate: AgentManifestMutation;
  params?: Record<string, unknown>;
  message: RegExp;
}): Promise<void> => {
  const manifest = JSON.parse(
    await readFile(path.join(repoRoot, "games", "ai-driven-choice", "game.manifest.json"), "utf8")
  ) as GameManifest;
  manifest.mechanics.moduleLock = recommendedModuleLock(Object.keys(manifest.mechanics.moduleLock));
  options.mutate(manifest);
  republishFixtureHashes(manifest);

  const access = createLocalSessionAccess("player");
  const store = new InMemorySessionStore<Record<string, unknown>>();
  const admission = new TrackingAgentAdmissionController();
  const immutableBundle = createImmutableBundleContent(
    manifest.meta.id,
    manifest as unknown as Record<string, unknown>
  );
  try {
    const created = await store.createSession({
      gameId: manifest.meta.id,
      initialState: structuredClone(manifest.state) as unknown as Record<string, unknown>,
      sessionRole: "facilitator",
      immutableBundle,
      principal: access.principal
    });
    await assert.rejects(
      new AgentTurnService(admission).runTurn({
        sessionStore: store,
        credentialSha256: access.principal.credentialSha256,
        request: {
          sessionId: created.session.sessionId,
          actionId: manifest.agentRuntime!.initialActionId,
          commandId: `cli_${"E".repeat(22)}`,
          expectedStateVersion: 0,
          params: options.params ?? {}
        }
      }),
      options.message
    );
    assert.equal(admission.calls, 0);
    assert.equal((await store.getSession(created.session.sessionId))?.version.stateVersion, 0);
  } finally {
    await store.close();
  }
};

test("Agent Turn entry intent passes role, params and Mechanics preconditions before agent admission", async (t) => {
  await t.test("authenticated principal role cannot be replaced by session metadata", async () => {
    await assertEntryRejectedBeforeAgentCall({
      mutate: (manifest) => {
        manifest.actions[manifest.agentRuntime!.initialActionId]!.allowedSessionRoles = ["facilitator"];
      },
      message: /not available to this session role/u
    });
  });

  await t.test("action-specific params schema rejects the trigger", async () => {
    await assertEntryRejectedBeforeAgentCall({
      mutate: (manifest) => {
        manifest.actions[manifest.agentRuntime!.initialActionId]!.paramsSchema = {
          type: "object",
          additionalProperties: false,
          properties: {
            choiceId: { type: "string", maxLength: 64 }
          },
          required: ["choiceId"]
        };
      },
      message: /must have required property 'choiceId'/u
    });
  });

  await t.test("failed entry Mechanics assertion prevents the agent call", async () => {
    await assertEntryRejectedBeforeAgentCall({
      mutate: (manifest) => {
        const entryAction = manifest.actions[manifest.agentRuntime!.initialActionId]!;
        const entryPlan = manifest.mechanics.plans[entryAction.binding.planRef]!;
        const assertion = entryPlan.transaction.steps[0];
        assert.equal(assertion.op, "core.assert");
        if (assertion.op === "core.assert") {
          assertion.predicate = { op: "predicate.constant", value: false };
        }
      },
      message: /not available in the current session state/u
    });
  });
});

test("Agent Turn selects the canonical first intent regardless of manifest key insertion order", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(repoRoot, "games", "ai-driven-choice", "game.manifest.json"), "utf8")
  ) as GameManifest;
  const gameId = manifest.meta.id;

  // The repository-wide migration can update platform module artifacts before
  // regenerated game files land. This behavior-focused fixture binds itself to
  // the current registry so a stale generated lock cannot mask ordering bugs.
  manifest.mechanics.moduleLock = recommendedModuleLock(Object.keys(manifest.mechanics.moduleLock));

  // Keep the trigger first and deliberately publish the later intent before
  // the earlier one. JSON object order can change when a manifest passes
  // through JSONB, so neither the catalog nor the mock agent may trust it.
  const initialActionId = manifest.agentRuntime!.initialActionId;
  const initialAction = manifest.actions[initialActionId]!;
  const canonicalFirstIntent = manifest.actions["agent.choice.resolve"]!;
  manifest.actions = {
    [initialActionId]: initialAction,
    "agent.choice.zeta": structuredClone(canonicalFirstIntent),
    "agent.choice.resolve": canonicalFirstIntent
  };
  republishFixtureHashes(manifest);

  const immutableBundle = createImmutableBundleContent(gameId, manifest as unknown as Record<string, unknown>);
  const bundleHash = immutableBundle.bundleHash;
  assert.deepEqual(Object.keys(manifest.actions), [
    "agent.request-choice",
    "agent.choice.zeta",
    "agent.choice.resolve"
  ]);
  assert.deepEqual(
    listManifestActionDefinitions({ gameId, bundleHash, manifest }).map(({ actionId }) => actionId),
    ["agent.choice.resolve", "agent.choice.zeta", "agent.request-choice"]
  );
  const access = createLocalSessionAccess("player");
  const store = new InMemorySessionStore<Record<string, unknown>>();
  const previousMockSetting = process.env.CUBICA_ENABLE_MOCK_AGENT_RUNTIME;
  process.env.CUBICA_ENABLE_MOCK_AGENT_RUNTIME = "true";

  try {
    const created = await store.createSession({
      gameId,
      initialState: structuredClone(manifest.state) as unknown as Record<string, unknown>,
      sessionRole: "player",
      immutableBundle,
      principal: access.principal
    });
    const request = {
      sessionId: created.session.sessionId,
      actionId: manifest.agentRuntime!.initialActionId,
      commandId: `cli_${"A".repeat(22)}`,
      expectedStateVersion: 0,
      params: {}
    };
    const service = new AgentTurnService(new BoundedInMemoryCommandAdmissionController({
      policy: {
        commandRate: { limit: 1, windowMs: 60_000 },
        agentTurnRate: { limit: 1, windowMs: 60_000 },
        agentTurnCost: { limit: 1, windowMs: 60_000 },
        maxSubjects: 10
      },
      now: () => 0
    }));

    const first = await service.runTurn({
      sessionStore: store,
      credentialSha256: access.principal.credentialSha256,
      request
    });
    const firstPublic = first.state.public as {
      metrics: { turns: number };
      choice: { outcome: string };
      log: Array<Record<string, unknown>>;
    };

    assert.equal(first.agentTurn.selectedIntent?.actionId, "agent.choice.resolve");
    assert.deepEqual(first.agentTurn.selectedIntent?.params, {});
    assert.equal(firstPublic.metrics.turns, 1);
    assert.equal(firstPublic.choice.outcome, "accepted");
    assert.equal(firstPublic.log.length, 1);
    assert.equal(first.version.stateVersion, 1);
    assert.equal(first.version.lastEventSequence, 1);
    assert.equal(first.receipt.status, "applied");
    assert.deepEqual(first.receipt.eventRefs, [`${created.session.sessionId}:1`]);

    let protectedReceipt: unknown;
    await store.withCommandTransaction({
      sessionId: created.session.sessionId,
      credentialSha256: access.principal.credentialSha256,
      commandId: request.commandId
    }, async ({ existingReceipt }) => {
      protectedReceipt = existingReceipt;
      return { result: undefined };
    });
    const stored = protectedReceipt as {
      result: unknown;
      audit: { triggerActionId: string; selectedActionId: string };
    };
    assert.equal(stored.audit.triggerActionId, manifest.agentRuntime!.initialActionId);
    assert.equal(stored.audit.selectedActionId, "agent.choice.resolve");
    assert.ok(JSON.stringify(stored.result).length < 64 * 1024);
    assert.equal(JSON.stringify(stored.result).includes("candidateState"), false);
    assert.equal(JSON.stringify(stored.result).includes('"secret"'), false);

    const retry = await service.runTurn({
      sessionStore: store,
      credentialSha256: access.principal.credentialSha256,
      request
    });
    const retryPublic = retry.state.public as {
      metrics: { turns: number };
      log: Array<Record<string, unknown>>;
    };

    assert.equal(retry.version.stateVersion, 1);
    assert.equal(retryPublic.metrics.turns, 1);
    assert.equal(retryPublic.log.length, 1);
    assert.deepEqual(retry.receipt, first.receipt);
    const storedEvents = await store.getSessionEvents(created.session.sessionId);
    assert.equal(storedEvents.length, 1);
    assert.equal(storedEvents[0]?.actionId, "agent.choice.resolve");
  } finally {
    if (previousMockSetting === undefined) {
      delete process.env.CUBICA_ENABLE_MOCK_AGENT_RUNTIME;
    } else {
      process.env.CUBICA_ENABLE_MOCK_AGENT_RUNTIME = previousMockSetting;
    }
    await store.close();
  }
});
