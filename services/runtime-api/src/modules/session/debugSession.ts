import type {
  StoredDebugCheckpointMetadata,
  SessionPrincipal,
  SessionRecord,
  SessionSystemSchedule
} from "@cubica/contracts-session";
import { DebugCheckpointTooLargeError, SessionAuthorizationError, SessionStoreUnavailableError } from "./sessionStoreErrors.ts";

export const DEBUG_CHECKPOINT_LIMIT = 20;
export const DEBUG_CHECKPOINT_MAX_BYTES = 8 * 1024 * 1024;
export const DEBUG_CHECKPOINT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ProtectedDebugCheckpoint<TState> {
  readonly metadata: StoredDebugCheckpointMetadata;
  readonly sourceSessionId: string;
  readonly gameId: string;
  readonly bundleHash: string;
  readonly contentSourceId: string;
  readonly sessionRole?: SessionRecord<TState>["sessionRole"];
  readonly participants: SessionRecord<TState>["participants"];
  readonly state: TState;
  readonly schedules: readonly SessionSystemSchedule[];
}

export function assertDebugController<TState>(session: SessionRecord<TState> | null, principal: SessionPrincipal | null): asserts session is SessionRecord<TState> {
  if (session?.contentSourceId === undefined || principal?.kind !== "local-controller") {
    throw new SessionAuthorizationError();
  }
}

/** Only the dedicated authenticated control transaction may alter the gate. */
export function assertDebugPauseUnchanged<TState>(current: SessionRecord<TState>, updated: SessionRecord<TState>): void {
  if (Boolean(current.debugPaused) !== Boolean(updated.debugPaused)) throw new SessionStoreUnavailableError();
}

export function makeProtectedDebugCheckpoint<TState>(
  session: SessionRecord<TState>, schedules: readonly SessionSystemSchedule[], label: string,
  checkpointId: string, now: Date
): ProtectedDebugCheckpoint<TState> {
  const checkpoint: ProtectedDebugCheckpoint<TState> = {
    metadata: {
      checkpointId, label, createdAt: now,
      expiresAt: new Date(now.getTime() + DEBUG_CHECKPOINT_TTL_MS),
      sourceStateVersion: session.version.stateVersion
    },
    sourceSessionId: session.sessionId,
    gameId: session.gameId,
    bundleHash: session.bundleHash,
    contentSourceId: session.contentSourceId!,
    ...(session.sessionRole === undefined ? {} : { sessionRole: session.sessionRole }),
    participants: structuredClone(session.participants),
    state: structuredClone(session.state),
    schedules: structuredClone(schedules)
  };
  if (Buffer.byteLength(JSON.stringify(checkpoint), "utf8") > DEBUG_CHECKPOINT_MAX_BYTES) {
    throw new DebugCheckpointTooLargeError();
  }
  return checkpoint;
}
