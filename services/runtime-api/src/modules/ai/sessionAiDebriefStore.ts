import type {
  SessionAiDebriefSections,
  SessionAiDebriefUsage
} from "@cubica/contracts-ai";
import type { SessionDatabasePool, SessionDatabaseClient } from "../session/postgresSessionStore.ts";
import { HttpError } from "../errors.ts";
import { SessionStoreUnavailableError } from "../session/sessionStoreErrors.ts";

export type SessionAiDebriefAttemptStatus =
  | "calling_provider"
  | "draft"
  | "confirmed"
  | "failed";

export interface SessionAiDebriefAttempt {
  artifactId: string;
  requestId: string;
  sessionId: string;
  principalId: string;
  gameId: string;
  status: SessionAiDebriefAttemptStatus;
  throughEventSequence: number;
  journalSha256: string;
  methodologyVersion: string;
  promptVersion: string;
  provider: "openai";
  model: string;
  inputDocument: unknown;
  inputCanonical: string;
  inputSha256: string;
  sections?: SessionAiDebriefSections;
  outputSha256?: string;
  usage?: SessionAiDebriefUsage;
  errorCode?: SessionAiDebriefFailureCode;
  createdAt: Date;
  updatedAt: Date;
  confirmedAt?: Date;
}

export type SessionAiDebriefFailureCode =
  | "provider_timeout"
  | "provider_rate_limited"
  | "provider_rejected"
  | "provider_unavailable"
  | "provider_malformed"
  | "provider_schema_invalid"
  | "provider_false_evidence"
  | "provider_unknown";

export interface ClaimSessionAiDebriefInput {
  artifactId: string;
  requestId: string;
  sessionId: string;
  principalId: string;
  gameId: string;
  throughEventSequence: number;
  journalSha256: string;
  methodologyVersion: string;
  promptVersion: string;
  provider: "openai";
  model: string;
  inputDocument: unknown;
  inputCanonical: string;
  inputSha256: string;
  maxAttemptsPerSession: number;
}

export interface SessionAiDebriefStorePort {
  readByRequest(sessionId: string, requestId: string): Promise<SessionAiDebriefAttempt | null>;
  failStaleCallingAttempts(sessionId: string, staleBefore: Date): Promise<number>;
  claim(input: ClaimSessionAiDebriefInput): Promise<{
    claimed: boolean;
    attempt: SessionAiDebriefAttempt;
  }>;
  complete(input: {
    artifactId: string;
    sections: SessionAiDebriefSections;
    outputSha256: string;
    usage: SessionAiDebriefUsage;
  }): Promise<SessionAiDebriefAttempt>;
  fail(input: {
    artifactId: string;
    errorCode: SessionAiDebriefFailureCode;
  }): Promise<SessionAiDebriefAttempt>;
  readLatestCompleted(sessionId: string): Promise<SessionAiDebriefAttempt | null>;
  confirm(input: {
    sessionId: string;
    artifactId: string;
    outputSha256: string;
  }): Promise<SessionAiDebriefAttempt | null>;
}

export class SessionAiDebriefQuotaError extends HttpError {
  constructor() {
    super(429, "The AI debrief attempt quota for this session has been reached.", "AI_DEBRIEF_QUOTA_REACHED");
  }
}

export class SessionAiDebriefRequestConflictError extends HttpError {
  constructor() {
    super(409, "This AI debrief request cannot be repeated with different input.", "AI_DEBRIEF_REQUEST_CONFLICT");
  }
}

export class SessionAiDebriefAttemptUnavailableError extends HttpError {
  constructor() {
    super(409, "This AI debrief attempt has no reusable completed result.", "AI_DEBRIEF_ATTEMPT_UNAVAILABLE");
  }
}

export class InMemorySessionAiDebriefStore implements SessionAiDebriefStorePort {
  private readonly attemptsByArtifactId = new Map<string, SessionAiDebriefAttempt>();
  private readonly artifactIdByRequest = new Map<string, string>();

  async readByRequest(sessionId: string, requestId: string) {
    const artifactId = this.artifactIdByRequest.get(`${sessionId}\u0000${requestId}`);
    if (artifactId === undefined) return null;
    return clone(this.requireAttempt(artifactId));
  }

  async failStaleCallingAttempts(sessionId: string, staleBefore: Date) {
    let failed = 0;
    for (const [artifactId, current] of this.attemptsByArtifactId) {
      if (
        current.sessionId === sessionId &&
        current.status === "calling_provider" &&
        current.updatedAt.getTime() < staleBefore.getTime()
      ) {
        this.attemptsByArtifactId.set(artifactId, {
          ...current,
          status: "failed",
          errorCode: "provider_unknown",
          updatedAt: new Date()
        });
        failed += 1;
      }
    }
    return failed;
  }

