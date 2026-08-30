import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { hashExactPatchProposal } from '../src/contracts.ts';
import { ManagedKnowledgeGit, ReadOnlyKnowledgeGit } from '../src/git.ts';
import { ShadowKnowledgeGrounding } from '../src/shadow-grounding.ts';
import type { ExactPatchProposal, ModelGatewayRequest } from '../src/generated/product-knowledge.ts';

const hash = `sha256:${'a'.repeat(64)}` as const;
const principal = `cubica://shadow-principal/v1/${'b'.repeat(64)}`;
const game = 'cubica://game-project/demo';
const request: ModelGatewayRequest = {
  schema_version: '1.0.0', request_id: 'modelreq_grounding', authorization_revision: hash,
  shadow_principal_ref: principal, applies_to: [game] as ModelGatewayRequest['applies_to'],
  access_policy_ref: 'portal-owned-game-developer-v1', access_policy_revision: 'revision-1',
  retention_policy_ref: 'retention', retention_policy_revision: '1',
  external_processing_policy_ref: 'external-policy', external_processing_policy_revision: 'policy-1',
  external_processing_decision: 'allow',
  messages: [
    { message_ref: 'cubica://shadow-thread/demo/message/user', actor: 'user', revision: hash, content_hash: hash, content_base64: 'dXNlcg==' },
    { message_ref: 'cubica://shadow-thread/demo/message/agent', actor: 'agent', revision: hash, content_hash: hash, content_base64: 'YWdlbnQ=' }
  ]
};

const managed: ManagedKnowledgeGit[] = [];
const groundings: ShadowKnowledgeGrounding[] = [];
const readers: ReadOnlyKnowledgeGit[] = [];
afterEach(async () => {
  await Promise.all(groundings.splice(0).map((value) => value.close()));
  await Promise.all(readers.splice(0).map((value) => value.close()));
  await Promise.all(managed.splice(0).map((value) => value.close()));
});

describe('read-only shadow wiki grounding', () => {
  it('returns only the configured developer game from one exact bare-Git commit', async () => {
    const repository = await repositoryWithPages([
      ['notes/allowed.md', page('knw_allowed', 'Allowed', 'developer', [game])],
      ['notes/other-game.md', page('knw_other', 'Other game', 'developer', ['cubica://game-project/other'])],
      ['notes/facilitator.md', page('knw_facilitator', 'Facilitator', 'facilitator', [game])],
      ['notes/global.md', page('knw_global', 'Global', 'global', [game])],
      ['notes/all-games.md', page('knw_all_games', 'All games', 'developer', ['cubica://scope/all-user-games'])]
    ]);
    const grounding = await ShadowKnowledgeGrounding.open(config(repository));
    groundings.push(grounding);

    const snapshot = grounding.read(request);
    expect(snapshot.commit).toMatch(/^[a-f0-9]{40}$/u);
    expect(snapshot.pages.map((page) => page.path)).toEqual(['notes/allowed.md']);
    expect(snapshot.index).toContain('Allowed');
    expect(snapshot.index).not.toMatch(/Other game|Facilitator|Global|All games/u);
    expect(snapshot.totalBytes).toBeGreaterThan(new TextEncoder().encode(snapshot.index).byteLength);
  });

  it('fails before reading a request that does not match the server allowlist or policy', async () => {
    const repository = await repositoryWithPages([['notes/allowed.md', page('knw_allowed', 'Allowed', 'developer', [game])]]);
    const grounding = await ShadowKnowledgeGrounding.open(config(repository));
    groundings.push(grounding);

    expect(() => grounding.read({ ...request, shadow_principal_ref: `cubica://shadow-principal/v1/${'c'.repeat(64)}` })).toThrow('authorization_mismatch');
    expect(() => grounding.read({ ...request, applies_to: ['cubica://game-project/other'] as ModelGatewayRequest['applies_to'] })).toThrow('authorization_mismatch');
    expect(() => grounding.read({ ...request, access_policy_revision: 'revision-2' })).toThrow('authorization_mismatch');
    expect(() => grounding.read({ ...request, external_processing_policy_revision: 'policy-2' })).toThrow('authorization_mismatch');
  });

  it('fails closed when the allowed snapshot exceeds its configured bound', async () => {
    const repository = await repositoryWithPages([['notes/allowed.md', page('knw_allowed', 'Allowed body', 'developer', [game])]]);
    const grounding = await ShadowKnowledgeGrounding.open({ ...config(repository), maxSnapshotBytes: 1 });
    groundings.push(grounding);
    expect(() => grounding.read(request)).toThrow('snapshot_too_large');
  });

  it('bounds the raw repository before forbidden blobs are read into the snapshot', async () => {
    const repository = await repositoryWithPages([
      ['notes/allowed.md', page('knw_allowed', 'Allowed', 'developer', [game])],
      ['notes/forbidden.md', page('knw_forbidden', 'Forbidden', 'facilitator', [game], 'x'.repeat(512))]
    ]);
    const grounding = await ShadowKnowledgeGrounding.open({ ...config(repository), maxRepositoryBlobBytes: 256 });
    groundings.push(grounding);
    expect(() => grounding.read(request)).toThrow('snapshot_too_large');
  });

  it('copies configuration and returns a frozen text snapshot', async () => {
    const repository = await repositoryWithPages([['notes/allowed.md', page('knw_allowed', 'Allowed', 'developer', [game])]]);
    const mutable = config(repository);
    const grounding = await ShadowKnowledgeGrounding.open(mutable);
    groundings.push(grounding);
    mutable.expectedGameRef = 'cubica://game-project/other';

    const snapshot = grounding.read(request);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.pages)).toBe(true);
    expect(Object.isFrozen(snapshot.pages[0])).toBe(true);
    expect(() => (snapshot.pages as Array<unknown>).push({})).toThrow();
  });

  it('opens only an existing canonical bare repository and reads the trusted head', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cubica-shadow-grounding-invalid-'));
    const ordinary = join(root, 'ordinary');
    await mkdir(ordinary);
    await expect(ReadOnlyKnowledgeGit.open(ordinary)).rejects.toThrow('bare');

    const repository = await repositoryWithPages([]);
    const reader = await ReadOnlyKnowledgeGit.open(repository);
    readers.push(reader);
    expect(reader.readHeadSnapshot({ maxObjects: 1, maxBlobBytes: 1024, maxTotalBytes: 1024 }).commit).toMatch(/^[a-f0-9]{40}$/u);
  });
});

