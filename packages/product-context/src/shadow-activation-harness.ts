/** A content-free, local-only rehearsal of the accepted shadow activation path. */
import { fileURLToPath } from 'node:url';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { Pool } from 'pg';

import { PostgresConversationStore } from './conversation-postgres.ts';
import { ReadOnlyKnowledgeGit } from './git.ts';
import type { ModelGateway, ModelGatewayCall } from './model-gateway.ts';
import { ShadowCoordinator } from './shadow-coordinator.ts';
import { safeShadowDatabaseUrl } from './shadow-database-url.ts';
import type { ModelGatewayRequest, ShadowAuthorizationReceipt } from './generated/product-knowledge.ts';

const repositoryTmp = resolve(fileURLToPath(new URL('../../../.tmp/', import.meta.url)));
const principal = `cubica://shadow-principal/v1/${'7'.repeat(64)}`;
const game = 'cubica://game-project/synthetic-activation';
const receipt: ShadowAuthorizationReceipt = Object.freeze({
  schema_version: '1.0.0', decision: 'allow', shadow_principal_ref: principal,
  role_scope: 'developer', applies_to: [game],
  access_policy_ref: 'synthetic-local-activation', access_policy_revision: '1',
  retention_policy_ref: 'synthetic-disposable', retention_policy_revision: '1',
  external_processing_policy_ref: 'synthetic-local-only', external_processing_policy_revision: '1',
  authorization_revision: `sha256:${'8'.repeat(64)}`,
  issued_at: '2020-01-01T00:00:00.000Z', expires_at: '2099-01-01T00:00:00.000Z'
});
const threadRef = 'cubica://shadow-thread/synthetic-activation-rehearsal';
const stableTurnKey = 'synthetic-activation-turn-v1';
const userBytes = new TextEncoder().encode('Synthetic user activation rehearsal.');
const agentBytes = new TextEncoder().encode('Synthetic agent activation rehearsal.');
const expectedTables = [
  'conversation_threads', 'conversation_messages', 'shadow_runs', 'shadow_metrics'
] as const;
const expectedPolicies = [
  'conversation_threads_owner_policy', 'conversation_messages_owner_policy',
  'shadow_runs_owner_policy', 'shadow_metrics_owner_policy'
] as const;
const expectedAllPolicies = [
  ...expectedPolicies, 'conversation_threads_cleanup_policy',
  'conversation_messages_cleanup_policy', 'shadow_runs_cleanup_policy'
] as const;
// The rehearsal targets PostgreSQL 17 and rejects any catalog-level change to
// the principal partition instead of trying to infer whether a drift is safe.
const ownerPolicyExpression = "(owner_ref = NULLIF(current_setting('cubica.shadow_principal_ref'::text, true), ''::text))";

export interface SyntheticShadowActivationConfig {
  readonly databaseUrl: string;
  readonly knowledgeRepository: string;
  readonly environment: 'test' | 'staging';
}

export interface SyntheticShadowActivationResult {
  readonly ready: true;
  readonly outcome: 'no_change';
  readonly firstDuplicate: false;
  readonly retryDuplicate: true;
  readonly gatewayCalls: 1;
  readonly gitUnchanged: true;
}

export class SyntheticShadowActivationError extends Error {
  constructor() {
    super('Synthetic shadow activation rehearsal was refused.');
    this.name = 'SyntheticShadowActivationError';
  }
}

/** Resolves only the fixed, local-only rehearsal configuration. */
export function syntheticShadowActivationConfig(env: NodeJS.ProcessEnv): SyntheticShadowActivationConfig {
  const runtime = safeShadowDatabaseUrl(env.CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL);
  const environment = env.CUBICA_DEPLOYMENT_TIER;
  const knowledgeRepository = env.CUBICA_PRODUCT_CONTEXT_SHADOW_KNOWLEDGE_REPOSITORY ?? '';
  if (!runtime || !isLoopbackDatabaseUrl(runtime) || (environment !== 'test' && environment !== 'staging') ||
      !isRepositoryTmpPath(knowledgeRepository)) throw new SyntheticShadowActivationError();
  return Object.freeze({ databaseUrl: runtime, knowledgeRepository, environment });
}