  async claim(input: ClaimSessionAiDebriefInput) {
    const requestKey = `${input.sessionId}\u0000${input.requestId}`;
    const existingArtifactId = this.artifactIdByRequest.get(requestKey);
    if (existingArtifactId !== undefined) {
      const existing = this.requireAttempt(existingArtifactId);
      if (
        existing.inputSha256 !== input.inputSha256 ||
        existing.inputCanonical !== input.inputCanonical
      ) {
        throw new SessionAiDebriefRequestConflictError();
      }
      return { claimed: false, attempt: clone(existing) };
    }
    const attemptCount = [...this.attemptsByArtifactId.values()]
      .filter((attempt) => attempt.sessionId === input.sessionId).length;
    if (attemptCount >= input.maxAttemptsPerSession) {
      throw new SessionAiDebriefQuotaError();
    }
    const now = new Date();
    const { maxAttemptsPerSession: _quota, ...storedInput } = structuredClone(input);
    const attempt: SessionAiDebriefAttempt = {
      ...storedInput,
      status: "calling_provider",
      createdAt: now,
      updatedAt: now
    };
    this.attemptsByArtifactId.set(attempt.artifactId, attempt);
    this.artifactIdByRequest.set(requestKey, attempt.artifactId);
    return { claimed: true, attempt: clone(attempt) };
  }

  async complete(input: {
    artifactId: string;
    sections: SessionAiDebriefSections;
    outputSha256: string;
    usage: SessionAiDebriefUsage;
  }) {
    const current = this.requireCallingAttempt(input.artifactId);
    const completed: SessionAiDebriefAttempt = {
      ...current,
      status: "draft",
      sections: structuredClone(input.sections),
      outputSha256: input.outputSha256,
      usage: structuredClone(input.usage),
      updatedAt: new Date()
    };
    this.attemptsByArtifactId.set(input.artifactId, completed);
    return clone(completed);
  }

  async fail(input: { artifactId: string; errorCode: SessionAiDebriefFailureCode }) {
    const current = this.requireCallingAttempt(input.artifactId);
    const failed: SessionAiDebriefAttempt = {
      ...current,
      status: "failed",
      errorCode: input.errorCode,
      updatedAt: new Date()
    };
    this.attemptsByArtifactId.set(input.artifactId, failed);
    return clone(failed);
  }

  async readLatestCompleted(sessionId: string) {
    const completed = [...this.attemptsByArtifactId.values()]
      .filter((attempt) => attempt.sessionId === sessionId &&
        (attempt.status === "draft" || attempt.status === "confirmed"))
      .sort(compareNewest)[0];
    return completed === undefined ? null : clone(completed);
  }

  async confirm(input: { sessionId: string; artifactId: string; outputSha256: string }) {
    const current = this.attemptsByArtifactId.get(input.artifactId);
    if (current === undefined || current.sessionId !== input.sessionId ||
      (current.status !== "draft" && current.status !== "confirmed") ||
      current.outputSha256 !== input.outputSha256) {
      return null;
    }
    if (current.status === "confirmed") return clone(current);
    const confirmedAt = new Date();
    const confirmed: SessionAiDebriefAttempt = {
      ...current,
      status: "confirmed",
      confirmedAt,
      updatedAt: confirmedAt
    };
    this.attemptsByArtifactId.set(input.artifactId, confirmed);
    return clone(confirmed);
  }

  private requireAttempt(artifactId: string) {
    const attempt = this.attemptsByArtifactId.get(artifactId);
    if (attempt === undefined) throw new SessionStoreUnavailableError();
    return attempt;
  }

  private requireCallingAttempt(artifactId: string) {
    const attempt = this.requireAttempt(artifactId);
    if (attempt.status !== "calling_provider") throw new SessionStoreUnavailableError();
    return attempt;
  }
}

interface AttemptRow {
  artifact_id: string;
  request_id: string;
  session_id: string;
  principal_id: string;
  game_id: string;
  status: SessionAiDebriefAttemptStatus;
  through_event_sequence: string | number;
  journal_sha256: string;
  methodology_version: string;
  prompt_version: string;
  provider: "openai";
  model: string;
  input_document: unknown;
  input_canonical: string;
  input_sha256: string;
  output_sections: unknown | null;
  output_sha256: string | null;
  usage: unknown | null;
  error_code: SessionAiDebriefFailureCode | null;
  created_at: Date | string;
  updated_at: Date | string;
  confirmed_at: Date | string | null;
}

