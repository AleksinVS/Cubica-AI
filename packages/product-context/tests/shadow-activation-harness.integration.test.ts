import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ManagedKnowledgeGit, ReadOnlyKnowledgeGit } from '../src/git.ts';
import { PostgresConversationStore } from '../src/conversation-postgres.ts';
import { enqueueShadowTurn, PostgresShadowWorkerStore, ShadowAsyncWorker } from '../src/shadow-async-queue.ts';
import type { ShadowAuthorizationReceipt } from '../src/generated/product-knowledge.ts';
import {
  preflightSyntheticShadowActivation,
  runSyntheticShadowActivation,
  SyntheticShadowActivationError,
  syntheticShadowActivationConfig
} from '../src/shadow-activation-harness.ts';
import { runShadowWorkerRecoveryOnce, verifyWorkerLogin } from '../scripts/run-shadow-worker.ts';
import { PostgresShadowEvaluatorDatabase } from '../scripts/run-shadow-evaluator.ts';

const databaseUrl = process.env.TEST_PRODUCT_CONTEXT_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;
const repositoryTmp = resolve(fileURLToPath(new URL('../../../.tmp/', import.meta.url)));
const cli = fileURLToPath(new URL('../scripts/run-shadow-synthetic.ts', import.meta.url));
const viteNode = createRequire(import.meta.url).resolve('vite-node/vite-node.mjs');
const testReceipt: ShadowAuthorizationReceipt = {
  schema_version: '1.0.0', decision: 'allow',
  shadow_principal_ref: `cubica://shadow-principal/v1/${'7'.repeat(64)}`,
  role_scope: 'developer', applies_to: ['cubica://game-project/synthetic-activation'],
  access_policy_ref: 'synthetic-local-activation', access_policy_revision: '1',
  retention_policy_ref: 'synthetic-disposable', retention_policy_revision: '1',
  external_processing_policy_ref: 'synthetic-local-only', external_processing_policy_revision: '1',
  authorization_revision: `sha256:${'8'.repeat(64)}`,
  issued_at: '2020-01-01T00:00:00.000Z', expires_at: '2099-01-01T00:00:00.000Z'
};
const testThreadRef = 'cubica://shadow-thread/synthetic-activation-rehearsal';
const testStableTurnKey = 'synthetic-activation-turn-v1';
const testUserBytes = new TextEncoder().encode('Synthetic user activation rehearsal.');
const testAgentBytes = new TextEncoder().encode('Synthetic agent activation rehearsal.');

