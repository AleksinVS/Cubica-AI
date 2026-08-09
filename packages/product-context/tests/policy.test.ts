/** Pure-policy fixtures cover role isolation, provenance and safe write defaults. */
import { describe, expect, it } from 'vitest';
import { classifyWriteDisposition, evaluateKnowledgePageRead, evaluateProposalPolicy, evaluateSourceProvenance, failClosedSemanticReview, hasSecretLikeText } from '../src/index.ts';
import type { ExactPatchProposal, KnowledgePage } from '../src/generated/product-knowledge.ts';

const source = [{ ref: 'cubica://dialog/demo/message/user-1', use: 'evidence' }] as const;
const page = { schema_version: '1.0.0', type: 'decision', title: 'Decision', description: 'Description', timestamp: '2026-08-09T10:00:00Z', cubica_id: 'knw_demo', role_scope: 'developer', source_refs: source, applies_to: ['cubica://game-project/demo'], body: 'Body' } as unknown as KnowledgePage;
const context = { role: 'developer', knownAppliesTo: new Set(['cubica://game-project/demo', 'cubica://scope/all-user-games']), currentAppliesTo: new Set(['cubica://game-project/demo']), allUserGamesConfirmed: false, globalConfirmed: false };

describe('Stage 1 fail-closed policy', () => {
  it('isolates roles and unknown subject URIs', () => {
    expect(evaluateKnowledgePageRead(page, { ...context, role: 'facilitator' })).toEqual({ allowed: false, reason: 'role_mismatch' });
    expect(evaluateKnowledgePageRead({ ...page, applies_to: ['cubica://game-project/missing'] } as unknown as KnowledgePage, context).allowed).toBe(false);
  });
  it('requires explicit confirmation for global and all-user-games pages', () => {
    expect(evaluateKnowledgePageRead({ ...page, role_scope: 'global' }, context).allowed).toBe(false);
    expect(evaluateKnowledgePageRead({ ...page, applies_to: ['cubica://scope/all-user-games'] }, context).allowed).toBe(false);
  });
  it('permits agent wording only with user evidence or confirmation', () => {
    expect(evaluateSourceProvenance([{ source: { ref: 'cubica://dialog/demo/message/agent-1', use: 'wording' }, actor: 'agent' }]).allowed).toBe(false);
    expect(evaluateSourceProvenance([{ source: { ref: 'cubica://dialog/demo/message/agent-1', use: 'confirmation' }, actor: 'agent' }])).toEqual({ allowed: false, reason: 'unconfirmed_origin' });
    expect(evaluateSourceProvenance([{ source: source[0], actor: 'user' }, { source: { ref: 'cubica://dialog/demo/message/agent-1', use: 'wording' }, actor: 'agent' }]).allowed).toBe(true);
    expect(evaluateSourceProvenance([{ source: { ref: 'cubica://domain/demo/event/1', use: 'evidence' }, actor: 'domain' }]).allowed).toBe(true);
  });
  it('refuses a write for a known but non-current game', () => {
    const proposal = {
      schema_version: '1.0.0', proposal_id: 'prop_other', base_commit: 'a'.repeat(40), patch_hash: `sha256:${'b'.repeat(64)}`,
      applies_to: ['cubica://game-project/other'], source_refs: source,
      operations: [{ kind: 'create_file', path: 'notes/other.md', new_text: 'page', reason: 'Test', source_refs: source }]
    } as unknown as ExactPatchProposal;
    const otherKnown = { ...context, knownAppliesTo: new Set([...context.knownAppliesTo, 'cubica://game-project/other']) };
    expect(evaluateProposalPolicy(proposal, otherKnown, [{ source: source[0], actor: 'user' }])).toEqual({ allowed: false, reason: 'subject_not_applicable' });
  });
  it('blocks secrets before proposal and leaves ambiguity pending', () => {
    expect(classifyWriteDisposition({ exactLocalCommand: true, unambiguous: true, localOnly: true, requiresImpactReview: false, text: 'ordinary decision' })).toBe('self_confirming');
    expect(classifyWriteDisposition({ exactLocalCommand: true, unambiguous: false, localOnly: true, requiresImpactReview: false, text: 'ordinary decision' })).toBe('pending_confirmation');
    expect(classifyWriteDisposition({ exactLocalCommand: true, unambiguous: true, localOnly: true, requiresImpactReview: false, text: 'password=supersecretvalue123' })).toBe('blocked_secret');
    expect(hasSecretLikeText('password policy is documented')).toBe(false);
  });
  it('keeps absent semantic review fail-closed', () => expect(failClosedSemanticReview()).toBe('requires_extended_review'));
});
