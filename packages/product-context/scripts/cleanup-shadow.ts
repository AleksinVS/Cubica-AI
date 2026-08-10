#!/usr/bin/env node
/** One content-free Stage 2 retention-cleanup invocation for cron or a job runner. */
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';

import { readShadowCleanupConfig, runShadowCleanup } from '../src/shadow-cleanup.ts';

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const config = readShadowCleanupConfig(env);
  if (!config) {
    console.error('Shadow cleanup refused: explicit non-production configuration is required.');
    return 2;
  }
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 1,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 2_000,
    allowExitOnIdle: true
  });
  try {
    const result = await runShadowCleanup(pool, config);
    console.log(JSON.stringify({
      runs_deleted: result.runsDeleted,
      messages_tombstoned: result.messagesTombstoned,
      threads_tombstoned: result.threadsTombstoned
    }));
    return 0;
  } catch {
    console.error('Shadow cleanup failed.');
    return 1;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
