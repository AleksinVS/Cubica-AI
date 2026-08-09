/**
 * PostgreSQL-backed lifecycle for isolated Stage 1 knowledge writes.
 *
 * Every public operation runs as the fixed non-owning application role and
 * installs the principal only for the current transaction. This makes RLS a
 * second boundary behind API authorization and prevents pooled connections
 * from retaining one user's identity. Git is never invoked from a transaction;
 * receipt reconciliation callbacks run between short SQL transactions.
 */
import { isDeepStrictEqual } from 'node:util';
import type { Pool, PoolClient } from 'pg';

import { validateProductKnowledgeContract } from './contracts.ts';
import type {
  DecisionEnvelope,
  ExactPatchProposal,
  KnowledgeWriteOperation,
  SourceRef
} from './generated/product-knowledge.ts';

const APPLICATION_ROLE = 'product_context_stage1_app';
const TABLE = 'product_context_stage1.knowledge_write_operations';
const SPACES = 'product_context_stage1.knowledge_spaces';

export type OperationStatus = KnowledgeWriteOperation['status'];
export type OperationStatusReason = KnowledgeWriteOperation['status_reason'];
export type ConfirmationMethod = NonNullable<KnowledgeWriteOperation['confirmation']>['method'];
export type ConflictReason = Extract<
  OperationStatusReason,
  | 'base_revision_changed'
  | 'read_set_changed'
  | 'impact_changed'
  | 'authorization_changed'
  | 'policy_changed'
  | 'requires_extended_review'
  | 'git_ref_conflict'
>;
export type FailedReason = Extract<OperationStatusReason, 'invalid_payload' | 'secret_detected'>;
export type OperationErrorCode = NonNullable<KnowledgeWriteOperation['last_error_code']>;

export interface KnowledgeSpaceRecord {
  readonly spaceId: string;
  readonly ownerRef: string;
  readonly subjectRef: string;
  readonly trustZoneRef: string;
  readonly accessPolicyRef: string;
  readonly retentionPolicyRef: string;
  readonly repositoryRef: string;
  readonly status: 'active' | 'blocked' | 'erasing';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateKnowledgeSpaceInput {
  readonly spaceId: string;
  readonly subjectRef: string;
  readonly trustZoneRef: string;
  readonly accessPolicyRef: string;
  readonly retentionPolicyRef: string;
  readonly repositoryRef: string;
}

export interface CreateKnowledgeOperationInput {
  readonly operationId: string;
  readonly spaceId: string;
  readonly idempotencyKey: string;
  readonly proposal: ExactPatchProposal;
  readonly envelope: DecisionEnvelope;
}

export interface ReceiptLookupInput {
  readonly operationId: string;
  readonly patchHash: string;
}

/** Looks for a commit reachable from the trusted ref, never an arbitrary object. */
export type ReceiptReconciliationHook = (input: ReceiptLookupInput) => Promise<string | null>;

interface DbOperationRow {
  schema_version: '1.0.0';
  operation_id: string;
  space_id: string;
  creator_ref: string;
  idempotency_key: string;
  proposal_id: string;
  patch_hash: string | null;
  status: OperationStatus;
  status_reason: OperationStatusReason;
  decision_envelope_id: string;
  decision_envelope: DecisionEnvelope | null;
  patch_payload: ExactPatchProposal | null;
  source_refs: SourceRef[] | null;
  confirmation: KnowledgeWriteOperation['confirmation'] | null;
  confirmed_patch_hash: string | null;
  commit_sha: string | null;
  attempt_count: number;
  lease_owner: string | null;
  lease_expires_at: Date | string | null;
  next_retry_at: Date | string | null;
  last_error_at: Date | string | null;
  last_error_code: OperationErrorCode | null;
  applied_at: Date | string | null;
  payload_purged_at: Date | string | null;
  created_at: Date | string;
}

interface DbSpaceRow {
  space_id: string;
  owner_ref: string;
  subject_ref: string;
  trust_zone_ref: string;
  access_policy_ref: string;
  retention_policy_ref: string;
  repository_ref: string;
  status: KnowledgeSpaceRecord['status'];
  created_at: Date | string;
  updated_at: Date | string;
}

/** Deliberately generic so a caller cannot distinguish a hidden row from a bad hash. */
export class OperationUnavailableError extends Error {
  constructor() {
    super('Knowledge operation is unavailable for the requested transition.');
    this.name = 'OperationUnavailableError';
  }
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super('The idempotency key is already bound to a different operation.');
    this.name = 'IdempotencyConflictError';
  }
}

