/** PostgreSQL 17 checks for the non-production shadow state machine and RLS. */
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresConversationStore } from '../src/conversation-postgres.ts';
import type { ModelGateway, ModelGatewayCall } from '../src/model-gateway.ts';
import { ShadowCoordinator } from '../src/shadow-coordinator.ts';
import type { ModelGatewayRequest, ModelGatewayResult, ShadowAuthorizationReceipt, ShadowContentFreeMetric } from '../src/generated/product-knowledge.ts';

const databaseUrl = process.env.TEST_PRODUCT_CONTEXT_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;
const ownerA = 'cubica://shadow-principal/alice';
const ownerB = 'cubica://shadow-principal/bob';
const projectA = 'cubica://game-project/game-a';

integration('PostgreSQL shadow conversation boundary', () => {
  let pool: Pool;
  let runtimePool: Pool;
  let store: PostgresConversationStore;
  let runtimeRole: string;
  let runtimePassword: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 6 });
    runtimeRole = `product_context_shadow_test_${process.pid}_${randomBytes(4).toString('hex')}`;
    runtimePassword = randomBytes(24).toString('base64url');
    await pool.query(`DO $block$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'product_context_shadow_app') THEN CREATE ROLE product_context_shadow_app NOLOGIN; END IF; END $block$`);
    await pool.query(`CREATE ROLE ${quoteIdentifier(runtimeRole)} LOGIN PASSWORD ${quoteLiteral(runtimePassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
    await pool.query('DROP SCHEMA IF EXISTS product_context_shadow CASCADE');
    const migration = await readFile(fileURLToPath(new URL('../migrations/002_product_context_shadow.sql', import.meta.url)), 'utf8');
    await pool.query(migration);
    expect(Boolean((await pool.query(`SELECT pg_has_role($1, 'product_context_shadow_app', 'MEMBER') AS member`, [runtimeRole])).rows[0].member)).toBe(false);
    const beforeGrantPool = runtimePoolFor(databaseUrl!, runtimeRole, runtimePassword);
    await expect(beforeGrantPool.query('SET ROLE product_context_shadow_app')).rejects.toMatchObject({ code: '42501' });
    await beforeGrantPool.end();
    await pool.query(`GRANT product_context_shadow_app TO ${quoteIdentifier(runtimeRole)}`);
    runtimePool = runtimePoolFor(databaseUrl!, runtimeRole, runtimePassword);
    store = new PostgresConversationStore(runtimePool);
  });

  beforeEach(async () => {
    await pool.query(`TRUNCATE product_context_shadow.shadow_metrics, product_context_shadow.shadow_runs,
      product_context_shadow.conversation_messages, product_context_shadow.conversation_threads`);
  });

  afterAll(async () => {
    await runtimePool?.end();
    if (pool && runtimeRole) {
      await pool.query(`REVOKE product_context_shadow_app FROM ${quoteIdentifier(runtimeRole)}`);
      await pool.query(`DROP ROLE IF EXISTS ${quoteIdentifier(runtimeRole)}`);
    }
    await pool?.end();
  });

  it('preserves the exact user/agent order and hides every owner partition', async () => {
    const gateway = new FakeGateway();
    const result = await coordinator(store, ownerA, gateway, new Date()).run(turnInput('positive', ownerA));
    expect(result).toMatchObject({ status: 'completed', duplicate: false });
    expect(gateway.calls).toBe(1);

    const own = await asPrincipal(runtimePool, ownerA, (client) => client.query(`
      SELECT actor, sequence, encode(content_bytes, 'escape') AS content
      FROM product_context_shadow.conversation_messages ORDER BY sequence
    `));
    expect(own.rows).toEqual([
      { actor: 'user', sequence: '1', content: 'user-positive' },
      { actor: 'agent', sequence: '2', content: 'agent-positive' }
    ]);
    expect((await asPrincipal(runtimePool, ownerB, (client) => client.query('SELECT * FROM product_context_shadow.conversation_messages'))).rowCount).toBe(0);
    expect((await asPrincipal(runtimePool, ownerA, (client) => client.query('SELECT * FROM product_context_shadow.shadow_metrics'))).rowCount).toBe(1);
  });

  it('terminalizes content that expired before claim and never sends it', async () => {
    const base = new Date(Date.now() - 60_000);
    const prepared = await preparePending(ownerA, 'expired-before-claim', base, new Date(base.getTime() + 1_000));
    const claim = await store.claimRun(ownerA, prepared.runId, prepared.request.request_id, 30_000, new Date());
    expect(claim).toMatchObject({ kind: 'terminal', run: { status: 'failed', outcome: 'retention_expired', result: null } });
    expect(await terminalMetricCount(prepared.runId)).toBe(1);
  });

  it('returns in_progress before lease expiry and terminalizes a stale call without a second gateway call', async () => {
    const started = new Date();
    const prepared = await preparePending(ownerA, 'stale-lease-turn', started, new Date(started.getTime() + 120_000));
    expect((await store.claimRun(ownerA, prepared.runId, prepared.request.request_id, 1_000, started)).kind).toBe('claimed');
    expect((await store.claimRun(ownerA, prepared.runId, prepared.request.request_id, 1_000, new Date(started.getTime() + 500))).kind).toBe('in_progress');

    const gateway = new FakeGateway();
    const result = await coordinator(store, ownerA, gateway, new Date(started.getTime() + 2_000)).run(turnInput('stale-lease-turn', ownerA));
    expect(result).toMatchObject({ status: 'failed', outcome: 'gateway_outcome_unknown' });
    expect(gateway.calls).toBe(0);
    expect(await terminalMetricCount(prepared.runId)).toBe(1);
  });

  it('rolls back a terminal run when its metric cannot be inserted', async () => {
    const started = new Date();
    const first = await preparePending(ownerA, 'atomic-first-turn', started, new Date(started.getTime() + 120_000));
    const second = await preparePending(ownerA, 'atomic-second-turn', started, new Date(started.getTime() + 120_000));
    await store.claimRun(ownerA, first.runId, first.request.request_id, 30_000, started);
    await store.claimRun(ownerA, second.runId, second.request.request_id, 30_000, started);
    const result = noChange(first.request.request_id);
    await store.completeRun(ownerA, first.runId, result, 'no_change', metric(first.runId, first.request.request_id, 'no_change'), started);

    const conflicting = { ...metric(second.runId, second.request.request_id, 'no_change'), metric_id: `metric_${digest(first.runId)}` };
    await expect(store.completeRun(ownerA, second.runId, noChange(second.request.request_id), 'no_change', conflicting, started)).rejects.toMatchObject({ code: '23505' });
    const state = await asPrincipal(runtimePool, ownerA, (client) => client.query(`SELECT status FROM product_context_shadow.shadow_runs WHERE run_id = $1`, [second.runId]));
    expect(state.rows[0].status).toBe('calling_model');
    expect(await terminalMetricCount(second.runId)).toBe(0);

    const old = new Date(Date.now() - 60_000);
    const expiredAfterCall = await preparePending(ownerA, 'atomic-post-gateway-expiry', old, new Date(old.getTime() + 1_000));
    await store.claimRun(ownerA, expiredAfterCall.runId, expiredAfterCall.request.request_id, 30_000, old);
    const discarded = await store.completeRun(ownerA, expiredAfterCall.runId, noChange(expiredAfterCall.request.request_id), 'no_change', metric(expiredAfterCall.runId, expiredAfterCall.request.request_id, 'no_change'), new Date());
    expect(discarded).toMatchObject({ status: 'failed', outcome: 'retention_expired', result: null });
    expect(await terminalMetricCount(expiredAfterCall.runId)).toBe(1);
  });

  it('cleans expired payload and exact bytes across owners without exposing arbitrary delete or read', async () => {
    const old = new Date(Date.now() - 120_000);
    for (const [owner, key] of [[ownerA, 'cleanup-owner-a'], [ownerB, 'cleanup-owner-b']] as const) {
      const gateway = new FakeGateway();
      await coordinator(store, owner, gateway, old, 1_000).run(turnInput(key, owner, old));
    }
    const active = await preparePending(ownerA, 'cleanup-active', new Date(), new Date(Date.now() + 120_000));
    const cleaned = await store.cleanupExpired(100);
    expect(cleaned).toEqual({ runsDeleted: 2, messagesTombstoned: 4, threadsTombstoned: 2 });
    expect((await pool.query(`SELECT count(*)::int AS count FROM product_context_shadow.shadow_runs WHERE result_payload IS NOT NULL`)).rows[0].count).toBe(0);
    expect((await pool.query(`SELECT count(*)::int AS count FROM product_context_shadow.conversation_messages WHERE retained_until <= clock_timestamp() AND content_bytes IS NOT NULL`)).rows[0].count).toBe(0);
    expect((await pool.query(`SELECT status FROM product_context_shadow.shadow_runs WHERE run_id = $1`, [active.runId])).rows[0].status).toBe('pending');
    await expect(asPrincipal(runtimePool, ownerA, (client) => client.query(`DELETE FROM product_context_shadow.shadow_runs WHERE run_id = $1`, [active.runId]))).rejects.toMatchObject({ code: '42501' });
    expect((await asPrincipal(runtimePool, ownerB, (client) => client.query(`SELECT * FROM product_context_shadow.shadow_runs WHERE run_id = $1`, [active.runId]))).rowCount).toBe(0);
  });

  it('keeps app and cleanup roles non-owning/NOLOGIN and grants only the narrow cleanup function', async () => {
    const roles = await pool.query(`SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolinherit FROM pg_roles WHERE rolname IN ('product_context_shadow_app','product_context_shadow_cleanup') ORDER BY rolname`);
    expect(roles.rows).toEqual([
      { rolname: 'product_context_shadow_app', rolcanlogin: false, rolsuper: false, rolbypassrls: false, rolinherit: false },
      { rolname: 'product_context_shadow_cleanup', rolcanlogin: false, rolsuper: false, rolbypassrls: false, rolinherit: false }
    ]);
    const grants = await pool.query(`SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee = 'product_context_shadow_app' AND privilege_type = 'DELETE'`);
    expect(grants.rowCount).toBe(0);
    expect(Boolean((await pool.query(`SELECT has_function_privilege('product_context_shadow_app', 'product_context_shadow.cleanup_expired(integer)', 'EXECUTE') AS allowed`)).rows[0].allowed)).toBe(true);
    const runtime = await pool.query(`SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolinherit FROM pg_roles WHERE rolname = $1`, [runtimeRole]);
    expect(runtime.rows[0]).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false, rolinherit: false });
    const owned = await pool.query(`SELECT count(*)::int AS count FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace JOIN pg_roles AS r ON r.oid = c.relowner WHERE n.nspname = 'product_context_shadow' AND r.rolname = $1`, [runtimeRole]);
    expect(owned.rows[0].count).toBe(0);
    const schemaOwner = await pool.query(`SELECT owner.rolname FROM pg_namespace AS n JOIN pg_roles AS owner ON owner.oid = n.nspowner WHERE n.nspname = 'product_context_shadow'`);
    expect(schemaOwner.rows[0].rolname).not.toBe(runtimeRole);
  });

  it('preserves a migration executor cleanup membership that existed before a rerun', async () => {
    const executor = String((await pool.query('SELECT current_user')).rows[0].current_user);
    const migration = await readFile(fileURLToPath(new URL('../migrations/002_product_context_shadow.sql', import.meta.url)), 'utf8');
    const membershipQuery = `
      SELECT EXISTS (
        SELECT 1 FROM pg_auth_members AS membership
        JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
        JOIN pg_roles AS member_role ON member_role.oid = membership.member
        WHERE granted_role.rolname = 'product_context_shadow_cleanup'
          AND member_role.rolname = $1
      ) AS member
    `;
    const hadMembership = Boolean((await pool.query(membershipQuery, [executor])).rows[0].member);
    if (!hadMembership) await pool.query(`GRANT product_context_shadow_cleanup TO ${quoteIdentifier(executor)}`);
    try {
      await pool.query(migration);
      const directMembership = await pool.query(membershipQuery, [executor]);
      expect(Boolean(directMembership.rows[0].member)).toBe(true);
    } finally {
      if (!hadMembership) await pool.query(`REVOKE product_context_shadow_cleanup FROM ${quoteIdentifier(executor)}`);
    }
  });

  async function preparePending(owner: string, key: string, createdAt: Date, retainedUntil: Date) {
    const auth = receipt(owner, createdAt);
    const input = turnInput(key);
    const request = exactRequest(auth, input);
    const turn = await store.appendExactTurn({ ownerRef: owner, gameRef: projectA, threadRef: input.threadRef, stableTurnKey: input.stableTurnKey, userBytes: input.userBytes, agentBytes: input.agentBytes, gatewayRequest: request, retainedUntil, now: createdAt });
    const run = await store.createRun(auth, turn, retainedUntil);
    return { runId: run.runId, request };
  }

  async function terminalMetricCount(runId: string): Promise<number> {
    return Number((await pool.query(`SELECT count(*)::int AS count FROM product_context_shadow.shadow_metrics WHERE run_id = $1`, [runId])).rows[0].count);
  }
});

class FakeGateway implements ModelGateway {
  readonly maxRequestBytes = 512 * 1024;
  calls = 0;
  async call(request: ModelGatewayRequest): Promise<ModelGatewayCall> {
    this.calls += 1;
    return { result: noChange(request.request_id), inputBytes: Buffer.byteLength(JSON.stringify(request)), outputBytes: 64, durationMs: 2 };
  }
}

function coordinator(store: PostgresConversationStore, owner: string, gateway: ModelGateway, now: Date, retentionMs = 60_000) {
  const auth = receipt(owner, now);
  return new ShadowCoordinator(store, { current: async () => auth }, gateway, { enabled: true, environment: 'test', retentionMs, now: () => now });
}

function turnInput(key: string, owner = ownerA, now = new Date()) {
  return { authorizationReceipt: receipt(owner, now), threadRef: `cubica://shadow-thread/${key}`, stableTurnKey: `stable-${key}-000000`, userBytes: new TextEncoder().encode(`user-${key}`), agentBytes: new TextEncoder().encode(`agent-${key}`) };
}

