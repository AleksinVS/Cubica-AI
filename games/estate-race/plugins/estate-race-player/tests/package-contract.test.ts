/** Package-level invariants for original content and the public Estate Race surface. */

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

  assert.equal((manifest.meta as Record<string, unknown>).version, "0.7.0");
  assert.deepEqual(config.players, { min: 2, max: 6 });
  assert.equal(config.settings.mode, "local-hotseat");
  assert.equal(Object.keys(cells).length, 40);
  assert.deepEqual(Object.values(cells).map((cell) => cell.attributes.index),
    Array.from({ length: 40 }, (_, index) => index));
  assert.deepEqual(state.playersTemplate.metrics, { cash: 1200, position: 0, jailAttempts: 0 });

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
  assert.deepEqual(actionIds.filter((id) => id.startsWith("property.")).sort(), [
    "property.auction.bid",
    "property.auction.pass",
    "property.build",
    "property.build.auction.bid",
    "property.build.auction.pass",
    "property.build.pass",
    "property.build.request",
    "property.buy",
    "property.decline",
    "property.mortgage",
    "property.redeem",
    "property.rent",
    "property.sell"
  ]);
  assert.deepEqual(actionIds.filter((id) => id.startsWith("jail.")), [
    "jail.card.use.event",
    "jail.card.use.fund",
    "jail.pay",
    "jail.roll",
    "jail.third.move"
  ]);
  assert.deepEqual(actionIds.filter((id) => /^(?:trade\.|obligation\.|bankruptcy\.|mortgage\.transfer\.|liquidation\.)/u.test(id)), [
    "bankruptcy.declare",
    "liquidation.card.claim",
    "mortgage.transfer.keep",
    "mortgage.transfer.redeem",
    "obligation.resolve",
    "trade.accept",
    "trade.asset.remove",
    "trade.asset.set",
    "trade.cancel",
    "trade.card.claim",
    "trade.card.offer",
    "trade.card.offer.remove",
    "trade.card.request",
    "trade.card.request.remove",
    "trade.cash.set",
    "trade.decline",
    "trade.open",
    "trade.propose"
  ]);
  assert.equal(actionIds.some((id) => /^(?:event|fund|deck)\./u.test(id)), false);

  const s1Rules = {
    boardSize: rules.boardSize,
    dice: rules.dice,
    startingCash: rules.startingCash,
    lapReward: rules.lapReward,
    ownership: rules.ownership,
    debtAllowed: rules.debtAllowed
  };
  const s1BoardCells = Object.fromEntries(Object.entries(cells).map(([id, cell]) => {
    const {
      buildCost: _buildCost,
      improvementTier: _improvementTier,
      liquidationPending: _liquidationPending,
      mortgageValue: _mortgageValue,
      mortgageTransferPending: _mortgageTransferPending,
      mortgaged: _mortgaged,
      redeemCost: _redeemCost,
      rent0: _rent0,
      rent1: _rent1,
      rent2: _rent2,
      rent3: _rent3,
      rent4: _rent4,
      rent5: _rent5,
      sellValue: _sellValue,
      tradeSide: _tradeSide,
      transferFee: _transferFee,
      ...s1Attributes
    } = cell.attributes;
    return [id, { ...cell, attributes: s1Attributes }];
  }));
  const datasetHash = createHash("sha256")
    .update(stableJson({ rules: s1Rules, boardCells: s1BoardCells }))
    .digest("hex");
  assert.equal(datasetHash, "60046e5696519cfa766ab111205dcb96e01a0e9a6d56bc5328662b18e3da73a8");

  const s3DatasetHash = createHash("sha256")
    .update(stableJson({
      eventCards: Object.fromEntries([
        "event-credit", "event-advance", "event-retreat", "event-jail", "event-exit", "event-message"
      ].map((id) => [id, state.public.objects.eventCards[id]])),
      fundCards: Object.fromEntries([
        "fund-debit", "fund-pay-each", "fund-collect-each", "fund-start", "fund-message"
      ].map((id) => [id, state.public.objects.fundCards[id]])),
      jailFee: rules.jailFee
    }))
    .digest("hex");
  assert.equal(s3DatasetHash, "2c47121f60f28ccdb59597368baf134216d483d6cc05dab79de7d65d3eb6e611");

  const purchasableCells = Object.fromEntries(Object.entries(cells)
    .filter(([, cell]) => ["estate", "transit", "utility"].includes(cell.attributes.kind))
    .map(([id, cell]) => [id, {
      kind: cell.attributes.kind,
      group: cell.attributes.group,
      rent0: cell.attributes.rent0,
      rent1: cell.attributes.rent1,
      rent2: cell.attributes.rent2,
      rent3: cell.attributes.rent3,
      rent4: cell.attributes.rent4,
      rent5: cell.attributes.rent5,
      improvementTier: cell.attributes.improvementTier,
      mortgaged: cell.attributes.mortgaged,
      buildCost: cell.attributes.buildCost,
      sellValue: cell.attributes.sellValue,
      mortgageValue: cell.attributes.mortgageValue,
      redeemCost: cell.attributes.redeemCost
    }]));
  const s4DatasetHash = createHash("sha256")
    .update(stableJson({
      bankBuildings: state.public.bankBuildings,
      purchasableCells,
      assessmentCard: state.public.objects.fundCards["fund-assessment"]
    }))
    .digest("hex");
  assert.equal(s4DatasetHash, "e8dd8fd14d48da2c681cb1deabc5dbd17aeb53b9b01b5137bd2a8ca49ff0a1f8");
  assert.deepEqual(state.public.bankBuildings, { housesAvailable: 32, hotelsAvailable: 12 });
  assert.deepEqual(state.public.outcome, {
    status: "active",
    winnerPlayerId: null,
    reason: "none"
  });
  assert.equal(state.public.objects.fundCards["fund-assessment"].attributes.effectKind,
    "building-assessment");

  const transferFees = Object.fromEntries(Object.entries(cells)
    .filter(([, cell]) => ["estate", "transit", "utility"].includes(cell.attributes.kind))
    .map(([id, cell]) => [id, cell.attributes.transferFee]));
  const s5DatasetHash = createHash("sha256")
    .update(stableJson({
      fundExitCard: state.public.objects.fundCards["fund-exit"],
      transferFees
    }))
    .digest("hex");
  assert.equal(s5DatasetHash, "b022d448d23ed646e832ffa129b5186dcb71ee341b520b633632f13772f7a4ac");
});

