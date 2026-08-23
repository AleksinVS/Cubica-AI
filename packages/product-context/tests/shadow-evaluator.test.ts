import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { validateProductKnowledgeContract, validateShadowEvaluationManifest, validateShadowEvaluationReport } from '../src/contracts.ts';
import { cleanupShadowEvaluation, emptyShadowEvaluationReport, preflightShadowEvaluation, reviewShadowEvaluation, runNextShadowEvaluation, writeShadowEvaluationReport, type EvaluationDbSnapshot, type ShadowEvaluatorDatabase, type ShadowEvaluatorDeps } from '../src/shadow-evaluator.ts';
import type { ShadowEvaluationManifest, ShadowEvaluationReport } from '../src/generated/product-knowledge.ts';
import { readShadowEvaluatorCliConfig } from '../scripts/run-shadow-evaluator.ts';

const head = 'a'.repeat(40);
const categories = ['transient_conversation', 'existing_fact', 'unconfirmed_agent_suggestion', 'confirmed_new_knowledge', 'correction'] as const;
function manifest(): ShadowEvaluationManifest { return { schema_version: '1.0.0', shadow_principal_ref: 'cubica://shadow-principal/v1/evaluator', applies_to: ['cubica://game-project/evaluator'], expected_git_head: head, scenarios: categories.map((category, index) => ({ category, stable_turn_key: `shadow-turn-v1:${category}-${String(index).padStart(16, '0')}` })) }; }
const manifestBytes = JSON.stringify(manifest());
const manifestDigest = `sha256:${createHash('sha256').update(manifestBytes).digest('hex')}`;
function snapshot(runs: EvaluationDbSnapshot['runs'] = []): EvaluationDbSnapshot { return { runs, activeRuns: runs.length, activeMetrics: runs.reduce((sum, run) => sum + run.metricCount, 0), activeMessages: runs.length * 2, activeThreads: runs.length, activeTextBytes: runs.length * 10 }; }
async function fixture(): Promise<{ dir: string; paths: ShadowEvaluatorDeps['paths']; deps: ShadowEvaluatorDeps; db: MemoryDb }> {
  const hostRoot = resolve(process.cwd(), '../..');
  const root = await mkdtemp(join(hostRoot, '.tmp/shadow-evaluator-worktree-'));
  await chmod(root, 0o700);
  await mkdir(join(root, '.tmp'), { mode: 0o700 });
  const dir = await mkdtemp(join(root, '.tmp/shadow-evaluator-test-')); await chmod(dir, 0o700);
  const paths = { manifestPath: join(dir, 'manifest.json'), reportPath: join(dir, 'report.json'), worktreePath: root };
  await writeFile(paths.manifestPath, manifestBytes, { mode: 0o600 }); await chmod(paths.manifestPath, 0o600);
  const db = new MemoryDb(); const deps: ShadowEvaluatorDeps = { db, worker: async (target) => { db.lastTarget = target; db.worker(); }, recoveryWorker: async (target) => { db.lastTarget = target; db.worker(); return 'terminalized'; }, readGitHead: async () => head, workerConfig: { evaluationEnabled: true, deploymentTier: 'test', maxAttempts: 1 }, paths, cleanupLimit: 1, cleanupMaxPasses: 20 }; return { dir: root, paths, deps, db };
}
class MemoryDb implements ShadowEvaluatorDatabase {
  value = snapshot([{ ownerRef: 'cubica://shadow-principal/v1/evaluator', gameRef: 'cubica://game-project/evaluator', receiptPrincipal: 'cubica://shadow-principal/v1/evaluator', receiptGame: 'cubica://game-project/evaluator', messageCount: 2, liveMessageCount: 2, stableTurnKey: categories[0] ? `shadow-turn-v1:${categories[0]}-${String(0).padStart(16, '0')}` : '', status: 'pending', outcome: null, operationCount: 0, durationMs: 0, inputBytes: 0, outputBytes: 0, metricCount: 0 }]); calls = 0; workerCalls = 0; lastTarget: unknown = null;
  async inspect() { this.calls++; return this.value; }
  async cleanup() { return { runsDeleted: 5, metricsDeleted: 5, messagesTombstoned: 10, threadsTombstoned: 5 }; }
  async reviewMaterial() { return { userMessage: 'local user', agentMessage: 'local agent', result: { outcome: 'no_change' } }; }
  worker() { this.workerCalls++; const index = this.value.runs.findIndex((run) => run.status === 'pending'); if (index >= 0) { const old = this.value.runs[index]!; this.value = snapshot([...this.value.runs.slice(0, index), { ...old, status: 'succeeded', outcome: categories[index] === 'confirmed_new_knowledge' || categories[index] === 'correction' ? 'proposal' : 'no_change', metricCount: 1 }, ...this.value.runs.slice(index + 1)]); } }
}

