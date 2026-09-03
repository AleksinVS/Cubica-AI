/** Pure contract checks for exact receipts and mutable synthetic authorities. */
import { describe, expect, it } from 'vitest';

import { hashExactPatchProposal, verifyExactPatchProposalHash } from '../src/contracts.ts';
import { assertIsolatedHarnessConfig, InMemoryConversationStore, MutableDecisionAuthority, syntheticContext } from '../src/harness.ts';
import { ProductContextKernel } from '../src/kernel.ts';
import { OperationUnavailableError } from '../src/postgres.ts';
import type { ExactPatchProposal } from '../src/generated/product-knowledge.ts';

describe('kernel trust inputs', () => {
  it('hashes every proposal field except the self-referential patch_hash', () => {
    const proposal = fixtureProposal();
    proposal.patch_hash = hashExactPatchProposal(proposal);
    expect(verifyExactPatchProposalHash(proposal)).toBe(true);
    const original = proposal.patch_hash;
    proposal.patch_hash = `sha256:${'f'.repeat(64)}`;
    expect(hashExactPatchProposal(proposal)).toBe(original);
    proposal.operations[0]!.reason = 'tampered';
    expect(verifyExactPatchProposalHash(proposal)).toBe(false);
  });

  it('keeps server authority mutable without putting policy in caller context', () => {
    const authority = new MutableDecisionAuthority();
    const developer = syntheticContext('developer');
    expect(developer).toEqual({ principalRef: 'cubica://user/synthetic-stage1', role: 'developer' });
    expect(authority.current(developer).policy.currentAppliesTo).toEqual(new Set(['cubica://game-project/one']));
    authority.state.currentAppliesTo = ['cubica://game-project/two'];
    expect(authority.current(developer).policy.currentAppliesTo).toEqual(new Set(['cubica://game-project/two']));
  });

  it('replaces deleted message bytes with a contentless tombstone revision', () => {
    const ref = 'cubica://dialog/test/message/source';
    const store = new InMemoryConversationStore(new Map([[ref, {
      ref, revision: '1', actor: 'user' as const, bytes: new TextEncoder().encode('private source'), tombstone: false
    }]]));
    store.tombstone(ref, '2');
    expect(store.resolve(ref)).toEqual({ ref, revision: '2', actor: 'user', bytes: null, tombstone: true });
  });

  it('rejects connection-string query overrides before node-postgres can reinterpret the host', async () => {
    await expect(assertIsolatedHarnessConfig({
      databaseUrl: 'postgresql://user:password@localhost/product_context_stage1?host=remote.example&port=6543',
      gitRoot: '/tmp/cubica-stage1-query-override.git', syntheticOnly: true, denyExternalProcessing: true
    })).rejects.toThrow('exact local Stage 1 database');
  });

  it('cannot finish stale attempt N after the same owner reclaims attempt N+1', async () => {
    const owner = 'stable-worker-name';
    const operationId = 'op_attempt_fence';
    const state: {
      status: 'ready' | 'applying' | 'failed';
      leaseOwner: string | null;
      attemptCount: number;
    } = { status: 'ready', leaseOwner: null, attemptCount: 0 };
    let staleTerminalAttempt: number | undefined;

    const sql = {
      claimReady: async (_principalRef: string, leaseOwner: string) => {
        state.status = 'applying';
        state.leaseOwner = leaseOwner;
        state.attemptCount += 1;
        const staleClaim = {
          operation_id: operationId,
          patch_hash: null,
          patch_payload: null,
          decision_envelope: null,
          attempt_count: state.attemptCount
        };

        // Deterministically interleave expiry and a new claim before attempt N
        // performs its terminal write. The owner string is intentionally reused.
        state.status = 'ready';
        state.leaseOwner = null;
        state.status = 'applying';
        state.leaseOwner = leaseOwner;
        state.attemptCount += 1;
        return staleClaim;
      },
      markFailed: async (
        _principalRef: string,
        candidateOperationId: string,
        leaseOwner: string,
        attemptCount: number
      ) => {
        staleTerminalAttempt = attemptCount;
        if (
          candidateOperationId !== operationId ||
          state.status !== 'applying' ||
          state.leaseOwner !== leaseOwner ||
          state.attemptCount !== attemptCount
        ) throw new OperationUnavailableError();
        state.status = 'failed';
        return {};
      }
    };
    const kernel = new ProductContextKernel(sql as never, {} as never, {} as never, {} as never);

    await expect(kernel.applyOne(syntheticContext('developer'), { worker: owner }))
      .rejects.toBeInstanceOf(OperationUnavailableError);
    expect(staleTerminalAttempt).toBe(1);
    expect(state).toEqual({ status: 'applying', leaseOwner: owner, attemptCount: 2 });
  });
});

function fixtureProposal(): ExactPatchProposal {
  return {
    schema_version: '1.0.0', proposal_id: 'prop_hash', base_commit: 'a'.repeat(40), patch_hash: '',
    source_refs: [{ ref: 'cubica://dialog/test/message/source', use: 'evidence' }],
    applies_to: ['cubica://game-project/one'] as never,
    operations: [{ kind: 'create_file', path: 'notes/hash.md', new_text: 'content', reason: 'test', source_refs: [{ ref: 'cubica://dialog/test/message/source', use: 'evidence' }] }]
  };
}