describe('synthetic shadow activation configuration', () => {
  it('refuses missing, production, or non-disposable configuration without connecting', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const base = {
      CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL: 'postgres://runtime:secret@localhost/disposable',
      CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_DATABASE_URL: 'postgres://worker:secret@localhost/disposable',
      CUBICA_DEPLOYMENT_TIER: 'test',
      CUBICA_PRODUCT_CONTEXT_SHADOW_KNOWLEDGE_REPOSITORY: join(repositoryTmp, 'synthetic.git')
    };
    expect(() => syntheticShadowActivationConfig({ ...base, CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL: undefined })).toThrow(SyntheticShadowActivationError);
    expect(() => syntheticShadowActivationConfig({ ...base, CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_DATABASE_URL: undefined })).toThrow(SyntheticShadowActivationError);
    expect(() => syntheticShadowActivationConfig({ ...base, CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_DATABASE_URL: base.CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL })).toThrow(SyntheticShadowActivationError);
    expect(() => syntheticShadowActivationConfig({ ...base, CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL: 'postgres://runtime:secret@shadow.invalid/disposable?sslmode=verify-full' })).toThrow(SyntheticShadowActivationError);
    expect(() => syntheticShadowActivationConfig({ ...base, CUBICA_DEPLOYMENT_TIER: 'production' })).toThrow(SyntheticShadowActivationError);
    expect(() => syntheticShadowActivationConfig({ ...base, CUBICA_PRODUCT_CONTEXT_SHADOW_KNOWLEDGE_REPOSITORY: '/tmp/synthetic.git' })).toThrow(SyntheticShadowActivationError);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('does not inspect provider credentials while resolving its fixed configuration', () => {
    const accessed = new Set<string>();
    const env = new Proxy({
      CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL: 'postgres://runtime:secret@localhost/disposable',
      CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_DATABASE_URL: 'postgres://worker:secret@localhost/disposable',
      CUBICA_DEPLOYMENT_TIER: 'test',
      CUBICA_PRODUCT_CONTEXT_SHADOW_KNOWLEDGE_REPOSITORY: join(repositoryTmp, 'synthetic.git')
    } as NodeJS.ProcessEnv, {
      get(target, property, receiver) {
        if (typeof property === 'string') accessed.add(property);
        return Reflect.get(target, property, receiver);
      }
    });
    expect(syntheticShadowActivationConfig(env).environment).toBe('test');
    expect([...accessed]).not.toContain('PKS_KEY');
    expect([...accessed]).not.toContain('TEST_PRODUCT_CONTEXT_DATABASE_URL');
  });

  it('refuses a repository that escapes .tmp through an intermediate symlink before connecting', async () => {
    await mkdir(repositoryTmp, { recursive: true });
    const container = await mkdtemp(join(repositoryTmp, 'shadow-activation-link-'));
    const outside = resolve(repositoryTmp, '..');
    const linkedParent = join(container, 'linked');
    const linked = join(linkedParent, '.git');
    await symlink(outside, linkedParent, 'dir');
    try {
      const config = syntheticShadowActivationConfig({
        CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL: 'postgres://runtime:secret@localhost/disposable',
        CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_DATABASE_URL: 'postgres://worker:secret@localhost/disposable',
        CUBICA_DEPLOYMENT_TIER: 'test',
        CUBICA_PRODUCT_CONTEXT_SHADOW_KNOWLEDGE_REPOSITORY: linked
      });
      await expect(preflightSyntheticShadowActivation(config)).rejects.toBeInstanceOf(SyntheticShadowActivationError);
    } finally {
      await rm(container, { recursive: true, force: true });
    }
  });

  it('keeps refusal output neutral and requires both local-only flags', () => {
    const secret = 'must-not-appear-secret';
    const result = spawnSync(viteNode, [cli, 'run', '--synthetic-only'], {
      encoding: 'utf8', shell: false,
      env: { ...process.env, CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL: `postgres://runtime:${secret}@localhost/disposable`, PKS_KEY: secret }
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('Synthetic shadow activation rehearsal was refused.\n');
    expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
  });
});

integration('synthetic shadow activation against prepared PostgreSQL', () => {
  let adminPool: Pool;
  let runtimeRole = '';
  let runtimePassword = '';
  let runtimeUrl = '';
  let workerRole = '';
  let workerPassword = '';
  let workerUrl = '';
  let appRuntimePool: Pool;
  let workerRuntimePool: Pool;
  let repositoryRoot = '';
  let repository = '';
  let migrationCompatibility: unknown;
  let cleanupUpgradeCompatibility: unknown;
  let legacyWorkerUpgradeCompatibility: unknown;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: databaseUrl, max: 4 });
    runtimeRole = `shadow_activation_${process.pid}_${randomBytes(4).toString('hex')}`;
    workerRole = `shadow_worker_${process.pid}_${randomBytes(4).toString('hex')}`;
    runtimePassword = randomBytes(24).toString('base64url');
    workerPassword = randomBytes(24).toString('base64url');
    await adminPool.query(`DO $block$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'product_context_shadow_app') THEN CREATE ROLE product_context_shadow_app NOLOGIN; END IF; END $block$`);
    await adminPool.query(`CREATE ROLE ${quoteIdentifier(runtimeRole)} LOGIN PASSWORD ${quoteLiteral(runtimePassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
    await adminPool.query(`CREATE ROLE ${quoteIdentifier(workerRole)} LOGIN PASSWORD ${quoteLiteral(workerPassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
    await adminPool.query('DROP SCHEMA IF EXISTS product_context_shadow CASCADE');
    const baseMigration = await readFile(fileURLToPath(new URL('../migrations/002_product_context_shadow.sql', import.meta.url)), 'utf8');
    const queueMigration = await readFile(fileURLToPath(new URL('../migrations/003_product_context_async_shadow_queue.sql', import.meta.url)), 'utf8');
    await adminPool.query(baseMigration);
    await adminPool.query(`GRANT product_context_shadow_app TO ${quoteIdentifier(runtimeRole)}`);
    const url = new URL(databaseUrl!);
    url.username = runtimeRole; url.password = runtimePassword;
    runtimeUrl = url.toString();
    appRuntimePool = new Pool({ connectionString: runtimeUrl, max: 4 });
    const executor = String((await adminPool.query('SELECT current_user')).rows[0].current_user);
    const cleanupBoundary = async () => ({
      memberships: (await adminPool.query(`SELECT grantor_role.rolname AS grantor,
          membership.admin_option, membership.inherit_option, membership.set_option
        FROM pg_auth_members AS membership
        JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
        JOIN pg_roles AS member_role ON member_role.oid = membership.member
        JOIN pg_roles AS grantor_role ON grantor_role.oid = membership.grantor
        WHERE granted_role.rolname = 'product_context_shadow_cleanup'
          AND member_role.rolname = $1 ORDER BY grantor_role.rolname`, [executor])).rows,
      schemaCreate: Boolean((await adminPool.query(`SELECT has_schema_privilege(
        'product_context_shadow_cleanup', 'product_context_shadow', 'CREATE') AS value`)).rows[0].value)
    });
    const cleanupBefore = await cleanupBoundary();
    expect(String((await adminPool.query(`SELECT pg_get_functiondef(
      'product_context_shadow.cleanup_expired(integer)'::regprocedure) AS definition`)).rows[0].definition))
      .not.toContain("status IN ('succeeded', 'denied', 'failed', 'blocked')");
    const legacyStore = new PostgresConversationStore(appRuntimePool);
    const legacyInput = (suffix: string) => ({
      receipt: testReceipt, threadRef: `${testThreadRef}-${suffix}`, stableTurnKey: `${testStableTurnKey}-${suffix}`,
      userBytes: testUserBytes, agentBytes: testAgentBytes, retainedUntil: new Date('2098-01-01T00:00:00.000Z'),
      now: new Date('2026-08-12T00:00:00.000Z')
    });
    const pending = await enqueueShadowTurn(legacyStore, legacyInput('pending'));
    const calling = await enqueueShadowTurn(legacyStore, legacyInput('calling'));
    await legacyStore.claimRun(testReceipt.shadow_principal_ref, calling.runId, 'modelreq_legacy_calling', 60_000, new Date('2026-08-12T00:00:01.000Z'));
    const terminal = await enqueueShadowTurn(legacyStore, legacyInput('terminal'));
    await legacyStore.failRun(testReceipt.shadow_principal_ref, terminal.runId, 'gateway_error', {
      schema_version: '1.0.0', metric_id: 'metric_legacy_terminal', run_id: terminal.runId,
      request_id: null, outcome: 'gateway_error',
      duration_ms: 0, input_bytes: 0, output_bytes: 0, proposal_operation_count: 0,
      authorization_revision: testReceipt.authorization_revision,
      external_processing_policy_ref: testReceipt.external_processing_policy_ref,
      external_processing_policy_revision: testReceipt.external_processing_policy_revision,
      recorded_at: '2026-08-12T00:00:02.000Z'
    }, new Date('2026-08-12T00:00:02.000Z'));
    const executorOwnsLegacyWorker = String((await adminPool.query('SELECT current_user')).rows[0].current_user);
    await adminPool.query(`CREATE ROLE product_context_shadow_worker NOLOGIN;
      CREATE ROLE product_context_shadow_worker_owner NOLOGIN;
      CREATE OR REPLACE FUNCTION product_context_shadow.worker_mark_calling(
        p_run_id text, p_lease_token text, p_request_id text, p_call_lease_ms integer, p_now timestamptz
      ) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, product_context_shadow
      AS $$
      BEGIN
        IF p_call_lease_ms IS NULL OR p_call_lease_ms < 1 OR p_call_lease_ms > 120000 OR p_now IS NULL THEN
          RAISE EXCEPTION 'invalid call lease' USING ERRCODE = '22023';
        END IF;
        UPDATE product_context_shadow.shadow_runs
        SET status = 'calling_model', request_id = p_request_id, started_at = p_now,
            lease_expires_at = p_now + make_interval(secs => p_call_lease_ms::double precision / 1000),
            updated_at = p_now
        WHERE run_id = p_run_id AND lease_token = p_lease_token AND status = 'leased'
          AND lease_expires_at > p_now;
        RETURN FOUND;
      END
      $$;
      REVOKE ALL ON FUNCTION product_context_shadow.worker_mark_calling(text,text,text,integer,timestamptz) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION product_context_shadow.worker_mark_calling(text,text,text,integer,timestamptz)
        TO product_context_shadow_worker`);
    await adminPool.query(`ALTER FUNCTION product_context_shadow.worker_mark_calling(text,text,text,integer,timestamptz)
      OWNER TO product_context_shadow_worker_owner`);
    expect(executorOwnsLegacyWorker).not.toBe('product_context_shadow_worker_owner');
    expect(Boolean((await adminPool.query(`SELECT has_function_privilege('product_context_shadow_worker',
      'product_context_shadow.worker_mark_calling(text,text,text,integer,timestamptz)', 'EXECUTE') AS value`)).rows[0].value)).toBe(true);
    for (const statement of splitSqlStatements(queueMigration)) await adminPool.query(statement);
    legacyWorkerUpgradeCompatibility = {
      legacyAbsent: (await adminPool.query(`SELECT to_regprocedure(
        'product_context_shadow.worker_mark_calling(text,text,text,integer,timestamptz)') AS value`)).rows[0].value === null,
      catalog: (await adminPool.query(`SELECT proname, pg_get_function_identity_arguments(fn.oid) AS args
        FROM pg_proc AS fn JOIN pg_namespace AS namespace ON namespace.oid = fn.pronamespace
        WHERE namespace.nspname = 'product_context_shadow' AND fn.proname LIKE 'worker_%'
        ORDER BY proname`)).rows
    };
    cleanupUpgradeCompatibility = {
      before: cleanupBefore,
      after: await cleanupBoundary(),
      upgraded: String((await adminPool.query(`SELECT pg_get_functiondef(
        'product_context_shadow.cleanup_expired(integer)'::regprocedure) AS definition`)).rows[0].definition)
        .includes("status = ANY (ARRAY['succeeded'::text, 'denied'::text, 'failed'::text, 'blocked'::text])") ||
        String((await adminPool.query(`SELECT pg_get_functiondef(
          'product_context_shadow.cleanup_expired(integer)'::regprocedure) AS definition`)).rows[0].definition)
          .includes("status IN ('succeeded', 'denied', 'failed', 'blocked')")
    };
    migrationCompatibility = (await adminPool.query(`
      SELECT run_id, status, attempts, lease_token IS NOT NULL AS fenced
      FROM product_context_shadow.shadow_runs ORDER BY run_id
    `)).rows;
    expect((await adminPool.query(`SELECT attempt_number FROM product_context_shadow.shadow_metrics
      WHERE run_id = $1`, [terminal.runId])).rows).toEqual([{ attempt_number: 1 }]);
    expect(migrationCompatibility).toEqual(expect.arrayContaining([
      expect.objectContaining({ run_id: pending.runId, status: 'pending', attempts: 0, fenced: false }),
      expect.objectContaining({ run_id: calling.runId, status: 'calling_model', attempts: 1, fenced: true }),
      expect.objectContaining({ run_id: terminal.runId, status: 'failed', attempts: 0, fenced: false })
    ]));
    await adminPool.query(`GRANT product_context_shadow_worker TO ${quoteIdentifier(workerRole)}`);
    url.username = workerRole; url.password = workerPassword;
    workerUrl = url.toString();
    workerRuntimePool = new Pool({ connectionString: workerUrl, max: 4 });

    await mkdir(repositoryTmp, { recursive: true });
    repositoryRoot = await mkdtemp(join(repositoryTmp, 'shadow-activation-'));
    repository = join(repositoryRoot, 'knowledge.git');
    const git = await ManagedKnowledgeGit.init(repository);
    await git.close();
  });

  beforeEach(async () => {
    await adminPool.query(`TRUNCATE product_context_shadow.shadow_metrics, product_context_shadow.shadow_runs,
      product_context_shadow.conversation_messages, product_context_shadow.conversation_threads`);
  });

  afterAll(async () => {
    await appRuntimePool?.end();
    await workerRuntimePool?.end();
    if (adminPool && runtimeRole) {
      await adminPool.query(`REVOKE product_context_shadow_app FROM ${quoteIdentifier(runtimeRole)}`);
      await adminPool.query(`DROP ROLE IF EXISTS ${quoteIdentifier(runtimeRole)}`);
    }
    if (adminPool && workerRole) {
      await adminPool.query(`REVOKE product_context_shadow_worker FROM ${quoteIdentifier(workerRole)}`);
      await adminPool.query(`DROP ROLE IF EXISTS ${quoteIdentifier(workerRole)}`);
    }
    await adminPool?.end();
    if (repositoryRoot) await rm(repositoryRoot, { recursive: true, force: true });
  });

  it('preflights the runtime login and stores exactly the fixed bytes once', async () => {
    const config = syntheticShadowActivationConfig(environment());
    await expect(preflightSyntheticShadowActivation(config)).resolves.toEqual({ ready: true });
    const reader = await ReadOnlyKnowledgeGit.open(repository);
    const before = reader.head(); await reader.close();
    const result = await runSyntheticShadowActivation(config);
    expect(result).toEqual({
      ready: true, outcome: 'no_change', firstDuplicate: false, retryDuplicate: true,
      gatewayCalls: 1, gitUnchanged: true
    });
    const messages = await adminPool.query<{ actor: string; content: Buffer }>(`
      SELECT actor, content_bytes AS content FROM product_context_shadow.conversation_messages ORDER BY sequence
    `);
    expect(messages.rows.map((row) => [row.actor, row.content.toString('utf8')])).toEqual([
      ['user', 'Synthetic user activation rehearsal.'],
      ['agent', 'Synthetic agent activation rehearsal.']
    ]);
    expect((await adminPool.query('SELECT count(*)::int AS count FROM product_context_shadow.shadow_runs')).rows[0].count).toBe(1);
    expect((await adminPool.query('SELECT count(*)::int AS count FROM product_context_shadow.shadow_metrics')).rows[0].count).toBe(1);
    const afterReader = await ReadOnlyKnowledgeGit.open(repository);
    expect(afterReader.head()).toBe(before); await afterReader.close();
  });

  it('rolls back thread and exact messages when atomic enqueue cannot create its run', async () => {
    await adminPool.query(`CREATE OR REPLACE FUNCTION product_context_shadow.test_reject_atomic_run()
      RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.stable_turn_key = '${testStableTurnKey}-atomic-rollback' THEN
          RAISE EXCEPTION 'injected run constraint failure' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER test_reject_atomic_run BEFORE INSERT ON product_context_shadow.shadow_runs
      FOR EACH ROW EXECUTE FUNCTION product_context_shadow.test_reject_atomic_run()`);
    try {
      await expect(enqueueQueue('atomic-rollback')).rejects.toMatchObject({ code: '23514' });
      const counts = await adminPool.query(`SELECT
        (SELECT count(*)::int FROM product_context_shadow.conversation_threads WHERE thread_ref = $1) AS threads,
        (SELECT count(*)::int FROM product_context_shadow.conversation_messages WHERE stable_turn_key = $2) AS messages,
        (SELECT count(*)::int FROM product_context_shadow.shadow_runs WHERE stable_turn_key = $2) AS runs`,
      [`${testThreadRef}-atomic-rollback`, `${testStableTurnKey}-atomic-rollback`]);
      expect(counts.rows[0]).toEqual({ threads: 0, messages: 0, runs: 0 });
    } finally {
      await adminPool.query(`DROP TRIGGER test_reject_atomic_run ON product_context_shadow.shadow_runs;
        DROP FUNCTION product_context_shadow.test_reject_atomic_run()`);
    }
  });

  it('migrates legacy pending, calling, and terminal rows without losing their state', () => {
    expect(migrationCompatibility).toHaveLength(3);
  });

  it('removes the old 003 mark-calling bypass and leaves exactly the six current worker signatures', () => {
    expect(legacyWorkerUpgradeCompatibility).toMatchObject({ legacyAbsent: true });
    expect((legacyWorkerUpgradeCompatibility as { catalog: unknown[] }).catalog).toHaveLength(6);
  });

  it('upgrades the legacy cleanup function in 003 and restores cleanup membership and schema CREATE exactly', async () => {
    expect(cleanupUpgradeCompatibility).toMatchObject({ upgraded: true });
    expect((cleanupUpgradeCompatibility as { before: unknown }).before)
      .toEqual((cleanupUpgradeCompatibility as { after: unknown }).after);
    const run = await enqueueShadowTurn(new PostgresConversationStore(appRuntimePool), {
      receipt: testReceipt, threadRef: `${testThreadRef}-cleanup-upgrade-pending`,
      stableTurnKey: `${testStableTurnKey}-cleanup-upgrade-pending`, userBytes: testUserBytes,
      agentBytes: testAgentBytes, now: new Date(), retainedUntil: new Date(Date.now() + 100)
    });
    await adminPool.query('SELECT pg_sleep(0.15)');
    const cleanup = await new PostgresConversationStore(appRuntimePool).cleanupExpired(100);
    expect(cleanup.runsDeleted).toBe(0);
    expect((await adminPool.query(`SELECT status FROM product_context_shadow.shadow_runs WHERE run_id = $1`, [run.runId])).rows)
      .toEqual([{ status: 'pending' }]);
  });

  it('gives the worker only the six fenced functions and no table or inherited application authority', async () => {
    const catalog = await adminPool.query<{ direct_tables: number; functions: number; public_functions: number; forbidden_memberships: number; app_can_update_runs: boolean }>(`
      SELECT
        (SELECT count(*)::int FROM information_schema.role_table_grants
          WHERE grantee = 'product_context_shadow_worker' AND table_schema = 'product_context_shadow') AS direct_tables,
        (SELECT count(*)::int FROM pg_proc AS fn JOIN pg_namespace AS namespace ON namespace.oid = fn.pronamespace
          WHERE namespace.nspname = 'product_context_shadow' AND fn.proname LIKE 'worker_%'
            AND fn.prosecdef AND fn.proconfig @> ARRAY['search_path=pg_catalog, product_context_shadow']
            AND pg_get_userbyid(fn.proowner) = 'product_context_shadow_worker_owner'
            AND has_function_privilege('product_context_shadow_worker', fn.oid, 'EXECUTE')) AS functions,
        (SELECT count(*)::int FROM information_schema.routine_privileges
          WHERE routine_schema = 'product_context_shadow' AND routine_name LIKE 'worker_%'
            AND grantee = 'PUBLIC' AND privilege_type = 'EXECUTE') AS public_functions,
        (SELECT count(*)::int FROM pg_auth_members AS membership
          JOIN pg_roles AS granted ON granted.oid = membership.roleid
          JOIN pg_roles AS member ON member.oid = membership.member
          WHERE member.rolname = 'product_context_shadow_worker'
            AND granted.rolname <> 'product_context_shadow_worker') AS forbidden_memberships,
        has_table_privilege('product_context_shadow_app', 'product_context_shadow.shadow_runs', 'UPDATE') AS app_can_update_runs
    `);
    expect(catalog.rows[0]).toEqual({ direct_tables: 0, functions: 6, public_functions: 0, forbidden_memberships: 0, app_can_update_runs: false });
  });

  it('rejects a shared session login even when startup role looks like the worker', async () => {
    const sharedRole = `shadow_shared_${process.pid}_${randomBytes(4).toString('hex')}`;
    const password = randomBytes(24).toString('base64url');
    await adminPool.query(`CREATE ROLE ${quoteIdentifier(sharedRole)} LOGIN PASSWORD ${quoteLiteral(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
    await adminPool.query(`GRANT product_context_shadow_worker, product_context_shadow_app TO ${quoteIdentifier(sharedRole)}`);
    const url = new URL(databaseUrl!); url.username = sharedRole; url.password = password;
    url.searchParams.set('options', '-c role=product_context_shadow_worker');
    const sharedPool = new Pool({ connectionString: url.toString(), max: 1 });
    try {
      await expect(verifyWorkerLogin(sharedPool)).rejects.toThrow('Dedicated shadow worker login');
    } finally {
      await sharedPool.end();
      await adminPool.query(`REVOKE product_context_shadow_worker, product_context_shadow_app FROM ${quoteIdentifier(sharedRole)}`);
      await adminPool.query(`DROP ROLE ${quoteIdentifier(sharedRole)}`);
    }
  });

  it('rejects wrapper-role alternatives for both dedicated worker and evaluator app logins', async () => {
    const workerWrapper = `shadow_worker_wrapper_${process.pid}_${randomBytes(4).toString('hex')}`;
    const workerLogin = `shadow_worker_wrapped_${process.pid}_${randomBytes(4).toString('hex')}`;
    const appWrapper = `shadow_app_wrapper_${process.pid}_${randomBytes(4).toString('hex')}`;
    const appLogin = `shadow_app_wrapped_${process.pid}_${randomBytes(4).toString('hex')}`;
    const password = randomBytes(24).toString('base64url');
    await adminPool.query(`CREATE ROLE ${quoteIdentifier(workerWrapper)} NOLOGIN;
      CREATE ROLE ${quoteIdentifier(workerLogin)} LOGIN PASSWORD ${quoteLiteral(password)} NOINHERIT;
      CREATE ROLE ${quoteIdentifier(appWrapper)} NOLOGIN;
      CREATE ROLE ${quoteIdentifier(appLogin)} LOGIN PASSWORD ${quoteLiteral(password)} NOINHERIT;
      GRANT product_context_shadow_worker TO ${quoteIdentifier(workerWrapper)};
      GRANT ${quoteIdentifier(workerWrapper)} TO ${quoteIdentifier(workerLogin)};
      GRANT product_context_shadow_app TO ${quoteIdentifier(appWrapper)};
      GRANT ${quoteIdentifier(appWrapper)} TO ${quoteIdentifier(appLogin)}`);
    const url = new URL(databaseUrl!);
    try {
      url.username = workerLogin; url.password = password;
      const wrappedWorker = new Pool({ connectionString: url.toString(), max: 1 });
      try { await expect(verifyWorkerLogin(wrappedWorker)).rejects.toThrow('Dedicated shadow worker login'); }
      finally { await wrappedWorker.end(); }
      url.username = appLogin;
      const wrappedApp = new Pool({ connectionString: url.toString(), max: 1 });
      try {
        const evaluator = new PostgresShadowEvaluatorDatabase(wrappedApp, testReceipt.shadow_principal_ref, testReceipt.applies_to[0]!);
        await expect(evaluator.inspect()).rejects.toThrow('Dedicated shadow app login');
      } finally { await wrappedApp.end(); }
    } finally {
      await adminPool.query(`DROP ROLE ${quoteIdentifier(workerLogin)};
        DROP ROLE ${quoteIdentifier(workerWrapper)};
        DROP ROLE ${quoteIdentifier(appLogin)};
        DROP ROLE ${quoteIdentifier(appWrapper)}`);
    }
  });

  it('preserves exact PostgreSQL 17 worker-owner membership options across autocommit reruns', async () => {
    const executor = String((await adminPool.query('SELECT current_user')).rows[0].current_user);
    const migration = await readFile(fileURLToPath(new URL('../migrations/003_product_context_async_shadow_queue.sql', import.meta.url)), 'utf8');
    const memberships = async () => (await adminPool.query(`
      SELECT grantor_role.rolname AS grantor, membership.admin_option,
             membership.inherit_option, membership.set_option
      FROM pg_auth_members AS membership
      JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
      JOIN pg_roles AS member_role ON member_role.oid = membership.member
      JOIN pg_roles AS grantor_role ON grantor_role.oid = membership.grantor
      WHERE granted_role.rolname = 'product_context_shadow_worker_owner'
        AND member_role.rolname = $1 ORDER BY grantor_role.rolname
    `, [executor])).rows;
    await adminPool.query(`GRANT product_context_shadow_worker_owner TO ${quoteIdentifier(executor)}
      WITH ADMIN FALSE, INHERIT FALSE, SET FALSE GRANTED BY ${quoteIdentifier(executor)}`);
    try {
      const before = await memberships();
      for (const statement of splitSqlStatements(migration)) await adminPool.query(statement);
      for (const statement of splitSqlStatements(migration)) await adminPool.query(statement);
      expect(await memberships()).toEqual(before);
    } finally {
      await adminPool.query(`REVOKE product_context_shadow_worker_owner FROM ${quoteIdentifier(executor)} GRANTED BY ${quoteIdentifier(executor)}`);
    }
  });

  it('fails before widening privileges when a foreign worker-owner member already exists', async () => {
    const foreignMember = `shadow_worker_foreign_${process.pid}_${randomBytes(4).toString('hex')}`;
    const migration = await readFile(fileURLToPath(new URL('../migrations/003_product_context_async_shadow_queue.sql', import.meta.url)), 'utf8');
    const statements = splitSqlStatements(migration);
    const guardIndex = statements.findIndex((statement) => statement.includes('DO $worker_membership_guard$'));
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    await adminPool.query(`CREATE ROLE ${quoteIdentifier(foreignMember)} NOLOGIN`);
    await adminPool.query(`GRANT product_context_shadow_worker_owner TO ${quoteIdentifier(foreignMember)}`);
    const snapshot = async () => (await adminPool.query(`
      SELECT
        (SELECT count(*)::int FROM pg_auth_members AS membership
          JOIN pg_roles AS granted ON granted.oid = membership.roleid
          JOIN pg_roles AS member ON member.oid = membership.member
          WHERE granted.rolname = 'product_context_shadow_worker_owner'
            AND member.rolname = $1) AS foreign_memberships,
        has_schema_privilege('product_context_shadow_worker_owner', 'product_context_shadow', 'CREATE') AS owner_schema_create,
        (SELECT count(*)::int FROM information_schema.role_table_grants
          WHERE grantee = 'product_context_shadow_worker' AND table_schema = 'product_context_shadow') AS exposed_worker_tables,
        (SELECT count(*)::int FROM information_schema.routine_privileges
          WHERE grantee = 'product_context_shadow_worker' AND routine_schema = 'product_context_shadow'
            AND routine_name LIKE 'worker_%' AND privilege_type = 'EXECUTE') AS worker_functions
    `, [foreignMember])).rows[0];
    try {
      const before = await snapshot();
      for (const statement of statements.slice(0, guardIndex)) await adminPool.query(statement);
      await expect(adminPool.query(statements[guardIndex]!)).rejects.toMatchObject({ code: '42501' });
      expect(await snapshot()).toEqual(before);
    } finally {
      await adminPool.query(`REVOKE product_context_shadow_worker_owner FROM ${quoteIdentifier(foreignMember)}`);
      await adminPool.query(`DROP ROLE ${quoteIdentifier(foreignMember)}`);
    }
  });

  it('fails before widening privileges when the fixed worker is itself a member of any role', async () => {
    const wrapper = `shadow_worker_forbidden_parent_${process.pid}_${randomBytes(4).toString('hex')}`;
    const migration = await readFile(fileURLToPath(new URL('../migrations/003_product_context_async_shadow_queue.sql', import.meta.url)), 'utf8');
    const guard = splitSqlStatements(migration).find((statement) => statement.includes('DO $worker_membership_guard$'))!;
    await adminPool.query(`CREATE ROLE ${quoteIdentifier(wrapper)} NOLOGIN`);
    await adminPool.query(`GRANT ${quoteIdentifier(wrapper)} TO product_context_shadow_worker`);
    try { await expect(adminPool.query(guard)).rejects.toMatchObject({ code: '42501' }); }
    finally {
      await adminPool.query(`REVOKE ${quoteIdentifier(wrapper)} FROM product_context_shadow_worker`);
      await adminPool.query(`DROP ROLE ${quoteIdentifier(wrapper)}`);
    }
  });

  it('fails closed before upgrading cleanup when a foreign cleanup member exists', async () => {
    const foreign = `shadow_cleanup_foreign_${process.pid}_${randomBytes(4).toString('hex')}`;
    const migration = await readFile(fileURLToPath(new URL('../migrations/003_product_context_async_shadow_queue.sql', import.meta.url)), 'utf8');
    const guard = splitSqlStatements(migration).find((statement) => statement.includes('DO $cleanup_membership_guard$'))!;
    await adminPool.query(`CREATE ROLE ${quoteIdentifier(foreign)} NOLOGIN`);
    await adminPool.query(`GRANT product_context_shadow_cleanup TO ${quoteIdentifier(foreign)}`);
    try { await expect(adminPool.query(guard)).rejects.toMatchObject({ code: '42501' }); }
    finally {
      await adminPool.query(`REVOKE product_context_shadow_cleanup FROM ${quoteIdentifier(foreign)}`);
      await adminPool.query(`DROP ROLE ${quoteIdentifier(foreign)}`);
    }
  });

  it('fails closed when a foreign grantor gives cleanup membership to the migration executor', async () => {
    const executor = String((await adminPool.query('SELECT current_user')).rows[0].current_user);
    const grantor = `shadow_cleanup_grantor_${process.pid}_${randomBytes(4).toString('hex')}`;
    const migration = await readFile(fileURLToPath(new URL('../migrations/003_product_context_async_shadow_queue.sql', import.meta.url)), 'utf8');
    const guard = splitSqlStatements(migration).find((statement) => statement.includes('DO $cleanup_membership_guard$'))!;
    await adminPool.query(`CREATE ROLE ${quoteIdentifier(grantor)} NOLOGIN`);
    await adminPool.query(`GRANT product_context_shadow_cleanup TO ${quoteIdentifier(grantor)} WITH ADMIN OPTION`);
    await adminPool.query(`GRANT product_context_shadow_cleanup TO ${quoteIdentifier(executor)}
      WITH ADMIN FALSE, INHERIT FALSE, SET FALSE GRANTED BY ${quoteIdentifier(grantor)}`);
    const snapshot = async () => ({
      memberships: (await adminPool.query(`SELECT grantor_role.rolname AS grantor,
          membership.admin_option, membership.inherit_option, membership.set_option
        FROM pg_auth_members AS membership
        JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
        JOIN pg_roles AS member_role ON member_role.oid = membership.member
        JOIN pg_roles AS grantor_role ON grantor_role.oid = membership.grantor
        WHERE granted_role.rolname = 'product_context_shadow_cleanup'
          AND member_role.rolname = $1 ORDER BY grantor_role.rolname`, [executor])).rows,
      schemaCreate: Boolean((await adminPool.query(`SELECT has_schema_privilege(
        'product_context_shadow_cleanup', 'product_context_shadow', 'CREATE') AS value`)).rows[0].value),
      definition: String((await adminPool.query(`SELECT pg_get_functiondef(
        'product_context_shadow.cleanup_expired(integer)'::regprocedure) AS value`)).rows[0].value)
    });
    try {
      const before = await snapshot();
      await expect(adminPool.query(guard)).rejects.toMatchObject({ code: '42501' });
      expect(await snapshot()).toEqual(before);
    } finally {
      await adminPool.query(`REVOKE product_context_shadow_cleanup FROM ${quoteIdentifier(executor)} GRANTED BY ${quoteIdentifier(grantor)}`);
      await adminPool.query(`REVOKE product_context_shadow_cleanup FROM ${quoteIdentifier(grantor)}`);
      await adminPool.query(`DROP ROLE ${quoteIdentifier(grantor)}`);
    }
  });

  it('fails closed when the fixed app role can SET ROLE to any parent role', async () => {
    const parent = `shadow_app_parent_${process.pid}_${randomBytes(4).toString('hex')}`;
    const migration = await readFile(fileURLToPath(new URL('../migrations/003_product_context_async_shadow_queue.sql', import.meta.url)), 'utf8');
    const guard = splitSqlStatements(migration).find((statement) => statement.includes('DO $cleanup_membership_guard$'))!;
    await adminPool.query(`CREATE ROLE ${quoteIdentifier(parent)} NOLOGIN`);
    await adminPool.query(`GRANT ${quoteIdentifier(parent)} TO product_context_shadow_app`);
    const before = {
      membership: Boolean((await adminPool.query(`SELECT pg_has_role(
        'product_context_shadow_app', $1, 'MEMBER') AS value`, [parent])).rows[0].value),
      schemaCreate: Boolean((await adminPool.query(`SELECT has_schema_privilege(
        'product_context_shadow_cleanup', 'product_context_shadow', 'CREATE') AS value`)).rows[0].value)
    };
    try {
      expect(before.membership).toBe(true);
      await expect(adminPool.query(guard)).rejects.toMatchObject({ code: '42501' });
      expect({
        membership: Boolean((await adminPool.query(`SELECT pg_has_role(
          'product_context_shadow_app', $1, 'MEMBER') AS value`, [parent])).rows[0].value),
        schemaCreate: Boolean((await adminPool.query(`SELECT has_schema_privilege(
          'product_context_shadow_cleanup', 'product_context_shadow', 'CREATE') AS value`)).rows[0].value)
      }).toEqual(before);
    } finally {
      await adminPool.query(`REVOKE ${quoteIdentifier(parent)} FROM product_context_shadow_app`);
      await adminPool.query(`DROP ROLE ${quoteIdentifier(parent)}`);
    }
  });

  it('rolls back cleanup owner membership and schema CREATE when its 003 upgrade statement fails', async () => {
    const executor = String((await adminPool.query('SELECT current_user')).rows[0].current_user);
    const migration = await readFile(fileURLToPath(new URL('../migrations/003_product_context_async_shadow_queue.sql', import.meta.url)), 'utf8');
    const upgrade = splitSqlStatements(migration).find((statement) => statement.includes('DO $cleanup_owner_upgrade$'))!;
    const snapshot = async () => ({
      memberships: (await adminPool.query(`SELECT grantor_role.rolname AS grantor,
          membership.admin_option, membership.inherit_option, membership.set_option
        FROM pg_auth_members AS membership
        JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
        JOIN pg_roles AS member_role ON member_role.oid = membership.member
        JOIN pg_roles AS grantor_role ON grantor_role.oid = membership.grantor
        WHERE granted_role.rolname = 'product_context_shadow_cleanup'
          AND member_role.rolname = $1 ORDER BY grantor_role.rolname`, [executor])).rows,
      schemaCreate: Boolean((await adminPool.query(`SELECT has_schema_privilege(
        'product_context_shadow_cleanup', 'product_context_shadow', 'CREATE') AS value`)).rows[0].value)
    });
    const before = await snapshot();
    const failing = upgrade.replace(
      "  EXECUTE 'RESET ROLE';",
      "  RAISE EXCEPTION 'simulated cleanup upgrade failure';\n  EXECUTE 'RESET ROLE';"
    );
    await expect(adminPool.query(failing)).rejects.toThrow(/simulated cleanup upgrade failure/u);
    expect(await snapshot()).toEqual(before);
  });

  it('scrubs every pre-existing unintended function grantee before restoring the exact ACL', async () => {
    const migration = await readFile(fileURLToPath(new URL('../migrations/003_product_context_async_shadow_queue.sql', import.meta.url)), 'utf8');
    const foreign = `shadow_acl_foreign_${process.pid}_${randomBytes(4).toString('hex')}`;
    await adminPool.query(`CREATE ROLE ${quoteIdentifier(foreign)} NOLOGIN`);
    await adminPool.query(`GRANT CREATE ON SCHEMA product_context_shadow TO product_context_shadow_worker;
      GRANT EXECUTE ON FUNCTION product_context_shadow.cleanup_expired(integer) TO product_context_shadow_worker;
      GRANT EXECUTE ON FUNCTION product_context_shadow.enforce_thread_contract() TO product_context_shadow_worker;
      GRANT EXECUTE ON FUNCTION product_context_shadow.worker_claim(integer,integer,timestamptz,text,text,text) TO product_context_shadow_app;
      GRANT EXECUTE ON FUNCTION product_context_shadow.cleanup_expired(integer) TO ${quoteIdentifier(foreign)}`);
    try {
      for (const statement of splitSqlStatements(migration)) await adminPool.query(statement);
      const schema = await adminPool.query(`SELECT
        has_schema_privilege('product_context_shadow_worker', 'product_context_shadow', 'USAGE') AS usage,
        has_schema_privilege('product_context_shadow_worker', 'product_context_shadow', 'CREATE') AS create`);
      const functions = await adminPool.query(`SELECT routine_name FROM information_schema.routine_privileges
        WHERE grantee = 'product_context_shadow_worker' AND routine_schema = 'product_context_shadow'
        ORDER BY routine_name`);
      expect(schema.rows).toEqual([{ usage: true, create: false }]);
      expect(functions.rows.map((row) => row.routine_name)).toEqual([
        'worker_claim', 'worker_complete', 'worker_prepare_call',
        'worker_reread', 'worker_retry', 'worker_terminal'
      ]);
      expect((await adminPool.query(`SELECT
        has_function_privilege('product_context_shadow_app',
          'product_context_shadow.worker_claim(integer,integer,timestamptz,text,text,text)', 'EXECUTE') AS app_worker,
        has_function_privilege($1,
          'product_context_shadow.cleanup_expired(integer)', 'EXECUTE') AS foreign_cleanup,
        has_function_privilege('product_context_shadow_worker',
          'product_context_shadow.cleanup_expired(integer)', 'EXECUTE') AS worker_cleanup,
        has_function_privilege('product_context_shadow_cleanup',
          'product_context_shadow.cleanup_expired(integer)', 'EXECUTE') AS owner_cleanup`, [foreign])).rows[0])
        .toEqual({ app_worker: false, foreign_cleanup: false, worker_cleanup: false, owner_cleanup: true });
    } finally {
      await adminPool.query(`DROP ROLE ${quoteIdentifier(foreign)}`);
    }
  });

  it('rolls back temporary worker-owner membership and CREATE if its autocommit statement fails', async () => {
    const executor = String((await adminPool.query('SELECT current_user')).rows[0].current_user);
    const migration = await readFile(fileURLToPath(new URL('../migrations/003_product_context_async_shadow_queue.sql', import.meta.url)), 'utf8');
    const ownerStatement = splitSqlStatements(migration).find((statement) => statement.includes('DO $worker_function_owner$'));
    expect(ownerStatement).toBeDefined();
    const snapshot = async () => ({
      member: Boolean((await adminPool.query(`SELECT pg_has_role($1, 'product_context_shadow_worker_owner', 'MEMBER') AS value`, [executor])).rows[0].value),
      schemaCreate: Boolean((await adminPool.query(`SELECT has_schema_privilege('product_context_shadow_worker_owner', 'product_context_shadow', 'CREATE') AS value`)).rows[0].value)
    });
    const before = await snapshot();
    expect(before.schemaCreate).toBe(false);
    const failing = ownerStatement!.replace(
      "  EXECUTE 'RESET ROLE';",
      "  RAISE EXCEPTION 'simulated worker migration failure';\n  EXECUTE 'RESET ROLE';"
    );
    await expect(adminPool.query(failing)).rejects.toThrow(/simulated worker migration failure/u);
    expect(await snapshot()).toEqual(before);
  });

  it('lets only one of two real PostgreSQL workers claim the same queued run', async () => {
    await enqueueQueue('race');
    const first = new PostgresShadowWorkerStore(workerRuntimePool);
    const second = new PostgresShadowWorkerStore(workerRuntimePool);
    const claims = await Promise.all([first.leaseNext(20_000, 3), second.leaseNext(20_000, 3)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.filter((claim) => claim === null)).toHaveLength(1);
  });

  it('keeps long worker payloads canonical through claim, reread, and prepare', async () => {
    const userBytes = new TextEncoder().encode('Long user payload for canonical base64 regression. '.repeat(8));
    const agentBytes = new TextEncoder().encode('Long agent payload for canonical base64 regression. '.repeat(8));
    const userBase64 = Buffer.from(userBytes).toString('base64');
    const agentBase64 = Buffer.from(agentBytes).toString('base64');
    expect(userBase64.length).toBeGreaterThan(76);
    expect(agentBase64.length).toBeGreaterThan(76);
    const now = new Date();
    const stableTurnKey = `${testStableTurnKey}-long-base64`;
    const run = await enqueueShadowTurn(new PostgresConversationStore(appRuntimePool), {
      receipt: testReceipt, threadRef: `${testThreadRef}-long-base64`, stableTurnKey,
      userBytes, agentBytes, now, retainedUntil: new Date(now.getTime() + 60 * 60 * 1_000)
    });
    const store = new PostgresShadowWorkerStore(workerRuntimePool, {
      ownerRef: testReceipt.shadow_principal_ref, gameRef: testReceipt.applies_to[0]!, stableTurnKey
    });
    const assertCanonicalPayload = (turn: NonNullable<Awaited<ReturnType<typeof store.reread>>>) => {
      expect(turn.user_message.content_base64).toBe(userBase64);
      expect(turn.agent_message.content_base64).toBe(agentBase64);
      for (const content of [turn.user_message.content_base64, turn.agent_message.content_base64]) {
        expect(content).not.toBeNull();
        expect(content).not.toMatch(/[\r\n]/u);
        expect(Buffer.from(content!, 'base64').toString('base64')).toBe(content);
      }
    };

    const lease = await store.leaseNext(10_000, 1);
    expect(lease?.run.runId).toBe(run.runId);
    if (!lease) throw new Error('Expected a worker lease for the long Base64 regression.');
    assertCanonicalPayload(lease.turn);

    const reread = await store.reread(lease);
    expect(reread).not.toBeNull();
    if (!reread) throw new Error('Expected the leased turn to be reread.');
    assertCanonicalPayload(reread);

    const prepared = await store.prepareCall(lease, 'modelreq_long_base64', 10_000, new Date());
    assertCanonicalPayload(prepared);
    await expect(store.complete(lease, {
      result: { schema_version: '1.0.0', request_id: 'modelreq_long_base64', outcome: 'no_change', proposal: null },
      inputBytes: userBytes.byteLength + agentBytes.byteLength, outputBytes: 0, durationMs: 1
    }, new Date())).resolves.toBe('completed');
    expect((await adminPool.query(`SELECT status, outcome_code FROM product_context_shadow.shadow_runs WHERE run_id = $1`, [run.runId])).rows[0])
      .toEqual({ status: 'succeeded', outcome_code: 'no_change' });
  });

  it('never sends bytes when an uncommitted concurrent tombstone wins the prepare-call lock', async () => {
    const run = await enqueueQueue('concurrent-tombstone');
    const current = await adminPool.query(`SELECT revision FROM product_context_shadow.conversation_messages
      WHERE message_ref = $1`, [run.userMessageRef]);
    const deletedAt = new Date();
    const revision = `sha256:${createHash('sha256').update('cubica-shadow-message-tombstone/v1\n')
      .update(`${current.rows[0].revision}\n${deletedAt.toISOString()}`).digest('hex')}`;
    const tombstone = await appRuntimePool.connect();
    await tombstone.query('BEGIN');
    await tombstone.query('SET LOCAL ROLE product_context_shadow_app');
    await tombstone.query("SELECT set_config('cubica.shadow_principal_ref', $1, true)", [testReceipt.shadow_principal_ref]);
    await tombstone.query(`UPDATE product_context_shadow.conversation_messages
      SET content_bytes = NULL, tombstone = true, revision = $2, deleted_at = $3, updated_at = $3
      WHERE message_ref = $1`, [run.userMessageRef, revision, deletedAt.toISOString()]);
    let calls = 0;
    const store = new PostgresShadowWorkerStore(workerRuntimePool, {
      ownerRef: testReceipt.shadow_principal_ref, gameRef: testReceipt.applies_to[0]!,
      stableTurnKey: `${testStableTurnKey}-concurrent-tombstone`
    });
    const worker = new ShadowAsyncWorker(store, { current: async () => testReceipt }, async () => ({
      timeoutMs: 1, maxRequestBytes: 1024 * 1024,
      call: async () => { calls += 1; throw new Error('must not be called'); }
    }), { leaseMs: 10_000, authorizationTimeoutMs: 10, retryBaseMs: 1_000, maxAttempts: 1 });
    const running = worker.runOne();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await tombstone.query('COMMIT');
    tombstone.release();
    await expect(running).resolves.toBe('failed');
    expect(calls).toBe(0);
    expect((await adminPool.query(`SELECT status, outcome_code, result_payload FROM product_context_shadow.shadow_runs WHERE run_id = $1`, [run.runId])).rows[0])
      .toEqual({ status: 'failed', outcome_code: 'message_deleted', result_payload: null });
  });

  it('rechecks the prepare-call lease after waiting for thread/message locks', async () => {
    const run = await enqueueQueue('prepare-lock-expiry');
    const store = new PostgresShadowWorkerStore(workerRuntimePool, {
      ownerRef: testReceipt.shadow_principal_ref, gameRef: testReceipt.applies_to[0]!,
      stableTurnKey: `${testStableTurnKey}-prepare-lock-expiry`
    });
    const lease = await store.leaseNext(100, 3);
    const blocker = await adminPool.connect();
    await blocker.query('BEGIN');
    await blocker.query(`SELECT message_ref FROM product_context_shadow.conversation_messages
      WHERE message_ref = $1 FOR UPDATE`, [run.userMessageRef]);
    const preparing = store.prepareCall(lease!, 'modelreq_prepare_lock_expiry', 10_000, new Date('2020-01-01T00:00:00Z'));
    await adminPool.query('SELECT pg_sleep(0.15)');
    await blocker.query('COMMIT'); blocker.release();
    await expect(preparing).rejects.toThrow('lease was lost');
    expect((await adminPool.query(`SELECT status, request_id FROM product_context_shadow.shadow_runs WHERE run_id = $1`, [run.runId])).rows[0])
      .toEqual({ status: 'leased', request_id: null });
  });

  it.each(['retry', 'terminal'] as const)('rechecks the %s lease after waiting for the run lock', async (operation) => {
    const run = await enqueueQueue(`mutator-lock-expiry-${operation}`);
    const store = new PostgresShadowWorkerStore(workerRuntimePool, {
      ownerRef: testReceipt.shadow_principal_ref, gameRef: testReceipt.applies_to[0]!,
      stableTurnKey: `${testStableTurnKey}-mutator-lock-expiry-${operation}`
    });
    const lease = await store.leaseNext(100, 3);
    const blocker = await adminPool.connect();
    await blocker.query('BEGIN');
    await blocker.query(`SELECT run_id FROM product_context_shadow.shadow_runs WHERE run_id = $1 FOR UPDATE`, [run.runId]);
    const mutation = operation === 'retry'
      ? store.retry(lease!, 'zai_1303', new Date(Date.now() + 60_000), null, new Date('2020-01-01T00:00:00Z'))
      : store.terminal(lease!, 'failed', 'gateway_error', 'late_terminal', null, new Date('2020-01-01T00:00:00Z'));
    await adminPool.query('SELECT pg_sleep(0.15)');
    await blocker.query('COMMIT'); blocker.release();
    await expect(mutation).rejects.toThrow('lease was lost');
    expect((await adminPool.query(`SELECT status, outcome_code FROM product_context_shadow.shadow_runs WHERE run_id = $1`, [run.runId])).rows[0])
      .toEqual({ status: 'leased', outcome_code: null });
  });

  it('cannot commit success when cleanup tombstones sources during a real provider call', async () => {
    const created = new Date();
    const run = await enqueueShadowTurn(new PostgresConversationStore(appRuntimePool), {
      receipt: testReceipt, threadRef: `${testThreadRef}-concurrent-cleanup`,
      stableTurnKey: `${testStableTurnKey}-concurrent-cleanup`, userBytes: testUserBytes,
      agentBytes: testAgentBytes, now: created, retainedUntil: new Date(created.getTime() + 200)
    });
    let release!: () => void;
    let entered!: () => void;
    const gatewayEntered = new Promise<void>((resolve) => { entered = resolve; });
    const gatewayRelease = new Promise<void>((resolve) => { release = resolve; });
    const store = new PostgresShadowWorkerStore(workerRuntimePool, {
      ownerRef: testReceipt.shadow_principal_ref, gameRef: testReceipt.applies_to[0]!,
      stableTurnKey: `${testStableTurnKey}-concurrent-cleanup`
    });
    const worker = new ShadowAsyncWorker(store, { current: async () => testReceipt }, async () => ({
      timeoutMs: 1, maxRequestBytes: 1024 * 1024,
      call: async (request) => {
        entered(); await gatewayRelease;
        return { result: { schema_version: '1.0.0', request_id: request.request_id, outcome: 'no_change', proposal: null }, inputBytes: 10, outputBytes: 10, durationMs: 1 };
      }
    }), { leaseMs: 10_000, authorizationTimeoutMs: 10, retryBaseMs: 1_000, maxAttempts: 1 });
    const running = worker.runOne();
    await gatewayEntered;
    await adminPool.query('SELECT pg_sleep(0.25)');
    const cleanup = await new PostgresConversationStore(appRuntimePool).cleanupExpired(100);
    expect(cleanup).toMatchObject({ runsDeleted: 0, messagesTombstoned: 2 });
    release();
    await expect(running).resolves.toBe('failed');
    expect((await adminPool.query(`SELECT status, outcome_code, result_payload FROM product_context_shadow.shadow_runs WHERE run_id = $1`, [run.runId])).rows[0])
      .toEqual({ status: 'failed', outcome_code: 'retention_expired', result_payload: null });
  });

  it('atomically claims only the exact evaluator target even when an earlier hidden run exists', async () => {
    const hiddenReceipt = {
      ...testReceipt,
      shadow_principal_ref: `cubica://shadow-principal/v1/${'9'.repeat(64)}`,
      authorization_revision: `sha256:${'9'.repeat(64)}`
    };
    const now = new Date();
    const hidden = await enqueueShadowTurn(new PostgresConversationStore(appRuntimePool), {
      receipt: hiddenReceipt, threadRef: `${testThreadRef}-hidden`, stableTurnKey: `${testStableTurnKey}-hidden`,
      userBytes: testUserBytes, agentBytes: testAgentBytes, now,
      retainedUntil: new Date(now.getTime() + 60 * 60 * 1_000)
    });
    const target = await enqueueQueue('exact-target', new Date(now.getTime() + 1));
    const store = new PostgresShadowWorkerStore(workerRuntimePool, {
      ownerRef: testReceipt.shadow_principal_ref,
      gameRef: testReceipt.applies_to[0]!,
      stableTurnKey: `${testStableTurnKey}-exact-target`
    });
    const lease = await store.leaseNext(20_000, 1, new Date(Date.now() + 1_000));
    expect(lease?.run.runId).toBe(target.runId);
    expect((await adminPool.query('SELECT status FROM product_context_shadow.shadow_runs WHERE run_id = $1', [hidden.runId])).rows[0]).toEqual({ status: 'pending' });
  });

  it('does not run any housekeeping transition outside an exact evaluator target', async () => {
    const hiddenReceipt = {
      ...testReceipt,
      shadow_principal_ref: `cubica://shadow-principal/v1/${'6'.repeat(64)}`,
      authorization_revision: `sha256:${'6'.repeat(64)}`
    };
    const enqueueHidden = async (suffix: string, retainedUntil: Date) => enqueueShadowTurn(new PostgresConversationStore(appRuntimePool), {
      receipt: hiddenReceipt, threadRef: `${testThreadRef}-hidden-${suffix}`,
      stableTurnKey: `${testStableTurnKey}-hidden-${suffix}`,
      userBytes: testUserBytes, agentBytes: testAgentBytes, now: new Date(), retainedUntil
    });
    const hiddenStore = (suffix: string) => new PostgresShadowWorkerStore(workerRuntimePool, {
      ownerRef: hiddenReceipt.shadow_principal_ref,
      gameRef: hiddenReceipt.applies_to[0]!,
      stableTurnKey: `${testStableTurnKey}-hidden-${suffix}`
    });
    const expired = await enqueueHidden('retention', new Date(Date.now() + 150));
    const calling = await enqueueHidden('calling', new Date(Date.now() + 60_000));
    const callingLease = await hiddenStore('calling').leaseNext(20_000, 3);
    await hiddenStore('calling').prepareCall(callingLease!, 'modelreq_hidden_calling', 1, new Date());
    const exhaustedLease = await enqueueHidden('leased-exhausted', new Date(Date.now() + 60_000));
    await hiddenStore('leased-exhausted').leaseNext(1, 1);
    const exhaustedRetry = await enqueueHidden('retry-exhausted', new Date(Date.now() + 60_000));
    const retryLease = await hiddenStore('retry-exhausted').leaseNext(20_000, 1);
    await hiddenStore('retry-exhausted').retry(retryLease!, 'zai_1303', new Date(Date.now() + 50));
    await adminPool.query('SELECT pg_sleep(0.2)');

    const target = await enqueueQueue('housekeeping-target');
    const targetStore = new PostgresShadowWorkerStore(workerRuntimePool, {
      ownerRef: testReceipt.shadow_principal_ref,
      gameRef: testReceipt.applies_to[0]!,
      stableTurnKey: `${testStableTurnKey}-housekeeping-target`
    });
    expect((await targetStore.leaseNext(20_000, 1, new Date('2020-01-01T00:00:00Z')))?.run.runId).toBe(target.runId);
    const hidden = await adminPool.query(`SELECT run_id, status FROM product_context_shadow.shadow_runs
      WHERE run_id = ANY($1::text[]) ORDER BY run_id`, [[expired.runId, calling.runId, exhaustedLease.runId, exhaustedRetry.runId]]);
    expect(new Map(hidden.rows.map((row) => [row.run_id, row.status]))).toEqual(new Map([
      [expired.runId, 'pending'],
      [calling.runId, 'calling_model'],
      [exhaustedLease.runId, 'leased'],
      [exhaustedRetry.runId, 'retry_wait']
    ]));
  });

  it('lets the evaluator app adapter inspect and review only its exact completed turn', async () => {
    const suffix = 'evaluator-adapter';
    const stableTurnKey = `${testStableTurnKey}-${suffix}`;
    const run = await enqueueQueue(suffix);
    const evaluator = new PostgresShadowEvaluatorDatabase(
      appRuntimePool,
      testReceipt.shadow_principal_ref,
      testReceipt.applies_to[0]!
    );
    await expect(evaluator.inspect()).resolves.toMatchObject({
      runs: [expect.objectContaining({ stableTurnKey, status: 'pending', metricCount: 0 })],
      activeRuns: 1,
      activeMetrics: 0,
      activeMessages: 2,
      activeThreads: 1
    });

    const store = new PostgresShadowWorkerStore(workerRuntimePool, {
      ownerRef: testReceipt.shadow_principal_ref,
      gameRef: testReceipt.applies_to[0]!,
      stableTurnKey
    });
    const started = new Date();
    const lease = await store.leaseNext(20_000, 1, started);
    expect(lease?.run.runId).toBe(run.runId);
    await store.prepareCall(lease!, 'modelreq_evaluator_adapter', 20_000, started);
    await expect(store.complete(lease!, {
      result: { schema_version: '1.0.0', request_id: 'modelreq_evaluator_adapter', outcome: 'no_change', proposal: null },
      durationMs: 7,
      inputBytes: 11,
      outputBytes: 13
    }, started)).resolves.toBe('completed');

    await expect(evaluator.inspect()).resolves.toMatchObject({
      runs: [expect.objectContaining({
        stableTurnKey,
        status: 'succeeded',
        outcome: 'no_change',
        durationMs: 7,
        inputBytes: 11,
        outputBytes: 13,
        metricCount: 1
      })]
    });
    await expect(evaluator.reviewMaterial(stableTurnKey)).resolves.toEqual({
      userMessage: new TextDecoder().decode(testUserBytes),
      agentMessage: new TextDecoder().decode(testAgentBytes),
      result: { schema_version: '1.0.0', request_id: 'modelreq_evaluator_adapter', outcome: 'no_change', proposal: null }
    });
  });

  it('exposes cleanup recovery only when PostgreSQL time makes the targeted claim terminal-only', async () => {
    const now = new Date();
    const pending = await enqueueShadowTurn(new PostgresConversationStore(appRuntimePool), {
      receipt: testReceipt, threadRef: `${testThreadRef}-cleanup-recovery-pending`,
      stableTurnKey: `${testStableTurnKey}-cleanup-recovery-pending`, userBytes: testUserBytes,
      agentBytes: testAgentBytes, now, retainedUntil: new Date(now.getTime() + 500)
    });
    const leased = await enqueueQueue('cleanup-recovery-leased');
    const leasedStore = new PostgresShadowWorkerStore(workerRuntimePool, {
      ownerRef: testReceipt.shadow_principal_ref, gameRef: testReceipt.applies_to[0]!,
      stableTurnKey: `${testStableTurnKey}-cleanup-recovery-leased`
    });
    await leasedStore.leaseNext(500, 1);
    const calling = await enqueueQueue('cleanup-recovery-calling');
    const callingStore = new PostgresShadowWorkerStore(workerRuntimePool, {
      ownerRef: testReceipt.shadow_principal_ref, gameRef: testReceipt.applies_to[0]!,
      stableTurnKey: `${testStableTurnKey}-cleanup-recovery-calling`
    });
    const callingLease = await callingStore.leaseNext(10_000, 1);
    await callingStore.prepareCall(callingLease!, 'modelreq_cleanup_recovery', 500, now);
    const evaluator = new PostgresShadowEvaluatorDatabase(
      appRuntimePool, testReceipt.shadow_principal_ref, testReceipt.applies_to[0]!
    );
    const recoveryEnv = {
      CUBICA_DEPLOYMENT_TIER: 'test',
      CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_DATABASE_URL: workerUrl,
      CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_LEASE_MS: '10000',
      CUBICA_PRODUCT_CONTEXT_SHADOW_MAX_ATTEMPTS: '1',
      CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_DATABASE_STATEMENT_TIMEOUT_MS: '5000',
      CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_DATABASE_LOCK_TIMEOUT_MS: '1000'
    };
    expect((await evaluator.inspect()).runs.every((run) => run.cleanupRecovery === null)).toBe(true);
    await expect(runShadowWorkerRecoveryOnce(recoveryEnv, {
      ownerRef: testReceipt.shadow_principal_ref, gameRef: testReceipt.applies_to[0]!,
      stableTurnKey: pending.stableTurnKey
    })).resolves.toBe('unsafe');
    expect((await adminPool.query(`SELECT status FROM product_context_shadow.shadow_runs WHERE run_id = $1`, [pending.runId])).rows)
      .toEqual([{ status: 'pending' }]);
    await adminPool.query('SELECT pg_sleep(0.6)');
    const recoverable = new Map((await evaluator.inspect()).runs.map((run) => [run.stableTurnKey, run.cleanupRecovery]));
    expect(recoverable).toEqual(new Map([
      [`${testStableTurnKey}-cleanup-recovery-pending`, 'retention_expired'],
      [`${testStableTurnKey}-cleanup-recovery-leased`, 'attempts_exhausted'],
      [`${testStableTurnKey}-cleanup-recovery-calling`, 'expired_calling_model']
    ]));
    for (const stableTurnKey of [pending.stableTurnKey, leased.stableTurnKey, calling.stableTurnKey]) {
      await expect(runShadowWorkerRecoveryOnce(recoveryEnv, {
        ownerRef: testReceipt.shadow_principal_ref, gameRef: testReceipt.applies_to[0]!, stableTurnKey
      })).resolves.toBe('terminalized');
    }
    const terminal = await adminPool.query(`SELECT run_id, status, outcome_code FROM product_context_shadow.shadow_runs
      WHERE run_id = ANY($1::text[]) ORDER BY run_id`, [[pending.runId, leased.runId, calling.runId]]);
    expect(new Map(terminal.rows.map((row) => [row.run_id, [row.status, row.outcome_code]]))).toEqual(new Map([
      [pending.runId, ['failed', 'retention_expired']],
      [leased.runId, ['blocked', 'gateway_blocked']],
      [calling.runId, ['failed', 'gateway_outcome_unknown']]
    ]));
    expect((await evaluator.inspect()).runs.every((run) => run.cleanupRecovery === null && run.metricCount === 1)).toBe(true);
  });

  it('reclaims an expired pre-call lease but terminalizes an expired call without retry', async () => {
    const store = new PostgresShadowWorkerStore(workerRuntimePool);
    await enqueueQueue('expired-leased');
    const leasedAt = new Date();
    const first = await store.leaseNext(1_000, 3, leasedAt);
    await adminPool.query('SELECT pg_sleep(1.05)');
    const second = await store.leaseNext(1_000, 3, new Date());
    expect(first).not.toBeNull();
    expect(second).toMatchObject({ run: { runId: first!.run.runId }, attempt: 2 });
    expect(second!.token).not.toBe(first!.token);

    await adminPool.query(`TRUNCATE product_context_shadow.shadow_metrics, product_context_shadow.shadow_runs,
      product_context_shadow.conversation_messages, product_context_shadow.conversation_threads`);
    await enqueueQueue('expired-calling');
    const callingAt = new Date();
    const calling = await store.leaseNext(10_000, 3, callingAt);
    await store.prepareCall(calling!, 'modelreq_expired_calling', 1_000, callingAt);
    await adminPool.query('SELECT pg_sleep(1.05)');
    await expect(store.leaseNext(10_000, 3, new Date())).resolves.toBeNull();
    const terminal = await adminPool.query(`SELECT status, outcome_code, attempts, lease_token, result_payload
      FROM product_context_shadow.shadow_runs WHERE run_id = $1`, [calling!.run.runId]);
    expect(terminal.rows[0]).toEqual({ status: 'failed', outcome_code: 'gateway_outcome_unknown', attempts: 1, lease_token: null, result_payload: null });
    expect((await adminPool.query(`SELECT outcome, attempt_number FROM product_context_shadow.shadow_metrics
      WHERE run_id = $1`, [calling!.run.runId])).rows).toEqual([{ outcome: 'gateway_outcome_unknown', attempt_number: 1 }]);
  });

  it('records one content-free metric for every retry attempt', async () => {
    const store = new PostgresShadowWorkerStore(workerRuntimePool);
    await enqueueQueue('retry-metrics');
    const started = new Date();
    const first = await store.leaseNext(10_000, 3, started);
    await store.retry(first!, 'zai_1303', new Date(Date.now() + 50), null, started);
    await adminPool.query('SELECT pg_sleep(0.06)');
    const secondAt = new Date();
    const second = await store.leaseNext(10_000, 3, secondAt);
    await store.retry(second!, 'zai_1305', new Date(Date.now() + 50), null, secondAt);
    await adminPool.query('SELECT pg_sleep(0.06)');
    const thirdAt = new Date();
    const third = await store.leaseNext(10_000, 3, thirdAt);
    await store.prepareCall(third!, 'modelreq_retry_complete', 10_000, thirdAt);
    await expect(store.complete(third!, {
      result: { schema_version: '1.0.0', request_id: 'modelreq_retry_complete', outcome: 'no_change', proposal: null },
      durationMs: 1, inputBytes: 2, outputBytes: 3
    }, thirdAt)).resolves.toBe('completed');
    await expect(enqueueQueue('retry-metrics', new Date(thirdAt.getTime() + 1))).resolves.toMatchObject({ status: 'succeeded' });
    expect((await adminPool.query(`SELECT outcome, attempt_number FROM product_context_shadow.shadow_metrics
      WHERE run_id = $1 ORDER BY attempt_number`, [first!.run.runId])).rows).toEqual([
      { outcome: 'gateway_retry_scheduled', attempt_number: 1 },
      { outcome: 'gateway_retry_scheduled', attempt_number: 2 },
      { outcome: 'no_change', attempt_number: 3 }
    ]);
  });

  it('atomically discards a provider result when retention expires after the post-call reread', async () => {
    const store = new PostgresShadowWorkerStore(workerRuntimePool);
    const retention = await adminPool.query<{ created_at: Date; retained_until: Date }>(`
      SELECT database_now AS created_at,
             database_now + interval '1.5 seconds' AS retained_until
      FROM (SELECT clock_timestamp() AS database_now) AS clock
    `);
    const created = retention.rows[0]!.created_at;
    const retainedUntil = retention.rows[0]!.retained_until;
    await enqueueShadowTurn(new PostgresConversationStore(appRuntimePool), {
      receipt: testReceipt, threadRef: `${testThreadRef}-atomic-retention`,
      stableTurnKey: `${testStableTurnKey}-atomic-retention`, userBytes: testUserBytes,
      agentBytes: testAgentBytes, now: created, retainedUntil
    });
    const started = new Date();
    const lease = await store.leaseNext(20_000, 3, started);
    await store.prepareCall(lease!, 'modelreq_atomic_retention', 20_000, started);
    const live = await adminPool.query<{ retained_until: Date; database_now: Date }>(`
      SELECT retained_until, clock_timestamp() AS database_now
      FROM product_context_shadow.shadow_runs
      WHERE run_id = $1
    `, [lease!.run.runId]);
    expect(live.rows[0]!.retained_until.getTime()).toBeGreaterThan(live.rows[0]!.database_now.getTime());
    await adminPool.query(`
      SELECT pg_sleep(GREATEST(
        0.05,
        EXTRACT(EPOCH FROM (retained_until - clock_timestamp())) + 0.05
      ))
      FROM product_context_shadow.shadow_runs
      WHERE run_id = $1
    `, [lease!.run.runId]);
    const completion = await store.complete(lease!, {
      result: { schema_version: '1.0.0', request_id: 'modelreq_atomic_retention', outcome: 'no_change', proposal: null },
      durationMs: 7, inputBytes: 11, outputBytes: 13
    }, new Date());
    expect(completion).toBe('retention_expired');
    expect((await adminPool.query(`SELECT status, outcome_code, result_payload FROM product_context_shadow.shadow_runs
      WHERE run_id = $1`, [lease!.run.runId])).rows[0]).toEqual({ status: 'failed', outcome_code: 'retention_expired', result_payload: null });
  });

  it('fences a late completion behind a row lock and lets the DB-clock sweeper record only unknown outcome', async () => {
    const run = await enqueueQueue('late-completion-fence');
    const store = new PostgresShadowWorkerStore(workerRuntimePool, {
      ownerRef: testReceipt.shadow_principal_ref, gameRef: testReceipt.applies_to[0]!,
      stableTurnKey: `${testStableTurnKey}-late-completion-fence`
    });
    const lease = await store.leaseNext(10_000, 1);
    await store.prepareCall(lease!, 'modelreq_late_completion', 100, new Date('2020-01-01T00:00:00Z'));
    const blocker = await appRuntimePool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SET LOCAL ROLE product_context_shadow_app');
    await blocker.query("SELECT set_config('cubica.shadow_principal_ref', $1, true)", [testReceipt.shadow_principal_ref]);
    await blocker.query(`SELECT message_ref FROM product_context_shadow.conversation_messages WHERE message_ref = $1 FOR UPDATE`, [run.userMessageRef]);
    const completion = store.complete(lease!, {
      result: { schema_version: '1.0.0', request_id: 'modelreq_late_completion', outcome: 'no_change', proposal: null },
      durationMs: 1, inputBytes: 1, outputBytes: 1
    }, new Date('2020-01-01T00:00:00Z'));
    await adminPool.query('SELECT pg_sleep(0.15)');
    const sweep = new PostgresShadowWorkerStore(workerRuntimePool).leaseNext(10_000, 1, new Date('2020-01-01T00:00:00Z'));
    await blocker.query('COMMIT'); blocker.release();
    await expect(completion).rejects.toThrow('lease was lost');
    await expect(sweep).resolves.toBeNull();
    expect((await adminPool.query(`SELECT status, outcome_code, result_payload FROM product_context_shadow.shadow_runs WHERE run_id = $1`, [run.runId])).rows[0])
      .toEqual({ status: 'failed', outcome_code: 'gateway_outcome_unknown', result_payload: null });
    expect((await adminPool.query(`SELECT outcome FROM product_context_shadow.shadow_metrics WHERE run_id = $1`, [run.runId])).rows)
      .toEqual([{ outcome: 'gateway_outcome_unknown' }]);
  });

  it('refuses inherited or cleanup privileges on the dedicated runtime login', async () => {
    const config = syntheticShadowActivationConfig(environment());
    await adminPool.query(`ALTER ROLE ${quoteIdentifier(runtimeRole)} INHERIT`);
    try {
      await expect(preflightSyntheticShadowActivation(config)).rejects.toBeInstanceOf(SyntheticShadowActivationError);
    } finally {
      await adminPool.query(`ALTER ROLE ${quoteIdentifier(runtimeRole)} NOINHERIT`);
    }
    await adminPool.query(`GRANT product_context_shadow_cleanup TO ${quoteIdentifier(runtimeRole)}`);
    try {
      await expect(preflightSyntheticShadowActivation(config)).rejects.toBeInstanceOf(SyntheticShadowActivationError);
    } finally {
      await adminPool.query(`REVOKE product_context_shadow_cleanup FROM ${quoteIdentifier(runtimeRole)}`);
    }
  });

  it('refuses an additional permissive policy in the shadow schema', async () => {
    const config = syntheticShadowActivationConfig(environment());
    await adminPool.query(`CREATE POLICY synthetic_forbidden_policy ON product_context_shadow.shadow_runs
      TO product_context_shadow_app USING (true) WITH CHECK (true)`);
    try {
      await expect(preflightSyntheticShadowActivation(config)).rejects.toBeInstanceOf(SyntheticShadowActivationError);
    } finally {
      await adminPool.query('DROP POLICY synthetic_forbidden_policy ON product_context_shadow.shadow_runs');
    }
  });

  it('readiness rejects post-migration worker and cleanup function ACL drift', async () => {
    const config = syntheticShadowActivationConfig(environment());
    const foreign = `shadow_acl_drift_${process.pid}_${randomBytes(4).toString('hex')}`;
    await adminPool.query(`CREATE ROLE ${quoteIdentifier(foreign)} NOLOGIN`);
    try {
      await adminPool.query(`GRANT EXECUTE ON FUNCTION
        product_context_shadow.worker_claim(integer,integer,timestamptz,text,text,text)
        TO product_context_shadow_app`);
      await expect(preflightSyntheticShadowActivation(config)).rejects.toBeInstanceOf(SyntheticShadowActivationError);
      await adminPool.query(`REVOKE EXECUTE ON FUNCTION
        product_context_shadow.worker_claim(integer,integer,timestamptz,text,text,text)
        FROM product_context_shadow_app`);
      await adminPool.query(`GRANT EXECUTE ON FUNCTION product_context_shadow.cleanup_expired(integer)
        TO ${quoteIdentifier(foreign)}`);
      await expect(preflightSyntheticShadowActivation(config)).rejects.toBeInstanceOf(SyntheticShadowActivationError);
      await adminPool.query(`REVOKE EXECUTE ON FUNCTION product_context_shadow.cleanup_expired(integer)
        FROM ${quoteIdentifier(foreign)};
        CREATE FUNCTION product_context_shadow.worker_unknown_legacy(text)
          RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
        REVOKE ALL ON FUNCTION product_context_shadow.worker_unknown_legacy(text) FROM PUBLIC`);
      await expect(preflightSyntheticShadowActivation(config)).rejects.toBeInstanceOf(SyntheticShadowActivationError);
    } finally {
      await adminPool.query(`REVOKE EXECUTE ON FUNCTION
        product_context_shadow.worker_claim(integer,integer,timestamptz,text,text,text)
        FROM product_context_shadow_app`);
      await adminPool.query(`REVOKE EXECUTE ON FUNCTION product_context_shadow.cleanup_expired(integer)
        FROM ${quoteIdentifier(foreign)}`);
      await adminPool.query('DROP FUNCTION IF EXISTS product_context_shadow.worker_unknown_legacy(text)');
      await adminPool.query(`DROP ROLE ${quoteIdentifier(foreign)}`);
    }
  });

  it('refuses changed owner-policy semantics and a trigger bound to the wrong table', async () => {
    const config = syntheticShadowActivationConfig(environment());
    await adminPool.query(`DROP POLICY conversation_threads_owner_policy ON product_context_shadow.conversation_threads;
      CREATE POLICY conversation_threads_owner_policy ON product_context_shadow.conversation_threads
      TO product_context_shadow_app USING (true) WITH CHECK (true)`);
    try {
      await expect(preflightSyntheticShadowActivation(config)).rejects.toBeInstanceOf(SyntheticShadowActivationError);
    } finally {
      await adminPool.query(`DROP POLICY conversation_threads_owner_policy ON product_context_shadow.conversation_threads;
        CREATE POLICY conversation_threads_owner_policy ON product_context_shadow.conversation_threads
        TO product_context_shadow_app
        USING (owner_ref = NULLIF(current_setting('cubica.shadow_principal_ref', true), ''))
        WITH CHECK (owner_ref = NULLIF(current_setting('cubica.shadow_principal_ref', true), ''))`);
    }

    await adminPool.query(`DROP TRIGGER enforce_thread_contract ON product_context_shadow.conversation_threads;
      CREATE TRIGGER enforce_thread_contract BEFORE INSERT OR UPDATE ON product_context_shadow.conversation_messages
      FOR EACH ROW EXECUTE FUNCTION product_context_shadow.enforce_thread_contract()`);
    try {
      await expect(preflightSyntheticShadowActivation(config)).rejects.toBeInstanceOf(SyntheticShadowActivationError);
    } finally {
      await adminPool.query(`DROP TRIGGER enforce_thread_contract ON product_context_shadow.conversation_messages;
        CREATE TRIGGER enforce_thread_contract BEFORE INSERT OR UPDATE ON product_context_shadow.conversation_threads
        FOR EACH ROW EXECUTE FUNCTION product_context_shadow.enforce_thread_contract()`);
    }
  });

  it('refuses table ownership or any privilege outside the exact runtime ACL', async () => {
    const config = syntheticShadowActivationConfig(environment());
    await adminPool.query('GRANT TRUNCATE ON product_context_shadow.shadow_runs TO product_context_shadow_app');
    try {
      await expect(preflightSyntheticShadowActivation(config)).rejects.toBeInstanceOf(SyntheticShadowActivationError);
    } finally {
      await adminPool.query('REVOKE TRUNCATE ON product_context_shadow.shadow_runs FROM product_context_shadow_app');
    }

    const owner = (await adminPool.query<{ owner: string }>(`
      SELECT pg_get_userbyid(relowner) AS owner FROM pg_class
      WHERE oid = 'product_context_shadow.shadow_metrics'::regclass
    `)).rows[0]!.owner;
    await adminPool.query(`ALTER TABLE product_context_shadow.shadow_metrics OWNER TO ${quoteIdentifier(runtimeRole)}`);
    try {
      await expect(preflightSyntheticShadowActivation(config)).rejects.toBeInstanceOf(SyntheticShadowActivationError);
    } finally {
      await adminPool.query(`ALTER TABLE product_context_shadow.shadow_metrics OWNER TO ${quoteIdentifier(owner)}`);
      await adminPool.query('GRANT SELECT, INSERT ON product_context_shadow.shadow_metrics TO product_context_shadow_app');
    }
  });

  it('CLI emits only the content-free result and never reads provider configuration', async () => {
    const secret = 'synthetic-provider-secret-must-not-appear';
    const result = spawnSync(viteNode, [
      cli, 'run', '--synthetic-only', '--deny-external-processing'
    ], { encoding: 'utf8', shell: false, env: { ...environment(), PKS_KEY: secret, PKS_BASE_URL: `https://${secret}.invalid/` } });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      ready: true, outcome: 'no_change', firstDuplicate: false, retryDuplicate: true,
      gatewayCalls: 1, gitUnchanged: true
    });
    expect(result.stderr).toBe('');
    expect(`${result.stdout}${result.stderr}`).not.toMatch(new RegExp(`${secret}|postgres|shadow-principal|Synthetic user|knowledge\\.git`, 'u'));
  });

  function environment(): NodeJS.ProcessEnv {
    return {
      TEST_PRODUCT_CONTEXT_DATABASE_URL: databaseUrl,
      CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL: runtimeUrl,
      CUBICA_PRODUCT_CONTEXT_SHADOW_WORKER_DATABASE_URL: workerUrl,
      CUBICA_DEPLOYMENT_TIER: 'test',
      CUBICA_PRODUCT_CONTEXT_SHADOW_KNOWLEDGE_REPOSITORY: repository
    };
  }

  async function enqueueQueue(suffix: string, now = new Date()) {
    return enqueueShadowTurn(new PostgresConversationStore(appRuntimePool), {
      receipt: testReceipt, threadRef: `${testThreadRef}-${suffix}`, stableTurnKey: `${testStableTurnKey}-${suffix}`,
      userBytes: testUserBytes, agentBytes: testAgentBytes, now, retainedUntil: new Date(now.getTime() + 60 * 60 * 1_000)
    });
  }
});