test("economy actions bind exact immutable plans to typed participant and object references", () => {
  const manifest = readJson("../../../game.manifest.json") as Record<string, any>;
  const actions = manifest.actions;
  const buySteps = planSteps(manifest, "property.buy");
  const rentSteps = planSteps(manifest, "property.rent");
  const buyTransfer = buySteps.find((step) => step.op === "core.resource.transfer");
  const rentIteration = rentSteps.find((step) => step.id === "rent-payment");
  const rentTransfer = rentIteration?.body?.find((step: Record<string, any>) =>
    step.op === "core.resource.transfer"
  );
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
      "core.entities.each",
      "core.entities.order",
      "core.entities.select",
      "core.entity.attributes.patch",
      "core.event.emit",
      "core.number.add",
      "core.resource.transfer",
      "core.sequence.next",
      "core.state.patch",
      "deck.draw",
      "deck.extract",
      "deck.return",
      "deck.shuffle",
      "random.dice.roll",
      "turn.phase.select"
    ]
  );

  assert.deepEqual(ownerWrite.entity, {
    collection: "boardCells",
    entityId: { op: "value.result", stepId: "landing-cell", path: ["ids", "0"] }
  });
  assert.equal(manifest.mechanics.stateModel.collections.boardCells.fields.ownerPlayerId.valueType,
    "core.optional-string");
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
          op: "value.item",
          area: "identity",
          field: "id"
        }
      }
    }
  });
  assert.equal(manifest.mechanics.stateModel.collections.boardCells.fields.price.valueType, "core.integer");
  assert.equal(manifest.mechanics.stateModel.collections.boardCells.fields.rent.valueType, "core.integer");
  assert.equal(manifest.mechanics.stateModel.collections.boardCells.fields.rentScale.valueType, "game.rent-scale");
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
    "bidderStatus", "buildingRequestCellId", "buildingRequestUnitKind", "cash", "inJail",
    "jailAttempts", "liabilityAmount", "liabilityCreditorId", "liabilityStatus", "position", "status"
  ]);
  assert.equal(Object.hasOwn(participantCollection.fields, "heldExitCardId"), false);
  assert.equal(stateModel.endpoints["actor.objects.heldExitCardId"].audienceRef, "actor");
  assert.equal(stateModel.endpoints["actor.objects.heldExitCardId2"].audienceRef, "actor");
  assert.ok(setupSteps.some((step) => step.op === "core.entities.select"));
  assert.ok(setupSteps.some((step) => step.op === "core.entities.order"));
  assert.ok(setupSteps.every((step) => step.op !== "core.entities.each"));

  // Elimination stays game-owned: the neutral sequence operation only consumes
  // the declared record-map status field and never interprets Estate Race rules.
  assert.equal(Object.hasOwn(stateModel.collections, "participants"), false);
  assert.deepEqual(nextParticipant.exclude, {
    collection: "players",
    field: "status",
    values: [{ op: "value.literal", value: "eliminated" }]
  });
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

