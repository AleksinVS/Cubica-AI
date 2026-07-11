/**
 * Replay-stable manifest deck operations.
 *
 * Only the explicitly drawn card id may be written to public state. The future
 * order and discard pile always remain under `state.secret.decks`, where the
 * player projection removes them before a session snapshot leaves runtime-api.
 */
import type { GameManifestDeterministicEffect } from "@cubica/contracts-manifest";
import { shuffleSessionValues, type SessionRandomState } from "./sessionRandom.ts";

type RuntimeState = Record<string, unknown>;
type JsonRecord = Record<string, unknown>;
type DeckEffect = Extract<GameManifestDeterministicEffect, { op: "deck.shuffle" | "deck.draw" }>;

const SOURCE_PATTERN = /^collection:([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/u;
const SAFE_IDENTIFIER_PATTERN = /^(?!(?:__proto__|constructor|prototype)$)[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const forbiddenSegments = new Set(["__proto__", "constructor", "prototype"]);

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const requireSecretState = (state: RuntimeState): JsonRecord => {
  if (!isRecord(state.secret)) state.secret = {};
  return state.secret as JsonRecord;
};

const requireRandomState = (secret: JsonRecord): SessionRandomState => {
  if (!isRecord(secret.random)) {
    throw new Error("Deck operations require runtime-owned state.secret.random");
  }
  return secret.random as unknown as SessionRandomState;
};

const requireDecks = (secret: JsonRecord): JsonRecord => {
  if (secret.decks === undefined) secret.decks = {};
  if (!isRecord(secret.decks)) throw new Error("state.secret.decks must be an object");
  return secret.decks;
};

const parseDeck = (value: unknown, deckId: string): { order: Array<string>; discard: Array<string> } => {
  if (!isRecord(value) || !Array.isArray(value.order) || !Array.isArray(value.discard) ||
      !value.order.every((id) => typeof id === "string") ||
      !value.discard.every((id) => typeof id === "string")) {
    throw new Error(`Deck "${deckId}" has invalid persisted state`);
  }
  const order = value.order as Array<string>;
  const discard = value.discard as Array<string>;
  if (new Set([...order, ...discard]).size !== order.length + discard.length) {
    throw new Error(`Deck "${deckId}" contains duplicate card ids`);
  }
  return { order: [...order], discard: [...discard] };
};

const collectionIds = (state: RuntimeState, source: string): Array<string> => {
  const match = SOURCE_PATTERN.exec(source);
  if (!match) throw new Error(`Deck source "${source}" is not a safe collection reference`);
  const collectionId = match[1];
  if (!SAFE_IDENTIFIER_PATTERN.test(collectionId)) {
    throw new Error(`Deck source collection "${collectionId}" is not a safe identifier`);
  }
  const matches: Array<JsonRecord> = [];
  for (const visibility of ["public", "secret"] as const) {
    const root = isRecord(state[visibility]) ? state[visibility] as JsonRecord : {};
    const objects = isRecord(root.objects) ? root.objects : {};
    if (objects[collectionId] !== undefined) {
      if (!isRecord(objects[collectionId])) {
        throw new Error(`Deck source collection "${collectionId}" must be an object map`);
      }
      matches.push(objects[collectionId] as JsonRecord);
    }
  }
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `Deck source collection "${collectionId}" does not exist`
        : `Deck source collection "${collectionId}" is ambiguous across visibility scopes`
    );
  }
  const ids = Object.keys(matches[0]);
  if (ids.length === 0) throw new Error(`Deck source collection "${collectionId}" is empty`);
  return ids.sort();
};

const decodePointerSegment = (segment: string) => segment.replace(/~1/g, "/").replace(/~0/g, "~");

const writePublicPointer = (state: RuntimeState, path: string, value: string) => {
  if (!path.startsWith("/public/")) throw new Error("deck.draw storePath must remain under /public/");
  const parts = path.slice(1).split("/").map(decodePointerSegment);
  if (parts.some((part) => forbiddenSegments.has(part))) {
    throw new Error("deck.draw storePath contains a forbidden segment");
  }
  let current = state;
  for (const part of parts.slice(0, -1)) {
    if (!isRecord(current[part])) current[part] = {};
    current = current[part] as JsonRecord;
  }
  current[parts[parts.length - 1]] = value;
};

/** Apply a schema-validated deck effect and return only public/audit-safe facts. */
export const applyDeckEffect = (state: RuntimeState, effect: DeckEffect): Record<string, unknown> => {
  if (!SAFE_IDENTIFIER_PATTERN.test(effect.deckId)) {
    throw new Error(`Deck id "${effect.deckId}" is not a safe identifier`);
  }
  const secret = requireSecretState(state);
  const decks = requireDecks(secret);
  const random = requireRandomState(secret);

  if (effect.op === "deck.shuffle") {
    const sourceIds = decks[effect.deckId] === undefined
      ? collectionIds(state, effect.source)
      : (() => {
          const deck = parseDeck(decks[effect.deckId], effect.deckId);
          return [...deck.order, ...deck.discard];
        })();
    const shuffled = shuffleSessionValues(random, sourceIds);
    secret.random = shuffled.random;
    decks[effect.deckId] = { order: shuffled.values, discard: [] };
    secret.decks = decks;
    state.secret = secret;
    return { deckId: effect.deckId, cardCount: shuffled.values.length };
  }

  const deck = parseDeck(decks[effect.deckId], effect.deckId);
  if (deck.order.length === 0) {
    if (effect.onEmpty === "fail" || deck.discard.length === 0) {
      throw new Error(`Deck "${effect.deckId}" has no card available to draw`);
    }
    const shuffled = shuffleSessionValues(random, deck.discard);
    secret.random = shuffled.random;
    deck.order = shuffled.values;
    deck.discard = [];
  }
  const cardId = deck.order.shift();
  if (cardId === undefined) throw new Error(`Deck "${effect.deckId}" has no card available to draw`);
  deck.discard.push(cardId);
  decks[effect.deckId] = deck;
  secret.decks = decks;
  state.secret = secret;
  writePublicPointer(state, effect.storePath, cardId);
  return { deckId: effect.deckId, cardId, storePath: effect.storePath };
};
