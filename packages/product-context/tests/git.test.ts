/** Integration evidence for the bare plumbing adapter's safety invariants. */
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashExactPatchProposal } from '../src/contracts.ts';
import { ManagedKnowledgeGit, ManagedKnowledgeGitError } from '../src/git.ts';
import { sha256Bytes } from '../src/markdown.ts';
import type { ExactPatchProposal } from '../src/generated/product-knowledge.ts';

const bytes = new TextEncoder();
const hash = (text: string) => sha256Bytes(bytes.encode(text));
const appliesTo = ['cubica://game-project/demo'] as unknown as ExactPatchProposal['applies_to'];
const openStores: ManagedKnowledgeGit[] = [];
afterEach(async () => { await Promise.all(openStores.splice(0).map((store) => store.close())); });
const page = (id: string, body: string, subjectKey?: string) => `---\n${JSON.stringify({ schema_version: '1.0.0', type: 'note', title: id, description: `${id} description`, timestamp: '2026-08-09T10:00:00Z', cubica_id: id, role_scope: 'developer', ...(subjectKey ? { subject_key: subjectKey } : {}), source_refs: [{ ref: 'cubica://dialog/demo/message/user', use: 'evidence' }], applies_to: ['cubica://game-project/demo'] })}\n---\n${body}`;
const proposal = (base: string, path: string, oldText: string, newText?: string): ExactPatchProposal => finalize({ schema_version: '1.0.0', proposal_id: 'prop_test', base_commit: base, patch_hash: '', source_refs: [{ ref: 'cubica://dialog/demo/message/user', use: 'evidence' }], applies_to: appliesTo, operations: [{ kind: newText === undefined ? 'delete_exact' : 'replace_exact', path, base_file_hash: hash(page('knw_one', oldText)), old_text: oldText, old_text_hash: hash(oldText), expected_matches: 1, ...(newText === undefined ? {} : { new_text: newText }), reason: 'Test change', source_refs: [{ ref: 'cubica://dialog/demo/message/user', use: 'evidence' }] }] });

async function storeWithOnePage(): Promise<{ store: ManagedKnowledgeGit; base: string; repository: string }> {
  const root = await mkdtemp(join(tmpdir(), 'cubica-knowledge-'));
  const store = await ManagedKnowledgeGit.init(join(root, 'knowledge.git'));
  openStores.push(store);
  const base = store.head();
  const create: ExactPatchProposal = finalize({ schema_version: '1.0.0', proposal_id: 'prop_create', base_commit: base, patch_hash: '', source_refs: [{ ref: 'cubica://dialog/demo/message/user', use: 'evidence' }], applies_to: appliesTo, operations: [{ kind: 'create_file', path: 'notes/one.md', new_text: page('knw_one', 'control string'), reason: 'Create', source_refs: [{ ref: 'cubica://dialog/demo/message/user', use: 'evidence' }] }] });
  expect(store.apply('op_create', create).status).toBe('applied');
  const secondBase = store.head();
  const second: ExactPatchProposal = finalize({ ...create, proposal_id: 'prop_create_second', base_commit: secondBase, patch_hash: '', operations: [{ ...create.operations[0]!, path: 'notes/two.md', new_text: page('knw_two', 'unchanged neighbor') }] });
  expect(store.apply('op_create_second', second).status).toBe('applied');
  return { store, base: store.head(), repository: join(root, 'knowledge.git') };
}

