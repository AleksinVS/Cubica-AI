import type {
  FacilitatorDebriefDraft,
  FacilitatorDebriefError,
  ImmutableGameBundle,
  SessionAuthenticationInput,
  SessionEventRecord,
  SessionRecord
} from "@cubica/contracts-session";
import type {
  FacilitatorDebriefFailedProviderAudit,
  FacilitatorDebriefProviderAudit,
  FacilitatorDebriefProviderRequestAudit
} from "./facilitatorDebriefProvider.ts";

export interface StoredFacilitatorDebriefAttempt {
  readonly runId: string;
  readonly sessionId: string;
  readonly status: "generating" | "ready" | "failed";
  readonly expectedStateVersion: number;
  readonly throughEventSequence: number;
  readonly journalSha256: `sha256:${string}`;
  readonly requestAudit: FacilitatorDebriefProviderRequestAudit;
  readonly providerRequestId?: string;
  readonly providerStatus?: number;
  readonly providerUsage?: unknown;
  readonly responseBytes?: number;
  readonly durationMs?: number;
  readonly rawResponseUtf8?: string;
  readonly draft?: FacilitatorDebriefDraft;
  readonly error?: FacilitatorDebriefError;
  readonly requestedAt: Date;
  readonly completedAt?: Date;
}

export interface FacilitatorDebriefStatusSource<TState = Record<string, unknown>> {
  readonly session: SessionRecord<TState>;
  readonly attempt: StoredFacilitatorDebriefAttempt | null;
}

export interface FacilitatorDebriefGenerationSource<TState = Record<string, unknown>>
  extends FacilitatorDebriefStatusSource<TState> {
  readonly bundle: ImmutableGameBundle;
  readonly lifecycle: "active" | "archived";
  readonly archivedAt?: Date;
  readonly events: ReadonlyArray<SessionEventRecord>;
}

export interface BeginFacilitatorDebriefAttemptInput {
  readonly runId: string;
  readonly sessionId: string;
  /** Rechecked under the same lock that creates the durable attempt. */
  readonly credentialSha256: string;
  readonly expectedStateVersion: number;
  readonly throughEventSequence: number;
  readonly journalSha256: `sha256:${string}`;
  readonly requestAudit: FacilitatorDebriefProviderRequestAudit;
  readonly requestedAt: Date;
  /** An older generating attempt is failed atomically before this run begins. */
  readonly staleGeneratingBefore: Date;
}

export type BeginFacilitatorDebriefAttemptResult =
  | { readonly kind: "created"; readonly attempt: StoredFacilitatorDebriefAttempt }
  | { readonly kind: "existing"; readonly attempt: StoredFacilitatorDebriefAttempt }
  | { readonly kind: "authentication-failed" }
  | { readonly kind: "version-conflict" };

interface CompleteFacilitatorDebriefAttemptBase {
  readonly sessionId: string;
  readonly runId: string;
  readonly completedAt: Date;
}

export type CompleteFacilitatorDebriefAttemptInput =
  | (CompleteFacilitatorDebriefAttemptBase & {
      readonly status: "ready";
      readonly audit: FacilitatorDebriefProviderAudit;
      readonly draft: FacilitatorDebriefDraft;
    })
  | (CompleteFacilitatorDebriefAttemptBase & {
      readonly status: "failed";
      readonly audit: FacilitatorDebriefFailedProviderAudit;
      readonly providerStatus?: number;
      readonly error: FacilitatorDebriefError;
    });

/** Additional store boundary owned only by the read-only facilitator debrief. */
export interface FacilitatorDebriefStorePort<TState = Record<string, unknown>> {
  readFacilitatorDebriefStatus(
    input: SessionAuthenticationInput
  ): Promise<FacilitatorDebriefStatusSource<TState> | null>;
  readFacilitatorDebriefGenerationSource(
    input: SessionAuthenticationInput,
    limit: number
  ): Promise<FacilitatorDebriefGenerationSource<TState> | null>;
  beginFacilitatorDebriefAttempt(
    input: BeginFacilitatorDebriefAttemptInput
  ): Promise<BeginFacilitatorDebriefAttemptResult>;
  completeFacilitatorDebriefAttempt(
    input: CompleteFacilitatorDebriefAttemptInput
  ): Promise<StoredFacilitatorDebriefAttempt | null>;
}
