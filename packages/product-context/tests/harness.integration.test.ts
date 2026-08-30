/**
 * End-to-end evidence for the server-only Stage 1 coordinator.
 *
 * These tests deliberately combine the real isolated PostgreSQL lifecycle
 * with the bare-Git adapter. No model, network gateway, or caller-provided
 * authorization decision participates in a write.
 */
import { randomUUID } from 'node:crypto';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { hashExactPatchProposal } from '../src/contracts.ts';
import { ManagedKnowledgeGit } from '../src/git.ts';
import {
  assertIsolatedHarnessConfig,
  InMemoryConversationStore,
  MutableDecisionAuthority,
  runSyntheticSmoke,
  syntheticContext,
  syntheticGames,
  syntheticPrincipal
} from '../src/harness.ts';
import {
  KnowledgeUnavailableError,
  ProductContextKernel,
  type ConversationMessage,
  type DecisionGate,
  type GateObserver
} from '../src/kernel.ts';
import { knowledgeBodyHash, serializeKnowledgePage, sha256Bytes } from '../src/markdown.ts';
import { ProductContextPostgresStore } from '../src/postgres.ts';
import type { ExactPatchProposal, KnowledgePage, SourceRef } from '../src/generated/product-knowledge.ts';

const databaseUrl = process.env.TEST_PRODUCT_CONTEXT_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const openStores: ManagedKnowledgeGit[] = [];

interface Fixture {
  readonly sql: ProductContextPostgresStore;
  readonly git: ManagedKnowledgeGit;
  readonly conversation: InMemoryConversationStore;
  readonly authority: MutableDecisionAuthority;
  readonly kernel: ProductContextKernel;
  readonly gates: DecisionGate[];
  readonly suffix: string;
}

