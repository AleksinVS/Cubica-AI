/**
 * Cross-source proof for the accepted real Cards, Money, Trains content.
 *
 * The test deliberately reads the existing review/intake artifacts instead of
 * maintaining a second terminal or cargo dictionary. It proves that the
 * independently extracted author materials use one consistent numbered
 * terminal namespace while keeping the two special map points outside it.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const toolsDirectory = path.dirname(fileURLToPath(import.meta.url));
const gameDirectory = path.resolve(toolsDirectory, "..");

const readJson = async (relativePath) =>
  JSON.parse(await readFile(path.join(gameDirectory, relativePath), "utf8"));

const [
  cargoNews,
  countryDescriptions,
  initialNetwork,
  vectorMap
] = await Promise.all([
  readJson("authoring/fixtures/cargo-news.intake.json"),
  readJson("authoring/fixtures/country-descriptions.intake.json"),
  readJson("annotations/initial-network.review.json"),
  readJson("annotations/vector-map.review.json")
]);

const expectedNumberedTerminalIds = Array.from(
  { length: 23 },
  (_, index) => `terminal-${index + 1}`
);
const numberedTerminalIdPattern = /^terminal-(?:[1-9]|1[0-9]|2[0-3])$/u;

const compareTerminalIds = (left, right) =>
  Number(left.slice("terminal-".length)) - Number(right.slice("terminal-".length));

const canonicalPair = (left, right) => [left, right].sort().join("|");

test("country descriptions cover numbered terminals 1..23 exactly once", () => {
  const terminalIds = countryDescriptions.countryRecords.flatMap((record) =>
    record.sourceTerminalLabels.map((label) => `terminal-${label}`)
  );

  assert.equal(
    terminalIds.length,
    23,
    "The country descriptions must contain exactly 23 terminal labels."
  );
  assert.equal(
    new Set(terminalIds).size,
    23,
    "No numbered terminal may be assigned to more than one country description."
  );
  assert.deepEqual(
    [...terminalIds].sort(compareTerminalIds),
    expectedNumberedTerminalIds,
    "The country descriptions must cover every numbered terminal from 1 through 23."
  );
});

test("all cargo endpoints use existing numbered terminals, never special map points", () => {
  const numberedNetworkTerminalIds = initialNetwork.nodes
    .map((node) => node.id)
    .filter((nodeId) => numberedTerminalIdPattern.test(nodeId))
    .sort(compareTerminalIds);
  const specialPointIds = initialNetwork.nodes
    .map((node) => node.id)
    .filter((nodeId) => !numberedTerminalIdPattern.test(nodeId));
  const numberedTerminalSet = new Set(numberedNetworkTerminalIds);

  assert.deepEqual(
    numberedNetworkTerminalIds,
    expectedNumberedTerminalIds,
    "The initial-network review must provide the same 23 numbered terminals."
  );
  assert.deepEqual(
    specialPointIds.sort(),
    ["terminal-3-14", "waypoint-9-3-4"],
    "The combined 3,14 terminal and the initial waypoint are separate special points."
  );

  for (const cargo of cargoNews.cargoRecords) {
    for (const [role, nodeId] of [
      ["origin", cargo.originNodeId],
      ["destination", cargo.destinationNodeId]
    ]) {
      assert.ok(
        numberedTerminalSet.has(nodeId),
        `${cargo.id} has an unknown or special ${role} terminal: ${nodeId}`
      );
      assert.ok(
        !specialPointIds.includes(nodeId),
        `${cargo.id} must not use special map point ${nodeId} as a cargo endpoint.`
      );
    }
  }
});

test("vector terminal candidates form a calibrated bijection with terminals 1..23", () => {
  const mappedTerminalIds = vectorMap.terminalCandidates
    .map((candidate) => candidate.mappedReferenceId)
    .sort(compareTerminalIds);
  const maximumCandidateResidual = Math.max(
    ...vectorMap.terminalCandidates.map((candidate) => candidate.residualPx)
  );

  assert.equal(vectorMap.terminalCandidates.length, 23);
  assert.equal(
    new Set(mappedTerminalIds).size,
    23,
    "Each numbered terminal must be matched by exactly one vector candidate."
  );
  assert.deepEqual(mappedTerminalIds, expectedNumberedTerminalIds);
  assert.ok(
    vectorMap.terminalCandidates.every((candidate) => candidate.residualPx <= 3),
    "Every terminal calibration residual must stay within the accepted 3 px limit."
  );
  assert.equal(vectorMap.calibration.maxErrorPx, maximumCandidateResidual);
  assert.equal(vectorMap.calibration.acceptanceThresholdPx, 3);
});

test("real cargo and news intake has complete, one-to-one news additions", () => {
  const baseCargo = cargoNews.cargoRecords.filter(
    (record) => record.deck.kind === "base-terminal"
  );
  const newsAddedCargo = cargoNews.cargoRecords.filter(
    (record) => record.deck.kind === "news-addition"
  );
  const cargoAdditionNews = cargoNews.newsRecords.filter(
    (record) => record.category === "cargo-addition"
  );
  const ruleNews = cargoNews.newsRecords.filter(
    (record) => record.category === "rule-modifier"
  );

  assert.equal(baseCargo.length, 112);
  assert.equal(newsAddedCargo.length, 62);
  assert.equal(cargoNews.cargoRecords.length, 174);
  assert.equal(cargoAdditionNews.length, 10);
  assert.equal(ruleNews.length, 24);
  assert.equal(cargoNews.newsRecords.length, 34);

  const newsAddedCargoById = new Map(
    newsAddedCargo.map((record) => [record.id, record])
  );
  const linkedCargoIds = [];

  for (const news of cargoAdditionNews) {
    assert.ok(
      news.number >= 1 && news.number <= 10,
      `${news.id} is outside the cargo-addition news range 1..10.`
    );

    const expectedLinks = newsAddedCargo
      .filter((cargo) => cargo.deck.newsId === news.id)
      .map((cargo) => cargo.id)
      .sort();
    const actualLinks = [...news.linkedCargoRecordIds].sort();

    assert.deepEqual(
      actualLinks,
      expectedLinks,
      `${news.id} must link exactly the cargo rows assigned to it by the intake.`
    );
    for (const cargoId of actualLinks) {
      assert.ok(
        newsAddedCargoById.has(cargoId),
        `${news.id} links missing or non-news cargo ${cargoId}.`
      );
      linkedCargoIds.push(cargoId);
    }
  }

  assert.equal(linkedCargoIds.length, 62);
  assert.equal(
    new Set(linkedCargoIds).size,
    62,
    "Each news-added cargo row must be linked exactly once."
  );
  assert.deepEqual(
    [...linkedCargoIds].sort(),
    newsAddedCargo.map((record) => record.id).sort(),
    "News 1..10 must cover all 62 news-added cargo rows."
  );
});

test("the only cargo already covered by one initial road is row 005 on road 1-9", () => {
  const roadByEndpointPair = new Map(
    initialNetwork.edges.map((road) => [
      canonicalPair(road.fromNodeId, road.toNodeId),
      road
    ])
  );
  const cargoOnSingleInitialRoad = cargoNews.cargoRecords
    .filter((cargo) =>
      roadByEndpointPair.has(canonicalPair(cargo.originNodeId, cargo.destinationNodeId))
    )
    .map((cargo) => ({
      cargoId: cargo.id,
      originNodeId: cargo.originNodeId,
      destinationNodeId: cargo.destinationNodeId,
      bankPayout: cargo.bankPayout,
      roadId: roadByEndpointPair.get(
        canonicalPair(cargo.originNodeId, cargo.destinationNodeId)
      ).id
    }));

  assert.deepEqual(cargoOnSingleInitialRoad, [
    {
      cargoId: "cargo-source-row-005",
      originNodeId: "terminal-1",
      destinationNodeId: "terminal-9",
      bankPayout: 13,
      roadId: "road-1-9"
    }
  ]);

  assert.deepEqual(
    initialNetwork.edges
      .filter((road) => road.id === "road-1-9")
      .map((road) => [road.fromNodeId, road.toNodeId]),
    [["terminal-1", "terminal-9"]]
  );
});
