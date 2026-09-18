import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { GameManifest, GameManifestAiDebriefProfile } from "@cubica/contracts-manifest";
import type {
  SessionPrincipal,
  SessionPublicJournalSource,
  SessionRecord,
  SessionStorePort
} from "@cubica/contracts-session";
import { createImmutableBundleContent } from "../src/modules/content/immutableBundle.ts";
import { canonicalizeJson } from "../src/modules/content/canonicalJson.ts";
import {
  createEvalApprovalSha256,
  createOpenAiSessionAiDebriefProvider,
  createSessionAiDebriefMethodologySha256,
  createSessionAiDebriefPromptSha256,
  isSessionAiDebriefProviderFailureStage,
  sanitizeSessionAiDebriefProviderFailureStage,
  SESSION_AI_DEBRIEF_PROVIDER_FAILURE_STAGES,
  createZaiSessionAiDebriefTestProvider,
  createZaiSessionAiDebriefTestPromptSha256,
  type OpenAiSessionAiDebriefEnvironment,
  type SessionAiDebriefProvider
} from "../src/modules/ai/sessionAiDebriefProvider.ts";
import { SessionAiDebriefService } from "../src/modules/ai/sessionAiDebriefService.ts";
import {
  InMemorySessionAiDebriefStore,
  PostgresSessionAiDebriefStore,
  SessionAiDebriefAttemptUnavailableError,
  SessionAiDebriefRequestConflictError
} from "../src/modules/ai/sessionAiDebriefStore.ts";
import { SessionAuthorizationError } from "../src/modules/session/sessionStoreErrors.ts";
import { hashSessionCredential } from "../src/modules/session/sessionAuthentication.ts";
import { createRuntimeApiServer } from "../src/modules/player-api/httpServer.ts";
import { buildPublicGameplayJournal } from "../src/modules/session/publicGameplayJournal.ts";
import type {
  SessionDatabaseClient,
  SessionDatabasePool
} from "../src/modules/session/postgresSessionStore.ts";

const profile: GameManifestAiDebriefProfile = {
  format: "cubica.session-ai-debrief-profile",
  schemaVersion: "1.0.0",
  methodologyVersion: "neutral-v1",
  locale: "en-US",
  purpose: "Support a factual facilitator reflection.",
  analysisInstructions: ["Separate observations from possible explanations."],
  facilitatorQuestionGuide: ["Ask what informed the confirmed choice."],
  limits: { maxFacts: 4, maxInterpretations: 4, maxQuestions: 4 }
};

function approvedEnvironment(
  approvedProfile: GameManifestAiDebriefProfile = profile,
  overrides: Partial<OpenAiSessionAiDebriefEnvironment> = {}
): OpenAiSessionAiDebriefEnvironment {
  const model = "gpt-test-2026-09-01";
  const promptVersion = "debrief-v1";
  const methodologySha256 = createSessionAiDebriefMethodologySha256(approvedProfile);
  const promptSha256 = createSessionAiDebriefPromptSha256(approvedProfile);
  const corpusSha256 = `sha256:${"c".repeat(64)}`;
  return {
    CUBICA_AI_DEBRIEF_ENABLED: "true",
    CUBICA_AI_DEBRIEF_MODEL: model,
    CUBICA_AI_DEBRIEF_EVAL_APPROVED_MODEL: model,
    CUBICA_AI_DEBRIEF_EVAL_APPROVED_PROMPT_VERSION: promptVersion,
    CUBICA_AI_DEBRIEF_EVAL_APPROVED_METHODOLOGY_VERSION: approvedProfile.methodologyVersion,
    CUBICA_AI_DEBRIEF_EVAL_APPROVED_PROMPT_SHA256: promptSha256,
    CUBICA_AI_DEBRIEF_EVAL_APPROVED_METHODOLOGY_SHA256: methodologySha256,
    CUBICA_AI_DEBRIEF_EVAL_APPROVED_CORPUS_SHA256: corpusSha256,
    CUBICA_AI_DEBRIEF_EVAL_APPROVAL_SHA256: createEvalApprovalSha256({
      model,
      promptVersion,
      methodologyVersion: approvedProfile.methodologyVersion,
      promptSha256,
      methodologySha256,
      corpusSha256
    }),
    CUBICA_OPENAI_DATA_RETENTION: "zero-data-retention",
    OPENAI_API_KEY: "test-key-that-is-never-logged",
    ...overrides
  };
}