/** SQL adapter for one caller-authorized personal knowledge partition. */
export class ProductContextPostgresStore {
  constructor(private readonly pool: Pool) {}

  /** Creates a space owned by the transaction principal; clients cannot select another owner. */
  async createSpace(principalRef: string, input: CreateKnowledgeSpaceInput): Promise<KnowledgeSpaceRecord> {
    return this.withPrincipal(principalRef, async (client) => {
      const result = await client.query<DbSpaceRow>(`
        INSERT INTO ${SPACES} (
          space_id, owner_ref, subject_ref, trust_zone_ref,
          access_policy_ref, retention_policy_ref, repository_ref
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `, [
        input.spaceId,
        principalRef,
        input.subjectRef,
        input.trustZoneRef,
        input.accessPolicyRef,
        input.retentionPolicyRef,
        input.repositoryRef
      ]);
      return mapSpace(result.rows[0]);
    });
  }

  async getSpace(principalRef: string, spaceId: string): Promise<KnowledgeSpaceRecord | null> {
    return this.withPrincipal(principalRef, async (client) => {
      const result = await client.query<DbSpaceRow>(`SELECT * FROM ${SPACES} WHERE space_id = $1`, [spaceId]);
      return result.rows[0] ? mapSpace(result.rows[0]) : null;
    });
  }

  /** Persists one immutable pending proposal, or returns its exact idempotent predecessor. */
  async createOperation(principalRef: string, input: CreateKnowledgeOperationInput): Promise<KnowledgeWriteOperation> {
    assertContract('ExactPatchProposal', input.proposal);
    assertContract('DecisionEnvelope', input.envelope);
    if (
      input.proposal.proposal_id === '' ||
      input.envelope.space_id !== input.spaceId ||
      input.envelope.principal_ref !== principalRef ||
      !sameStrings(input.proposal.applies_to as unknown as string[], input.envelope.applies_to as unknown as string[])
    ) {
      throw new OperationUnavailableError();
    }

    const createdAt = new Date().toISOString();
    const operation: KnowledgeWriteOperation = {
      schema_version: '1.0.0',
      operation_id: input.operationId,
      space_id: input.spaceId,
      creator_ref: principalRef,
      idempotency_key: input.idempotencyKey,
      proposal_id: input.proposal.proposal_id,
      patch_hash: input.proposal.patch_hash,
      status: 'pending_confirmation',
      status_reason: 'awaiting_confirmation',
      decision_envelope_id: input.envelope.envelope_id,
      decision_envelope: input.envelope,
      patch_payload: input.proposal,
      source_refs: input.proposal.source_refs,
      confirmation: null,
      confirmed_patch_hash: null,
      attempt_count: 0,
      lease_owner: null,
      created_at: createdAt
    };
    assertContract('KnowledgeWriteOperation', operation);

    return this.withPrincipal(principalRef, async (client) => {
      const inserted = await client.query<DbOperationRow>(`
        INSERT INTO ${TABLE} (
          operation_id, space_id, owner_ref, creator_ref, idempotency_key,
          proposal_id, patch_hash, status, status_reason, decision_envelope_id,
          decision_envelope, patch_payload, source_refs, confirmation,
          confirmed_patch_hash, attempt_count, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $3, $4, $5, $6, 'pending_confirmation',
          'awaiting_confirmation', $7, $8::jsonb, $9::jsonb, $10::jsonb,
          NULL, NULL, 0, $11, $11
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING '1.0.0'::text AS schema_version, *
      `, [
        input.operationId,
        input.spaceId,
        principalRef,
        input.idempotencyKey,
        input.proposal.proposal_id,
        input.proposal.patch_hash,
        input.envelope.envelope_id,
        JSON.stringify(input.envelope),
        JSON.stringify(input.proposal),
        JSON.stringify(input.proposal.source_refs),
        createdAt
      ]);
      if (inserted.rows[0]) return mapOperation(inserted.rows[0]);

      const existing = await client.query<DbOperationRow>(`
        SELECT '1.0.0'::text AS schema_version, * FROM ${TABLE}
        WHERE idempotency_key = $1
      `, [input.idempotencyKey]);
      const row = existing.rows[0];
      if (!row) throw new OperationUnavailableError();
      if (
        row.operation_id !== input.operationId ||
        row.patch_hash !== input.proposal.patch_hash ||
        row.decision_envelope_id !== input.envelope.envelope_id ||
        !isDeepStrictEqual(row.patch_payload, input.proposal) ||
        !isDeepStrictEqual(row.decision_envelope, input.envelope)
      ) throw new IdempotencyConflictError();
      return mapOperation(row);
    });
  }

