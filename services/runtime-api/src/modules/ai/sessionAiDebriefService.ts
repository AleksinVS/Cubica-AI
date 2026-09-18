import { createHash, randomUUID } from "node:crypto";
import type {
  SessionAiDebriefArtifact,
  SessionAiDebriefConfirmRequest,
  SessionAiDebriefGenerateRequest
} from "@cubica/contracts-ai";
import { validateSessionAiDebriefArtifact } from "@cubica/contracts-ai";
import type { GameManifestAiDebriefProfile } from "@cubica/contracts-manifest";
import type {
  ImmutableGameBundle,
  PortablePublicGameplayJournal,
  SessionPrincipal,
  SessionRecord,
  SessionStorePort
} from "@cubica/contracts-session";
import { HttpError, NotFoundError } from "../errors.ts";
import { canonicalizeJson } from "../content/canonicalJson.ts";
import { loadImmutableGameBundleForReceipt } from "../content/manifestLoader.ts";
import { validateGameManifestAiDebriefProfile } from "../content/manifestValidation.ts";
import {
  buildPublicGameplayJournal,
  MAX_PUBLIC_JOURNAL_ENTRIES
} from "../session/publicGameplayJournal.ts";
import { hashSessionCredential } from "../session/sessionAuthentication.ts";
import {
  SessionAuthenticationError,
  SessionAuthorizationError,
  SessionStoreUnavailableError
} from "../session/sessionStoreErrors.ts";
import {
  MAX_SESSION_AI_DEBRIEF_INPUT_BYTES,
  type SessionAiDebriefProvider,
  SessionAiDebriefProviderError
} from "./sessionAiDebriefProvider.ts";
import {
  SessionAiDebriefAttemptUnavailableError,
  type SessionAiDebriefAttempt,
  type SessionAiDebriefStorePort
} from "./sessionAiDebriefStore.ts";
import {
  assertSessionAiDebriefSectionsSemantics,
  SessionAiDebriefEvidenceError
} from "./sessionAiDebriefEvaluation.ts";

const MAX_ATTEMPTS_PER_SESSION = 8;
const STALE_CALLING_ATTEMPT_AFTER_MS = 5 * 60 * 1_000;

type RuntimeState = Record<string, unknown>;

export class SessionAiDebriefService {
  private readonly sessionStore: SessionStorePort<RuntimeState>;
  private readonly artifactStore: SessionAiDebriefStorePort;
  private readonly provider: SessionAiDebriefProvider;

  constructor(
    sessionStore: SessionStorePort<RuntimeState>,
    artifactStore: SessionAiDebriefStorePort,
    provider: SessionAiDebriefProvider
  ) {
    this.sessionStore = sessionStore;
    this.artifactStore = artifactStore;
    this.provider = provider;
  }

  async generate(
    sessionId: string,
    accessToken: string,
    request: SessionAiDebriefGenerateRequest
  ): Promise<SessionAiDebriefArtifact> {
    const access = await this.requireFacilitatorAccess(sessionId, accessToken);
    await this.artifactStore.failStaleCallingAttempts(
      sessionId,
      new Date(Date.now() - STALE_CALLING_ATTEMPT_AFTER_MS)
    );
    const prior = await this.artifactStore.readByRequest(sessionId, request.requestId);
    if (prior !== null) {
      if (prior.status === "draft" || prior.status === "confirmed") return toArtifact(prior);
      throw new SessionAiDebriefAttemptUnavailableError();
    }
    const profile = requireProfile(access.bundle);
    this.provider.assertReady(profile);
    const source = await this.sessionStore.readPublicJournalSource(
      { sessionId, credentialSha256: access.credentialSha256 },
      MAX_PUBLIC_JOURNAL_ENTRIES + 1
    );
    if (source === null) throw new SessionAuthenticationError();
    const journal = buildPublicGameplayJournal(source);
    const inputDocument = {
      format: "cubica.session-ai-debrief-input",
      schemaVersion: "1.0.0",
      methodology: profile,
      journal
    } as const;
    const serializedInput = canonicalizeJson(inputDocument);
    if (Buffer.byteLength(serializedInput, "utf8") > MAX_SESSION_AI_DEBRIEF_INPUT_BYTES) {
      throw new HttpError(
        413,
        `The complete AI debrief input exceeds the ${MAX_SESSION_AI_DEBRIEF_INPUT_BYTES}-byte limit.`,
        "AI_DEBRIEF_INPUT_TOO_LARGE"
      );
    }
    const journalSha256 = sha256(journal);
    const inputSha256 = sha256Text(serializedInput);
    const claimed = await this.artifactStore.claim({
      artifactId: randomUUID(),
      requestId: request.requestId,
      sessionId,
      principalId: access.principal.principalId,
      gameId: access.snapshot.gameId,
      throughEventSequence: journal.throughEventSequence,
      journalSha256,
      methodologyVersion: profile.methodologyVersion,
      promptVersion: this.provider.promptVersion,
      provider: this.provider.provider,
      model: this.provider.model,
      inputDocument,
      inputCanonical: serializedInput,
      inputSha256,
      maxAttemptsPerSession: MAX_ATTEMPTS_PER_SESSION
    });
    if (!claimed.claimed) {
      if (claimed.attempt.status === "draft" || claimed.attempt.status === "confirmed") {
        return toArtifact(claimed.attempt);
      }
      throw new SessionAiDebriefAttemptUnavailableError();
    }

    try {
      const generated = await this.provider.generate({
        document: inputDocument,
        canonicalInput: serializedInput
      });
      assertSessionAiDebriefSectionsSemantics(generated.sections, journal, profile);
      const outputSha256 = sha256(generated.sections);
      const completed = await this.artifactStore.complete({
        artifactId: claimed.attempt.artifactId,
        sections: generated.sections,
        outputSha256,
        usage: generated.usage
      });
      return toArtifact(completed);
    } catch (error) {
      if (error instanceof SessionAiDebriefProviderError) {
        await this.artifactStore.fail({
          artifactId: claimed.attempt.artifactId,
          errorCode: error.failureCode
        });
      } else if (error instanceof SessionAiDebriefEvidenceError) {
        await this.artifactStore.fail({
          artifactId: claimed.attempt.artifactId,
          errorCode: "provider_false_evidence"
        });
      } else {
        await this.artifactStore.fail({
          artifactId: claimed.attempt.artifactId,
          errorCode: "provider_unknown"
        });
      }
      throw error;
    }
  }