integration('synthetic Stage 1 PostgreSQL and Git flow', () => {
  let adminPool: Pool;
  let sql: ProductContextPostgresStore;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: databaseUrl, max: 8 });
    const migration = fileURLToPath(new URL('../migrations/001_product_context_stage1.sql', import.meta.url));
    await adminPool.query(await readFile(migration, 'utf8'));
    sql = new ProductContextPostgresStore(adminPool);
  });

  beforeEach(async () => {
    await adminPool.query(`
      TRUNCATE product_context_stage1.knowledge_write_operations,
               product_context_stage1.knowledge_spaces
    `);
  });

  afterEach(async () => {
    await Promise.all(openStores.splice(0).map((store) => store.close()));
  });

  afterAll(async () => {
    await adminPool?.end();
  });

  it('remembers, filters every read path, supports global scope, tombstones sources, and forgets content', async () => {
    const fixture = await createFixture(sql, 'journey');
    const developer = syntheticContext('developer');
    const facilitator = syntheticContext('facilitator');
    const source = sourceMessage(fixture, 'remember', 'developer private control phrase');
    fixture.conversation.put(source);

    const developerPage = page({
      id: `knw_dev_${fixture.suffix}`,
      title: 'Developer hidden title',
      body: 'Developer private control phrase',
      role: 'developer',
      sourceRef: source.ref,
      appliesTo: syntheticGames[0]
    });
    const pendingProposal = createProposal(fixture.git, `notes/dev-${fixture.suffix}.md`, developerPage, source.ref);
    const headBeforePending = fixture.git.head();
    const pending = await fixture.kernel.propose({
      context: developer,
      turn: fixture.kernel.readForTurn(developer, [source.ref]),
      proposal: pendingProposal
    });
    expect(pending.status).toBe('pending_confirmation');
    expect(fixture.git.head()).toBe(headBeforePending);
    await fixture.kernel.confirm(developer, pending.operationId!, pending.patchHash!);
    expect(await fixture.kernel.applyOne(developer)).toBe('applied');
    expect(new Set(fixture.gates)).toEqual(new Set([
      'before_knowledge_exposure',
      'before_operation_persistence',
      'before_git_commit'
    ]));

    // Every discovery path filters the tree before it sees a title, stable ID,
    // path, or body. All denied direct resolutions share one diagnostic.
    expect(decoder.decode(fixture.kernel.read(developer))).toContain('Developer hidden title');
    expect(decoder.decode(fixture.kernel.directRead(developer, developerPage.cubica_id))).toContain('private control phrase');
    const facilitatorIndex = decoder.decode(fixture.kernel.read(facilitator));
    expect(facilitatorIndex).not.toMatch(/Developer hidden title|knw_dev_|private control phrase/);
    expect(fixture.kernel.literalSearch(facilitator, 'Developer hidden title')).toEqual([]);
    expect(fixture.kernel.literalSearch(facilitator, developerPage.cubica_id)).toEqual([]);
    expect(fixture.kernel.literalSearch(facilitator, 'private control phrase')).toEqual([]);
    for (const hiddenRef of [developerPage.cubica_id, `notes/dev-${fixture.suffix}.md`, `cubica://knowledge/page/${developerPage.cubica_id}`]) {
      const resolve = hiddenRef === developerPage.cubica_id
        ? () => fixture.kernel.directRead(facilitator, hiddenRef)
        : () => fixture.kernel.resolveLink(facilitator, hiddenRef);
      expect(resolve).toThrowError(KnowledgeUnavailableError);
      try { resolve(); } catch (error) { expect((error as Error).message).toBe('Knowledge is unavailable for the requested context.'); }
    }

    const globalSource = sourceMessage(fixture, 'global', 'one global preference for all games');
    fixture.conversation.put(globalSource);
    const globalPage = page({
      id: `knw_global_${fixture.suffix}`,
      title: 'Shared global preference',
      body: 'one physical page visible in both roles and games',
      role: 'global',
      sourceRef: globalSource.ref,
      appliesTo: 'cubica://scope/all-user-games'
    });
    const globalProposal = createProposal(fixture.git, `notes/global-${fixture.suffix}.md`, globalPage, globalSource.ref);
    const global = await fixture.kernel.propose({
      context: developer,
      turn: fixture.kernel.readForTurn(developer, [globalSource.ref]),
      proposal: globalProposal
    });
    await fixture.kernel.confirm(developer, global.operationId!, global.patchHash!);
    expect(await fixture.kernel.applyOne(developer)).toBe('applied');
    expect(decoder.decode(fixture.kernel.directRead(developer, globalPage.cubica_id))).toContain('one physical page');
    fixture.authority.state.currentAppliesTo = [syntheticGames[1]];
    expect(decoder.decode(fixture.kernel.directRead(facilitator, globalPage.cubica_id))).toContain('one physical page');

    const operationCountBeforeSecret = await operationCount(adminPool);
    const secretProposal = createProposal(
      fixture.git,
      `notes/secret-${fixture.suffix}.md`,
      page({ id: `knw_secret_${fixture.suffix}`, title: 'Never stored', body: 'api_key=0123456789abcdef0123456789', role: 'developer', sourceRef: source.ref, appliesTo: syntheticGames[1] }),
      source.ref
    );
    const secret = await fixture.kernel.propose({
      context: developer,
      turn: fixture.kernel.readForTurn(developer, [source.ref]),
      proposal: secretProposal
    });
    expect(secret).toMatchObject({ status: 'blocked', reason: 'secret_detected', operationId: null });
    expect(await operationCount(adminPool)).toBe(operationCountBeforeSecret);

    // Applied knowledge remains independently readable after its source is
    // deleted, while a confirmed retry bound to those bytes conflicts.
    fixture.authority.state.currentAppliesTo = [syntheticGames[0]];
    const retryProposal = replaceProposal(fixture.git, `notes/dev-${fixture.suffix}.md`, {
      ...developerPage,
      body: 'must never apply after source deletion'
    }, source.ref);
    const retry = await fixture.kernel.propose({
      context: developer,
      turn: fixture.kernel.readForTurn(developer, [source.ref]),
      proposal: retryProposal
    });
    await fixture.kernel.confirm(developer, retry.operationId!, retry.patchHash!);
    fixture.conversation.tombstone(source.ref, 'revision-2-deleted');
    expect(decoder.decode(fixture.kernel.directRead(developer, developerPage.cubica_id))).toContain('private control phrase');
    expect(await fixture.kernel.applyOne(developer)).toBe('conflict');
    expect((await sql.getOperation(syntheticPrincipal, retry.operationId!))?.status_reason).toBe('read_set_changed');
    expect(await sql.physicalDeleteOperation(syntheticPrincipal, retry.operationId!)).toBe(true);

    const forgetSource = sourceMessage(fixture, 'forget', 'forget the developer private control phrase');
    fixture.conversation.put(forgetSource);
    const forgetProposal = deleteProposal(fixture.git, `notes/dev-${fixture.suffix}.md`, forgetSource.ref);
    fixture.authority.state.automaticApply = true;
    const forget = await fixture.kernel.propose({
      context: developer,
      turn: fixture.kernel.readForTurn(developer, [forgetSource.ref]),
      proposal: forgetProposal
    });
    expect(forget.status).toBe('ready');
    expect(await fixture.kernel.applyOne(developer)).toBe('applied');
    expect(fixture.git.readPages().has(`notes/dev-${fixture.suffix}.md`)).toBe(false);
    expect(decoder.decode(fixture.kernel.read(developer))).not.toContain('Developer hidden title');
    expect(fixture.kernel.literalSearch(developer, 'private control phrase')).toEqual([]);
    expect(() => fixture.kernel.directRead(developer, developerPage.cubica_id)).toThrowError(KnowledgeUnavailableError);
    const forgetRow = await sql.getOperation(syntheticPrincipal, forget.operationId!);
    expect(forgetRow).toMatchObject({ status: 'applied', status_reason: 'payload_purged', patch_payload: null, patch_hash: null });
    const retained = await adminPool.query<{ payload: string }>(`
      SELECT COALESCE(string_agg(patch_payload::text, ''), '') AS payload
      FROM product_context_stage1.knowledge_write_operations
    `);
    expect(retained.rows[0]!.payload).not.toContain('forget the developer private control phrase');
  }, 30_000);

  it('classifies all immutable-envelope drift without resynthesis or Git mutation', async () => {
    const cases = [
      ['authorization_changed', (fixture: Fixture) => { fixture.authority.state.roleOverride = 'facilitator'; }],
      ['policy_changed', (fixture: Fixture) => { fixture.authority.state.accessVersion = 'access-v2'; }],
      ['read_set_changed', (fixture: Fixture, source: ConversationMessage) => {
        // The server hashes actor+bytes independently, so even a faulty future
        // store that keeps the same revision cannot change provenance.
        fixture.conversation.put({ ...source, actor: 'agent' });
      }],
      ['impact_changed', (fixture: Fixture) => { fixture.authority.state.impactRevision = 'impact-v2'; }],
      ['base_revision_changed', (fixture: Fixture, source: ConversationMessage) => {
        const outside = createProposal(
          fixture.git,
          `notes/outside-${fixture.suffix}.md`,
          page({ id: `knw_outside_${fixture.suffix}`, title: 'Concurrent page', body: 'concurrent', role: 'developer', sourceRef: source.ref, appliesTo: syntheticGames[0] }),
          source.ref
        );
        expect(fixture.git.apply(`op_outside_${fixture.suffix}`, outside).status).toBe('applied');
      }]
    ] as const;

    for (const [reason, mutate] of cases) {
      const fixture = await createFixture(sql, reason);
      const source = sourceMessage(fixture, reason, `source ${reason}`);
      fixture.conversation.put(source);
      const proposal = createProposal(
        fixture.git,
        `notes/${reason}-${fixture.suffix}.md`,
        page({ id: `knw_${reason}_${fixture.suffix}`, title: reason, body: reason, role: 'developer', sourceRef: source.ref, appliesTo: syntheticGames[0] }),
        source.ref
      );
      const created = await fixture.kernel.propose({
        context: syntheticContext('developer'),
        turn: fixture.kernel.readForTurn(syntheticContext('developer'), [source.ref]),
        proposal
      });
      await fixture.kernel.confirm(syntheticContext('developer'), created.operationId!, created.patchHash!);
      const before = fixture.git.head();
      mutate(fixture, source);
      const expectedHead = reason === 'base_revision_changed' ? fixture.git.head() : before;
      expect(await fixture.kernel.applyOne(syntheticContext('developer'))).toBe('conflict');
      expect((await sql.getOperation(syntheticPrincipal, created.operationId!))?.status_reason).toBe(reason);
      expect(fixture.git.head()).toBe(expectedHead);
    }
  }, 30_000);

  it('filters stale dependent knowledge from every read path', async () => {
    const fixture = await createFixture(sql, 'stale-dependency');
    const source = sourceMessage(fixture, 'dependency', 'dependency source');
    fixture.conversation.put(source);
    const basis = page({
      id: `knw_basis_${fixture.suffix}`, title: 'Dependency basis', body: 'basis version one',
      role: 'developer', sourceRef: source.ref, appliesTo: syntheticGames[0]
    });
    expect(fixture.git.apply(`op_basis_${fixture.suffix}`, createProposal(
      fixture.git, `notes/basis-${fixture.suffix}.md`, basis, source.ref
    )).status).toBe('applied');
    const derived: KnowledgePage = {
      ...page({
        id: `knw_derived_${fixture.suffix}`, title: 'Derived hidden after drift', body: 'derived conclusion',
        role: 'developer', sourceRef: source.ref, appliesTo: syntheticGames[0]
      }),
      depends_on: [{
        ref: `cubica://knowledge/page/${basis.cubica_id}`,
        relation: 'derives_from',
        content_hash: knowledgeBodyHash(serializeKnowledgePage(basis))
      }]
    };
    expect(fixture.git.apply(`op_derived_${fixture.suffix}`, createProposal(
      fixture.git, `notes/derived-${fixture.suffix}.md`, derived, source.ref
    )).status).toBe('applied');
    const context = syntheticContext('developer');
    expect(decoder.decode(fixture.kernel.directRead(context, derived.cubica_id))).toContain('derived conclusion');

    const changedBasis = { ...basis, body: 'basis version two' };
    expect(fixture.git.apply(`op_basis_change_${fixture.suffix}`, replaceProposal(
      fixture.git, `notes/basis-${fixture.suffix}.md`, changedBasis, source.ref
    )).status).toBe('applied');
    expect(decoder.decode(fixture.kernel.read(context))).not.toContain('Derived hidden after drift');
    expect(fixture.kernel.literalSearch(context, 'derived conclusion')).toEqual([]);
    expect(() => fixture.kernel.directRead(context, derived.cubica_id)).toThrowError(KnowledgeUnavailableError);
    expect(() => fixture.kernel.resolveLink(context, `cubica://knowledge/page/${derived.cubica_id}`)).toThrowError(KnowledgeUnavailableError);
  });

  it('rejects impact drift before persistence and binds an exposed non-source message', async () => {
    const fixture = await createFixture(sql, 'turn-envelope');
    const source = sourceMessage(fixture, 'turn-source', 'the cited source');
    const contextMessage = sourceMessage(fixture, 'turn-context', 'uncited but exposed context');
    fixture.conversation.put(source);
    fixture.conversation.put(contextMessage);
    const proposal = createProposal(
      fixture.git,
      `notes/turn-envelope-${fixture.suffix}.md`,
      page({ id: `knw_turn_${fixture.suffix}`, title: 'Turn envelope', body: 'bound context', role: 'developer', sourceRef: source.ref, appliesTo: syntheticGames[0] }),
      source.ref
    );
    const context = syntheticContext('developer');
    fixture.authority.state.automaticApply = true;

    const staleTurn = fixture.kernel.readForTurn(context, [source.ref, contextMessage.ref]);
    fixture.authority.state.impactRevision = 'impact-v2-before-persistence';
    const rejected = await fixture.kernel.propose({
      context,
      turn: staleTurn,
      proposal
    });
    expect(rejected).toMatchObject({ status: 'conflict', reason: 'impact_changed', operationId: null });
    expect(await operationCount(adminPool)).toBe(0);

    fixture.authority.state.retentionDecision = 'deny';
    const noRetentionTurn = fixture.kernel.readForTurn(context, [source.ref, contextMessage.ref]);
    const retentionRejected = await fixture.kernel.propose({
      context,
      turn: noRetentionTurn,
      proposal
    });
    expect(retentionRejected).toMatchObject({ status: 'conflict', reason: 'authorization_changed', operationId: null });
    expect(await operationCount(adminPool)).toBe(0);

    fixture.authority.state.retentionDecision = 'allow';
    const currentTurn = fixture.kernel.readForTurn(context, [source.ref, contextMessage.ref]);
    const created = await fixture.kernel.propose({
      context,
      turn: currentTurn,
      proposal
    });
    expect(created.status).toBe('ready');
    fixture.conversation.put({ ...contextMessage, revision: 'revision-2-context' });
    expect(await fixture.kernel.applyOne(context)).toBe('conflict');
    expect((await sql.getOperation(syntheticPrincipal, created.operationId!))?.status_reason).toBe('read_set_changed');
    expect(fixture.git.readPages().has(`notes/turn-envelope-${fixture.suffix}.md`)).toBe(false);
  }, 20_000);

  it('requires semantic review only for the current deterministic impact trigger', async () => {
    const fixture = await createFixture(sql, 'review');
    const source = sourceMessage(fixture, 'review', 'review source');
    fixture.conversation.put(source);
    fixture.authority.state.impactReviewRequired = true;
    fixture.authority.state.impactReasons = ['current deterministic overlap'];
    const proposal = createProposal(
      fixture.git,
      `notes/review-${fixture.suffix}.md`,
      page({ id: `knw_review_${fixture.suffix}`, title: 'Review', body: 'review', role: 'developer', sourceRef: source.ref, appliesTo: syntheticGames[0] }),
      source.ref
    );
    const created = await fixture.kernel.propose({
      context: syntheticContext('developer'),
      turn: fixture.kernel.readForTurn(syntheticContext('developer'), [source.ref]),
      proposal
    });
    await fixture.kernel.confirm(syntheticContext('developer'), created.operationId!, created.patchHash!);
    expect(await fixture.kernel.applyOne(syntheticContext('developer'))).toBe('conflict');
    expect((await sql.getOperation(syntheticPrincipal, created.operationId!))?.status_reason).toBe('requires_extended_review');

    const safeFixture = await createFixture(sql, 'safe');
    const safeSource = sourceMessage(safeFixture, 'safe', 'safe source');
    safeFixture.conversation.put(safeSource);
    const safeProposal = createProposal(
      safeFixture.git,
      `notes/safe-${safeFixture.suffix}.md`,
      page({ id: `knw_safe_${safeFixture.suffix}`, title: 'Safe', body: 'safe', role: 'developer', sourceRef: safeSource.ref, appliesTo: syntheticGames[0] }),
      safeSource.ref
    );
    safeFixture.authority.state.automaticApply = true;
    const safe = await safeFixture.kernel.propose({
      context: syntheticContext('developer'), turn: safeFixture.kernel.readForTurn(syntheticContext('developer'), [safeSource.ref]),
      proposal: safeProposal
    });
    expect(safe.status).toBe('ready');
    expect(await safeFixture.kernel.applyOne(syntheticContext('developer'))).toBe('applied');

    const malformedFixture = await createFixture(sql, 'malformed-review');
    const malformedSource = sourceMessage(malformedFixture, 'malformed-review', 'malformed review source');
    malformedFixture.conversation.put(malformedSource);
    malformedFixture.authority.state.impactReviewRequired = true;
    malformedFixture.authority.state.semanticReviewOutcome = 'no_issue';
    malformedFixture.authority.state.malformedSemanticReview = true;
    const malformedProposal = createProposal(
      malformedFixture.git,
      `notes/malformed-review-${malformedFixture.suffix}.md`,
      page({ id: `knw_malformed_${malformedFixture.suffix}`, title: 'Malformed review', body: 'must remain blocked', role: 'developer', sourceRef: malformedSource.ref, appliesTo: syntheticGames[0] }),
      malformedSource.ref
    );
    malformedFixture.authority.state.automaticApply = true;
    const malformed = await malformedFixture.kernel.propose({
      context: syntheticContext('developer'), turn: malformedFixture.kernel.readForTurn(syntheticContext('developer'), [malformedSource.ref]),
      proposal: malformedProposal
    });
    await malformedFixture.kernel.confirm(syntheticContext('developer'), malformed.operationId!, malformed.patchHash!);
    expect(await malformedFixture.kernel.applyOne(syntheticContext('developer'))).toBe('conflict');
    expect((await sql.getOperation(syntheticPrincipal, malformed.operationId!))?.status_reason).toBe('requires_extended_review');

    const reviewedFixture = await createFixture(sql, 'reviewed');
    const reviewedSource = sourceMessage(reviewedFixture, 'reviewed', 'reviewed source');
    reviewedFixture.conversation.put(reviewedSource);
    reviewedFixture.authority.state.impactReviewRequired = true;
    reviewedFixture.authority.state.semanticReviewOutcome = 'no_issue';
    const reviewedProposal = createProposal(
      reviewedFixture.git,
      `notes/reviewed-${reviewedFixture.suffix}.md`,
      page({ id: `knw_reviewed_${reviewedFixture.suffix}`, title: 'Reviewed', body: 'reviewed', role: 'developer', sourceRef: reviewedSource.ref, appliesTo: syntheticGames[0] }),
      reviewedSource.ref
    );
    const reviewed = await reviewedFixture.kernel.propose({
      context: syntheticContext('developer'), turn: reviewedFixture.kernel.readForTurn(syntheticContext('developer'), [reviewedSource.ref]),
      proposal: reviewedProposal
    });
    await reviewedFixture.kernel.confirm(syntheticContext('developer'), reviewed.operationId!, reviewed.patchHash!);
    expect(await reviewedFixture.kernel.applyOne(syntheticContext('developer'))).toBe('applied');
  }, 20_000);

  it('recovers an exact Git receipt after the ref moved but before SQL recorded it', async () => {
    const fixture = await createFixture(sql, 'recovery');
    const source = sourceMessage(fixture, 'recovery', 'recovery source');
    fixture.conversation.put(source);
    const proposal = createProposal(
      fixture.git,
      `notes/recovery-${fixture.suffix}.md`,
      page({ id: `knw_recovery_${fixture.suffix}`, title: 'Recovery', body: 'exactly once', role: 'developer', sourceRef: source.ref, appliesTo: syntheticGames[0] }),
      source.ref
    );
    fixture.authority.state.automaticApply = true;
    const created = await fixture.kernel.propose({
      context: syntheticContext('developer'), turn: fixture.kernel.readForTurn(syntheticContext('developer'), [source.ref]),
      proposal
    });
    await expect(fixture.kernel.applyOne(syntheticContext('developer'), {
      afterGitRefBeforeSql: () => { throw new Error('simulated process death after ref update'); }
    })).rejects.toThrow('simulated process death');
    const commit = fixture.git.head();
    expect((await sql.getOperation(syntheticPrincipal, created.operationId!))?.status).toBe('applying');
    expect(fixture.git.findReachableReceipt(created.operationId!, proposal.patch_hash)).toBe(commit);
    expect(fixture.git.findReachableReceipt(created.operationId!, `sha256:${'0'.repeat(64)}`)).toBeNull();

    expect(await fixture.kernel.recoverAndPurge(syntheticContext('developer'), new Date(Date.now() + 60_000))).toBe(1);
    expect(await sql.getOperation(syntheticPrincipal, created.operationId!)).toMatchObject({
      status: 'applied', status_reason: 'payload_purged', commit_sha: commit,
      patch_payload: null, patch_hash: null
    });
    expect(fixture.git.apply(created.operationId!, proposal)).toEqual({ status: 'replayed', commit });
    expect(fixture.git.head()).toBe(commit);
  }, 20_000);

  it('garbage-collects a crash after SQL applied but before payload purge', async () => {
    const fixture = await createFixture(sql, 'post-sql-purge');
    const source = sourceMessage(fixture, 'post-sql-purge', 'post-SQL purge source');
    fixture.conversation.put(source);
    const proposal = createProposal(
      fixture.git,
      `notes/post-sql-purge-${fixture.suffix}.md`,
      page({ id: `knw_post_sql_${fixture.suffix}`, title: 'Post SQL purge', body: 'content must be collected', role: 'developer', sourceRef: source.ref, appliesTo: syntheticGames[0] }),
      source.ref
    );
    const context = syntheticContext('developer');
    fixture.authority.state.automaticApply = true;
    const created = await fixture.kernel.propose({
      context, turn: fixture.kernel.readForTurn(context, [source.ref]), proposal,
    });
    await expect(fixture.kernel.applyOne(context, {
      afterSqlAppliedBeforePurge: () => { throw new Error('simulated process death after SQL applied'); }
    })).rejects.toThrow('simulated process death');
    expect(await sql.getOperation(syntheticPrincipal, created.operationId!)).toMatchObject({ status: 'applied', status_reason: 'applied' });
    expect(await fixture.kernel.recoverAndPurge(context)).toBe(1);
    expect(await sql.getOperation(syntheticPrincipal, created.operationId!)).toMatchObject({
      status: 'applied', status_reason: 'payload_purged', patch_payload: null, patch_hash: null
    });
  }, 20_000);

  it('purges existing applied content even when Git receipt recovery fails', async () => {
    const fixture = await createFixture(sql, 'purge-before-recovery');
    const context = syntheticContext('developer');
    fixture.authority.state.automaticApply = true;

    const appliedSource = sourceMessage(fixture, 'applied-before-failure', 'content waiting for purge');
    fixture.conversation.put(appliedSource);
    const appliedProposal = createProposal(
      fixture.git,
      `notes/applied-before-failure-${fixture.suffix}.md`,
      page({ id: `knw_applied_before_failure_${fixture.suffix}`, title: 'Applied before failure', body: 'must still be purged', role: 'developer', sourceRef: appliedSource.ref, appliesTo: syntheticGames[0] }),
      appliedSource.ref
    );
    const applied = await fixture.kernel.propose({
      context, turn: fixture.kernel.readForTurn(context, [appliedSource.ref]), proposal: appliedProposal
    });
    expect(await fixture.kernel.applyOne(context, { purgePayload: false })).toBe('applied');
    const appliedBeforePurge = await sql.getOperation(syntheticPrincipal, applied.operationId!);
    expect(appliedBeforePurge).toMatchObject({ status: 'applied', status_reason: 'applied' });
    expect(appliedBeforePurge?.payload_purged_at).toBeUndefined();

    const recoveringSource = sourceMessage(fixture, 'recovery-failure', 'operation with unavailable receipt lookup');
    fixture.conversation.put(recoveringSource);
    const recoveringProposal = createProposal(
      fixture.git,
      `notes/recovery-failure-${fixture.suffix}.md`,
      page({ id: `knw_recovery_failure_${fixture.suffix}`, title: 'Recovery failure', body: 'receipt lookup fails', role: 'developer', sourceRef: recoveringSource.ref, appliesTo: syntheticGames[0] }),
      recoveringSource.ref
    );
    const recovering = await fixture.kernel.propose({
      context, turn: fixture.kernel.readForTurn(context, [recoveringSource.ref]), proposal: recoveringProposal
    });
    await expect(fixture.kernel.applyOne(context, {
      afterGitRefBeforeSql: () => { throw new Error('simulated process death before SQL receipt'); }
    })).rejects.toThrow('simulated process death');
    expect((await sql.getOperation(syntheticPrincipal, recovering.operationId!))?.status).toBe('applying');

    vi.spyOn(fixture.git, 'findReachableReceipt').mockImplementation(() => {
      throw new Error('simulated Git receipt outage');
    });
    await expect(fixture.kernel.recoverAndPurge(context, new Date(Date.now() + 60_000)))
      .rejects.toThrow('simulated Git receipt outage');
    expect(await sql.getOperation(syntheticPrincipal, applied.operationId!)).toMatchObject({
      status: 'applied', status_reason: 'payload_purged', patch_payload: null, patch_hash: null
    });
  }, 20_000);

  it('rejects schema-valid role, global, and other-game payloads at persistence and again before Git', async () => {
    const fixture = await createFixture(sql, 'smuggle');
    const source = sourceMessage(fixture, 'smuggle', 'developer request');
    fixture.conversation.put(source);
    const before = fixture.git.head();
    const incompatiblePages = [
      page({ id: `knw_role_${fixture.suffix}`, title: 'Facilitator-only payload', body: 'must not pass', role: 'facilitator', sourceRef: source.ref, appliesTo: syntheticGames[0] }),
      page({ id: `knw_game_${fixture.suffix}`, title: 'Other-game payload', body: 'must not pass', role: 'developer', sourceRef: source.ref, appliesTo: syntheticGames[1] }),
      page({ id: `knw_global_${fixture.suffix}`, title: 'Unconfirmed global payload', body: 'must not pass', role: 'global', sourceRef: source.ref, appliesTo: 'cubica://scope/all-user-games' })
    ];
    fixture.authority.state.globalConfirmed = false;
    for (const [index, incompatible] of incompatiblePages.entries()) {
      const smuggled = createProposal(fixture.git, `notes/smuggle-${index}-${fixture.suffix}.md`, incompatible, source.ref);
      const result = await fixture.kernel.propose({
        context: syntheticContext('developer'), turn: fixture.kernel.readForTurn(syntheticContext('developer'), [source.ref]),
        proposal: smuggled
      });
      expect(result).toMatchObject({ status: 'conflict', reason: 'authorization_changed', operationId: null });
      expect(fixture.git.head()).toBe(before);
    }
    expect(await operationCount(adminPool)).toBe(0);

    // A decision can also become incompatible after exact confirmation. Gate
    // 3 repeats the page preview before any ref mutation instead of trusting
    // the earlier persistence decision.
    fixture.authority.state.globalConfirmed = true;
    const globalPage = page({
      id: `knw_recheck_${fixture.suffix}`, title: 'Initially confirmed global page', body: 'must be rechecked',
      role: 'global', sourceRef: source.ref, appliesTo: 'cubica://scope/all-user-games'
    });
    const proposal = createProposal(fixture.git, `notes/recheck-${fixture.suffix}.md`, globalPage, source.ref);
    const created = await fixture.kernel.propose({
      context: syntheticContext('developer'), turn: fixture.kernel.readForTurn(syntheticContext('developer'), [source.ref]),
      proposal
    });
    await fixture.kernel.confirm(syntheticContext('developer'), created.operationId!, created.patchHash!);
    fixture.authority.state.globalConfirmed = false;
    expect(await fixture.kernel.applyOne(syntheticContext('developer'))).toBe('conflict');
    expect((await sql.getOperation(syntheticPrincipal, created.operationId!))?.status_reason).toBe('authorization_changed');
    expect(fixture.git.head()).toBe(before);
  });

  it('runs the actual guarded synthetic smoke without external processing', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'cubica-stage1-smoke-'));
    const gitRoot = join(parent, 'synthetic-stage1.git');
    await expect(assertIsolatedHarnessConfig({
      databaseUrl: databaseUrl!, gitRoot, syntheticOnly: false, denyExternalProcessing: true
    })).rejects.toThrow('explicit synthetic-only');
    const result = await runSyntheticSmoke({
      databaseUrl: databaseUrl!, gitRoot, syntheticOnly: true, denyExternalProcessing: true
    });
    expect(result).toEqual({ remembered: true, corrected: true, forgotten: true, semanticCommits: 3 });
  }, 30_000);
});

