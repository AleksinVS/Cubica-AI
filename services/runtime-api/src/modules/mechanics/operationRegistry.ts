/** Dispatch exact version-locked operations; no legacy effect names are accepted. */
import { createRequire } from "node:module";
import { charge } from "./budget.ts";
import { executeCoreOperation } from "./coreOperations.ts";
import { executeDomainOperation } from "./domainOperations.ts";
import { MechanicsExecutionError } from "./errors.ts";
import { evaluateExpression } from "./expressionEvaluator.ts";
import { collectionEntries, isRecord, writeEndpoint } from "./stateModel.ts";
import {
  assertSessionRandomStreamId,
  readSessionRandomStream,
  rollSessionDice,
  shuffleSessionValues,
  writeSessionRandomStream,
  type SessionRandomStreamsState
} from "../runtime/sessionRandom.ts";
import type { JsonRecord, MechanicsExecutionContext, Step } from "./types.ts";

const require = createRequire(import.meta.url);
const registrySource = require("../../../../../scripts/manifest-tools/mechanics-modules.cjs") as {
  MODULE_REGISTRY: Map<string, {
    moduleId: string;
    moduleVersion: string;
    artifactHash: string;
    algorithmVersions: Record<string, string>;
  }>;
  OPERATION_MODULES: Map<string, string>;
};

/** Defensive runtime verification uses the exact same registry as publication. */
export function assertRuntimeModuleLock(moduleLock: Record<string, {
  moduleId: string;
  moduleVersion: string;
  artifactHash: string;
  algorithmVersions?: Record<string, string>;
}>): Set<string> {
  const seen = new Set<string>();
  for (const lock of Object.values(moduleLock)) {
    if (seen.has(lock.moduleId)) throw new MechanicsExecutionError("MECHANICS_MODULE_DUPLICATE", `Duplicate module "${lock.moduleId}"`);
    seen.add(lock.moduleId);
    const expected = registrySource.MODULE_REGISTRY.get(lock.moduleId);
    if (!expected || expected.moduleVersion !== lock.moduleVersion || expected.artifactHash !== lock.artifactHash ||
        JSON.stringify(sorted(lock.algorithmVersions ?? {})) !== JSON.stringify(sorted(expected.algorithmVersions))) {
      throw new MechanicsExecutionError("MECHANICS_MODULE_LOCK_MISMATCH", `Module "${lock.moduleId}" does not match the runtime registry`);
    }
  }
  return seen;
}

export function executeOperation(step: Step, context: MechanicsExecutionContext, lockedModules: ReadonlySet<string>): unknown {
  const moduleId = registrySource.OPERATION_MODULES.get(step.op);
  if (!moduleId) throw new MechanicsExecutionError("MECHANICS_OPERATION_UNKNOWN", `Unknown operation "${step.op}"`, step.id);
  if (!lockedModules.has(moduleId)) {
    throw new MechanicsExecutionError(
      "MECHANICS_MODULE_NOT_LOCKED",
      `Operation "${step.op}" requires locked module "${moduleId}"`,
      step.id
    );
  }

  if (step.op.startsWith("core.") || step.op.startsWith("system.")) {
    return executeCoreOperation(step, context);
  }
  switch (step.op) {
    case "random.dice.roll": return executeDice(step, context);
    case "deck.shuffle": return executeDeckShuffle(step, context);
    case "deck.draw": return executeDeckDraw(step, context);
    case "turn.phase.select": return executeTurnPhase(step, context);
    case "graph.regions.route.plan":
    case "graph.edge.split":
    case "graph.entity.traverse":
    case "graph.shortestPath":
    case "relation.attach":
    case "relation.detach":
      return executeDomainOperation(step, context);
    default:
      throw new MechanicsExecutionError(
        "MECHANICS_MODULE_OPERATION_UNAVAILABLE",
        `Runtime module "${moduleId}" does not implement operation "${step.op}"`,
        step.id
      );
  }
}

function executeDice(step: Extract<Step, { op: "random.dice.roll" }>, context: MechanicsExecutionContext): unknown {
  const streams = requireRandomStreams(context);
  const random = readSessionRandomStream(streams, step.stream);
  const rolled = rollSessionDice(random, step.dice);
  context.random = writeSessionRandomStream(streams, step.stream, rolled.random);
  // Preserve the established, game-facing dice result contract. `stream` and
  // the dice notation identify how the result was produced; the persisted
  // value itself remains the neutral `{ values, total, isDouble }` record used
  // by manifests and player plugins before the IR migration.
  const result = rolled.result;
  writeEndpoint(context, step.target.endpoint, result);
  persistRandom(context);
  charge(context, "writes", 2);
  return result;
}

function executeDeckShuffle(step: Extract<Step, { op: "deck.shuffle" }>, context: MechanicsExecutionContext): unknown {
  const decks = requireDecks(context);
  const existing = decks[step.deckId];
  const sourceIds = existing === undefined
    ? collectionEntries(context, step.sourceCollection).entries
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([id]) => id)
    : (() => {
        const deck = parseDeck(existing, step.deckId);
        return deck.order.concat(deck.discard);
      })();
  if (sourceIds.length === 0) {
    throw new MechanicsExecutionError("MECHANICS_DECK_EMPTY", `Deck "${step.deckId}" source is empty`, step.id);
  }
  const streams = requireRandomStreams(context);
  const shuffled = shuffleSessionValues(readSessionRandomStream(streams, step.stream), sourceIds);
  context.random = writeSessionRandomStream(streams, step.stream, shuffled.random);
  // The stream becomes part of deck state so an automatic reshuffle during a
  // later draw cannot accidentally switch to whichever random consumer ran
  // most recently.
  decks[step.deckId] = { order: shuffled.values, discard: [], stream: step.stream };
  persistRandom(context);
  charge(context, "scannedEntities", sourceIds.length);
  charge(context, "writes", 2);
  return { deckId: step.deckId, cardCount: sourceIds.length, stream: step.stream };
}

