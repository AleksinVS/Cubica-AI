/** Neutral materialization and semantic validation of authoritative session seats. */
import type { SessionParticipant, SessionRecord } from "@cubica/contracts-session";

type RuntimeState = Record<string, unknown>;
const forbiddenIds = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Derive local human seats only from the exact player actors materialized in
 * authoritative state. S8 never accepts a caller-supplied participant list.
 */
export function materializeLocalSessionParticipants(
  state: RuntimeState,
  fallbackParticipantCount: number
): ReadonlyArray<SessionParticipant> {
  if (!Number.isSafeInteger(fallbackParticipantCount) || fallbackParticipantCount < 1) {
    throw new Error("Local participant count must be a positive safe integer");
  }
  const statePlayerIds = readAuthoritativePlayerIds(state);
  const playerIds = statePlayerIds ?? Array.from(
    { length: fallbackParticipantCount },
    (_, index) => `p${index + 1}`
  );
  if (playerIds.length !== fallbackParticipantCount) {
    throw new Error("Authoritative player ids do not match the local participant count");
  }
  return playerIds.map((playerId) => ({
    seatId: playerId,
    playerId,
    kind: "human",
    joinState: "local"
  }));
}

/** Validate shape plus cross-field actor identity; JSON Schema owns public shape. */
export function assertSessionParticipantsMatchState(
  participants: ReadonlyArray<SessionParticipant>,
  state: unknown,
  options: { allowAgents: boolean }
): void {
  const playerIds = readAuthoritativePlayerIds(state);
  if (!Array.isArray(participants) || participants.length === 0) {
    throw new Error("Session participants must contain at least one authoritative seat");
  }

  const seats = new Set<string>();
  const actors = new Set<string>();
  for (const participant of participants) {
    if (
      !isRecord(participant) ||
      typeof participant.seatId !== "string" || participant.seatId.length === 0 ||
      typeof participant.playerId !== "string" || !isSafeId(participant.playerId) ||
      (participant.kind !== "human" && participant.kind !== "agent") ||
      participant.joinState !== "local" ||
      (!options.allowAgents && participant.kind === "agent") ||
      seats.has(participant.seatId) || actors.has(participant.playerId)
    ) {
      throw new Error("Session participants contain an invalid or duplicate seat binding");
    }
    seats.add(participant.seatId);
    actors.add(participant.playerId);
  }

  if (playerIds !== undefined && (
    participants.length !== playerIds.length || playerIds.some((playerId) => !actors.has(playerId))
  )) {
    throw new Error("Session participant playerId must reference state.players and turn.order");
  }
}

/** Participants are immutable session metadata across every snapshot update. */
export function assertSessionParticipantsImmutable<TState>(
  current: SessionRecord<TState>,
  updated: SessionRecord<TState>
): void {
  assertSessionParticipantsMatchState(updated.participants, updated.state, { allowAgents: false });
  if (JSON.stringify(current.participants) !== JSON.stringify(updated.participants)) {
    throw new Error("Session participants cannot change during a snapshot update");
  }
}

export function participantActorIds<TState>(session: SessionRecord<TState>): ReadonlyArray<string> {
  assertSessionParticipantsMatchState(session.participants, session.state, { allowAgents: true });
  return session.participants.map((participant) => participant.playerId);
}

function readAuthoritativePlayerIds(state: unknown): string[] | undefined {
  if (!isRecord(state)) return undefined;
  const players = isRecord(state.players) ? state.players : undefined;
  const playerKeys = players === undefined ? undefined : Object.keys(players);
  if (playerKeys !== undefined && (
    playerKeys.length === 0 || playerKeys.some((playerId) => !isSafeId(playerId))
  )) throw new Error("Session state.players must contain safe non-empty actor keys");
  const turn = isRecord(state.public) && isRecord(state.public.turn) ? state.public.turn : undefined;
  if (turn?.order === undefined) return playerKeys === undefined ? undefined : [...playerKeys].sort();
  if (!Array.isArray(turn.order) || turn.order.some((entry) => typeof entry !== "string" || !isSafeId(entry))) {
    throw new Error("Session turn.order must contain safe player ids");
  }
  const order = turn.order as string[];
  if (new Set(order).size !== order.length || playerKeys !== undefined && (
    order.length !== playerKeys.length || playerKeys.some((playerId) => !order.includes(playerId))
  )) {
    throw new Error("Session turn.order must exactly match state.players");
  }
  return [...order];
}

function isSafeId(value: string): boolean {
  return value.length > 0 && !forbiddenIds.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
