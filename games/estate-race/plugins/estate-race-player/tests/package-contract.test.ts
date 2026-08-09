/** Package-level invariants for original content and the completed S1 slice. */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const readJson = (relativePath: string) =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8")) as Record<string, unknown>;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;

const planSteps = (manifest: Record<string, any>, actionId: string) =>
  manifest.mechanics.plans[actionId].transaction.steps as Array<Record<string, any>>;

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
};

test("manifest owns a classified forty-cell original board for two to six hotseat participants", () => {
  const manifest = readJson("../../../game.manifest.json");
  const config = manifest.config as Record<string, any>;
  const actions = manifest.actions as Record<string, any>;
  const rules = (manifest.content as Record<string, any>).data.rules;
  const state = manifest.state as Record<string, any>;
  const cells = state.public.objects.boardCells as Record<string, any>;

  assert.deepEqual(config.players, { min: 2, max: 6 });
  assert.equal(config.settings.mode, "local-hotseat");
  assert.equal(Object.keys(cells).length, 40);
  assert.deepEqual(Object.values(cells).map((cell) => cell.attributes.index),
    Array.from({ length: 40 }, (_, index) => index));
  assert.deepEqual(state.playersTemplate.metrics, { cash: 1200, position: 0 });

  const kinds = Object.values(cells).map((cell) => cell.attributes.kind);
  assert.deepEqual([...new Set(kinds)].sort(), [
    "estate", "event", "fund", "go-to-jail", "jail", "neutral", "start", "tax", "transit", "utility"
  ]);
  assert.equal(kinds.filter((kind) => kind === "estate").length, 22);
  assert.equal(kinds.filter((kind) => kind === "transit").length, 4);
  assert.equal(kinds.filter((kind) => kind === "utility").length, 2);
  assert.equal(kinds.filter((kind) => kind === "tax").length, 2);
  for (const cell of Object.values(cells) as Array<Record<string, any>>) {
    if (["estate", "transit", "utility"].includes(cell.attributes.kind)) {
      assert.equal(typeof cell.attributes.group, "string");
      assert.equal(typeof cell.attributes.price, "number");
      assert.ok(Array.isArray(cell.attributes.rentScale));
    }
  }

  const actionIds = Object.keys(actions).sort();
  assert.deepEqual(actionIds.filter((id) => id.startsWith("property.buy.")), [
    "property.buy.cell-02", "property.buy.cell-05", "property.buy.cell-08", "property.buy.cell-11"
  ]);
  assert.equal(actionIds.some((id) => /(?:event|fund|card|deck)/u.test(id)), false);

  const datasetHash = createHash("sha256")
    .update(stableJson({ rules, boardCells: cells }))
    .digest("hex");
  assert.equal(datasetHash, "60046e5696519cfa766ab111205dcb96e01a0e9a6d56bc5328662b18e3da73a8");
});

test("economy actions bind exact immutable plans to typed participant and object references", () => {
  const manifest = readJson("../../../game.manifest.json") as Record<string, any>;
  const actions = manifest.actions;
  const buySteps = planSteps(manifest, "property.buy.cell-02");
  const rentSteps = planSteps(manifest, "property.rent.cell-02");
  const buyTransfer = buySteps.find((step) => step.op === "core.resource.transfer");
  const rentTransfer = rentSteps.find((step) => step.op === "core.resource.transfer");
  const ownerWrite = buySteps.find((step) => step.op === "core.entity.attributes.patch");

  assert.ok(buyTransfer);
  assert.ok(rentTransfer);
  assert.ok(ownerWrite);

  for (const [actionId, action] of Object.entries(actions) as Array<[string, Record<string, any>]>) {
    assert.deepEqual(action.binding, { kind: "mechanics-plan", planRef: actionId });
    assert.match(action.definitionHash, sha256Pattern);
    assert.match(manifest.mechanics.plans[actionId].planHash, sha256Pattern);
  }
  assert.equal(manifest.mechanics.apiVersion, "cubica.dev/mechanics/v1alpha1");
  assert.equal(manifest.mechanics.moduleLock["cubica.core"].moduleId, "cubica.core");
  assert.match(manifest.mechanics.moduleLock["cubica.core"].artifactHash, sha256Pattern);
  assert.equal(
    manifest.mechanics.moduleLock["cubica.random"].algorithmVersions.randomProvider,
    "server-crypto-random-v1"
  );
  assert.deepEqual(
    [...new Set(Object.values(manifest.mechanics.plans).flatMap((plan: any) =>
      plan.transaction.steps.map((step: any) => step.op)
    ))].sort(),
    [
      "core.assert",
      "core.entities.order",
      "core.entities.select",
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

  assert.ok(nextParticipant);
  assert.ok(turnPatch);

  const setupSteps = planSteps(manifest, "session.setup.finalize");
  const participantCollection = stateModel.collections.players;

  assert.deepEqual(participantCollection.storage, { root: "players", segments: [] });
  assert.equal(participantCollection.itemShape, "record");
  assert.equal(participantCollection.capacity, 6);
  assert.deepEqual(Object.keys(participantCollection.fields).sort(), [
    "cash", "inJail", "objects", "position", "status"
  ]);
  assert.ok(setupSteps.some((step) => step.op === "core.entities.select"));
  assert.ok(setupSteps.some((step) => step.op === "core.entities.order"));
  assert.ok(setupSteps.every((step) => step.op !== "core.entities.each"));

  // Elimination is not implemented by this game slice. Later rotation uses
  // only the setup result stored in public.turn.order until a real elimination
  // capability exists.
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