describe('persistent shadow evaluator', () => {
  it('rejects report content fields and enforces fixed manifest order', () => {
    const value = manifest(); expect(validateShadowEvaluationManifest(value)).toBe(true);
    expect(validateShadowEvaluationManifest({ ...value, scenarios: [...value.scenarios].reverse() })).toBe(false);
    expect(validateProductKnowledgeContract('ShadowEvaluationManifest', { ...value, provider_payload: 'secret' }).ok).toBe(false);
    const report = emptyShadowEvaluationReport(manifestDigest);
    const { manifest_digest: _manifestDigest, ...unbound } = report;
    expect(validateShadowEvaluationReport(unbound)).toBe(false);
    expect(validateShadowEvaluationReport({ ...report, manifest_digest: 'sha256:not-a-digest' })).toBe(false);
    expect(validateShadowEvaluationReport({ ...report, provider_payload: 'secret' })).toBe(false);
  });
  it('writes a rereadable regular 0600 report atomically', async () => {
    const f = await fixture(); try { await writeShadowEvaluationReport(f.paths, emptyShadowEvaluationReport(manifestDigest)); const info = await stat(f.paths.reportPath); expect(info.isFile()).toBe(true); expect(info.mode & 0o777).toBe(0o600); expect(JSON.parse(await readFile(f.paths.reportPath, 'utf8')).status).toBe('ready'); } finally { await rm(f.dir, { recursive: true, force: true }); }
  });
  it('binds the report to exact manifest bytes before worker or database access', async () => {
    const f = await fixture(); try {
      const report = await preflightShadowEvaluation(f.deps);
      expect(report.manifest_digest).toBe(manifestDigest);
      await writeFile(f.paths.manifestPath, JSON.stringify(manifest(), null, 2), { mode: 0o600 });
      const databaseCalls = f.db.calls;
      await expect(runNextShadowEvaluation(f.deps)).rejects.toThrow('different manifest');
      expect(f.db.calls).toBe(databaseCalls);
      expect(f.db.workerCalls).toBe(0);
    } finally { await rm(f.dir, { recursive: true, force: true }); }
  });
  it('resumes a terminal target without a second worker call', async () => {
    const f = await fixture(); try { f.db.value = snapshot([{ ownerRef: 'cubica://shadow-principal/v1/evaluator', gameRef: 'cubica://game-project/evaluator', receiptPrincipal: 'cubica://shadow-principal/v1/evaluator', receiptGame: 'cubica://game-project/evaluator', messageCount: 2, liveMessageCount: 2, stableTurnKey: manifest().scenarios[0]!.stable_turn_key, status: 'succeeded', outcome: 'no_change', operationCount: 0, durationMs: 1, inputBytes: 1, outputBytes: 1, metricCount: 1 }]); await preflightShadowEvaluation(f.deps); const result = await runNextShadowEvaluation(f.deps); expect(f.db.workerCalls).toBe(0); expect(result.status).toBe('awaiting_review'); } finally { await rm(f.dir, { recursive: true, force: true }); }
  });

  it('reconciles a committed terminal target when the worker acknowledgement is lost', async () => {
    const f = await fixture();
    try {
      (f.deps as { worker: ShadowEvaluatorDeps['worker'] }).worker = async () => {
        f.db.worker();
        throw new Error('commit acknowledgement lost');
      };
      await preflightShadowEvaluation(f.deps);
      await expect(runNextShadowEvaluation(f.deps)).resolves.toMatchObject({ status: 'awaiting_review' });
      expect(f.db.workerCalls).toBe(1);
    } finally { await rm(f.dir, { recursive: true, force: true }); }
  });
  it('does not allow the next scenario before review and stops on false review', async () => {
    const f = await fixture(); try { (f.deps as { reviewer: ShadowEvaluatorDeps['reviewer'] }).reviewer = { review: vi.fn(async () => [true, false, true, true] as const) }; await preflightShadowEvaluation(f.deps); const first = await runNextShadowEvaluation(f.deps); expect(first.status).toBe('awaiting_review'); const reviewed = await reviewShadowEvaluation(f.deps); expect(reviewed.status).toBe('hard_stopped'); expect(f.db.workerCalls).toBe(1); } finally { await rm(f.dir, { recursive: true, force: true }); }
  });
  it('blocks maxAttempts != 1 before invoking worker', async () => {
    const f = await fixture(); try { (f.deps as { workerConfig: ShadowEvaluatorDeps['workerConfig'] }).workerConfig = { ...f.deps.workerConfig, maxAttempts: 2 }; await expect(preflightShadowEvaluation(f.deps)).rejects.toThrow(); expect(f.db.workerCalls).toBe(0); } finally { await rm(f.dir, { recursive: true, force: true }); }
  });
  it('freezes run-next while awaiting review and requires distinct app/worker URLs', async () => {
    const f = await fixture(); try { await preflightShadowEvaluation(f.deps); await expect(runNextShadowEvaluation(f.deps)).resolves.toMatchObject({ status: 'awaiting_review' }); expect(f.db.lastTarget).toEqual({ ownerRef: manifest().shadow_principal_ref, gameRef: manifest().applies_to[0], stableTurnKey: manifest().scenarios[0]!.stable_turn_key }); const calls = f.db.workerCalls; await expect(runNextShadowEvaluation(f.deps)).resolves.toMatchObject({ status: 'awaiting_review' }); expect(f.db.workerCalls).toBe(calls); const env = cliEnv(); expect(readShadowEvaluatorCliConfig(env, 'run-next')).not.toBeNull(); expect(readShadowEvaluatorCliConfig({ ...env, CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL: env.CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_DATABASE_URL }, 'run-next')).toBeNull(); } finally { await rm(f.dir, { recursive: true, force: true }); }
  });
  it('allows cleanup configuration without Portal or provider credentials', () => {
    const env = cliEnv();
    env.CUBICA_PRODUCT_CONTEXT_SHADOW_CLEANUP_BATCH_LIMIT = '10';
    env.CUBICA_PRODUCT_CONTEXT_SHADOW_EVALUATOR_CLEANUP_MAX_PASSES = '3';
    for (const key of ['PKS_KEY', 'PKS_BASE_URL', 'PKS_MODEL', 'CUBICA_PORTAL_API_URL',
      'CUBICA_PRODUCT_CONTEXT_SHADOW_REAUTHORIZATION_KEY',
      'CUBICA_PRODUCT_CONTEXT_SHADOW_ZAI_CODING_PLAN_ENABLED',
      'CUBICA_PRODUCT_CONTEXT_SHADOW_MODEL_TIMEOUT_MS',
      'CUBICA_PRODUCT_CONTEXT_SHADOW_AUTHORIZATION_TIMEOUT_MS',
      'CUBICA_PRODUCT_CONTEXT_SHADOW_RETRY_BASE_MS',
      'CUBICA_PRODUCT_CONTEXT_SHADOW_MODEL_MAX_REQUEST_BYTES',
      'CUBICA_PRODUCT_CONTEXT_SHADOW_MODEL_MAX_RESPONSE_BYTES']) delete env[key];
    expect(readShadowEvaluatorCliConfig(env, 'cleanup')).not.toBeNull();
    expect(readShadowEvaluatorCliConfig(env, 'run-next')).toBeNull();
  });
  it('fails closed for retry-wait and binding mismatches without provider calls', async () => {
    const f = await fixture(); try {
      f.db.value = snapshot([{ ...f.db.value.runs[0]!, status: 'retry_wait' }]);
      await expect(preflightShadowEvaluation(f.deps)).resolves.toMatchObject({ status: 'hard_stopped' });
      expect(f.db.workerCalls).toBe(0);
    } finally { await rm(f.dir, { recursive: true, force: true }); }
    const bound = await fixture(); try {
      bound.db.value = snapshot([{ ...bound.db.value.runs[0]!, gameRef: 'cubica://game-project/other' }]);
      await expect(preflightShadowEvaluation(bound.deps)).resolves.toMatchObject({ status: 'hard_stopped' });
      expect(bound.db.workerCalls).toBe(0);
    } finally { await rm(bound.dir, { recursive: true, force: true }); }
  });
  it('marks only the current scenario on an unexpected outcome', async () => {
    const f = await fixture(); try {
      f.db.value = snapshot([{ ...f.db.value.runs[0]!, status: 'succeeded', outcome: 'success', metricCount: 1 }]);
      await preflightShadowEvaluation(f.deps);
      const report = await runNextShadowEvaluation(f.deps);
      expect(report.status).toBe('hard_stopped');
      expect(report.scenarios[0]!.actual_outcome).toBe('proposal');
      expect(report.scenarios[1]!.actual_outcome).toBe('pending');
      expect(f.db.workerCalls).toBe(0);
    } finally { await rm(f.dir, { recursive: true, force: true }); }
  });
  it('preserves a schema error instead of collapsing it to mismatch', async () => {
    const f = await fixture(); try {
      f.db.value = snapshot([{ ...f.db.value.runs[0]!, status: 'failed', outcome: 'gateway_malformed', metricCount: 1 }]);
      await preflightShadowEvaluation(f.deps);
      const report = await runNextShadowEvaluation(f.deps);
      expect(report.status).toBe('hard_stopped');
      expect(report.scenarios[0]!.actual_outcome).toBe('schema_error');
      expect(report.scenarios[1]!.actual_outcome).toBe('pending');
      expect(f.db.workerCalls).toBe(0);
    } finally { await rm(f.dir, { recursive: true, force: true }); }
  });
  it('requires valid configuration for review and cleanup core entry points', async () => {
    const f = await fixture(); try {
      await preflightShadowEvaluation(f.deps); await runNextShadowEvaluation(f.deps);
      (f.deps as { workerConfig: ShadowEvaluatorDeps['workerConfig'] }).workerConfig = { ...f.deps.workerConfig, maxAttempts: 2 };
      (f.deps as { reviewer: ShadowEvaluatorDeps['reviewer'] }).reviewer = { review: async () => [true, true, true, true] };
      await expect(reviewShadowEvaluation(f.deps)).rejects.toThrow('bounded evaluator configuration');
    } finally { await rm(f.dir, { recursive: true, force: true }); }
  });
  it('runs bounded cleanup to actual zero and preserves cumulative 5/5/10/5 totals', async () => {
    const f = await fixture(); try {
      const ready = fullyReviewedReport();
      await writeShadowEvaluationReport(f.paths, ready);
      let runs = 5; let metrics = 5; let messages = 10; let threads = 5;
      const cleanupDb: ShadowEvaluatorDatabase = {
        inspect: async () => ({ runs: [], activeRuns: runs, activeMetrics: metrics, activeMessages: messages, activeThreads: threads, activeTextBytes: messages }),
        cleanup: async () => {
          const runsDeleted = runs > 0 ? (runs--, 1) : 0;
          const metricsDeleted = metrics > 0 ? (metrics--, 1) : 0;
          const messagesTombstoned = messages > 0 ? (messages--, 1) : 0;
          const threadsTombstoned = messages < 5 && threads > 0 ? (threads--, 1) : 0;
          const result = { runsDeleted, metricsDeleted, messagesTombstoned, threadsTombstoned };
          return result;
        }
      };
      const report = await cleanupShadowEvaluation({ ...f.deps, db: cleanupDb });
      expect(report).toMatchObject({ status: 'completed', cleanup: { passed: true, runs_deleted: 5, metrics_deleted: 5, messages_tombstoned: 10, threads_tombstoned: 5 } });
      await expect(stat(f.paths.manifestPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(f.dir, { recursive: true, force: true }); }
  });
  it('recovers cleanup totals after a crash following a committed cleanup pass', async () => {
    const f = await fixture(); try {
      await writeShadowEvaluationReport(f.paths, fullyReviewedReport());
      let runs = 2; let metrics = 2; let messages = 4; let threads = 2; let failInspect = false;
      const db: ShadowEvaluatorDatabase = {
        inspect: async () => {
          if (failInspect) { failInspect = false; throw new Error('simulated process loss'); }
          return { runs: [], activeRuns: runs, activeMetrics: metrics, activeMessages: messages, activeThreads: threads, activeTextBytes: messages };
        },
        cleanup: async () => {
          const result = { runsDeleted: Number(runs > 0), metricsDeleted: Number(metrics > 0), messagesTombstoned: Math.min(2, messages), threadsTombstoned: Number(threads > 0) };
          runs = Math.max(0, runs - result.runsDeleted); metrics = Math.max(0, metrics - result.metricsDeleted);
          messages = Math.max(0, messages - result.messagesTombstoned); threads = Math.max(0, threads - result.threadsTombstoned);
          failInspect = true; return result;
        }
      };
      await expect(cleanupShadowEvaluation({ ...f.deps, db })).rejects.toThrow('simulated process loss');
      const persisted = JSON.parse(await readFile(f.paths.reportPath, 'utf8')) as ShadowEvaluationReport;
      expect(persisted.cleanup).toMatchObject({ started: true, initial_runs: 2, initial_metrics: 2, initial_messages: 4, initial_threads: 2 });
      const recoveredDb: ShadowEvaluatorDatabase = {
        inspect: async () => ({ runs: [], activeRuns: runs, activeMetrics: metrics, activeMessages: messages, activeThreads: threads, activeTextBytes: messages }),
        cleanup: async () => {
          const result = { runsDeleted: runs, metricsDeleted: metrics, messagesTombstoned: messages, threadsTombstoned: threads };
          runs = 0; metrics = 0; messages = 0; threads = 0; return result;
        }
      };
      const report = await cleanupShadowEvaluation({ ...f.deps, db: recoveredDb });
      expect(report.cleanup).toMatchObject({ passed: true, runs_deleted: 2, metrics_deleted: 2, messages_tombstoned: 4, threads_tombstoned: 2 });
    } finally { await rm(f.dir, { recursive: true, force: true }); }
  });
  it('terminalizes a PostgreSQL-clock-safe target before starting cleanup and reconciles a lost ack', async () => {
    const f = await fixture(); try {
      const stalled = { ...f.db.value.runs[0]!, cleanupRecovery: 'retention_expired' as const };
      let value = snapshot([stalled]);
      const db: ShadowEvaluatorDatabase = {
        inspect: async () => value,
        cleanup: async () => {
          value = snapshot([]);
          return { runsDeleted: 1, metricsDeleted: 1, messagesTombstoned: 2, threadsTombstoned: 1 };
        }
      };
      const recoveryWorker = vi.fn(async () => {
        value = snapshot([{ ...stalled, status: 'failed', outcome: 'retention_expired', metricCount: 1, cleanupRecovery: null }]);
        throw new Error('terminal commit acknowledgement lost');
      });
      const worker = vi.fn();
      const report = await cleanupShadowEvaluation({ ...f.deps, db, worker, recoveryWorker });
      expect(worker).not.toHaveBeenCalled();
      expect(recoveryWorker).toHaveBeenCalledTimes(1);
      expect(recoveryWorker).toHaveBeenCalledWith({
        ownerRef: manifest().shadow_principal_ref,
        gameRef: manifest().applies_to[0],
        stableTurnKey: manifest().scenarios[0]!.stable_turn_key
      });
      expect(report).toMatchObject({ status: 'hard_stopped', cleanup: { started: true, passed: true, initial_runs: 1 } });
    } finally { await rm(f.dir, { recursive: true, force: true }); }
  });
  it('never invokes recovery before PostgreSQL marks an expired target', async () => {
    const f = await fixture(); try {
      const base = emptyShadowEvaluationReport(manifestDigest);
      await writeShadowEvaluationReport(f.paths, {
        ...base, status: 'hard_stopped',
        scenarios: base.scenarios.map((scenario, index) => index === 0 ? { ...scenario, actual_outcome: 'gateway_error' } : scenario)
      });
      const worker = vi.fn(); const recoveryWorker = vi.fn();
      await expect(cleanupShadowEvaluation({ ...f.deps, worker, recoveryWorker })).rejects.toThrow('not safely recoverable');
      expect(worker).not.toHaveBeenCalled(); expect(recoveryWorker).not.toHaveBeenCalled();
      expect(JSON.parse(await readFile(f.paths.reportPath, 'utf8'))).toMatchObject({ cleanup: { started: false } });
    } finally { await rm(f.dir, { recursive: true, force: true }); }
  });
  it('keeps cleanup unstarted if recovery unexpectedly sees a claimable target', async () => {
    const f = await fixture(); try {
      await writeShadowEvaluationReport(f.paths, emptyShadowEvaluationReport(manifestDigest));
      f.db.value = snapshot([{ ...f.db.value.runs[0]!, cleanupRecovery: 'retention_expired' }]);
      const worker = vi.fn(); const recoveryWorker = vi.fn(async () => 'unsafe' as const);
      await expect(cleanupShadowEvaluation({ ...f.deps, worker, recoveryWorker })).rejects.toThrow('did not terminalize exactly');
      expect(worker).not.toHaveBeenCalled(); expect(recoveryWorker).toHaveBeenCalledTimes(1);
      expect(JSON.parse(await readFile(f.paths.reportPath, 'utf8'))).toMatchObject({ status: 'hard_stopped', cleanup: { started: false } });
    } finally { await rm(f.dir, { recursive: true, force: true }); }
  });
  it('idempotently removes a manifest left after a completed cleanup report', async () => {
    const f = await fixture(); try {
      const reviewed = fullyReviewedReport();
      const completed: ShadowEvaluationReport = {
        ...reviewed,
        status: 'completed',
        cleanup: {
          started: true,
          initial_runs: 5,
          initial_metrics: 5,
          initial_messages: 10,
          initial_threads: 5,
          active_runs: 0,
          active_metrics: 0,
          active_messages: 0,
          active_threads: 0,
          active_text_bytes: 0,
          runs_deleted: 5,
          metrics_deleted: 5,
          messages_tombstoned: 10,
          threads_tombstoned: 5,
          passed: true
        }
      };
      await writeShadowEvaluationReport(f.paths, completed);
      const zeroDb: ShadowEvaluatorDatabase = {
        inspect: async () => ({ runs: [], activeRuns: 0, activeMetrics: 0, activeMessages: 0, activeThreads: 0, activeTextBytes: 0 }),
        cleanup: vi.fn(async () => ({ runsDeleted: 0, metricsDeleted: 0, messagesTombstoned: 0, threadsTombstoned: 0 }))
      };
      await expect(cleanupShadowEvaluation({ ...f.deps, db: zeroDb })).resolves.toEqual(completed);
      expect(zeroDb.cleanup).not.toHaveBeenCalled();
      await expect(stat(f.paths.manifestPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(f.dir, { recursive: true, force: true }); }
  });
  it('does not remove a changed manifest when resuming completed cleanup', async () => {
    const f = await fixture(); try {
      const reviewed = fullyReviewedReport();
      await writeShadowEvaluationReport(f.paths, {
        ...reviewed,
        status: 'completed',
        cleanup: {
          ...reviewed.cleanup,
          started: true,
          initial_runs: 5,
          initial_metrics: 5,
          initial_messages: 10,
          initial_threads: 5,
          runs_deleted: 5,
          metrics_deleted: 5,
          messages_tombstoned: 10,
          threads_tombstoned: 5,
          passed: true
        }
      });
      await writeFile(f.paths.manifestPath, `${manifestBytes}\n`, { mode: 0o600 });
      const inspect = vi.fn(async () => ({ runs: [], activeRuns: 0, activeMetrics: 0, activeMessages: 0, activeThreads: 0, activeTextBytes: 0 }));
      const cleanup = vi.fn(async () => ({ runsDeleted: 0, metricsDeleted: 0, messagesTombstoned: 0, threadsTombstoned: 0 }));
      await expect(cleanupShadowEvaluation({ ...f.deps, db: { inspect, cleanup } })).rejects.toThrow('different manifest');
      expect(inspect).not.toHaveBeenCalled();
      expect(cleanup).not.toHaveBeenCalled();
      expect((await stat(f.paths.manifestPath)).isFile()).toBe(true);
    } finally { await rm(f.dir, { recursive: true, force: true }); }
  });
  it('hard-stops when persisted measurements no longer match the exact metric', async () => {
    const f = await fixture(); try {
      f.db.value = snapshot([{ ...f.db.value.runs[0]!, status: 'succeeded', outcome: 'no_change', durationMs: 7, inputBytes: 11, outputBytes: 13, metricCount: 1 }]);
      await preflightShadowEvaluation(f.deps); await runNextShadowEvaluation(f.deps);
      const report = JSON.parse(await readFile(f.paths.reportPath, 'utf8')) as ShadowEvaluationReport;
      const tampered = { ...report, scenarios: report.scenarios.map((scenario, index) => index === 0 ? { ...scenario, duration_ms: 8 } : scenario) };
      await writeFile(f.paths.reportPath, JSON.stringify(tampered), { mode: 0o600 });
      await expect(preflightShadowEvaluation(f.deps)).resolves.toMatchObject({ status: 'hard_stopped' });
    } finally { await rm(f.dir, { recursive: true, force: true }); }
  });
  it('retains the manifest when bounded cleanup cannot reach zero', async () => {
    const f = await fixture(); try {
      await writeShadowEvaluationReport(f.paths, fullyReviewedReport());
      const db: ShadowEvaluatorDatabase = { inspect: async () => ({ runs: [], activeRuns: 1, activeMetrics: 1, activeMessages: 2, activeThreads: 1, activeTextBytes: 2 }), cleanup: async () => ({ runsDeleted: 0, metricsDeleted: 0, messagesTombstoned: 0, threadsTombstoned: 0 }) };
      const report = await cleanupShadowEvaluation({ ...f.deps, db });
      expect(report).toMatchObject({ status: 'ready_for_cleanup', cleanup: { passed: false } });
      expect((await stat(f.paths.manifestPath)).isFile()).toBe(true);
    } finally { await rm(f.dir, { recursive: true, force: true }); }
  });
  it('rejects symlinked report parent components', async () => {
    const f = await fixture(); try {
      const outside = await mkdtemp(join(resolve(process.cwd(), '../..'), '.tmp/shadow-evaluator-outside-'));
      await mkdir(join(outside, 'nested'), { mode: 0o700 });
      const link = join(dirname(f.paths.reportPath), 'linked');
      await symlink(outside, link);
      await expect(writeShadowEvaluationReport({ ...f.paths, reportPath: join(link, 'nested', 'report.json') }, emptyShadowEvaluationReport(manifestDigest))).rejects.toThrow('parent chain');
      await rm(outside, { recursive: true, force: true });
    } finally { await rm(f.dir, { recursive: true, force: true }); }
  });
  it('rejects malformed lifecycle reports', () => {
    const base = emptyShadowEvaluationReport(manifestDigest);
    const mixed = { ...base, scenarios: base.scenarios.map((scenario, index) => index === 0 ? { ...scenario, review_expected_outcome: true } : scenario) };
    const wrongExpected = { ...base, scenarios: base.scenarios.map((scenario, index) => index === 0 ? { ...scenario, expected_outcome: 'proposal' } : scenario) };
    const falseCompleted = { ...base, status: 'completed', cleanup: { ...base.cleanup, passed: true } };
    const falseHardStop = { ...base, status: 'hard_stopped' };
    for (const report of [mixed, wrongExpected, falseCompleted, falseHardStop]) expect(validateShadowEvaluationReport(report)).toBe(false);
  });
});

function fullyReviewedReport(): ShadowEvaluationReport {
  const report = emptyShadowEvaluationReport(manifestDigest);
  return { ...report, status: 'ready_for_cleanup', scenarios: report.scenarios.map((scenario) => ({ ...scenario, actual_outcome: scenario.expected_outcome, review_expected_outcome: true, review_all_and_only_confirmed_facts: true, review_correct_page_minimal_patch: true, review_no_duplicate_contradiction_unrelated_rewrite: true })) };
}

function cliEnv(): NodeJS.ProcessEnv {
  return { CUBICA_PRODUCT_CONTEXT_SHADOW_EVALUATOR_ENABLED: 'true', CUBICA_DEPLOYMENT_TIER: 'test', CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL: 'postgresql://app.internal/shadow?sslmode=verify-full', CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_DATABASE_URL: 'postgresql://worker.internal/shadow?sslmode=verify-full', ...workerEnv() };
}
function workerEnv(): NodeJS.ProcessEnv { return { CUBICA_PRODUCT_CONTEXT_SHADOW_ZAI_CODING_PLAN_ENABLED: 'true', CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_DATABASE_URL: 'postgresql://worker.internal/shadow?sslmode=verify-full', CUBICA_PORTAL_API_URL: 'http://localhost:1337', CUBICA_PRODUCT_CONTEXT_SHADOW_REAUTHORIZATION_KEY: 'w'.repeat(32), CUBICA_PRODUCT_CONTEXT_SHADOW_KNOWLEDGE_REPOSITORY: '/srv/cubica/knowledge', PKS_KEY: 'test-key', PKS_BASE_URL: 'https://api.z.ai/api/coding/paas/v4/', PKS_MODEL: 'glm-4.7', CUBICA_PRODUCT_CONTEXT_SHADOW_MODEL_TIMEOUT_MS: '10000', CUBICA_PRODUCT_CONTEXT_SHADOW_AUTHORIZATION_TIMEOUT_MS: '2000', CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_LEASE_MS: '17000', CUBICA_PRODUCT_CONTEXT_SHADOW_RETRY_BASE_MS: '1000', CUBICA_PRODUCT_CONTEXT_SHADOW_MAX_ATTEMPTS: '1', CUBICA_PRODUCT_CONTEXT_SHADOW_MODEL_MAX_REQUEST_BYTES: '524288', CUBICA_PRODUCT_CONTEXT_SHADOW_MODEL_MAX_RESPONSE_BYTES: '524288', CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_DATABASE_STATEMENT_TIMEOUT_MS: '5000', CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_DATABASE_LOCK_TIMEOUT_MS: '1000' }; }
