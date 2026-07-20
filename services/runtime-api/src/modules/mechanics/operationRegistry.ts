/** Dispatch exact version-locked operations; no legacy effect names are accepted. */
import { createRequire } from "node:module";
import { charge } from "./budget.ts";
import { executeCoreOperation } from "./coreOperations.ts";
import { executeDomainOperation } from "./domainOperations.ts";
import { MechanicsExecutionError } from "./errors.ts";
import {
  evaluateExpression,
  evaluateStateReferenceBindings
} from "./expressionEvaluator.ts";
import { executeOrderingOperation } from "./orderingOperations.ts";
import {
  collectionEntries,
  isRecord,
  requireMechanicsIdentifier,
  writeEndpoint
} from "./stateModel.ts";
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
  MAX_DECK_ITEMS: number;
  MECHANICS_ARTIFACT_REGISTRY: {
    resolveSet: (moduleLock: unknown) =>
      | {
          state: "available";
          validationProfileId: string;
          executorProfileId: string;
          modules: Map<string, {
            moduleId: string;
            operations: ReadonlyArray<string>;
          }>;
          operationModules: Map<string, string>;
        }
      | {
          state: "blocked" | "missing";
          reason: string;
          identity?: { moduleId?: unknown };
        };
  };
};

interface ResolvedRuntimeModules {
  readonly moduleIds: ReadonlySet<string>;
  readonly operationModules: ReadonlyMap<string, string>;
}

/** Defensive runtime verification uses the exact same registry as publication. */
export function assertRuntimeModuleLock(moduleLock: Record<string, {
  moduleId: string;
  moduleVersion: string;
  artifactHash: string;
  algorithmVersions?: Record<string, string>;
}>): ResolvedRuntimeModules {
  const resolved = registrySource.MECHANICS_ARTIFACT_REGISTRY.resolveSet(moduleLock);
  if (resolved.state !== "available") {
    const moduleLabel = resolved.identity?.moduleId ? ` for module "${String(resolved.identity.moduleId)}"` : "";
    throw new MechanicsExecutionError(
      resolved.state === "blocked" ? "MECHANICS_MODULE_BLOCKED" : "MECHANICS_MODULE_LOCK_MISMATCH",
      `Mechanics executor ${resolved.state}${moduleLabel}: ${resolved.reason}`
    );
  }
  if (resolved.executorProfileId !== "mechanics-runtime-current") {
    throw new MechanicsExecutionError(
      "MECHANICS_EXECUTOR_PROFILE_UNAVAILABLE",
      `Mechanics executor profile "${resolved.executorProfileId}" is not installed`
    );
  }
  // `operationModules` is the complete trusted namespace of the selected
  // executor profile. `moduleIds` remains the session's exact allow-list.
  // Keeping both lets runtime distinguish a known-but-unlocked operation from
  // an operation that does not exist in that executor snapshot.
  return {
    moduleIds: new Set(resolved.modules.keys()),
    operationModules: new Map(resolved.operationModules)
  };
}

export function executeOperation(
  step: Step,
  context: MechanicsExecutionContext,
  lockedModules: ResolvedRuntimeModules
): unknown {
  const moduleId = lockedModules.operationModules.get(step.op);
  if (!moduleId) throw new MechanicsExecutionError("MECHANICS_OPERATION_UNKNOWN", `Unknown operation "${step.op}"`, step.id);
  if (!lockedModules.moduleIds.has(moduleId)) {
    throw new MechanicsExecutionError(
      "MECHANICS_MODULE_NOT_LOCKED",
      `Operation "${step.op}" requires locked module "${moduleId}"`,
      step.id
    );
  }

  const handler = OPERATION_HANDLERS.get(step.op);
  if (!handler) {
    throw new MechanicsExecutionError(
      "MECHANICS_MODULE_OPERATION_UNAVAILABLE",
      `Runtime module "${moduleId}" does not implement operation "${step.op}"`,
      step.id
    );
  }
  return handler(step, context);
}

type OperationHandler = (step: Step, context: MechanicsExecutionContext) => unknown;

/**
 * Explicit operation-to-handler table.
 *
 * Prefix dispatch is forbidden: `core.entities.order` belongs to the separate
 * ordering module and must not be accidentally captured by the core executor.
 */
