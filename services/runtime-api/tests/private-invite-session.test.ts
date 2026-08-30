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
import { hashSessionCredential } from "../src/modules/session/sessionAuthentication.ts";
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

  const initialClaimWithHostCredential = await claim(
    created.sessionId,
    invite.inviteToken,
    created.credential
  );
  assert.equal(initialClaimWithHostCredential.response.status, 401);
  const malformedCurrentCredential = await claim(
    created.sessionId,
    invite.inviteToken,
    "not-a-session-credential"
  );
  assert.equal(malformedCurrentCredential.response.status, 401);
  assert.equal(malformedCurrentCredential.response.headers.get("www-authenticate"), null);
  assert.deepEqual(malformedCurrentCredential.body, initialClaimWithHostCredential.body);

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

test("an expired recovery invite leaves the current guest credential valid", async () => {
  let clock = new Date("2026-08-25T10:00:00.000Z");
  const expiringStore = new InMemorySessionStore<Record<string, unknown>>();
  const service = new SessionService({ sessionStore: expiringStore, now: () => clock });
  const created = await service.createSession({
    gameId: "estate-race",
    participantCount: 2,
    accessMode: "private-invite"
  });
  const initialInvite = created.privateInvites?.[0];
  assert.ok(initialInvite);
  const joined = await service.claimPrivateInvite(created.sessionId, {
    inviteToken: initialInvite.inviteToken
  });
  const before = await expiringStore.getSession(created.sessionId);
  assert.ok(before);
  const recovery = await service.issuePrivateSeatRecoveryInvite(
    created.sessionId,
    created.credential,
    { seatId: "p2" }
  );
  clock = new Date("2026-08-26T10:00:00.001Z");

  await assert.rejects(
    service.claimPrivateInvite(created.sessionId, { inviteToken: recovery.inviteToken }),
    PrivateInviteAuthenticationError
  );
  assert.ok(await expiringStore.authenticateSession({
    sessionId: created.sessionId,
    credentialSha256: hashSessionCredential(joined.credential)
  }));
  assert.deepEqual(await expiringStore.getSession(created.sessionId), before);
});

test("post-commit stream cleanup failure cannot hide a successful credential recovery", async () => {
  const isolatedStore = new InMemorySessionStore<Record<string, unknown>>();
  const service = new SessionService({
    sessionStore: isolatedStore,
    onParticipantCredentialRotated: () => {
      throw new Error("simulated stream cleanup failure");
    }
  });
  const created = await service.createSession({
    gameId: "estate-race",
    participantCount: 2,
    accessMode: "private-invite"
  });
  const initialInvite = created.privateInvites?.[0];
  assert.ok(initialInvite);
  const joined = await service.claimPrivateInvite(created.sessionId, {
    inviteToken: initialInvite.inviteToken
  });
  const recovery = await service.issuePrivateSeatRecoveryInvite(
    created.sessionId,
    created.credential,
    { seatId: "p2" }
  );

  const recovered = await service.claimPrivateInvite(
    created.sessionId,
    { inviteToken: recovery.inviteToken },
    joined.credential
  );
  assert.match(recovered.credential, /^ses_[A-Za-z0-9_-]{43}$/u);
  assert.equal(await isolatedStore.authenticateSession({
    sessionId: created.sessionId,
    credentialSha256: hashSessionCredential(joined.credential)
  }), null);
  assert.ok(await isolatedStore.authenticateSession({
    sessionId: created.sessionId,
    credentialSha256: hashSessionCredential(recovered.credential)
  }));
});

