import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type {
  FacilitatorDebriefDraft,
  ImmutableGameBundle,
  SessionEventRecord,
  SessionRecord
} from "@cubica/contracts-session";

import { ZaiFacilitatorDebriefProvider } from "../src/modules/ai/facilitatorDebriefProvider.ts";
import { FacilitatorDebriefService } from "../src/modules/ai/facilitatorDebriefService.ts";
import type {
  BeginFacilitatorDebriefAttemptInput,
  BeginFacilitatorDebriefAttemptResult,
  CompleteFacilitatorDebriefAttemptInput,
  FacilitatorDebriefGenerationSource,
  FacilitatorDebriefStatusSource,
  FacilitatorDebriefStorePort,
  StoredFacilitatorDebriefAttempt
} from "../src/modules/ai/facilitatorDebriefStore.ts";
import { createImmutableBundleContent } from "../src/modules/content/immutableBundle.ts";

const manifest = JSON.parse(readFileSync(new URL("../../../games/simple-choice/game.manifest.json", import.meta.url), "utf8")) as Record<string, unknown>;
const bundleInput = createImmutableBundleContent("simple-choice", manifest);
const bundle: ImmutableGameBundle = { ...bundleInput, createdAt: new Date("2026-08-27T09:00:00.000Z") };
const session: SessionRecord<Record<string, unknown>> = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  gameId: "simple-choice",
  bundleHash: bundle.bundleHash,
  participants: [{ seatId: "seat-1", playerId: "p1", kind: "human", joinState: "local" }],
  state: structuredClone(manifest.state) as Record<string, unknown>,
  version: {
    sessionId: "11111111-1111-4111-8111-111111111111",
    stateVersion: 3,
    lastEventSequence: 1
  },
  createdAt: new Date("2026-08-27T09:00:00.000Z"),
  updatedAt: new Date("2026-08-27T09:05:00.000Z")
};
const event: SessionEventRecord = {
  eventId: "evt-neutral-finished",
  sessionId: session.sessionId,
  sequence: 1,
  receiptId: "22222222-2222-4222-8222-222222222222",
  commandId: `cli_${"a".repeat(22)}`,
  actionId: "choice.accept",
  principalId: "33333333-3333-4333-8333-333333333333",
  actorId: "p1",
  audience: "public",
  eventType: "choice.accepted",
  summary: "Choice accepted",
  data: { choiceId: "accept" },
  createdAt: new Date("2026-08-27T09:04:00.000Z")
};
const validDraft: FacilitatorDebriefDraft = {
  title: "Разбор выбора",
  summary: "Участник сделал явный выбор.",
  facts: [{ statement: "Был принят вариант accept.", eventSequences: [1] }],
  interpretations: [{ statement: "Выбор мог опираться на видимый компромисс.", confidence: "low", eventSequences: [1] }],
  reflectionQuestions: [{ question: "Что было главным аргументом?", eventSequences: [1] }]
};

test("debrief service returns absent state through the authenticated store boundary", async () => {
  const store = new FakeDebriefStore();
  const service = serviceWith(store, validDraft);

  assert.deepEqual(await service.get(session.sessionId, "ses_test"), {
    format: "cubica.facilitator-debrief",
    schemaVersion: "1.0.0",
    sessionId: session.sessionId,
    gameId: session.gameId,
    status: "absent",
    canGenerate: true
  });

  store.authorized = false;
  await assert.rejects(service.get(session.sessionId, "ses_test"), (error: unknown) =>
    (error as { statusCode?: number }).statusCode === 401
  );
});

test("one explicit request stores one ready draft and later requests do not call the provider again", async () => {
  const store = new FakeDebriefStore();
  let calls = 0;
  let observedSequences: unknown;
  const service = serviceWith(store, validDraft, (providerInput) => {
    calls += 1;
    observedSequences = (providerInput.publicJournal as { entries?: Array<{ sequence?: unknown }> }).entries?.map((entry) => entry.sequence);
  });

  const first = await service.generate(session.sessionId, "ses_test", { expectedStateVersion: 3 });
  assert.equal(first.status, "ready", `${JSON.stringify(first)} journal=${JSON.stringify(observedSequences)}`);
  assert.deepEqual(first.draft, validDraft);
  assert.equal(first.journalSha256?.startsWith("sha256:"), true);
  assert.equal(calls, 1);
  assert.equal(store.attempt?.requestAudit.inputSnapshotWithoutJournal.trainingMetadata !== null, true);
  assert.equal("publicJournal" in store.attempt!.requestAudit.inputSnapshotWithoutJournal, false);

  const second = await service.generate(session.sessionId, "ses_test", { expectedStateVersion: 3 });
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
});

test("invalid evidence references become an auditable failed attempt and allow manual retry", async () => {
  const store = new FakeDebriefStore();
  const invalidDraft = structuredClone(validDraft);
  invalidDraft.facts[0]!.eventSequences = [99];
  const service = serviceWith(store, invalidDraft);

  const failed = await service.generate(session.sessionId, "ses_test", { expectedStateVersion: 3 });
  assert.equal(failed.status, "failed");
  assert.equal(failed.canGenerate, true);
  assert.equal(failed.error?.code, "provider_invalid_response");
  assert.equal(store.attempt?.rawResponseUtf8?.includes("Разбор выбора"), true);
  assert.equal(JSON.stringify(store.attempt?.requestAudit).includes("evt-neutral-finished"), false);
});

