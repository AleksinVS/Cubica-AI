/**
 * A closed bare-Git adapter for product knowledge.
 *
 * No checkout is ever created: semantic pages are read as blobs, transformed
 * in memory and written with plumbing commands.  This removes worktree hooks,
 * filters and filesystem-link attacks from the semantic-file path.
 */
import { constants } from 'node:fs';
import { lstat, mkdir, open, type FileHandle } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { validateProductKnowledgeContract, verifyExactPatchProposalHash } from './contracts.ts';
import type { ExactPatchProposal, KnowledgePage } from './generated/product-knowledge.ts';
import { applyExactOperation, codeUnitCompare, generateKnowledgeIndex, parseKnowledgePage } from './markdown.ts';

const REF = 'refs/heads/main';
const GIT_EXECUTABLE = '/usr/bin/git';
const zero = '0'.repeat(40);
export type GitApplyResult = { status: 'applied' | 'replayed' | 'conflict'; commit?: string };
export interface GitPatchPreview {
  readonly targetPath: string;
  readonly beforePage: KnowledgePage | null;
  readonly afterPage: KnowledgePage | null;
  readonly impactReasons: readonly ('duplicate_cubica_id' | 'duplicate_subject_key')[];
}
interface BuiltPreview extends GitPatchPreview { readonly pages: Map<string, Uint8Array>; }
interface GitReceipt { readonly commit: string; readonly operationId: string; readonly patchHash: string; }
export class ManagedKnowledgeGitError extends Error {}
export class ReadOnlyKnowledgeGitLimitError extends ManagedKnowledgeGitError {}

export interface ReadOnlyKnowledgeGitLimits {
  readonly maxObjects: number;
  readonly maxBlobBytes: number;
  readonly maxTotalBytes: number;
}

export interface ReadOnlyKnowledgeGitSnapshot {
  readonly commit: string;
  readonly pages: ReadonlyMap<string, Uint8Array>;
}

/**
 * Read-only view of one trusted bare repository.
 *
 * The class deliberately exposes no ref, object, config or maintenance write.
 * It is the Stage 2 grounding boundary: a model gateway may inspect the exact
 * canonical snapshot without acquiring the Stage 1 mutation capability.
 */
export class ReadOnlyKnowledgeGit {
  private constructor(private readonly directory: FileHandle) {}

  static async open(repository: string): Promise<ReadOnlyKnowledgeGit> {
    assertCanonicalRepositoryPath(repository);
    const directory = await openStableDirectory(repository);
    const store = new ReadOnlyKnowledgeGit(directory);
    try {
      let bare = false;
      try { bare = store.run(['rev-parse', '--is-bare-repository']).trim() === 'true'; }
      catch { /* normalized below so repository internals do not cross the boundary */ }
      if (!bare) {
        throw new ManagedKnowledgeGitError('Knowledge repository must be bare.');
      }
      store.head();
      return store;
    } catch (error) {
      await directory.close();
      throw error;
    }
  }

  head(): string { return this.run(['rev-parse', '--verify', REF]).trim(); }

  async close(): Promise<void> { await this.directory.close(); }