function quoteIdentifier(value: string): string { return `"${value.replaceAll('"', '""')}"`; }
function quoteLiteral(value: string): string { return `'${value.replaceAll("'", "''")}'`; }

/** Splits migration SQL at the same commit boundaries as an autocommit runner. */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0; let index = 0;
  let quote: "'" | '"' | string | null = null;
  let lineComment = false; let blockComment = false;
  while (index < sql.length) {
    const current = sql[index]!; const next = sql[index + 1];
    if (lineComment) { if (current === '\n') lineComment = false; index += 1; continue; }
    if (blockComment) { if (current === '*' && next === '/') { blockComment = false; index += 2; } else index += 1; continue; }
    if (quote?.startsWith('$')) { if (sql.startsWith(quote, index)) { index += quote.length; quote = null; } else index += 1; continue; }
    if (quote === "'" || quote === '"') {
      if (current === quote && next === quote) index += 2;
      else if (current === quote) { quote = null; index += 1; }
      else index += 1;
      continue;
    }
    if (current === '-' && next === '-') { lineComment = true; index += 2; continue; }
    if (current === '/' && next === '*') { blockComment = true; index += 2; continue; }
    if (current === "'" || current === '"') { quote = current; index += 1; continue; }
    if (current === '$') {
      const tag = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u)?.[0];
      if (tag) { quote = tag; index += tag.length; continue; }
    }
    if (current === ';') {
      const statement = sql.slice(start, index + 1).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
    index += 1;
  }
  const tail = sql.slice(start).trim(); if (tail) statements.push(tail);
  return statements;
}