describe('managed bare Git', () => {
  it('changes one blob, regenerates index, and replays an applied operation', async () => {
    const { store, base, repository } = await storeWithOnePage();
    const before = store.readPages();
    const neighborBlobBefore = execFileSync('/usr/bin/git', ['--git-dir', repository, 'rev-parse', `${base}:notes/two.md`], { encoding: 'utf8' }).trim();
    const result = store.apply('op_edit', proposal(base, 'notes/one.md', 'control string', 'corrected string'));
    expect(result.status).toBe('applied');
    const after = store.readPages();
    expect(new TextDecoder().decode(after.get('notes/one.md'))).toContain('corrected string');
    expect(after.get('notes/two.md')).toEqual(before.get('notes/two.md'));
    const neighborBlobAfter = execFileSync('/usr/bin/git', ['--git-dir', repository, 'rev-parse', `${result.commit}:notes/two.md`], { encoding: 'utf8' }).trim();
    expect(neighborBlobAfter).toBe(neighborBlobBefore);
    expect(after.get('index.md')).toEqual(before.get('index.md'));
    expect(store.apply('op_edit', proposal(base, 'notes/one.md', 'control string', 'corrected string'))).toMatchObject({ status: 'replayed', commit: result.commit });
    expect(store.findReachableReceipt('op_edit', proposal(base, 'notes/one.md', 'control string', 'corrected string').patch_hash)).toBe(result.commit);
    expect(store.findReachableReceipt('op_edit', `sha256:${'0'.repeat(64)}`)).toBeNull();
  });
  it('has one CAS winner and recovers a commit stranded before its ref update', async () => {
    const { store, base } = await storeWithOnePage();
    const patch = proposal(base, 'notes/one.md', 'control string', 'recovered string');
    expect(() => store.apply('op_crash', patch, { afterCommitBeforeRef: () => { throw new Error('simulated crash'); } })).toThrow('simulated crash');
    expect(store.apply('op_crash', patch).status).toBe('applied');
    const stale = proposal(base, 'notes/one.md', 'control string', 'other writer');
    expect(store.apply('op_other', stale).status).toBe('conflict');
  });
  it('rejects an injected operation ID before it can affect a commit or log search', async () => {
    const { store, base } = await storeWithOnePage();
    expect(() => store.apply('op_ok\nOperation-Id: op_forged', proposal(base, 'notes/one.md', 'control string', 'forbidden'))).toThrow('invalid format');
  });
  it('rejects a proposal whose claimed patch hash does not bind its content', async () => {
    const { store, base } = await storeWithOnePage();
    const patch = proposal(base, 'notes/one.md', 'control string', 'changed');
    patch.operations[0]!.new_text = 'tampered after hashing';
    expect(() => store.apply('op_tampered', patch)).toThrow('does not bind');
  });
  it('executes the canonical schema again at the Git mutation boundary', async () => {
    const { store, base } = await storeWithOnePage();
    const patch = proposal(base, 'notes/one.md', 'control string', 'changed');
    (patch.operations[0] as unknown as { expected_matches: number }).expected_matches = 2;
    patch.patch_hash = hashExactPatchProposal(patch);
    expect(() => store.apply('op_invalid_schema', patch)).toThrow('canonical JSON Schema');
  });
  it('cannot turn delete plus create into a full rewrite of an existing page', async () => {
    const { store, base } = await storeWithOnePage();
    const current = page('knw_one', 'control string');
    const sourceRefs = [{ ref: 'cubica://dialog/demo/message/user', use: 'evidence' as const }];
    const rewrite = finalize({
      schema_version: '1.0.0', proposal_id: 'prop_full_rewrite', base_commit: base, patch_hash: '',
      source_refs: sourceRefs, applies_to: appliesTo,
      operations: [
        { kind: 'delete_exact', path: 'notes/one.md', base_file_hash: hash(current), old_text: current, old_text_hash: hash(current), expected_matches: 1, reason: 'Delete first', source_refs: sourceRefs },
        { kind: 'create_file', path: 'notes/one.md', new_text: page('knw_one', 'silently rewritten whole page'), reason: 'Recreate', source_refs: sourceRefs }
      ]
    });
    expect(() => store.apply('op_full_rewrite', rewrite)).toThrow('canonical JSON Schema');
    expect(new TextDecoder().decode(store.readPages().get('notes/one.md'))).toContain('control string');
  });
  it('hard-rejects duplicate stable IDs and keeps subject overlap as a review trigger', async () => {
    const { store } = await storeWithOnePage();
    const first = createPageProposal(store.head(), 'prop_subject_first', 'notes/subject-first.md', page('knw_subject', 'first subject page', 'shared-subject'));
    expect(store.apply('op_subject_first', first).status).toBe('applied');
    const duplicate = createPageProposal(store.head(), 'prop_subject_duplicate', 'notes/subject-duplicate.md', page('knw_subject', 'duplicate subject page', 'shared-subject'));
    expect(() => store.preview(duplicate)).toThrow('cubica_id must be unique');
    const overlap = createPageProposal(store.head(), 'prop_subject_overlap', 'notes/subject-overlap.md', page('knw_subject_other', 'overlapping subject page', 'shared-subject'));
    expect(store.preview(overlap).impactReasons).toEqual(['duplicate_subject_key']);
  });
  it('keeps an existing page stable ID immutable', async () => {
    const { store, base } = await storeWithOnePage();
    const current = store.readPages().get('notes/one.md')!;
    const sourceRefs = [{ ref: 'cubica://dialog/demo/message/user', use: 'evidence' as const }];
    const changedId = finalize({
      schema_version: '1.0.0', proposal_id: 'prop_reidentified', base_commit: base, patch_hash: '',
      source_refs: sourceRefs, applies_to: appliesTo,
      operations: [{
        kind: 'replace_exact', path: 'notes/one.md', base_file_hash: sha256Bytes(current),
        old_text: new TextDecoder().decode(current), old_text_hash: sha256Bytes(current),
        new_text: page('knw_reidentified', 'rewritten identity'), expected_matches: 1,
        reason: 'Attempt to change stable identity', source_refs: sourceRefs
      }]
    });
    expect(() => store.preview(changedId)).toThrow('cubica_id is immutable');
  });
  it('rejects model-targetable index and special paths before writing Git objects', async () => {
    const { store, base } = await storeWithOnePage();
    for (const path of ['index.md', '.gitattributes', '.git/config.md', 'notes/.gitattributes.md', '../escape.md']) {
      const patch = proposal(base, path, 'control string', 'forbidden');
      expect(() => store.apply(`op_path_${path.replace(/[^a-z]/g, '')}`, patch)).toThrow('canonical JSON Schema');
    }
  });
  it('logically forgets a whole exact file and purges a disposable repository', async () => {
    const { store, base, repository } = await storeWithOnePage();
    const entire = page('knw_one', 'control string');
    const forget = proposal(base, 'notes/one.md', entire);
    forget.operations[0]!.base_file_hash = hash(entire);
    forget.operations[0]!.old_text_hash = hash(entire);
    forget.patch_hash = hashExactPatchProposal(forget);
    expect(store.apply('op_forget', forget).status).toBe('applied');
    expect(store.readPages().has('notes/one.md')).toBe(false);
    store.purgeDisposableRepository();
    expect(() => store.head()).toThrow(ManagedKnowledgeGitError);
    const objects = execFileSync('git', ['--git-dir', repository, 'cat-file', '--batch-all-objects', '--batch'], { encoding: 'utf8' });
    expect(objects).not.toContain('control string');
  });
  it('rejects a symlink repository root and never runs a bare-repository hook', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cubica-knowledge-'));
    await mkdir(join(root, 'real'));
    await symlink(join(root, 'real'), join(root, 'link'));
    await expect(ManagedKnowledgeGit.init(join(root, 'link'))).rejects.toThrow('non-symlink');
    const store = await ManagedKnowledgeGit.init(join(root, 'hook.git'));
    openStores.push(store);
    const marker = join(root, 'hook-ran');
    await writeFile(join(root, 'hook.git', 'hooks', 'pre-commit'), `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });
    // This represents a malicious repository-local filter. The adapter writes
    // blobs with --no-filters and never checks out a worktree, so neither this
    // command nor the hook above can execute.
    await writeFile(join(root, 'hook.git', 'info', 'attributes'), '*.md filter=spy\n');
    execFileSync('git', ['--git-dir', join(root, 'hook.git'), 'config', 'filter.spy.clean', `sh -c 'touch ${marker}'`]);
    const base = store.head();
    const create: ExactPatchProposal = finalize({ schema_version: '1.0.0', proposal_id: 'prop_hook', base_commit: base, patch_hash: '', source_refs: [{ ref: 'cubica://dialog/demo/message/user', use: 'evidence' }], applies_to: appliesTo, operations: [{ kind: 'create_file', path: 'notes/hook.md', new_text: page('knw_hook', 'hook proof'), reason: 'Create', source_refs: [{ ref: 'cubica://dialog/demo/message/user', use: 'evidence' }] }] });
    expect(store.apply('op_hook', create).status).toBe('applied');
    expect(() => execFileSync('test', ['-e', marker])).toThrow();
  });
  it('keeps using the held repository inode after a pathname swap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cubica-knowledge-swap-'));
    const repository = join(root, 'knowledge.git');
    const heldRepository = join(root, 'held.git');
    const replacement = join(root, 'replacement.git');
    const store = await ManagedKnowledgeGit.init(repository);
    openStores.push(store);
    const base = store.head();
    await rename(repository, heldRepository);
    await mkdir(replacement);
    await symlink(replacement, repository);

    const create = createPageProposal(base, 'prop_swap', 'notes/swap.md', page('knw_swap', 'held inode proof'));
    expect(store.apply('op_swap', create).status).toBe('applied');
    expect(execFileSync('/usr/bin/git', ['--git-dir', heldRepository, 'rev-parse', '--verify', 'refs/heads/main'], { encoding: 'utf8' }).trim()).toBe(store.head());
    expect(await readdir(replacement)).toEqual([]);
  });
});

function finalize(value: ExactPatchProposal): ExactPatchProposal {
  value.patch_hash = hashExactPatchProposal(value);
  return value;
}

function createPageProposal(base: string, proposalId: string, path: string, newText: string): ExactPatchProposal {
  const sourceRefs = [{ ref: 'cubica://dialog/demo/message/user', use: 'evidence' as const }];
  return finalize({
    schema_version: '1.0.0', proposal_id: proposalId, base_commit: base, patch_hash: '',
    source_refs: sourceRefs, applies_to: appliesTo,
    operations: [{ kind: 'create_file', path, new_text: newText, reason: 'Preview deterministic impact', source_refs: sourceRefs }]
  });
}
