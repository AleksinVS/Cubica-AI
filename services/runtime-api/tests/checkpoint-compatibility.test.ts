import assert from "node:assert/strict";
import { test } from "node:test";
import type { DebugCheckpointSnapshot } from "@cubica/contracts-session";
import type { GameBundle } from "../src/modules/content/manifestLoader.ts";
import { assessCheckpointCompatibility } from "../src/modules/session/checkpointCompatibility.ts";

const oldHash = `cubica-bundle-v1:sha256:${"a".repeat(64)}`;
const newHash = `cubica-bundle-v1:sha256:${"b".repeat(64)}`;
const definitionHash = `sha256:${"c".repeat(64)}`;
const planHash = `sha256:${"d".repeat(64)}`;

function bundle(hash: string): GameBundle {
  return {
    gameId: "neutral-checkpoint", bundleHash: hash,
    manifest: {
      config: { players: { min: 1, max: 2 }, turnModel: { phases: ["turn"] } },
      mechanics: {
        budgetProfile: "turn-based-standard-v1",
        stateModel: {
          types: { "fixture.integer": { kind: "integer", minimum: 0, maximum: 10 } },
          endpoints: { "public.count": { audienceRef: "public", storage: { root: "public", segments: ["count"] },
            valueType: "fixture.integer", access: "read-write" } },
          collections: {}
        },
        plans: { "fixture.timer": { planHash } }
      },
      actions: { "timer.advance": { invocation: "system", definitionHash,
        binding: { planRef: "fixture.timer" } } }
    } as unknown as GameBundle["manifest"]
  };
}

function checkpoint(): DebugCheckpointSnapshot<Record<string, unknown>> {
  return {
    metadata: { checkpointId: "checkpoint", label: "old", createdAt: new Date(), sourceStateVersion: 2 },
    sourceSessionId: "source-session", gameId: "neutral-checkpoint", bundleHash: oldHash,
    contentSourceId: "editor-source", participants: [{ seatId: "p1", playerId: "p1", kind: "human", joinState: "local" }],
    state: { players: { p1: {} }, public: { count: 2, turn: { order: ["p1"], activePlayerId: "p1", phase: "turn" } } }, schedules: []
  };
}

test("admits exact saved values under a changed bundle when the current declared model still accepts them", () => {
  assert.deepEqual(assessCheckpointCompatibility(checkpoint(), bundle(oldHash), bundle(newHash)),
    { compatibility: "compatible" });
});

test("rejects changed storage meaning, invalid values and participant bounds", () => {
  const original = bundle(oldHash);
  const changedStorage = bundle(newHash);
  (changedStorage.manifest.mechanics.stateModel.endpoints["public.count"].storage.segments as string[])[0] = "other";
  assert.deepEqual(assessCheckpointCompatibility(checkpoint(), original, changedStorage),
    { compatibility: "incompatible", compatibilityReason: "storage-bindings" });
  const invalid = checkpoint();
  invalid.state.public = { ...invalid.state.public as Record<string, unknown>, count: 12 };
  assert.deepEqual(assessCheckpointCompatibility(invalid, original, bundle(newHash)),
    { compatibility: "incompatible", compatibilityReason: "state-model" });
  const reducedPlayers = bundle(newHash);
  reducedPlayers.manifest.config.players.max = 0;
  assert.deepEqual(assessCheckpointCompatibility(checkpoint(), original, reducedPlayers),
    { compatibility: "incompatible", compatibilityReason: "participants" });
});

test("keeps schedule progress only when its current system action and plan are unchanged", () => {
  const saved: DebugCheckpointSnapshot<Record<string, unknown>> = { ...checkpoint(), schedules: [{
    scheduleId: "s".repeat(22), sessionId: "source-session", bundleHash: oldHash,
    actionId: "timer.advance", params: {}, definitionHash, trigger: {}, falsePolicy: "defer",
    maxOccurrences: 3, nextOccurrence: 2, status: "pending", createdAt: new Date(), updatedAt: new Date()
  }] };
  assert.deepEqual(assessCheckpointCompatibility(saved, bundle(oldHash), bundle(newHash)),
    { compatibility: "compatible" });
  const changedPlan = bundle(newHash);
  changedPlan.manifest.mechanics.plans["fixture.timer"].planHash = `sha256:${"e".repeat(64)}`;
  assert.deepEqual(assessCheckpointCompatibility(saved, bundle(oldHash), changedPlan),
    { compatibility: "incompatible", compatibilityReason: "schedule" });
  const removedAction = bundle(newHash);
  delete removedAction.manifest.actions["timer.advance"];
  assert.deepEqual(assessCheckpointCompatibility(saved, bundle(oldHash), removedAction),
    { compatibility: "incompatible", compatibilityReason: "schedule" });
});

for (const phase of [undefined, 3, "removed"]) {
  test(`rejects missing or invalid phase ${String(phase)} under the current turn model`, () => {
    const saved = checkpoint();
    const state = saved.state as { public: { turn: { phase?: unknown } } };
    state.public.turn.phase = phase;
    assert.deepEqual(assessCheckpointCompatibility(saved, bundle(oldHash), bundle(newHash)),
      { compatibility: "incompatible", compatibilityReason: "state-model" });
  });
}

test("does not carry historical controller authority into a different current session mode", () => {
  const original = bundle(oldHash);
  const current = bundle(newHash);
  current.manifest.config.sessionMode = "facilitated";
  assert.deepEqual(assessCheckpointCompatibility(checkpoint(), original, current),
    { compatibility: "incompatible", compatibilityReason: "runtime-policy" });
  const facilitated = { ...checkpoint(), sessionRole: "facilitator" as const };
  assert.deepEqual(assessCheckpointCompatibility(facilitated, original, bundle(newHash)),
    { compatibility: "incompatible", compatibilityReason: "runtime-policy" });
});