/** Verifies the deployed runtime login and opens the existing Git repository read-only. */
export async function preflightSyntheticShadowActivation(config: SyntheticShadowActivationConfig): Promise<{ readonly ready: true }> {
  const pool = runtimePool(config.databaseUrl);
  let git: ReadOnlyKnowledgeGit | undefined;
  try {
    await verifyDatabaseReadiness(pool);
    git = await openContainedKnowledgeGit(config.knowledgeRepository);
    git.head();
    return Object.freeze({ ready: true });
  } catch {
    throw new SyntheticShadowActivationError();
  } finally {
    await git?.close().catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
}

/** Runs the same fixed turn twice and proves idempotency without external processing. */
export async function runSyntheticShadowActivation(config: SyntheticShadowActivationConfig): Promise<SyntheticShadowActivationResult> {
  await preflightSyntheticShadowActivation(config);
  const pool = runtimePool(config.databaseUrl);
  let git: ReadOnlyKnowledgeGit | undefined;
  try {
    git = await openContainedKnowledgeGit(config.knowledgeRepository);
    const before = git.head();
    const gateway = new SyntheticNoChangeGateway();
    const coordinator = new ShadowCoordinator(
      new PostgresConversationStore(pool),
      { timeoutMs: 1_000, current: async () => receipt },
      gateway,
      { enabled: true, environment: config.environment, retentionMs: 60 * 60 * 1_000 }
    );
    const input = { authorizationReceipt: receipt, threadRef, stableTurnKey, userBytes, agentBytes };
    const first = await coordinator.run(input);
    const retry = await coordinator.run(input);
    const after = git.head();
    if (first.status !== 'completed' || first.result.outcome !== 'no_change' || first.duplicate ||
        retry.status !== 'completed' || retry.result.outcome !== 'no_change' || !retry.duplicate ||
        gateway.calls !== 1 || before !== after) throw new SyntheticShadowActivationError();
    return Object.freeze({
      ready: true, outcome: 'no_change', firstDuplicate: false, retryDuplicate: true,
      gatewayCalls: 1, gitUnchanged: true
    });
  } catch {
    throw new SyntheticShadowActivationError();
  } finally {
    await git?.close().catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
}

class SyntheticNoChangeGateway implements ModelGateway {
  readonly maxRequestBytes = 512 * 1024;
  readonly timeoutMs = 1_000;
  calls = 0;
  async call(request: ModelGatewayRequest): Promise<ModelGatewayCall> {
    this.calls += 1;
    const result = { schema_version: '1.0.0' as const, request_id: request.request_id, outcome: 'no_change' as const, proposal: null };
    return {
      result,
      inputBytes: new TextEncoder().encode(JSON.stringify(request)).byteLength,
      outputBytes: new TextEncoder().encode(JSON.stringify(result)).byteLength,
      durationMs: 0
    };
  }
}

function runtimePool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 2, connectionTimeoutMillis: 2_000, idleTimeoutMillis: 2_000, allowExitOnIdle: true });
}

