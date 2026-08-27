import { createHash, randomBytes } from "node:crypto";
import type {
  FacilitatorDebriefDraft,
  FacilitatorDebriefError,
  FacilitatorDebriefGenerationRequest,
  FacilitatorDebriefResponse,
  PortablePublicGameplayJournal
} from "@cubica/contracts-session";
import { validateFacilitatorDebriefResponseShape } from "@cubica/contracts-session";
import { loadImmutableGameBundle } from "../content/manifestLoader.ts";
import { buildPlayerSessionProjection } from "../session/playerSessionProjection.ts";
import {
  buildPublicGameplayJournal,
  MAX_PUBLIC_JOURNAL_ENTRIES,
  serializePublicGameplayJournal
} from "../session/publicGameplayJournal.ts";
import { hashSessionCredential } from "../session/sessionAuthentication.ts";
import {
  SessionAuthenticationError,
  SessionStoreUnavailableError,
  SessionVersionConflictError
} from "../session/sessionStoreErrors.ts";
import {
  FACILITATOR_DEBRIEF_PROMPT_VERSION,
  FACILITATOR_DEBRIEF_ZAI_MODEL,
  FacilitatorDebriefProviderError,
  type FacilitatorDebriefFailedProviderAudit,
  type FacilitatorDebriefProvider,
  type FacilitatorDebriefProviderRequestAudit
} from "./facilitatorDebriefProvider.ts";
import type {
  FacilitatorDebriefGenerationSource,
  FacilitatorDebriefStorePort,
  StoredFacilitatorDebriefAttempt
} from "./facilitatorDebriefStore.ts";

type RuntimeState = Record<string, unknown>;

export interface FacilitatorDebriefServiceOptions {
  readonly store: FacilitatorDebriefStorePort<RuntimeState>;
  readonly provider: FacilitatorDebriefProvider;
  readonly now?: () => Date;
  readonly createRunId?: () => string;
}

/** Read-only facilitator application service; it never dispatches a Game Intent. */
export class FacilitatorDebriefService {
  private readonly store: FacilitatorDebriefStorePort<RuntimeState>;
  private readonly provider: FacilitatorDebriefProvider;
  private readonly now: () => Date;
  private readonly createRunId: () => string;

  constructor(options: FacilitatorDebriefServiceOptions) {
    this.store = options.store;
    this.provider = options.provider;
    this.now = options.now ?? (() => new Date());
    this.createRunId = options.createRunId ?? (() => `debrief_${randomBytes(18).toString("base64url")}`);
  }

  async get(sessionId: string, accessToken: string): Promise<FacilitatorDebriefResponse> {
    const source = await this.store.readFacilitatorDebriefStatus({
      sessionId,
      credentialSha256: hashSessionCredential(accessToken)
    });
    if (source === null) throw new SessionAuthenticationError();
    return responseFromAttempt(source.session.sessionId, source.session.gameId, source.attempt);
  }

  async generate(
    sessionId: string,
    accessToken: string,
    request: FacilitatorDebriefGenerationRequest
  ): Promise<FacilitatorDebriefResponse> {
    const source = await this.store.readFacilitatorDebriefGenerationSource({
      sessionId,
      credentialSha256: hashSessionCredential(accessToken)
    }, MAX_PUBLIC_JOURNAL_ENTRIES + 1);
    if (source === null) throw new SessionAuthenticationError();
    if (source.attempt?.status === "ready" || source.attempt?.status === "generating") {
      return responseFromAttempt(source.session.sessionId, source.session.gameId, source.attempt);
    }
    if (source.session.version.stateVersion !== request.expectedStateVersion) {
      throw new SessionVersionConflictError(sessionId, request.expectedStateVersion);
    }

    const journal = buildPublicGameplayJournal({
      session: source.session,
      events: source.events,
      lifecycle: source.lifecycle,
      ...(source.archivedAt === undefined ? {} : { archivedAt: source.archivedAt })
    });
    const publicJournalJson = serializePublicGameplayJournal(journal);
    const journalSha256 = sha256(publicJournalJson);
    const bundle = loadImmutableGameBundle(source.bundle);
    const publicState = buildPlayerSessionProjection({
      state: source.session.state,
      stateModel: bundle.manifest.mechanics.stateModel
    }).publicAudienceState;
    const runId = this.createRunId();
    const providerInput = {
      runId,
      sessionId: source.session.sessionId,
      gameId: source.session.gameId,
      throughEventSequence: journal.throughEventSequence,
      journalSha256,
      publicJournalJson,
      publicState,
      trainingMetadata: bundle.manifest.meta.training ?? null
    } as const;

    let prepared: ReturnType<FacilitatorDebriefProvider["prepare"]>;
    try {
      prepared = this.provider.prepare(providerInput);
    } catch (error) {
      if (!(error instanceof FacilitatorDebriefProviderError) || error.audit === undefined) throw error;
      const begun = await this.begin(source, request.expectedStateVersion, runId, journal, error.audit);
      if (begun.kind !== "created") {
        return responseFromAttempt(source.session.sessionId, source.session.gameId, begun.attempt);
      }
      return this.completeFailure(source, begun.attempt, error, error.audit);
    }

    const begun = await this.begin(
      source,
      request.expectedStateVersion,
      runId,
      journal,
      prepared.audit
    );
    if (begun.kind !== "created") {
      return responseFromAttempt(source.session.sessionId, source.session.gameId, begun.attempt);
    }

    let providerResult: Awaited<ReturnType<typeof prepared.execute>>;
    try {
      providerResult = await prepared.execute();
    } catch (error) {
      if (!(error instanceof FacilitatorDebriefProviderError) || error.audit === undefined) throw error;
      return this.completeFailure(source, begun.attempt, error, error.audit);
    }

    const candidateResponse = buildResponseFromAttempt(
      source.session.sessionId,
      source.session.gameId,
      {
        ...begun.attempt,
        status: "ready",
        completedAt: this.readNow(),
        draft: providerResult.draftCandidate as FacilitatorDebriefDraft
      }
    );
    if (!validateFacilitatorDebriefResponseShape(candidateResponse) ||
        !referencesOnlyJournalEvents(candidateResponse.draft!, journal)) {
      return this.completeFailure(
        source,
        begun.attempt,
        new FacilitatorDebriefProviderError("provider_invalid_response", { audit: providerResult.audit }),
        providerResult.audit
      );
    }

    const completed = await this.store.completeFacilitatorDebriefAttempt({
      sessionId: source.session.sessionId,
      runId: begun.attempt.runId,
      status: "ready",
      completedAt: this.readNow(),
      audit: providerResult.audit,
      draft: candidateResponse.draft!
    });
    if (completed === null) throw new SessionStoreUnavailableError();
    return responseFromAttempt(source.session.sessionId, source.session.gameId, completed);
  }