function executeDeckDraw(step: Extract<Step, { op: "deck.draw" }>, context: MechanicsExecutionContext): unknown {
  const decks = requireDecks(context);
  const deck = parseDeck(decks[step.deckId], step.deckId, true);
  // `parseDeck(..., true)` enforces this persisted invariant; the explicit
  // guard also narrows the structural TypeScript type for the reshuffle path.
  if (!deck.stream) {
    throw new MechanicsExecutionError("MECHANICS_DECK_STATE_INVALID", `Deck "${step.deckId}" has no pinned random stream`);
  }
  if (deck.order.length === 0) {
    if (step.onEmpty === "fail" || deck.discard.length === 0) {
      throw new MechanicsExecutionError("MECHANICS_DECK_EMPTY", `Deck "${step.deckId}" is empty`, step.id);
    }
    const streams = requireRandomStreams(context);
    const shuffled = shuffleSessionValues(readSessionRandomStream(streams, deck.stream), deck.discard);
    context.random = writeSessionRandomStream(streams, deck.stream, shuffled.random);
    deck.order = shuffled.values;
    deck.discard = [];
  }
  const cardId = deck.order.shift();
  if (!cardId) throw new MechanicsExecutionError("MECHANICS_DECK_EMPTY", `Deck "${step.deckId}" is empty`, step.id);
  deck.discard.push(cardId);
  decks[step.deckId] = deck;
  writeEndpoint(context, step.target.endpoint, cardId);
  persistRandom(context);
  charge(context, "writes", 2);
  return { deckId: step.deckId, cardId };
}

function executeTurnPhase(step: Extract<Step, { op: "turn.phase.select" }>, context: MechanicsExecutionContext): unknown {
  const phase = evaluateExpression(step.phase, context);
  if (typeof phase !== "string" || (context.turnPhases && !context.turnPhases.includes(phase))) {
    throw new MechanicsExecutionError("MECHANICS_TURN_PHASE_INVALID", "Turn phase is not declared", step.id);
  }
  const turn = requireTurn(context);
  turn.phase = phase;
  charge(context, "writes");
  return phase;
}

function requireTurn(context: MechanicsExecutionContext): JsonRecord {
  const publicState = isRecord(context.state.public) ? context.state.public : undefined;
  const turn = publicState && isRecord(publicState.turn) ? publicState.turn as JsonRecord : undefined;
  if (!turn) throw new MechanicsExecutionError("MECHANICS_TURN_STATE_INVALID", "state.public.turn is not initialized");
  return turn;
}

function requireRandomStreams(context: MechanicsExecutionContext): SessionRandomStreamsState {
  if (context.random) return context.random;
  const secret = isRecord(context.state.secret) ? context.state.secret : undefined;
  if (!secret || !isRecord(secret.random)) {
    throw new MechanicsExecutionError("MECHANICS_RANDOM_STATE_MISSING", "Runtime random state is not initialized");
  }
  context.random = secret.random as unknown as SessionRandomStreamsState;
  return context.random;
}

function persistRandom(context: MechanicsExecutionContext): void {
  if (!context.random) return;
  if (!isRecord(context.state.secret)) context.state.secret = {};
  (context.state.secret as JsonRecord).random = context.random;
}

function requireDecks(context: MechanicsExecutionContext): JsonRecord {
  if (!isRecord(context.state.secret)) context.state.secret = {};
  const secret = context.state.secret as JsonRecord;
  if (secret.decks === undefined) secret.decks = {};
  if (!isRecord(secret.decks)) throw new MechanicsExecutionError("MECHANICS_DECK_STATE_INVALID", "state.secret.decks must be an object");
  return secret.decks;
}

function parseDeck(
  value: unknown,
  deckId: string,
  requireStream = false
): { order: Array<string>; discard: Array<string>; stream?: string } {
  if (!isRecord(value) || !Array.isArray(value.order) || !Array.isArray(value.discard) ||
      !value.order.every((id) => typeof id === "string") || !value.discard.every((id) => typeof id === "string")) {
    throw new MechanicsExecutionError("MECHANICS_DECK_STATE_INVALID", `Deck "${deckId}" is invalid`);
  }
  if (value.stream !== undefined && typeof value.stream !== "string") {
    throw new MechanicsExecutionError("MECHANICS_DECK_STATE_INVALID", `Deck "${deckId}" random stream is invalid`);
  }
  if (requireStream && typeof value.stream !== "string") {
    throw new MechanicsExecutionError("MECHANICS_DECK_STATE_INVALID", `Deck "${deckId}" has no pinned random stream`);
  }
  if (typeof value.stream === "string") {
    try {
      assertSessionRandomStreamId(value.stream);
    } catch {
      throw new MechanicsExecutionError("MECHANICS_DECK_STATE_INVALID", `Deck "${deckId}" random stream is invalid`);
    }
  }
  const order = [...value.order] as Array<string>;
  const discard = [...value.discard] as Array<string>;
  if (new Set([...order, ...discard]).size !== order.length + discard.length) {
    throw new MechanicsExecutionError("MECHANICS_DECK_STATE_INVALID", `Deck "${deckId}" contains duplicate ids`);
  }
  return { order, discard, ...(typeof value.stream === "string" ? { stream: value.stream } : {}) };
}

function sorted(value: Record<string, string>): Array<[string, string]> {
  return Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
}
