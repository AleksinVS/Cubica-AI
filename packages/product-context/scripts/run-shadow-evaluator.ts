#!/usr/bin/env node
/** Import-safe CLI for the persistent evaluator; errors are deliberately generic. */
import { open as openFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Pool, type PoolClient } from 'pg';
import { runShadowWorkerOnce, runShadowWorkerRecoveryOnce, readShadowWorkerConfig, readShadowWorkerRecoveryConfig } from './run-shadow-worker.ts';
import { safeShadowDatabaseUrl } from '../src/shadow-database-url.ts';
import {
  cleanupShadowEvaluation, preflightShadowEvaluation, readShadowEvaluationManifest,
  reviewShadowEvaluation, runNextShadowEvaluation, shadowEvaluationValidationStage,
  type EvaluationDbSnapshot, type EvaluationCleanupResult, type ShadowEvaluatorDatabase,
  type ShadowEvaluatorDeps, type ShadowEvaluatorReviewer
} from '../src/shadow-evaluator.ts';

const integer = (value: string | undefined, min: number, max: number): number | null => {
  if (!value || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
};

/** Existing app-role API; this adapter intentionally exposes no enqueue/write path. */
export class PostgresShadowEvaluatorDatabase implements ShadowEvaluatorDatabase {
  constructor(
    private readonly pool: Pick<Pool, 'connect'>,
    private readonly principal: string,
    private readonly game: string
  ) {}
  async inspect(): Promise<EvaluationDbSnapshot> {
    return this.scoped(async (client) => {
      const runs = await client.query(`
        SELECT run.owner_ref, thread.game_ref, run.authorization_receipt->>'shadow_principal_ref' AS receipt_principal,
          run.authorization_receipt->'applies_to'->>0 AS receipt_game,
          run.stable_turn_key, run.status, run.outcome_code, run.last_error_code,
          (SELECT count(*) FROM product_context_shadow.conversation_messages m WHERE m.thread_ref = run.thread_ref AND m.stable_turn_key = run.stable_turn_key) AS message_count,
          (SELECT count(*) FROM product_context_shadow.conversation_messages m WHERE m.thread_ref = run.thread_ref AND m.stable_turn_key = run.stable_turn_key AND NOT m.tombstone AND m.content_bytes IS NOT NULL) AS live_message_count,
          COALESCE(metric.proposal_operation_count, 0) AS operation_count,
          COALESCE(metric.duration_ms, 0) AS duration_ms,
          COALESCE(metric.input_bytes, 0) AS input_bytes,
          COALESCE(metric.output_bytes, 0) AS output_bytes,
          COALESCE(metric.metric_count, 0) AS metric_count,
          CASE
            WHEN run.status = 'calling_model' AND run.lease_expires_at <= clock_timestamp()
              THEN 'expired_calling_model'
            WHEN run.status IN ('pending', 'retry_wait', 'leased') AND run.retained_until <= clock_timestamp()
              THEN 'retention_expired'
            WHEN run.status = 'leased' AND run.attempts >= 1 AND run.lease_expires_at <= clock_timestamp()
              THEN 'attempts_exhausted'
            ELSE NULL
          END AS cleanup_recovery
        FROM product_context_shadow.shadow_runs AS run
        JOIN product_context_shadow.conversation_threads AS thread ON thread.thread_ref = run.thread_ref AND thread.owner_ref = run.owner_ref
        LEFT JOIN LATERAL (
          SELECT max(proposal_operation_count) AS proposal_operation_count,
            max(duration_ms) AS duration_ms, max(input_bytes) AS input_bytes,
            max(output_bytes) AS output_bytes, count(*) AS metric_count
          FROM product_context_shadow.shadow_metrics WHERE run_id = run.run_id
        ) AS metric ON true
        ORDER BY run.created_at, run.stable_turn_key`);
      const counts = await client.query(`
        SELECT (SELECT count(*) FROM product_context_shadow.shadow_runs) AS active_runs,
          (SELECT count(*) FROM product_context_shadow.shadow_metrics) AS active_metrics,
          (SELECT count(*) FROM product_context_shadow.conversation_messages WHERE NOT tombstone AND content_bytes IS NOT NULL) AS active_messages,
          (SELECT count(*) FROM product_context_shadow.conversation_threads WHERE status = 'active') AS active_threads,
          (SELECT COALESCE(sum(octet_length(content_bytes)), 0) FROM product_context_shadow.conversation_messages WHERE content_bytes IS NOT NULL) AS active_text_bytes`);
      return {
        runs: runs.rows.map((row) => ({ ownerRef: String(row.owner_ref), gameRef: String(row.game_ref), receiptPrincipal: String(row.receipt_principal), receiptGame: String(row.receipt_game), messageCount: Number(row.message_count), liveMessageCount: Number(row.live_message_count), stableTurnKey: String(row.stable_turn_key), status: row.status, outcome: row.outcome_code, operationCount: Number(row.operation_count), durationMs: Number(row.duration_ms), inputBytes: Number(row.input_bytes), outputBytes: Number(row.output_bytes), metricCount: Number(row.metric_count), lastErrorCode: row.last_error_code === null ? null : String(row.last_error_code), cleanupRecovery: cleanupRecovery(row.cleanup_recovery) })),
        activeRuns: Number(counts.rows[0]?.active_runs ?? 0), activeMetrics: Number(counts.rows[0]?.active_metrics ?? 0), activeMessages: Number(counts.rows[0]?.active_messages ?? 0), activeThreads: Number(counts.rows[0]?.active_threads ?? 0), activeTextBytes: Number(counts.rows[0]?.active_text_bytes ?? 0)
      };
    });
  }
  async cleanup(limit: number): Promise<EvaluationCleanupResult> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid cleanup limit.');
    return this.scoped(async (client) => {
      const before = await client.query('SELECT count(*) AS count FROM product_context_shadow.shadow_metrics');
      const result = await client.query('SELECT * FROM product_context_shadow.cleanup_expired($1)', [limit]);
      const after = await client.query('SELECT count(*) AS count FROM product_context_shadow.shadow_metrics');
      const row = result.rows[0] ?? {};
      return { runsDeleted: Number(row.runs_deleted ?? 0), metricsDeleted: Math.max(0, Number(before.rows[0]?.count ?? 0) - Number(after.rows[0]?.count ?? 0)), messagesTombstoned: Number(row.messages_tombstoned ?? 0), threadsTombstoned: Number(row.threads_tombstoned ?? 0) };
    });
  }
  async reviewMaterial(stableTurnKey: string) {
    return this.scoped(async (client) => {
      const messages = await client.query(`SELECT m.actor, m.content_bytes, m.tombstone
        FROM product_context_shadow.conversation_messages AS m
        JOIN product_context_shadow.shadow_runs AS r
          ON r.thread_ref = m.thread_ref AND r.stable_turn_key = m.stable_turn_key
        JOIN product_context_shadow.conversation_threads AS t
          ON t.thread_ref = r.thread_ref AND t.owner_ref = r.owner_ref
        WHERE m.stable_turn_key = $1 AND r.owner_ref = $2 AND t.game_ref = $3
          AND r.status = 'succeeded'
          AND r.authorization_receipt->>'shadow_principal_ref' = $2
          AND r.authorization_receipt->'applies_to'->>0 = $3
        ORDER BY m.sequence`, [stableTurnKey, this.principal, this.game]);
      const result = await client.query(`SELECT result_payload
        FROM product_context_shadow.shadow_runs
        WHERE stable_turn_key = $1 AND owner_ref = $2 AND status = 'succeeded'
          AND authorization_receipt->>'shadow_principal_ref' = $2
          AND authorization_receipt->'applies_to'->>0 = $3`, [stableTurnKey, this.principal, this.game]);
      const user = messages.rows.find((row) => row.actor === 'user'); const agent = messages.rows.find((row) => row.actor === 'agent');
      if (messages.rows.length !== 2 || !user || !agent || user.tombstone || agent.tombstone ||
          !Buffer.isBuffer(user.content_bytes) || !Buffer.isBuffer(agent.content_bytes) ||
          result.rows.length !== 1 || result.rows[0].result_payload === null) throw new Error('Review material unavailable.');
      return { userMessage: user.content_bytes.toString('utf8'), agentMessage: agent.content_bytes.toString('utf8'), result: result.rows[0].result_payload };
    });
  }
  private async scoped<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect(); let begun = false;
    try { await client.query('BEGIN'); begun = true; await verifyAppLogin(client); await client.query('SET LOCAL ROLE product_context_shadow_app'); await client.query("SELECT set_config('cubica.shadow_principal_ref', $1, true)", [this.principal]); const value = await work(client); await client.query('COMMIT'); return value; }
    catch (error) { if (begun) await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
  }
}