function config(repository: string) {
  return {
    repository,
    expectedPrincipalRef: principal,
    expectedGameRef: game,
    accessPolicyRef: request.access_policy_ref,
    accessPolicyRevision: request.access_policy_revision,
    externalProcessingPolicyRef: request.external_processing_policy_ref,
    externalProcessingPolicyRevision: request.external_processing_policy_revision
  };
}

async function repositoryWithPages(entries: Array<[string, string]>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cubica-shadow-grounding-'));
  const repository = join(root, 'knowledge.git');
  const store = await ManagedKnowledgeGit.init(repository);
  managed.push(store);
  for (const [path, content] of entries) {
    const sourceRefs = [{ ref: request.messages[0]!.message_ref, use: 'evidence' as const }];
    const proposal = finalize({
      schema_version: '1.0.0', proposal_id: `prop_${path.replace(/[^a-z0-9]/giu, '_')}`,
      base_commit: store.head(), patch_hash: '', source_refs: sourceRefs,
      applies_to: [game] as ExactPatchProposal['applies_to'],
      operations: [{ kind: 'create_file', path, new_text: content, reason: 'Grounding fixture', source_refs: sourceRefs }]
    });
    expect(store.apply(`op_${path.replace(/[^a-z0-9]/giu, '_')}`, proposal).status).toBe('applied');
  }
  return repository;
}

function page(id: string, title: string, role: 'developer' | 'facilitator' | 'global', appliesTo: string[], body = `${title} body\n`): string {
  return `---\n${JSON.stringify({
    schema_version: '1.0.0', type: 'note', title, description: `${title} description`,
    timestamp: '2026-08-10T10:00:00Z', cubica_id: id, role_scope: role,
    source_refs: [{ ref: request.messages[0]!.message_ref, use: 'evidence' }], applies_to: appliesTo
  })}\n---\n${body}`;
}

function finalize(proposal: ExactPatchProposal): ExactPatchProposal {
  proposal.patch_hash = hashExactPatchProposal(proposal);
  return proposal;
}
