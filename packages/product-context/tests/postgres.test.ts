/** Unit-level checks for PostgreSQL adapter guards that do not require a database. */
import { describe, expect, it } from 'vitest';
import { OperationUnavailableError, ProductContextPostgresStore } from '../src/postgres.ts';

describe('ProductContextPostgresStore input guards', () => {
  it('rejects invalid lease parameters before acquiring a connection', async () => {
    const pool = { connect: () => { throw new Error('must not connect'); } };
    const store = new ProductContextPostgresStore(pool as never);
    await expect(store.claimReady('cubica://user/alice', '', 1000)).rejects.toThrow(TypeError);
    await expect(store.claimReady('cubica://user/alice', 'worker', 0)).rejects.toThrow(TypeError);
  });

  it('rejects malformed commit receipts before acquiring a connection', async () => {
    const pool = { connect: () => { throw new Error('must not connect'); } };
    const store = new ProductContextPostgresStore(pool as never);
    await expect(store.markApplied('cubica://user/alice', 'op_demo', 'worker', 1, 'not-a-sha')).rejects.toThrow(TypeError);
    await expect(store.reconcileAppliedReceipt('cubica://user/alice', 'op_demo', 'not-a-sha')).rejects.toThrow(TypeError);
  });

  it('fences every worker-owned transition by the exact claim attempt', async () => {
    const updates: Array<{ sql: string; parameters: readonly unknown[] }> = [];
    const client = {
      query: async (sql: string, parameters: readonly unknown[] = []) => {
        if (sql.includes('UPDATE product_context_stage1.knowledge_write_operations')) {
          updates.push({ sql: sql.replace(/\s+/g, ' ').trim(), parameters });
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined
    };
    const store = new ProductContextPostgresStore({ connect: async () => client } as never);
    const principal = 'cubica://user/alice';
    const operationId = 'op_fenced';
    const owner = 'reused-worker';
    const attempt = 7;

    await expect(store.markApplied(principal, operationId, owner, attempt, 'a'.repeat(40)))
      .rejects.toBeInstanceOf(OperationUnavailableError);
    await expect(store.markConflict(principal, operationId, owner, attempt, 'authorization_changed'))
      .rejects.toBeInstanceOf(OperationUnavailableError);
    await expect(store.markFailed(principal, operationId, owner, attempt, 'invalid_payload'))
      .rejects.toBeInstanceOf(OperationUnavailableError);
    await expect(store.releaseTemporary(principal, operationId, owner, attempt, new Date(0)))
      .rejects.toBeInstanceOf(OperationUnavailableError);
    await expect(store.expireOperation(principal, operationId, new Date(0), owner, attempt))
      .rejects.toBeInstanceOf(OperationUnavailableError);

    expect(updates).toHaveLength(5);
    for (const update of updates.slice(0, 4)) {
      expect(update.sql).toContain("WHERE operation_id = $1 AND status = 'applying' AND lease_owner = $2 AND attempt_count = $3");
      expect(update.parameters.slice(0, 3)).toEqual([operationId, owner, attempt]);
    }
    expect(updates[4]!.sql).toContain("(status = 'pending_confirmation' AND $3 IS NULL AND $4 IS NULL) OR (status = 'applying' AND lease_owner = $3 AND attempt_count = $4)");
    expect(updates[4]!.parameters.slice(2)).toEqual([owner, attempt]);
  });

  it('exposes no retryable error-code parameter beyond storage_unavailable', () => {
    const pool = { connect: () => { throw new Error('must not connect'); } };
    const store = new ProductContextPostgresStore(pool as never);
    if (false) {
      // @ts-expect-error Authorization drift is terminal conflict, never retryable ready work.
      void store.releaseTemporary('cubica://user/alice', 'op_demo', 'worker', 1, new Date(), 'authorization_changed');
    }
    expect(store.releaseTemporary.length).toBe(5);
  });

  it('does not issue ROLLBACK when BEGIN itself failed', async () => {
    const beginError = new Error('begin failed');
    let rollbackCalls = 0;
    const client = {
      query: async (sql: string) => {
        if (sql === 'BEGIN') throw beginError;
        if (sql === 'ROLLBACK') rollbackCalls += 1;
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined
    };
    const pool = { connect: async () => client };
    const store = new ProductContextPostgresStore(pool as never);

    await expect(store.getOperation('cubica://user/alice', 'op_demo')).rejects.toBe(beginError);
    expect(rollbackCalls).toBe(0);
  });

  it('discards a pooled connection when rollback cannot restore a known state', async () => {
    const workError = new Error('work failed');
    let releaseArgument: boolean | Error | undefined;
    const client = {
      query: async (sql: string) => {
        if (sql === 'BEGIN' || sql.startsWith('SET LOCAL') || sql.startsWith('SELECT set_config')) return { rows: [], rowCount: 0 };
        if (sql === 'ROLLBACK') throw new Error('connection failed during rollback');
        throw workError;
      },
      release: (argument?: boolean | Error) => { releaseArgument = argument; }
    };
    const store = new ProductContextPostgresStore({ connect: async () => client } as never);

    await expect(store.getOperation('cubica://user/alice', 'op_demo')).rejects.toBe(workError);
    expect(releaseArgument).toBe(true);
  });
});