const ATTEMPT_COLUMNS = `artifact_id, request_id, session_id, principal_id, game_id,
  status, through_event_sequence, journal_sha256, methodology_version,
  prompt_version, provider, model, input_document, input_canonical, input_sha256, output_sections,
  output_sha256, usage, error_code, created_at, updated_at, confirmed_at`;

export class PostgresSessionAiDebriefStore implements SessionAiDebriefStorePort {
  private readonly pool: SessionDatabasePool;

  constructor(pool: SessionDatabasePool) {
    this.pool = pool;
  }

  async readByRequest(sessionId: string, requestId: string) {
    const result = await this.safeQuery<AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS} FROM session_ai_debriefs WHERE session_id = $1 AND request_id = $2`,
      [sessionId, requestId]
    );
    return result.rows[0] === undefined ? null : mapAttemptRow(result.rows[0]);
  }

  async failStaleCallingAttempts(sessionId: string, staleBefore: Date) {
    const result = await this.safeQuery<{ artifact_id: string }>(
      `UPDATE session_ai_debriefs
       SET status = 'failed', error_code = 'provider_unknown', updated_at = CURRENT_TIMESTAMP
       WHERE session_id = $1 AND status = 'calling_provider' AND updated_at < $2
       RETURNING artifact_id`,
      [sessionId, staleBefore]
    );
    return result.rowCount ?? result.rows.length;
  }

  async claim(input: ClaimSessionAiDebriefInput) {
    return this.transaction(input.sessionId, async (client) => {
      const session = await client.query<{ id: string }>(
        "SELECT id FROM game_sessions WHERE id = $1 AND game_id = $2 AND bundle_hash IS NOT NULL FOR UPDATE",
        [input.sessionId, input.gameId]
      );
      if (session.rowCount !== 1) throw new SessionStoreUnavailableError();
      const existing = await client.query<AttemptRow>(
        `SELECT ${ATTEMPT_COLUMNS} FROM session_ai_debriefs WHERE session_id = $1 AND request_id = $2`,
        [input.sessionId, input.requestId]
      );
      if (existing.rows[0] !== undefined) {
        const attempt = mapAttemptRow(existing.rows[0]);
        if (
          attempt.inputSha256 !== input.inputSha256 ||
          attempt.inputCanonical !== input.inputCanonical
        ) {
          throw new SessionAiDebriefRequestConflictError();
        }
        return { claimed: false, attempt };
      }
      const count = await client.query<{ attempt_count: string | number }>(
        "SELECT COUNT(*) AS attempt_count FROM session_ai_debriefs WHERE session_id = $1",
        [input.sessionId]
      );
      if (parseSafeInteger(count.rows[0]?.attempt_count) >= input.maxAttemptsPerSession) {
        throw new SessionAiDebriefQuotaError();
      }
      const inserted = await client.query<AttemptRow>(
        `INSERT INTO session_ai_debriefs (
           artifact_id, request_id, session_id, principal_id, game_id, status,
           through_event_sequence, journal_sha256, methodology_version,
           prompt_version, provider, model, input_document, input_canonical, input_sha256
         ) VALUES ($1, $2, $3, $4, $5, 'calling_provider', $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)
         RETURNING ${ATTEMPT_COLUMNS}`,
        [
          input.artifactId, input.requestId, input.sessionId, input.principalId,
          input.gameId, input.throughEventSequence, input.journalSha256,
          input.methodologyVersion, input.promptVersion, input.provider, input.model,
          JSON.stringify(input.inputDocument), input.inputCanonical, input.inputSha256
        ]
      );
      return { claimed: true, attempt: mapAttemptRow(requireRow(inserted.rows[0])) };
    });
  }

  async complete(input: {
    artifactId: string;
    sections: SessionAiDebriefSections;
    outputSha256: string;
    usage: SessionAiDebriefUsage;
  }) {
    const result = await this.safeQuery<AttemptRow>(
      `UPDATE session_ai_debriefs
       SET status = 'draft', output_sections = $2::jsonb, output_sha256 = $3,
           usage = $4::jsonb, updated_at = CURRENT_TIMESTAMP
       WHERE artifact_id = $1 AND status = 'calling_provider'
       RETURNING ${ATTEMPT_COLUMNS}`,
      [input.artifactId, JSON.stringify(input.sections), input.outputSha256, JSON.stringify(input.usage)]
    );
    return mapAttemptRow(requireRow(result.rows[0]));
  }

  async fail(input: { artifactId: string; errorCode: SessionAiDebriefFailureCode }) {
    const result = await this.safeQuery<AttemptRow>(
      `UPDATE session_ai_debriefs
       SET status = 'failed', error_code = $2, updated_at = CURRENT_TIMESTAMP
       WHERE artifact_id = $1 AND status = 'calling_provider'
       RETURNING ${ATTEMPT_COLUMNS}`,
      [input.artifactId, input.errorCode]
    );
    return mapAttemptRow(requireRow(result.rows[0]));
  }

  async readLatestCompleted(sessionId: string) {
    const result = await this.safeQuery<AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS} FROM session_ai_debriefs
       WHERE session_id = $1 AND status IN ('draft', 'confirmed')
       ORDER BY created_at DESC, artifact_id DESC LIMIT 1`,
      [sessionId]
    );
    return result.rows[0] === undefined ? null : mapAttemptRow(result.rows[0]);
  }

  async confirm(input: { sessionId: string; artifactId: string; outputSha256: string }) {
    const result = await this.safeQuery<AttemptRow>(
      `UPDATE session_ai_debriefs
       SET status = 'confirmed', confirmed_at = COALESCE(confirmed_at, CURRENT_TIMESTAMP),
           updated_at = CASE WHEN status = 'draft' THEN CURRENT_TIMESTAMP ELSE updated_at END
       WHERE artifact_id = $1 AND session_id = $2 AND output_sha256 = $3
         AND status IN ('draft', 'confirmed')
       RETURNING ${ATTEMPT_COLUMNS}`,
      [input.artifactId, input.sessionId, input.outputSha256]
    );
    return result.rows[0] === undefined ? null : mapAttemptRow(result.rows[0]);
  }

  private async safeQuery<TRow>(text: string, values: unknown[]) {
    try {
      return await this.pool.query<TRow & Record<string, unknown>>(text, values);
    } catch {
      throw new SessionStoreUnavailableError();
    }
  }

  private async transaction<TResult>(
    sessionId: string,
    operation: (client: SessionDatabaseClient) => Promise<TResult>
  ): Promise<TResult> {
    let client: SessionDatabaseClient;
    try {
      client = await this.pool.connect();
    } catch {
      throw new SessionStoreUnavailableError();
    }
    let began = false;
    let releaseError: Error | boolean | undefined;
    try {
      await client.query("BEGIN");
      began = true;
      const result = await operation(client);
      await client.query("COMMIT");
      began = false;
      return result;
    } catch (error) {
      if (began) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          releaseError = rollbackError instanceof Error ? rollbackError : true;
        }
      }
      if (
        error instanceof SessionAiDebriefQuotaError ||
        error instanceof SessionAiDebriefRequestConflictError ||
        error instanceof SessionStoreUnavailableError
      ) throw error;
      throw new SessionStoreUnavailableError();
    } finally {
      client.release(releaseError);
    }
  }
}