function providerInput(document: {
  format: "cubica.session-ai-debrief-input";
  schemaVersion: "1.0.0";
  methodology: GameManifestAiDebriefProfile;
  journal: unknown;
}) {
  return { document, canonicalInput: canonicalizeJson(document) };
}

test("provider failure stage sanitizer accepts only the closed runtime allowlist", () => {
  for (const stage of SESSION_AI_DEBRIEF_PROVIDER_FAILURE_STAGES) {
    assert.equal(isSessionAiDebriefProviderFailureStage(stage), true);
    assert.equal(sanitizeSessionAiDebriefProviderFailureStage(stage), stage);
  }
  const maliciousStage = "provider-response:" + "secret-provider-value";
  assert.equal(isSessionAiDebriefProviderFailureStage(maliciousStage), false);
  assert.equal(sanitizeSessionAiDebriefProviderFailureStage(maliciousStage), undefined);
  assert.deepEqual(
    JSON.parse(JSON.stringify({ failureStage: sanitizeSessionAiDebriefProviderFailureStage(maliciousStage) })),
    {}
  );
});

async function approvedZaiProviderInput() {
  const [methodologyText, journalText] = await Promise.all([
    readFile(new URL("./fixtures/session-ai-debrief/methodology.json", import.meta.url), "utf8"),
    readFile(new URL("./fixtures/session-ai-debrief/cmt-public-journal.json", import.meta.url), "utf8")
  ]);
  const document = {
    format: "cubica.session-ai-debrief-input",
    schemaVersion: "1.0.0",
    methodology: JSON.parse(methodologyText) as GameManifestAiDebriefProfile,
    journal: JSON.parse(journalText) as unknown
  } as const;
  return providerInput(document);
}

test("service creates, reuses and confirms one exact facilitator-only artifact without mutating the session", async () => {
  const fixture = await createServiceFixture("facilitator");
  const stateBefore = structuredClone(fixture.snapshot);
  const requestId = "550e8400-e29b-41d4-a716-446655440001";

  const first = await fixture.service.generate(fixture.snapshot.sessionId, fixture.accessToken, { requestId });
  const expectedDocument = {
    format: "cubica.session-ai-debrief-input",
    schemaVersion: "1.0.0",
    methodology: profile,
    journal: fixture.expectedJournal
  } as const;
  assert.deepEqual(fixture.lastProviderInput(), providerInput(expectedDocument));
  const storedAttempt = await fixture.artifactStore.readByRequest(fixture.snapshot.sessionId, requestId);
  const expectedCanonical = canonicalizeJson(expectedDocument);
  assert.equal(storedAttempt?.inputCanonical, expectedCanonical);
  assert.equal(
    storedAttempt?.inputSha256,
    `sha256:${createHash("sha256").update(expectedCanonical, "utf8").digest("hex")}`
  );
  const repeated = await fixture.service.generate(fixture.snapshot.sessionId, fixture.accessToken, { requestId });
  assert.equal(fixture.providerCalls(), 1);
  assert.deepEqual(repeated, first);
  const disabledProvider = createOpenAiSessionAiDebriefProvider({});
  const recoveredAfterDisable = await new SessionAiDebriefService(
    fixture.sessionStore,
    fixture.artifactStore,
    disabledProvider
  ).generate(fixture.snapshot.sessionId, fixture.accessToken, { requestId });
  assert.deepEqual(recoveredAfterDisable, first);
  assert.equal(first.status, "draft");
  assert.deepEqual(fixture.snapshot, stateBefore);

  await assert.rejects(
    fixture.service.confirm(fixture.snapshot.sessionId, first.artifactId, fixture.accessToken, {
      outputSha256: `sha256:${"0".repeat(64)}`
    }),
    (error: unknown) => error instanceof Error && "statusCode" in error && error.statusCode === 409
  );
  const confirmed = await fixture.service.confirm(
    fixture.snapshot.sessionId,
    first.artifactId,
    fixture.accessToken,
    { outputSha256: first.outputSha256 }
  );
  assert.equal(confirmed.status, "confirmed");
  assert.equal((await fixture.service.readLatest(fixture.snapshot.sessionId, fixture.accessToken)).status, "confirmed");
});

test("service rejects non-facilitators before provider use", async () => {
  const fixture = await createServiceFixture("player");
  await assert.rejects(
    fixture.service.generate(fixture.snapshot.sessionId, fixture.accessToken, {
      requestId: "550e8400-e29b-41d4-a716-446655440002"
    }),
    SessionAuthorizationError
  );
  assert.equal(fixture.providerCalls(), 0);
});

