/**
 * Focused proof for protected scheduled-action execution.
 *
 * The fixture derives a system-only target from the neutral Simple Choice
 * package, then recomputes compiler-owned identities. This exercises the real
 * immutable-bundle loader, in-memory transaction boundary and receipt ledger
 * without introducing a game-specific scheduler branch.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import type {
  GameManifest,
  Predicate,
  Step
} from "@cubica/contracts-manifest";
import type {
  SessionCommandReceipt,
  SessionRecord,
  SessionSystemSchedule
} from "@cubica/contracts-session";

import type { GameBundle } from "../src/modules/content/manifestLoader.ts";
import { createImmutableBundleContent } from "../src/modules/content/immutableBundle.ts";
import {
  executeProtectedSystemIntentCandidate,
  executePublishedGameIntentCandidate
} from "../src/modules/runtime/actionDispatcher.ts";
import { dispatchRuntimeSystemAction } from "../src/modules/runtime/systemActionDispatcher.ts";
import {
  createAppliedCommandReceipt,
  createDurableCommandResult,
  createExternalCommandFingerprint,
  createSystemCommandId
} from "../src/modules/session/commandIdentity.ts";
import { createLocalSessionAccess } from "../src/modules/session/sessionAuthentication.ts";
import { InMemorySessionStore } from "../src/modules/session/inMemorySessionStore.ts";

const require = createRequire(import.meta.url);
const { mechanicsSha256 } = require("../../../scripts/manifest-tools/mechanics-canonicalize.cjs") as {
  mechanicsSha256: (value: unknown) => string;
};
const { recommendedModuleLock } = require("../../../scripts/manifest-tools/mechanics-modules.cjs") as {
  recommendedModuleLock: (moduleIds: Array<string>) => GameManifest["mechanics"]["moduleLock"];
};

const TARGET_ACTION_ID = "choice.accept";
const SCHEDULE_ID = "ScheduleOpaqueId000001";
const REGISTRATION_COMMAND_ID = `cli_${"R".repeat(22)}`;
const TARGET_PLAN_ID = "choice.accept";
const TRUE_TRIGGER: Predicate = { op: "predicate.constant", value: true };
const FALSE_TRIGGER: Predicate = { op: "predicate.constant", value: false };

test("false protected trigger defers without executing the target plan", async () => {
  const fixture = await createStoredFixture(FALSE_TRIGGER, "defer");
  try {
    const versionBefore = fixture.registrationSnapshot.version.stateVersion;
    const scoreBefore = readScore(fixture.registrationSnapshot);
    const outcome = await dispatchRuntimeSystemAction({
      sessionStore: fixture.store,
      sessionId: fixture.sessionId,
      scheduleId: SCHEDULE_ID,
      occurrence: 1,
      commandId: createSystemCommandId(fixture.sessionId, SCHEDULE_ID, 1)
    });

    assert.equal(outcome.status, "deferred");
    assert.equal(outcome.snapshot.version.stateVersion, versionBefore);
    assert.equal(readScore(outcome.snapshot), scoreBefore);
    const [pending] = await fixture.store.listPendingSystemSchedules(fixture.sessionId);
    assert.equal(pending?.nextOccurrence, 1);
  } finally {
    await fixture.store.close();
  }
});

test("one system receipt audit contains the trigger and every target step", async () => {
  const fixture = await createStoredFixture(TRUE_TRIGGER, "defer");
  const systemCommandId = createSystemCommandId(fixture.sessionId, SCHEDULE_ID, 1);
  try {
    const outcome = await dispatchRuntimeSystemAction({
      sessionStore: fixture.store,
      sessionId: fixture.sessionId,
      scheduleId: SCHEDULE_ID,
      occurrence: 1,
      commandId: systemCommandId
    });
    assert.equal(outcome.status, "applied");
    assert.equal(outcome.receipt?.planHash, fixture.targetPlanHash);

    let protectedReceipt: SessionCommandReceipt | undefined;
    await fixture.store.withSystemCommandTransaction({
      sessionId: fixture.sessionId,
      scheduleId: SCHEDULE_ID,
      occurrence: 1,
      commandId: systemCommandId
    }, async ({ existingReceipt }) => {
      protectedReceipt = existingReceipt;
      return { result: undefined, scheduleDisposition: "defer" };
    });

    const mechanicsAudit = protectedReceipt?.audit.mechanics;
    assert.ok(mechanicsAudit);
    const targetStepIds = fixture.manifest.mechanics.plans[TARGET_PLAN_ID].transaction.steps
      .map((step) => step.id);
    assert.match(mechanicsAudit.steps[0]?.stepId ?? "", /^system\.trigger\.[a-f0-9]{64}$/u);
    assert.equal(mechanicsAudit.steps[0]?.operation, "core.assert");
    assert.deepEqual(
      mechanicsAudit.steps.slice(1).map((step) => step.stepId),
      targetStepIds
    );
    assert.equal(mechanicsAudit.cost.steps, targetStepIds.length + 1);
    assert.equal(protectedReceipt?.planHash, fixture.targetPlanHash);
  } finally {
    await fixture.store.close();
  }
});

test("trigger and target share one runtime step budget", async () => {
  const manifest = createSystemManifest();
  const budgetSteps = Array.from(
    { length: 512 },
    (_, index): Step => ({
      id: `budget-${index}`,
      kind: "assert",
      op: "core.assert",
      predicate: TRUE_TRIGGER,
      errorCode: "FIXTURE_ASSERTION_FAILED"
    })
  );
  manifest.mechanics.plans[TARGET_PLAN_ID].transaction.steps = [
    budgetSteps[0]!,
    ...budgetSteps.slice(1)
  ];
  finalizeCompilerIdentities(manifest);
  const bundle = createGameBundle(manifest);
  const result = await executeProtectedSystemIntentCandidate({
    bundle,
    state: structuredClone(manifest.state) as unknown as Record<string, unknown>,
    sessionId: "fixture-budget-session",
    actionId: TARGET_ACTION_ID,
    params: {},
    sessionRole: "assistant",
    scheduleId: SCHEDULE_ID,
    trigger: TRUE_TRIGGER
  });

  assert.equal(result.triggerPassed, true);
  assert.equal(result.result.ok, false);
  assert.equal(result.result.error?.code, "MECHANICS_RUNTIME_BUDGET_EXCEEDED");
});

test("public and Agent candidate API cannot select a system-only target", async () => {
  const manifest = createSystemManifest();
  const bundle = createGameBundle(manifest);

  await assert.rejects(
    executePublishedGameIntentCandidate({
      bundle,
      state: structuredClone(manifest.state) as unknown as Record<string, unknown>,
      actionId: TARGET_ACTION_ID,
      params: {},
      sessionRole: "assistant"
    }),
    /not defined for this invocation path/u
  );
});

interface StoredFixture {
  store: InMemorySessionStore<Record<string, unknown>>;
  sessionId: string;
  manifest: GameManifest;
  registrationSnapshot: SessionRecord<Record<string, unknown>>;
  targetPlanHash: string;
}

async function createStoredFixture(
  trigger: Predicate,
  falsePolicy: SessionSystemSchedule["falsePolicy"]
): Promise<StoredFixture> {
  const manifest = createSystemManifest();
  const immutableBundle = createImmutableBundleContent(
    manifest.meta.id,
    manifest as unknown as Record<string, unknown>
  );
  const access = createLocalSessionAccess("facilitator");
  const store = new InMemorySessionStore<Record<string, unknown>>();
  const created = await store.createSession({
    gameId: manifest.meta.id,
    initialState: structuredClone(manifest.state) as unknown as Record<string, unknown>,
    immutableBundle,
    principal: access.principal
  });
  const definition = manifest.actions[TARGET_ACTION_ID];
  const targetPlan = manifest.mechanics.plans[TARGET_PLAN_ID];
  const schedule: SessionSystemSchedule = {
    scheduleId: SCHEDULE_ID,
    sessionId: created.session.sessionId,
    bundleHash: created.session.bundleHash,
    actionId: TARGET_ACTION_ID,
    params: {},
    definitionHash: definition.definitionHash,
    trigger: structuredClone(trigger),
    falsePolicy,
    maxOccurrences: 1,
    nextOccurrence: 1,
    status: "pending",
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const registrationSnapshot = await store.withCommandTransaction({
    sessionId: created.session.sessionId,
    commandId: REGISTRATION_COMMAND_ID,
    credentialSha256: access.principal.credentialSha256
  }, async ({ currentSession, principal }) => {
    const after: SessionRecord<Record<string, unknown>> = {
      ...currentSession,
      version: {
        sessionId: currentSession.sessionId,
        stateVersion: currentSession.version.stateVersion + 1,
        lastEventSequence: currentSession.version.lastEventSequence
      },
      updatedAt: new Date()
    };
    const command = {
      sessionId: currentSession.sessionId,
      actionId: "fixture.schedule.register",
      commandId: REGISTRATION_COMMAND_ID,
      expectedStateVersion: currentSession.version.stateVersion,
      params: {}
    };
    const registrationDefinitionHash = `sha256:${"1".repeat(64)}`;
    const receipt = createAppliedCommandReceipt({
      command,
      principal,
      before: currentSession,
      after,
      fingerprint: createExternalCommandFingerprint({
        command,
        bundleHash: currentSession.bundleHash,
        definitionHash: registrationDefinitionHash
      }),
      definitionHash: registrationDefinitionHash,
      durableResult: createDurableCommandResult("game-intent", { ok: true })
    });
    return {
      result: after,
      updatedSession: after,
      receipt,
      scheduleMutations: [{ kind: "register", schedule }]
    };
  });

  return {
    store,
    sessionId: created.session.sessionId,
    manifest,
    registrationSnapshot,
    targetPlanHash: targetPlan.planHash
  };
}

function createSystemManifest(): GameManifest {
  const source = JSON.parse(readFileSync(
    new URL("../../../games/simple-choice/game.manifest.json", import.meta.url),
    "utf8"
  )) as GameManifest;
  const manifest = structuredClone(source);
  manifest.mechanics.moduleLock = recommendedModuleLock(["cubica.core"]);
  manifest.actions[TARGET_ACTION_ID].invocation = "system";
  finalizeCompilerIdentities(manifest);
  return manifest;
}

function finalizeCompilerIdentities(manifest: GameManifest): void {
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
    const definition = structuredClone(action) as typeof action;
    delete (definition as Partial<typeof definition>).definitionHash;
    const plan = manifest.mechanics.plans[action.binding.planRef];
    action.definitionHash = mechanicsSha256({
      apiVersion: manifest.mechanics.apiVersion,
      actionId,
      definition,
      planHash: plan.planHash
    });
  }
}

function createGameBundle(manifest: GameManifest): GameBundle {
  const immutable = createImmutableBundleContent(
    manifest.meta.id,
    manifest as unknown as Record<string, unknown>
  );
  return {
    gameId: manifest.meta.id,
    bundleHash: immutable.bundleHash,
    manifest
  };
}

function readScore(snapshot: SessionRecord<Record<string, unknown>>): number | undefined {
  const publicState = snapshot.state.public as Record<string, unknown> | undefined;
  const metrics = publicState?.metrics as Record<string, unknown> | undefined;
  return typeof metrics?.score === "number" ? metrics.score : undefined;
}
