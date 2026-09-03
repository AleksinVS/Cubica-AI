/**
 * Server-only Stage 1 knowledge coordinator.
 *
 * The kernel has exactly three named decision gates: before knowledge is
 * exposed, before a proposal is persisted, and before Git is mutated. Every
 * gate reads a fresh server authority snapshot; no caller-supplied policy or
 * model output can replace it. Drift is terminal for an existing operation and
 * never triggers hidden resynthesis.
 */
import { randomUUID } from 'node:crypto';

import {
  hashCanonicalPayloadSync,
  validateProductKnowledgeContract,
  verifyExactPatchProposalHash
} from './contracts.ts';
import { ManagedKnowledgeGit, type GitPatchPreview } from './git.ts';
import {
  generateKnowledgeIndex,
  knowledgeBodyHash,
  parseKnowledgePage,
  sha256Bytes
} from './markdown.ts';
import {
  classifyWriteDisposition,
  evaluateKnowledgePageRead,
  evaluateProposalPolicy,
  type AutomaticApplyEvidence,
  type KnowledgePolicyContext,
  type ResolvedSource
} from './policy.ts';
import { ProductContextPostgresStore } from './postgres.ts';
import type {
  DecisionEnvelope,
  ExactPatchProposal,
  KnowledgePage,
  ReadSetEntry,
  SemanticReviewResult,
  SourceRef
} from './generated/product-knowledge.ts';

export const unavailable = 'Knowledge is unavailable for the requested context.';
export type DecisionGate =
  | 'before_knowledge_exposure'
  | 'before_operation_persistence'
  | 'before_git_commit';

/** Revision should cover the complete actor+bytes record, not only text. */
export interface ConversationMessage {
  readonly ref: string;
  readonly revision: string;
  readonly actor: 'user' | 'agent' | 'domain';
  readonly bytes: Uint8Array | null;
  readonly tombstone: boolean;
}
export interface ConversationStore { resolve(ref: string): ConversationMessage | null; }

export interface KernelContext {
  readonly principalRef: string;
  readonly role: 'developer' | 'facilitator';
}

export interface DeterministicImpactSnapshot {
  readonly revision: string;
  readonly reviewRequired: boolean;
  readonly reasons: readonly string[];
}

export interface AuthorityDecisionSnapshot {
  readonly principalRef: string;
  readonly role: 'developer' | 'facilitator';
  readonly spaceId: string;
  readonly policy: KnowledgePolicyContext;
  readonly policyDecisions: DecisionEnvelope['policy_decisions'];
  readonly impact: DeterministicImpactSnapshot;
}

/** Mutable implementations are allowed only as synthetic test authorities. */
export interface DecisionAuthority {
  current(context: KernelContext): AuthorityDecisionSnapshot;
  /** Returns a server-owned classification over exact, already resolved sources. */
  classifyWrite(
    context: KernelContext,
    proposal: ExactPatchProposal,
    sources: readonly ConversationMessage[]
  ): AutomaticApplyEvidence;
  /** Returns a server-owned, operation-bound semantic-review receipt. */
  reviewImpact(input: {
    readonly context: KernelContext;
    readonly operationId: string;
    readonly patchHash: string;
    readonly impactHash: string;
    readonly proposal: ExactPatchProposal;
    readonly envelope: DecisionEnvelope;
  }): SemanticReviewResult | null;
}
export interface GateObserver { entered(gate: DecisionGate, snapshot: AuthorityDecisionSnapshot): void; }

export interface TurnRead {
  readonly index: Uint8Array;
  readonly pages: ReadonlyMap<string, Uint8Array>;
  readonly readSet: readonly ReadSetEntry[];
  readonly decision: AuthorityDecisionSnapshot;
}

export interface CreateInput {
  readonly context: KernelContext;
  readonly turn: TurnRead;
  readonly proposal: ExactPatchProposal;
}

export interface CreateResult {
  readonly operationId: string | null;
  readonly patchHash: string | null;
  readonly status: 'pending_confirmation' | 'ready' | 'conflict' | 'blocked';
  readonly reason?: 'authorization_changed' | 'policy_changed' | 'read_set_changed' | 'impact_changed' | 'base_revision_changed' | 'invalid_payload' | 'secret_detected';
}