function cleanupRecovery(value: unknown): 'retention_expired' | 'expired_calling_model' | 'attempts_exhausted' | null {
  return value === 'retention_expired' || value === 'expired_calling_model' || value === 'attempts_exhausted' ? value : null;
}

async function verifyAppLogin(client: PoolClient): Promise<void> {
  const result = await client.query(`SELECT r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls AND NOT r.rolinherit
      AND (SELECT count(*) = 1 AND bool_and(granted.rolname = 'product_context_shadow_app')
        FROM pg_auth_members m JOIN pg_roles granted ON granted.oid = m.roleid
        WHERE m.member = r.oid) AS ready
    FROM pg_roles r WHERE r.rolname = session_user`);
  if (result.rows[0]?.ready !== true) throw new Error('Dedicated shadow app login is required.');
}

export interface ShadowEvaluatorCliConfig { readonly appDatabaseUrl: string; readonly workerDatabaseUrl: string; readonly cleanupLimit: number; readonly cleanupMaxPasses: number; }
export function readShadowEvaluatorCliConfig(env: NodeJS.ProcessEnv = process.env, mode = 'preflight'): ShadowEvaluatorCliConfig | null {
  const appDatabaseUrl = safeShadowDatabaseUrl(env.CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL);
  const workerDatabaseUrl = safeShadowDatabaseUrl(env.CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_DATABASE_URL);
  const cleanupLimit = integer(env.CUBICA_PRODUCT_CONTEXT_SHADOW_CLEANUP_BATCH_LIMIT, 1, 1000);
  const cleanupMaxPasses = integer(env.CUBICA_PRODUCT_CONTEXT_SHADOW_EVALUATOR_CLEANUP_MAX_PASSES, 1, 1000);
  const worker = mode === 'cleanup' ? readShadowWorkerRecoveryConfig(env) : readShadowWorkerConfig(env);
  if (env.CUBICA_PRODUCT_CONTEXT_SHADOW_EVALUATOR_ENABLED !== 'true' || !['test', 'staging'].includes(env.CUBICA_DEPLOYMENT_TIER ?? '') || !appDatabaseUrl || !workerDatabaseUrl || appDatabaseUrl === workerDatabaseUrl || !worker || worker.maxAttempts !== 1 || (mode === 'cleanup' && (cleanupLimit === null || cleanupMaxPasses === null))) return null;
  return { appDatabaseUrl, workerDatabaseUrl, cleanupLimit: cleanupLimit ?? 0, cleanupMaxPasses: cleanupMaxPasses ?? 0 };
}