test("credential recovery rejects an old SSE request delayed before registration", async () => {
  const delayedStore = new DelayedImmutableBundleStore();
  const isolatedApi = createRuntimeApiServer({ port: 0, sessionStore: delayedStore });
  let releaseBundleRead = () => {};
  try {
    await isolatedApi.start();
    const isolatedBaseUrl = `http://127.0.0.1:${isolatedApi.port}`;
    const create = await fetch(`${isolatedBaseUrl}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId: "estate-race", participantCount: 2, accessMode: "private-invite" })
    });
    const created = await readJson<CreatedPrivateSession>(create);
    assert.equal(create.status, 201, JSON.stringify(created));
    const joined = await claimAt(isolatedBaseUrl, created.sessionId, created.privateInvites[0].inviteToken);
    assert.equal(joined.response.status, 200, JSON.stringify(joined.body));
    const oldCredential = (joined.body as { credential: string }).credential;
    const issued = await issueRecoveryAt(isolatedBaseUrl, created.sessionId, created.credential, "p2");
    assert.equal(issued.response.status, 201, JSON.stringify(issued.body));

    const delay = delayedStore.delayNextImmutableBundleRead();
    releaseBundleRead = delay.release;
    const delayedStream = fetch(`${isolatedBaseUrl}/sessions/${created.sessionId}/events`, {
      headers: { Authorization: `Bearer ${oldCredential}` }
    });
    await delay.started;

    const recovered = await claimAt(
      isolatedBaseUrl,
      created.sessionId,
      (issued.body as PrivateSessionInvite).inviteToken
    );
    assert.equal(recovered.response.status, 200, JSON.stringify(recovered.body));
    delay.release();

    const rejectedStream = await delayedStream;
    assert.equal(rejectedStream.status, 401);
    assert.equal(rejectedStream.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal((await rejectedStream.text()).includes("stateVersion"), false);
  } finally {
    releaseBundleRead();
    await isolatedApi.close();
  }
});

test("the host rotates one joined guest credential without changing the game snapshot", async () => {
  const create = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId: "estate-race", participantCount: 2, accessMode: "private-invite" })
  });
  const created = await readJson<CreatedPrivateSession>(create);
  assert.equal(create.status, 201, JSON.stringify(created));
  const initialInvite = created.privateInvites[0];
  const invitedSeatIssue = await issueRecovery(created.sessionId, created.credential, "p2");
  assert.equal(invitedSeatIssue.response.status, 404);
  const initialClaim = await claim(created.sessionId, initialInvite.inviteToken);
  assert.equal(initialClaim.response.status, 200, JSON.stringify(initialClaim.body));
  const oldCredential = (initialClaim.body as { credential: string }).credential;
  const oldPrincipal = await store.authenticateSession({
    sessionId: created.sessionId,
    credentialSha256: hashSessionCredential(oldCredential)
  });
  assert.ok(oldPrincipal);

  const guestIssue = await issueRecovery(created.sessionId, oldCredential, "p2");
  assert.equal(guestIssue.response.status, 403);
  const hostSeatIssue = await issueRecovery(created.sessionId, created.credential, "p1");
  assert.equal(hostSeatIssue.response.status, 404);

  const firstIssue = await issueRecovery(created.sessionId, created.credential, "p2");
  assert.equal(firstIssue.response.status, 201, JSON.stringify(firstIssue.body));
  const firstRecovery = firstIssue.body as PrivateSessionInvite;
  assert.match(firstRecovery.inviteToken, /^inv_[A-Za-z0-9_-]{43}$/u);
  assert.equal((await authenticated(`/sessions/${created.sessionId}`, oldCredential)).status, 200);

  const secondIssue = await issueRecovery(created.sessionId, created.credential, "p2");
  assert.equal(secondIssue.response.status, 201, JSON.stringify(secondIssue.body));
  const secondRecovery = secondIssue.body as PrivateSessionInvite;
  assert.notEqual(secondRecovery.inviteToken, firstRecovery.inviteToken);
  assert.equal((await claim(created.sessionId, firstRecovery.inviteToken)).response.status, 401);
  const oldViewResponse = await authenticated(`/sessions/${created.sessionId}`, oldCredential);
  assert.equal(oldViewResponse.status, 200);
  const oldView = await readJson<PrivateInviteClaimResponse<Record<string, unknown>>>(oldViewResponse);

  const mismatchedPrincipal = await claim(
    created.sessionId,
    secondRecovery.inviteToken,
    created.credential
  );
  assert.equal(mismatchedPrincipal.response.status, 401);

  const oldStream = await openStream(created.sessionId, oldCredential);
  const before = await store.getSession(created.sessionId);
  assert.ok(before);
  const recoveryClaims = await Promise.all([
    claim(created.sessionId, secondRecovery.inviteToken),
    claim(created.sessionId, secondRecovery.inviteToken)
  ]);
  const recovered = recoveryClaims.find(({ response }) => response.status === 200);
  const recoveryLoser = recoveryClaims.find(({ response }) => response.status !== 200);
  assert.ok(recovered);
  assert.equal(recoveryLoser?.response.status, 401);
  assert.equal(recoveryLoser?.response.headers.get("www-authenticate"), null);
  const recoveredBody = recovered.body as PrivateInviteClaimResponse<Record<string, unknown>>;
  assert.deepEqual(recoveredBody.version, before.version);
  assert.deepEqual(recoveredBody.participants, before.participants);
  assert.deepEqual(recoveredBody.state, oldView.state);
  assert.equal((await oldStream.reader.read()).done, true, "rotated principal SSE must close after commit");

  const newCredential = recoveredBody.credential;
  assert.equal((await authenticated(`/sessions/${created.sessionId}`, oldCredential)).status, 401);
  assert.equal((await authenticated(`/sessions/${created.sessionId}`, newCredential)).status, 200);
  assert.equal(await store.authenticateSession({
    sessionId: created.sessionId,
    credentialSha256: hashSessionCredential(oldCredential)
  }), null);
  assert.equal((await store.authenticateSession({
    sessionId: created.sessionId,
    credentialSha256: hashSessionCredential(newCredential)
  }))?.principalId, oldPrincipal.principalId);
  const after = await store.getSession(created.sessionId);
  assert.deepEqual(after, before);
  const recoveryReplay = await claim(created.sessionId, secondRecovery.inviteToken);
  assert.equal(recoveryReplay.response.status, 401);
  assert.deepEqual(recoveryReplay.body, recoveryLoser?.body);

  const retryIssue = await issueRecovery(created.sessionId, created.credential, "p2");
  assert.equal(retryIssue.response.status, 201);
  const retryRecovery = retryIssue.body as PrivateSessionInvite;
  const sameBrowserRecovery = await claim(
    created.sessionId,
    retryRecovery.inviteToken,
    newCredential
  );
  assert.equal(sameBrowserRecovery.response.status, 200);
  const replacementIssue = await issueRecovery(created.sessionId, created.credential, "p2");
  assert.equal(replacementIssue.response.status, 201);
  assert.equal((await claim(created.sessionId, retryRecovery.inviteToken)).response.status, 401);
  assert.equal(
    (await claim(
      created.sessionId,
      (replacementIssue.body as PrivateSessionInvite).inviteToken,
      newCredential
    )).response.status,
    200
  );
});

async function claim(sessionId: string, inviteToken: string, currentCredential?: string): Promise<{
  response: Response;
  body: unknown;
}> {
  return claimAt(baseUrl, sessionId, inviteToken, currentCredential);
}

async function claimAt(
  targetBaseUrl: string,
  sessionId: string,
  inviteToken: string,
  currentCredential?: string
): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(`${targetBaseUrl}/sessions/${sessionId}/private-invite-claims`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(currentCredential === undefined ? {} : { Authorization: `Bearer ${currentCredential}` })
    },
    body: JSON.stringify({ inviteToken })
  });
  return { response, body: await readJson<unknown>(response) };
}

async function issueRecovery(sessionId: string, credential: string, seatId: string): Promise<{
  response: Response;
  body: unknown;
}> {
  return issueRecoveryAt(baseUrl, sessionId, credential, seatId);
}

async function issueRecoveryAt(
  targetBaseUrl: string,
  sessionId: string,
  credential: string,
  seatId: string
): Promise<{ response: Response; body: unknown }> {
  const response = await fetch(`${targetBaseUrl}/sessions/${sessionId}/seat-recovery-invites`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential}` },
    body: JSON.stringify({ seatId })
  });
  return { response, body: await readJson<unknown>(response) };
}

class DelayedImmutableBundleStore extends InMemorySessionStore<Record<string, unknown>> {
  private nextBundleRead?: {
    readonly started: () => void;
    readonly waitForRelease: Promise<void>;
  };

  delayNextImmutableBundleRead(): { readonly started: Promise<void>; readonly release: () => void } {
    let markStarted = () => {};
    let release = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const waitForRelease = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.nextBundleRead = { started: markStarted, waitForRelease };
    return { started, release };
  }

  override async getImmutableBundle(bundleHash: string) {
    const bundle = await super.getImmutableBundle(bundleHash);
    const delay = this.nextBundleRead;
    if (delay !== undefined) {
      this.nextBundleRead = undefined;
      delay.started();
      await delay.waitForRelease;
    }
    return bundle;
  }
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
