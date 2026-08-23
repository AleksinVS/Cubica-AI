import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import type {
  PrivateSessionInvite,
  SessionStateVersion,
  SessionVersionNotification
} from "@cubica/contracts-session";
import { createRuntimeApiServer } from "../src/modules/player-api/httpServer.ts";
import { SessionVersionEventHub } from "../src/modules/player-api/sessionVersionEventHub.ts";
import { InMemorySessionStore } from "../src/modules/session/inMemorySessionStore.ts";

type Created = {
  sessionId: string;
  credential: string;
  privateInvites?: PrivateSessionInvite[];
  participants: Array<{ seatId: string; playerId: string; kind: string; joinState: string }>;
  version: { sessionId: string; stateVersion: number; lastEventSequence: number };
};

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const contentRoot = path.join(repositoryRoot, ".tmp", "editor-worktrees", "private-invite-neutral-fixture");
const contentSourceId = "private-invite-neutral-fixture";
const eventHub = new SessionVersionEventHub(2);
const api = createRuntimeApiServer({
  port: 0,
  sessionStore: new InMemorySessionStore<Record<string, unknown>>(),
  sessionVersionEventHub: eventHub
});
let baseUrl = "";

before(async () => {
  const source = path.join(repositoryRoot, "games", "simple-choice");
  const target = path.join(contentRoot, "games", "simple-choice");
  await rm(contentRoot, { recursive: true, force: true });
  await mkdir(path.join(target, "ui", "web"), { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(source, "game.manifest.json"), "utf8")) as {
    config: { players: { min: number; max: number } };
  };
  manifest.config.players = { min: 2, max: 2 };
  await writeFile(path.join(target, "game.manifest.json"), `${JSON.stringify(manifest)}\n`, "utf8");
  await writeFile(
    path.join(target, "ui", "web", "ui.manifest.json"),
    await readFile(path.join(source, "ui", "web", "ui.manifest.json"), "utf8"),
    "utf8"
  );

  await api.start();
  baseUrl = `http://127.0.0.1:${api.port}`;
  const reload = await fetch(`${baseUrl}/content/reload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentSourceId, contentRoot })
  });
  assert.equal(reload.status, 200, await reload.text());
});

after(async () => {
  await api.close();
  await rm(contentRoot, { recursive: true, force: true });
});

test("private capabilities are seat-scoped and SSE carries only resync cursors", async () => {
  const localCreate = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId: "simple-choice" })
  });
  const localCreated = await localCreate.json() as Created;
  assert.equal(localCreate.status, 201, JSON.stringify(localCreated));
  assert.equal(localCreated.privateInvites, undefined);
  assert.deepEqual(localCreated.participants, [
    { seatId: "p1", playerId: "p1", kind: "human", joinState: "local" }
  ]);

  const privateWithoutGuest = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId: "simple-choice", accessMode: "private-invite" })
  });
  assert.equal(privateWithoutGuest.status, 400);

  const create = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId: "simple-choice", contentSourceId, accessMode: "private-invite" })
  });
  const created = await create.json() as Created;
  assert.equal(create.status, 201, JSON.stringify(created));
  assert.deepEqual(created.participants, [
    { seatId: "p1", playerId: "p1", kind: "human", joinState: "private-invite" },
    { seatId: "p2", playerId: "p2", kind: "human", joinState: "private-invite" }
  ]);
  assert.equal(created.privateInvites?.length, 1);
  const guest = created.privateInvites![0];
  assert.equal(guest.playerId, "p2");
  assert.match(created.credential, /^ses_[A-Za-z0-9_-]{43}$/u);
  assert.match(guest.credential, /^ses_[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(guest.credential, created.credential);

  for (const credential of [created.credential, guest.credential]) {
    const read = await authenticated(`/sessions/${created.sessionId}`, credential);
    assert.equal(read.status, 200);
    const serialized = await read.text();
    assert.doesNotMatch(serialized, /privateInvites|credential|ses_/u);
  }

  const guessed = `ses_${"A".repeat(43)}`;
  const guessedRead = await authenticated(`/sessions/${created.sessionId}`, guessed);
  const guessedStream = await authenticated(`/sessions/${created.sessionId}/events`, guessed);
  assert.equal(guessedRead.status, 401);
  assert.equal(guessedStream.status, 401);
  assert.deepEqual(await guessedRead.json(), await guessedStream.json());

  const hostStream = await openStream(created.sessionId, created.credential);
  assert.deepEqual(hostStream.initial.notification, { stateVersion: 0, lastEventSequence: 0 });
  assert.doesNotMatch(hostStream.initial.raw, /credential|secret|ses_|"state"\s*:|"players"\s*:/iu);

  const publish = eventHub.publish.bind(eventHub);
  const consoleError = console.error;
  const notificationErrors: unknown[][] = [];
  eventHub.publish = (version: SessionStateVersion) => {
    publish(version);
    throw new Error("injected post-commit notification fault");
  };
  console.error = (...args: unknown[]) => notificationErrors.push(args);
  let action: Response;
  try {
    action = await authenticated("/actions", created.credential, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: created.sessionId,
        actionId: "choice.accept",
        commandId: "cli_AAAAAAAAAAAAAAAAAAAAAA",
        expectedStateVersion: 0,
        params: {}
      })
    });
  } finally {
    eventHub.publish = publish;
    console.error = consoleError;
  }
  assert.equal(action.status, 200, await action.text());
  assert.equal(notificationErrors.length, 1);
  const later = await readSseMessage(hostStream.reader);
  assert.deepEqual(later.notification, { stateVersion: 1, lastEventSequence: 1 });
  assert.doesNotMatch(later.raw, /credential|secret|ses_|"state"\s*:|"players"\s*:/iu);

  await hostStream.reader.cancel();
  await waitFor(() => eventHub.size === 0);
  const reconnect = await openStream(created.sessionId, guest.credential);
  assert.deepEqual(reconnect.initial.notification, { stateVersion: 1, lastEventSequence: 1 });
  await reconnect.reader.cancel();
  await waitFor(() => eventHub.size === 0);

  const first = await openStream(created.sessionId, created.credential);
  const second = await openStream(created.sessionId, guest.credential);
  assert.equal(eventHub.size, 2);
  const overCapacity = await authenticated(`/sessions/${created.sessionId}/events`, created.credential);
  assert.equal(overCapacity.status, 429);
  await first.reader.cancel();
  await second.reader.cancel();
  await waitFor(() => eventHub.size === 0);
});

async function authenticated(pathname: string, credential: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${credential}`);
  return fetch(`${baseUrl}${pathname}`, { ...init, headers });
}

async function openStream(sessionId: string, credential: string) {
  const response = await authenticated(`/sessions/${sessionId}/events`, credential);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.ok(response.body);
  const reader = response.body!.getReader();
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

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for stream cleanup");
}