  /** Generic get requested by the storage contract; RLS hides foreign identifiers. */
  async get(principalRef: string, operationId: string): Promise<KnowledgeWriteOperation | null> {
    return this.getOperation(principalRef, operationId);
  }

  async getOperation(principalRef: string, operationId: string): Promise<KnowledgeWriteOperation | null> {
    return this.withPrincipal(principalRef, async (client) => {
      const result = await client.query<DbOperationRow>(`
        SELECT '1.0.0'::text AS schema_version, * FROM ${TABLE}
        WHERE operation_id = $1
      `, [operationId]);
      return result.rows[0] ? mapOperation(result.rows[0]) : null;
    });
  }

  async confirmOperation(
    principalRef: string,
    operationId: string,
    patchHash: string,
    method: ConfirmationMethod,
    confirmedAt = new Date()
  ): Promise<KnowledgeWriteOperation> {
    const confirmation = {
      operation_id: operationId,
      patch_hash: patchHash,
      principal_ref: principalRef,
      method,
      confirmed_at: confirmedAt.toISOString()
    };
    return this.updateOne(principalRef, `
      UPDATE ${TABLE}
      SET status = 'ready', status_reason = 'ready_to_apply',
          confirmation = $3::jsonb, confirmed_patch_hash = $2,
          updated_at = clock_timestamp()
      WHERE operation_id = $1 AND status = 'pending_confirmation' AND patch_hash = $2
      RETURNING '1.0.0'::text AS schema_version, *
    `, [operationId, patchHash, JSON.stringify(confirmation)]);
  }

  async rejectOperation(principalRef: string, operationId: string, rejectedAt = new Date()): Promise<KnowledgeWriteOperation> {
    return this.updateOne(principalRef, `
      UPDATE ${TABLE}
      SET status = 'rejected', status_reason = 'explicitly_rejected',
          decision_envelope = NULL, patch_payload = NULL, source_refs = NULL,
          confirmation = NULL, patch_hash = NULL, confirmed_patch_hash = NULL,
          payload_purged_at = $2, updated_at = $2
      WHERE operation_id = $1 AND status = 'pending_confirmation'
      RETURNING '1.0.0'::text AS schema_version, *
    `, [operationId, rejectedAt.toISOString()]);
  }

  /**
   * Expires an unconfirmed proposal, or work explicitly surrendered by its
   * current lease holder before Git mutation begins.
   */
  async expireOperation(
    principalRef: string,
    operationId: string,
    expiredAt = new Date(),
    leaseOwner?: string
  ): Promise<KnowledgeWriteOperation> {
    return this.updateOne(principalRef, `
      UPDATE ${TABLE}
      SET status = 'expired', status_reason = 'confirmation_expired',
          decision_envelope = NULL, patch_payload = NULL, source_refs = NULL,
          confirmation = NULL, patch_hash = NULL, confirmed_patch_hash = NULL,
          lease_owner = NULL, lease_expires_at = NULL, next_retry_at = NULL,
          payload_purged_at = $2, updated_at = $2
      WHERE operation_id = $1 AND (
        status = 'pending_confirmation' OR
        (status = 'applying' AND lease_owner = $3)
      )
      RETURNING '1.0.0'::text AS schema_version, *
    `, [operationId, expiredAt.toISOString(), leaseOwner ?? null]);
  }

