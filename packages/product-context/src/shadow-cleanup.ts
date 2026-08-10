/**
 * Configuration and one bounded invocation of Stage 2 retention cleanup.
 *
 * Scheduling stays an operator concern. Each invocation is explicit,
 * non-production, content-free in its result, and delegates deletion only to
 * the fixed SECURITY DEFINER function already installed by migration 002.
 */
import type { Pool } from 'pg';

import { PostgresConversationStore, type ShadowCleanupResult } from './conversation-postgres.ts';
import { safeShadowDatabaseUrl } from './shadow-database-url.ts';

const allowedEnvironments = new Set(['test', 'staging']);

export interface ShadowCleanupConfig {
  readonly databaseUrl: string;
  readonly batchLimit: number;
}

export function readShadowCleanupConfig(env: NodeJS.ProcessEnv): ShadowCleanupConfig | null {
  if (env.CUBICA_PRODUCT_CONTEXT_SHADOW_CLEANUP_ENABLED !== 'true' ||
      !allowedEnvironments.has(env.CUBICA_DEPLOYMENT_TIER ?? '')) return null;
  const databaseUrl = safeShadowDatabaseUrl(env.CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL);
  const configuredLimit = env.CUBICA_PRODUCT_CONTEXT_SHADOW_CLEANUP_BATCH_LIMIT;
  const batchLimit = configuredLimit === undefined ? 100 : boundedInteger(configuredLimit, 1, 1_000);
  if (batchLimit === null) return null;
  return databaseUrl ? { databaseUrl, batchLimit } : null;
}

export async function runShadowCleanup(
  pool: Pick<Pool, 'connect'>,
  config: Pick<ShadowCleanupConfig, 'batchLimit'>
): Promise<ShadowCleanupResult> {
  if (!Number.isSafeInteger(config.batchLimit) || config.batchLimit < 1 || config.batchLimit > 1_000) {
    throw new TypeError('Shadow cleanup batch limit must be between 1 and 1000.');
  }
  return new PostgresConversationStore(pool).cleanupExpired(config.batchLimit);
}

function boundedInteger(value: string | undefined, min: number, max: number): number | null {
  if (value === undefined || !/^[0-9]+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}