test("false evidence fails closed and the same request id never causes a second provider call", async () => {
  const fixture = await createServiceFixture("facilitator", "evt-invented");
  const request = { requestId: "550e8400-e29b-41d4-a716-446655440003" };
  await assert.rejects(
    fixture.service.generate(fixture.snapshot.sessionId, fixture.accessToken, request),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PROVIDER_FALSE_EVIDENCE"
  );
  await assert.rejects(
    fixture.service.generate(fixture.snapshot.sessionId, fixture.accessToken, request),
    SessionAiDebriefAttemptUnavailableError
  );
  assert.equal(fixture.providerCalls(), 1);
});

test("unexpected post-claim failure becomes terminal without retrying the provider", async () => {
  const fixture = await createServiceFixture(
    "facilitator",
    "evt-1",
    new Error("simulated process-local failure")
  );
  const request = { requestId: "550e8400-e29b-41d4-a716-446655440004" };
  await assert.rejects(
    fixture.service.generate(fixture.snapshot.sessionId, fixture.accessToken, request),
    /simulated process-local failure/u
  );
  const attempt = await fixture.artifactStore.readByRequest(fixture.snapshot.sessionId, request.requestId);
  assert.equal(attempt?.status, "failed");
  assert.equal(attempt?.errorCode, "provider_unknown");
  await assert.rejects(
    fixture.service.generate(fixture.snapshot.sessionId, fixture.accessToken, request),
    SessionAiDebriefAttemptUnavailableError
  );
  assert.equal(fixture.providerCalls(), 1);
});

test("in-memory store preserves request identity and enforces a session quota", async () => {
  const store = new InMemorySessionAiDebriefStore();
  const base = {
    artifactId: "550e8400-e29b-41d4-a716-446655440010",
    requestId: "550e8400-e29b-41d4-a716-446655440011",
    sessionId: "550e8400-e29b-41d4-a716-446655440012",
    principalId: "550e8400-e29b-41d4-a716-446655440013",
    gameId: "neutral-game",
    throughEventSequence: 1,
    journalSha256: `sha256:${"1".repeat(64)}`,
    methodologyVersion: "neutral-v1",
    promptVersion: "debrief-v1",
    provider: "openai" as const,
    model: "gpt-test-2026-09-01",
    inputDocument: { safe: true },
    inputCanonical: "{\"safe\":true}",
    inputSha256: `sha256:${"2".repeat(64)}`,
    maxAttemptsPerSession: 1
  };
  assert.equal((await store.claim(base)).claimed, true);
  assert.equal((await store.claim({ ...base, artifactId: crypto.randomUUID() })).claimed, false);
  await assert.rejects(
    store.claim({ ...base, artifactId: crypto.randomUUID(), inputSha256: `sha256:${"3".repeat(64)}` }),
    SessionAiDebriefRequestConflictError
  );
  await assert.rejects(
    store.claim({ ...base, artifactId: crypto.randomUUID(), inputCanonical: "{\"safe\":false}" }),
    SessionAiDebriefRequestConflictError
  );
  assert.equal(
    await store.failStaleCallingAttempts(base.sessionId, new Date(Date.now() + 1_000)),
    1
  );
  const failed = await store.readByRequest(base.sessionId, base.requestId);
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.errorCode, "provider_unknown");
  await assert.rejects(
    store.claim({ ...base, artifactId: crypto.randomUUID(), requestId: crypto.randomUUID() }),
    (error: unknown) => error instanceof Error && "statusCode" in error && error.statusCode === 429
  );
});