  /** Atomically skips work locked by another worker and claims at most one ready row. */
  async claimReady(
    principalRef: string,
    leaseOwner: string,
    leaseDurationMs: number,
    now = new Date()
  ): Promise<KnowledgeWriteOperation | null> {
    if (!leaseOwner || !Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 0) {
      throw new TypeError('A positive integer lease and non-empty owner are required.');
    }
    return this.withPrincipal(principalRef, async (client) => {
      const result = await client.query<DbOperationRow>(`
        WITH candidate AS (
          SELECT operation_id
          FROM ${TABLE}
          WHERE status = 'ready' AND (next_retry_at IS NULL OR next_retry_at <= $1)
          ORDER BY created_at, operation_id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE ${TABLE} AS operation
        SET status = 'applying', status_reason = 'ready_to_apply',
            lease_owner = $2,
            lease_expires_at = $1::timestamptz + ($3::bigint * interval '1 millisecond'),
            attempt_count = operation.attempt_count + 1,
            next_retry_at = NULL,
            updated_at = $1
        FROM candidate
        WHERE operation.operation_id = candidate.operation_id
        RETURNING '1.0.0'::text AS schema_version, operation.*
      `, [now.toISOString(), leaseOwner, leaseDurationMs]);
      return result.rows[0] ? mapOperation(result.rows[0]) : null;
    });
  }

  async releaseTemporary(
    principalRef: string,
    operationId: string,
    leaseOwner: string,
    nextRetryAt: Date
  ): Promise<KnowledgeWriteOperation> {
    return this.updateOne(principalRef, `
      UPDATE ${TABLE}
      SET status = 'ready', status_reason = 'temporary_storage_failure',
          lease_owner = NULL, lease_expires_at = NULL,
          next_retry_at = $3, last_error_at = clock_timestamp(),
          last_error_code = 'storage_unavailable',
          updated_at = clock_timestamp()
      WHERE operation_id = $1 AND status = 'applying' AND lease_owner = $2
      RETURNING '1.0.0'::text AS schema_version, *
    `, [operationId, leaseOwner, nextRetryAt.toISOString()]);
  }

  /**
   * Reconciles every expired lease before releasing it. The hook executes
   * after the listing transaction committed, so a Git lookup can never extend
   * a PostgreSQL transaction or row lock.
   */
  async recoverExpiredLeases(
    principalRef: string,
    receiptLookup: ReceiptReconciliationHook,
    now = new Date()
  ): Promise<KnowledgeWriteOperation[]> {
    const expired = await this.withPrincipal(principalRef, async (client) => {
      const result = await client.query<{ operation_id: string; patch_hash: string }>(`
        SELECT operation_id, patch_hash
        FROM ${TABLE}
        WHERE status = 'applying' AND lease_expires_at <= $1 AND patch_hash IS NOT NULL
        ORDER BY lease_expires_at, operation_id
      `, [now.toISOString()]);
      return result.rows;
    });

    const recovered: KnowledgeWriteOperation[] = [];
    for (const receipt of expired) {
      const commitSha = await receiptLookup({
        operationId: receipt.operation_id,
        patchHash: receipt.patch_hash
      });
      const operation = commitSha
        ? await this.reconcileAppliedReceipt(principalRef, receipt.operation_id, commitSha)
        : await this.releaseExpiredLease(principalRef, receipt.operation_id, now);
      if (operation) recovered.push(operation);
    }
    return recovered;
  }

  async markApplied(
    principalRef: string,
    operationId: string,
    leaseOwner: string,
    commitSha: string,
    appliedAt = new Date()
  ): Promise<KnowledgeWriteOperation> {
    assertCommitSha(commitSha);
    return this.updateOne(principalRef, `
      UPDATE ${TABLE}
      SET status = 'applied', status_reason = 'applied', commit_sha = $3,
          applied_at = $4, lease_owner = NULL, lease_expires_at = NULL,
          updated_at = $4
      WHERE operation_id = $1 AND status = 'applying' AND lease_owner = $2
      RETURNING '1.0.0'::text AS schema_version, *
    `, [operationId, leaseOwner, commitSha, appliedAt.toISOString()]);
  }

