import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { FacilitatorDebriefDraft } from "@cubica/contracts-session";

import { createImmutableBundleContent } from "../src/modules/content/immutableBundle.ts";
import {
  ZaiFacilitatorDebriefProvider
} from "../src/modules/ai/facilitatorDebriefProvider.ts";
import { InMemorySessionStore } from "../src/modules/session/inMemorySessionStore.ts";
import { createLocalSessionAccess } from "../src/modules/session/sessionAuthentication.ts";

const draft: FacilitatorDebriefDraft = {
  title: "Нейтральный разбор",
  summary: "Сессия завершена.",
  facts: [{ statement: "Зафиксировано событие.", eventSequences: [1] }],
  interpretations: [],
  reflectionQuestions: [{ question: "Что повлияло на решение?", eventSequences: [1] }]
};

test("in-memory debrief store is facilitator-only and retains one ready draft across archive", async () => {
  const fixture = await createFixture();
  const before = structuredClone(await fixture.store.getSession(fixture.sessionId));

  assert.equal(await fixture.store.readFacilitatorDebriefStatus({
    sessionId: fixture.sessionId,
    credentialSha256: "f".repeat(64)
  }), null);

  const first = await fixture.store.beginFacilitatorDebriefAttempt(beginInput(fixture, {
    runId: "debrief_first123",
    requestedAt: new Date("2026-08-27T10:00:00.000Z")
  }));
  assert.equal(first.kind, "created");
  const duplicate = await fixture.store.beginFacilitatorDebriefAttempt(beginInput(fixture, {
    runId: "debrief_second123",
    requestedAt: new Date("2026-08-27T10:00:10.000Z")
  }));
  assert.equal(duplicate.kind, "existing");
  assert.equal(duplicate.kind === "existing" ? duplicate.attempt.runId : "", "debrief_first123");

  const requestAudit = requestAuditFor(fixture, "debrief_first123");
  const completed = await fixture.store.completeFacilitatorDebriefAttempt({
    sessionId: fixture.sessionId,
    runId: "debrief_first123",
    status: "ready",
    completedAt: new Date("2026-08-27T10:00:20.000Z"),
    audit: {
      ...requestAudit,
      providerRequestId: "provider-1",
      providerStatus: 200,
      providerUsage: { total_tokens: 24 },
      responseBytes: 2,
      durationMs: 20_000,
      rawResponseUtf8: "{}"
    },
    draft
  });
  assert.equal(completed?.status, "ready");
  assert.deepEqual(completed?.providerUsage, { total_tokens: 24 });

  const afterReady = await fixture.store.getSession(fixture.sessionId);
  assert.deepEqual(afterReady, before);
  const later = await fixture.store.beginFacilitatorDebriefAttempt(beginInput(fixture, {
    runId: "debrief_third123",
    requestedAt: new Date("2026-08-27T10:02:00.000Z")
  }));
  assert.equal(later.kind, "existing");
  assert.equal(later.kind === "existing" ? later.attempt.runId : "", "debrief_first123");

  await fixture.store.archiveSession({
    sessionId: fixture.sessionId,
    credentialSha256: fixture.credentialSha256
  });
  const archived = await fixture.store.readFacilitatorDebriefStatus({
    sessionId: fixture.sessionId,
    credentialSha256: fixture.credentialSha256
  });
  assert.equal(archived?.attempt?.status, "ready");
  assert.deepEqual(archived?.attempt?.draft, draft);
});

test("an explicit request atomically replaces only a stale generating attempt", async () => {
  const fixture = await createFixture();
  const old = await fixture.store.beginFacilitatorDebriefAttempt(beginInput(fixture, {
    runId: "debrief_stale123",
    requestedAt: new Date("2026-08-27T10:00:00.000Z")
  }));
  assert.equal(old.kind, "created");

  const replacement = await fixture.store.beginFacilitatorDebriefAttempt(beginInput(fixture, {
    runId: "debrief_replacement123",
    requestedAt: new Date("2026-08-27T10:02:00.000Z")
  }));
  assert.equal(replacement.kind, "created");
  assert.equal(replacement.kind === "created" ? replacement.attempt.runId : "", "debrief_replacement123");

  const lateCompletion = await fixture.store.completeFacilitatorDebriefAttempt({
    sessionId: fixture.sessionId,
    runId: "debrief_stale123",
    status: "ready",
    completedAt: new Date("2026-08-27T10:02:01.000Z"),
    audit: {
      ...requestAuditFor(fixture, "debrief_stale123"),
      providerStatus: 200,
      responseBytes: 2,
      durationMs: 121_000,
      rawResponseUtf8: "{}"
    },
    draft
  });
  assert.equal(lateCompletion, null);
  assert.equal((await fixture.store.readFacilitatorDebriefStatus({
    sessionId: fixture.sessionId,
    credentialSha256: fixture.credentialSha256
  }))?.attempt?.runId, "debrief_replacement123");
});

async function createFixture() {
  const store = new InMemorySessionStore<Record<string, unknown>>();
  const access = createLocalSessionAccess("facilitator");
  const immutableBundle = createImmutableBundleContent("neutral-debrief-fixture", {});
  const created = await store.createSession({
    gameId: "neutral-debrief-fixture",
    initialState: { public: { phase: "finished" } },
    participants: [{ seatId: "p1", playerId: "p1", kind: "human", joinState: "local" }],
    immutableBundle,
    sessionRole: "facilitator",
    principal: access.principal
  });
  return {
    store,
    sessionId: created.session.sessionId,
    bundleHash: created.session.bundleHash,
    stateVersion: created.session.version.stateVersion,
    credentialSha256: access.principal.credentialSha256
  };
}

function beginInput(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  input: { runId: string; requestedAt: Date }
) {
  return {
    runId: input.runId,
    sessionId: fixture.sessionId,
    credentialSha256: fixture.credentialSha256,
    expectedStateVersion: fixture.stateVersion,
    throughEventSequence: 0,
    journalSha256: journalSha256(),
    requestAudit: requestAuditFor(fixture, input.runId),
    requestedAt: input.requestedAt,
    staleGeneratingBefore: new Date(input.requestedAt.getTime() - 90_000)
  } as const;
}

function requestAuditFor(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  runId: string
) {
  return new ZaiFacilitatorDebriefProvider({ apiKey: "test" }).prepare({
    runId,
    sessionId: fixture.sessionId,
    gameId: "neutral-debrief-fixture",
    bundleHash: fixture.bundleHash,
    stateVersion: fixture.stateVersion,
    throughEventSequence: 0,
    journalSha256: journalSha256(),
    publicJournalJson: "{}",
    publicState: { phase: "finished" },
    trainingMetadata: null
  }).audit;
}

function journalSha256(): `sha256:${string}` {
  return `sha256:${createHash("sha256").update("{}", "utf8").digest("hex")}`;
}
