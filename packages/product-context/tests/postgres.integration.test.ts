/**
 * PostgreSQL 17 integration checks for lifecycle, concurrency and RLS.
 *
 * The suite is intentionally skipped only when its isolated database URL is
 * absent. It never falls back to another database or prints the URL.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  IdempotencyConflictError,
  OperationUnavailableError,
  ProductContextPostgresStore
} from '../src/postgres.ts';
import type { DecisionEnvelope, ExactPatchProposal } from '../src/generated/product-knowledge.ts';

const databaseUrl = process.env.TEST_PRODUCT_CONTEXT_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;
const principalA = 'cubica://user/alice';
const principalB = 'cubica://user/bob';
const patchHash = `sha256:${'a'.repeat(64)}`;
const impactHash = `sha256:${'b'.repeat(64)}`;
const commitSha = 'c'.repeat(40);

integration('isolated PostgreSQL knowledge lifecycle', () => {
  let adminPool: Pool;
  let store: ProductContextPostgresStore;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: databaseUrl, max: 8 });
    const migrationPath = fileURLToPath(new URL('../migrations/001_product_context_stage1.sql', import.meta.url));
    await adminPool.query(await readFile(migrationPath, 'utf8'));
    store = new ProductContextPostgresStore(adminPool);
  });

  beforeEach(async () => {
    await adminPool.query(`
      TRUNCATE product_context_stage1.knowledge_write_operations,
               product_context_stage1.knowledge_spaces
    `);
  });

  afterAll(async () => {
    await adminPool?.end();
  });

  it('enforces the positive lifecycle, terminal states and a contentless receipt', async () => {
    await createSpace(store, principalA);
    const pending = await createPending(store, principalA, 'op_lifecycle', 'idem_lifecycle_0001');
    expect(pending.status).toBe('pending_confirmation');

    const ready = await store.confirmOperation(principalA, pending.operation_id, patchHash, 'user_confirmation');
    expect(ready.status).toBe('ready');
    const applying = await store.claimReady(principalA, 'worker-a', 30_000);
    expect(applying).toMatchObject({ operation_id: pending.operation_id, status: 'applying', attempt_count: 1 });

    const applied = await store.markApplied(principalA, pending.operation_id, 'worker-a', applying!.attempt_count, commitSha);
    expect(applied).toMatchObject({ status: 'applied', commit_sha: commitSha, status_reason: 'applied' });
    await expect(store.rejectOperation(principalA, pending.operation_id)).rejects.toBeInstanceOf(OperationUnavailableError);
    await expect(asPrincipal(adminPool, principalA, (client) => client.query(`
      UPDATE product_context_stage1.knowledge_write_operations
      SET status = 'ready', status_reason = 'ready_to_apply', commit_sha = NULL, applied_at = NULL
      WHERE operation_id = $1
    `, [pending.operation_id]))).rejects.toMatchObject({ code: '23514' });

    const receipt = await store.purgeAppliedPayload(principalA, pending.operation_id);
    expect(receipt).toMatchObject({ status: 'applied', status_reason: 'payload_purged', commit_sha: commitSha });
    expect(receipt.patch_hash).toBeNull();
    expect(receipt.patch_payload).toBeNull();
    expect(receipt.decision_envelope).toBeNull();
    expect(receipt.source_refs).toBeNull();
    expect(receipt.confirmation).toBeNull();
  });

  it('binds confirmation to the exact hash and current principal and keeps content immutable', async () => {
    await createSpace(store, principalA);
    const pending = await createPending(store, principalA, 'op_confirmation', 'idem_confirmation_1');
    await expect(store.confirmOperation(principalA, pending.operation_id, `sha256:${'f'.repeat(64)}`, 'user_confirmation'))
      .rejects.toBeInstanceOf(OperationUnavailableError);
    await expect(store.confirmOperation(principalB, pending.operation_id, patchHash, 'user_confirmation'))
      .rejects.toBeInstanceOf(OperationUnavailableError);

    await expect(asPrincipal(adminPool, principalA, (client) => client.query(`
      UPDATE product_context_stage1.knowledge_write_operations
      SET patch_payload = jsonb_set(patch_payload, '{proposal_id}', '"prop_tampered"')
      WHERE operation_id = $1
    `, [pending.operation_id]))).rejects.toMatchObject({ code: '23514' });

    const confirmed = await store.confirmOperation(principalA, pending.operation_id, patchHash, 'user_confirmation');
    expect(confirmed.confirmation).toMatchObject({ operation_id: pending.operation_id, patch_hash: patchHash, principal_ref: principalA });
  });

  it('makes one idempotency key resolve to one exact operation', async () => {
    await createSpace(store, principalA);
    const first = await createPending(store, principalA, 'op_idempotent', 'idem_idempotent_01');
    const repeated = await createPending(store, principalA, 'op_idempotent', 'idem_idempotent_01');
    expect(repeated.operation_id).toBe(first.operation_id);
    await expect(createPending(store, principalA, 'op_other', 'idem_idempotent_01'))
      .rejects.toBeInstanceOf(IdempotencyConflictError);

    const changedEnvelope = envelope('op_idempotent', 'space_alice', principalA);
    changedEnvelope.policy_decisions.access.version = 'different-policy-version';
    await expect(store.createOperation(principalA, {
      operationId: 'op_idempotent',
      spaceId: 'space_alice',
      idempotencyKey: 'idem_idempotent_01',
      proposal: proposal('op_idempotent'),
      envelope: changedEnvelope
    })).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('allows only one concurrent claim and makes a released row claimable later', async () => {
    await createSpace(store, principalA);
    const pending = await createPending(store, principalA, 'op_claim', 'idem_claim_0000001');
    await store.confirmOperation(principalA, pending.operation_id, patchHash, 'user_confirmation');

    const [left, right] = await Promise.all([
      store.claimReady(principalA, 'worker-left', 30_000),
      store.claimReady(principalA, 'worker-right', 30_000)
    ]);
    const winner = left ?? right;
    expect([left, right].filter(Boolean)).toHaveLength(1);
    expect(winner?.status).toBe('applying');

    const released = await store.releaseTemporary(
      principalA,
      pending.operation_id,
      winner!.lease_owner!,
      winner!.attempt_count,
      new Date(0)
    );
    expect(released).toMatchObject({
      status: 'ready',
      status_reason: 'temporary_storage_failure',
      last_error_code: 'storage_unavailable'
    });
    const later = await store.claimReady(principalA, 'worker-later', 30_000);
    expect(later).toMatchObject({ operation_id: pending.operation_id, status: 'applying', attempt_count: 2 });
  });

  it('rejects every stale same-owner transition after the row is claimed again', async () => {
    await createSpace(store, principalA);
    const owner = 'same-owner-worker';
    const staleTransitions: Array<{
      name: string;
      run: (operationId: string, staleAttempt: number) => Promise<unknown>;
    }> = [
      {
        name: 'markApplied',
        run: (operationId, staleAttempt) => store.markApplied(
          principalA, operationId, owner, staleAttempt, commitSha
        )
      },
      {
        name: 'markConflict',
        run: (operationId, staleAttempt) => store.markConflict(
          principalA, operationId, owner, staleAttempt, 'authorization_changed'
        )
      },
      {
        name: 'markFailed',
        run: (operationId, staleAttempt) => store.markFailed(
          principalA, operationId, owner, staleAttempt, 'invalid_payload'
        )
      },
      {
        name: 'releaseTemporary',
        run: (operationId, staleAttempt) => store.releaseTemporary(
          principalA, operationId, owner, staleAttempt, new Date(0)
        )
      },
      {
        name: 'expireOperation',
        run: (operationId, staleAttempt) => store.expireOperation(
          principalA, operationId, new Date(), owner, staleAttempt
        )
      }
    ];
    let latestOperationId = '';
    let latestAttempt = 0;

    for (const [index, transition] of staleTransitions.entries()) {
      const operationId = `op_attempt_fence_${index}`;
      const pending = await createPending(store, principalA, operationId, `idem_attempt_fence_${index}`);
      await store.confirmOperation(principalA, pending.operation_id, patchHash, 'user_confirmation');
      const attemptN = await store.claimReady(principalA, owner, 30_000);
      expect(attemptN, transition.name).toMatchObject({
        operation_id: operationId,
        status: 'applying',
        lease_owner: owner,
        attempt_count: 1
      });

      await store.releaseTemporary(principalA, operationId, owner, attemptN!.attempt_count, new Date(0));
      const attemptN1 = await store.claimReady(principalA, owner, 30_000);
      expect(attemptN1, transition.name).toMatchObject({
        operation_id: operationId,
        status: 'applying',
        lease_owner: owner,
        attempt_count: 2
      });

      await expect(transition.run(operationId, attemptN!.attempt_count), transition.name)
        .rejects.toBeInstanceOf(OperationUnavailableError);
      await expect(store.getOperation(principalA, operationId), transition.name).resolves.toMatchObject({
        status: 'applying',
        lease_owner: owner,
        attempt_count: attemptN1!.attempt_count
      });
      latestOperationId = operationId;
      latestAttempt = attemptN1!.attempt_count;
    }

    await expect(store.markApplied(principalA, latestOperationId, owner, latestAttempt, commitSha))
      .resolves.toMatchObject({ status: 'applied', commit_sha: commitSha, attempt_count: 2 });
  });

  it('checks a reachable receipt outside SQL before recovering an expired lease', async () => {
    await createSpace(store, principalA);
    const pending = await createPending(store, principalA, 'op_recovery', 'idem_recovery_0001');
    await store.confirmOperation(principalA, pending.operation_id, patchHash, 'user_confirmation');
    await store.claimReady(principalA, 'dead-worker', 1, new Date('2026-01-01T00:00:00Z'));

    let transactionWasClosed = false;
    const recovered = await store.recoverExpiredLeases(principalA, async ({ operationId, patchHash: expectedHash }) => {
      const probe = await adminPool.query("SELECT current_setting('cubica.principal_ref', true) AS principal");
      transactionWasClosed = probe.rows[0].principal === '';
      expect(operationId).toBe(pending.operation_id);
      expect(expectedHash).toBe(patchHash);
      return commitSha;
    }, new Date('2026-01-01T00:00:01Z'));

    expect(transactionWasClosed).toBe(true);
    expect(recovered[0]).toMatchObject({ status: 'applied', commit_sha: commitSha });
    await expect(store.reconcileAppliedReceipt(principalA, pending.operation_id, commitSha))
      .resolves.toMatchObject({ status: 'applied', commit_sha: commitSha });
  });

  it('returns an expired lease without a receipt to ready using the same payload', async () => {
    await createSpace(store, principalA);
    const pending = await createPending(store, principalA, 'op_expired_lease', 'idem_expired_lease');
    await store.confirmOperation(principalA, pending.operation_id, patchHash, 'user_confirmation');
    await store.claimReady(principalA, 'dead-worker', 1, new Date('2026-01-01T00:00:00Z'));
    const recovered = await store.recoverExpiredLeases(principalA, async () => null, new Date('2026-01-01T00:00:01Z'));
    expect(recovered[0]).toMatchObject({ status: 'ready', status_reason: 'lease_expired', patch_hash: patchHash });
  });

  it('supports reject, expire, conflict, failed and physical deletion terminal paths', async () => {
    await createSpace(store, principalA);
    const rejected = await createPending(store, principalA, 'op_rejected', 'idem_rejected_0001');
    expect((await store.rejectOperation(principalA, rejected.operation_id)).status).toBe('rejected');

    const expired = await createPending(store, principalA, 'op_expired', 'idem_expired_00001');
    expect((await store.expireOperation(principalA, expired.operation_id)).status).toBe('expired');

    const conflict = await readyAndClaim(store, principalA, 'op_conflict', 'idem_conflict_0001', 'worker-conflict');
    expect((await store.markConflict(
      principalA,
      conflict.operation_id,
      'worker-conflict',
      conflict.attempt_count,
      'authorization_changed'
    )).status).toBe('conflict');

    const failed = await readyAndClaim(store, principalA, 'op_failed', 'idem_failed_000001', 'worker-failed');
    expect((await store.markFailed(
      principalA,
      failed.operation_id,
      'worker-failed',
      failed.attempt_count,
      'invalid_payload'
    )).status).toBe('failed');
    await expect(store.confirmOperation(principalA, failed.operation_id, patchHash, 'user_confirmation'))
      .rejects.toBeInstanceOf(OperationUnavailableError);

    expect(await store.physicalDeleteOperation(principalA, failed.operation_id)).toBe(true);
    expect(await store.getOperation(principalA, failed.operation_id)).toBeNull();
  });

  it('keeps raw SQL transitions inside the schema lifecycle invariants', async () => {
    await createSpace(store, principalA);
    const pending = await createPending(store, principalA, 'op_raw_terminal', 'idem_raw_terminal');
    await expect(asPrincipal(adminPool, principalA, (client) => client.query(`
      UPDATE product_context_stage1.knowledge_write_operations
      SET status = 'rejected', status_reason = 'explicitly_rejected'
      WHERE operation_id = $1
    `, [pending.operation_id]))).rejects.toMatchObject({ code: '23514' });

    await store.confirmOperation(principalA, pending.operation_id, patchHash, 'user_confirmation');
    await store.claimReady(principalA, 'raw-worker', 30_000);
    await expect(asPrincipal(adminPool, principalA, (client) => client.query(`
      UPDATE product_context_stage1.knowledge_write_operations
      SET status = 'failed', status_reason = 'invalid_payload',
          lease_owner = NULL, lease_expires_at = NULL
      WHERE operation_id = $1
    `, [pending.operation_id]))).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps known identifiers isolated by FORCE RLS and clears principal state on connection reuse', async () => {
    await createSpace(store, principalA);
    const pending = await createPending(store, principalA, 'op_rls', 'idem_rls_00000001');
    await store.confirmOperation(principalA, pending.operation_id, patchHash, 'user_confirmation');
    expect(await store.getSpace(principalB, 'space_alice')).toBeNull();
    expect(await store.getOperation(principalB, pending.operation_id)).toBeNull();
    expect(await store.claimReady(principalB, 'intruder', 30_000)).toBeNull();
    const foreignUpdate = await asPrincipal(adminPool, principalB, (client) => client.query(`
      UPDATE product_context_stage1.knowledge_write_operations
      SET status = 'rejected', status_reason = 'explicitly_rejected'
      WHERE operation_id = $1
    `, [pending.operation_id]));
    expect(foreignUpdate.rowCount).toBe(0);

    const client = await adminPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE product_context_stage1_app');
      await client.query("SELECT set_config('cubica.principal_ref', $1, true)", [principalA]);
      expect((await client.query(`SELECT operation_id FROM product_context_stage1.knowledge_write_operations WHERE operation_id = $1`, [pending.operation_id])).rowCount).toBe(1);
      await client.query('COMMIT');

      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE product_context_stage1_app');
      expect((await client.query("SELECT current_setting('cubica.principal_ref', true) AS principal")).rows[0].principal).toBe('');
      expect((await client.query(`SELECT operation_id FROM product_context_stage1.knowledge_write_operations WHERE operation_id = $1`, [pending.operation_id])).rowCount).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('uses a non-owning, non-BYPASSRLS app role and forces RLS on both tables', async () => {
    const role = await adminPool.query(`
      SELECT rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolbypassrls, rolinherit
      FROM pg_roles WHERE rolname = 'product_context_stage1_app'
    `);
    expect(role.rows[0]).toEqual({
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolcanlogin: false,
      rolbypassrls: false,
      rolinherit: false
    });

    const tables = await adminPool.query(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, owner.rolname AS owner
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      JOIN pg_roles AS owner ON owner.oid = c.relowner
      WHERE n.nspname = 'product_context_stage1'
        AND c.relname IN ('knowledge_spaces', 'knowledge_write_operations')
      ORDER BY c.relname
    `);
    expect(tables.rows).toHaveLength(2);
    for (const table of tables.rows) {
      expect(table).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
      expect(table.owner).not.toBe('product_context_stage1_app');
    }

    const grants = await adminPool.query(`
      SELECT table_schema, table_name, privilege_type
      FROM information_schema.role_table_grants
      WHERE grantee = 'product_context_stage1_app'
      ORDER BY table_schema, table_name, privilege_type
    `);
    expect(grants.rows).toEqual([
      { table_schema: 'product_context_stage1', table_name: 'knowledge_spaces', privilege_type: 'INSERT' },
      { table_schema: 'product_context_stage1', table_name: 'knowledge_spaces', privilege_type: 'SELECT' },
      { table_schema: 'product_context_stage1', table_name: 'knowledge_write_operations', privilege_type: 'DELETE' },
      { table_schema: 'product_context_stage1', table_name: 'knowledge_write_operations', privilege_type: 'INSERT' },
      { table_schema: 'product_context_stage1', table_name: 'knowledge_write_operations', privilege_type: 'SELECT' },
      { table_schema: 'product_context_stage1', table_name: 'knowledge_write_operations', privilege_type: 'UPDATE' }
    ]);
  });

  it('rejects a direct insert whose creator differs from the personal-space owner', async () => {
    await createSpace(store, principalA);
    const pending = await createPending(store, principalA, 'op_creator_source', 'idem_creator_source');
    await expect(asPrincipal(adminPool, principalA, (client) => client.query(`
      INSERT INTO product_context_stage1.knowledge_write_operations (
        operation_id, space_id, owner_ref, creator_ref, idempotency_key,
        proposal_id, patch_hash, status, status_reason, decision_envelope_id,
        decision_envelope, patch_payload, source_refs, attempt_count
      )
      SELECT
        'op_wrong_creator', space_id, owner_ref, $2, 'idem_wrong_creator',
        proposal_id, patch_hash, status, status_reason, decision_envelope_id,
        decision_envelope, patch_payload, source_refs, attempt_count
      FROM product_context_stage1.knowledge_write_operations
      WHERE operation_id = $1
    `, [pending.operation_id, principalB]))).rejects.toMatchObject({ code: '23514' });
  });
});

async function createSpace(store: ProductContextPostgresStore, principal: string): Promise<void> {
  await store.createSpace(principal, {
    spaceId: `space_${principal.endsWith('alice') ? 'alice' : 'bob'}`,
    subjectRef: 'cubica://scope/all-user-games',
    trustZoneRef: 'stage1-isolated',
    accessPolicyRef: 'access-v1',
    retentionPolicyRef: 'retention-v1',
    repositoryRef: 'isolated-git://personal'
  });
}

async function createPending(
  store: ProductContextPostgresStore,
  principal: string,
  operationId: string,
  idempotencyKey: string
) {
  const spaceId = `space_${principal.endsWith('alice') ? 'alice' : 'bob'}`;
  return store.createOperation(principal, {
    operationId,
    spaceId,
    idempotencyKey,
    proposal: proposal(operationId),
    envelope: envelope(operationId, spaceId, principal)
  });
}

async function readyAndClaim(
  store: ProductContextPostgresStore,
  principal: string,
  operationId: string,
  idempotencyKey: string,
  worker: string
) {
  const pending = await createPending(store, principal, operationId, idempotencyKey);
  await store.confirmOperation(principal, pending.operation_id, patchHash, 'user_confirmation');
  return (await store.claimReady(principal, worker, 30_000))!;
}

function proposal(operationId: string): ExactPatchProposal {
  return {
    schema_version: '1.0.0',
    proposal_id: `prop_${operationId.slice(3)}`,
    base_commit: 'd'.repeat(40),
    patch_hash: patchHash,
    operations: [{
      kind: 'replace_exact',
      path: `notes/${operationId}.md`,
      base_file_hash: `sha256:${'e'.repeat(64)}`,
      old_text: 'old',
      old_text_hash: `sha256:${'f'.repeat(64)}`,
      new_text: 'new',
      expected_matches: 1,
      reason: 'Confirmed correction',
      source_refs: [{ ref: 'cubica://dialog/demo/message/user-1', use: 'evidence' }]
    }],
    source_refs: [{ ref: 'cubica://dialog/demo/message/user-1', use: 'evidence' }],
    applies_to: ['cubica://game-project/demo'] as never
  };
}

function envelope(operationId: string, spaceId: string, principal: string): DecisionEnvelope {
  return {
    schema_version: '1.0.0',
    envelope_id: `env_${operationId.slice(3)}`,
    space_id: spaceId,
    principal_ref: principal,
    role_scope: 'developer',
    target_ref: `cubica://knowledge/${operationId}`,
    applies_to: ['cubica://game-project/demo'] as never,
    read_set: [{
      ref: 'cubica://dialog/demo/message/user-1',
      kind: 'message',
      purpose: 'decision_basis',
      revision: '1',
      content_hash: `sha256:${'1'.repeat(64)}`
    }],
    policy_decisions: {
      access: { decision: 'allow', version: 'access-v1' },
      retention: { decision: 'allow', version: 'retention-v1' },
      external_processing: { decision: 'deny', version: 'external-v1' }
    },
    impact_hash: impactHash,
    created_at: '2026-08-09T10:00:00.000Z'
  };
}

async function asPrincipal<T>(pool: Pool, principal: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE product_context_stage1_app');
    await client.query("SELECT set_config('cubica.principal_ref', $1, true)", [principal]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