  /** Finishes only an applying row after the trusted Git ref proves the receipt. */
  async reconcileAppliedReceipt(
    principalRef: string,
    operationId: string,
    commitSha: string,
    appliedAt = new Date()
  ): Promise<KnowledgeWriteOperation> {
    assertCommitSha(commitSha);
    const current = await this.getOperation(principalRef, operationId);
    if (current?.status === 'applied') {
      if (current.commit_sha !== commitSha) throw new OperationUnavailableError();
      return current;
    }
    return this.updateOne(principalRef, `
      UPDATE ${TABLE}
      SET status = 'applied', status_reason = 'applied', commit_sha = $2,
          applied_at = $3, lease_owner = NULL, lease_expires_at = NULL,
          updated_at = $3
      WHERE operation_id = $1 AND status = 'applying'
      RETURNING '1.0.0'::text AS schema_version, *
    `, [operationId, commitSha, appliedAt.toISOString()]);
  }

  async markConflict(
    principalRef: string,
    operationId: string,
    leaseOwner: string,
    reason: ConflictReason
  ): Promise<KnowledgeWriteOperation> {
    return this.updateOne(principalRef, `
      UPDATE ${TABLE}
      SET status = 'conflict', status_reason = $3,
          lease_owner = NULL, lease_expires_at = NULL,
          updated_at = clock_timestamp()
      WHERE operation_id = $1 AND status = 'applying' AND lease_owner = $2
      RETURNING '1.0.0'::text AS schema_version, *
    `, [operationId, leaseOwner, reason]);
  }

  async markFailed(
    principalRef: string,
    operationId: string,
    leaseOwner: string,
    reason: FailedReason,
    errorCode: Extract<OperationErrorCode, 'invalid_payload'> = 'invalid_payload'
  ): Promise<KnowledgeWriteOperation> {
    return this.updateOne(principalRef, `
      UPDATE ${TABLE}
      SET status = 'failed', status_reason = $3,
          lease_owner = NULL, lease_expires_at = NULL,
          next_retry_at = NULL, last_error_at = clock_timestamp(), last_error_code = $4,
          updated_at = clock_timestamp()
      WHERE operation_id = $1 AND status = 'applying' AND lease_owner = $2
      RETURNING '1.0.0'::text AS schema_version, *
    `, [operationId, leaseOwner, reason, errorCode]);
  }

  /** Removes every content-bearing field while retaining the short Git receipt. */
  async purgeAppliedPayload(
    principalRef: string,
    operationId: string,
    purgedAt = new Date()
  ): Promise<KnowledgeWriteOperation> {
    return this.updateOne(principalRef, `
      UPDATE ${TABLE}
      SET status_reason = 'payload_purged', decision_envelope = NULL,
          patch_payload = NULL, source_refs = NULL, confirmation = NULL,
          patch_hash = NULL, confirmed_patch_hash = NULL,
          payload_purged_at = $2, updated_at = $2
      WHERE operation_id = $1 AND status = 'applied' AND payload_purged_at IS NULL
      RETURNING '1.0.0'::text AS schema_version, *
    `, [operationId, purgedAt.toISOString()]);
  }

  /**
   * Idempotent Stage 1 garbage collection for the crash window after SQL was
   * marked applied but before its content-bearing fields were removed.
   */
  async purgeAllAppliedPayloads(
    principalRef: string,
    purgedAt = new Date()
  ): Promise<KnowledgeWriteOperation[]> {
    return this.withPrincipal(principalRef, async (client) => {
      const result = await client.query<DbOperationRow>(`
        UPDATE ${TABLE}
        SET status_reason = 'payload_purged', decision_envelope = NULL,
            patch_payload = NULL, source_refs = NULL, confirmation = NULL,
            patch_hash = NULL, confirmed_patch_hash = NULL,
            payload_purged_at = $1, updated_at = $1
        WHERE status = 'applied' AND payload_purged_at IS NULL
        RETURNING '1.0.0'::text AS schema_version, *
      `, [purgedAt.toISOString()]);
      return result.rows.map(mapOperation);
    });
  }

  /** Physical erasure removes the entire PostgreSQL row; no content hash survives here. */
  async physicalDeleteOperation(principalRef: string, operationId: string): Promise<boolean> {
    return this.withPrincipal(principalRef, async (client) => {
      const result = await client.query(`DELETE FROM ${TABLE} WHERE operation_id = $1`, [operationId]);
      return result.rowCount === 1;
    });
  }

