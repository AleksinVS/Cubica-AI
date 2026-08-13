import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ManagedKnowledgeGit, ReadOnlyKnowledgeGit } from '../src/git.ts';
import { PostgresConversationStore } from '../src/conversation-postgres.ts';
import { enqueueShadowTurn, PostgresShadowWorkerStore } from '../src/shadow-async-queue.ts';
import type { ShadowAuthorizationReceipt } from '../src/generated/product-knowledge.ts';
import {
  preflightSyntheticShadowActivation,
  runSyntheticShadowActivation,
  SyntheticShadowActivationError,
  syntheticShadowActivationConfig
} from '../src/shadow-activation-harness.ts';
import { verifyWorkerLogin } from '../scripts/run-shadow-worker.ts';
import { PostgresShadowEvaluatorDatabase } from '../scripts/run-shadow-evaluator.ts';

const databaseUrl = process.env.TEST_PRODUCT_CONTEXT_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;
const repositoryTmp = resolve(fileURLToPath(new URL('../../../.tmp/', import.meta.url)));
const cli = fileURLToPath(new URL('../scripts/run-shadow-synthetic.ts', import.meta.url));
const viteNode = fileURLToPath(new URL('../../../node_modules/.bin/vite-node', import.meta.url));
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
    const legacyStore = new PostgresConversationStore(adminPool);
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
    for (const statement of splitSqlStatements(queueMigration)) await adminPool.query(statement);
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
    await adminPool.query(`GRANT product_context_shadow_app TO ${quoteIdentifier(runtimeRole)}`);
    await adminPool.query(`GRANT product_context_shadow_worker TO ${quoteIdentifier(workerRole)}`);
    const url = new URL(databaseUrl!);
    url.username = runtimeRole; url.password = runtimePassword;
    runtimeUrl = url.toString();
    url.username = workerRole; url.password = workerPassword;
    workerUrl = url.toString();
    appRuntimePool = new Pool({ connectionString: runtimeUrl, max: 4 });
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

  it('migrates legacy pending, calling, and terminal rows without losing their state', () => {
    expect(migrationCompatibility).toHaveLength(3);
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

  it('atomically claims only the exact evaluator target even when an earlier hidden run exists', async () => {
    const hiddenReceipt = {
      ...testReceipt,
      shadow_principal_ref: `cubica://shadow-principal/v1/${'9'.repeat(64)}`,
      authorization_revision: `sha256:${'9'.repeat(64)}`
    };
    const now = new Date();
    const hidden = await enqueueShadowTurn(new PostgresConversationStore(adminPool), {
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
    await store.markCallingModel(lease!, 'modelreq_evaluator_adapter', 20_000, started);
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

  it('reclaims an expired pre-call lease but terminalizes an expired call without retry', async () => {
    const store = new PostgresShadowWorkerStore(workerRuntimePool);
    await enqueueQueue('expired-leased');
    const leasedAt = new Date();
    const first = await store.leaseNext(1_000, 3, leasedAt);
    const second = await store.leaseNext(1_000, 3, new Date(leasedAt.getTime() + 2_000));
    expect(first).not.toBeNull();
    expect(second).toMatchObject({ run: { runId: first!.run.runId }, attempt: 2 });
    expect(second!.token).not.toBe(first!.token);

    await adminPool.query(`TRUNCATE product_context_shadow.shadow_metrics, product_context_shadow.shadow_runs,
      product_context_shadow.conversation_messages, product_context_shadow.conversation_threads`);
    await enqueueQueue('expired-calling');
    const callingAt = new Date();
    const calling = await store.leaseNext(10_000, 3, callingAt);
    await store.markCallingModel(calling!, 'modelreq_expired_calling', 1_000, callingAt);
    await expect(store.leaseNext(10_000, 3, new Date(callingAt.getTime() + 2_000))).resolves.toBeNull();
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
    await store.retry(first!, 'zai_1303', new Date(started.getTime() + 1_000), null, started);
    const secondAt = new Date(started.getTime() + 1_001);
    const second = await store.leaseNext(10_000, 3, secondAt);
    await store.retry(second!, 'zai_1305', new Date(secondAt.getTime() + 2_000), null, secondAt);
    const thirdAt = new Date(secondAt.getTime() + 2_001);
    const third = await store.leaseNext(10_000, 3, thirdAt);
    await store.markCallingModel(third!, 'modelreq_retry_complete', 10_000, thirdAt);
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
    const created = new Date();
    await enqueueShadowTurn(new PostgresConversationStore(appRuntimePool), {
      receipt: testReceipt, threadRef: `${testThreadRef}-atomic-retention`,
      stableTurnKey: `${testStableTurnKey}-atomic-retention`, userBytes: testUserBytes,
      agentBytes: testAgentBytes, now: created, retainedUntil: new Date(created.getTime() + 5_000)
    });
    const started = new Date();
    const lease = await store.leaseNext(20_000, 3, started);
    await store.markCallingModel(lease!, 'modelreq_atomic_retention', 20_000, started);
    const completion = await store.complete(lease!, {
      result: { schema_version: '1.0.0', request_id: 'modelreq_atomic_retention', outcome: 'no_change', proposal: null },
      durationMs: 7, inputBytes: 11, outputBytes: 13
    }, new Date(created.getTime() + 6_000));
    expect(completion).toBe('retention_expired');
    expect((await adminPool.query(`SELECT status, outcome_code, result_payload FROM product_context_shadow.shadow_runs
      WHERE run_id = $1`, [lease!.run.runId])).rows[0]).toEqual({ status: 'failed', outcome_code: 'retention_expired', result_payload: null });
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