const OPERATION_HANDLERS = new Map<string, OperationHandler>([
  ...[
    "core.assert",
    "core.entities.select",
    "core.entities.each",
    "core.collection.id.allocate",
    "core.sequence.next",
    "core.state.patch",
    "core.number.add",
    "core.resource.transfer",
    "core.collection.append",
    "core.entity.create",
    "core.entity.facet.set",
    "core.entity.attributes.patch",
    "core.entities.update",
    "core.event.emit",
    "core.entities.score",
    "core.ranking.stable",
    "system.schedule.register",
    "system.schedule.cancel"
  ].map((operation) => [operation, executeCoreOperation as OperationHandler] as const),
  ["random.dice.roll", executeDice as OperationHandler],
  ["core.entities.order", executeOrderingOperation as OperationHandler],
  ["deck.shuffle", executeDeckShuffle as OperationHandler],
  ["deck.draw", executeDeckDraw as OperationHandler],
  ["deck.extract", executeDeckExtract as OperationHandler],
  ["deck.return", executeDeckReturn as OperationHandler],
  ["deck.insert", executeDeckInsert as OperationHandler],
  ["turn.phase.select", executeTurnPhase as OperationHandler],
  ...[
    "graph.regions.route.plan",
    "graph.edge.position.inspect",
    "graph.edge.split",
    "graph.entity.traverse",
    "graph.shortestPath",
    "relation.attach",
    "relation.detach"
  ].map((operation) => [operation, executeDomainOperation as OperationHandler] as const)
]);

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
  let held: Array<string>;
  let sourceIds: Array<string>;
  if (existing === undefined) {
    const source = collectionEntries(context, step.sourceCollection).entries;
    charge(context, "scannedEntities", source.length);
    sourceIds = source
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([id]) => id);
    held = [];
  } else {
    const deck = parseDeck(existing, step.deckId, context);
    sourceIds = deck.order.concat(deck.discard);
    held = deck.held;
  }
  if (sourceIds.length + held.length > registrySource.MAX_DECK_ITEMS) {
    throw new MechanicsExecutionError(
      "MECHANICS_DECK_CAPACITY_EXCEEDED",
      `Deck "${step.deckId}" exceeds the ${registrySource.MAX_DECK_ITEMS} item limit`,
      step.id
    );
  }
  if (sourceIds.length === 0) {
    throw new MechanicsExecutionError("MECHANICS_DECK_EMPTY", `Deck "${step.deckId}" source is empty`, step.id);
  }
  const streams = requireRandomStreams(context);
  charge(context, "scannedEntities", sourceIds.length);
  const shuffled = shuffleSessionValues(readSessionRandomStream(streams, step.stream), sourceIds);
  context.random = writeSessionRandomStream(streams, step.stream, shuffled.random);
  // The stream becomes part of deck state so an automatic reshuffle during a
  // later draw cannot accidentally switch to whichever random consumer ran
  // most recently. Held items never re-enter rotation implicitly.
  decks[step.deckId] = { order: shuffled.values, discard: [], held, stream: step.stream };
  persistRandom(context);
  charge(context, "writes", 2);
  return { deckId: step.deckId, cardCount: sourceIds.length, stream: step.stream };
}

function executeDeckDraw(step: Extract<Step, { op: "deck.draw" }>, context: MechanicsExecutionContext): unknown {
  const { decks, deckId, deck } = resolveExistingDeck(step.deckId, context, step.id, true);
  // `parseDeck(..., context, true)` enforces this persisted invariant; the explicit
  // guard also narrows the structural TypeScript type for the reshuffle path.
  if (!deck.stream) {
    throw new MechanicsExecutionError("MECHANICS_DECK_STATE_INVALID", `Deck "${deckId}" has no pinned random stream`);
  }
  if (deck.order.length === 0) {
    if (step.onEmpty === "fail" || deck.discard.length === 0) {
      throw new MechanicsExecutionError("MECHANICS_DECK_EMPTY", `Deck "${deckId}" is empty`, step.id);
    }
    const streams = requireRandomStreams(context);
    charge(context, "scannedEntities", deck.discard.length);
    const shuffled = shuffleSessionValues(readSessionRandomStream(streams, deck.stream), deck.discard);
    context.random = writeSessionRandomStream(streams, deck.stream, shuffled.random);
    deck.order = shuffled.values;
    deck.discard = [];
  }
  // Removing the first array item shifts the remaining bounded order.
  charge(context, "scannedEntities", deck.order.length);
  const cardId = deck.order.shift();
  if (!cardId) throw new MechanicsExecutionError("MECHANICS_DECK_EMPTY", `Deck "${deckId}" is empty`, step.id);
  deck.discard.push(cardId);
  decks[deckId] = deck;
  writeEndpoint(
    context,
    step.target,
    cardId,
    evaluateStateReferenceBindings(step.target, context)
  );
  persistRandom(context);
  charge(context, "writes", 2);
  return { deckId, cardId };
}

