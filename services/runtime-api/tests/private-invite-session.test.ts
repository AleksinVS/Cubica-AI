/** End-to-end trust-boundary checks for one-time private session invitations. */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type {
  PrivateInviteClaimResponse,
  PrivateSessionInvite,
  SessionParticipant,
  SessionVersionNotification
} from "@cubica/contracts-session";
import { createRuntimeApiServer } from "../src/modules/player-api/httpServer.ts";
import { InMemorySessionStore } from "../src/modules/session/inMemorySessionStore.ts";
import { SessionService } from "../src/modules/session/session.service.ts";
import { PrivateInviteAuthenticationError } from "../src/modules/session/sessionStoreErrors.ts";

type CreatedPrivateSession = {
  sessionId: string;
  credential: string;
  privateInvites: PrivateSessionInvite[];
  participants: SessionParticipant[];
  version: SessionVersionNotification & { sessionId: string };
};

const store = new InMemorySessionStore<Record<string, unknown>>();
const api = createRuntimeApiServer({ port: 0, sessionStore: store });
let baseUrl = "";

before(async () => {
  await api.start();
  baseUrl = `http://127.0.0.1:${api.port}`;
});

after(async () => {
  await api.close();
});

test("one private invite has one winner and yields a durable seat credential", async () => {
  const create = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      gameId: "estate-race",
      participantCount: 2,
      accessMode: "private-invite"
    })
  });
  const created = await readJson<CreatedPrivateSession>(create);
  assert.equal(create.status, 201, JSON.stringify(created));
  assert.match(created.credential, /^ses_[A-Za-z0-9_-]{43}$/u);
  assert.deepEqual(created.participants.map(({ playerId, joinState }) => ({ playerId, joinState })), [
    { playerId: "p1", joinState: "joined" },
    { playerId: "p2", joinState: "invited" }
  ]);
  assert.equal(created.privateInvites.length, 1);
  const invite = created.privateInvites[0];
  assert.equal(invite.playerId, "p2");
  assert.match(invite.inviteToken, /^inv_[A-Za-z0-9_-]{43}$/u);
  assert.equal(new Date(invite.expiresAt).getTime() > Date.now(), true);

  const inviteCannotRead = await authenticated(
    `/sessions/${created.sessionId}`,
    invite.inviteToken
  );
  assert.equal(inviteCannotRead.status, 401);

  const hostStream = await openStream(created.sessionId, created.credential);
  assert.deepEqual(hostStream.initial.notification, {
    stateVersion: 0,
    lastEventSequence: 0
  });

  const claims = await Promise.all([
    claim(created.sessionId, invite.inviteToken),
    claim(created.sessionId, invite.inviteToken)
  ]);
  const success = claims.find(({ response }) => response.status === 200);
  const loser = claims.find(({ response }) => response.status !== 200);
  assert.ok(success);
  assert.equal(loser?.response.status, 401);
  assert.equal(loser?.response.headers.get("www-authenticate"), null);
  assert.deepEqual(
    (success.body as PrivateInviteClaimResponse<Record<string, unknown>>).participants
      .map(({ playerId, joinState }) => ({ playerId, joinState })),
    [
      { playerId: "p1", joinState: "joined" },
      { playerId: "p2", joinState: "joined" }
    ]
  );
  assert.equal((success.body as { version: { stateVersion: number } }).version.stateVersion, 1);
  const guestCredential = (success.body as { credential: string }).credential;
  assert.match(guestCredential, /^ses_[A-Za-z0-9_-]{43}$/u);
  const serializedClaim = JSON.stringify(success.body);
  assert.doesNotMatch(serializedClaim, /privateInvites|inv_[A-Za-z0-9_-]{43}/u);

  const hostNotification = await readSseMessage(hostStream.reader);
  assert.deepEqual(hostNotification.notification, {
    stateVersion: 1,
    lastEventSequence: 0
  });
  assert.doesNotMatch(hostNotification.raw, /credential|inviteToken|"state"\s*:/u);
  await hostStream.reader.cancel();

  const guestRead = await authenticated(`/sessions/${created.sessionId}`, guestCredential);
  assert.equal(guestRead.status, 200);
  const guestBody = await guestRead.text();
  assert.doesNotMatch(guestBody, /credential|privateInvites|inviteToken|inv_/u);
  assert.match(guestBody, /"playerId":"p2"/u);

  const replay = await claim(created.sessionId, invite.inviteToken);
  assert.equal(replay.response.status, 401);
  assert.deepEqual(replay.body, loser?.body);
  const authoritative = await store.getSession(created.sessionId);
  assert.equal(authoritative?.version.stateVersion, 1);
  assert.deepEqual(authoritative?.participants.map(({ joinState }) => joinState), ["joined", "joined"]);
});

test("an expired private invite does not mutate its seat", async () => {
  let clock = new Date("2026-08-25T10:00:00.000Z");
  const expiringStore = new InMemorySessionStore<Record<string, unknown>>();
  const service = new SessionService({ sessionStore: expiringStore, now: () => clock });
  const created = await service.createSession({
    gameId: "estate-race",
    participantCount: 2,
    accessMode: "private-invite"
  });
  const invite = created.privateInvites?.[0];
  assert.ok(invite);
  clock = new Date("2026-08-26T10:00:00.001Z");

  await assert.rejects(
    service.claimPrivateInvite(created.sessionId, { inviteToken: invite.inviteToken }),
    PrivateInviteAuthenticationError
  );
  const snapshot = await expiringStore.getSession(created.sessionId);
  assert.equal(snapshot?.version.stateVersion, 0);
  assert.deepEqual(snapshot?.participants.map(({ joinState }) => joinState), ["joined", "invited"]);
});

async function claim(sessionId: string, inviteToken: string): Promise<{
  response: Response;
  body: unknown;
}> {
  const response = await fetch(`${baseUrl}/sessions/${sessionId}/private-invite-claims`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inviteToken })
  });
  return { response, body: await readJson<unknown>(response) };
}

async function authenticated(pathname: string, credential: string): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    headers: { Authorization: `Bearer ${credential}` }
  });
}

async function openStream(sessionId: string, credential: string): Promise<{
  reader: ReadableStreamDefaultReader<Uint8Array>;
  initial: Awaited<ReturnType<typeof readSseMessage>>;
}> {
  const response = await authenticated(`/sessions/${sessionId}/events`, credential);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.ok(response.body);
  const reader = response.body.getReader();
  return { reader, initial: await readSseMessage(reader) };
}

async function readSseMessage(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<{
  raw: string;
  notification: SessionVersionNotification;
}> {
  const decoder = new TextDecoder();
  let raw = "";
  while (!raw.includes("\n\n")) {
    const next = await reader.read();
    assert.equal(next.done, false, "SSE stream closed before a complete message");
    raw += decoder.decode(next.value, { stream: true });
  }
  const data = raw.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
  assert.ok(data);
  return { raw, notification: JSON.parse(data) as SessionVersionNotification };
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  return (body === "" ? {} : JSON.parse(body)) as T;
}