test("PostgreSQL claim serializes quota and request identity under the session row lock", async () => {
  const queries: string[] = [];
  const row = {
    artifact_id: "550e8400-e29b-41d4-a716-446655440040",
    request_id: "550e8400-e29b-41d4-a716-446655440041",
    session_id: "550e8400-e29b-41d4-a716-446655440042",
    principal_id: "550e8400-e29b-41d4-a716-446655440043",
    game_id: "neutral-game",
    status: "calling_provider",
    through_event_sequence: 1,
    journal_sha256: `sha256:${"1".repeat(64)}`,
    methodology_version: "neutral-v1",
    prompt_version: "debrief-v1",
    provider: "openai",
    model: "gpt-test-2026-09-01",
    input_document: { safe: true },
    input_canonical: "{\"safe\":true}",
    input_sha256: `sha256:${"2".repeat(64)}`,
    output_sections: null,
    output_sha256: null,
    usage: null,
    error_code: null,
    created_at: new Date("2026-09-04T10:00:00.000Z"),
    updated_at: new Date("2026-09-04T10:00:00.000Z"),
    confirmed_at: null
  };
  const result = (rows: unknown[]) => ({ rows, rowCount: rows.length, command: "", oid: 0, fields: [] });
  const client = {
    async query(text: string) {
      queries.push(text);
      if (text.startsWith("SELECT id FROM game_sessions")) return result([{ id: row.session_id }]);
      if (text.includes("FROM session_ai_debriefs WHERE session_id") && text.includes("request_id")) return result([]);
      if (text.startsWith("SELECT COUNT")) return result([{ attempt_count: 0 }]);
      if (text.startsWith("INSERT INTO session_ai_debriefs")) return result([row]);
      return result([]);
    },
    release() {}
  } as unknown as SessionDatabaseClient;
  const pool = {
    connect: async () => client,
    query: async () => result([]),
    end: async () => undefined
  } as unknown as SessionDatabasePool;
  const claimed = await new PostgresSessionAiDebriefStore(pool).claim({
    artifactId: row.artifact_id,
    requestId: row.request_id,
    sessionId: row.session_id,
    principalId: row.principal_id,
    gameId: row.game_id,
    throughEventSequence: 1,
    journalSha256: row.journal_sha256,
    methodologyVersion: row.methodology_version,
    promptVersion: row.prompt_version,
    provider: "openai",
    model: row.model,
    inputDocument: row.input_document,
    inputCanonical: row.input_canonical,
    inputSha256: row.input_sha256,
    maxAttemptsPerSession: 8
  });
  assert.equal(claimed.claimed, true);
  assert.match(queries.join("\n"), /FOR UPDATE/u);
  assert.ok(queries.findIndex((query) => query.startsWith("SELECT COUNT")) <
    queries.findIndex((query) => query.startsWith("INSERT INTO session_ai_debriefs")));
  assert.equal(queries.at(-1), "COMMIT");
});

test("OpenAI adapter is fail-closed and sends one bounded structured Responses request", async () => {
  let disabledFetchCalls = 0;
  const disabled = createOpenAiSessionAiDebriefProvider({}, async () => {
    disabledFetchCalls += 1;
    return new Response("{}", { status: 200 });
  });
  assert.throws(() => disabled.assertReady(profile), /disabled/u);
  const disabledDocument = {
    format: "cubica.session-ai-debrief-input",
    schemaVersion: "1.0.0",
    methodology: profile,
    journal: { entries: [] }
  } as const;
  await assert.rejects(disabled.generate(providerInput(disabledDocument)), /disabled/u);
  assert.equal(disabledFetchCalls, 0);

  let captured: RequestInit | undefined;
  const provider = createOpenAiSessionAiDebriefProvider(approvedEnvironment(), async (_url, init) => {
    captured = init;
    return Response.json({
      status: "completed",
      model: "gpt-test-2026-09-01",
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: JSON.stringify({
            facts: [{ statement: "A choice occurred.", evidenceEventIds: ["evt-1"] }],
            interpretations: [],
            facilitatorQuestions: [{ question: "What informed the choice?" }]
          })
        }]
      }],
      usage: { input_tokens: 10, output_tokens: 8, total_tokens: 18 }
    });
  });
  const document = {
    format: "cubica.session-ai-debrief-input",
    schemaVersion: "1.0.0",
    methodology: profile,
    journal: { entries: [] }
  } as const;
  provider.assertReady(profile);
  const result = await provider.generate(providerInput(document));
  assert.equal(result.usage.totalTokens, 18);
  const body = JSON.parse(String(captured?.body)) as Record<string, unknown>;
  assert.equal(body.store, false);
  assert.equal(body.truncation, "disabled");
  assert.equal(Object.hasOwn(body, "tools"), false);
  assert.equal(body.model, "gpt-test-2026-09-01");
  assert.equal(body.input, canonicalizeJson(document));
  assert.equal((body.text as { format: { strict: boolean } }).format.strict, true);

  await assert.rejects(
    provider.generate({ document, canonicalInput: "{}" }),
    (error: unknown) => error instanceof Error &&
      "code" in error && error.code === "AI_DEBRIEF_INPUT_INTEGRITY"
  );
});