export interface ApplyOptions {
  readonly worker?: string;
  readonly afterGitRefBeforeSql?: () => void;
  readonly afterSqlAppliedBeforePurge?: () => void;
  readonly purgePayload?: boolean;
}

export interface KnowledgeSearchResult {
  readonly ref: string;
  readonly pageId: string;
  readonly title: string;
}

export class KnowledgeUnavailableError extends Error {
  constructor() { super(unavailable); this.name = 'KnowledgeUnavailableError'; }
}

export class ProductContextKernel {
  constructor(
    private readonly sql: ProductContextPostgresStore,
    private readonly git: ManagedKnowledgeGit,
    private readonly conversation: ConversationStore,
    private readonly authority: DecisionAuthority,
    private readonly observer?: GateObserver
  ) {}

  /**
   * Gate 1: authorize and filter every page before any name or identifier is
   * exposed. The caller also names conversation messages that the server put
   * into this model turn. Resolving them here, rather than trusting a later
   * model-produced list, makes the immutable envelope cover all exposed
   * conversation bytes even when a message is not cited as patch evidence.
   */
  readForTurn(context: KernelContext, exposedMessageRefs: readonly string[] = []): TurnRead {
    const decision = this.enterGate('before_knowledge_exposure', context);
    if (!isContextAuthorized(context, decision)) throw new KnowledgeUnavailableError();
    const allowed = new Map<string, Uint8Array>();
    const head = this.git.head();
    for (const [path, bytes] of this.git.readPages(head)) {
      if (path === 'index.md') continue;
      const page = parseKnowledgePage(bytes);
      if (!evaluateKnowledgePageRead(page, decision.policy).allowed) continue;
      allowed.set(path, bytes);
    }
    removeStaleDependentPages(allowed);
    const readSet: ReadSetEntry[] = [...allowed.values()].map((bytes) => pageReadEntry(parseKnowledgePage(bytes), head, bytes));
    for (const ref of new Set(exposedMessageRefs)) {
      const message = this.conversation.resolve(ref);
      if (!message || message.tombstone || message.bytes === null) throw new KnowledgeUnavailableError();
      readSet.push(messageReadEntry(message));
    }
    return {
      index: generateKnowledgeIndex(allowed),
      pages: allowed,
      readSet,
      decision
    };
  }

  read(context: KernelContext): Uint8Array { return this.readForTurn(context).index; }

  /** Filters first and matches a stable ID only inside the already allowed page set. */
  directRead(context: KernelContext, pageId: string): Uint8Array {
    const turn = this.readForTurn(context);
    for (const bytes of turn.pages.values()) {
      const page = parseKnowledgePage(bytes);
      if (page.cubica_id === pageId) return bytes;
    }
    throw new KnowledgeUnavailableError();
  }

  /** Filters first and resolves either a safe path or stable Cubica page URI. */
  resolveLink(context: KernelContext, link: string): Uint8Array {
    const turn = this.readForTurn(context);
    for (const [path, bytes] of turn.pages) {
      const page = parseKnowledgePage(bytes);
      if (path === link || pageRef(page) === link) return bytes;
    }
    throw new KnowledgeUnavailableError();
  }

