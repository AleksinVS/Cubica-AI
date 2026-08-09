import { describe, expect, it, vi } from 'vitest';

import { HttpModelGateway, ModelGatewayError } from '../src/model-gateway.ts';
import { hashExactPatchProposal } from '../src/contracts.ts';
import type { ExactPatchProposal, ModelGatewayRequest } from '../src/generated/product-knowledge.ts';

const hash = `sha256:${'a'.repeat(64)}` as const;
const request: ModelGatewayRequest = {
  schema_version: '1.0.0', request_id: 'modelreq_demo', authorization_revision: hash,
  shadow_principal_ref: 'cubica://shadow-principal/demo', applies_to: ['cubica://game-project/demo'],
  access_policy_ref: 'access', access_policy_revision: '1', retention_policy_ref: 'retention',
  retention_policy_revision: '1', external_processing_policy_ref: 'external',
  external_processing_policy_revision: '1', external_processing_decision: 'allow',
  messages: [
    { message_ref: 'cubica://shadow-thread/demo/message/user', actor: 'user', revision: hash, content_hash: hash, content_base64: 'dXNlcg==' },
    { message_ref: 'cubica://shadow-thread/demo/message/agent', actor: 'agent', revision: hash, content_hash: hash, content_base64: 'YWdlbnQ=' }
  ]
};

describe('bounded HTTP shadow model gateway', () => {
  it('denies policy before network access', async () => {
    const fetchImpl = vi.fn();
    const gateway = new HttpModelGateway({ endpoint: 'https://model.invalid/shadow', bearerToken: 'secret', fetchImpl });
    await expect(gateway.call({ ...request, external_processing_decision: 'deny' })).rejects.toMatchObject({ code: 'policy_denied' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed_output', () => Promise.resolve(new Response('{bad json', { status: 200 }))],
    ['oversize_output', () => Promise.resolve(new Response('x'.repeat(100), { status: 200 }))]
  ] as const)('fails closed on %s without exposing response content', async (code, fetchImpl) => {
    const gateway = new HttpModelGateway({ endpoint: 'https://model.invalid/shadow', bearerToken: 'secret', fetchImpl, maxResponseBytes: code === 'oversize_output' ? 10 : 100 });
    const error = await gateway.call(request).catch((caught) => caught);
    expect(error).toBeInstanceOf(ModelGatewayError);
    expect(error).toMatchObject({ code });
    expect(String(error)).not.toContain('bad json');
    expect(String(error)).not.toContain('secret');
  });

  it('aborts a timed-out request and reports only a fixed code', async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('provider included content', 'AbortError')));
    }));
    const gateway = new HttpModelGateway({ endpoint: 'https://model.invalid/shadow', bearerToken: 'secret', fetchImpl: fetchImpl as typeof fetch, timeoutMs: 5 });
    await expect(gateway.call(request)).rejects.toMatchObject({ code: 'timeout', message: 'Shadow model gateway failed: timeout.' });
  });

  it('accepts only a canonical response bound to the request id', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ schema_version: '1.0.0', request_id: request.request_id, outcome: 'no_change', proposal: null }), { status: 200 }));
    const gateway = new HttpModelGateway({ endpoint: 'https://model.invalid/shadow', bearerToken: 'secret', fetchImpl });
    await expect(gateway.call(request)).resolves.toMatchObject({ result: { outcome: 'no_change' } });
  });

  it('accepts a hash-bound proposal only for the exact authorized scope and request messages', async () => {
    const proposal = validProposal();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ schema_version: '1.0.0', request_id: request.request_id, outcome: 'proposal', proposal }), { status: 200 }));
    const gateway = new HttpModelGateway({ endpoint: 'https://model.invalid/shadow', bearerToken: 'secret', fetchImpl });
    await expect(gateway.call(request)).resolves.toMatchObject({ result: { outcome: 'proposal' } });
  });

  it.each(['wrong_scope', 'invented_source', 'agent_confirmation', 'agent_evidence'] as const)('rejects a validly hashed proposal with %s provenance', async (variant) => {
    const proposal = validProposal();
    if (variant === 'wrong_scope') proposal.applies_to = ['cubica://game-project/other'] as unknown as ExactPatchProposal['applies_to'];
    else if (variant === 'invented_source') proposal.operations[0]!.source_refs = [{ ref: 'cubica://dialog/invented/message/user', use: 'evidence' }];
    else proposal.operations[0]!.source_refs = [{ ref: request.messages[1]!.message_ref, use: variant === 'agent_confirmation' ? 'confirmation' : 'evidence' }];
    proposal.patch_hash = hashExactPatchProposal(proposal);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ schema_version: '1.0.0', request_id: request.request_id, outcome: 'proposal', proposal }), { status: 200 }));
    const gateway = new HttpModelGateway({ endpoint: 'https://model.invalid/shadow', bearerToken: 'secret', fetchImpl });
    await expect(gateway.call(request)).rejects.toMatchObject({ code: 'malformed_output' });
  });
});

function validProposal(): ExactPatchProposal {
  const proposal: ExactPatchProposal = {
    schema_version: '1.0.0', proposal_id: 'prop_gateway', base_commit: 'b'.repeat(40), patch_hash: hash,
    operations: [{ kind: 'create_file', path: 'notes/gateway.md', new_text: 'bounded proposal', reason: 'Captured from the exact turn', source_refs: [{ ref: request.messages[0]!.message_ref, use: 'evidence' }] }],
    source_refs: [{ ref: request.messages[0]!.message_ref, use: 'evidence' }], applies_to: [...request.applies_to] as unknown as ExactPatchProposal['applies_to']
  };
  proposal.patch_hash = hashExactPatchProposal(proposal);
  return proposal;
}