test("state-version conflict and missing provider credentials fail closed without provider I/O", async () => {
  const versionStore = new FakeDebriefStore();
  let calls = 0;
  const versionService = serviceWith(versionStore, validDraft, () => { calls += 1; });
  await assert.rejects(
    versionService.generate(session.sessionId, "ses_test", { expectedStateVersion: 2 }),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 409
  );
  assert.equal(calls, 0);
  assert.equal(versionStore.attempt, null);

  const unavailableStore = new FakeDebriefStore();
  const unavailable = new FacilitatorDebriefService({
    store: unavailableStore,
    provider: new ZaiFacilitatorDebriefProvider({ apiKey: "", fetchImpl: async () => {
      calls += 1;
      return providerResponse(validDraft);
    } }),
    now: sequenceDates(),
    createRunId: () => "debrief_fixture123"
  });
  const failed = await unavailable.generate(session.sessionId, "ses_test", { expectedStateVersion: 3 });
  assert.equal(failed.status, "failed");
  assert.equal(failed.error?.code, "provider_unavailable");
  assert.equal(calls, 0);
});

test("credential revocation between source read and durable begin prevents provider I/O", async () => {
  const store = new FakeDebriefStore();
  store.beginAuthorized = false;
  let calls = 0;
  const service = serviceWith(store, validDraft, () => { calls += 1; });

  await assert.rejects(
    service.generate(session.sessionId, "ses_revoked", { expectedStateVersion: 3 }),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 401
  );
  assert.equal(calls, 0);
  assert.equal(store.attempt, null);
});

class FakeDebriefStore implements FacilitatorDebriefStorePort<Record<string, unknown>> {
  authorized = true;
  beginAuthorized = true;
  attempt: StoredFacilitatorDebriefAttempt | null = null;

  async readFacilitatorDebriefStatus(): Promise<FacilitatorDebriefStatusSource | null> {
    return this.authorized ? { session: structuredClone(session), attempt: cloneAttempt(this.attempt) } : null;
  }

  async readFacilitatorDebriefGenerationSource(): Promise<FacilitatorDebriefGenerationSource | null> {
    return this.authorized ? {
      session: structuredClone(session),
      attempt: cloneAttempt(this.attempt),
      bundle: structuredClone(bundle),
      lifecycle: "active",
      events: [structuredClone(event)]
    } : null;
  }

  async beginFacilitatorDebriefAttempt(
    input: BeginFacilitatorDebriefAttemptInput
  ): Promise<BeginFacilitatorDebriefAttemptResult> {
    if (!this.beginAuthorized) return { kind: "authentication-failed" };
    if (input.expectedStateVersion !== session.version.stateVersion) return { kind: "version-conflict" };
    if (this.attempt?.status === "ready" || this.attempt?.status === "generating") {
      return { kind: "existing", attempt: cloneAttempt(this.attempt)! };
    }
    this.attempt = {
      runId: input.runId,
      sessionId: input.sessionId,
      status: "generating",
      expectedStateVersion: input.expectedStateVersion,
      throughEventSequence: input.throughEventSequence,
      journalSha256: input.journalSha256,
      requestAudit: structuredClone(input.requestAudit),
      requestedAt: new Date(input.requestedAt)
    };
    return { kind: "created", attempt: cloneAttempt(this.attempt)! };
  }

  async completeFacilitatorDebriefAttempt(
    input: CompleteFacilitatorDebriefAttemptInput
  ): Promise<StoredFacilitatorDebriefAttempt | null> {
    if (this.attempt?.runId !== input.runId || this.attempt.status !== "generating") return null;
    this.attempt = {
      ...this.attempt,
      status: input.status,
      completedAt: new Date(input.completedAt),
      ...(input.audit.providerRequestId === undefined ? {} : { providerRequestId: input.audit.providerRequestId }),
      ...(input.audit.providerStatus === undefined ? {} : { providerStatus: input.audit.providerStatus }),
      ...(input.audit.providerUsage === undefined ? {} : { providerUsage: structuredClone(input.audit.providerUsage) }),
      ...(input.audit.responseBytes === undefined ? {} : { responseBytes: input.audit.responseBytes }),
      durationMs: input.audit.durationMs,
      ...(input.audit.rawResponseUtf8 === undefined ? {} : { rawResponseUtf8: input.audit.rawResponseUtf8 }),
      ...(input.status === "ready" ? { draft: structuredClone(input.draft) } : {
        error: structuredClone(input.error),
        ...(input.providerStatus === undefined ? {} : { providerStatus: input.providerStatus })
      })
    };
    return cloneAttempt(this.attempt);
  }
}

function serviceWith(
  store: FakeDebriefStore,
  draft: FacilitatorDebriefDraft,
  onCall: (providerInput: Record<string, unknown>) => void = () => undefined
): FacilitatorDebriefService {
  return new FacilitatorDebriefService({
    store,
    provider: new ZaiFacilitatorDebriefProvider({
      apiKey: "test-secret",
      fetchImpl: async (_url, init) => {
        const requestBody = JSON.parse(decodeBody(init?.body)) as { messages: Array<{ content: string }> };
        onCall(JSON.parse(requestBody.messages[1]!.content) as Record<string, unknown>);
        return providerResponse(draft);
      }
    }),
    now: sequenceDates(),
    createRunId: () => "debrief_fixture123"
  });
}

function providerResponse(draft: FacilitatorDebriefDraft): Response {
  return new Response(JSON.stringify({
    id: "chatcmpl-debrief",
    model: "glm-4.7",
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(draft) } }]
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function sequenceDates(): () => Date {
  let offset = 0;
  return () => new Date(Date.UTC(2026, 7, 27, 10, 0, offset++));
}

function cloneAttempt(
  attempt: StoredFacilitatorDebriefAttempt | null
): StoredFacilitatorDebriefAttempt | null {
  return attempt === null ? null : structuredClone(attempt);
}

function decodeBody(body: BodyInit | null | undefined): string {
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
  if (typeof body === "string") return body;
  throw new TypeError("Expected provider request bytes.");
}
