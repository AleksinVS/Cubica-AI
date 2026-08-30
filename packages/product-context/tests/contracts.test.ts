/** Contract fixtures prove both acceptance and fail-closed schema rejection. */
import { describe, expect, it } from 'vitest';
import { hashCanonicalPayload, validateProductKnowledgeContract } from '../src/contracts.ts';

const hash = `sha256:${'a'.repeat(64)}`;
const page = {
  schema_version: '1.0.0', type: 'decision', title: 'Audience', description: 'Confirmed audience.', timestamp: '2026-08-09T10:00:00Z',
  cubica_id: 'knw_audience', role_scope: 'developer', body: 'The audience is confirmed.',
  source_refs: [{ ref: 'cubica://dialog/demo/message/user-1', use: 'evidence' }],
  applies_to: ['cubica://game-project/demo']
};

describe('product knowledge JSON Schema', () => {
  it('compiles and rejects incomplete fixtures for every named contract root', () => {
    for (const name of [
      'KnowledgePage', 'ExactPatchProposal', 'DecisionEnvelope', 'ImpactAssessment',
      'KnowledgeWriteOperation', 'SemanticReviewResult', 'ShadowAuthorizationReceipt',
      'ConversationMessage', 'ConversationTurn', 'ModelGatewayRequest',
      'ModelGatewayResult', 'ShadowContentFreeMetric'
    ] as const) {
      expect(validateProductKnowledgeContract(name, {}).ok).toBe(false);
    }
  });
  it('accepts a complete page fixture', () => expect(validateProductKnowledgeContract('KnowledgePage', page).ok).toBe(true));
  it('accepts complete impact and semantic-review fixtures', () => {
    expect(validateProductKnowledgeContract('ImpactAssessment', {
      schema_version: '1.0.0', assessment_id: 'impact_1',
      query: { kind: 'subject_key', version: '1', inputs: { subject_key: 'audience' }, candidates: [] },
      outcome: 'clear', result_hash: hash, affected_refs: [], checked_at: '2026-08-09T10:00:00Z'
    }).ok).toBe(true);
    expect(validateProductKnowledgeContract('SemanticReviewResult', {
      schema_version: '1.0.0', review_id: 'review_1', operation_id: 'op_1',
      patch_hash: hash, impact_hash: hash, outcome: 'no_issue', related_refs: [], checked_at: '2026-08-09T10:00:00Z'
    }).ok).toBe(true);
  });
  it('rejects empty applicability and an unknown role structurally', () => {
    expect(validateProductKnowledgeContract('KnowledgePage', { ...page, applies_to: [] }).ok).toBe(false);
    expect(validateProductKnowledgeContract('KnowledgePage', { ...page, role_scope: 'operator' }).ok).toBe(false);
  });
  it('rejects incomplete exact patches and accepts a complete patch', () => {
    const proposal = { schema_version: '1.0.0', proposal_id: 'prop_1', base_commit: 'a'.repeat(40), patch_hash: hash, source_refs: page.source_refs, applies_to: page.applies_to,
      operations: [{ kind: 'replace_exact', path: 'decisions/audience.md', base_file_hash: hash, old_text: 'old', old_text_hash: hash, new_text: 'new', expected_matches: 1, reason: 'Correction', source_refs: page.source_refs }] };
    expect(validateProductKnowledgeContract('ExactPatchProposal', proposal).ok).toBe(true);
    expect(validateProductKnowledgeContract('ExactPatchProposal', { ...proposal, operations: [{ ...proposal.operations[0], expected_matches: 2 }] }).ok).toBe(false);
    expect(validateProductKnowledgeContract('ExactPatchProposal', { ...proposal, operations: [{ ...proposal.operations[0], path: 'index.md' }] }).ok).toBe(false);
    const { new_text: _newText, ...replaceWithoutNewText } = proposal.operations[0];
    expect(validateProductKnowledgeContract('ExactPatchProposal', { ...proposal, operations: [replaceWithoutNewText] }).ok).toBe(false);
    expect(validateProductKnowledgeContract('ExactPatchProposal', {
      ...proposal,
      operations: [{ ...proposal.operations[0], kind: 'delete_exact', new_text: 'must not survive deletion' }]
    }).ok).toBe(false);
  });
  it('uses domain-separated, key-order independent hashes', async () => {
    await expect(hashCanonicalPayload('patch', { b: 2, a: 1 })).resolves.toBe(await hashCanonicalPayload('patch', { a: 1, b: 2 }));
    expect(await hashCanonicalPayload('patch', { a: 1 })).not.toBe(await hashCanonicalPayload('impact', { a: 1 }));
  });
  it('keeps lifecycle state and content retention combinations declarative', () => {
    const envelope = {
      schema_version: '1.0.0', envelope_id: 'env_1', space_id: 'space_1', principal_ref: 'cubica://user/demo',
      role_scope: 'developer', target_ref: 'cubica://knowledge/demo', applies_to: page.applies_to,
      read_set: [{ ref: 'cubica://dialog/demo/message/user-1', kind: 'message', purpose: 'decision_basis', revision: '1', content_hash: hash }],
      policy_decisions: { access: { decision: 'allow', version: '1' }, retention: { decision: 'allow', version: '1' }, external_processing: { decision: 'deny', version: '1' } },
      impact_hash: hash, created_at: '2026-08-09T10:00:00Z'
    };
    const proposal = { schema_version: '1.0.0', proposal_id: 'prop_1', base_commit: 'a'.repeat(40), patch_hash: hash, source_refs: page.source_refs, applies_to: page.applies_to,
      operations: [{ kind: 'create_file', path: 'notes/a.md', new_text: 'page', reason: 'Remember', source_refs: page.source_refs }] };
    const pending = {
      schema_version: '1.0.0', operation_id: 'op_1', space_id: 'space_1', creator_ref: 'cubica://user/demo', idempotency_key: 'idempotency-key-1',
      proposal_id: 'prop_1', patch_hash: hash, status: 'pending_confirmation', status_reason: 'awaiting_confirmation', decision_envelope_id: 'env_1',
      decision_envelope: envelope, patch_payload: proposal, source_refs: page.source_refs, confirmation: null, confirmed_patch_hash: null,
      attempt_count: 0, lease_owner: null, created_at: '2026-08-09T10:00:00Z'
    };
    expect(validateProductKnowledgeContract('KnowledgeWriteOperation', pending).ok).toBe(true);
    expect(validateProductKnowledgeContract('KnowledgeWriteOperation', { ...pending, status_reason: 'ready_to_apply' }).ok).toBe(false);
    expect(validateProductKnowledgeContract('KnowledgeWriteOperation', { ...pending, patch_hash: null }).ok).toBe(false);
    expect(validateProductKnowledgeContract('KnowledgeWriteOperation', { ...pending, status: 'conflict', status_reason: 'authorization_changed', next_retry_at: '2026-08-09T11:00:00Z' }).ok).toBe(false);
    expect(validateProductKnowledgeContract('KnowledgeWriteOperation', { ...pending, commit_sha: 'a'.repeat(40) }).ok).toBe(false);
    const applied = { ...pending, status: 'applied', status_reason: 'applied', confirmation: { operation_id: 'op_1', patch_hash: hash, principal_ref: 'cubica://user/demo', method: 'exact_command', confirmed_at: '2026-08-09T10:01:00Z' }, confirmed_patch_hash: hash, commit_sha: 'a'.repeat(40), applied_at: '2026-08-09T10:02:00Z' };
    expect(validateProductKnowledgeContract('KnowledgeWriteOperation', applied).ok).toBe(true);
    expect(validateProductKnowledgeContract('KnowledgeWriteOperation', { ...applied, status_reason: 'payload_purged' }).ok).toBe(false);
    expect(validateProductKnowledgeContract('KnowledgeWriteOperation', { ...applied, status_reason: 'payload_purged', payload_purged_at: '2026-08-09T10:03:00Z', decision_envelope: null, patch_payload: null, source_refs: null, confirmation: null, patch_hash: null, confirmed_patch_hash: null }).ok).toBe(true);
  });
});