/**
 * Move one selected item out of rotation.
 *
 * The method deliberately returns only the selected identifier and neutral
 * metadata. Future order and the complete held zone never enter audit output.
 */
function executeDeckExtract(
  step: Extract<Step, { op: "deck.extract" }>,
  context: MechanicsExecutionContext
): unknown {
  const { decks, deckId, deck } = resolveExistingDeck(step.deckId, context, step.id);
  const source = deck[step.source];
  let index: number;
  let cardId: string | undefined;
  if (step.card) {
    cardId = requireMechanicsIdentifier(
      evaluateExpression(step.card, context),
      `Deck "${deckId}" item id`
    );
    charge(context, "scannedEntities", source.length);
    index = source.indexOf(cardId);
    if (index < 0) {
      throw new MechanicsExecutionError(
        "MECHANICS_DECK_CARD_NOT_IN_SOURCE",
        `Item "${cardId}" is not in deck "${deckId}" source "${step.source}"`,
        step.id
      );
    }
  } else {
    index = step.source === "order" ? 0 : source.length - 1;
    cardId = source[index];
    if (cardId === undefined) {
      throw new MechanicsExecutionError(
        "MECHANICS_DECK_EMPTY",
        `Deck "${deckId}" source "${step.source}" is empty`,
        step.id
      );
    }
  }
  source.splice(index, 1);
  deck.held.push(cardId);
  decks[deckId] = deck;
  if (step.target) {
    writeEndpoint(
      context,
      step.target,
      cardId,
      evaluateStateReferenceBindings(step.target, context)
    );
  }
  charge(context, "writes", step.target ? 2 : 1);
  return { deckId, cardId, source: step.source };
}

/** Return exactly one currently held item to a declared rotation position. */
function executeDeckReturn(
  step: Extract<Step, { op: "deck.return" }>,
  context: MechanicsExecutionContext
): unknown {
  const { decks, deckId, deck } = resolveExistingDeck(step.deckId, context, step.id);
  const cardId = requireMechanicsIdentifier(
    evaluateExpression(step.card, context),
    `Deck "${deckId}" item id`
  );
  charge(context, "scannedEntities", deck.held.length);
  const heldIndex = deck.held.indexOf(cardId);
  if (heldIndex < 0) {
    throw new MechanicsExecutionError(
      "MECHANICS_DECK_CARD_NOT_HELD",
      `Item "${cardId}" is not held by deck "${deckId}"`,
      step.id
    );
  }
  deck.held.splice(heldIndex, 1);
  insertIntoDeckDestination(deck, cardId, step.destination);
  decks[deckId] = deck;
  charge(context, "writes");
  return { deckId, cardId, destination: step.destination };
}

/** Include one source-collection member that does not yet belong to the deck. */
function executeDeckInsert(
  step: Extract<Step, { op: "deck.insert" }>,
  context: MechanicsExecutionContext
): unknown {
  const { decks, deckId, deck } = resolveExistingDeck(step.deckId, context, step.id);
  const cardId = requireMechanicsIdentifier(
    evaluateExpression(step.card, context),
    `Deck "${deckId}" item id`
  );
  const source = collectionEntries(context, step.sourceCollection).entries;
  charge(context, "scannedEntities", source.length);
  if (!source.some(([id]) => id === cardId)) {
    throw new MechanicsExecutionError(
      "MECHANICS_DECK_CARD_UNKNOWN",
      `Item "${cardId}" does not exist in source collection "${step.sourceCollection}"`,
      step.id
    );
  }
  const memberCount = deck.order.length + deck.discard.length + deck.held.length;
  charge(context, "scannedEntities", memberCount);
  if (new Set([...deck.order, ...deck.discard, ...deck.held]).has(cardId)) {
    throw new MechanicsExecutionError(
      "MECHANICS_DECK_CARD_ALREADY_MEMBER",
      `Item "${cardId}" already belongs to deck "${deckId}"`,
      step.id
    );
  }
  if (memberCount >= registrySource.MAX_DECK_ITEMS) {
    throw new MechanicsExecutionError(
      "MECHANICS_DECK_CAPACITY_EXCEEDED",
      `Deck "${deckId}" cannot exceed ${registrySource.MAX_DECK_ITEMS} items`,
      step.id
    );
  }
  insertIntoDeckDestination(deck, cardId, step.destination);
  decks[deckId] = deck;
  charge(context, "writes");
  return { deckId, cardId, destination: step.destination };
}