test("OpenAI adapter classifies timeout, 429, 5xx, malformed JSON and schema failures without fallback", async () => {
  const environment = approvedEnvironment(profile, {
    CUBICA_OPENAI_DATA_RETENTION: "modified-abuse-monitoring"
  });
  const document = {
    format: "cubica.session-ai-debrief-input" as const,
    schemaVersion: "1.0.0" as const,
    methodology: profile,
    journal: { entries: [] }
  };
  const input = providerInput(document);
  const cases: Array<[string, typeof fetch, string]> = [
    ["timeout", async () => { throw new DOMException("aborted", "AbortError"); }, "provider_timeout"],
    ["rate limit", async () => new Response("{}", { status: 429 }), "provider_rate_limited"],
    ["unavailable", async () => new Response("{}", { status: 500 }), "provider_unavailable"],
    ["malformed", async () => new Response("not-json", { status: 200 }), "provider_malformed"],
    ["model mismatch", async () => Response.json({
      status: "completed",
      model: "gpt-other-2026-09-01",
      output: [],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 }
    }), "provider_malformed"],
    ["schema", async () => Response.json({
      status: "completed",
      model: "gpt-test-2026-09-01",
      output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
    }), "provider_schema_invalid"]
  ];
  const expectedStages = [
    undefined,
    undefined,
    undefined,
    "response_envelope",
    "model_identity",
    "content_schema"
  ];
  for (const [index, [label, fetchImplementation, code]] of cases.entries()) {
    const provider = createOpenAiSessionAiDebriefProvider(environment, fetchImplementation);
    provider.assertReady(profile);
    await assert.rejects(
      provider.generate(input),
      (error: unknown) => error instanceof Error &&
        "failureCode" in error &&
        "failureStage" in error &&
        error.failureCode === code &&
        error.failureStage === expectedStages[index],
      label
    );
  }
});

test("OpenAI adapter timeout covers a response body that stalls after headers", async () => {
  const environment = approvedEnvironment(profile, { CUBICA_AI_DEBRIEF_TIMEOUT_MS: "1000" });
  const provider = createOpenAiSessionAiDebriefProvider(environment, async (_url, init) => {
    const signal = init?.signal;
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener("abort", () => {
          controller.error(new DOMException("aborted", "AbortError"));
        }, { once: true });
      }
    }), { status: 200 });
  });
  provider.assertReady(profile);
  const document = {
    format: "cubica.session-ai-debrief-input",
    schemaVersion: "1.0.0",
    methodology: profile,
    journal: { entries: [] }
  } as const;
  await assert.rejects(
    provider.generate(providerInput(document)),
    (error: unknown) => error instanceof Error &&
      "failureCode" in error && error.failureCode === "provider_timeout"
  );
});

test("Z.AI synthetic proof adapter uses GLM-5.3-Flash JSON mode and validates the result locally", async () => {
  let disabledFetchCalls = 0;
  const disabled = createZaiSessionAiDebriefTestProvider({}, async () => {
    disabledFetchCalls += 1;
    return new Response("{}", { status: 200 });
  });
  assert.throws(() => disabled.assertReady(profile), /server-side credential/u);

  const input = await approvedZaiProviderInput();
  await assert.rejects(disabled.generate(input), /server-side credential/u);
  assert.equal(disabledFetchCalls, 0);

  let capturedUrl = "";
  let captured: RequestInit | undefined;
  const provider = createZaiSessionAiDebriefTestProvider(
    {
      ZAI_API_KEY: "test-zai-key-that-is-never-logged",
      ZAI_BASE_URL: "https://api.z.ai/api/coding/paas/v4/"
    },
    async (url, init) => {
      capturedUrl = String(url);
      captured = init;
      return Response.json({
        model: "glm-5.3-flash",
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: JSON.stringify({
              facts: [{ statement: "A choice occurred.", evidenceEventIds: ["evt-1"] }],
              interpretations: [],
              facilitatorQuestions: [{ question: "What informed the choice?" }]
            })
          },
          finish_reason: "stop"
        }],
        usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 }
      });
    }
  );
  const result = await provider.generate(input);
  assert.equal(result.usage.totalTokens, 19);
  assert.equal(provider.provider, "zai");
  assert.equal(provider.model, "glm-5.3-flash");
  assert.equal(provider.promptVersion, "debrief-zai-json-mode-v1");
  assert.equal(capturedUrl, "https://api.z.ai/api/coding/paas/v4/chat/completions");
  const body = JSON.parse(String(captured?.body)) as Record<string, unknown>;
  assert.equal(body.model, "glm-5.3-flash");
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.stream, false);
  assert.equal(body.temperature, 0);
  assert.equal(captured?.redirect, "error");
  assert.equal(Object.hasOwn(body, "tools"), false);
  const messages = body.messages as Array<{ role: string; content: string }>;
  assert.equal(messages[1]?.content, input.canonicalInput);
  assert.match(messages[0]?.content ?? "", /JSON Schema/u);
  assert.equal(
    createZaiSessionAiDebriefTestPromptSha256(input.document.methodology),
    `sha256:${createHash("sha256").update(messages[0]!.content, "utf8").digest("hex")}`
  );
});

