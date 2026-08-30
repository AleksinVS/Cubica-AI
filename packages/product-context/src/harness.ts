/**
 * Synthetic-only authority, conversation fixtures and manual Stage 1 smoke.
 *
 * This module has no model or external-processing port. The only network
 * client is the explicitly isolated local PostgreSQL connection supplied by
 * the operator.
 */
import { randomUUID } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isAbsolute, resolve } from 'node:path';
import { Pool } from 'pg';

import { hashExactPatchProposal } from './contracts.ts';
import { ManagedKnowledgeGit } from './git.ts';
import {
  ProductContextKernel,
  type AuthorityDecisionSnapshot,
  type ConversationMessage,
  type ConversationStore,
  type DecisionAuthority,
  type KernelContext
} from './kernel.ts';
import { serializeKnowledgePage, sha256Bytes } from './markdown.ts';
import { ProductContextPostgresStore } from './postgres.ts';
import type { ExactPatchProposal, KnowledgePage } from './generated/product-knowledge.ts';

export const syntheticPrincipal = 'cubica://user/synthetic-stage1';
export const syntheticGames = ['cubica://game-project/one', 'cubica://game-project/two'] as const;

export class InMemoryConversationStore implements ConversationStore {
  private readonly messages: Map<string, ConversationMessage>;
  constructor(messages: ReadonlyMap<string, ConversationMessage> = new Map()) { this.messages = new Map(messages); }
  resolve(ref: string): ConversationMessage | null {
    const message = this.messages.get(ref);
    return message ? { ...message, bytes: message.bytes ? new Uint8Array(message.bytes) : null } : null;
  }
  put(message: ConversationMessage): void { this.messages.set(message.ref, { ...message, bytes: message.bytes ? new Uint8Array(message.bytes) : null }); }
  /** Keeps actor and a new record revision but removes every source byte. */
  tombstone(ref: string, revision: string): void {
    const existing = this.messages.get(ref);
    if (!existing) throw new Error('Cannot tombstone an unknown synthetic message.');
    this.messages.set(ref, { ref, revision, actor: existing.actor, bytes: null, tombstone: true });
  }
}

export interface MutableAuthorityState {
  principalRef: string;
  roleOverride: 'developer' | 'facilitator' | null;
  spaceId: string;
  knownAppliesTo: string[];
  currentAppliesTo: string[];
  allUserGamesConfirmed: boolean;
  globalConfirmed: boolean;
  accessDecision: 'allow' | 'deny';
  accessVersion: string;
  retentionDecision: 'allow' | 'deny';
  retentionVersion: string;
  externalDecision: 'allow' | 'deny';
  externalVersion: string;
  impactRevision: string;
  impactReviewRequired: boolean;
  impactReasons: string[];
  automaticApply: boolean;
  semanticReviewOutcome: 'no_issue' | null;
  malformedSemanticReview: boolean;
}

/** Narrow mutable authority used to inject one server-decision drift at a time. */
export class MutableDecisionAuthority implements DecisionAuthority {
  readonly state: MutableAuthorityState;
  constructor(spaceId = 'space_synthetic') {
    this.state = {
      principalRef: syntheticPrincipal,
      roleOverride: null,
      spaceId,
      knownAppliesTo: [...syntheticGames, 'cubica://scope/all-user-games'],
      currentAppliesTo: [syntheticGames[0]],
      allUserGamesConfirmed: true,
      globalConfirmed: true,
      accessDecision: 'allow',
      accessVersion: 'access-v1',
      retentionDecision: 'allow',
      retentionVersion: 'retention-v1',
      externalDecision: 'deny',
      externalVersion: 'external-v1',
      impactRevision: 'impact-v1',
      impactReviewRequired: false,
      impactReasons: [],
      automaticApply: false,
      semanticReviewOutcome: null,
      malformedSemanticReview: false
    };
  }
  current(context: KernelContext): AuthorityDecisionSnapshot {
    const role = this.state.roleOverride ?? context.role;
    return {
      principalRef: this.state.principalRef,
      role,
      spaceId: this.state.spaceId,
      policy: {
        role,
        knownAppliesTo: new Set(this.state.knownAppliesTo),
        currentAppliesTo: new Set(this.state.currentAppliesTo),
        allUserGamesConfirmed: this.state.allUserGamesConfirmed,
        globalConfirmed: this.state.globalConfirmed
      },
      policyDecisions: {
        access: { decision: this.state.accessDecision, version: this.state.accessVersion },
        retention: { decision: this.state.retentionDecision, version: this.state.retentionVersion },
        external_processing: { decision: this.state.externalDecision, version: this.state.externalVersion }
      },
      impact: {
        revision: this.state.impactRevision,
        reviewRequired: this.state.impactReviewRequired,
        reasons: [...this.state.impactReasons]
      }
    };
  }