  /**
   * Reads the current trusted ref only. Git-reported sizes are checked before
   * any blob is loaded, so forbidden pages cannot bypass the raw corpus cap.
   */
  readHeadSnapshot(limits: ReadOnlyKnowledgeGitLimits): ReadOnlyKnowledgeGitSnapshot {
    assertReadOnlyLimits(limits);
    const commit = this.head();
    assertCommit(commit);
    const entries = this.runBytes(['ls-tree', '-r', '-l', '-z', commit]);
    const records = entries.toString('utf8').split('\0').filter(Boolean);
    if (records.length > limits.maxObjects) throw new ReadOnlyKnowledgeGitLimitError('Trusted tree exceeds the read-only object bound.');
    const planned: Array<{ path: string; hash: string; size: number }> = [];
    let totalBytes = 0;
    for (const record of records) {
      const match = /^(\d+) blob ([0-9a-f]{40})\s+(\d+)\t(.+)$/u.exec(record);
      if (!match || match[1] !== '100644' || !isPagePath(match[4])) throw new ManagedKnowledgeGitError('Trusted tree contains a forbidden entry.');
      const size = Number(match[3]);
      if (!Number.isSafeInteger(size) || size < 0 || size > limits.maxBlobBytes) {
        throw new ReadOnlyKnowledgeGitLimitError('Trusted tree exceeds the read-only blob bound.');
      }
      totalBytes += size;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
        throw new ReadOnlyKnowledgeGitLimitError('Trusted tree exceeds the read-only byte bound.');
      }
      planned.push({ path: match[4], hash: match[2], size });
    }
    const pages = new Map<string, Uint8Array>();
    for (const entry of planned) {
      const bytes = this.runBytes(['cat-file', 'blob', entry.hash]);
      if (bytes.byteLength !== entry.size) throw new ManagedKnowledgeGitError('Trusted blob size changed during the read.');
      pages.set(entry.path, bytes);
    }
    if (!pages.has('index.md')) throw new ManagedKnowledgeGitError('Trusted tree has no canonical index.');
    for (const [path, bytes] of pages) if (path !== 'index.md') parseKnowledgePage(bytes);
    return { commit, pages };
  }

  private run(args: string[], input?: Uint8Array): string { return this.runBytes(args, input).toString('utf8'); }
  private runBytes(args: string[], input?: Uint8Array): Buffer {
    const result = spawnSync(GIT_EXECUTABLE, ['--git-dir', '/proc/self/fd/3', ...args], { input, encoding: null, shell: false, env: cleanGitEnvironment(), stdio: ['pipe', 'pipe', 'pipe', this.directory.fd], maxBuffer: 16 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new ManagedKnowledgeGitError((result.stderr?.toString() || result.error?.message || 'Git command failed').trim());
    return result.stdout;
  }
}

export class ManagedKnowledgeGit {
  private constructor(private readonly directory: FileHandle) {}

  /** Creates one non-symlinked bare repository and its canonical empty index. */
  static async init(repository: string): Promise<ManagedKnowledgeGit> {
    assertCanonicalRepositoryPath(repository);
    await mkdir(repository, { recursive: true, mode: 0o700 });
    const directory = await openStableDirectory(repository);
    const store = new ManagedKnowledgeGit(directory);
    try {
      store.run(['init', '--bare', '--initial-branch=main']);
      const indexBlob = store.writeBlob(generateKnowledgeIndex(new Map()));
      const tree = store.writeTree(new Map([['index.md', indexBlob]]));
      const commit = store.commit(tree, undefined, 'Initialize isolated knowledge repository');
      store.run(['update-ref', '--create-reflog', REF, commit, zero]);
      return store;
    } catch (error) {
      await directory.close();
      throw error;
    }
  }

  head(): string { return this.run(['rev-parse', '--verify', REF]).trim(); }

  /** Releases the stable directory descriptor when this isolated store is no longer needed. */
  async close(): Promise<void> { await this.directory.close(); }

  /** Reads only the trusted current tree and rejects anything but ordinary Markdown blobs. */
  readPages(commit = this.head()): Map<string, Uint8Array> {
    assertCommit(commit);
    const entries = this.runBytes(['ls-tree', '-r', '-z', commit]);
    const pages = new Map<string, Uint8Array>();
    for (const record of entries.toString('utf8').split('\0').filter(Boolean)) {
      const match = /^(\d+) blob ([0-9a-f]{40})\t(.+)$/.exec(record);
      if (!match || match[1] !== '100644' || !isPagePath(match[3])) throw new ManagedKnowledgeGitError('Trusted tree contains a forbidden entry.');
      pages.set(match[3], this.runBytes(['cat-file', 'blob', match[2]]));
    }
    if (!pages.has('index.md')) throw new ManagedKnowledgeGitError('Trusted tree has no canonical index.');
    for (const [path, bytes] of pages) if (path !== 'index.md') parseKnowledgePage(bytes);
    return pages;
  }

  /** Applies one semantic operation; a CAS makes concurrent writers choose one winner. */
  apply(operationId: string, proposal: ExactPatchProposal, options?: { readonly afterCommitBeforeRef?: () => void }): GitApplyResult {
    assertReceiptInput(operationId, proposal.patch_hash);
    assertValidProposal(proposal);
    const replay = this.findReachableOperation(operationId);
    if (replay) {
      if (replay.patchHash !== proposal.patch_hash) throw new ManagedKnowledgeGitError('Operation ID is already bound to a different patch hash.');
      return { status: 'replayed', commit: replay.commit };
    }
    const expected = proposal.base_commit;
    if (this.head() !== expected) return { status: 'conflict' };
    const stranded = this.findUnreachableOperation(operationId, proposal.patch_hash, expected);
    if (stranded) {
      try { this.run(['update-ref', '--create-reflog', REF, stranded, expected]); return { status: 'applied', commit: stranded }; }
      catch { return this.findReachableReceipt(operationId, proposal.patch_hash) ? { status: 'replayed', commit: this.findReachableReceipt(operationId, proposal.patch_hash)! } : { status: 'conflict' }; }
    }
    const { pages } = this.buildPreview(proposal);
    pages.set('index.md', generateKnowledgeIndex(pages));
    const tree = this.writeTree(new Map([...pages].map(([pagePath, bytes]) => [pagePath, this.writeBlob(bytes)])));
    const commit = this.commit(tree, expected, `Apply knowledge operation\n\nOperation-Id: ${operationId}\nPatch-Hash: ${proposal.patch_hash}`);
    // This seam exists only to prove recovery from the unavoidable Git/SQL
    // transaction gap. Production callers do not supply it.
    options?.afterCommitBeforeRef?.();
    try { this.run(['update-ref', '--create-reflog', REF, commit, expected]); }
    catch { return this.findReachableReceipt(operationId, proposal.patch_hash) ? { status: 'replayed', commit: this.findReachableReceipt(operationId, proposal.patch_hash)! } : { status: 'conflict' }; }
    return { status: 'applied', commit };
  }

  /** Deterministically previews the one changed page without writing an object or ref. */
  preview(proposal: ExactPatchProposal): GitPatchPreview {
    assertValidProposal(proposal);
    const { pages: _pages, ...preview } = this.buildPreview(proposal);
    return preview;
  }

  /**
   * Returns a receipt only when one commit with the exact operation/hash pair
   * is reachable from the trusted ref. This is the safe callback for expired
   * PostgreSQL-lease reconciliation.
   */
  findReachableReceipt(operationId: string, patchHash: string): string | null {
    assertReceiptInput(operationId, patchHash);
    const receipt = this.findReachableOperation(operationId);
    if (!receipt) return null;
    return receipt.patchHash === patchHash ? receipt.commit : null;
  }

  /** Test-only purge for a disposable repo. It proves Git-object cleanup, not production backup/KMS deletion. */
  purgeDisposableRepository(): void {
    this.run(['update-ref', '-d', REF, this.head()]);
    this.run(['reflog', 'expire', '--expire=now', '--expire-unreachable=now', '--all']);
    this.run(['gc', '--prune=now', '--aggressive']);
  }

  private buildPreview(proposal: ExactPatchProposal): BuiltPreview {
    if (new Set(proposal.operations.map((operation) => operation.path)).size !== 1) throw new ManagedKnowledgeGitError('A proposal must target one content path.');
    if (this.head() !== proposal.base_commit) throw new ManagedKnowledgeGitError('Proposal base revision is no longer current.');
    const pages = this.readPages(proposal.base_commit);
    const targetPath = proposal.operations[0]!.path;
    if (!isContentPath(targetPath)) throw new ManagedKnowledgeGitError('Proposal may not target index.md or a special path.');
    const original = pages.get(targetPath);
    if (original && proposal.operations.some((operation) => operation.kind === 'create_file')) {
      throw new ManagedKnowledgeGitError('create_file cannot replace an existing page.');
    }
    if (!original && (proposal.operations.length !== 1 || proposal.operations[0]!.kind !== 'create_file')) {
      throw new ManagedKnowledgeGitError('An absent page requires exactly one create_file operation.');
    }
    const beforePage = original ? parseKnowledgePage(original) : null;
    for (const patch of proposal.operations) {
      const next = applyExactOperation(pages.get(targetPath), patch, original);
      if (next === undefined) pages.delete(targetPath); else pages.set(targetPath, next);
    }
    const afterBytes = pages.get(targetPath);
    const afterPage = afterBytes ? parseKnowledgePage(afterBytes) : null;
    if (beforePage && afterPage && beforePage.cubica_id !== afterPage.cubica_id) {
      throw new ManagedKnowledgeGitError('An existing page cubica_id is immutable.');
    }
    const impactReasons = new Set<GitPatchPreview['impactReasons'][number]>();
    if (afterPage) {
      for (const [path, bytes] of pages) {
        if (path === 'index.md' || path === targetPath) continue;
        const other = parseKnowledgePage(bytes);
        if (other.cubica_id === afterPage.cubica_id) throw new ManagedKnowledgeGitError('cubica_id must be unique in the trusted tree.');
        if (other.subject_key && afterPage.subject_key === other.subject_key && overlaps(other.applies_to as unknown as string[], afterPage.applies_to as unknown as string[])) {
          impactReasons.add('duplicate_subject_key');
        }
      }
    }
    return { targetPath, beforePage, afterPage, impactReasons: [...impactReasons].sort(), pages };
  }

  private findReachableOperation(operationId: string): GitReceipt | undefined {
    const output = this.run(['log', REF, '--format=%H%x00%B%x00']);
    const records = output.split('\0');
    for (let index = 0; index + 1 < records.length; index += 2) {
      const receipt = parseReceipt(records[index]!, records[index + 1]!);
      if (receipt?.operationId === operationId) return receipt;
    }
    return undefined;
  }
  private findUnreachableOperation(operationId: string, patchHash: string, expectedParent: string): string | undefined {
    const candidates = this.run(['fsck', '--no-reflogs', '--unreachable', '--no-progress']).matchAll(/unreachable commit ([0-9a-f]{40})/g);
    for (const [, sha] of candidates) {
      const message = this.run(['show', '-s', '--format=%B', sha]);
      const receipt = parseReceipt(sha, message);
      if (!receipt || receipt.operationId !== operationId || receipt.patchHash !== patchHash) continue;
      const parents = this.run(['show', '-s', '--format=%P', sha]).trim().split(' ');
      if (parents.length === 1 && parents[0] === expectedParent) return sha;
    }
    return undefined;
  }
  private writeBlob(bytes: Uint8Array): string { return this.runBytes(['hash-object', '-w', '--stdin', '--no-filters'], bytes).toString('utf8').trim(); }
  private writeTree(blobs: Map<string, string>): string {
    type Node = Map<string, Node | string>; const root: Node = new Map();
    // Build recursively from safe path components; mktree receives only fixed-format entries.
    const insert = (path: string, blob: string) => { let node = root; const parts = path.split('/'); for (const part of parts.slice(0, -1)) { let child = node.get(part); if (!child) { child = new Map(); node.set(part, child); } if (typeof child === 'string') throw new ManagedKnowledgeGitError('Path conflicts with blob.'); node = child; } node.set(parts.at(-1)!, blob); };
    for (const [path, blob] of blobs) insert(path, blob);
    const build = (node: Node): string => {
      const lines: string[] = [];
      for (const [name, child] of [...node].sort(([a], [b]) => codeUnitCompare(a, b))) lines.push(typeof child === 'string' ? `100644 blob ${child}\t${name}` : `040000 tree ${build(child)}\t${name}`);
      return this.run(['mktree'], lines.join('\n') + (lines.length ? '\n' : '')).trim();
    };
    return build(root);
  }
  private commit(tree: string, parent: string | undefined, message: string): string { return this.run(parent ? ['commit-tree', tree, '-p', parent] : ['commit-tree', tree], message).trim(); }
  private run(args: string[], input?: string): string { return this.runBytes(args, input).toString('utf8'); }
  private runBytes(args: string[], input?: string | Uint8Array): Buffer {
    // No caller-controlled argv, shell, configuration or hook path reaches Git.
    // `/proc/self/fd/3` names the inherited directory descriptor, not the
    // mutable pathname supplied during setup. Thus a later rename/symlink swap
    // cannot redirect Git's writes to another repository on Linux hosts.
    const result = spawnSync(GIT_EXECUTABLE, ['--git-dir', '/proc/self/fd/3', ...args], { input, encoding: null, shell: false, env: cleanGitEnvironment(), stdio: ['pipe', 'pipe', 'pipe', this.directory.fd], maxBuffer: 16 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw new ManagedKnowledgeGitError((result.stderr?.toString() || result.error?.message || 'Git command failed').trim());
    return result.stdout;
  }
}

function cleanGitEnvironment(): NodeJS.ProcessEnv { return { NODE_ENV: 'production', PATH: '/usr/bin:/bin', HOME: '/dev/null', XDG_CONFIG_HOME: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_AUTHOR_NAME: 'Cubica Knowledge', GIT_AUTHOR_EMAIL: 'knowledge@cubica.invalid', GIT_COMMITTER_NAME: 'Cubica Knowledge', GIT_COMMITTER_EMAIL: 'knowledge@cubica.invalid', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/dev/null' }; }
function assertCanonicalRepositoryPath(repository: string): void {
  if (!isAbsolute(repository)) throw new ManagedKnowledgeGitError('Repository path must be absolute.');
  if (resolve(repository) !== repository) throw new ManagedKnowledgeGitError('Repository path must be canonical.');
}
function assertCommit(commit: string): void {
  if (!/^[0-9a-f]{40}$/u.test(commit)) throw new ManagedKnowledgeGitError('Knowledge commit must be an exact SHA-1 object ID.');
}
function assertReadOnlyLimits(limits: ReadOnlyKnowledgeGitLimits): void {
  for (const value of [limits.maxObjects, limits.maxBlobBytes, limits.maxTotalBytes]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new ManagedKnowledgeGitError('Read-only Git limits must be positive integers.');
  }
}
function assertReceiptInput(operationId: string, patchHash: string): void {
  if (!/^op_[A-Za-z0-9_-]+$/.test(operationId)) throw new ManagedKnowledgeGitError('Operation ID has an invalid format.');
  if (!/^sha256:[a-f0-9]{64}$/.test(patchHash)) throw new ManagedKnowledgeGitError('Patch hash has an invalid format.');
}
function assertValidProposal(proposal: ExactPatchProposal): void {
  if (!validateProductKnowledgeContract<ExactPatchProposal>('ExactPatchProposal', proposal).ok) {
    throw new ManagedKnowledgeGitError('Proposal violates the canonical JSON Schema.');
  }
  if (!verifyExactPatchProposalHash(proposal)) {
    throw new ManagedKnowledgeGitError('Proposal patch hash does not bind its exact content.');
  }
}
function parseReceipt(commit: string, message: string): GitReceipt | undefined {
  const operation = /^Operation-Id: (op_[A-Za-z0-9_-]+)$/m.exec(message)?.[1];
  const patchHash = /^Patch-Hash: (sha256:[a-f0-9]{64})$/m.exec(message)?.[1];
  return operation && patchHash ? { commit, operationId: operation, patchHash } : undefined;
}
function overlaps(left: readonly string[], right: readonly string[]): boolean { return left.some((value) => right.includes(value)); }
function isPagePath(path: string): boolean { return path === 'index.md' || isContentPath(path); }
function isContentPath(path: string): boolean { return /^(?!.*(?:^|\/)\.)(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.md$/.test(path) && path !== 'index.md'; }
/**
 * Opens the repository itself with `O_NOFOLLOW`, then verifies that the path
 * still names the same inode. This closes the check/open race: a concurrent
 * symlink swap either fails the open or differs from the held descriptor.
 */
async function openStableDirectory(path: string): Promise<FileHandle> {
  let directory: FileHandle;
  try {
    directory = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  } catch {
    throw new ManagedKnowledgeGitError('Repository root must be a stable non-symlink directory.');
  }
  try {
    const [named, held] = await Promise.all([lstat(path), directory.stat()]);
    if (!named.isDirectory() || named.isSymbolicLink() || !held.isDirectory() || named.dev !== held.dev || named.ino !== held.ino) {
      throw new ManagedKnowledgeGitError('Repository root must be a stable non-symlink directory.');
    }
    return directory;
  } catch (error) {
    await directory.close();
    throw error;
  }
}
