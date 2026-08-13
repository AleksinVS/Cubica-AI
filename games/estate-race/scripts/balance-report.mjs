import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const authoringFile = path.resolve(scriptDirectory, "../authoring/game.authoring.json");

const ECONOMIC_KINDS = new Set(["estate", "transit", "utility"]);
const ESTATE_TIERS = [0, 1, 2, 3, 4, 5];
const PLAYER_COUNTS = [2, 3, 4, 5, 6];
const MEAN_2D6 = 7;
const MAX_2D6 = 12;

const sortRecord = (value) => {
  if (Array.isArray(value)) return value.map(sortRecord);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortRecord(value[key])])
  );
};

export const canonicalStringify = (value) => JSON.stringify(sortRecord(value));

const sha256 = (value) => createHash("sha256").update(canonicalStringify(value)).digest("hex");

const attributesByRoute = (objects) => Object.values(objects)
  .map((object) => object.attributes)
  .sort((left, right) => left.index - right.index);

const attributesById = (objects) => Object.values(objects)
  .map((object) => object.attributes)
  .sort((left, right) => left.id.localeCompare(right.id));

const sameValue = (left, right) => canonicalStringify(left) === canonicalStringify(right);

const maximum = (values) => values.length === 0 ? 0 : Math.max(...values);

const assertFiniteNonnegativeInteger = (failures, label, value) => {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    failures.push(`${label}: expected a finite nonnegative integer, received ${JSON.stringify(value)}`);
  }
};

const assertStrictlyIncreasing = (failures, label, values) => {
  for (let index = 1; index < values.length; index += 1) {
    if (!(values[index] > values[index - 1])) {
      failures.push(
        `${label}: route/tier ${index - 1}=${values[index - 1]} must be lower than ${index}=${values[index]}`
      );
    }
  }
};

/**
 * Validate the closed-alpha balance assumptions without compiling the authoring.
 * Every failure identifies the source cell, group, tier, or card to be corrected.
 */