  /**
   * Synthetic server-owned classifier. It reads the exact resolved source;
   * the tool caller cannot submit booleans or replacement confirmation text.
   */
  classifyWrite(_context: KernelContext, proposal: ExactPatchProposal, sources: readonly ConversationMessage[]) {
    const userMessage = sources.find((source) => source.actor === 'user' && source.bytes !== null);
    const text = userMessage?.bytes ? new TextDecoder('utf-8', { fatal: true }).decode(userMessage.bytes) : '';
    const localOnly = !proposal.applies_to.includes('cubica://scope/all-user-games');
    return {
      exactLocalCommand: this.state.automaticApply,
      unambiguous: this.state.automaticApply,
      localOnly,
      requiresImpactReview: this.state.impactReviewRequired || this.state.impactReasons.length > 0,
      text
    };
  }

  reviewImpact(input: { operationId: string; patchHash: string; impactHash: string }) {
    if (!this.state.semanticReviewOutcome) return null;
    if (this.state.malformedSemanticReview) return { outcome: this.state.semanticReviewOutcome } as never;
    return {
      schema_version: '1.0.0' as const,
      review_id: `review_${input.operationId.slice(3)}`,
      operation_id: input.operationId,
      patch_hash: input.patchHash as `sha256:${string}`,
      impact_hash: input.impactHash as `sha256:${string}`,
      outcome: this.state.semanticReviewOutcome,
      related_refs: [],
      checked_at: new Date().toISOString()
    };
  }
}

export function syntheticContext(role: 'developer' | 'facilitator'): KernelContext {
  return { principalRef: syntheticPrincipal, role };
}

export interface IsolatedHarnessConfig {
  readonly databaseUrl: string;
  readonly gitRoot: string;
  readonly syntheticOnly: boolean;
  readonly denyExternalProcessing: boolean;
}

