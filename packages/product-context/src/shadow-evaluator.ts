/**
 * Persistent, non-production evaluator for the five Stage 2 shadow scenarios.
 *
 * This module deliberately owns neither enqueue nor conversation persistence.
 * The Editor/Portal path has already created the exact turns in the disposable
 * database; the evaluator only observes one target, invokes the existing
 * one-shot worker, writes a content-free report, and waits for local review.
 */
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readdir, rename, rmdir, unlink } from 'node:fs/promises';
import { isAbsolute, dirname, join, relative, resolve, sep } from 'node:path';
import type { ShadowEvaluationManifest, ShadowEvaluationReport, ShadowEvaluationScenarioReport } from './generated/product-knowledge.ts';
import { validateShadowEvaluationManifest, validateShadowEvaluationReport } from './contracts.ts';

export const EVALUATION_CATEGORIES = [
  'transient_conversation', 'existing_fact', 'unconfirmed_agent_suggestion',
  'confirmed_new_knowledge', 'correction'
] as const;
export type EvaluationCategory = typeof EVALUATION_CATEGORIES[number];
export type EvaluationDbStatus = 'pending' | 'leased' | 'calling_model' | 'retry_wait' | 'succeeded' | 'denied' | 'failed' | 'blocked';
export type EvaluationCleanupRecovery = 'retention_expired' | 'expired_calling_model' | 'attempts_exhausted';

export interface EvaluationRunView {
  readonly ownerRef: string;
  readonly gameRef: string;
  readonly receiptPrincipal: string;
  readonly receiptGame: string;
  readonly messageCount: number;
  readonly liveMessageCount: number;
  readonly stableTurnKey: string;
  readonly status: EvaluationDbStatus;
  readonly outcome: string | null;
  readonly operationCount: number;
  readonly durationMs: number;
  readonly inputBytes: number;
  readonly outputBytes: number;
  readonly metricCount: number;
  /** PostgreSQL-clock predicate proving that a targeted worker can only terminalize this run. */
  readonly cleanupRecovery?: EvaluationCleanupRecovery | null;
}
export interface EvaluationDbSnapshot {
  readonly runs: readonly EvaluationRunView[];
  readonly activeRuns: number;
  readonly activeMetrics: number;
  readonly activeMessages: number;
  readonly activeThreads: number;
  readonly activeTextBytes: number;
}
export interface EvaluationCleanupResult {
  readonly runsDeleted: number;
  readonly metricsDeleted: number;
  readonly messagesTombstoned: number;
  readonly threadsTombstoned: number;
}
/** App-role adapter: no enqueue method exists on purpose. */
export interface ShadowEvaluatorDatabase {
  inspect(): Promise<EvaluationDbSnapshot>;
  cleanup(limit: number): Promise<EvaluationCleanupResult>;
  reviewMaterial?(stableTurnKey: string): Promise<ShadowEvaluatorReviewMaterial>;
}
export interface ShadowEvaluatorReviewMaterial { readonly userMessage: string; readonly agentMessage: string; readonly result: unknown; }
export interface ShadowEvaluatorWorkerConfig {
  readonly evaluationEnabled: boolean;
  readonly deploymentTier: string;
  readonly maxAttempts: number;
}
export interface ShadowEvaluatorPaths { readonly manifestPath: string; readonly reportPath: string; readonly worktreePath: string; }
export interface ShadowEvaluatorReviewer {
  /** The implementation may show material through /dev/tty; it returns booleans only. */
  review(index: number, expected: 'no_change' | 'proposal', material?: ShadowEvaluatorReviewMaterial): Promise<readonly [boolean, boolean, boolean, boolean]>;
}
export interface ShadowEvaluatorDeps {
  readonly db: ShadowEvaluatorDatabase;
  readonly worker: (target: { readonly ownerRef: string; readonly gameRef: string; readonly stableTurnKey: string }) => Promise<unknown>;
  readonly recoveryWorker: (target: { readonly ownerRef: string; readonly gameRef: string; readonly stableTurnKey: string }) => Promise<'terminalized' | 'unsafe'>;
  readonly readGitHead: () => Promise<string>;
  readonly workerConfig: ShadowEvaluatorWorkerConfig;
  readonly paths: ShadowEvaluatorPaths;
  readonly reviewer?: ShadowEvaluatorReviewer;
  readonly cleanupLimit?: number;
  readonly cleanupMaxPasses?: number;
}

