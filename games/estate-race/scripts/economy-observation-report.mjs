import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { promises as fsPromises } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Lib from "ajv/dist/2020.js";
import addFormatsLib from "ajv-formats";

import { createBalanceArtifact, readBalanceAuthoring } from "./balance-report.mjs";

const Ajv2020 = Ajv2020Lib.default ?? Ajv2020Lib;
const addFormats = addFormatsLib.default ?? addFormatsLib;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const defaultManifestFile = path.resolve(scriptDirectory, "../game.manifest.json");
export const journalSchemaFile = path.resolve(
  scriptDirectory,
  "../../../docs/architecture/schemas/public-gameplay-journal.schema.json"
);

const journalSchema = JSON.parse(readFileSync(journalSchemaFile, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateJournalSchema = ajv.compile(journalSchema);

const OWNABLE_KINDS = new Set(["estate", "transit", "utility"]);
const OWNERS = new Set(["player", "bank"]);
const ACQUISITION_METHODS = new Set([
  "direct-purchase",
  "auction",
  "trade",
  "creditor-transfer",
  "bank-reversion"
]);
const ROLL_EVENT_TYPE = "estate-race.turn.rolled";
const COMPLETED_TURN_EVENT_TYPE = "estate-race.turn.completed";
const TERMINAL_EVENT_TYPE = "estate-race.terminal";
const OWNERSHIP_EVENT_TYPE = "estate-race.property.ownership";
const BUILDING_EVENT_TYPE = "estate-race.building.placed";
const RENT_EVENT_TYPE = "property.rent";
const BANKRUPTCY_EVENT_TYPE = "estate-race.bankruptcy";

/** Stable JSON is used only for local evidence identity and in-memory inputs. */
export const canonicalStringify = (value) => JSON.stringify(sortRecord(value));

export const sha256 = (value) => {
  const bytes = typeof value === "string" || value instanceof Uint8Array
    ? value
    : canonicalStringify(value);
  return createHash("sha256").update(bytes).digest("hex");
};

function sortRecord(value) {
  if (Array.isArray(value)) return value.map(sortRecord);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortRecord(value[key])]));
}

function fail(message) {
  throw new Error(`Estate Race economy observation input rejected: ${message}`);
}

function ownObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) fail(`${label} must be a non-empty string`);
  return value;
}

function requiredInteger(value, label, minimum = undefined) {
  if (!Number.isSafeInteger(value) || (minimum !== undefined && value < minimum)) {
    fail(`${label} must be a safe integer${minimum === undefined ? "" : ` >= ${minimum}`}`);
  }
  return value;
}

function optionalInteger(value, label, minimum = undefined) {
  if (value === undefined) return undefined;
  return requiredInteger(value, label, minimum);
}

function extractCells(manifest) {
  const objects = manifest?.state?.public?.objects?.boardCells;
  ownObject(objects, "trusted manifest boardCells");
  const cells = new Map();
  for (const [key, object] of Object.entries(objects)) {
    const attributes = object?.attributes ?? object;
    ownObject(attributes, `trusted manifest board cell ${key}`);
    const id = requiredString(attributes.id ?? key, `trusted manifest board cell ${key}.id`);
    const kind = requiredString(attributes.kind, `trusted manifest board cell ${id}.kind`);
    const group = attributes.group;
    if (OWNABLE_KINDS.has(kind)) {
      requiredString(group, `trusted manifest board cell ${id}.group`);
      requiredInteger(attributes.price, `trusted manifest board cell ${id}.price`, 1);
    }
    if (cells.has(id)) fail(`trusted manifest contains duplicate board cell ${id}`);
    cells.set(id, { id, kind, group, listedPrice: attributes.price });
  }
  const groups = new Map();
  for (const cell of cells.values()) {
    if (!OWNABLE_KINDS.has(cell.kind)) continue;
    const group = groups.get(cell.group) ?? [];
    group.push(cell.id);
    groups.set(cell.group, group);
  }
  if (groups.size === 0) fail("trusted manifest has no ownable groups");
  return { cells, groups };
}

