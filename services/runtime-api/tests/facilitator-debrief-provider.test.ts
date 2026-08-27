import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  FACILITATOR_DEBRIEF_MAX_TOKENS,
  FACILITATOR_DEBRIEF_SYSTEM_PROMPT,
  FACILITATOR_DEBRIEF_ZAI_ENDPOINT,
  FacilitatorDebriefProviderError,
  ZaiFacilitatorDebriefProvider
} from "../src/modules/ai/facilitatorDebriefProvider.ts";

const journalJson = JSON.stringify({
  format: "cubica.public-gameplay-journal",
  schemaVersion: "1.0.0",
  sessionId: "session-debrief",
  gameId: "neutral-game",
  lifecycle: "active",
  sessionCreatedAt: "2026-08-27T10:00:00.000Z",
  throughEventSequence: 2,
  entries: [
    {
      eventId: "evt-1",
      sequence: 1,
      eventType: "round.started",
      occurredAt: "2026-08-27T10:01:00.000Z",
      summary: "Раунд начался",
      data: { round: 1 }
    },
    {
      eventId: "evt-2",
      sequence: 2,
      eventType: "round.finished",
      occurredAt: "2026-08-27T10:03:00.000Z",
      summary: "Раунд завершён",
      data: { round: 1 }
    }
  ]
});

const input = {
  runId: "debrief_fixture123",
  sessionId: "session-debrief",
  gameId: "neutral-game",
  throughEventSequence: 2,
  journalSha256: sha256(journalJson),
  publicJournalJson: journalJson,
  publicState: { phase: "finished", totals: { p1: 7 } },
  trainingMetadata: { title: "Neutral training fixture" }
} as const;

const draft = {
  title: "Разбор сессии",
  summary: "Участники завершили один раунд.",
  facts: [{ statement: "Раунд был завершён.", eventSequences: [2] }],
  interpretations: [],
  reflectionQuestions: [{ question: "Что повлияло на решение?", eventSequences: [1, 2] }]
};

test("Z.AI debrief call is pinned, bounded, non-streaming and returns complete audit without journal duplication", async () => {
  let calls = 0;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const provider = new ZaiFacilitatorDebriefProvider({
    apiKey: "test-secret",
    now: sequenceClock(1_000, 1_037),
    fetchImpl: async (url, init) => {
      calls += 1;
      capturedUrl = String(url);
      capturedInit = init;
      return response({
        id: "chatcmpl-debrief",
        model: "glm-4.7",
        choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(draft) } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
      });
    }
  });

  const result = await provider.generate(input);

  assert.equal(calls, 1);
  assert.equal(capturedUrl, FACILITATOR_DEBRIEF_ZAI_ENDPOINT);
  assert.equal(capturedInit?.method, "POST");
  assert.equal(capturedInit?.redirect, "error");
  assert.equal(new Headers(capturedInit?.headers).get("authorization"), "Bearer test-secret");

  const requestBody = JSON.parse(decodeBody(capturedInit?.body)) as Record<string, unknown>;
  assert.equal(requestBody.model, "glm-4.7");
  assert.equal(requestBody.max_tokens, FACILITATOR_DEBRIEF_MAX_TOKENS);
  assert.equal(requestBody.stream, false);
  assert.deepEqual(requestBody.thinking, { type: "disabled" });
  assert.deepEqual(requestBody.response_format, { type: "json_object" });
  assert.equal("tools" in requestBody, false);
  assert.deepEqual(result.draftCandidate, draft);
  assert.equal(result.audit.providerRequestId, "chatcmpl-debrief");
  assert.equal(result.audit.durationMs, 37);
  assert.equal(result.audit.systemPrompt, FACILITATOR_DEBRIEF_SYSTEM_PROMPT);
  assert.equal(result.audit.inputSnapshotWithoutJournal.journalSha256, input.journalSha256);
  assert.equal("publicJournalJson" in result.audit.inputSnapshotWithoutJournal, false);
  assert.equal(result.audit.rawResponseUtf8.includes("chatcmpl-debrief"), true);
  assert.match(result.audit.requestBodySha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(result.audit).includes("test-secret"), false);
  assert.equal(JSON.stringify(result.audit).includes(journalJson), false);
});

test("provider rejects mismatched exact journal hash before network I/O", async () => {
  let calls = 0;
  const provider = new ZaiFacilitatorDebriefProvider({
    apiKey: "test-secret",
    fetchImpl: async () => {
      calls += 1;
      return response({});
    }
  });

  await assert.rejects(
    provider.generate({ ...input, journalSha256: `sha256:${"0".repeat(64)}` }),
    /hash does not match/u
  );
  assert.equal(calls, 0);
});