async function createFixture(sql: ProductContextPostgresStore, label: string): Promise<Fixture> {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const spaceId = `space_${label}_${suffix}`;
  await sql.createSpace(syntheticPrincipal, {
    spaceId,
    subjectRef: 'cubica://scope/all-user-games',
    trustZoneRef: 'stage1-isolated',
    accessPolicyRef: 'access-v1',
    retentionPolicyRef: 'retention-v1',
    repositoryRef: `isolated-git://${suffix}`
  });
  const root = await mkdtemp(join(tmpdir(), `cubica-stage1-${label}-`));
  const git = await ManagedKnowledgeGit.init(join(root, 'knowledge.git'));
  openStores.push(git);
  const conversation = new InMemoryConversationStore();
  const authority = new MutableDecisionAuthority(spaceId);
  const gates: DecisionGate[] = [];
  const observer: GateObserver = { entered: (gate) => { gates.push(gate); } };
  return {
    sql, git, conversation, authority,
    kernel: new ProductContextKernel(sql, git, conversation, authority, observer),
    gates, suffix
  };
}

function sourceMessage(fixture: Fixture, label: string, text: string): ConversationMessage {
  return {
    ref: `cubica://dialog/test/message/${fixture.suffix}-${label}`,
    revision: 'revision-1', actor: 'user', bytes: encoder.encode(text), tombstone: false
  };
}