function manifestGameId(manifest) {
  const gameId = manifest?.meta?.id;
  return requiredString(gameId, "trusted manifest game id");
}

function schemaDiagnostics(errors) {
  return (errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
}

/** Validate the canonical repository journal before reading any game payload. */
export function validatePublicJournal(journal, label = "journal") {
  ownObject(journal, label);
  if (!validateJournalSchema(journal)) fail(`${label} is invalid per canonical public journal schema: ${schemaDiagnostics(validateJournalSchema.errors)}`);
  const entries = journal.entries;
  let previousSequence = 0;
  const ids = new Set();
  const createdAt = Date.parse(journal.sessionCreatedAt);
  const archivedAt = journal.archivedAt === undefined ? undefined : Date.parse(journal.archivedAt);
  for (const [index, entry] of entries.entries()) {
    if (entry.sequence <= previousSequence) fail(`${label} has duplicate/non-monotonic event order at entries[${index}] (sequence ${entry.sequence})`);
    if (ids.has(entry.eventId)) fail(`${label} repeats eventId ${entry.eventId}`);
    ids.add(entry.eventId);
    const occurredAt = Date.parse(entry.occurredAt);
    if (occurredAt < createdAt || (archivedAt !== undefined && occurredAt > archivedAt)) {
      fail(`${label} event ${entry.eventId} occurredAt is outside the session lifetime`);
    }
    if (index > 0 && occurredAt < Date.parse(entries[index - 1].occurredAt)) {
      fail(`${label} event timestamps are not nondecreasing at entries[${index}]`);
    }
    previousSequence = entry.sequence;
  }
  if (previousSequence > journal.throughEventSequence) fail(`${label} exceeds throughEventSequence`);
  return journal;
}

function eventData(entry, label) {
  return ownObject(entry.data, `${label} data`);
}

function validateS12Event(entry, index, cells) {
  const label = `event ${entry.eventId || index} (${entry.eventType})`;
  const data = eventData(entry, label);
  if (entry.eventType === ROLL_EVENT_TYPE) {
    if (requiredString(data.kind, `${label}.data.kind`) !== "movement") fail(`${label}.data.kind must be movement`);
  } else if (entry.eventType === COMPLETED_TURN_EVENT_TYPE) {
    if (requiredString(data.kind, `${label}.data.kind`) !== "turn") fail(`${label}.data.kind must be turn`);
  } else if (entry.eventType === OWNERSHIP_EVENT_TYPE) {
    const cellId = requiredString(data.cellId, `${label}.data.cellId`);
    const cell = cells.get(cellId);
    if (!cell || !OWNABLE_KINDS.has(cell.kind)) fail(`${label}.data.cellId ${cellId} is not an ownable manifest cell`);
    const ownerKind = requiredString(data.ownerKind, `${label}.data.ownerKind`);
    if (!OWNERS.has(ownerKind)) fail(`${label}.data.ownerKind must be player or bank`);
    const method = requiredString(data.acquisitionMethod, `${label}.data.acquisitionMethod`);
    if (!ACQUISITION_METHODS.has(method)) fail(`${label}.data.acquisitionMethod ${method} is unsupported`);
    if (ownerKind === "player") requiredString(data.ownerPlayerId, `${label}.data.ownerPlayerId`);
    else if (data.ownerPlayerId !== undefined && data.ownerPlayerId !== null) fail(`${label}.bank owner must not have ownerPlayerId`);
    if (method === "bank-reversion" && ownerKind !== "bank") fail(`${label}.bank-reversion must assign bank ownership`);
    if (method !== "bank-reversion" && ownerKind !== "player") fail(`${label}.${method} must assign player ownership`);
    optionalInteger(data.amount, `${label}.data.amount`, 0);
    if (method === "auction") requiredInteger(data.amount, `${label}.data.amount`, 0);
  } else if (entry.eventType === BUILDING_EVENT_TYPE) {
    const cellId = requiredString(data.cellId, `${label}.data.cellId`);
    const cell = cells.get(cellId);
    if (!cell || cell.kind !== "estate") fail(`${label}.data.cellId ${cellId} is not an estate manifest cell`);
    requiredString(data.ownerPlayerId, `${label}.data.ownerPlayerId`);
    requiredInteger(data.improvementTier, `${label}.data.improvementTier`, 1);
    if (data.improvementTier > 5) fail(`${label}.data.improvementTier must be <= 5`);
  } else if (entry.eventType === RENT_EVENT_TYPE) {
    const cellId = requiredString(data.cellId, `${label}.data.cellId`);
    const cell = cells.get(cellId);
    if (!cell || !OWNABLE_KINDS.has(cell.kind)) fail(`${label}.data.cellId ${cellId} is not an ownable manifest cell`);
    requiredString(data.payerPlayerId, `${label}.data.payerPlayerId`);
    if (data.ownerPlayerId !== null && data.ownerPlayerId !== undefined) requiredString(data.ownerPlayerId, `${label}.data.ownerPlayerId`);
    requiredInteger(data.amount, `${label}.data.amount`, 0);
    optionalInteger(data.improvementTier, `${label}.data.improvementTier`, 0);
  } else if (entry.eventType === BANKRUPTCY_EVENT_TYPE) {
    requiredString(data.debtorPlayerId, `${label}.data.debtorPlayerId`);
  } else if (entry.eventType === TERMINAL_EVENT_TYPE) {
    if (requiredString(data.kind, `${label}.data.kind`) !== "terminal") fail(`${label}.data.kind must be terminal`);
    requiredString(data.winnerPlayerId, `${label}.data.winnerPlayerId`);
    requiredString(data.reason, `${label}.data.reason`);
  }
}

function observeSample(journal, model) {
  const entries = journal.entries;
  for (const [index, entry] of entries.entries()) validateS12Event(entry, index, model.cells);
  const terminalEntries = entries.filter((entry) => entry.eventType === TERMINAL_EVENT_TYPE);
  if (terminalEntries.length === 0) fail(`journal ${journal.sessionId} is missing estate-race.terminal`);
  if (terminalEntries.length !== 1) fail(`journal ${journal.sessionId} must contain exactly one estate-race.terminal`);
  const terminal = terminalEntries[0];
  if (entries.at(-1) !== terminal) fail(`journal ${journal.sessionId} terminal must be the final journal entry`);
  const firstRoll = entries.find((entry) => entry.eventType === ROLL_EVENT_TYPE);
  if (!firstRoll) fail(`journal ${journal.sessionId} is missing estate-race.turn.rolled data needed for turn/time observations`);
  const firstRollAt = Date.parse(firstRoll.occurredAt);
  const terminalAt = Date.parse(terminal.occurredAt);
  if (!(terminalAt >= firstRollAt)) fail(`journal ${journal.sessionId} terminal occurredAt precedes first roll`);

  const owners = new Map();
  const ownershipEvents = [];
  let firstCompleteGroup = null;
  let firstBuilding = null;
  let firstBankruptcy = null;
  let firstTier4Rent = null;
  let tier4RentBankruptcy = null;
  const auctions = [];
  let completedTurns = 0;
  let rollsSinceCompletion = 0;
  let firstRollSeen = false;
  const turnOrdinal = new Map();
  // An observation belongs to the inclusive active-turn ordinal: one plus the
  // number of true turn-completed events before it. Extra rolls stay in that
  // ordinal until a completed event advances the turn.
  for (const entry of entries) {
    const data = entry.data;
    const measuredEvent = entry.eventType === OWNERSHIP_EVENT_TYPE
      || entry.eventType === BUILDING_EVENT_TYPE
      || entry.eventType === RENT_EVENT_TYPE
      || entry.eventType === BANKRUPTCY_EVENT_TYPE
      || entry.eventType === TERMINAL_EVENT_TYPE;
    if (measuredEvent && (!firstRollSeen || rollsSinceCompletion === 0)) {
      fail(`event ${entry.eventId} is an S12 observation without a roll since the prior completion`);
    }
    if (entry.eventType === ROLL_EVENT_TYPE) {
      firstRollSeen = true;
      rollsSinceCompletion += 1;
    } else if (entry.eventType === COMPLETED_TURN_EVENT_TYPE) {
      if (!firstRollSeen || rollsSinceCompletion === 0) {
        fail(`event ${entry.eventId} completed a turn without a preceding roll since the prior completion`);
      }
      completedTurns += 1;
      rollsSinceCompletion = 0;
    } else if (entry.eventType === OWNERSHIP_EVENT_TYPE) {
      const cell = model.cells.get(data.cellId);
      const owner = data.ownerKind === "player" ? data.ownerPlayerId : null;
      owners.set(data.cellId, owner);
      ownershipEvents.push(entry);
      if (data.acquisitionMethod === "auction") auctions.push({
        cellId: data.cellId,
        paid: data.amount,
        listedPrice: cell.listedPrice,
        ratio: { numerator: data.amount, denominator: cell.listedPrice }
      });
      if (firstCompleteGroup === null) {
        for (const [group, cellIds] of model.groups) {
          const groupOwners = cellIds.map((id) => owners.get(id));
          if (groupOwners[0] && groupOwners.every((owner) => owner === groupOwners[0])) {
            firstCompleteGroup = { entry, group };
            break;
          }
        }
      }
    } else if (entry.eventType === BUILDING_EVENT_TYPE) {
      if (firstBuilding === null) firstBuilding = entry;
    } else if (entry.eventType === BANKRUPTCY_EVENT_TYPE) {
      if (firstBankruptcy === null) firstBankruptcy = entry;
      if (firstTier4Rent !== null && tier4RentBankruptcy === null && data.debtorPlayerId === firstTier4Rent.data.payerPlayerId) {
        tier4RentBankruptcy = entry;
      }
    } else if (entry.eventType === RENT_EVENT_TYPE) {
      if (data.improvementTier === 4 && firstTier4Rent === null) firstTier4Rent = entry;
    }
    if (entry.eventType !== ROLL_EVENT_TYPE && entry.eventType !== COMPLETED_TURN_EVENT_TYPE) {
      if (!firstRollSeen) fail(`event ${entry.eventId} is an S12 observation before the first roll`);
      turnOrdinal.set(entry.eventId, completedTurns + 1);
    }
  }
  const turnsTo = (event) => event === null ? null : turnOrdinal.get(event.eventId);
  const tier4RentToBankruptcyTurns = firstTier4Rent && tier4RentBankruptcy
    ? turnsTo(tier4RentBankruptcy) - turnsTo(firstTier4Rent)
    : null;
  return {
    sessionId: journal.sessionId,
    turnsToFirstCompleteOwnableGroup: turnsTo(firstCompleteGroup?.entry ?? null),
    turnsToFirstBuilding: turnsTo(firstBuilding),
    turnsToFirstBankruptcy: turnsTo(firstBankruptcy),
    turnsToTerminal: turnsTo(terminal),
    directAcquisitionCount: ownershipEvents.filter((entry) => entry.data.ownerKind === "player" && entry.data.acquisitionMethod === "direct-purchase").length,
    auctionAcquisitionCount: ownershipEvents.filter((entry) => entry.data.ownerKind === "player" && entry.data.acquisitionMethod === "auction").length,
    auctionObservations: auctions,
    tier4RentToBankruptcyTurns,
    observedElapsedMilliseconds: terminalAt - firstRollAt
  };
}

/** Build only raw observations; interpretation and target claims belong elsewhere. */
export function buildEconomyObservationReport(input) {
  ownObject(input, "analyzer input");
  if (input.balanceAuthoring === undefined) fail("trusted balanceAuthoring is required");
  const manifest = input.manifest;
  const gameId = manifestGameId(manifest);
  if (gameId !== "estate-race") fail(`trusted manifest gameId must be estate-race, received ${gameId}`);
  const model = extractCells(manifest);
  const sourceEntries = input.journals ?? input.samples;
  if (!Array.isArray(sourceEntries) || sourceEntries.length === 0) fail("journals must contain at least one journal");
  const normalized = sourceEntries.map((source, index) => {
    const wrapped = source?.journal !== undefined;
    const journal = wrapped ? source.journal : source;
    const label = source?.source ?? `journal[${index}]`;
    let hash;
    if (wrapped && source.rawBytes !== undefined) {
      let rawJournal;
      try {
        rawJournal = JSON.parse(Buffer.from(source.rawBytes).toString("utf8"));
      } catch {
        fail(`${label} rawBytes are not valid JSON`);
      }
      if (canonicalStringify(rawJournal) !== canonicalStringify(journal)) {
        fail(`${label} rawBytes do not canonically match its parsed journal`);
      }
      hash = sha256(source.rawBytes);
    } else if (wrapped && source.rawBytes === undefined) {
      hash = sha256(canonicalStringify(journal));
    } else {
      hash = sha256(canonicalStringify(journal));
    }
    validatePublicJournal(journal, label);
    if (journal.gameId !== gameId) fail(`${label} gameId ${journal.gameId} does not match ${gameId}`);
    const canonical = canonicalStringify(journal);
    return { journal, source: label, hash, canonical };
  });
  const unique = new Map();
  for (const item of normalized) {
    const previous = unique.get(item.journal.sessionId);
    if (previous && (previous.canonical !== item.canonical || previous.hash !== item.hash)) {
      fail(`session ${item.journal.sessionId} has conflicting retry journal content or evidence hash`);
    }
    if (!previous) unique.set(item.journal.sessionId, item);
  }
  const ordered = [...unique.values()].sort((left, right) => left.journal.sessionId.localeCompare(right.journal.sessionId));
  return {
    schemaVersion: "estate-race-economy-observation-report-v1",
    gameId,
    inputs: {
      journalSha256: ordered.map((item) => item.hash).sort(),
      manifestSha256: input.manifestRawBytes === undefined
        ? sha256(manifest)
        : sha256VerifiedRawObject(input.manifestRawBytes, manifest, "manifest"),
      balanceInputSha256: createBalanceArtifact(input.balanceAuthoring).report.balanceInputSha256,
      sampleCount: ordered.length
    },
    samples: ordered.map((item) => observeSample(item.journal, model))
  };
}

function sha256VerifiedRawObject(rawBytes, value, label) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(rawBytes).toString("utf8"));
  } catch {
    fail(`${label} rawBytes are not valid JSON`);
  }
  if (canonicalStringify(parsed) !== canonicalStringify(value)) fail(`${label} rawBytes do not canonically match the analyzed object`);
  return sha256(rawBytes);
}

