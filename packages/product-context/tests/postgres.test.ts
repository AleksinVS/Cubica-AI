/** Unit-level checks for PostgreSQL adapter guards that do not require a database. */
import { describe, expect, it } from 'vitest';
import { ProductContextPostgresStore } from '../src/postgres.ts';

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
    await expect(store.markApplied('cubica://user/alice', 'op_demo', 'worker', 'not-a-sha')).rejects.toThrow(TypeError);
    await expect(store.reconcileAppliedReceipt('cubica://user/alice', 'op_demo', 'not-a-sha')).rejects.toThrow(TypeError);
  });

  it('exposes no retryable error-code parameter beyond storage_unavailable', () => {
    const pool = { connect: () => { throw new Error('must not connect'); } };
    const store = new ProductContextPostgresStore(pool as never);
    if (false) {
      // @ts-expect-error Authorization drift is terminal conflict, never retryable ready work.
      void store.releaseTemporary('cubica://user/alice', 'op_demo', 'worker', new Date(), 'authorization_changed');
    }
    expect(store.releaseTemporary.length).toBe(4);
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