  private async releaseExpiredLease(
    principalRef: string,
    operationId: string,
    now: Date
  ): Promise<KnowledgeWriteOperation | null> {
    return this.withPrincipal(principalRef, async (client) => {
      const result = await client.query<DbOperationRow>(`
        UPDATE ${TABLE}
        SET status = 'ready', status_reason = 'lease_expired',
            lease_owner = NULL, lease_expires_at = NULL, next_retry_at = NULL,
            updated_at = $2
        WHERE operation_id = $1 AND status = 'applying' AND lease_expires_at <= $2
        RETURNING '1.0.0'::text AS schema_version, *
      `, [operationId, now.toISOString()]);
      return result.rows[0] ? mapOperation(result.rows[0]) : null;
    });
  }

  private async updateOne(
    principalRef: string,
    sql: string,
    parameters: readonly unknown[]
  ): Promise<KnowledgeWriteOperation> {
    return this.withPrincipal(principalRef, async (client) => {
      const result = await client.query<DbOperationRow>(sql, [...parameters]);
      if (!result.rows[0]) throw new OperationUnavailableError();
      return mapOperation(result.rows[0]);
    });
  }

  /** Installs both the app role and principal for one short transaction only. */
  private async withPrincipal<T>(principalRef: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let transactionStarted = false;
    let discardClient = false;
    try {
      await client.query('BEGIN');
      transactionStarted = true;
      await client.query(`SET LOCAL ROLE ${APPLICATION_ROLE}`);
      await client.query("SELECT set_config('cubica.principal_ref', $1, true)", [principalRef]);
      const result = await work(client);
      await client.query('COMMIT');
      transactionStarted = false;
      return result;
    } catch (error) {
      if (transactionStarted) {
        // Rollback is best-effort cleanup; the originating error is the useful
        // diagnostic and must not be replaced by a broken connection's error.
        try {
          await client.query('ROLLBACK');
        } catch {
          // An unknown transaction state must never be reused for a different
          // principal. node-postgres accepts `true` here to destroy the client.
          discardClient = true;
        }
      }
      throw error;
    } finally {
      client.release(discardClient);
    }
  }
}

function mapSpace(row: DbSpaceRow): KnowledgeSpaceRecord {
  return {
    spaceId: row.space_id,
    ownerRef: row.owner_ref,
    subjectRef: row.subject_ref,
    trustZoneRef: row.trust_zone_ref,
    accessPolicyRef: row.access_policy_ref,
    retentionPolicyRef: row.retention_policy_ref,
    repositoryRef: row.repository_ref,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function mapOperation(row: DbOperationRow): KnowledgeWriteOperation {
  const operation: KnowledgeWriteOperation = {
    schema_version: '1.0.0',
    operation_id: row.operation_id,
    space_id: row.space_id,
    creator_ref: row.creator_ref,
    idempotency_key: row.idempotency_key,
    proposal_id: row.proposal_id,
    patch_hash: row.patch_hash,
    status: row.status,
    status_reason: row.status_reason,
    decision_envelope_id: row.decision_envelope_id,
    decision_envelope: row.decision_envelope,
    patch_payload: row.patch_payload,
    source_refs: row.source_refs,
    confirmation: row.confirmation,
    confirmed_patch_hash: row.confirmed_patch_hash,
    attempt_count: row.attempt_count,
    lease_owner: row.lease_owner,
    created_at: iso(row.created_at)
  };
  if (row.commit_sha) operation.commit_sha = row.commit_sha;
  if (row.lease_expires_at) operation.lease_expires_at = iso(row.lease_expires_at);
  if (row.next_retry_at) operation.next_retry_at = iso(row.next_retry_at);
  if (row.last_error_at) operation.last_error_at = iso(row.last_error_at);
  if (row.last_error_code) operation.last_error_code = row.last_error_code;
  if (row.applied_at) operation.applied_at = iso(row.applied_at);
  if (row.payload_purged_at) operation.payload_purged_at = iso(row.payload_purged_at);
  assertContract('KnowledgeWriteOperation', operation);
  return operation;
}

function assertContract(name: 'ExactPatchProposal' | 'DecisionEnvelope' | 'KnowledgeWriteOperation', value: unknown): void {
  const result = validateProductKnowledgeContract(name, value);
  if (!result.ok) throw new TypeError(`${name} violates the canonical JSON Schema.`);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function assertCommitSha(commitSha: string): void {
  if (!/^[a-f0-9]{40}$/.test(commitSha)) throw new TypeError('Commit SHA must be 40 lowercase hexadecimal characters.');
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