  private async begin(
    source: FacilitatorDebriefGenerationSource<RuntimeState>,
    expectedStateVersion: number,
    runId: string,
    journal: PortablePublicGameplayJournal,
    requestAudit: FacilitatorDebriefProviderRequestAudit
  ) {
    const begun = await this.store.beginFacilitatorDebriefAttempt({
      runId,
      sessionId: source.session.sessionId,
      expectedStateVersion,
      throughEventSequence: journal.throughEventSequence,
      journalSha256: sha256(serializePublicGameplayJournal(journal)),
      requestAudit,
      requestedAt: this.readNow()
    });
    if (begun.kind === "version-conflict") {
      throw new SessionVersionConflictError(source.session.sessionId, expectedStateVersion);
    }
    return begun;
  }

  private async completeFailure(
    source: FacilitatorDebriefGenerationSource<RuntimeState>,
    attempt: StoredFacilitatorDebriefAttempt,
    providerError: FacilitatorDebriefProviderError,
    audit: FacilitatorDebriefFailedProviderAudit
  ): Promise<FacilitatorDebriefResponse> {
    const completed = await this.store.completeFacilitatorDebriefAttempt({
      sessionId: source.session.sessionId,
      runId: attempt.runId,
      status: "failed",
      completedAt: this.readNow(),
      audit,
      ...(providerError.providerStatus === undefined ? {} : { providerStatus: providerError.providerStatus }),
      error: publicProviderError(providerError.code)
    });
    if (completed === null) throw new SessionStoreUnavailableError();
    return responseFromAttempt(source.session.sessionId, source.session.gameId, completed);
  }

  private readNow(): Date {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new SessionStoreUnavailableError();
    }
    return value;
  }
}

function responseFromAttempt(
  sessionId: string,
  gameId: string,
  attempt: StoredFacilitatorDebriefAttempt | null
): FacilitatorDebriefResponse {
  const response = buildResponseFromAttempt(sessionId, gameId, attempt);
  if (!validateFacilitatorDebriefResponseShape(response)) throw new SessionStoreUnavailableError();
  return response;
}

function buildResponseFromAttempt(
  sessionId: string,
  gameId: string,
  attempt: StoredFacilitatorDebriefAttempt | null
): FacilitatorDebriefResponse {
  return attempt === null
    ? {
        format: "cubica.facilitator-debrief",
        schemaVersion: "1.0.0",
        sessionId,
        gameId,
        status: "absent",
        canGenerate: true
      }
    : {
        format: "cubica.facilitator-debrief",
        schemaVersion: "1.0.0",
        sessionId,
        gameId,
        status: attempt.status,
        canGenerate: attempt.status === "failed",
        runId: attempt.runId,
        requestedAt: attempt.requestedAt.toISOString(),
        ...(attempt.completedAt === undefined ? {} : { completedAt: attempt.completedAt.toISOString() }),
        journalSha256: attempt.journalSha256,
        throughEventSequence: attempt.throughEventSequence,
        provider: "z.ai",
        model: FACILITATOR_DEBRIEF_ZAI_MODEL,
        promptVersion: FACILITATOR_DEBRIEF_PROMPT_VERSION,
        ...(attempt.draft === undefined ? {} : { draft: attempt.draft }),
        ...(attempt.error === undefined ? {} : { error: attempt.error })
      };
}

function referencesOnlyJournalEvents(
  draft: FacilitatorDebriefDraft,
  journal: PortablePublicGameplayJournal
): boolean {
  const sequences = new Set(journal.entries.map((entry) => entry.sequence));
  const referenced = [
    ...draft.facts.flatMap((item) => item.eventSequences),
    ...draft.interpretations.flatMap((item) => item.eventSequences),
    ...draft.reflectionQuestions.flatMap((item) => item.eventSequences)
  ];
  return referenced.every((sequence) => sequences.has(sequence));
}

function publicProviderError(code: FacilitatorDebriefProviderError["code"]): FacilitatorDebriefError {
  const messages: Record<FacilitatorDebriefProviderError["code"], string> = {
    provider_unavailable: "Сервис ИИ-разбора пока не настроен.",
    provider_timeout: "Сервис ИИ-разбора не ответил вовремя.",
    provider_rejected: "Сервис ИИ-разбора отклонил запрос.",
    provider_outcome_unknown: "Не удалось подтвердить результат вызова сервиса ИИ-разбора.",
    provider_invalid_response: "Сервис ИИ-разбора вернул неподдерживаемый результат.",
    input_too_large: "Данные этой сессии пока слишком велики для ИИ-разбора. Обычные итоги доступны.",
  };
  return { code, message: messages[code] };
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
