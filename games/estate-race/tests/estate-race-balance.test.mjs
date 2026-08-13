import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

import {
  authoringFile,
  buildBalanceReport,
  canonicalStringify,
  createBalanceArtifact,
  validateBalanceAuthoring
} from "../scripts/balance-report.mjs";

const execFileAsync = promisify(execFile);
const expectedReportSha256 = "0d06087345740f5e88b842c416366884451ea6e5d11d998ab94f2b1ea943c9e7";
const expectedBalanceInputSha256 = "9e1ac64d249f958e162308c012eb423dc8757d6627f976b8c264b32c0120134b";

const loadAuthoring = async () => JSON.parse(await readFile(authoringFile, "utf8"));
const clone = (value) => structuredClone(value);
const cell = (authoring, id) => authoring.root.state.public.objects.boardCells[id].attributes;
const card = (authoring, deck, id) => authoring.root.state.public.objects[deck][id].attributes;

test("closed-alpha balance report is an exact canonical projection of source authoring", async () => {
  const authoring = await loadAuthoring();
  const artifact = createBalanceArtifact(authoring);
  const report = artifact.report;

  assert.equal(artifact.sha256, expectedReportSha256);
  assert.equal(report.balanceInputSha256, expectedBalanceInputSha256);
  assert.deepEqual(report.players, { minimum: 2, maximum: 6 });
  assert.deepEqual(report.board, {
    cellCount: 40,
    estateCount: 22,
    purchasableCount: 28,
    estateGroupCount: 8,
    estateGroupSizes: {
      amber: 2,
      coral: 3,
      gold: 3,
      moss: 3,
      azure: 3,
      plum: 3,
      copper: 3,
      jade: 2
    }
  });
  assert.deepEqual(report.prices, {
    total: 8870,
    average: 316.7857142857143,
    minimum: 90,
    maximum: 620
  });
  assert.deepEqual(report.nominalPurchaseCoverage, [
    { playerCount: 2, totalStartingCash: 2400, priceGap: 6470, coverage: { numerator: 2400, denominator: 8870 } },
    { playerCount: 3, totalStartingCash: 3600, priceGap: 5270, coverage: { numerator: 3600, denominator: 8870 } },
    { playerCount: 4, totalStartingCash: 4800, priceGap: 4070, coverage: { numerator: 4800, denominator: 8870 } },
    { playerCount: 5, totalStartingCash: 6000, priceGap: 2870, coverage: { numerator: 6000, denominator: 8870 } },
    { playerCount: 6, totalStartingCash: 7200, priceGap: 1670, coverage: { numerator: 7200, denominator: 8870 } }
  ]);
  assert.deepEqual(report.firstRentTierExceedingStartingCash, {
    tier: 4,
    estateId: "cell-29",
    routeIndex: 29,
    rent: 1220,
    startingCash: 1200
  });
  assert.deepEqual(report.transit, {
    cellCount: 4,
    rentByOwnedCount: [
      { ownedCount: 1, rent: 26 },
      { ownedCount: 2, rent: 52 },
      { ownedCount: 3, rent: 104 },
      { ownedCount: 4, rent: 208 }
    ],
    maximumRent: 208
  });
  assert.deepEqual(report.utility, {
    cellCount: 2,
    mean2d6: 7,
    maximum2d6: 12,
    byOwnedCount: [
      { ownedCount: 1, multiplier: 5, expectedRentAtMean2d6: 35, maximumRentAtMaximum2d6: 60 },
      { ownedCount: 2, multiplier: 12, expectedRentAtMean2d6: 84, maximumRentAtMaximum2d6: 144 }
    ]
  });
  assert.deepEqual(report.cardExposureCeilings, {
    bankDebit: 40,
    bankCredit: 90,
    payEach: { perCounterparty: 10, maximumCounterparties: 5, totalAtSixPlayers: 50 },
    collectEach: { perCounterparty: 10, maximumCounterparties: 5, totalAtSixPlayers: 50 },
    buildingAssessment: { housesAvailable: 32, hotelsAvailable: 12, ceiling: 1200 }
  });
  assert.deepEqual(report.taxExposure, { total: 180, minimum: 70, maximum: 110 });

  const groupSnapshot = Object.fromEntries(report.estateGroups.map((group) => [group.group, {
    estateIds: group.estateIds,
    acquisitionCost: group.acquisitionCost,
    buildCostPerEstate: group.buildCostPerEstate,
    sellValuePerEstate: group.sellValuePerEstate,
    tiers: group.tiers.map((tier) => [
      tier.cumulativeBuildCost,
      tier.totalCapitalRequired,
      tier.rentTotal,
      tier.rentMinimum,
      tier.rentMaximum
    ])
  }]));
  assert.deepEqual(groupSnapshot, {
    amber: {
      estateIds: ["cell-01", "cell-02"], acquisitionCost: 210, buildCostPerEstate: 50, sellValuePerEstate: 25,
      tiers: [[0, 210, 26, 8, 18], [100, 310, 60, 24, 36], [200, 410, 166, 70, 96], [300, 510, 410, 180, 230], [400, 610, 710, 320, 390], [500, 710, 1030, 470, 560]]
    },
    coral: {
      estateIds: ["cell-05", "cell-08", "cell-09"], acquisitionCost: 580, buildCostPerEstate: 60, sellValuePerEstate: 30,
      tiers: [[0, 580, 88, 24, 34], [180, 760, 176, 48, 68], [360, 940, 490, 132, 190], [540, 1120, 1110, 310, 420], [720, 1300, 1770, 500, 660], [900, 1480, 2440, 700, 900]]
    },
    gold: {
      estateIds: ["cell-11", "cell-13", "cell-14"], acquisitionCost: 780, buildCostPerEstate: 70, sellValuePerEstate: 35,
      tiers: [[0, 780, 114, 36, 40], [210, 990, 228, 72, 80], [420, 1200, 660, 210, 230], [630, 1410, 1470, 460, 520], [840, 1620, 2280, 720, 800], [1050, 1830, 3080, 980, 1080]]
    },
    moss: {
      estateIds: ["cell-16", "cell-18", "cell-19"], acquisitionCost: 960, buildCostPerEstate: 80, sellValuePerEstate: 40,
      tiers: [[0, 960, 135, 42, 48], [240, 1200, 270, 84, 96], [480, 1440, 805, 250, 285], [720, 1680, 1790, 560, 630], [960, 1920, 2690, 850, 940], [1200, 2160, 3600, 1140, 1260]]
    },
    azure: {
      estateIds: ["cell-21", "cell-23", "cell-24"], acquisitionCost: 1140, buildCostPerEstate: 90, sellValuePerEstate: 45,
      tiers: [[0, 1140, 157, 50, 55], [270, 1410, 314, 100, 110], [540, 1680, 945, 300, 330], [810, 1950, 2070, 660, 720], [1080, 2220, 3060, 980, 1060], [1350, 2490, 4140, 1320, 1440]]
    },
    plum: {
      estateIds: ["cell-26", "cell-27", "cell-29"], acquisitionCost: 1320, buildCostPerEstate: 100, sellValuePerEstate: 50,
      tiers: [[0, 1320, 182, 58, 64], [300, 1620, 364, 116, 128], [600, 1920, 1100, 350, 385], [900, 2220, 2380, 760, 830], [1200, 2520, 3500, 1120, 1220], [1500, 2820, 4720, 1510, 1640]]
    },
    copper: {
      estateIds: ["cell-31", "cell-32", "cell-34"], acquisitionCost: 1500, buildCostPerEstate: 110, sellValuePerEstate: 55,
      tiers: [[0, 1500, 210, 66, 74], [330, 1830, 420, 132, 148], [660, 2160, 1260, 400, 440], [990, 2490, 2700, 860, 940], [1320, 2820, 3960, 1260, 1380], [1650, 3150, 5340, 1700, 1860]]
    },
    jade: {
      estateIds: ["cell-37", "cell-39"], acquisitionCost: 1180, buildCostPerEstate: 120, sellValuePerEstate: 60,
      tiers: [[0, 1180, 170, 80, 90], [240, 1420, 340, 160, 180], [480, 1660, 1020, 480, 540], [720, 1900, 2160, 1020, 1140], [960, 2140, 3180, 1500, 1680], [1200, 2380, 4280, 2020, 2260]]
    }
  });

  const reordered = clone(authoring);
  for (const collection of ["boardCells", "eventCards", "fundCards"]) {
    const record = reordered.root.state.public.objects[collection];
    reordered.root.state.public.objects[collection] = Object.fromEntries(Object.entries(record).reverse());
  }
  assert.deepEqual(createBalanceArtifact(reordered), artifact, "source object order must not affect canonical evidence");

  const { stdout, stderr } = await execFileAsync(process.execPath, ["games/estate-race/scripts/balance-report.mjs"]);
  assert.equal(stderr, "");
  assert.equal(stdout, `${canonicalStringify(artifact)}\n`);
});