  async readLatest(sessionId: string, accessToken: string): Promise<SessionAiDebriefArtifact> {
    await this.requireFacilitatorAccess(sessionId, accessToken);
    const attempt = await this.artifactStore.readLatestCompleted(sessionId);
    if (attempt === null) throw new NotFoundError("No completed AI debrief exists for this session.");
    return toArtifact(attempt);
  }

  async confirm(
    sessionId: string,
    artifactId: string,
    accessToken: string,
    request: SessionAiDebriefConfirmRequest
  ): Promise<SessionAiDebriefArtifact> {
    await this.requireFacilitatorAccess(sessionId, accessToken);
    const attempt = await this.artifactStore.confirm({
      sessionId,
      artifactId,
      outputSha256: request.outputSha256
    });
    if (attempt === null) {
      throw new HttpError(
        409,
        "The AI debrief draft or output hash no longer matches the confirmation request.",
        "AI_DEBRIEF_CONFIRMATION_CONFLICT"
      );
    }
    return toArtifact(attempt);
  }

  private async requireFacilitatorAccess(sessionId: string, accessToken: string): Promise<{
    credentialSha256: string;
    principal: SessionPrincipal;
    snapshot: SessionRecord<RuntimeState>;
    bundle: ImmutableGameBundle;
  }> {
    const credentialSha256 = hashSessionCredential(accessToken);
    const principal = await this.sessionStore.authenticateSession({ sessionId, credentialSha256 });
    if (principal !== null) {
      if (principal.role !== "facilitator") throw new SessionAuthorizationError();
      const snapshot = await this.sessionStore.getSession(sessionId);
      if (snapshot === null) throw new SessionAuthenticationError();
      const bundle = await this.sessionStore.getImmutableBundle(snapshot.bundleHash);
      if (bundle === null) throw new SessionStoreUnavailableError();
      return { credentialSha256, principal, snapshot, bundle };
    }
    const archived = await this.sessionStore.readArchivedSession({ sessionId, credentialSha256 });
    if (archived === null) throw new SessionAuthenticationError();
    return {
      credentialSha256,
      principal: archived.principal,
      snapshot: archived.session as SessionRecord<RuntimeState>,
      bundle: archived.bundle
    };
  }
}

function requireProfile(bundle: ImmutableGameBundle): GameManifestAiDebriefProfile {
  const manifest = loadImmutableGameBundleForReceipt(bundle).manifest;
  const profile = manifest.content?.aiDebrief;
  if (profile === undefined || !validateGameManifestAiDebriefProfile(profile)) {
    throw new HttpError(409, "This game does not publish an AI debrief methodology.", "AI_DEBRIEF_NOT_SUPPORTED");
  }
  return profile;
}

function toArtifact(attempt: SessionAiDebriefAttempt): SessionAiDebriefArtifact {
  if (
    (attempt.status !== "draft" && attempt.status !== "confirmed") ||
    attempt.sections === undefined ||
    attempt.outputSha256 === undefined ||
    attempt.usage === undefined
  ) {
    throw new SessionStoreUnavailableError();
  }
  const artifact: SessionAiDebriefArtifact = {
    format: "cubica.session-ai-debrief",
    schemaVersion: "1.0.0",
    artifactId: attempt.artifactId,
    requestId: attempt.requestId,
    sessionId: attempt.sessionId,
    gameId: attempt.gameId,
    status: attempt.status,
    createdAt: attempt.createdAt.toISOString(),
    ...(attempt.confirmedAt === undefined ? {} : { confirmedAt: attempt.confirmedAt.toISOString() }),
    provenance: {
      throughEventSequence: attempt.throughEventSequence,
      journalSha256: attempt.journalSha256,
      methodologyVersion: attempt.methodologyVersion,
      promptVersion: attempt.promptVersion,
      provider: attempt.provider,
      model: attempt.model,
      usage: structuredClone(attempt.usage)
    },
    sections: structuredClone(attempt.sections),
    outputSha256: attempt.outputSha256
  };
  if (!validateSessionAiDebriefArtifact(artifact)) throw new SessionStoreUnavailableError();
  return artifact;
}

function sha256(value: unknown): string {
  return sha256Text(canonicalizeJson(value));
}

function sha256Text(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