function mapAttemptRow(row: AttemptRow): SessionAiDebriefAttempt {
  const attempt: SessionAiDebriefAttempt = {
    artifactId: row.artifact_id,
    requestId: row.request_id,
    sessionId: row.session_id,
    principalId: row.principal_id,
    gameId: row.game_id,
    status: row.status,
    throughEventSequence: parseSafeInteger(row.through_event_sequence),
    journalSha256: row.journal_sha256,
    methodologyVersion: row.methodology_version,
    promptVersion: row.prompt_version,
    provider: row.provider,
    model: row.model,
    inputDocument: structuredClone(row.input_document),
    inputCanonical: row.input_canonical,
    inputSha256: row.input_sha256,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
  if (row.output_sections !== null) attempt.sections = structuredClone(row.output_sections) as SessionAiDebriefSections;
  if (row.output_sha256 !== null) attempt.outputSha256 = row.output_sha256;
  if (row.usage !== null) attempt.usage = structuredClone(row.usage) as SessionAiDebriefUsage;
  if (row.error_code !== null) attempt.errorCode = row.error_code;
  if (row.confirmed_at !== null) attempt.confirmedAt = new Date(row.confirmed_at);
  return attempt;
}

function parseSafeInteger(value: string | number | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new SessionStoreUnavailableError();
  return parsed;
}

function requireRow<T>(row: T | undefined): T {
  if (row === undefined) throw new SessionStoreUnavailableError();
  return row;
}

function compareNewest(left: SessionAiDebriefAttempt, right: SessionAiDebriefAttempt) {
  const time = right.createdAt.getTime() - left.createdAt.getTime();
  if (time !== 0) return time;
  return right.artifactId < left.artifactId ? -1 : right.artifactId > left.artifactId ? 1 : 0;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
