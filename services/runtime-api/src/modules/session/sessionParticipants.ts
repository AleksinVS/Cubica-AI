/** Neutral materialization and semantic validation of authoritative session seats. */
import {
  validateSessionParticipantsShape,
  type CreateSessionPrincipalInput,
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

/** Derive private human seats; the creator owns the first and guests start invited. */
export function materializePrivateSessionParticipants(
  state: RuntimeState,
  participantCount: number
): ReadonlyArray<SessionParticipant> {
  return materializeLocalSessionParticipants(state, participantCount).map((participant, index) => ({
    ...participant,
    kind: "human",
    joinState: index === 0 ? "joined" : "invited"
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

/** Validate the complete principal topology before a session creation commit. */
export function assertCreationPrincipalsMatchParticipants(
  principals: ReadonlyArray<CreateSessionPrincipalInput>,
  participants: ReadonlyArray<SessionParticipant>
): void {
  if (principals.length < 1) throw new Error("A session must have at least one principal");
  const participantIds = new Set(participants.map(({ playerId }) => playerId));
  const principalIds = new Set<string>();
  const credentialDigests = new Set<string>();
  for (const principal of principals) {
    if (
      principalIds.has(principal.principalId) ||
      credentialDigests.has(principal.credentialSha256) ||
      !/^[a-f0-9]{64}$/u.test(principal.credentialSha256) ||
      (principal.credentialExpiresAt !== undefined && (
        !(principal.credentialExpiresAt instanceof Date) ||
        !Number.isFinite(principal.credentialExpiresAt.valueOf())
      ))
    ) {
      throw new Error("Session principals must have unique valid credential material");
    }
    principalIds.add(principal.principalId);
    credentialDigests.add(principal.credentialSha256);
    if (principal.actorScope.kind === "listed-actors" && (
      principal.actorScope.actorIds.length !== 1 ||
      !participantIds.has(principal.actorScope.actorIds[0])
    )) {
      throw new Error("A participant principal must be scoped to exactly one session actor");
    }
  }

  const networkParticipants = participants.filter(({ joinState }) => joinState !== "local");
  if (networkParticipants.length === 0) {
    if (
      principals.length !== 1 ||
      principals[0].kind !== "local-controller" ||
      principals[0].actorScope.kind !== "all-session-actors" ||
      principals[0].credentialExpiresAt !== undefined
    ) {
      throw new Error("Local sessions require one durable all-actor controller principal");
    }
    return;
  }
  if (networkParticipants.length !== participants.length || participants.some(({ kind }) => kind !== "human")) {
    throw new Error("Private sessions cannot mix local, agent and network participants");
  }
  const joined = participants.filter(({ joinState }) => joinState === "joined");
  const invited = participants.filter(({ joinState }) => joinState === "invited");
  if (joined.length !== 1 || invited.length !== participants.length - 1 || principals.length !== participants.length) {
    throw new Error("Private sessions require one joined host and one principal per seat");
  }
  for (const participant of participants) {
    const principal = principals.find(({ actorScope }) =>
      actorScope.kind === "listed-actors" && actorScope.actorIds[0] === participant.playerId
    );
    if (
      principal === undefined ||
      principal.kind !== "participant" ||
      principal.actorScope.kind !== "listed-actors" ||
      (participant.joinState === "invited" && principal.role !== "player") ||
      (participant.joinState === "invited") !== (principal.credentialExpiresAt !== undefined)
    ) {
      throw new Error("Private principal credentials must match joined and invited seats exactly");
    }
  }
}

/** Allow exactly one server-owned `invited -> joined` change during claim. */
export function applyPrivateInviteClaim<TState>(
  current: SessionRecord<TState>,
  playerId: string,
  claimedAt: Date
): SessionRecord<TState> {
  let matched = false;
  const participants = current.participants.map((participant) => {
    if (participant.playerId !== playerId) return participant;
    if (matched || participant.kind !== "human" || participant.joinState !== "invited") {
      throw new Error("Private invite does not reference an available human seat");
    }
    matched = true;
    return { ...participant, joinState: "joined" as const };
  });
  if (!matched) throw new Error("Private invite does not reference an available human seat");
  if (!Number.isSafeInteger(current.version.stateVersion + 1)) {
    throw new Error("Session state version cannot advance safely");
  }
  const updated = {
    ...current,
    participants,
    version: { ...current.version, stateVersion: current.version.stateVersion + 1 },
    updatedAt: claimedAt
  };
  assertSessionParticipantsMatchState(updated.participants, updated.state, { allowAgents: true });
  return updated;
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
