/**
 * Pure, fail-closed policy decisions for Stage 1 product knowledge.
 *
 * This module receives server-established facts (the current role, registered
 * subject URIs and confirmation evidence). It never selects an owner or reads
 * storage, so adapters cannot accidentally turn an uncertain fact into access.
 */
import type { ExactPatchProposal, KnowledgePage, SemanticReviewResult, SourceRef } from './generated/product-knowledge.ts';

export type UserRole = 'developer' | 'facilitator';
export type PolicyDecision = { allowed: true } | { allowed: false; reason: PolicyDenialReason };
export type PolicyDenialReason =
  | 'unknown_role'
  | 'role_mismatch'
  | 'unknown_applies_to'
  | 'subject_not_applicable'
  | 'all_user_games_unconfirmed'
  | 'global_unconfirmed'
  | 'unconfirmed_origin'
  | 'agent_wording_unconfirmed'
  | 'secret_detected';
export interface ResolvedSource { readonly source: SourceRef; readonly actor: 'user' | 'agent' | 'domain'; }

/** Server-established facts for one attempted read or write. */
export interface KnowledgePolicyContext {
  readonly role: UserRole | string;
  readonly knownAppliesTo: ReadonlySet<string>;
  readonly currentAppliesTo: ReadonlySet<string>;
  readonly allUserGamesConfirmed: boolean;
  readonly globalConfirmed: boolean;
}

/**
 * Allows a page only when its role, every URI and its confirmation conditions
 * are known to the server. A stale registry or unrecognised role denies access.
 */
export function evaluateKnowledgePageRead(page: KnowledgePage, context: KnowledgePolicyContext): PolicyDecision {
  if (context.role !== 'developer' && context.role !== 'facilitator') return deny('unknown_role');
  if (page.role_scope !== context.role && page.role_scope !== 'global') return deny('role_mismatch');
  if (page.role_scope === 'global' && !context.globalConfirmed) return deny('global_unconfirmed');
  if (page.applies_to.some((uri) => !context.knownAppliesTo.has(uri))) return deny('unknown_applies_to');

  const allUserGames = 'cubica://scope/all-user-games';
  if (page.applies_to.includes(allUserGames) && !context.allUserGamesConfirmed) return deny('all_user_games_unconfirmed');
  if (!page.applies_to.includes(allUserGames) && !page.applies_to.some((uri) => context.currentAppliesTo.has(uri))) return deny('subject_not_applicable');
  return { allowed: true };
}

/**
 * Checks the source invariant before creating a proposal. Agent-generated
 * wording is permitted only when a user contributes evidence or later explicit
 * confirmation; a model response can never approve itself.
 */
export function evaluateSourceProvenance(sourceRefs: readonly ResolvedSource[]): PolicyDecision {
  const hasAgentWording = sourceRefs.some(({ source, actor }) => actor === 'agent' && source.use === 'wording');
  const hasUserAuthority = sourceRefs.some(({ source, actor }) => actor === 'user' && (source.use === 'evidence' || source.use === 'confirmation'));
  const hasDomainAuthority = sourceRefs.some(({ source, actor }) => actor === 'domain' && (source.use === 'evidence' || source.use === 'confirmation'));
  if (!hasUserAuthority && !hasDomainAuthority) {
    return deny(hasAgentWording ? 'agent_wording_unconfirmed' : 'unconfirmed_origin');
  }
  return { allowed: true };
}

/** Evidence used to decide whether an exact command can bypass a proposal. */
export interface AutomaticApplyEvidence {
  readonly exactLocalCommand: boolean;
  readonly unambiguous: boolean;
  readonly localOnly: boolean;
  readonly requiresImpactReview: boolean;
  readonly text: string;
}

export type WriteDisposition = 'self_confirming' | 'pending_confirmation' | 'blocked_secret';

/**
 * Classifies automatic application conservatively: only a server-proven exact,
 * local command is self-confirming. Every ambiguity waits for a precise user
 * confirmation, and secret-like text is rejected before a proposal exists.
 */
export function classifyWriteDisposition(evidence: AutomaticApplyEvidence): WriteDisposition {
  if (hasSecretLikeText(evidence.text)) return 'blocked_secret';
  return evidence.exactLocalCommand && evidence.unambiguous && evidence.localOnly && !evidence.requiresImpactReview
    ? 'self_confirming'
    : 'pending_confirmation';
}

/** Checks proposal origins before it enters durable operation storage. */
export function evaluateProposalPolicy(proposal: ExactPatchProposal, context: KnowledgePolicyContext, sources: readonly ResolvedSource[]): PolicyDecision {
  if (hasSecretLikeText(JSON.stringify(proposal))) return deny('secret_detected');
  if (new Set(proposal.operations.map((operation) => operation.path)).size !== 1) return deny('subject_not_applicable');
  if (proposal.applies_to.some((uri) => !context.knownAppliesTo.has(uri))) return deny('unknown_applies_to');
  const allUserGames = proposal.applies_to.includes('cubica://scope/all-user-games');
  if (allUserGames && !context.allUserGamesConfirmed) return deny('all_user_games_unconfirmed');
  if (!allUserGames && !proposal.applies_to.some((uri) => context.currentAppliesTo.has(uri))) return deny('subject_not_applicable');
  return evaluateSourceProvenance(sources);
}

/** Detects high-confidence credential forms before they can become a proposal. */
export function hasSecretLikeText(text: string): boolean {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}|(?:api[_-]?key|password|token)\s*[:=]\s*['\"]?[A-Za-z0-9_\-]{16,}/i.test(text);
}

/**
 * Implements the Stage 1 semantic-review port's safe default. No network or
 * model adapter exists here, so an absent result always blocks broad mutation.
 */
export function failClosedSemanticReview(result?: SemanticReviewResult): SemanticReviewResult['outcome'] {
  return result?.outcome ?? 'requires_extended_review';
}

function deny(reason: PolicyDenialReason): PolicyDecision { return { allowed: false, reason }; }
