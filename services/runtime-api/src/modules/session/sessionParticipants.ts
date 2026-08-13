/** Neutral materialization and semantic validation of authoritative session seats. */
import {
  validateSessionParticipantsShape,
  type SessionParticipant,
  type SessionRecord
} from "@cubica/contracts-session";

type RuntimeState = Record<string, unknown>;

/**
 * Derive local seats only from the exact player actors materialized in
 * authoritative state. The last N become agents only after create-policy
 * validation; callers never supply seat or player ids.
 */
export function materializeLocalSessionParticipants(
  state: RuntimeState,
  fallbackParticipantCount: number,
  agentSeatCount = 0
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
  if (!Number.isSafeInteger(agentSeatCount) || agentSeatCount < 0 || agentSeatCount > playerIds.length) {
    throw new Error("Local agent seat count must fit the authoritative participant count");
  }
  const firstAgentIndex = playerIds.length - agentSeatCount;
  return playerIds.map((playerId, index) => ({
    seatId: playerId,
    playerId,
    kind: index >= firstAgentIndex ? "agent" : "human",
    joinState: "local"
  }));
}

/** Validate shape plus cross-field actor identity; JSON Schema owns public shape. */
export function assertSessionParticipantsMatchState(
  participants: unknown,
  state: unknown,
  options: { allowAgents: boolean }
): asserts participants is ReadonlyArray<SessionParticipant> {
  if (!validateSessionParticipantsShape(participants)) {
    throw new Error("Session participants failed the canonical schema");
  }
  const playerIds = readAuthoritativePlayerIds(state);

  const seats = new Set<string>();
  const actors = new Set<string>();
  for (const participant of participants) {
    if (
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
  assertSessionParticipantsMatchState(updated.participants, updated.state, { allowAgents: true });
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
  const hasPlayers = Object.prototype.hasOwnProperty.call(state, "players");
  if (hasPlayers && !isRecord(state.players)) {
    throw new Error("Session state.players must be an actor record when present");
  }
  const players = hasPlayers ? state.players as Record<string, unknown> : undefined;
  const playerKeys = players === undefined ? undefined : Object.keys(players);
  if (playerKeys !== undefined && playerKeys.length === 0) {
    throw new Error("Session state.players must contain at least one actor");
  }
  const turn = isRecord(state.public) && isRecord(state.public.turn) ? state.public.turn : undefined;
  const hasTurn = isRecord(state.public) && Object.prototype.hasOwnProperty.call(state.public, "turn");
  if (hasTurn && turn === undefined) {
    throw new Error("Session public.turn must be an object when present");
  }
  const hasOrder = turn !== undefined && Object.prototype.hasOwnProperty.call(turn, "order");
  if (hasPlayers !== hasTurn || hasPlayers !== hasOrder) {
    throw new Error("Session state.players and public.turn.order must be present together without a partial turn shape");
  }
  if (!hasPlayers) {
    if (turn !== undefined && Object.prototype.hasOwnProperty.call(turn, "activePlayerId")) {
      throw new Error("Session activePlayerId requires state.players and public.turn.order");
    }
    return undefined;
  }
  if (!Array.isArray(turn?.order)) {
    throw new Error("Session turn.order must be an array of player ids");
  }
  const order = turn.order as string[];
  if (new Set(order).size !== order.length || playerKeys !== undefined && (
    order.length !== playerKeys.length || playerKeys.some((playerId) => !order.includes(playerId))
  )) {
    throw new Error("Session turn.order must exactly match state.players");
  }
  if (Object.prototype.hasOwnProperty.call(turn, "activePlayerId") && !order.includes(turn.activePlayerId as string)) {
    throw new Error("Session activePlayerId must reference public.turn.order");
  }
  return [...order];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
