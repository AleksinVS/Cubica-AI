import { describe, expect, it, vi } from 'vitest';

import { readShadowCleanupConfig, runShadowCleanup } from '../src/shadow-cleanup.ts';

describe('bounded Stage 2 cleanup job', () => {
  it('requires an explicit non-production enable and a safe database URL', () => {
    const enabled = {
      CUBICA_PRODUCT_CONTEXT_SHADOW_CLEANUP_ENABLED: 'true',
      CUBICA_DEPLOYMENT_TIER: 'staging',
      CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL: 'postgresql://db.internal/shadow?sslmode=verify-full'
    };
    expect(readShadowCleanupConfig(enabled)).toEqual({
      databaseUrl: 'postgresql://db.internal/shadow?sslmode=verify-full',
      batchLimit: 100
    });
    expect(readShadowCleanupConfig({ ...enabled, CUBICA_DEPLOYMENT_TIER: 'production' })).toBeNull();
    expect(readShadowCleanupConfig({ ...enabled, CUBICA_PRODUCT_CONTEXT_SHADOW_CLEANUP_ENABLED: 'false' })).toBeNull();
    expect(readShadowCleanupConfig({ ...enabled, CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL: 'postgresql://db.internal/shadow?sslmode=verify-full&host=attacker.example' })).toBeNull();
    expect(readShadowCleanupConfig({ ...enabled, CUBICA_PRODUCT_CONTEXT_SHADOW_CLEANUP_BATCH_LIMIT: '0' })).toBeNull();
  });

  it('executes exactly one fixed cleanup transaction and returns content-free counts', async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const release = vi.fn();
    const client = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        if (text.includes('SELECT session_user = current_user')) return { rows: [{ ready: true }] };
        return text.startsWith('SELECT * FROM product_context_shadow.cleanup_expired')
          ? { rows: [{ runs_deleted: 3, messages_tombstoned: 4, threads_tombstoned: 2 }] }
          : { rows: [] };
      }),
      release
    };
    const pool = { connect: vi.fn(async () => client) };

    await expect(runShadowCleanup(pool as never, { batchLimit: 25 })).resolves.toEqual({
      runsDeleted: 3,
      messagesTombstoned: 4,
      threadsTombstoned: 2
    });
    expect(queries).toEqual([
      { text: 'BEGIN', values: undefined },
      { text: expect.stringContaining('SELECT session_user = current_user'), values: undefined },
      { text: 'SET LOCAL ROLE product_context_shadow_app', values: undefined },
      { text: 'SELECT * FROM product_context_shadow.cleanup_expired($1)', values: [25] },
      { text: 'COMMIT', values: undefined }
    ]);
    expect(release).toHaveBeenCalledWith(false);
  });

  it.each([
    ['cleanup query', 'SELECT * FROM product_context_shadow.cleanup_expired', false, false],
    ['commit', 'COMMIT', false, false],
    ['rollback', 'SELECT * FROM product_context_shadow.cleanup_expired', true, true]
  ] as const)('rolls back and marks only a broken rollback client for discard after %s failure', async (_label, failingPrefix, rollbackFails, discard) => {
    const queries: string[] = [];
    const release = vi.fn();
    const client = {
      query: vi.fn(async (text: string) => {
        queries.push(text);
        if (text === 'ROLLBACK' && rollbackFails) throw new Error('rollback failed');
        if (text.includes('SELECT session_user = current_user')) return { rows: [{ ready: true }] };
        if (text.startsWith(failingPrefix)) throw new Error('cleanup failed');
        if (text.startsWith('SELECT * FROM product_context_shadow.cleanup_expired')) {
          return { rows: [{ runs_deleted: 0, messages_tombstoned: 0, threads_tombstoned: 0 }] };
        }
        return { rows: [] };
      }),
      release
    };
    const pool = { connect: vi.fn(async () => client) };

    await expect(runShadowCleanup(pool as never, { batchLimit: 25 })).rejects.toThrow('cleanup failed');
    expect(queries.at(-1)).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledWith(discard);
  });
});