function page(input: {
  id: string;
  title: string;
  body: string;
  role: KnowledgePage['role_scope'];
  sourceRef: string;
  appliesTo: string;
}): KnowledgePage {
  return {
    schema_version: '1.0.0', type: 'note', title: input.title,
    description: `${input.title} description`, timestamp: '2026-08-09T10:00:00.000Z',
    cubica_id: input.id, role_scope: input.role,
    source_refs: [{ ref: input.sourceRef, use: 'evidence' }],
    applies_to: [input.appliesTo] as never, body: input.body
  };
}

function createProposal(git: ManagedKnowledgeGit, path: string, nextPage: KnowledgePage, sourceRef: string): ExactPatchProposal {
  const refs: SourceRef[] = [{ ref: sourceRef, use: 'evidence' }];
  return finalize({
    schema_version: '1.0.0', proposal_id: `prop_${randomUUID().replaceAll('-', '')}`,
    base_commit: git.head(), patch_hash: '', source_refs: refs,
    applies_to: [...nextPage.applies_to],
    operations: [{
      kind: 'create_file', path, new_text: decoder.decode(serializeKnowledgePage(nextPage)),
      reason: 'Synthetic exact create', source_refs: refs
    }]
  });
}

function replaceProposal(git: ManagedKnowledgeGit, path: string, nextPage: KnowledgePage, sourceRef: string): ExactPatchProposal {
  const current = git.readPages().get(path)!;
  const refs: SourceRef[] = [{ ref: sourceRef, use: 'evidence' }];
  return finalize({
    schema_version: '1.0.0', proposal_id: `prop_${randomUUID().replaceAll('-', '')}`,
    base_commit: git.head(), patch_hash: '', source_refs: refs,
    applies_to: [...nextPage.applies_to],
    operations: [{
      kind: 'replace_exact', path, base_file_hash: sha256Bytes(current),
      old_text: decoder.decode(current), old_text_hash: sha256Bytes(current),
      new_text: decoder.decode(serializeKnowledgePage(nextPage)), expected_matches: 1,
      reason: 'Synthetic exact replacement', source_refs: refs
    }]
  });
}

function deleteProposal(git: ManagedKnowledgeGit, path: string, sourceRef: string): ExactPatchProposal {
  const current = git.readPages().get(path)!;
  const refs: SourceRef[] = [{ ref: sourceRef, use: 'confirmation' }];
  return finalize({
    schema_version: '1.0.0', proposal_id: `prop_${randomUUID().replaceAll('-', '')}`,
    base_commit: git.head(), patch_hash: '', source_refs: refs,
    applies_to: [syntheticGames[0]] as never,
    operations: [{
      kind: 'delete_exact', path, base_file_hash: sha256Bytes(current),
      old_text: decoder.decode(current), old_text_hash: sha256Bytes(current), expected_matches: 1,
      reason: 'Synthetic exact logical forget', source_refs: refs
    }]
  });
}

function finalize(proposal: ExactPatchProposal): ExactPatchProposal {
  proposal.patch_hash = hashExactPatchProposal(proposal);
  return proposal;
}

async function operationCount(pool: Pool): Promise<number> {
  const result = await pool.query<{ count: string }>('SELECT count(*) FROM product_context_stage1.knowledge_write_operations');
  return Number(result.rows[0]!.count);
}