async function verifyDatabaseReadiness(pool: Pool): Promise<void> {
  const role = await pool.query<{
    rolcanlogin: boolean; rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean;
    rolreplication: boolean; rolbypassrls: boolean; rolinherit: boolean;
    member: boolean; cleanup_member: boolean; other_direct_memberships: number;
  }>(`
    SELECT login.rolcanlogin, login.rolsuper, login.rolcreatedb, login.rolcreaterole,
           login.rolreplication, login.rolbypassrls, login.rolinherit,
           pg_has_role(login.rolname, 'product_context_shadow_app', 'MEMBER') AS member,
           pg_has_role(login.rolname, 'product_context_shadow_cleanup', 'MEMBER') AS cleanup_member,
           (SELECT count(*)::int FROM pg_auth_members AS membership
             JOIN pg_roles AS granted ON granted.oid = membership.roleid
             WHERE membership.member = login.oid AND granted.rolname <> 'product_context_shadow_app') AS other_direct_memberships
    FROM pg_roles AS login WHERE login.rolname = current_user
  `);
  const login = role.rows[0];
  if (!login || !login.rolcanlogin || login.rolsuper || login.rolcreatedb || login.rolcreaterole ||
      login.rolreplication || login.rolbypassrls || login.rolinherit || !login.member ||
      login.cleanup_member || login.other_direct_memberships !== 0) throw new Error();

  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query('SET LOCAL ROLE product_context_shadow_app');
    const readiness = await client.query<{
      schema_ready: boolean; tables_ready: boolean; policies_ready: boolean; triggers_ready: boolean;
      privileges_ready: boolean; functions_ready: boolean; role_ready: boolean;
    }>(`
      SELECT
        has_schema_privilege('product_context_shadow_app', 'product_context_shadow', 'USAGE') AND
          NOT has_schema_privilege('product_context_shadow_app', 'product_context_shadow', 'CREATE') AS schema_ready,
        (SELECT count(*) = $1 FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace
          WHERE n.nspname = 'product_context_shadow' AND c.relname = ANY($2::text[])
            AND c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity) AS tables_ready,
        (SELECT count(*) = $3 FROM pg_policy AS policy
          JOIN pg_class AS policy_table ON policy_table.oid = policy.polrelid
          JOIN pg_namespace AS policy_schema ON policy_schema.oid = policy_table.relnamespace
          WHERE policy_schema.nspname = 'product_context_shadow') AND
        (SELECT count(*) = $3 AND bool_and(
            policy.polpermissive AND policy.polcmd = '*' AND
            policy.polroles = ARRAY[target_role.oid]::oid[] AND
            pg_get_expr(policy.polqual, policy.polrelid) = CASE expected.kind WHEN 'owner' THEN $4 ELSE 'true' END AND
            pg_get_expr(policy.polwithcheck, policy.polrelid) = CASE expected.kind WHEN 'owner' THEN $4 ELSE 'true' END)
          FROM (VALUES
            ('conversation_threads', 'conversation_threads_owner_policy', 'product_context_shadow_app', 'owner'),
            ('conversation_messages', 'conversation_messages_owner_policy', 'product_context_shadow_app', 'owner'),
            ('shadow_runs', 'shadow_runs_owner_policy', 'product_context_shadow_app', 'owner'),
            ('shadow_metrics', 'shadow_metrics_owner_policy', 'product_context_shadow_app', 'owner'),
            ('conversation_threads', 'conversation_threads_cleanup_policy', 'product_context_shadow_cleanup', 'cleanup'),
            ('conversation_messages', 'conversation_messages_cleanup_policy', 'product_context_shadow_cleanup', 'cleanup'),
            ('shadow_runs', 'shadow_runs_cleanup_policy', 'product_context_shadow_cleanup', 'cleanup')
          ) AS expected(table_name, policy_name, role_name, kind)
          JOIN pg_namespace AS policy_schema ON policy_schema.nspname = 'product_context_shadow'
          JOIN pg_class AS policy_table ON policy_table.relnamespace = policy_schema.oid AND policy_table.relname = expected.table_name
          JOIN pg_policy AS policy ON policy.polrelid = policy_table.oid AND policy.polname = expected.policy_name
          JOIN pg_roles AS target_role ON target_role.rolname = expected.role_name) AS policies_ready,
        (SELECT count(*) = 3 FROM pg_trigger AS deployed_trigger
          JOIN pg_class AS deployed_table ON deployed_table.oid = deployed_trigger.tgrelid
          JOIN pg_namespace AS deployed_schema ON deployed_schema.oid = deployed_table.relnamespace
          WHERE deployed_schema.nspname = 'product_context_shadow' AND NOT deployed_trigger.tgisinternal) AND
        (SELECT count(*) = 3 AND bool_and(deployed_trigger.tgenabled = 'O' AND deployed_trigger.tgtype = 23 AND
            deployed_function.pronargs = 0 AND deployed_function.proname = expected.function_name AND
            function_schema.nspname = 'product_context_shadow')
          FROM (VALUES
            ('conversation_threads', 'enforce_thread_contract', 'enforce_thread_contract'),
            ('conversation_messages', 'enforce_message_contract', 'enforce_message_contract'),
            ('shadow_runs', 'enforce_shadow_run_contract', 'enforce_shadow_run_contract')
          ) AS expected(table_name, trigger_name, function_name)
          JOIN pg_namespace AS deployed_schema ON deployed_schema.nspname = 'product_context_shadow'
          JOIN pg_class AS deployed_table ON deployed_table.relnamespace = deployed_schema.oid AND deployed_table.relname = expected.table_name
          JOIN pg_trigger AS deployed_trigger ON deployed_trigger.tgrelid = deployed_table.oid AND deployed_trigger.tgname = expected.trigger_name
          JOIN pg_proc AS deployed_function ON deployed_function.oid = deployed_trigger.tgfoid
          JOIN pg_namespace AS function_schema ON function_schema.oid = deployed_function.pronamespace) AS triggers_ready,
        (SELECT bool_and(has_table_privilege('product_context_shadow_app',
          format('product_context_shadow.%I', name), 'SELECT') AND
          has_table_privilege('product_context_shadow_app', format('product_context_shadow.%I', name), 'INSERT') AND
          has_table_privilege('product_context_shadow_app', format('product_context_shadow.%I', name), 'UPDATE') = allow_update AND
          NOT has_table_privilege('product_context_shadow_app', format('product_context_shadow.%I', name), 'DELETE') AND
          NOT has_table_privilege('product_context_shadow_app', format('product_context_shadow.%I', name), 'TRUNCATE') AND
          NOT has_table_privilege('product_context_shadow_app', format('product_context_shadow.%I', name), 'REFERENCES') AND
          NOT has_table_privilege('product_context_shadow_app', format('product_context_shadow.%I', name), 'TRIGGER') AND
          pg_get_userbyid(deployed_table.relowner) NOT IN
            ('product_context_shadow_app', 'product_context_shadow_cleanup', session_user)
          ) FROM (VALUES
            ('conversation_threads', true),
            ('conversation_messages', true),
            ('shadow_runs', true),
            ('shadow_metrics', false)
          ) AS grants(name, allow_update)
          JOIN pg_namespace AS deployed_schema ON deployed_schema.nspname = 'product_context_shadow'
          JOIN pg_class AS deployed_table ON deployed_table.relnamespace = deployed_schema.oid AND deployed_table.relname = grants.name
        ) AS privileges_ready,
        to_regprocedure('product_context_shadow.enforce_thread_contract()') IS NOT NULL AND
          to_regprocedure('product_context_shadow.enforce_message_contract()') IS NOT NULL AND
          to_regprocedure('product_context_shadow.enforce_shadow_run_contract()') IS NOT NULL AND
          NOT COALESCE(has_function_privilege('product_context_shadow_app',
            to_regprocedure('product_context_shadow.enforce_thread_contract()'), 'EXECUTE'), true) AND
          NOT COALESCE(has_function_privilege('product_context_shadow_app',
            to_regprocedure('product_context_shadow.enforce_message_contract()'), 'EXECUTE'), true) AND
          NOT COALESCE(has_function_privilege('product_context_shadow_app',
            to_regprocedure('product_context_shadow.enforce_shadow_run_contract()'), 'EXECUTE'), true) AND
          COALESCE(has_function_privilege('product_context_shadow_app',
            to_regprocedure('product_context_shadow.cleanup_expired(integer)'), 'EXECUTE'), false) AND
          (SELECT count(*) = 4 AND bool_and(CASE
              WHEN deployed_function.proname = 'cleanup_expired'
                THEN pg_get_userbyid(deployed_function.proowner) = 'product_context_shadow_cleanup'
              ELSE pg_get_userbyid(deployed_function.proowner) NOT IN
                ('product_context_shadow_app', 'product_context_shadow_cleanup', session_user)
            END)
            FROM pg_proc AS deployed_function
            JOIN pg_namespace AS function_schema ON function_schema.oid = deployed_function.pronamespace
            WHERE function_schema.nspname = 'product_context_shadow' AND deployed_function.proname IN
              ('enforce_thread_contract', 'enforce_message_contract', 'enforce_shadow_run_contract', 'cleanup_expired')) AS functions_ready,
        current_user = 'product_context_shadow_app' AND
          NOT (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolcanlogin OR rolinherit
               FROM pg_roles WHERE rolname = 'product_context_shadow_app') AND
          NOT EXISTS (SELECT 1 FROM pg_auth_members AS membership JOIN pg_roles AS member_role ON member_role.oid = membership.member
            WHERE member_role.rolname IN ('product_context_shadow_app', 'product_context_shadow_cleanup')) AS role_ready
    `, [expectedTables.length, expectedTables, expectedAllPolicies.length, ownerPolicyExpression]);
    const ready = readiness.rows[0];
    if (!ready || !ready.schema_ready || !ready.tables_ready || !ready.policies_ready || !ready.triggers_ready ||
        !ready.privileges_ready || !ready.functions_ready || !ready.role_ready) throw new Error();
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function isRepositoryTmpPath(value: string): boolean {
  if (!value || resolve(value) !== value) return false;
  const pathFromTmp = relative(repositoryTmp, value);
  return pathFromTmp.length > 0 && pathFromTmp !== '..' && !pathFromTmp.startsWith(`..${sep}`) && !pathFromTmp.startsWith(sep);
}

function isLoopbackDatabaseUrl(value: string): boolean {
  return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname);
}

async function openContainedKnowledgeGit(repository: string): Promise<ReadOnlyKnowledgeGit> {
  // Resolve each component from a held .tmp descriptor. A rename or symlink
  // swap can then only fail the open, never redirect it outside the boundary.
  const pathFromTmp = relative(repositoryTmp, repository);
  const segments = pathFromTmp.split(sep);
  let parent = await open(repositoryTmp, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    for (const segment of segments.slice(0, -1)) {
      const child = await open(`/proc/self/fd/${parent.fd}/${segment}`,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      await parent.close();
      parent = child;
    }
    return await ReadOnlyKnowledgeGit.open(`/proc/self/fd/${parent.fd}/${segments.at(-1)!}`);
  } finally {
    await parent.close().catch(() => undefined);
  }
}