test("provider preparation exposes durable request audit before starting network I/O", async () => {
  let calls = 0;
  const provider = new ZaiFacilitatorDebriefProvider({
    apiKey: "test-secret",
    fetchImpl: async () => {
      calls += 1;
      return response({
        model: "glm-4.7",
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(draft) } }]
      });
    }
  });

  const prepared = provider.prepare(input);
  assert.equal(calls, 0);
  assert.equal(prepared.audit.inputSnapshotWithoutJournal.journalSha256, input.journalSha256);
  assert.match(prepared.audit.requestBodySha256, /^sha256:[a-f0-9]{64}$/u);
  await prepared.execute();
  assert.equal(calls, 1);
});

test("missing server credential fails audibly without starting network I/O", async () => {
  let calls = 0;
  const provider = new ZaiFacilitatorDebriefProvider({
    apiKey: "",
    fetchImpl: async () => {
      calls += 1;
      return response({});
    }
  });

  const prepared = provider.prepare(input);
  await assert.rejects(prepared.execute(), (error: unknown) => {
    assert.equal(isProviderError("provider_unavailable")(error), true);
    assert.match((error as FacilitatorDebriefProviderError).audit?.requestBodySha256 ?? "", /^sha256:/u);
    return true;
  });
  assert.equal(calls, 0);
});

test("provider enforces request and response byte limits before materializing an unbounded result", async () => {
  let calls = 0;
  const requestBounded = new ZaiFacilitatorDebriefProvider({
    apiKey: "test-secret",
    maxRequestBytes: 100,
    fetchImpl: async () => {
      calls += 1;
      return response({});
    }
  });
  await assert.rejects(
    requestBounded.generate(input),
    isProviderError("input_too_large")
  );
  assert.equal(calls, 0);

  const responseBounded = new ZaiFacilitatorDebriefProvider({
    apiKey: "test-secret",
    maxResponseBytes: 32,
    fetchImpl: async () => new Response("x".repeat(33), {
      status: 200,
      headers: { "content-length": "33" }
    })
  });
  await assert.rejects(
    responseBounded.generate(input),
    isProviderError("provider_invalid_response")
  );
});

test("provider never retries rejected or outcome-unknown calls", async () => {
  for (const [status, expected] of [[429, "provider_rejected"], [503, "provider_outcome_unknown"]] as const) {
    let calls = 0;
    const provider = new ZaiFacilitatorDebriefProvider({
      apiKey: "test-secret",
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({ error: { code: "provider-error" } }), { status });
      }
    });
    await assert.rejects(provider.generate(input), (error: unknown) => {
      assert.equal(error instanceof FacilitatorDebriefProviderError, true);
      assert.equal((error as FacilitatorDebriefProviderError).code, expected);
      assert.equal((error as FacilitatorDebriefProviderError).providerStatus, status);
      assert.match((error as FacilitatorDebriefProviderError).rawResponseUtf8 ?? "", /provider-error/u);
      assert.equal((error as FacilitatorDebriefProviderError).audit?.requestBodySha256.startsWith("sha256:"), true);
      assert.match((error as FacilitatorDebriefProviderError).audit?.rawResponseUtf8 ?? "", /provider-error/u);
      assert.equal(JSON.stringify((error as FacilitatorDebriefProviderError).audit).includes(journalJson), false);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("provider rejects tool calls, model drift, truncation and malformed candidate JSON", async () => {
  const envelopes = [
    { model: "other-model", choices: [] },
    { model: "glm-4.7", choices: [{ finish_reason: "length", message: { content: JSON.stringify(draft) } }] },
    { model: "glm-4.7", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(draft), tool_calls: [] } }] },
    { model: "glm-4.7", choices: [{ finish_reason: "stop", message: { content: "not-json" } }] }
  ];
  for (const envelope of envelopes) {
    const provider = new ZaiFacilitatorDebriefProvider({
      apiKey: "test-secret",
      fetchImpl: async () => response(envelope)
    });
    await assert.rejects(provider.generate(input), (error: unknown) => {
      assert.equal(isProviderError("provider_invalid_response")(error), true);
      assert.equal((error as FacilitatorDebriefProviderError).audit?.rawResponseUtf8?.length !== 0, true);
      return true;
    });
  }
});

test("provider classifies abort as timeout and performs one call", async () => {
  let calls = 0;
  const provider = new ZaiFacilitatorDebriefProvider({
    apiKey: "test-secret",
    timeoutMs: 5,
    fetchImpl: async (_url, init) => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        const activeTransport = setInterval(() => undefined, 100);
        init?.signal?.addEventListener("abort", () => {
          clearInterval(activeTransport);
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
    }
  });
  await assert.rejects(provider.generate(input), isProviderError("provider_timeout"));
  assert.equal(calls, 1);
});

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function sequenceClock(...values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
}

function decodeBody(body: BodyInit | null | undefined): string {
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
  if (typeof body === "string") return body;
  throw new TypeError("Expected a byte or string request body.");
}

function isProviderError(code: string): (error: unknown) => boolean {
  return (error: unknown) =>
    error instanceof FacilitatorDebriefProviderError && error.code === code;
}
