/** Package-level invariants for original content and the bounded first slice. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readJson = (relativePath: string) =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as Record<string, unknown>;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;

const planSteps = (manifest: Record<string, any>, actionId: string) =>
  manifest.mechanics.plans[actionId].transaction.steps as Array<Record<string, any>>;

test("manifest owns a twelve-cell original board and exactly two hotseat participants", () => {
  const manifest = readJson("../../../game.manifest.json");
  const config = manifest.config as Record<string, any>;
  const state = manifest.state as Record<string, any>;
  const cells = state.public.objects.boardCells as Record<string, any>;

  assert.deepEqual(config.players, { min: 2, max: 2 });
  assert.equal(config.settings.mode, "local-hotseat");
  assert.equal(Object.keys(cells).length, 12);
  assert.deepEqual(Object.values(cells).map((cell) => cell.attributes.index),
    Array.from({ length: 12 }, (_, index) => index));
  assert.deepEqual(state.playersTemplate.metrics, { cash: 900, position: 0 });
});

test("economy actions bind exact immutable plans to typed participant and object references", () => {
  const manifest = readJson("../../../game.manifest.json") as Record<string, any>;
  const actions = manifest.actions;
  const buy = actions["property.buy.cell-02"];
  const rent = actions["property.rent.cell-02"];
  const buySteps = planSteps(manifest, "property.buy.cell-02");
  const rentSteps = planSteps(manifest, "property.rent.cell-02");
  const buyTransfer = buySteps.find((step) => step.op === "core.resource.transfer");
  const rentTransfer = rentSteps.find((step) => step.op === "core.resource.transfer");
  const ownerWrite = buySteps.find((step) => step.op === "core.entity.attributes.patch");

  for (const [actionId, action] of Object.entries(actions) as Array<[string, Record<string, any>]>) {
    assert.deepEqual(action.binding, { kind: "mechanics-plan", planRef: actionId });
    assert.match(action.definitionHash, sha256Pattern);
    assert.match(manifest.mechanics.plans[actionId].planHash, sha256Pattern);
  }
  assert.equal(manifest.mechanics.apiVersion, "cubica.dev/mechanics/v1alpha1");
  assert.equal(manifest.mechanics.moduleLock["cubica.core"].moduleId, "cubica.core");
  assert.match(manifest.mechanics.moduleLock["cubica.core"].artifactHash, sha256Pattern);
  assert.equal(manifest.mechanics.moduleLock["cubica.random"].algorithmVersions.randomStreams, "xoshiro128ss-streams-v1");
  assert.deepEqual(
    [...new Set(Object.values(manifest.mechanics.plans).flatMap((plan: any) =>
      plan.transaction.steps.map((step: any) => step.op)
    ))].sort(),
    [
      "core.assert",
      "core.entity.attributes.patch",
      "core.event.emit",
      "core.number.add",
      "core.resource.transfer",
      "core.sequence.next",
      "core.state.patch",
      "random.dice.roll",
      "turn.phase.select"
    ]
  );

  assert.deepEqual(ownerWrite.entity, {
    collection: "boardCells",
    entityId: { op: "value.param", name: "cellId" }
  });
  assert.equal(manifest.mechanics.stateModel.collections.boardCells.fields.ownerPlayerId.valueType, "core.string");
  assert.deepEqual(manifest.mechanics.stateModel.endpoints["participant.metrics.cash"].storage, {
    root: "players",
    segments: [{ binding: "participantId" }, "metrics", "cash"]
  });
  assert.equal(manifest.mechanics.stateModel.endpoints["participant.metrics.cash"].access, "read-write");

  assert.deepEqual(buyTransfer.from, {
    kind: "state",
    target: {
      endpoint: "participant.metrics.cash",
      bindings: {
        participantId: { op: "value.actor" }
      }
    }
  });
  assert.deepEqual(buyTransfer.to, { kind: "bank" });
  assert.equal(buyTransfer.onInsufficient, "fail");
  assert.deepEqual(rentTransfer.to, {
    kind: "state",
    target: {
      endpoint: "participant.metrics.cash",
      bindings: {
        participantId: {
          op: "value.state",
          ref: { endpoint: "public.objects.boardCells.cell-02.attributes.ownerPlayerId" }
        }
      }
    }
  });
  assert.deepEqual(
    manifest.mechanics.stateModel.endpoints["public.objects.boardCells.cell-02.attributes.ownerPlayerId"].storage,
    {
      root: "public",
      segments: ["objects", "boardCells", "cell-02", "attributes", "ownerPlayerId"]
    }
  );
});

test("turn completion is an explicit typed composition with no legacy shortcuts", () => {
  const manifest = readJson("../../../game.manifest.json") as Record<string, any>;
  const stateModel = manifest.mechanics.stateModel;
  const turnSteps = planSteps(manifest, "turn.finish");
  const nextParticipant = turnSteps.find((step) => step.op === "core.sequence.next");
  const turnPatch = turnSteps.find((step) =>
    step.op === "core.state.patch" &&
    step.patches.some((patch: any) => patch.target.endpoint === "public.turn.activePlayerId")
  );
  const serializedManifest = JSON.stringify(manifest);

  // Elimination is not implemented by this game slice. Publishing a broad
  // collection over every player's state would claim visibility and fields
  // that the game never exposes or mutates, so turn rotation uses only the
  // declared public order until a real elimination capability exists.
  assert.equal(Object.hasOwn(stateModel.collections, "participants"), false);
  assert.equal(Object.hasOwn(nextParticipant, "exclude"), false);
  assert.deepEqual(turnPatch.patches, [
    {
      operation: "set",
      target: { endpoint: "public.turn.activePlayerId" },
      value: { op: "value.result", stepId: "s002-next-participant" }
    },
    {
      operation: "increment",
      target: { endpoint: "public.turn.turnNumber" },
      value: { op: "value.literal", value: 1 }
    },
    {
      operation: "set",
      target: { endpoint: "public.turn.phase" },
      value: { op: "value.literal", value: "roll" }
    }
  ]);
  assert.doesNotMatch(serializedManifest, /"op":"turn\.advance"/u);
  assert.doesNotMatch(serializedManifest, /"kind":"player-metric"/u);
  assert.doesNotMatch(serializedManifest, /"op":"value\.param","name":"actor"/u);
});

test("package text contains no protected classic board names or trade dress claims", () => {
  const manifestText = readFileSync(new URL("../../../game.manifest.json", import.meta.url), "utf8");
  for (const forbidden of ["Monopoly", "Монополия", "Boardwalk", "Park Place", "GO TO JAIL", "Chance"]) {
    assert.equal(manifestText.includes(forbidden), false, `unexpected protected marker: ${forbidden}`);
  }
  assert.match(manifestText, /Липовая аллея/);
  assert.match(manifestText, /Оранжерейный проезд/);
});
