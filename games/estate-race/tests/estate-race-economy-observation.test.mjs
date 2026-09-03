import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import manifest from "../game.manifest.json" with { type: "json" };
import authoring from "../authoring/game.authoring.json" with { type: "json" };
import {
  buildEconomyObservationReport,
  canonicalStringify,
  runCli,
  sha256
} from "../scripts/economy-observation-report.mjs";

const at = (second) => new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString();
const entry = (sequence, eventType, data, second = sequence) => ({
  eventId: `event-${sequence}`,
  sequence,
  eventType,
  occurredAt: at(second),
  summary: eventType,
  data
});
const journal = (sessionId, entries, gameId = "estate-race") => ({
  format: "cubica.public-gameplay-journal",
  schemaVersion: "1.0.0",
  sessionId,
  gameId,
  lifecycle: "archived",
  sessionCreatedAt: at(0),
  archivedAt: at(30),
  throughEventSequence: entries.at(-1)?.sequence ?? 0,
  entries
});
const roll = (sequence, second = sequence) => entry(sequence, "estate-race.turn.rolled", { kind: "movement" }, second);
const completedTurn = (sequence, second = sequence) => entry(sequence, "estate-race.turn.completed", { kind: "turn" }, second);
const ownership = (sequence, cellId, ownerPlayerId, acquisitionMethod, amount, second = sequence) => entry(
  sequence,
  "estate-race.property.ownership",
  {
    cellId,
    ownerKind: ownerPlayerId === null ? "bank" : "player",
    ...(ownerPlayerId === null ? {} : { ownerPlayerId }),
    acquisitionMethod,
    ...(amount === undefined ? {} : { amount })
  },
  second
);

function completeJournal(sessionId = "sample-a", gameId = "estate-race") {
  return journal(sessionId, [
    roll(1),
    ownership(2, "cell-01", "p1", "direct-purchase", 90),
    ownership(3, "cell-02", "p1", "auction", 110),
    entry(4, "estate-race.building.placed", { cellId: "cell-01", ownerPlayerId: "p1", improvementTier: 1 }),
    entry(5, "property.rent", { cellId: "cell-01", payerPlayerId: "p2", ownerPlayerId: "p1", amount: 320, improvementTier: 4 }),
    roll(6),
    roll(7),
    completedTurn(8),
    roll(9),
    entry(10, "estate-race.bankruptcy", { debtorPlayerId: "unrelated" }),
    entry(11, "estate-race.bankruptcy", { debtorPlayerId: "p2" }),
    entry(12, "estate-race.terminal", { kind: "terminal", winnerPlayerId: "p1", reason: "last-active-player" })
  ], gameId);
}

const input = (journals) => ({
  manifest,
  balanceAuthoring: authoring,
  journals
});

test("reports turns, acquisitions, auction ratio, tier-4-to-bankruptcy, and elapsed pause-inclusive time", () => {
  const report = buildEconomyObservationReport(input([completeJournal()]));
  assert.equal(report.schemaVersion, "estate-race-economy-observation-report-v1");
  assert.equal(report.gameId, "estate-race");
  assert.deepEqual(report.inputs, {
    journalSha256: [sha256(canonicalStringify(completeJournal()))],
    manifestSha256: sha256(manifest),
    balanceInputSha256: "9e1ac64d249f958e162308c012eb423dc8757d6627f976b8c264b32c0120134b",
    sampleCount: 1
  });
  assert.deepEqual(report.samples[0], {
    sessionId: "sample-a",
    turnsToFirstCompleteOwnableGroup: 1,
    turnsToFirstBuilding: 1,
    turnsToFirstBankruptcy: 2,
    turnsToTerminal: 2,
    directAcquisitionCount: 1,
    auctionAcquisitionCount: 1,
    auctionObservations: [{ cellId: "cell-02", paid: 110, listedPrice: 120, ratio: { numerator: 110, denominator: 120 } }],
    tier4RentToBankruptcyTurns: 1,
    observedElapsedMilliseconds: 11000
  });
});

test("replaying ownership handles bank reset and creditor transfer before group completion", () => {
  const sample = journal("transfer", [
    roll(1),
    ownership(2, "cell-01", "p1", "direct-purchase", 90),
    ownership(3, "cell-02", "p3", "direct-purchase", 120),
    ownership(4, "cell-01", null, "bank-reversion"),
    ownership(5, "cell-01", "p2", "creditor-transfer"),
    ownership(6, "cell-02", "p2", "trade"),
    roll(7),
    entry(8, "estate-race.terminal", { kind: "terminal", winnerPlayerId: "p2", reason: "last-active-player" })
  ]);
  const result = buildEconomyObservationReport(input([sample])).samples[0];
  assert.equal(result.turnsToFirstCompleteOwnableGroup, 1);
  assert.equal(result.directAcquisitionCount, 2);
  assert.equal(result.auctionAcquisitionCount, 0);
});

test("duplicate exact retries are ignored and output is invariant under file order", () => {
  const first = completeJournal("a");
  const second = completeJournal("b");
  const forward = buildEconomyObservationReport(input([first, second, first]));
  const reverse = buildEconomyObservationReport(input([second, first]));
  assert.deepEqual(reverse, forward);
  assert.equal(forward.inputs.sampleCount, 2);
});