function usage() {
  return [
    "Usage: node games/estate-race/scripts/economy-observation-report.mjs [options] JOURNAL.json...",
    "Options:",
    "  --manifest FILE       trusted-local Estate Race manifest (default: game.manifest.json)",
    "  --help                print this help"
  ].join("\n");
}

export async function runCli(argv = process.argv.slice(2)) {
  let manifestFile = defaultManifestFile;
  const journalFiles = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") return usage();
    if (arg === "--manifest") {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} requires a file path`);
      manifestFile = path.resolve(value);
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option ${arg}`);
    } else journalFiles.push(path.resolve(arg));
  }
  if (journalFiles.length === 0) throw new Error("at least one journal file is required");
  const manifestBytes = await fsPromises.readFile(manifestFile);
  const manifest = JSON.parse(manifestBytes);
  const balanceAuthoring = await readBalanceAuthoring();
  const journals = await Promise.all(journalFiles.map(async (file) => {
    const bytes = await fsPromises.readFile(file);
    return { journal: JSON.parse(bytes), rawBytes: bytes, source: file };
  }));
  return canonicalStringify(buildEconomyObservationReport({
    manifest,
    manifestRawBytes: manifestBytes,
    balanceAuthoring,
    journals
  }));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    process.stdout.write(`${await runCli()}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