  /** Bounded literal scan over only the current role-filtered small tree. */
  literalSearch(context: KernelContext, literal: string, limit = 20): KnowledgeSearchResult[] {
    if (!literal || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return [];
    const turn = this.readForTurn(context);
    const needle = literal.toLocaleLowerCase('en-US');
    const results: KnowledgeSearchResult[] = [];
    for (const [path, bytes] of turn.pages) {
      const page = parseKnowledgePage(bytes);
      if (!new TextDecoder().decode(bytes).toLocaleLowerCase('en-US').includes(needle)) continue;
      results.push({ ref: path, pageId: page.cubica_id, title: page.title });
      if (results.length === limit) break;
    }
    return results;
  }

  /** Gate 2: reconstruct sources and persist only a current, exact proposal. */
  async propose(input: CreateInput): Promise<CreateResult> {
    if (!validateProductKnowledgeContract<ExactPatchProposal>('ExactPatchProposal', input.proposal).ok ||
        !verifyExactPatchProposalHash(input.proposal)) return blocked('invalid_payload');

    const decision = this.enterGate('before_operation_persistence', input.context);
    const turnDrift = compareTurnDecision(input.context, input.turn.decision, decision);
    if (turnDrift) return blocked(turnDrift, 'conflict');
    if (!isContextAuthorized(input.context, decision)) return blocked('authorization_changed', 'conflict');
    if (!isPersistenceAuthorized(decision)) return blocked('authorization_changed', 'conflict');
    if (input.proposal.base_commit !== this.git.head()) return blocked('base_revision_changed', 'conflict');

    let preview: GitPatchPreview;
    try { preview = this.git.preview(input.proposal); }
    catch { return blocked('invalid_payload'); }
    const resolved = this.resolveProposalSources(input.proposal);
    if (!resolved) return blocked('read_set_changed', 'conflict');
    const proposalPolicy = evaluateProposalPolicy(input.proposal, decision.policy, resolved.policySources);
    if (!proposalPolicy.allowed) {
      return proposalPolicy.reason === 'secret_detected'
        ? blocked('secret_detected')
        : blocked('authorization_changed', 'conflict');
    }
    if (!previewAllowed(preview, input.proposal, decision.policy, resolved.byKey)) return blocked('authorization_changed', 'conflict');

    const automaticEvidence = this.authority.classifyWrite(input.context, input.proposal, resolved.messages);
    let disposition = classifyWriteDisposition(automaticEvidence);
    if (disposition === 'blocked_secret') return blocked('secret_detected');
    if (disposition === 'self_confirming' && !isExactUserCommandBound(automaticEvidence, resolved)) {
      // A server classifier may be stale or misconfigured, but it still may
      // not auto-confirm text that is absent from the exact user sources.
      disposition = 'pending_confirmation';
    }

    const operationId = `op_${randomUUID().replaceAll('-', '')}`;
    const impact = effectiveImpact(decision.impact, preview.impactReasons);
    const envelope: DecisionEnvelope = {
      schema_version: '1.0.0',
      envelope_id: `env_${operationId}`,
      space_id: decision.spaceId,
      principal_ref: decision.principalRef,
      role_scope: decision.role,
      target_ref: targetRef(preview),
      applies_to: input.proposal.applies_to,
      read_set: mergeReadSet(input.turn.readSet, resolved.readSet),
      policy_decisions: clonePolicyDecisions(decision.policyDecisions),
      impact_hash: impact.hash,
      created_at: new Date().toISOString()
    };
    const row = await this.sql.createOperation(input.context.principalRef, {
      operationId,
      spaceId: decision.spaceId,
      idempotencyKey: `idem_${operationId}`,
      proposal: input.proposal,
      envelope
    });
    if (disposition === 'self_confirming') {
      const confirmed = await this.sql.confirmOperation(input.context.principalRef, row.operation_id, input.proposal.patch_hash, 'exact_command');
      return { operationId, patchHash: input.proposal.patch_hash, status: confirmed.status as 'ready' };
    }
    return { operationId, patchHash: input.proposal.patch_hash, status: 'pending_confirmation' };
  }

  async confirm(context: KernelContext, operationId: string, patchHash: string): Promise<'ready'> {
    const row = await this.sql.confirmOperation(context.principalRef, operationId, patchHash, 'user_confirmation');
    return row.status as 'ready';
  }

  /** Gate 3: compare the immutable envelope, preview the page, then mutate Git. */
  async applyOne(context: KernelContext, options: ApplyOptions = {}): Promise<'applied' | 'conflict' | 'failed' | 'idle'> {
    const worker = options.worker ?? 'synthetic-worker';
    const row = await this.sql.claimReady(context.principalRef, worker, 30_000);
    if (!row) return 'idle';
    const proposal = row.patch_payload;
    const envelope = row.decision_envelope;
    if (!proposal || !envelope || !verifyExactPatchProposalHash(proposal) || row.patch_hash !== proposal.patch_hash) {
      await this.sql.markFailed(context.principalRef, row.operation_id, worker, row.attempt_count, 'invalid_payload');
      return 'failed';
    }

    const decision = this.enterGate('before_git_commit', context);
    const authorityDrift = compareEnvelopeAuthority(context, envelope, proposal, decision);
    if (authorityDrift) return this.finishConflict(context, row.operation_id, worker, row.attempt_count, authorityDrift);
    if (this.git.head() !== proposal.base_commit) return this.finishConflict(context, row.operation_id, worker, row.attempt_count, 'base_revision_changed');

    let preview: GitPatchPreview;
    try { preview = this.git.preview(proposal); }
    catch { return this.finishConflict(context, row.operation_id, worker, row.attempt_count, 'base_revision_changed'); }
    if (targetRef(preview) !== envelope.target_ref) return this.finishConflict(context, row.operation_id, worker, row.attempt_count, 'read_set_changed');
    const resolved = this.resolveProposalSources(proposal);
    if (!resolved || !this.readSetMatches(envelope.read_set)) return this.finishConflict(context, row.operation_id, worker, row.attempt_count, 'read_set_changed');
    if (!evaluateProposalPolicy(proposal, decision.policy, resolved.policySources).allowed || !previewAllowed(preview, proposal, decision.policy, resolved.byKey)) {
      return this.finishConflict(context, row.operation_id, worker, row.attempt_count, 'authorization_changed');
    }
    const impact = effectiveImpact(decision.impact, preview.impactReasons);
    if (impact.hash !== envelope.impact_hash) return this.finishConflict(context, row.operation_id, worker, row.attempt_count, 'impact_changed');
    if (impact.reviewRequired) {
      const review = this.authority.reviewImpact({
        context,
        operationId: row.operation_id,
        patchHash: proposal.patch_hash,
        impactHash: envelope.impact_hash,
        proposal,
        envelope
      });
      if (!review ||
          !validateProductKnowledgeContract<SemanticReviewResult>('SemanticReviewResult', review).ok ||
          review.operation_id !== row.operation_id ||
          review.patch_hash !== proposal.patch_hash ||
          review.impact_hash !== envelope.impact_hash ||
          review.outcome !== 'no_issue') {
        return this.finishConflict(context, row.operation_id, worker, row.attempt_count, 'requires_extended_review');
      }
    }

    const result = this.git.apply(row.operation_id, proposal);
    if (result.status === 'conflict' || !result.commit) return this.finishConflict(context, row.operation_id, worker, row.attempt_count, 'base_revision_changed');
    options.afterGitRefBeforeSql?.();
    await this.sql.markApplied(context.principalRef, row.operation_id, worker, row.attempt_count, result.commit);
    options.afterSqlAppliedBeforePurge?.();
    if (options.purgePayload !== false) await this.sql.purgeAppliedPayload(context.principalRef, row.operation_id);
    return 'applied';
  }

  /**
   * Purges already-applied content before reconciling Git/SQL gaps. This order
   * keeps retention independent from Git availability: a corrupt or
   * temporarily unavailable receipt lookup may delay one recovery, but cannot
   * retain unrelated content-bearing applied rows. A second purge collects
   * rows that recovery itself moved to `applied`.
   */
  async recoverAndPurge(context: KernelContext, now = new Date()): Promise<number> {
    const purgedBeforeRecovery = await this.sql.purgeAllAppliedPayloads(context.principalRef, now);
    await this.sql.recoverExpiredLeases(
      context.principalRef,
      ({ operationId, patchHash }) => Promise.resolve(this.git.findReachableReceipt(operationId, patchHash)),
      now
    );
    const purgedAfterRecovery = await this.sql.purgeAllAppliedPayloads(context.principalRef, now);
    return purgedBeforeRecovery.length + purgedAfterRecovery.length;
  }

  private enterGate(gate: DecisionGate, context: KernelContext): AuthorityDecisionSnapshot {
    const snapshot = cloneDecision(this.authority.current(context));
    this.observer?.entered(gate, snapshot);
    return snapshot;
  }

  private resolveProposalSources(proposal: ExactPatchProposal): {
    policySources: ResolvedSource[];
    readSet: ReadSetEntry[];
    byKey: ReadonlySet<string>;
    messages: readonly ConversationMessage[];
  } | null {
    const sourceRefs = uniqueSourceRefs([
      ...proposal.source_refs,
      ...proposal.operations.flatMap((operation) => operation.source_refs)
    ]);
    const messages = new Map<string, ConversationMessage>();
    const policySources: ResolvedSource[] = [];
    for (const source of sourceRefs) {
      const message = this.conversation.resolve(source.ref);
      if (!message || message.tombstone || message.bytes === null) return null;
      messages.set(message.ref, message);
      policySources.push({ source, actor: message.actor });
    }
    return {
      policySources,
      byKey: new Set(sourceRefs.map(sourceKey)),
      messages: [...messages.values()].map(cloneMessage),
      readSet: [...messages.values()].map((message) => ({
        ref: message.ref,
        kind: 'message',
        purpose: 'decision_basis',
        revision: message.revision,
        content_hash: messageRecordHash(message)
      }))
    };
  }

  private readSetMatches(readSet: readonly ReadSetEntry[]): boolean {
    const pages = this.git.readPages();
    for (const entry of readSet) {
      if (entry.kind === 'message') {
        const message = this.conversation.resolve(entry.ref);
        if (!message || message.tombstone || message.bytes === null || message.revision !== entry.revision || messageRecordHash(message) !== entry.content_hash) return false;
      } else if (entry.kind === 'page') {
        let matched = false;
        for (const [path, bytes] of pages) {
          if (path === 'index.md') continue;
          const page = parseKnowledgePage(bytes);
          if (pageRef(page) === entry.ref && sha256Bytes(bytes) === entry.content_hash) matched = true;
        }
        if (!matched) return false;
      }
    }
    return true;
  }

  private async finishConflict(
    context: KernelContext,
    operationId: string,
    worker: string,
    attemptCount: number,
    reason: 'authorization_changed' | 'policy_changed' | 'read_set_changed' | 'impact_changed' | 'base_revision_changed' | 'requires_extended_review'
  ): Promise<'conflict'> {
    await this.sql.markConflict(context.principalRef, operationId, worker, attemptCount, reason);
    return 'conflict';
  }
}

function blocked(reason: NonNullable<CreateResult['reason']>, status: CreateResult['status'] = 'blocked'): CreateResult {
  return { operationId: null, patchHash: null, status, reason };
}

function isContextAuthorized(context: KernelContext, decision: AuthorityDecisionSnapshot): boolean {
  return decision.principalRef === context.principalRef &&
    decision.role === context.role &&
    decision.policy.role === decision.role &&
    decision.policyDecisions.access.decision === 'allow';
}

function compareTurnDecision(
  context: KernelContext,
  previous: AuthorityDecisionSnapshot,
  current: AuthorityDecisionSnapshot
): 'authorization_changed' | 'policy_changed' | 'impact_changed' | null {
  if (!isContextAuthorized(context, current) || previous.principalRef !== current.principalRef || previous.role !== current.role || previous.spaceId !== current.spaceId || !samePolicyScope(previous.policy, current.policy)) {
    return 'authorization_changed';
  }
  if (!samePolicyDecisions(previous.policyDecisions, current.policyDecisions)) return 'policy_changed';
  return sameImpactSnapshot(previous.impact, current.impact) ? null : 'impact_changed';
}

function compareEnvelopeAuthority(
  context: KernelContext,
  envelope: DecisionEnvelope,
  proposal: ExactPatchProposal,
  current: AuthorityDecisionSnapshot
): 'authorization_changed' | 'policy_changed' | null {
  if (!isContextAuthorized(context, current) || !isPersistenceAuthorized(current) || envelope.principal_ref !== current.principalRef || envelope.role_scope !== current.role || envelope.space_id !== current.spaceId) return 'authorization_changed';
  if (!sameStrings(envelope.applies_to as unknown as string[], proposal.applies_to as unknown as string[])) return 'authorization_changed';
  if (!proposal.applies_to.every((uri) => current.policy.knownAppliesTo.has(uri as unknown as string))) return 'authorization_changed';
  if (!samePolicyDecisions(envelope.policy_decisions, current.policyDecisions)) return 'policy_changed';
  return null;
}

function previewAllowed(
  preview: GitPatchPreview,
  proposal: ExactPatchProposal,
  policy: KnowledgePolicyContext,
  resolvedSourceKeys: ReadonlySet<string>
): boolean {
  const page = preview.afterPage ?? preview.beforePage;
  if (!page || !evaluateKnowledgePageRead(page, policy).allowed) return false;
  if (!sameStrings(page.applies_to as unknown as string[], proposal.applies_to as unknown as string[])) return false;
  const oldSources = new Set((preview.beforePage?.source_refs ?? []).map(sourceKey));
  return page.source_refs.every((source) => oldSources.has(sourceKey(source)) || resolvedSourceKeys.has(sourceKey(source)));
}

/**
 * Removes stale derived knowledge to a fixed point. A dependency is usable
 * only when its exact page is still visible in this role and its current body
 * bytes match the hash captured by the dependent page.
 */
function removeStaleDependentPages(pages: Map<string, Uint8Array>): void {
  let changed = true;
  while (changed) {
    changed = false;
    const byRef = new Map([...pages.values()].map((bytes) => {
      const page = parseKnowledgePage(bytes);
      return [pageRef(page), bytes] as const;
    }));
    for (const [path, bytes] of pages) {
      const page = parseKnowledgePage(bytes);
      const stale = (page.depends_on ?? []).some((dependency) => {
        const basis = byRef.get(dependency.ref);
        return !basis || knowledgeBodyHash(basis) !== dependency.content_hash;
      });
      if (stale) {
        pages.delete(path);
        changed = true;
      }
    }
  }
}

function isExactUserCommandBound(
  evidence: AutomaticApplyEvidence,
  resolved: { readonly policySources: readonly ResolvedSource[]; readonly messages: readonly ConversationMessage[] }
): boolean {
  const messages = new Map(resolved.messages.map((message) => [message.ref, message]));
  return resolved.policySources.some(({ source, actor }) => {
    if (actor !== 'user' || (source.use !== 'evidence' && source.use !== 'confirmation')) return false;
    const message = messages.get(source.ref);
    if (!message || message.bytes === null) return false;
    return new TextDecoder('utf-8', { fatal: true }).decode(message.bytes) === evidence.text;
  });
}

function effectiveImpact(authority: DeterministicImpactSnapshot, previewReasons: readonly string[]): { hash: string; reviewRequired: boolean } {
  const reasons = [...new Set([...authority.reasons, ...previewReasons])].sort();
  const reviewRequired = authority.reviewRequired || reasons.length > 0;
  return {
    reviewRequired,
    hash: hashCanonicalPayloadSync('impact', { revision: authority.revision, reviewRequired, reasons })
  };
}

function targetRef(preview: GitPatchPreview): string {
  const page = preview.afterPage ?? preview.beforePage;
  if (!page) throw new TypeError('A knowledge change requires a parseable target page.');
  return pageRef(page);
}

function pageRef(page: KnowledgePage): string { return `cubica://knowledge/page/${page.cubica_id}`; }
function pageReadEntry(page: KnowledgePage, revision: string, bytes: Uint8Array): ReadSetEntry {
  return { ref: pageRef(page), kind: 'page', purpose: 'navigation', revision, content_hash: sha256Bytes(bytes) };
}
function messageReadEntry(message: ConversationMessage): ReadSetEntry {
  if (message.bytes === null) throw new TypeError('A tombstoned message cannot enter a read set.');
  return { ref: message.ref, kind: 'message', purpose: 'decision_basis', revision: message.revision, content_hash: messageRecordHash(message) };
}
function messageRecordHash(message: ConversationMessage): string {
  if (message.bytes === null) throw new TypeError('A tombstoned message has no record hash.');
  const prefix = new TextEncoder().encode(`cubica-conversation-message/v1\n${message.actor}\n`);
  const record = new Uint8Array(prefix.length + message.bytes.length);
  record.set(prefix);
  record.set(message.bytes, prefix.length);
  return sha256Bytes(record);
}
function sourceKey(source: SourceRef): string { return `${source.ref}\u0000${source.use}`; }
function uniqueSourceRefs(sources: readonly SourceRef[]): SourceRef[] {
  const result = new Map<string, SourceRef>();
  for (const source of sources) result.set(sourceKey(source), source);
  return [...result.values()];
}
function mergeReadSet(left: readonly ReadSetEntry[], right: readonly ReadSetEntry[]): ReadSetEntry[] {
  const result = new Map<string, ReadSetEntry>();
  for (const entry of [...left, ...right]) {
    const existing = result.get(entry.ref);
    if (existing && (existing.revision !== entry.revision || existing.content_hash !== entry.content_hash)) throw new TypeError('One read-set reference resolved to inconsistent revisions.');
    result.set(entry.ref, entry);
  }
  return [...result.values()];
}
function samePolicyScope(left: KnowledgePolicyContext, right: KnowledgePolicyContext): boolean {
  return left.role === right.role && left.allUserGamesConfirmed === right.allUserGamesConfirmed && left.globalConfirmed === right.globalConfirmed &&
    sameStrings([...left.knownAppliesTo], [...right.knownAppliesTo]) && sameStrings([...left.currentAppliesTo], [...right.currentAppliesTo]);
}
function samePolicyDecisions(left: DecisionEnvelope['policy_decisions'], right: DecisionEnvelope['policy_decisions']): boolean {
  // PostgreSQL jsonb deliberately does not preserve object-key order, so the
  // immutable decision is compared field-by-field rather than as serialized
  // JSON. This still binds every closed policy decision and version.
  return left.access.decision === right.access.decision &&
    left.access.version === right.access.version &&
    left.retention.decision === right.retention.decision &&
    left.retention.version === right.retention.version &&
    left.external_processing.decision === right.external_processing.decision &&
    left.external_processing.version === right.external_processing.version;
}
function sameImpactSnapshot(left: DeterministicImpactSnapshot, right: DeterministicImpactSnapshot): boolean {
  return left.revision === right.revision &&
    left.reviewRequired === right.reviewRequired &&
    sameStrings(left.reasons, right.reasons);
}
function isPersistenceAuthorized(decision: AuthorityDecisionSnapshot): boolean {
  // A retention denial may still permit an ephemeral read, but it must never
  // create or apply a durable knowledge operation. External processing is not
  // required here: Stage 1 has no model or network adapter at this boundary.
  return decision.policyDecisions.retention.decision === 'allow';
}
function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  const sortedRight = [...right].sort();
  return left.length === right.length && [...left].sort().every((value, index) => value === sortedRight[index]);
}
function clonePolicyDecisions(value: DecisionEnvelope['policy_decisions']): DecisionEnvelope['policy_decisions'] {
  return {
    access: { ...value.access },
    retention: { ...value.retention },
    external_processing: { ...value.external_processing }
  };
}
function cloneDecision(value: AuthorityDecisionSnapshot): AuthorityDecisionSnapshot {
  return {
    principalRef: value.principalRef,
    role: value.role,
    spaceId: value.spaceId,
    policy: {
      role: value.policy.role,
      knownAppliesTo: new Set(value.policy.knownAppliesTo),
      currentAppliesTo: new Set(value.policy.currentAppliesTo),
      allUserGamesConfirmed: value.policy.allUserGamesConfirmed,
      globalConfirmed: value.policy.globalConfirmed
    },
    policyDecisions: clonePolicyDecisions(value.policyDecisions),
    impact: {
      revision: value.impact.revision,
      reviewRequired: value.impact.reviewRequired,
      reasons: [...value.impact.reasons]
    }
  };
}
function cloneMessage(message: ConversationMessage): ConversationMessage {
  return { ...message, bytes: message.bytes ? new Uint8Array(message.bytes) : null };
}