test("Z.AI synthetic proof adapter rejects every non-approved input before fetch", async () => {
  let fetchCalls = 0;
  const provider = createZaiSessionAiDebriefTestProvider(
    { ZAI_API_KEY: "test-zai-key-that-is-never-logged" },
    async () => {
      fetchCalls += 1;
      return Response.json({});
    }
  );
  await assert.rejects(
    provider.generate(providerInput({
      format: "cubica.session-ai-debrief-input",
      schemaVersion: "1.0.0",
      methodology: profile,
      journal: { entries: [] }
    })),
    (error: unknown) => error instanceof Error &&
      "code" in error && error.code === "AI_DEBRIEF_TEST_INPUT_NOT_APPROVED"
  );
  assert.equal(fetchCalls, 0);
  assert.throws(
    () => createZaiSessionAiDebriefTestProvider({
      ZAI_API_KEY: "test-zai-key-that-is-never-logged",
      ZAI_BASE_URL: "https://example.invalid/api/paas/v4"
    }),
    (error: unknown) => error instanceof Error &&
      "code" in error && error.code === "AI_DEBRIEF_TEST_NOT_CONFIGURED"
  );
});

test("Z.AI synthetic proof adapter rejects non-completed and schema-invalid responses", async () => {
  const input = await approvedZaiProviderInput();
  const responses = [
    {
      model: "glm-5.3-flash",
      choices: [{
        message: { role: "assistant", content: "{}" },
        finish_reason: "stop"
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    },
    {
      model: "glm-5.3-flash",
      choices: [{
        message: { role: "assistant", content: "{}" },
        finish_reason: "length"
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    },
    new Response(JSON.stringify({ error: { code: "1000" } }), { status: 401 })
  ];
  const expectedCodes = ["provider_schema_invalid", "provider_malformed", "provider_rejected"];
  const expectedStages = ["content_schema", "finish_reason", undefined];
  for (const [index, response] of responses.entries()) {
    const provider = createZaiSessionAiDebriefTestProvider(
      { ZAI_API_KEY: "test-zai-key-that-is-never-logged" },
      async () => response instanceof Response ? response : Response.json(response)
    );
    await assert.rejects(
      provider.generate(input),
      (error: unknown) => error instanceof Error &&
        "failureCode" in error &&
        "failureStage" in error &&
        error.failureCode === expectedCodes[index] &&
        error.failureStage === expectedStages[index]
    );
  }
});

test("Z.AI parser diagnostics identify only fixed non-sensitive response gates", async () => {
  const input = await approvedZaiProviderInput();
  const validContent = JSON.stringify({
    facts: [{ statement: "A choice occurred.", evidenceEventIds: ["evt-1"] }],
    interpretations: [],
    facilitatorQuestions: [{ question: "What informed the choice?" }]
  });
  const validUsage = { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 };
  const validChoice = {
    message: { role: "assistant", content: validContent },
    finish_reason: "stop"
  };
  const cases: Array<{
    label: string;
    body: unknown;
    expectedCode: string;
    expectedStage: string;
  }> = [
    {
      label: "response envelope",
      body: [],
      expectedCode: "provider_malformed",
      expectedStage: "response_envelope"
    },
    {
      label: "model identity",
      body: { model: "glm-other", choices: [validChoice], usage: validUsage },
      expectedCode: "provider_malformed",
      expectedStage: "model_identity"
    },
    {
      label: "previous GLM-4.7 model is not an accepted alias",
      body: { model: "glm-4.7", choices: [validChoice], usage: validUsage },
      expectedCode: "provider_malformed",
      expectedStage: "model_identity"
    },
    {
      label: "non-Flash GLM-5.3 model is not accepted",
      body: { model: "glm-5.3", choices: [validChoice], usage: validUsage },
      expectedCode: "provider_malformed",
      expectedStage: "model_identity"
    },
    {
      label: "missing model identity",
      body: { choices: [validChoice], usage: validUsage },
      expectedCode: "provider_malformed",
      expectedStage: "model_identity"
    },
    {
      label: "choice count",
      body: { model: "glm-5.3-flash", choices: [], usage: validUsage },
      expectedCode: "provider_malformed",
      expectedStage: "choice_count"
    },
    {
      label: "message shape",
      body: {
        model: "glm-5.3-flash",
        choices: [{ ...validChoice, message: { role: "user", content: validContent } }],
        usage: validUsage
      },
      expectedCode: "provider_malformed",
      expectedStage: "message_shape"
    },
    {
      label: "content JSON",
      body: {
        model: "glm-5.3-flash",
        choices: [{ ...validChoice, message: { role: "assistant", content: "not-json" } }],
        usage: validUsage
      },
      expectedCode: "provider_malformed",
      expectedStage: "content_json"
    },
    {
      label: "usage shape",
      body: { model: "glm-5.3-flash", choices: [validChoice], usage: {} },
      expectedCode: "provider_malformed",
      expectedStage: "usage_shape"
    },
    {
      label: "usage total",
      body: {
        model: "glm-5.3-flash",
        choices: [validChoice],
        usage: { ...validUsage, total_tokens: 20 }
      },
      expectedCode: "provider_malformed",
      expectedStage: "usage_total"
    },
    {
      label: "provider refusal",
      body: {
        model: "glm-5.3-flash",
        choices: [{ ...validChoice, finish_reason: "sensitive" }],
        usage: validUsage
      },
      expectedCode: "provider_rejected",
      expectedStage: "finish_reason"
    }
  ];

  for (const testCase of cases) {
    const provider = createZaiSessionAiDebriefTestProvider(
      { ZAI_API_KEY: "test-zai-key-that-is-never-logged" },
      async () => Response.json(testCase.body)
    );
    await assert.rejects(
      provider.generate(input),
      (error: unknown) => error instanceof Error &&
        "failureCode" in error &&
        "failureStage" in error &&
        error.failureCode === testCase.expectedCode &&
        error.failureStage === testCase.expectedStage,
      testCase.label
    );
  }
});

test("eval approval rejects any unapproved methodology or prompt bytes before provider use", () => {
  const provider = createOpenAiSessionAiDebriefProvider(approvedEnvironment());
  provider.assertReady(profile);
  const changedProfile = { ...profile, purpose: `${profile.purpose} Changed.` };
  assert.throws(
    () => provider.assertReady(changedProfile),
    /exact published methodology and prompt/u
  );
});

test("migration owns a separate bounded monotonic table", async () => {
  const up = await readFile(new URL("../migrations/006_session_ai_debriefs.up.sql", import.meta.url), "utf8");
  const down = await readFile(new URL("../migrations/006_session_ai_debriefs.down.sql", import.meta.url), "utf8");
  assert.match(up, /CREATE TABLE IF NOT EXISTS session_ai_debriefs/u);
  assert.match(up, /UNIQUE \(session_id, request_id\)/u);
  assert.match(up, /status IN \('calling_provider', 'draft', 'confirmed', 'failed'\)/u);
  assert.match(up, /REFERENCES session_principals\(session_id, principal_id\)/u);
  assert.match(up, /principal_id TEXT NOT NULL/u);
  assert.doesNotMatch(up, /principal_id UUID NOT NULL/u);
  assert.match(up, /input_canonical TEXT NOT NULL/u);
  assert.doesNotMatch(up, /octet_length\(input_document::text\)/u);
  assert.match(up, /octet_length\(input_canonical\) <= 1048576/u);
  assert.match(up, /'provider_false_evidence', 'provider_unknown'/u);
  assert.match(down, /DROP TABLE IF EXISTS session_ai_debriefs/u);
});

test("HTTP routes expose only schema-backed facilitator generation and exact confirmation", async (t) => {
  const fixture = await createServiceFixture("facilitator");
  const api = createRuntimeApiServer({
    port: 0,
    sessionStore: fixture.sessionStore,
    aiDebriefStore: fixture.artifactStore,
    aiDebriefProvider: fixture.provider
  });
  await api.start();
  t.after(() => api.close());
  const base = `http://127.0.0.1:${api.port}/sessions/${fixture.snapshot.sessionId}/ai-debriefs`;
  const generated = await fetch(base, {
    method: "POST",
    headers: { Authorization: `Bearer ${fixture.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: "550e8400-e29b-41d4-a716-446655440030" })
  });
  assert.equal(generated.status, 201);
  const draft = await generated.json() as { artifactId: string; outputSha256: string; status: string };
  assert.equal(draft.status, "draft");

  const confirmed = await fetch(`${base}/${draft.artifactId}/confirm`, {
    method: "POST",
    headers: { Authorization: `Bearer ${fixture.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ outputSha256: draft.outputSha256 })
  });
  assert.equal(confirmed.status, 200);
  assert.equal(((await confirmed.json()) as { status: string }).status, "confirmed");

  const latest = await fetch(`${base}/latest`, {
    headers: { Authorization: `Bearer ${fixture.accessToken}` }
  });
  assert.equal(latest.status, 200);
  assert.equal(((await latest.json()) as { status: string }).status, "confirmed");
});

async function createServiceFixture(
  role: "facilitator" | "player",
  evidenceEventId = "evt-1",
  providerFailure?: Error
) {
  const accessToken = "ses_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const credentialSha256 = hashSessionCredential(accessToken);
  const sessionId = "550e8400-e29b-41d4-a716-446655440020";
  const principal: SessionPrincipal = {
    principalId: "550e8400-e29b-41d4-a716-446655440021",
    sessionId,
    kind: "local-controller",
    role,
    actorScope: { kind: "all-session-actors" },
    createdAt: new Date("2026-09-04T10:00:00.000Z")
  };
  const manifest = JSON.parse(await readFile(
    new URL("../../../games/simple-choice/game.manifest.json", import.meta.url),
    "utf8"
  )) as GameManifest;
  manifest.content = { ...(manifest.content ?? {}), aiDebrief: profile };
  const immutable = createImmutableBundleContent("simple-choice", manifest as unknown as Record<string, unknown>);
  const bundle = { ...immutable, createdAt: new Date("2026-09-04T10:00:00.000Z") };
  const snapshot: SessionRecord<Record<string, unknown>> = {
    sessionId,
    gameId: "simple-choice",
    bundleHash: bundle.bundleHash,
    participants: [{ seatId: "seat-1", playerId: "p1", kind: "human", joinState: "local" }],
    state: {},
    sessionRole: role,
    version: { sessionId, stateVersion: 3, lastEventSequence: 1 },
    createdAt: new Date("2026-09-04T10:00:00.000Z"),
    updatedAt: new Date("2026-09-04T10:05:00.000Z")
  };
  const source: SessionPublicJournalSource<Record<string, unknown>> = {
    session: snapshot,
    lifecycle: "active",
    events: [{
      eventId: "evt-1",
      sessionId,
      sequence: 1,
      receiptId: "550e8400-e29b-41d4-a716-446655440022",
      commandId: "cli_AAAAAAAAAAAAAAAAAAAAAA",
      actionId: "choice.confirm",
      principalId: principal.principalId,
      audience: "public",
      eventType: "choice.confirmed",
      summary: "Choice confirmed",
      data: { choiceId: "a" },
      createdAt: new Date("2026-09-04T10:04:00.000Z")
    }]
  };
  const sessionStore = {
    authenticateSession: async (input: { sessionId: string; credentialSha256: string }) =>
      input.sessionId === sessionId && input.credentialSha256 === credentialSha256 ? principal : null,
    getSession: async (id: string) => id === sessionId ? snapshot : null,
    getImmutableBundle: async (hash: string) => hash === bundle.bundleHash ? bundle : null,
    readArchivedSession: async () => null,
    readPublicJournalSource: async () => source,
    close: async () => undefined
  } as unknown as SessionStorePort<Record<string, unknown>>;
  let calls = 0;
  let lastProviderInput: unknown;
  const provider: SessionAiDebriefProvider = {
    provider: "openai",
    model: "gpt-test-2026-09-01",
    promptVersion: "debrief-v1",
    assertReady() {},
    async generate(input) {
      calls += 1;
      lastProviderInput = structuredClone(input);
      if (providerFailure !== undefined) throw providerFailure;
      return {
        sections: {
          facts: [{ statement: "A choice occurred.", evidenceEventIds: [evidenceEventId] }],
          interpretations: [{ statement: "The choice may reflect a trade-off." }],
          facilitatorQuestions: [{ question: "What informed the choice?" }]
        },
        usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 }
      };
    }
  };
  const artifactStore = new InMemorySessionAiDebriefStore();
  const service = new SessionAiDebriefService(
    sessionStore,
    artifactStore,
    provider
  );
  return {
    service,
    sessionStore,
    artifactStore,
    provider,
    snapshot,
    accessToken,
    expectedJournal: buildPublicGameplayJournal(source),
    lastProviderInput: () => lastProviderInput,
    providerCalls: () => calls
  };
}