class TtyReviewer implements ShadowEvaluatorReviewer {
  async review(index: number, expected: 'no_change' | 'proposal', material?: { readonly userMessage: string; readonly agentMessage: string; readonly result: unknown }): Promise<readonly [boolean, boolean, boolean, boolean]> {
    const tty = await openFile('/dev/tty', 'r+');
    try {
      await tty.write(`Scenario ${index + 1}; expected ${expected}.\nUser: ${material?.userMessage ?? ''}\nAgent: ${material?.agentMessage ?? ''}\nResult: ${material ? JSON.stringify(material.result) : ''}\nEnter four yes/no answers separated by spaces: `);
      const buffer = Buffer.alloc(256); const { bytesRead } = await tty.read(buffer, 0, buffer.byteLength, null);
      const values = buffer.subarray(0, bytesRead).toString('utf8').trim().split(/\s+/u).map((value) => value.toLowerCase() === 'yes');
      if (values.length !== 4 || buffer.subarray(0, bytesRead).toString('utf8').trim().split(/\s+/u).some((value) => !['yes', 'no'].includes(value.toLowerCase()))) throw new Error('Invalid review.');
      return values as [boolean, boolean, boolean, boolean];
    } finally { await tty.close(); }
  }
}

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let pool: Pool | undefined;
  try {
    const mode = process.argv[2];
    if (!['preflight', 'run-next', 'review', 'cleanup'].includes(mode ?? '')) return 2;
    const manifestPath = env.CUBICA_PRODUCT_CONTEXT_SHADOW_EVALUATION_MANIFEST;
    const reportPath = env.CUBICA_PRODUCT_CONTEXT_SHADOW_EVALUATION_REPORT;
    const worktreePath = env.CUBICA_PRODUCT_CONTEXT_SHADOW_EVALUATION_WORKTREE;
    const config = readShadowEvaluatorCliConfig(env, mode);
    if (!manifestPath || !reportPath || !worktreePath || !config) return 2;
    const manifest = await readShadowEvaluationManifest({ manifestPath, reportPath, worktreePath });
    pool = new Pool({ connectionString: config.appDatabaseUrl, max: 2, connectionTimeoutMillis: 2000, idleTimeoutMillis: 10000, allowExitOnIdle: true });
    const database = new PostgresShadowEvaluatorDatabase(pool, manifest.shadow_principal_ref, manifest.applies_to[0]!);
    const deps: ShadowEvaluatorDeps = {
      db: database,
      worker: async (target) => runShadowWorkerOnce(env, target),
      recoveryWorker: async (target) => runShadowWorkerRecoveryOnce(env, target),
      readGitHead: async () => { const { ReadOnlyKnowledgeGit } = await import('../src/git.ts'); const git = await ReadOnlyKnowledgeGit.open(env.CUBICA_PRODUCT_CONTEXT_SHADOW_KNOWLEDGE_REPOSITORY!); try { return git.head(); } finally { await git.close(); } },
      workerConfig: { evaluationEnabled: true, deploymentTier: env.CUBICA_DEPLOYMENT_TIER ?? '', maxAttempts: 1 },
      paths: { manifestPath, reportPath, worktreePath }, reviewer: mode === 'review' ? new TtyReviewer() : undefined,
      cleanupLimit: config.cleanupLimit, cleanupMaxPasses: config.cleanupMaxPasses
    };
    const report = mode === 'preflight' ? await preflightShadowEvaluation(deps) : mode === 'run-next' ? await runNextShadowEvaluation(deps) : mode === 'review' ? await reviewShadowEvaluation(deps) : await cleanupShadowEvaluation(deps);
    if (mode === 'run-next' && report.status === 'hard_stopped') {
      // Diagnostics cannot turn an already persisted fail-closed report into a CLI failure.
      const stage = await database.inspect().then(shadowEvaluationValidationStage).catch(() => null);
      if (stage !== null) process.stderr.write(`Shadow evaluator validation stage: ${stage}.\n`);
    }
    process.stdout.write(`${JSON.stringify(report)}\n`); return 0;
  } catch { process.stderr.write('Shadow evaluator refused or failed.\n'); return 1; }
  finally { await pool?.end().catch(() => undefined); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
