import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ArchivedSessionAudit,
  SessionEventRecord,
  SessionPrincipal,
  SessionRecord,
  SessionStorePort
} from "@cubica/contracts-session";

import {
  buildPublicGameplayJournal
} from "../src/modules/session/publicGameplayJournal.ts";
import { SessionService } from "../src/modules/session/session.service.ts";

const session: SessionRecord = {
  sessionId: "session-journal",
  gameId: "neutral-game",
  bundleHash: "a".repeat(64),
  participants: [{ seatId: "p1", playerId: "p1", kind: "human", joinState: "local" }],
  state: {},
  version: { sessionId: "session-journal", stateVersion: 3, lastEventSequence: 3 },
  createdAt: new Date("2026-08-12T08:00:00.000Z"),
  updatedAt: new Date("2026-08-12T08:02:00.000Z")
};

const event = (input: Partial<SessionEventRecord> & Pick<SessionEventRecord, "sequence" | "audience">): SessionEventRecord => ({
  ...input,
  eventId: input.eventId ?? `evt-${input.sequence}`,
  sessionId: input.sessionId ?? session.sessionId,
  receiptId: "receipt-secret",
  commandId: "cli_secret",
  actionId: "action-secret",
  principalId: "principal-secret",
  actorId: "actor-secret",
  eventType: "round.started",
  summary: input.summary ?? "Public event",
  data: input.data ?? { round: input.sequence },
  createdAt: input.createdAt ?? new Date(`2026-08-12T08:0${input.sequence}:00.000Z`),
});

test("public journal strips protected event envelope fields and preserves public sequence gaps", () => {
  const journal = buildPublicGameplayJournal({
    session,
    lifecycle: "active",
    events: [
      event({ sequence: 1, audience: "public" }),
      event({ sequence: 2, audience: "server" }),
      event({ sequence: 3, audience: "public" }),
      event({ sequence: 4, audience: "public" })
    ]
  });

  assert.deepEqual(journal.entries.map((entry) => entry.sequence), [1, 3]);
  assert.equal("actionId" in journal.entries[0], false);
  assert.equal("principalId" in journal.entries[0], false);
  assert.equal("commandId" in journal.entries[0], false);
  assert.equal("receiptId" in journal.entries[0], false);
  assert.equal("actorId" in journal.entries[0], false);
});

test("public journal rejects duplicate event ids and enforces its version boundary", () => {
  assert.throws(
    () => buildPublicGameplayJournal({
      session,
      lifecycle: "active",
      events: [event({ sequence: 1, audience: "public", eventId: "same" }), event({ sequence: 2, audience: "public", eventId: "same" })]
    }),
    /event ids must be unique/
  );

  const bounded = buildPublicGameplayJournal({
    session,
    lifecycle: "active",
    events: [event({ sequence: 99, audience: "public" })]
  });
  assert.deepEqual(bounded.entries, []);

  assert.throws(
    () => buildPublicGameplayJournal({
      session,
      lifecycle: "active",
      events: [event({ sequence: 2, audience: "public" }), event({ sequence: 1, audience: "public" })]
    }),
    /sequences must be strictly increasing/
  );
});

test("public journal rejects oversized documents before returning the materialized projection", () => {
  assert.throws(() => buildPublicGameplayJournal({
    session,
    lifecycle: "active",
    events: [event({ sequence: 1, audience: "public", data: { payload: "x".repeat(33 * 1024 * 1024) } })]
  }), /exceeds the 33554432-byte limit/);
});

test("journal service rejects live auth failures and permits archived facilitator boundary only", async () => {
  const snapshot = structuredClone(session);
  const principal: SessionPrincipal = {
    principalId: "principal-facilitator",
    sessionId: session.sessionId,
    kind: "facilitator",
    role: "facilitator",
    actorScope: { kind: "all-session-actors" },
    createdAt: session.createdAt
  };
  const archive: ArchivedSessionAudit = {
    session: snapshot,
    archivedAt: new Date("2026-08-12T09:00:00.000Z"),
    principal,
    bundle: {
      bundleHash: session.bundleHash,
      gameId: session.gameId,
      canonicalBytes: new Uint8Array([123, 125]),
      canonicalBundle: {},
      createdAt: session.createdAt
    },
    events: [event({ sequence: 1, audience: "public" })],
    receipts: []
  };
  let live = true;
  let authenticated = true;
  let overflow = false;
  let observedLimit = 0;
  const store = {
    mode: "test",
    async readPublicJournalSource(_input: unknown, limit: number) {
      observedLimit = limit;
      if (overflow) {
        const overflowSession = structuredClone(snapshot);
        overflowSession.version.lastEventSequence = limit;
        return {
          session: overflowSession,
          lifecycle: "active" as const,
          events: Array.from({ length: limit }, (_, index) => event({
            sequence: index + 1,
            audience: "public",
            createdAt: session.createdAt
          }))
        };
      }
      return live && authenticated
        ? { session: snapshot, lifecycle: "active", events: [event({ sequence: 1, audience: "public" })] }
        : !live && authenticated
          ? { session: snapshot, lifecycle: "archived", archivedAt: archive.archivedAt, events: archive.events }
          : null;
    }
  } as unknown as SessionStorePort<Record<string, unknown>>;
  const service = new SessionService({ sessionStore: store });

  authenticated = false;
  await assert.rejects(
    service.getPublicGameplayJournal(session.sessionId, "ses_invalid"),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 401
  );

  authenticated = true;
  live = false;
  const journal = await service.getPublicGameplayJournal(session.sessionId, "ses_facilitator");
  assert.equal(observedLimit, 65_537);
  assert.equal(journal.lifecycle, "archived");
  assert.equal(journal.archivedAt, "2026-08-12T09:00:00.000Z");
  assert.deepEqual(snapshot.version, session.version);

  live = true;
  overflow = true;
  await assert.rejects(
    service.getPublicGameplayJournal(session.sessionId, "ses_facilitator"),
    (error: unknown) =>
      (error as { statusCode?: number; code?: string }).statusCode === 413 &&
      (error as { statusCode?: number; code?: string }).code === "PUBLIC_JOURNAL_TOO_LARGE"
  );
  overflow = false;

  authenticated = false;
  await assert.rejects(
    service.getPublicGameplayJournal(session.sessionId, "ses_player"),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 401
  );
});