function insertIntoDeckDestination(
  deck: DeckState,
  cardId: string,
  destination: "held" | "discard" | "order-top" | "order-bottom"
): void {
  switch (destination) {
    case "held": deck.held.push(cardId); return;
    case "discard": deck.discard.push(cardId); return;
    case "order-top": deck.order.unshift(cardId); return;
    case "order-bottom": deck.order.push(cardId); return;
  }
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

/**
 * Resolve one literal or bounded-parameter deck reference.
 *
 * `deck.shuffle` remains the only creator of protected deck state. These
 * lifecycle operations therefore require an own property that already exists
 * in the session snapshot; a parameter can select a declared deck but can
 * never synthesize a new state key or traverse an object prototype.
 */
function resolveExistingDeck(
  reference: Extract<Step, { op: "deck.draw" }>["deckId"],
  context: MechanicsExecutionContext,
  stepId: string,
  requireStream = false
): { decks: JsonRecord; deckId: string; deck: DeckState } {
  const rawDeckId = typeof reference === "string"
    ? reference
    : evaluateExpression(reference, context);
  let deckId: string;
  try {
    deckId = requireMechanicsIdentifier(rawDeckId, "Deck id");
  } catch (error) {
    if (error instanceof MechanicsExecutionError && error.code === "MECHANICS_IDENTIFIER_INVALID") {
      throw new MechanicsExecutionError(
        "MECHANICS_DECK_ID_INVALID",
        "Deck id must be a safe Mechanics identifier",
        stepId
      );
    }
    throw error;
  }

  const decks = requireDecks(context);
  if (!Object.prototype.hasOwnProperty.call(decks, deckId)) {
    throw new MechanicsExecutionError(
      "MECHANICS_DECK_UNKNOWN",
      `Deck "${deckId}" is not initialized in this session`,
      stepId
    );
  }
  return {
    decks,
    deckId,
    deck: parseDeck(decks[deckId], deckId, context, requireStream)
  };
}

function parseDeck(
  value: unknown,
  deckId: string,
  context: MechanicsExecutionContext,
  requireStream = false
): DeckState {
  if (!isRecord(value) || !Array.isArray(value.order) || !Array.isArray(value.discard) ||
      (value.held !== undefined && !Array.isArray(value.held))) {
    throw new MechanicsExecutionError("MECHANICS_DECK_STATE_INVALID", `Deck "${deckId}" is invalid`);
  }
  const persistedHeld = Array.isArray(value.held) ? value.held : [];
  const memberCount = value.order.length + value.discard.length + persistedHeld.length;
  // Check cheap lengths before `.every` or array copies so corrupt persisted
  // state cannot force an uncharged scan beyond the shared deck bound.
  if (memberCount > registrySource.MAX_DECK_ITEMS) {
    throw new MechanicsExecutionError(
      "MECHANICS_DECK_CAPACITY_EXCEEDED",
      `Deck "${deckId}" exceeds the ${registrySource.MAX_DECK_ITEMS} item limit`
    );
  }
  if (!value.order.every((id) => typeof id === "string") ||
      !value.discard.every((id) => typeof id === "string") ||
      !persistedHeld.every((id) => typeof id === "string")) {
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
  // Old in-memory pre-ADR fixtures did not persist held. Reading them as an
  // empty zone is safe; every write below stores the explicit new shape.
  const held = [...persistedHeld] as Array<string>;
  charge(context, "scannedEntities", memberCount);
  if (new Set([...order, ...discard, ...held]).size !== memberCount) {
    throw new MechanicsExecutionError("MECHANICS_DECK_STATE_INVALID", `Deck "${deckId}" contains duplicate ids`);
  }
  return { order, discard, held, ...(typeof value.stream === "string" ? { stream: value.stream } : {}) };
}

interface DeckState {
  order: Array<string>;
  discard: Array<string>;
  held: Array<string>;
  stream?: string;
}