function receipt(owner: string, now: Date): ShadowAuthorizationReceipt {
  return { schema_version: '1.0.0', decision: 'allow', shadow_principal_ref: owner, role_scope: 'developer', applies_to: [projectA], access_policy_ref: 'access', access_policy_revision: '1', retention_policy_ref: 'retention', retention_policy_revision: '1', external_processing_policy_ref: 'external', external_processing_policy_revision: '1', authorization_revision: `sha256:${'a'.repeat(64)}`, issued_at: new Date(now.getTime() - 60_000).toISOString(), expires_at: new Date(now.getTime() + 3_600_000).toISOString() };
}

function exactRequest(auth: ShadowAuthorizationReceipt, input: ReturnType<typeof turnInput>): ModelGatewayRequest {
  const runId = `shadowrun_${digest(`${auth.shadow_principal_ref}\n${input.stableTurnKey}`)}`;
  const message = (actor: 'user' | 'agent', bytes: Uint8Array) => ({ message_ref: `${input.threadRef}/message/${digest(`${auth.shadow_principal_ref}\n${input.stableTurnKey}\n${actor}`)}`, actor, revision: sha(`cubica-shadow-conversation-message/v1\n${actor}\n`, bytes), content_hash: sha('', bytes), content_base64: Buffer.from(bytes).toString('base64') });
  return { schema_version: '1.0.0', request_id: `modelreq_${digest(runId)}`, authorization_revision: auth.authorization_revision, shadow_principal_ref: auth.shadow_principal_ref, applies_to: auth.applies_to, access_policy_ref: auth.access_policy_ref, access_policy_revision: auth.access_policy_revision, retention_policy_ref: auth.retention_policy_ref, retention_policy_revision: auth.retention_policy_revision, external_processing_policy_ref: auth.external_processing_policy_ref, external_processing_policy_revision: auth.external_processing_policy_revision, external_processing_decision: 'allow', messages: [message('user', input.userBytes), message('agent', input.agentBytes)] };
}