test("rejects wrong game, nonterminal samples, malformed S12 data, and event order", () => {
  assert.throws(() => buildEconomyObservationReport(input([completeJournal("wrong", "other-game")])), /gameId/);
  const noTerminal = completeJournal("no-terminal");
  noTerminal.entries.pop();
  noTerminal.throughEventSequence = noTerminal.entries.at(-1).sequence;
  assert.throws(() => buildEconomyObservationReport(input([noTerminal])), /missing estate-race\.terminal/);
  const malformed = completeJournal("malformed");
  delete malformed.entries[1].data.cellId;
  assert.throws(() => buildEconomyObservationReport(input([malformed])), /cellId/);
  const outOfOrder = completeJournal("order");
  outOfOrder.entries[2].sequence = 2;
  assert.throws(() => buildEconomyObservationReport(input([outOfOrder])), /non-monotonic/);
});

test("requires one final terminal, valid lifetime timestamps, and true turn completion boundaries", () => {
  const suffixTerminal = completeJournal("suffix");
  suffixTerminal.entries.push({
    ...suffixTerminal.entries[10],
    eventId: "suffix-bankruptcy",
    sequence: 13,
    data: { debtorPlayerId: "p1" },
    occurredAt: at(13)
  });
  suffixTerminal.throughEventSequence = 13;
  assert.throws(() => buildEconomyObservationReport(input([suffixTerminal])), /final/);

  const multipleTerminal = completeJournal("multiple");
  multipleTerminal.entries.splice(10, 0, {
    ...multipleTerminal.entries.at(-1),
    eventId: "middle-terminal"
  });
  multipleTerminal.entries = multipleTerminal.entries.map((item, index) => ({
    ...item,
    sequence: index + 1,
    eventId: `event-${index + 1}`,
    occurredAt: at(index + 1)
  }));
  multipleTerminal.throughEventSequence = multipleTerminal.entries.at(-1).sequence;
  assert.throws(() => buildEconomyObservationReport(input([multipleTerminal])), /exactly one/);

  const timestampRegression = completeJournal("timestamps");
  timestampRegression.entries[3].occurredAt = at(2);
  assert.throws(() => buildEconomyObservationReport(input([timestampRegression])), /timestamps/);

  const noRollBeforeCompletion = completeJournal("completion");
  noRollBeforeCompletion.entries.unshift(completedTurn(0));
  noRollBeforeCompletion.entries = noRollBeforeCompletion.entries.map((item, index) => ({
    ...item,
    sequence: index + 1,
    eventId: `event-${index + 1}`,
    occurredAt: at(index + 1)
  }));
  noRollBeforeCompletion.throughEventSequence = noRollBeforeCompletion.entries.at(-1).sequence;
  assert.throws(() => buildEconomyObservationReport(input([noRollBeforeCompletion])), /without a preceding roll/);

  const noRollAfterCompletion = completeJournal("after-completion");
  noRollAfterCompletion.entries.splice(8, 1);
  noRollAfterCompletion.throughEventSequence = noRollAfterCompletion.entries.at(-1).sequence;
  assert.throws(() => buildEconomyObservationReport(input([noRollAfterCompletion])), /without a roll since the prior completion/);
});

test("proves raw bytes, computes manifest hash, rejects conflicting retry evidence, and derives trusted balance hash", () => {
  const sample = completeJournal("raw");
  const rawBytes = Buffer.from(JSON.stringify(sample));
  const report = buildEconomyObservationReport({
    manifest,
    balanceAuthoring: authoring,
    journals: [{ journal: sample, rawBytes }],
    manifestSha256: "forged"
  });
  assert.equal(report.inputs.journalSha256[0], sha256(rawBytes));
  assert.equal(report.inputs.manifestSha256, sha256(manifest));
  assert.equal(report.inputs.balanceInputSha256, "9e1ac64d249f958e162308c012eb423dc8757d6627f976b8c264b32c0120134b");

  const forgedJournal = structuredClone(sample);
  forgedJournal.entries[1].summary = "forged";
  assert.throws(() => buildEconomyObservationReport({
    manifest,
    balanceAuthoring: authoring,
    journals: [{ journal: forgedJournal, rawBytes }]
  }), /rawBytes do not canonically match/);

  const prettyBytes = Buffer.from(JSON.stringify(sample, null, 2));
  assert.throws(() => buildEconomyObservationReport({
    manifest,
    balanceAuthoring: authoring,
    journals: [
      { journal: sample, rawBytes },
      { journal: structuredClone(sample), rawBytes: prettyBytes }
    ]
  }), /conflicting retry/);
});

test("CLI hashes exact file bytes, sorts samples, and prints canonical JSON", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "estate-economy-") );
  try {
    const firstPath = path.join(directory, "z.json");
    const secondPath = path.join(directory, "a.json");
    const manifestPath = path.join(directory, "manifest.json");
    await Promise.all([
      writeFile(firstPath, JSON.stringify(completeJournal("z"))),
      writeFile(secondPath, JSON.stringify(completeJournal("a"))),
      writeFile(manifestPath, JSON.stringify(manifest))
    ]);
    const output = await runCli(["--manifest", manifestPath, secondPath, firstPath]);
    const parsed = JSON.parse(output);
    assert.deepEqual(parsed.samples.map((sample) => sample.sessionId), ["a", "z"]);
    assert.deepEqual(parsed.inputs.journalSha256, [
      sha256(await readFile(secondPath)),
      sha256(await readFile(firstPath))
    ].sort());
    assert.equal(parsed.inputs.manifestSha256, sha256(await readFile(manifestPath)));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI help no longer offers an arbitrary balance input", async () => {
  const help = await runCli(["--help"]);
  assert.match(help, /trusted-local/);
  assert.doesNotMatch(help, /balance-input/);
});
