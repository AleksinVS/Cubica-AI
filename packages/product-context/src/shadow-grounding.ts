/**
 * Provider-neutral read-only wiki grounding for the Stage 2 model gateway.
 *
 * The request may name a principal and game, but it never selects a repository
 * or access policy. Those are fixed by server configuration for the one-user,
 * one-game Stage 2 allowlist. The returned snapshot has no mutation methods and
 * contains only pages admitted by the existing knowledge read policy.
 */
import { ReadOnlyKnowledgeGit, ReadOnlyKnowledgeGitLimitError } from './git.ts';
import { generateKnowledgeIndex, projectKnowledgePages } from './markdown.ts';
import { validateProductKnowledgeContract } from './contracts.ts';
import type { ModelGatewayRequest } from './generated/product-knowledge.ts';

const principalPattern = /^cubica:\/\/shadow-principal\/v1\/[a-f0-9]{64}$/u;
const gamePattern = /^cubica:\/\/game-project\/[A-Za-z0-9_-]{1,128}$/u;
const policyPattern = /^[A-Za-z0-9._:-]{1,128}$/u;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export type ShadowGroundingErrorCode =
  | 'invalid_configuration'
  | 'invalid_request'
  | 'authorization_mismatch'
  | 'snapshot_too_large';

export class ShadowGroundingError extends Error {
  constructor(readonly code: ShadowGroundingErrorCode) {
    super(`Shadow knowledge grounding failed: ${code}.`);
    this.name = 'ShadowGroundingError';
  }
}

export interface ShadowKnowledgeGroundingConfig {
  readonly repository: string;
  readonly expectedPrincipalRef: string;
  readonly expectedGameRef: string;
  readonly accessPolicyRef: string;
  readonly accessPolicyRevision: string;
  readonly externalProcessingPolicyRef: string;
  readonly externalProcessingPolicyRevision: string;
  readonly maxPages?: number;
  readonly maxSnapshotBytes?: number;
  readonly maxRepositoryObjects?: number;
  readonly maxRepositoryBlobBytes?: number;
  readonly maxRepositoryBytes?: number;
}

export interface ShadowKnowledgeSnapshotPage {
  readonly path: string;
  readonly content: string;
}

export interface ShadowKnowledgeSnapshot {
  readonly commit: string;
  readonly index: string;
  readonly pages: readonly ShadowKnowledgeSnapshotPage[];
  readonly totalBytes: number;
}

interface ResolvedGroundingConfig {
  readonly repository: string;
  readonly expectedPrincipalRef: string;
  readonly expectedGameRef: string;
  readonly accessPolicyRef: string;
  readonly accessPolicyRevision: string;
  readonly externalProcessingPolicyRef: string;
  readonly externalProcessingPolicyRevision: string;
  readonly maxPages: number;
  readonly maxSnapshotBytes: number;
  readonly maxRepositoryObjects: number;
  readonly maxRepositoryBlobBytes: number;
  readonly maxRepositoryBytes: number;
}

export class ShadowKnowledgeGrounding {
  private constructor(
    private readonly git: ReadOnlyKnowledgeGit,
    private readonly config: ResolvedGroundingConfig
  ) {}

  static async open(config: ShadowKnowledgeGroundingConfig): Promise<ShadowKnowledgeGrounding> {
    const resolved = resolveConfig(config);
    let git: ReadOnlyKnowledgeGit;
    try { git = await ReadOnlyKnowledgeGit.open(resolved.repository); }
    catch { throw new ShadowGroundingError('invalid_configuration'); }
    return new ShadowKnowledgeGrounding(git, resolved);
  }

  async close(): Promise<void> { await this.git.close(); }