function noChange(requestId: string): ModelGatewayResult { return { schema_version: '1.0.0', request_id: requestId, outcome: 'no_change', proposal: null }; }
function metric(runId: string, requestId: string, outcome: ShadowContentFreeMetric['outcome']): ShadowContentFreeMetric { return { schema_version: '1.0.0', metric_id: `metric_${digest(runId)}`, run_id: runId, request_id: requestId, outcome, duration_ms: 1, input_bytes: 1, output_bytes: 1, proposal_operation_count: 0, authorization_revision: `sha256:${'a'.repeat(64)}`, external_processing_policy_ref: 'external', external_processing_policy_revision: '1', recorded_at: new Date().toISOString() }; }
function sha(prefix: string, bytes: Uint8Array): `sha256:${string}` { return `sha256:${createHash('sha256').update(prefix).update(bytes).digest('hex')}`; }
function digest(value: string): string { return createHash('sha256').update(value).digest('hex').slice(0, 32); }
function quoteIdentifier(value: string): string { return `"${value.replaceAll('"', '""')}"`; }
function quoteLiteral(value: string): string { return `'${value.replaceAll("'", "''")}'`; }
function runtimePoolFor(connectionString: string, role: string, password: string): Pool {
  const url = new URL(connectionString);
  url.username = role;
  url.password = password;
  return new Pool({ connectionString: url.toString(), max: 4 });
}
async function asPrincipal<T>(pool: Pool, principal: string, work: (client: PoolClient) => Promise<T>): Promise<T> { const client = await pool.connect(); try { await client.query('BEGIN'); await client.query('SET LOCAL ROLE product_context_shadow_app'); await client.query("SELECT set_config('cubica.shadow_principal_ref', $1, true)", [principal]); const result = await work(client); await client.query('COMMIT'); return result; } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } }
