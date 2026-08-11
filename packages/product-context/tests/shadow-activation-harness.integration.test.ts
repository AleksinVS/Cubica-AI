import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ManagedKnowledgeGit, ReadOnlyKnowledgeGit } from '../src/git.ts';
import {
  preflightSyntheticShadowActivation,
  runSyntheticShadowActivation,
  SyntheticShadowActivationError,
  syntheticShadowActivationConfig
} from '../src/shadow-activation-harness.ts';

const databaseUrl = process.env.TEST_PRODUCT_CONTEXT_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;
const repositoryTmp = resolve(fileURLToPath(new URL('../../../.tmp/', import.meta.url)));
const cli = fileURLToPath(new URL('../scripts/run-shadow-synthetic.ts', import.meta.url));
const viteNode = fileURLToPath(new URL('../../../node_modules/.bin/vite-node', import.meta.url));

describe('synthetic shadow activation configuration', () => {
  it('refuses missing, production, or non-disposable configuration without connecting', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const base = {
      CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL: 'postgres://runtime:secret@localhost/disposable',
      CUBICA_DEPLOYMENT_TIER: 'test',
      CUBICA_PRODUCT_CONTEXT_SHADOW_KNOWLEDGE_REPOSITORY: join(repositoryTmp, 'synthetic.git')
    };
    expect(() => syntheticShadowActivationConfig({ ...base, CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL: undefined })).toThrow(SyntheticShadowActivationError);
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
  let repositoryRoot = '';
  let repository = '';

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: databaseUrl, max: 4 });
    runtimeRole = `shadow_activation_${process.pid}_${randomBytes(4).toString('hex')}`;
    runtimePassword = randomBytes(24).toString('base64url');
    await adminPool.query(`DO $block$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'product_context_shadow_app') THEN CREATE ROLE product_context_shadow_app NOLOGIN; END IF; END $block$`);
    await adminPool.query(`CREATE ROLE ${quoteIdentifier(runtimeRole)} LOGIN PASSWORD ${quoteLiteral(runtimePassword)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
    await adminPool.query('DROP SCHEMA IF EXISTS product_context_shadow CASCADE');
    const migration = await readFile(fileURLToPath(new URL('../migrations/002_product_context_shadow.sql', import.meta.url)), 'utf8');
    await adminPool.query(migration);
    await adminPool.query(`GRANT product_context_shadow_app TO ${quoteIdentifier(runtimeRole)}`);
    const url = new URL(databaseUrl!);
    url.username = runtimeRole; url.password = runtimePassword;
    runtimeUrl = url.toString();

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
    if (adminPool && runtimeRole) {
      await adminPool.query(`REVOKE product_context_shadow_app FROM ${quoteIdentifier(runtimeRole)}`);
      await adminPool.query(`DROP ROLE IF EXISTS ${quoteIdentifier(runtimeRole)}`);
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
      CUBICA_DEPLOYMENT_TIER: 'test',
      CUBICA_PRODUCT_CONTEXT_SHADOW_KNOWLEDGE_REPOSITORY: repository
    };
  }
});

function quoteIdentifier(value: string): string { return `"${value.replaceAll('"', '""')}"`; }
function quoteLiteral(value: string): string { return `'${value.replaceAll("'", "''")}'`; }