  /** Returns one immutable-by-convention snapshot bound to the request scope. */
  read(request: ModelGatewayRequest): ShadowKnowledgeSnapshot {
    if (!validateProductKnowledgeContract<ModelGatewayRequest>('ModelGatewayRequest', request).ok) {
      throw new ShadowGroundingError('invalid_request');
    }
    if (request.shadow_principal_ref !== this.config.expectedPrincipalRef ||
        request.applies_to.length !== 1 || request.applies_to[0] !== this.config.expectedGameRef ||
        request.access_policy_ref !== this.config.accessPolicyRef ||
        request.access_policy_revision !== this.config.accessPolicyRevision ||
        request.external_processing_decision !== 'allow' ||
        request.external_processing_policy_ref !== this.config.externalProcessingPolicyRef ||
        request.external_processing_policy_revision !== this.config.externalProcessingPolicyRevision) {
      throw new ShadowGroundingError('authorization_mismatch');
    }

    let repositorySnapshot;
    try {
      repositorySnapshot = this.git.readHeadSnapshot({
        maxObjects: this.config.maxRepositoryObjects,
        maxBlobBytes: this.config.maxRepositoryBlobBytes,
        maxTotalBytes: this.config.maxRepositoryBytes
      });
    } catch (error) {
      throw new ShadowGroundingError(error instanceof ReadOnlyKnowledgeGitLimitError ? 'snapshot_too_large' : 'invalid_configuration');
    }
    const pages = projectKnowledgePages(repositorySnapshot.pages, {
      role: 'developer',
      knownAppliesTo: new Set([this.config.expectedGameRef]),
      currentAppliesTo: new Set([this.config.expectedGameRef]),
      allUserGamesConfirmed: false,
      globalConfirmed: false
    });
    if (pages.size > this.config.maxPages) throw new ShadowGroundingError('snapshot_too_large');

    const index = decoder.decode(generateKnowledgeIndex(pages));
    const immutablePages = Object.freeze([...pages].map(([path, bytes]) => Object.freeze({ path, content: decoder.decode(bytes) })));
    let totalBytes = encoder.encode(index).byteLength;
    for (const page of immutablePages) totalBytes += encoder.encode(page.path).byteLength + encoder.encode(page.content).byteLength;
    if (totalBytes > this.config.maxSnapshotBytes) throw new ShadowGroundingError('snapshot_too_large');

    return Object.freeze({
      commit: repositorySnapshot.commit,
      index,
      pages: immutablePages,
      totalBytes
    });
  }
}

function resolveConfig(config: ShadowKnowledgeGroundingConfig): ResolvedGroundingConfig {
  if (!principalPattern.test(config.expectedPrincipalRef) ||
      !gamePattern.test(config.expectedGameRef) ||
      !policyPattern.test(config.accessPolicyRef) ||
      !policyPattern.test(config.accessPolicyRevision) ||
      !policyPattern.test(config.externalProcessingPolicyRef) ||
      !policyPattern.test(config.externalProcessingPolicyRevision)) {
    throw new ShadowGroundingError('invalid_configuration');
  }
  return Object.freeze({
    repository: config.repository,
    expectedPrincipalRef: config.expectedPrincipalRef,
    expectedGameRef: config.expectedGameRef,
    accessPolicyRef: config.accessPolicyRef,
    accessPolicyRevision: config.accessPolicyRevision,
    externalProcessingPolicyRef: config.externalProcessingPolicyRef,
    externalProcessingPolicyRevision: config.externalProcessingPolicyRevision,
    maxPages: bounded(config.maxPages ?? 128, 1, 1_000),
    maxSnapshotBytes: bounded(config.maxSnapshotBytes ?? 1024 * 1024, 1, 8 * 1024 * 1024),
    maxRepositoryObjects: bounded(config.maxRepositoryObjects ?? 512, 1, 10_000),
    maxRepositoryBlobBytes: bounded(config.maxRepositoryBlobBytes ?? 256 * 1024, 1, 8 * 1024 * 1024),
    maxRepositoryBytes: bounded(config.maxRepositoryBytes ?? 4 * 1024 * 1024, 1, 32 * 1024 * 1024)
  });
}

function bounded(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ShadowGroundingError('invalid_configuration');
  }
  return value;
}