export const validateBalanceAuthoring = (authoring) => {
  const failures = [];
  const root = authoring?.root;
  const players = root?.config?.players;
  const rules = root?.content?.data?.rules;
  const state = root?.state?.public;
  const boardObjects = state?.objects?.boardCells;
  const eventCards = state?.objects?.eventCards;
  const fundCards = state?.objects?.fundCards;
  const bankBuildings = state?.bankBuildings;

  if (!root || !players || !rules || !boardObjects || !eventCards || !fundCards || !bankBuildings) {
    throw new Error("Estate Race balance authoring is missing rules, board cells, cards, or bank building inventory");
  }

  const cells = attributesByRoute(boardObjects);
  const estates = cells.filter((cell) => cell.kind === "estate");
  const purchasable = cells.filter((cell) => ECONOMIC_KINDS.has(cell.kind));
  const transits = cells.filter((cell) => cell.kind === "transit");
  const utilities = cells.filter((cell) => cell.kind === "utility");
  const taxes = cells.filter((cell) => cell.kind === "tax");
  const cards = attributesById({ ...eventCards, ...fundCards });
  const groups = Map.groupBy(estates, (estate) => estate.group);

  if (players.min !== 2 || players.max !== 6) {
    failures.push(`config.players: expected 2-6, received ${players.min}-${players.max}`);
  }
  if (rules.dice !== "2d6") failures.push(`rules.dice: expected 2d6, received ${JSON.stringify(rules.dice)}`);

  if (cells.length !== 40) failures.push(`boardCells: expected 40, received ${cells.length}`);
  if (estates.length !== 22) failures.push(`estate cells: expected 22, received ${estates.length}`);
  if (purchasable.length !== 28) failures.push(`purchasable cells: expected 28, received ${purchasable.length}`);
  if (groups.size !== 8) failures.push(`estate groups: expected 8, received ${groups.size}`);
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index]?.index !== index) {
      failures.push(`board route: expected index ${index}, received ${JSON.stringify(cells[index]?.index)}`);
    }
  }
  for (const [group, groupEstates] of groups) {
    if (groupEstates.length < 2 || groupEstates.length > 3) {
      failures.push(`group ${group}: expected 2-3 estates, received ${groupEstates.length}`);
    }
  }

  for (const [label, amount] of Object.entries({
    "rules.startingCash": rules.startingCash,
    "rules.lapReward": rules.lapReward,
    "rules.jailFee": rules.jailFee,
    "bankBuildings.housesAvailable": bankBuildings.housesAvailable,
    "bankBuildings.hotelsAvailable": bankBuildings.hotelsAvailable
  })) {
    assertFiniteNonnegativeInteger(failures, label, amount);
  }

  for (const cell of purchasable) {
    for (const field of ["price", "mortgageValue", "redeemCost", "rent", "transferFee"]) {
      assertFiniteNonnegativeInteger(failures, `${cell.id}.${field}`, cell[field]);
    }
    for (const [tier, rent] of (cell.rentScale ?? []).entries()) {
      assertFiniteNonnegativeInteger(failures, `${cell.id}.rentScale[${tier}]`, rent);
    }
    if (!Array.isArray(cell.rentScale) || cell.rentScale.length === 0) {
      failures.push(`${cell.id}.rentScale: expected at least one rent tier`);
    } else if (cell.rent !== cell.rentScale[0]) {
      failures.push(`${cell.id}.rent: expected rentScale[0]=${cell.rentScale[0]}, received ${cell.rent}`);
    }
    if (cell.price % 2 !== 0 || cell.mortgageValue !== cell.price / 2) {
      failures.push(`${cell.id}.mortgageValue: expected price/2=${cell.price / 2}, received ${cell.mortgageValue}`);
    }
    const fee = Math.floor((cell.mortgageValue + 9) / 10);
    if (cell.transferFee !== fee) {
      failures.push(`${cell.id}.transferFee: expected ceil(mortgageValue/10)=${fee}, received ${cell.transferFee}`);
    }
    if (cell.redeemCost !== cell.mortgageValue + fee) {
      failures.push(`${cell.id}.redeemCost: expected mortgageValue+fee=${cell.mortgageValue + fee}, received ${cell.redeemCost}`);
    }
  }
  for (const tax of taxes) {
    assertFiniteNonnegativeInteger(failures, `${tax.id}.taxAmount`, tax.taxAmount);
  }

  assertStrictlyIncreasing(failures, "estate prices by route", estates.map((estate) => estate.price));
  for (const tier of ESTATE_TIERS) {
    assertStrictlyIncreasing(
      failures,
      `estate rent tier ${tier} by route`,
      estates.map((estate) => estate.rentScale?.[tier])
    );
  }

  for (const estate of estates) {
    assertFiniteNonnegativeInteger(failures, `${estate.id}.buildCost`, estate.buildCost);
    assertFiniteNonnegativeInteger(failures, `${estate.id}.sellValue`, estate.sellValue);
    if (!Array.isArray(estate.rentScale) || estate.rentScale.length !== 6) {
      failures.push(`${estate.id}.rentScale: expected 6 tiers, received ${estate.rentScale?.length}`);
      continue;
    }
    assertStrictlyIncreasing(failures, `${estate.id}.rentScale`, estate.rentScale);
    if (estate.buildCost % 2 !== 0 || estate.sellValue !== estate.buildCost / 2) {
      failures.push(`${estate.id}.sellValue: expected buildCost/2=${estate.buildCost / 2}, received ${estate.sellValue}`);
    }
    for (const tier of ESTATE_TIERS) {
      if (estate[`rent${tier}`] !== estate.rentScale[tier]) {
        failures.push(`${estate.id}.rent${tier}: expected rentScale[${tier}]=${estate.rentScale[tier]}, received ${estate[`rent${tier}`]}`);
      }
    }
  }

  for (const [group, groupEstates] of groups) {
    const expected = {
      buildCost: groupEstates[0]?.buildCost,
      sellValue: groupEstates[0]?.sellValue
    };
    for (const estate of groupEstates) {
      const actual = { buildCost: estate.buildCost, sellValue: estate.sellValue };
      if (!sameValue(actual, expected)) {
        failures.push(`group ${group}: build/sell parameters differ at ${estate.id}; expected ${canonicalStringify(expected)}, received ${canonicalStringify(actual)}`);
      }
    }
  }

  for (const [kind, kindCells] of [["transit", transits], ["utility", utilities]]) {
    const fields = ["group", "price", "mortgageValue", "redeemCost", "rentScale", "rent", "transferFee"];
    const expected = Object.fromEntries(fields.map((field) => [field, kindCells[0]?.[field]]));
    for (const cell of kindCells) {
      const actual = Object.fromEntries(fields.map((field) => [field, cell[field]]));
      if (!sameValue(actual, expected)) {
        failures.push(`${kind} homogeneity: ${cell.id} differs; expected ${canonicalStringify(expected)}, received ${canonicalStringify(actual)}`);
      }
    }
    if (kindCells[0]?.rentScale?.length !== kindCells.length) {
      failures.push(`${kind} rentScale: expected ${kindCells.length} ownership tiers, received ${kindCells[0]?.rentScale?.length}`);
    } else {
      assertStrictlyIncreasing(failures, `${kind} rentScale`, kindCells[0].rentScale);
    }
  }

  for (const card of cards) {
    assertFiniteNonnegativeInteger(failures, `${card.id}.amount`, card.amount);
    if (card.effectKind === "building-assessment") {
      assertFiniteNonnegativeInteger(failures, `${card.id}.houseFee`, card.houseFee);
      assertFiniteNonnegativeInteger(failures, `${card.id}.hotelFee`, card.hotelFee);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Estate Race balance invariants failed:\n- ${failures.join("\n- ")}`);
  }

  return { bankBuildings, cards, cells, estates, fundCards, groups, players, purchasable, rules, taxes, transits, utilities };
};

export const buildBalanceReport = (authoring) => {
  const model = validateBalanceAuthoring(authoring);
  const { bankBuildings, cards, cells, estates, groups, players, purchasable, rules, taxes, transits, utilities } = model;
  const prices = purchasable.map((cell) => cell.price);
  const priceTotal = prices.reduce((total, price) => total + price, 0);
  const groupReports = [...groups.entries()]
    .sort(([, left], [, right]) => left[0].index - right[0].index)
    .map(([group, groupEstates]) => {
      const acquisitionCost = groupEstates.reduce((total, estate) => total + estate.price, 0);
      const buildCostPerEstate = groupEstates[0].buildCost;
      return {
        group,
        estateCount: groupEstates.length,
        estateIds: groupEstates.map((estate) => estate.id),
        acquisitionCost,
        buildCostPerEstate,
        sellValuePerEstate: groupEstates[0].sellValue,
        tiers: ESTATE_TIERS.map((tier) => {
          const cumulativeBuildCost = buildCostPerEstate * groupEstates.length * tier;
          const rents = groupEstates.map((estate) => estate.rentScale[tier]);
          return {
            tier,
            cumulativeBuildCost,
            totalCapitalRequired: acquisitionCost + cumulativeBuildCost,
            rentTotal: rents.reduce((total, rent) => total + rent, 0),
            rentMinimum: Math.min(...rents),
            rentMaximum: Math.max(...rents)
          };
        })
      };
    });

  const exceedingTier = ESTATE_TIERS.find((tier) => estates.some((estate) => estate.rentScale[tier] > rules.startingCash));
  const firstEstate = exceedingTier === undefined
    ? null
    : estates.find((estate) => estate.rentScale[exceedingTier] > rules.startingCash);

  const cardAmounts = (effectKind) => cards
    .filter((card) => card.effectKind === effectKind)
    .map((card) => card.amount);
  const payEachAmount = maximum(cardAmounts("pay-each"));
  const collectEachAmount = maximum(cardAmounts("collect-each"));
  const assessmentCards = cards.filter((card) => card.effectKind === "building-assessment");
  const assessmentCeiling = maximum(assessmentCards.map((card) => (
    card.houseFee * bankBuildings.housesAvailable + card.hotelFee * bankBuildings.hotelsAvailable
  )));
  const balanceInput = {
    players: { min: players.min, max: players.max },
    rules: {
      dice: rules.dice,
      startingCash: rules.startingCash,
      lapReward: rules.lapReward,
      jailFee: rules.jailFee,
      debtAllowed: rules.debtAllowed
    },
    bankBuildings: {
      housesAvailable: bankBuildings.housesAvailable,
      hotelsAvailable: bankBuildings.hotelsAvailable
    },
    purchasableCells: purchasable.map((cell) => ({
      id: cell.id,
      index: cell.index,
      kind: cell.kind,
      group: cell.group,
      price: cell.price,
      rentScale: cell.rentScale,
      buildCost: cell.buildCost ?? null,
      sellValue: cell.sellValue ?? null,
      mortgageValue: cell.mortgageValue,
      redeemCost: cell.redeemCost,
      transferFee: cell.transferFee
    })),
    taxCells: taxes.map((tax) => ({ id: tax.id, index: tax.index, taxAmount: tax.taxAmount })),
    cards: cards.map((card) => ({
      id: card.id,
      effectKind: card.effectKind,
      amount: card.amount,
      houseFee: card.houseFee ?? null,
      hotelFee: card.hotelFee ?? null
    }))
  };

  return {
    schemaVersion: "estate-race-balance-report-v1",
    gameId: "estate-race",
    source: "authoring/game.authoring.json",
    balanceInputSha256: sha256(balanceInput),
    players: { minimum: players.min, maximum: players.max },
    board: {
      cellCount: cells.length,
      estateCount: estates.length,
      purchasableCount: purchasable.length,
      estateGroupCount: groups.size,
      estateGroupSizes: Object.fromEntries(groupReports.map((group) => [group.group, group.estateCount]))
    },
    prices: {
      total: priceTotal,
      average: priceTotal / purchasable.length,
      minimum: Math.min(...prices),
      maximum: Math.max(...prices)
    },
    nominalPurchaseCoverage: PLAYER_COUNTS.map((playerCount) => {
      const totalStartingCash = rules.startingCash * playerCount;
      return {
        playerCount,
        totalStartingCash,
        priceGap: priceTotal - totalStartingCash,
        coverage: { numerator: totalStartingCash, denominator: priceTotal }
      };
    }),
    estateGroups: groupReports,
    firstRentTierExceedingStartingCash: firstEstate === null ? null : {
      tier: exceedingTier,
      estateId: firstEstate.id,
      routeIndex: firstEstate.index,
      rent: firstEstate.rentScale[exceedingTier],
      startingCash: rules.startingCash
    },
    transit: {
      cellCount: transits.length,
      rentByOwnedCount: transits[0].rentScale.map((rent, index) => ({ ownedCount: index + 1, rent })),
      maximumRent: maximum(transits[0].rentScale)
    },
    utility: {
      cellCount: utilities.length,
      mean2d6: MEAN_2D6,
      maximum2d6: MAX_2D6,
      byOwnedCount: utilities[0].rentScale.map((multiplier, index) => ({
        ownedCount: index + 1,
        multiplier,
        expectedRentAtMean2d6: multiplier * MEAN_2D6,
        maximumRentAtMaximum2d6: multiplier * MAX_2D6
      }))
    },
    cardExposureCeilings: {
      bankDebit: maximum(cardAmounts("bank-debit")),
      bankCredit: maximum(cardAmounts("bank-credit")),
      payEach: {
        perCounterparty: payEachAmount,
        maximumCounterparties: 5,
        totalAtSixPlayers: payEachAmount * 5
      },
      collectEach: {
        perCounterparty: collectEachAmount,
        maximumCounterparties: 5,
        totalAtSixPlayers: collectEachAmount * 5
      },
      buildingAssessment: {
        housesAvailable: bankBuildings.housesAvailable,
        hotelsAvailable: bankBuildings.hotelsAvailable,
        ceiling: assessmentCeiling
      }
    },
    taxExposure: {
      total: taxes.reduce((total, tax) => total + tax.taxAmount, 0),
      minimum: Math.min(...taxes.map((tax) => tax.taxAmount)),
      maximum: Math.max(...taxes.map((tax) => tax.taxAmount))
    }
  };
};

export const createBalanceArtifact = (authoring) => {
  const report = buildBalanceReport(authoring);
  return { report, sha256: sha256(report) };
};

export const readBalanceAuthoring = async () => JSON.parse(await readFile(authoringFile, "utf8"));

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.length !== 2) {
    throw new Error("balance-report.mjs writes canonical JSON to stdout and accepts no arguments");
  }
  process.stdout.write(`${canonicalStringify(createBalanceArtifact(await readBalanceAuthoring()))}\n`);
}