test("authoring publishes the standalone Estate Race name and read-only optional methodology", () => {
  const authoring = readJson("../../../authoring/game.authoring.json") as Record<string, any>;
  const ui = readJson("../../../authoring/ui/web.authoring.json") as Record<string, any>;
  const meta = authoring.root.meta;
  const methodology = authoring.root.content.data.methodology;
  const serializedPlayerCopy = JSON.stringify({
    meta,
    ui: ui.root
  });

  assert.equal(meta.name, "Estate Race");
  assert.equal(meta.version, "0.7.0");
  assert.equal(meta.tags.includes("prototype"), false);
  assert.doesNotMatch(serializedPlayerCopy, /прототип|· S\d|UI S\d/u);
  assert.equal(ui.root.screens[0].title, "Estate Race");
  assert.equal(ui.root.meta.version, "0.7.0");
  assert.equal(ui.root.meta.game_manifest_version, "0.7.0");
  assert.equal(ui.root.screens[0].layout_mode, "map-first");
  assert.equal(ui.root.default_layout_mode, "map-first");

  assert.deepEqual(methodology.mode, {
    id: "guided-review",
    title: "Партия с разбором решений",
    description: "Необязательный формат: ведущий делает короткие паузы после значимых решений и обсуждает их, не меняя ход партии.",
    optional: true,
    defaultEnabled: false,
    readOnly: true
  });
  assert.equal(methodology.competencies.length, 4);
  assert.equal(methodology.participantPrompts.length, 4);
  assert.equal(methodology.facilitatorNotes.length, 4);
  assert.equal(methodology.reflectionQuestions.length, 4);
  assert.equal("actionId" in methodology, false);
  assert.equal("state" in methodology, false);
  assert.equal("mechanics" in methodology, false);
});

test("design reference is original, self-contained and paired with narrow-layout intent", () => {
  const provenance = readJson("../../../design/provenance.json") as Record<string, any>;
  const svg = readFileSync(new URL("../../../design/estate-race-board-reference.svg", import.meta.url), "utf8");
  const narrowIntent = readFileSync(new URL("../../../design/narrow-layout-intent.md", import.meta.url), "utf8");

  assert.equal(provenance.origin, "original");
  assert.equal(provenance.createdAt, "2026-08-12");
  assert.deepEqual(provenance.externalAssets, []);
  assert.deepEqual(provenance.externalFonts, []);
  const reference = provenance.artifacts.find((artifact: Record<string, unknown>) =>
    artifact.path === "estate-race-board-reference.svg"
  );
  assert.equal(reference?.sha256, createHash("sha256").update(svg).digest("hex"));
  assert.match(svg, /width="1400" height="1000" viewBox="0 0 1400 1000"/u);
  assert.doesNotMatch(svg, /<image\b|(?:href|src)="https?:\/\//u);
  assert.doesNotMatch(
    svg,
    /<text[^>]*class="detail"[^>]*>[^<]*(?:монет|сбор\s+\d|\d+\s*·\s*\d)/u
  );
  assert.match(narrowIntent, /prefers-reduced-motion: reduce/u);
  assert.match(narrowIntent, /DOM-кнопки и формы/u);
  assert.match(narrowIntent, /не\s+является\s+источником\s+цен/u);
});

test("scene keeps form actions in the accessible DOM and respects reduced motion", () => {
  const scene = readFileSync(new URL("../src/scene.ts", import.meta.url), "utf8");
  const accessible = readFileSync(new URL("../src/accessible-actions.ts", import.meta.url), "utf8");

  for (const actionId of [
    "property.auction.bid",
    "property.build.request",
    "trade.cash.set",
    "bankruptcy.declare"
  ]) {
    assert.match(scene, new RegExp(JSON.stringify(actionId)));
    assert.match(accessible, new RegExp(JSON.stringify(actionId)));
  }
  assert.match(scene, /prefers-reduced-motion: reduce/u);
  assert.match(scene, /!this\.prefersReducedMotion\(\)/u);
  assert.match(scene, /projectEstateRaceSession\(currentSession\)/u);
  assert.doesNotMatch(scene, /winner\s*=\s*projection\.players\.sort|cash\s*[+*/-]=/u);
});