const expectedOutcomes: Record<EvaluationCategory, 'no_change' | 'proposal'> = {
  transient_conversation: 'no_change', existing_fact: 'no_change',
  unconfirmed_agent_suggestion: 'no_change', confirmed_new_knowledge: 'proposal', correction: 'proposal'
};
const terminal = new Set(['succeeded', 'denied', 'failed', 'blocked']);
const allowedActual = new Set(['no_change', 'proposal']);

export async function readShadowEvaluationManifest(paths: ShadowEvaluatorPaths): Promise<ShadowEvaluationManifest> {
  return (await readManifestBinding(paths)).manifest;
}

async function readManifestBinding(paths: ShadowEvaluatorPaths): Promise<{
  readonly manifest: ShadowEvaluationManifest;
  readonly digest: string;
}> {
  await assertSecurePaths(paths, true);
  const bytes = await readSecureBytes(paths.manifestPath);
  const value = JSON.parse(bytes.toString('utf8')) as unknown;
  if (!validateShadowEvaluationManifest(value)) throw new Error('Invalid shadow evaluation manifest.');
  return { manifest: value, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
}

export async function readShadowEvaluationReport(paths: ShadowEvaluatorPaths): Promise<ShadowEvaluationReport | null> {
  await assertSecurePaths(paths, false);
  try {
    const value = JSON.parse(await readSecureFile(paths.reportPath)) as unknown;
    if (!validateShadowEvaluationReport(value)) throw new Error('Invalid shadow evaluation report.');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('Invalid shadow evaluation report.');
  }
}

export async function writeShadowEvaluationReport(paths: ShadowEvaluatorPaths, report: ShadowEvaluationReport): Promise<void> {
  await assertSecurePaths(paths, false);
  if (!validateShadowEvaluationReport(report)) throw new Error('Invalid shadow evaluation report.');
  const parent = dirname(paths.reportPath);
  const temp = `${paths.reportPath}.${process.pid}.${Date.now()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(report));
    await handle.sync();
    await handle.close(); handle = undefined;
    await rename(temp, paths.reportPath);
    const directory = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY | (constants.O_NOFOLLOW ?? 0));
    try { await directory.sync(); } finally { await directory.close(); }
    const checked = await readShadowEvaluationReport(paths);
    const bytes = await readSecureFile(paths.reportPath);
    if (!checked || JSON.stringify(checked) !== JSON.stringify(report) || bytes !== JSON.stringify(report)) throw new Error('Report reread failed.');
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await import('node:fs/promises').then(({ unlink }) => unlink(temp).catch(() => undefined));
    throw error instanceof Error && error.message === 'Invalid shadow evaluation report.' ? error : new Error('Atomic report write failed.');
  }
}

export function emptyShadowEvaluationReport(manifestDigest: string): ShadowEvaluationReport {
  return {
    schema_version: '1.0.0', manifest_digest: manifestDigest, status: 'ready',
    scenarios: EVALUATION_CATEGORIES.map((category) => scenarioReport(category, 'pending', expectedOutcomes[category])),
    git_unchanged: true,
    cleanup: { started: false, initial_runs: 0, initial_metrics: 0, initial_messages: 0, initial_threads: 0, active_runs: 0, active_metrics: 0, active_messages: 0, active_threads: 0, active_text_bytes: 0, runs_deleted: 0, metrics_deleted: 0, messages_tombstoned: 0, threads_tombstoned: 0, passed: false }
  };
}

export async function preflightShadowEvaluation(deps: ShadowEvaluatorDeps): Promise<ShadowEvaluationReport> {
  const { manifest, digest } = await readManifestBinding(deps.paths);
  ensureBasicConfig(deps.workerConfig);
  if (await deps.readGitHead() !== manifest.expected_git_head) throw new Error('Git head does not match manifest.');
  const existing = await readShadowEvaluationReport(deps.paths);
  const report = bindReport(existing, digest);
  const snapshot = await deps.db.inspect();
  try { validateVisibleRuns(manifest, snapshot, report); } catch { const stopped = await stop(deps, report, reportIndex(report), 'mismatch'); return stopped; }
  if (!existing) await writeShadowEvaluationReport(deps.paths, report);
  return report;
}

export async function runNextShadowEvaluation(deps: ShadowEvaluatorDeps): Promise<ShadowEvaluationReport> {
  const { manifest, digest } = await readManifestBinding(deps.paths);
  ensureConfig(deps.workerConfig);
  let report = await existingOrEmpty(deps, digest);
  const head = await deps.readGitHead();
  if (head !== manifest.expected_git_head) return await stop(deps, report, reportIndex(report), 'git_drift');
  if (report.status === 'awaiting_review') return report;
  if (report.status === 'hard_stopped' || report.status === 'completed' || report.status === 'ready_for_cleanup') return report;
  const index = report.scenarios.findIndex((scenario) => scenario.actual_outcome === 'pending');
  if (index < 0) return report;
  const target = manifest.scenarios[index]!;
  const snapshot = await deps.db.inspect();
  try { validateVisibleRuns(manifest, snapshot, report); } catch { return await stop(deps, report, index, 'mismatch'); }
  const matches = snapshot.runs.filter((run) => run.stableTurnKey === target.stable_turn_key);
  if (matches.length > 1) return await stop(deps, report, index, 'mismatch');
  const current = matches[0];
  if (!current || !terminal.has(current.status)) {
    if (!current || current.status !== 'pending') return await stop(deps, report, index, 'mismatch');
    try {
      await deps.worker({
        ownerRef: manifest.shadow_principal_ref,
        gameRef: manifest.applies_to[0]!,
        stableTurnKey: target.stable_turn_key
      });
    } catch {
      // A worker may commit the terminal run and lose the acknowledgement.
      // The target database is authoritative and is reconciled below.
    }
  }
  if (await deps.readGitHead() !== manifest.expected_git_head) return await stop(deps, report, index, 'git_drift');
  const after = (await deps.db.inspect()).runs.filter((run) => run.stableTurnKey === target.stable_turn_key);
  if (after.length !== 1 || !terminal.has(after[0]!.status) || after[0]!.metricCount !== 1) return await stop(deps, report, index, 'mismatch');
  const run = after[0]!;
  const actual = mapOutcome(run);
  if (actual !== expectedOutcomes[target.category]) return await stop(deps, updateScenario(report, index, actual, run, true), index, actual);
  report = updateScenario(report, index, actual, run, true);
  report = { ...report, status: 'awaiting_review' };
  await writeShadowEvaluationReport(deps.paths, report);
  return report;
}

export async function reviewShadowEvaluation(deps: ShadowEvaluatorDeps): Promise<ShadowEvaluationReport> {
  const { manifest, digest } = await readManifestBinding(deps.paths);
  ensureConfig(deps.workerConfig);
  let report = await existingOrEmpty(deps, digest);
  const diagnosticIndex = semanticMismatchReviewIndex(report);
  const diagnostic = diagnosticIndex >= 0;
  if ((report.status !== 'awaiting_review' && !diagnostic) || !deps.reviewer) throw new Error('Local semantic review is required.');
  if (await deps.readGitHead() !== manifest.expected_git_head) {
    if (diagnostic) throw new Error('Semantic mismatch review requires unchanged Git.');
    return await stop(deps, report, reportIndex(report), 'git_drift');
  }
  const index = diagnostic ? diagnosticIndex :
    report.scenarios.findIndex((scenario) => scenario.review_expected_outcome === null);
  if (index < 0) return report;
  const snapshot = await deps.db.inspect();
  try { validateVisibleRuns(manifest, snapshot, report); }
  catch {
    if (diagnostic) throw new Error('Semantic mismatch review requires an exact succeeded run.');
    return await stop(deps, report, index, 'mismatch');
  }
  if (diagnostic) {
    const targetKey = manifest.scenarios[index]!.stable_turn_key;
    const exact = snapshot.runs.filter((run) => run.stableTurnKey === targetKey);
    if (exact.length !== 1 || exact[0]!.status !== 'succeeded' ||
        mapOutcome(exact[0]!) !== report.scenarios[index]!.actual_outcome) {
      throw new Error('Semantic mismatch review requires an exact succeeded run.');
    }
    await claimSemanticMismatchReview(deps.paths);
  }
  let material: ShadowEvaluatorReviewMaterial;
  try {
    if (!deps.db.reviewMaterial) throw new Error('Review material port is unavailable.');
    material = await deps.db.reviewMaterial(manifest.scenarios[index]!.stable_turn_key);
  } catch {
    if (diagnostic) throw new Error('Semantic mismatch review material is unavailable.');
    return await stop(deps, report, index, 'unavailable');
  }
  let values: readonly [boolean, boolean, boolean, boolean];
  try { values = await deps.reviewer.review(index, expectedOutcomes[manifest.scenarios[index]!.category], material); }
  catch {
    if (diagnostic) throw new Error('Semantic mismatch review did not complete.');
    return await stop(deps, report, index, 'unavailable');
  }
  if (values.length !== 4 || values.some((value) => typeof value !== 'boolean')) {
    if (diagnostic) throw new Error('Semantic mismatch review returned invalid answers.');
    return await stop(deps, report, index, 'mismatch');
  }
  const current = report.scenarios[index]!;
  const next = { ...current, review_expected_outcome: diagnostic ? false : values[0], review_all_and_only_confirmed_facts: values[1], review_correct_page_minimal_patch: values[2], review_no_duplicate_contradiction_unrelated_rewrite: values[3] };
  report = { ...report, scenarios: report.scenarios.map((value, i) => i === index ? next : value), status: diagnostic ? 'hard_stopped' : values.every(Boolean) ? (index === 4 ? 'ready_for_cleanup' : 'ready') : 'hard_stopped' };
  await writeShadowEvaluationReport(deps.paths, report);
  return report;
}

export async function cleanupShadowEvaluation(deps: ShadowEvaluatorDeps): Promise<ShadowEvaluationReport> {
  const { manifest, digest } = await readManifestBinding(deps.paths);
  ensureConfig(deps.workerConfig);
  let report = await existingOrEmpty(deps, digest);
  if (report.status === 'ready') {
    const outcome = await deps.readGitHead() === manifest.expected_git_head ? 'unavailable' : 'git_drift';
    report = await stop(deps, report, reportIndex(report), outcome);
  }
  if (report.status === 'completed' && report.cleanup.passed) {
    const final = await deps.db.inspect();
    const zero = final.activeRuns === 0 && final.activeMetrics === 0 && final.activeMessages === 0 &&
      final.activeThreads === 0 && final.activeTextBytes === 0;
    if (!zero || await deps.readGitHead() !== manifest.expected_git_head) {
      throw new Error('Completed cleanup can only finalize after exact zero and unchanged Git.');
    }
    await removeSemanticMismatchReviewClaim(deps.paths);
    await removeManifest(deps.paths, digest);
    return report;
  }
  if (report.status !== 'ready_for_cleanup' && report.status !== 'hard_stopped') throw new Error('Cleanup is not permitted in the current state.');
  if (!deps.cleanupLimit || !deps.cleanupMaxPasses) throw new Error('Explicit cleanup bounds are required.');
  let final = await deps.db.inspect();
  if (!report.cleanup.started) final = await recoverExpiredCleanupTargets(deps, manifest, final);
  if (!report.cleanup.started) {
    report = { ...report, cleanup: {
      ...report.cleanup, started: true,
      initial_runs: final.activeRuns, initial_metrics: final.activeMetrics,
      initial_messages: final.activeMessages, initial_threads: final.activeThreads,
      active_runs: final.activeRuns, active_metrics: final.activeMetrics,
      active_messages: final.activeMessages, active_threads: final.activeThreads,
      active_text_bytes: final.activeTextBytes
    } };
    await writeShadowEvaluationReport(deps.paths, report);
  }
  for (let pass = 0; pass < deps.cleanupMaxPasses; pass++) {
    const result = await deps.db.cleanup(deps.cleanupLimit);
    final = await deps.db.inspect();
    if (result.runsDeleted + result.metricsDeleted + result.messagesTombstoned + result.threadsTombstoned === 0) break;
    if (final.activeRuns === 0 && final.activeMetrics === 0 && final.activeTextBytes === 0) break;
  }
  const passed = final.activeRuns === 0 && final.activeMetrics === 0 && final.activeMessages === 0 && final.activeThreads === 0 && final.activeTextBytes === 0;
  const gitUnchanged = (await deps.readGitHead()) === manifest.expected_git_head;
  report = { ...report, status: report.status === 'hard_stopped' || !gitUnchanged ? 'hard_stopped' : passed ? 'completed' : 'ready_for_cleanup', cleanup: { ...report.cleanup, active_runs: final.activeRuns, active_metrics: final.activeMetrics, active_messages: final.activeMessages, active_threads: final.activeThreads, active_text_bytes: final.activeTextBytes, runs_deleted: Math.max(0, report.cleanup.initial_runs - final.activeRuns), metrics_deleted: Math.max(0, report.cleanup.initial_metrics - final.activeMetrics), messages_tombstoned: Math.max(0, report.cleanup.initial_messages - final.activeMessages), threads_tombstoned: Math.max(0, report.cleanup.initial_threads - final.activeThreads), passed }, git_unchanged: gitUnchanged, scenarios: gitUnchanged ? report.scenarios : report.scenarios.map((scenario) => ({ ...scenario, git_unchanged: false })) };
  await writeShadowEvaluationReport(deps.paths, report);
  if (passed) {
    await removeSemanticMismatchReviewClaim(deps.paths);
    await removeManifest(deps.paths, digest);
  }
  return report;
}

async function recoverExpiredCleanupTargets(
  deps: ShadowEvaluatorDeps,
  manifest: ShadowEvaluationManifest,
  snapshot: EvaluationDbSnapshot
): Promise<EvaluationDbSnapshot> {
  const nonTerminal = snapshot.runs.filter((run) => !terminal.has(run.status));
  if (nonTerminal.length === 0) return snapshot;
  const allowed = new Set(manifest.scenarios.map((scenario) => scenario.stable_turn_key));
  if (snapshot.runs.some((run) => !allowed.has(run.stableTurnKey) ||
      run.ownerRef !== manifest.shadow_principal_ref || run.gameRef !== manifest.applies_to[0] ||
      run.receiptPrincipal !== manifest.shadow_principal_ref || run.receiptGame !== manifest.applies_to[0] ||
      run.messageCount !== 2 || run.liveMessageCount !== 2) ||
      nonTerminal.some((run) => run.cleanupRecovery === null || run.cleanupRecovery === undefined)) {
    throw new Error('Nonterminal cleanup target is not safely recoverable.');
  }
  for (const run of nonTerminal) {
    try {
      // App-role inspection is advisory. The credential-free executor rolls
      // back if the exact target becomes claimable before this second check.
      const outcome = await deps.recoveryWorker({
        ownerRef: manifest.shadow_principal_ref,
        gameRef: manifest.applies_to[0]!,
        stableTurnKey: run.stableTurnKey
      });
      if (outcome !== 'terminalized') throw new Error('Recovery target became claimable.');
    } catch {
      // A committed terminal transition may lose its acknowledgement.
    }
    const after = await deps.db.inspect();
    const target = after.runs.filter((candidate) => candidate.stableTurnKey === run.stableTurnKey);
    if (target.length !== 1 || !terminal.has(target[0]!.status) || target[0]!.metricCount !== 1) {
      throw new Error('Expired cleanup target did not terminalize exactly.');
    }
    snapshot = after;
  }
  return snapshot;
}

async function removeManifest(paths: ShadowEvaluatorPaths, expectedDigest: string): Promise<void> {
  try {
    const binding = await readManifestBinding(paths);
    if (binding.digest !== expectedDigest) throw new Error('Shadow evaluation report is bound to a different manifest.');
    await unlink(paths.manifestPath);
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

function semanticMismatchReviewClaimPath(paths: ShadowEvaluatorPaths): string {
  return `${paths.reportPath}.semantic-review-claimed`;
}

async function claimSemanticMismatchReview(paths: ShadowEvaluatorPaths): Promise<void> {
  const path = semanticMismatchReviewClaimPath(paths);
  try {
    await mkdir(path, { mode: 0o700 });
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() ||
        (info.mode & 0o777) !== 0o700) throw new Error('Semantic mismatch review claim is unsafe.');
    await syncParentDirectory(path);
  } catch {
    // A crash-sticky claim deliberately makes retries and concurrent reviews
    // indistinguishable: both must fail before reading the local material.
    throw new Error('Semantic mismatch review was already claimed.');
  }
}

async function removeSemanticMismatchReviewClaim(paths: ShadowEvaluatorPaths): Promise<void> {
  const path = semanticMismatchReviewClaimPath(paths);
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() ||
        (info.mode & 0o777) !== 0o700 || (await readdir(path)).length !== 0) {
      throw new Error('Semantic mismatch review claim is unsafe.');
    }
    await rmdir(path);
    await syncParentDirectory(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function syncParentDirectory(path: string): Promise<void> {
  const directory = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
  try { await directory.sync(); } finally { await directory.close(); }
}

function ensureBasicConfig(config: ShadowEvaluatorWorkerConfig): void { ensureConfig(config); }
function ensureConfig(config: ShadowEvaluatorWorkerConfig): void { if (!config.evaluationEnabled || !['test', 'staging'].includes(config.deploymentTier) || config.maxAttempts !== 1) throw new Error('Explicit bounded evaluator configuration is required.'); }
async function existingOrEmpty(deps: ShadowEvaluatorDeps, manifestDigest: string): Promise<ShadowEvaluationReport> {
  return bindReport(await readShadowEvaluationReport(deps.paths), manifestDigest);
}
function bindReport(report: ShadowEvaluationReport | null, manifestDigest: string): ShadowEvaluationReport {
  if (!report) return emptyShadowEvaluationReport(manifestDigest);
  if (report.manifest_digest !== manifestDigest) throw new Error('Shadow evaluation report is bound to a different manifest.');
  return report;
}
function reportIndex(report: ShadowEvaluationReport): number { return report.scenarios.findIndex((scenario) => scenario.actual_outcome === 'pending'); }
function semanticMismatchReviewIndex(report: ShadowEvaluationReport): number {
  if (report.status !== 'hard_stopped' || report.cleanup.started || !report.git_unchanged) return -1;
  const isUnreviewed = (scenario: ShadowEvaluationScenarioReport) =>
    scenario.review_expected_outcome === null && scenario.review_all_and_only_confirmed_facts === null &&
    scenario.review_correct_page_minimal_patch === null &&
    scenario.review_no_duplicate_contradiction_unrelated_rewrite === null;
  const isFullyAccepted = (scenario: ShadowEvaluationScenarioReport) =>
    scenario.review_expected_outcome === true && scenario.review_all_and_only_confirmed_facts === true &&
    scenario.review_correct_page_minimal_patch === true &&
    scenario.review_no_duplicate_contradiction_unrelated_rewrite === true;
  const candidates = report.scenarios.map((scenario, index) => ({ scenario, index })).filter(({ scenario }) =>
    allowedActual.has(scenario.actual_outcome) && scenario.actual_outcome !== scenario.expected_outcome &&
    isUnreviewed(scenario));
  if (candidates.length !== 1) return -1;
  const index = candidates[0]!.index;
  if (report.scenarios.slice(0, index).some((scenario) =>
    scenario.actual_outcome !== scenario.expected_outcome || !isFullyAccepted(scenario)) ||
      report.scenarios.slice(index + 1).some((scenario) =>
        scenario.actual_outcome !== 'pending' || !isUnreviewed(scenario))) return -1;
  return index;
}
async function stop(deps: ShadowEvaluatorDeps, report: ShadowEvaluationReport, index: number, outcome: ShadowEvaluationScenarioReport['actual_outcome']): Promise<ShadowEvaluationReport> {
  const drift = outcome === 'git_drift';
  const next = index < 0 || !report.scenarios[index] ? report : {
    ...report,
    scenarios: report.scenarios.map((scenario, candidate) => candidate === index ? {
      ...scenario, actual_outcome: outcome, git_unchanged: !drift && scenario.git_unchanged
    } : scenario)
  };
  const stopped = {
    ...next,
    status: 'hard_stopped' as const,
    git_unchanged: drift ? false : next.git_unchanged,
    scenarios: drift ? next.scenarios.map((scenario) => ({ ...scenario, git_unchanged: false })) : next.scenarios
  };
  await writeShadowEvaluationReport(deps.paths, stopped);
  return stopped;
}
function mapOutcome(run: EvaluationRunView): ShadowEvaluationScenarioReport['actual_outcome'] { if (run.status === 'succeeded' && run.outcome === 'no_change') return 'no_change'; if (run.status === 'succeeded' && run.outcome === 'success') return 'proposal'; if (run.outcome === 'authorization_changed' || run.outcome === 'policy_denied') return 'authorization_error'; if (run.outcome === 'message_changed' || run.outcome === 'message_deleted' || run.outcome === 'retention_expired') return 'unavailable'; if (run.outcome === 'gateway_malformed') return 'schema_error'; return 'gateway_error'; }
function updateScenario(report: ShadowEvaluationReport, index: number, actual: ShadowEvaluationScenarioReport['actual_outcome'], run: EvaluationRunView | null, unchanged: boolean): ShadowEvaluationReport { return { ...report, scenarios: report.scenarios.map((value, i) => i === index ? { ...value, actual_outcome: actual, operation_count: run?.operationCount ?? 0, duration_ms: run?.durationMs ?? 0, input_bytes: run?.inputBytes ?? 0, output_bytes: run?.outputBytes ?? 0, git_unchanged: unchanged } : value), git_unchanged: report.git_unchanged && unchanged }; }
function scenarioReport(category: EvaluationCategory, actual: ShadowEvaluationScenarioReport['actual_outcome'], expected: 'no_change' | 'proposal'): ShadowEvaluationScenarioReport { return { category, expected_outcome: expected, actual_outcome: actual, review_expected_outcome: null, review_all_and_only_confirmed_facts: null, review_correct_page_minimal_patch: null, review_no_duplicate_contradiction_unrelated_rewrite: null, operation_count: 0, duration_ms: 0, input_bytes: 0, output_bytes: 0, git_unchanged: true }; }
function validateVisibleRuns(manifest: ShadowEvaluationManifest, snapshot: EvaluationDbSnapshot, report: ShadowEvaluationReport): void {
  const allowed = new Set(manifest.scenarios.map((scenario) => scenario.stable_turn_key));
  if (snapshot.runs.some((run) => !allowed.has(run.stableTurnKey) ||
      run.ownerRef !== manifest.shadow_principal_ref || run.gameRef !== manifest.applies_to[0] ||
      run.receiptPrincipal !== manifest.shadow_principal_ref || run.receiptGame !== manifest.applies_to[0] ||
      run.messageCount !== 2 || run.liveMessageCount !== 2)) throw new Error('Visible shadow run binding mismatch.');
  for (const key of allowed) if (snapshot.runs.filter((run) => run.stableTurnKey === key).length > 1) {
    throw new Error('Manifest target has duplicate runs.');
  }
  const pending = report.scenarios.findIndex((scenario) => scenario.actual_outcome === 'pending');
  for (let index = 0; index < manifest.scenarios.length; index++) {
    const run = snapshot.runs.find((candidate) => candidate.stableTurnKey === manifest.scenarios[index]!.stable_turn_key);
    const scenario = report.scenarios[index]!;
    if (scenario.actual_outcome !== 'pending') {
      if (!run || !terminal.has(run.status) || run.metricCount !== 1 || mapOutcome(run) !== scenario.actual_outcome ||
          run.operationCount !== scenario.operation_count || run.durationMs !== scenario.duration_ms ||
          run.inputBytes !== scenario.input_bytes || run.outputBytes !== scenario.output_bytes) {
        throw new Error('Recorded evaluation result is no longer present exactly.');
      }
    } else if (index > pending && run) {
      throw new Error('Future evaluation scenario is already present.');
    }
  }
  if (pending >= 0) {
    const target = manifest.scenarios[pending]!.stable_turn_key;
    const nonTerminal = snapshot.runs.filter((run) => !terminal.has(run.status));
    if (nonTerminal.some((run) => run.stableTurnKey !== target) ||
        nonTerminal.filter((run) => run.stableTurnKey === target).length > 1) {
      throw new Error('Target must be the only pending shadow run.');
    }
    if (snapshot.runs.some((run) => run.stableTurnKey === target && run.status === 'retry_wait')) {
      throw new Error('Ad-hoc retry is not permitted.');
    }
  }
}
async function assertSecurePaths(paths: ShadowEvaluatorPaths, manifest: boolean): Promise<void> {
  if (!isAbsolute(paths.manifestPath) || !isAbsolute(paths.reportPath) || !isAbsolute(paths.worktreePath) || paths.manifestPath === paths.reportPath) throw new Error('Evaluator paths must be absolute and distinct.');
  const worktree = await lstat(paths.worktreePath).catch(() => null);
  const root = resolve(paths.worktreePath, '.tmp'); const tmp = await lstat(root).catch(() => null);
  if (!worktree?.isDirectory() || worktree.isSymbolicLink() || !tmp?.isDirectory() || tmp.isSymbolicLink() ||
      worktree.uid !== process.getuid?.() || tmp.uid !== process.getuid?.()) throw new Error('Evaluator worktree .tmp must be an owned real directory.');
  if ((worktree.mode & 0o022) !== 0 || (tmp.mode & 0o022) !== 0) throw new Error('Evaluator directories have unsafe permissions.');
  for (const path of [paths.manifestPath, paths.reportPath]) {
    if (relative(root, path).startsWith('..') || isAbsolute(relative(root, path))) throw new Error('Evaluator paths must be inside worktree .tmp.');
    const parentRelative = relative(root, dirname(path));
    let current = root;
    for (const component of parentRelative.split(sep).filter(Boolean)) {
      current = join(current, component);
      const directory = await lstat(current).catch(() => null);
      if (!directory?.isDirectory() || directory.isSymbolicLink() ||
          (directory.mode & 0o022) !== 0 || directory.uid !== process.getuid?.()) {
        throw new Error('Evaluator parent chain must contain only owned private directories.');
      }
    }
  }
  const target = manifest ? paths.manifestPath : paths.reportPath;
  try { const info = await lstat(target); if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o600 || info.uid !== process.getuid?.()) throw new Error('Evaluator file must be a regular owned 0600 file.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || manifest) throw error; }
}

async function readSecureFile(path: string): Promise<string> {
  return (await readSecureBytes(path)).toString('utf8');
}

async function readSecureBytes(path: string): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || (info.mode & 0o777) !== 0o600 || info.uid !== process.getuid?.()) {
      throw new Error('Evaluator file must be a regular owned 0600 file.');
    }
    return await handle.readFile();
  } finally { await handle.close(); }
}