test("critical balance invariants reject exact source-data regressions", async () => {
  const source = await loadAuthoring();
  const cases = [
    {
      name: "player range",
      pattern: /config\.players: expected 2-6, received 2-5/,
      mutate: (authoring) => { authoring.root.config.players.max = 5; }
    },
    {
      name: "dice basis",
      pattern: /rules\.dice: expected 2d6, received "1d12"/,
      mutate: (authoring) => { authoring.root.content.data.rules.dice = "1d12"; }
    },
    {
      name: "board topology",
      pattern: /boardCells: expected 40, received 39/,
      mutate: (authoring) => delete authoring.root.state.public.objects.boardCells["cell-39"]
    },
    {
      name: "group size",
      pattern: /group amber: expected 2-3 estates, received 1/,
      mutate: (authoring) => { cell(authoring, "cell-02").kind = "neutral"; }
    },
    {
      name: "finite integer amount",
      pattern: /cell-01\.price: expected a finite nonnegative integer, received 90\.5/,
      mutate: (authoring) => { cell(authoring, "cell-01").price = 90.5; }
    },
    {
      name: "estate price route",
      pattern: /estate prices by route:/,
      mutate: (authoring) => {
        Object.assign(cell(authoring, "cell-02"), { price: 90, mortgageValue: 45, transferFee: 5, redeemCost: 50 });
      }
    },
    {
      name: "estate rent tier route",
      pattern: /estate rent tier 0 by route:/,
      mutate: (authoring) => {
        Object.assign(cell(authoring, "cell-02"), { rent: 8, rent0: 8 });
        cell(authoring, "cell-02").rentScale[0] = 8;
      }
    },
    {
      name: "estate rent scale",
      pattern: /cell-01\.rentScale: route\/tier 0=8 must be lower than 1=7/,
      mutate: (authoring) => {
        cell(authoring, "cell-01").rentScale[1] = 7;
        cell(authoring, "cell-01").rent1 = 7;
      }
    },
    {
      name: "sell formula",
      pattern: /cell-01\.sellValue: expected buildCost\/2=25, received 26/,
      mutate: (authoring) => { cell(authoring, "cell-01").sellValue = 26; }
    },
    {
      name: "mortgage formula",
      pattern: /cell-01\.mortgageValue: expected price\/2=45, received 44/,
      mutate: (authoring) => { Object.assign(cell(authoring, "cell-01"), { mortgageValue: 44, redeemCost: 49 }); }
    },
    {
      name: "integer ceiling transfer fee",
      pattern: /cell-01\.transferFee: expected ceil\(mortgageValue\/10\)=5, received 4/,
      mutate: (authoring) => { cell(authoring, "cell-01").transferFee = 4; }
    },
    {
      name: "redeem formula",
      pattern: /cell-01\.redeemCost: expected mortgageValue\+fee=50, received 49/,
      mutate: (authoring) => { cell(authoring, "cell-01").redeemCost = 49; }
    },
    {
      name: "group build and sell consistency",
      pattern: /group amber: build\/sell parameters differ at cell-02/,
      mutate: (authoring) => { Object.assign(cell(authoring, "cell-02"), { buildCost: 60, sellValue: 30 }); }
    },
    {
      name: "transit homogeneity",
      pattern: /transit homogeneity: cell-15 differs/,
      mutate: (authoring) => {
        Object.assign(cell(authoring, "cell-15"), { price: 212, mortgageValue: 106, transferFee: 11, redeemCost: 117 });
      }
    },
    {
      name: "utility homogeneity",
      pattern: /utility homogeneity: cell-28 differs/,
      mutate: (authoring) => { cell(authoring, "cell-28").rentScale = [6, 12]; }
    },
    {
      name: "runtime base rent projection",
      pattern: /cell-06\.rent: expected rentScale\[0\]=26, received 27/,
      mutate: (authoring) => {
        for (const id of ["cell-06", "cell-15", "cell-25", "cell-35"]) cell(authoring, id).rent = 27;
      }
    },
    {
      name: "ownership rent tiers",
      pattern: /transit rentScale: expected 4 ownership tiers, received 3/,
      mutate: (authoring) => {
        for (const id of ["cell-06", "cell-15", "cell-25", "cell-35"]) cell(authoring, id).rentScale = [26, 52, 104];
      }
    },
    {
      name: "card amount",
      pattern: /fund-debit\.amount: expected a finite nonnegative integer, received -1/,
      mutate: (authoring) => { card(authoring, "fundCards", "fund-debit").amount = -1; }
    },
    {
      name: "tax amount",
      pattern: /cell-04\.taxAmount: expected a finite nonnegative integer, received -1/,
      mutate: (authoring) => { cell(authoring, "cell-04").taxAmount = -1; }
    }
  ];

  for (const scenario of cases) {
    const authoring = clone(source);
    scenario.mutate(authoring);
    assert.throws(
      () => validateBalanceAuthoring(authoring),
      scenario.pattern,
      `${scenario.name} must stop balance evidence generation`
    );
  }
});

test("the report hash changes when a valid balance input changes", async () => {
  const source = await loadAuthoring();
  const changed = clone(source);
  const assessment = card(changed, "fundCards", "fund-assessment");
  assessment.houseFee += 1;

  assert.notEqual(createBalanceArtifact(changed).sha256, expectedReportSha256);
  assert.equal(buildBalanceReport(changed).cardExposureCeilings.buildingAssessment.ceiling, 1232);
});