/** Refuses fallbacks, remote databases, existing paths and implicit safety flags. */
export async function assertIsolatedHarnessConfig(config: IsolatedHarnessConfig): Promise<void> {
  if (!config.syntheticOnly || !config.denyExternalProcessing) throw new Error('Refusing: explicit synthetic-only and external-processing deny flags are required.');
  let database: URL;
  try { database = new URL(config.databaseUrl); }
  catch { throw new Error('Refusing: an isolated Stage 1 database URL is required.'); }
  // node-postgres gives connection-string query parameters (including host)
  // precedence over the URL authority. Stage 1 needs no query option, so
  // rejecting all of them closes remote-host and TLS-policy overrides at once.
  if (database.search !== '' || database.hash !== '' ||
      !['postgres:', 'postgresql:'].includes(database.protocol) ||
      !['127.0.0.1', 'localhost', '::1'].includes(database.hostname) ||
      database.pathname !== '/product_context_stage1') {
    throw new Error('Refusing: the exact local Stage 1 database is required.');
  }
  if (!isAbsolute(config.gitRoot) || resolve(config.gitRoot) !== config.gitRoot || !/stage1|synthetic/i.test(config.gitRoot)) {
    throw new Error('Refusing: a fresh absolute synthetic Git root is required.');
  }
  try {
    await lstat(config.gitRoot);
    throw new Error('Refusing: the synthetic Git root must not already exist.');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
}

export interface SyntheticSmokeResult {
  readonly remembered: boolean;
  readonly corrected: boolean;
  readonly forgotten: boolean;
  readonly semanticCommits: number;
}

/** Runs remember → next-turn read → correction → logical forget without a model or network gateway. */
export async function runSyntheticSmoke(config: IsolatedHarnessConfig): Promise<SyntheticSmokeResult> {
  await assertIsolatedHarnessConfig(config);
  const pool = new Pool({ connectionString: config.databaseUrl, max: 4 });
  let git: ManagedKnowledgeGit | undefined;
  try {
    const migration = fileURLToPath(new URL('../migrations/001_product_context_stage1.sql', import.meta.url));
    await pool.query(await readFile(migration, 'utf8'));
    const suffix = randomUUID().replaceAll('-', '');
    const spaceId = `space_smoke_${suffix}`;
    const sql = new ProductContextPostgresStore(pool);
    await sql.createSpace(syntheticPrincipal, {
      spaceId,
      subjectRef: 'cubica://scope/all-user-games',
      trustZoneRef: 'stage1-isolated',
      accessPolicyRef: 'access-v1',
      retentionPolicyRef: 'retention-v1',
      repositoryRef: `isolated-git://${suffix}`
    });
    git = await ManagedKnowledgeGit.init(config.gitRoot);
    const conversation = new InMemoryConversationStore();
    const authority = new MutableDecisionAuthority(spaceId);
    authority.state.automaticApply = true;
    const kernel = new ProductContextKernel(sql, git, conversation, authority);
    const context = syntheticContext('developer');

    const rememberRef = `cubica://dialog/smoke/message/${suffix}-remember`;
    conversation.put(message(rememberRef, '1', 'remember the synthetic control phrase'));
    const initialPage = knowledgePage('knw_smoke', 'Synthetic smoke', 'synthetic control phrase', rememberRef);
    const rememberedProposal = finalizeProposal({
      schema_version: '1.0.0', proposal_id: `prop_${suffix}_remember`, base_commit: git.head(), patch_hash: '',
      source_refs: [{ ref: rememberRef, use: 'evidence' }], applies_to: [syntheticGames[0]] as never,
      operations: [{ kind: 'create_file', path: 'notes/smoke.md', new_text: new TextDecoder().decode(serializeKnowledgePage(initialPage)), reason: 'Synthetic remember', source_refs: [{ ref: rememberRef, use: 'evidence' }] }]
    });
    const remember = await kernel.propose({ context, turn: kernel.readForTurn(context, [rememberRef]), proposal: rememberedProposal });
    if (remember.status !== 'ready' || await kernel.applyOne(context) !== 'applied') throw new Error('Synthetic remember flow failed.');
    const remembered = new TextDecoder().decode(kernel.directRead(context, 'knw_smoke')).includes('synthetic control phrase');

    const correctionRef = `cubica://dialog/smoke/message/${suffix}-correct`;
    conversation.put(message(correctionRef, '1', 'correct the synthetic phrase'));
    const currentBytes = git.readPages().get('notes/smoke.md')!;
    const correctedPage = { ...initialPage, body: 'corrected synthetic phrase', source_refs: [...initialPage.source_refs, { ref: correctionRef, use: 'confirmation' as const }] };
    const correctedProposal = finalizeProposal({
      schema_version: '1.0.0', proposal_id: `prop_${suffix}_correct`, base_commit: git.head(), patch_hash: '',
      source_refs: [{ ref: correctionRef, use: 'confirmation' }], applies_to: [syntheticGames[0]] as never,
      operations: [{ kind: 'replace_exact', path: 'notes/smoke.md', base_file_hash: sha256Bytes(currentBytes), old_text: new TextDecoder().decode(currentBytes), old_text_hash: sha256Bytes(currentBytes), new_text: new TextDecoder().decode(serializeKnowledgePage(correctedPage)), expected_matches: 1, reason: 'Synthetic correction', source_refs: [{ ref: correctionRef, use: 'confirmation' }] }]
    });
    const correction = await kernel.propose({ context, turn: kernel.readForTurn(context, [correctionRef]), proposal: correctedProposal });
    if (correction.status !== 'ready' || await kernel.applyOne(context) !== 'applied') throw new Error('Synthetic correction flow failed.');
    const corrected = new TextDecoder().decode(kernel.directRead(context, 'knw_smoke')).includes('corrected synthetic phrase');

    const forgetRef = `cubica://dialog/smoke/message/${suffix}-forget`;
    conversation.put(message(forgetRef, '1', 'forget the synthetic page'));
    const forgetBytes = git.readPages().get('notes/smoke.md')!;
    const forgetProposal = finalizeProposal({
      schema_version: '1.0.0', proposal_id: `prop_${suffix}_forget`, base_commit: git.head(), patch_hash: '',
      source_refs: [{ ref: forgetRef, use: 'confirmation' }], applies_to: [syntheticGames[0]] as never,
      operations: [{ kind: 'delete_exact', path: 'notes/smoke.md', base_file_hash: sha256Bytes(forgetBytes), old_text: new TextDecoder().decode(forgetBytes), old_text_hash: sha256Bytes(forgetBytes), expected_matches: 1, reason: 'Synthetic logical forget', source_refs: [{ ref: forgetRef, use: 'confirmation' }] }]
    });
    const forget = await kernel.propose({ context, turn: kernel.readForTurn(context, [forgetRef]), proposal: forgetProposal });
    if (forget.status !== 'ready' || await kernel.applyOne(context) !== 'applied') throw new Error('Synthetic forget flow failed.');
    const forgotten = !new TextDecoder().decode(kernel.read(context)).includes('synthetic') && !git.readPages().has('notes/smoke.md');
    return { remembered, corrected, forgotten, semanticCommits: 3 };
  } finally {
    await git?.close();
    await pool.end();
  }
}

function message(ref: string, revision: string, text: string): ConversationMessage {
  return { ref, revision, actor: 'user', bytes: new TextEncoder().encode(text), tombstone: false };
}
function knowledgePage(id: string, title: string, body: string, sourceRef: string): KnowledgePage {
  return {
    schema_version: '1.0.0', type: 'note', title, description: 'Synthetic Stage 1 smoke knowledge.',
    timestamp: '2026-08-09T10:00:00.000Z', cubica_id: id, role_scope: 'developer',
    source_refs: [{ ref: sourceRef, use: 'evidence' }], applies_to: [syntheticGames[0]] as never, body
  };
}
function finalizeProposal(proposal: ExactPatchProposal): ExactPatchProposal {
  proposal.patch_hash = hashExactPatchProposal(proposal);
  return proposal;
}
