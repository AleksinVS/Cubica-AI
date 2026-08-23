/**
 * Browser acceptance for the Estate Race private-session network boundary.
 *
 * Two independent browser contexts exercise the production Player Web BFF,
 * Runtime API capability cookies and SSE-driven projection refresh. The test
 * follows the server-selected initial actor and performs only actions already
 * published by the normal Estate Race UI; it never predicts dice or mutates a
 * runtime snapshot directly.
 */

import { randomBytes } from "node:crypto";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type Response
} from "@playwright/test";

const GAME_ID = "estate-race";
const PLAYER_URL = process.env.E2E_PLAYER_URL ?? "http://127.0.0.1:3200";
const FIELD_LABEL = "Игровое поле Estate Race";
const BOARD_READY_TIMEOUT_MS = 30_000;

type JsonRecord = Record<string, unknown>;

interface RuntimeSnapshot {
  readonly sessionId: string;
  readonly participants: ReadonlyArray<{
    readonly seatId: string;
    readonly playerId: string;
    readonly kind: string;
    readonly joinState: string;
  }>;
  readonly privateInvites?: ReadonlyArray<{
    readonly seatId: string;
    readonly playerId: string;
    readonly credential: string;
  }>;
  readonly receipt?: {
    readonly status: "applied" | "rejected";
    readonly rejectionCode?: string;
  };
  readonly version: {
    readonly stateVersion: number;
    readonly lastEventSequence: number;
  };
  readonly state: {
    readonly secret?: unknown;
    readonly players: Record<string, {
      readonly objects?: JsonRecord;
    }>;
    readonly public: {
      readonly setupComplete: boolean;
      readonly turn: {
        readonly activePlayerId: string;
        readonly order: readonly string[];
        readonly phase: string;
        readonly turnNumber: number;
      };
    };
  };
}

interface ActionResult {
  readonly requestBody: JsonRecord;
  readonly snapshot: RuntimeSnapshot;
}

test.describe("Estate Race private network", { tag: "@player" }, () => {
  test("keeps two seat capabilities private and synchronizes peers through SSE", async ({ browser }) => {
    test.setTimeout(120_000);

    const hostContext = await createPlayerContext(browser);
    const guestContext = await createPlayerContext(browser);
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    try {
      await hostPage.goto(`/?gameId=${GAME_ID}`);
      await expect(hostPage.getByRole("heading", { name: "Кто участвует в игре?" })).toBeVisible();
      await expect(hostPage.getByText(/Количество участников:\s*2/u)).toBeVisible();
      await expect(hostPage.getByLabel("Пригласить участников по ссылке")).toBeVisible();

      await hostPage.getByLabel("Пригласить участников по ссылке").check();
      const creationResponse = waitForSessionCreation(hostPage);
      await hostPage.getByRole("button", { name: "Начать игру" }).click();
      const created = await readJsonResponse(await creationResponse, 201);

      expect(created.participants).toEqual([
        { seatId: "p1", playerId: "p1", kind: "human", joinState: "private-invite" },
        { seatId: "p2", playerId: "p2", kind: "human", joinState: "private-invite" }
      ]);
      expect(created.privateInvites).toHaveLength(1);
      expect(created.privateInvites?.[0]).toMatchObject({ seatId: "p2", playerId: "p2" });
      expect(created).not.toHaveProperty("credential");

      await expectBoardAction(hostPage, "Определить порядок");
      const copyButton = hostPage.getByRole("button", {
        name: "Скопировать ссылку для места p2, p2"
      });
      await expect(copyButton).toBeVisible();
      await copyButton.click();
      await expect(hostPage.getByRole("status")).toHaveText("Ссылка скопирована");

      const inviteUrl = new URL(await hostPage.evaluate(() => navigator.clipboard.readText()));
      expect(inviteUrl.origin).toBe(PLAYER_URL);
      expect([...inviteUrl.searchParams.entries()]).toEqual([["gameId", GAME_ID]]);
      expect(inviteUrl.hash).toMatch(/^#invite\?sessionId=/u);
      const fragment = new URLSearchParams(inviteUrl.hash.slice("#invite?".length));
      expect(fragment.get("sessionId")).toBe(created.sessionId);
      expect(fragment.get("seatId")).toBe("p2");
      expect(fragment.get("playerId")).toBe("p2");
      expect(fragment.get("credential")).toMatch(/^ses_[A-Za-z0-9_-]{43}$/u);
      expect(inviteUrl.search).not.toContain("credential");

      const importResponse = waitForInviteImport(guestPage);
      const guestEventStream = waitForSessionEvents(guestPage, created.sessionId);
      await guestPage.goto(inviteUrl.toString());
      const imported = await readJsonResponse(await importResponse, 200);
      const guestEventResponse = await guestEventStream;
      expect(guestEventResponse.status()).toBe(200);
      expect(guestEventResponse.headers()["content-type"]).toContain("text/event-stream");
      await expect.poll(() => guestPage.url()).toBe(`${PLAYER_URL}/?gameId=${GAME_ID}`);
      expectSafeLaterProjection(imported, "p2", "p1");
      expect(imported.sessionId).toBe(created.sessionId);

      const inviteCredential = fragment.get("credential");
      const guestCookies = await guestContext.cookies(PLAYER_URL);
      const capabilityCookie = guestCookies.find((cookie) => cookie.value === inviteCredential);
      expect(capabilityCookie).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/api/runtime" });
      expect(await guestPage.evaluate(() => document.cookie)).not.toContain(inviteCredential ?? "ses_");

      const guestSetupRefresh = waitForSessionRead(guestPage, created.sessionId);
      const setup = await clickBoardAction(hostPage, "Определить порядок");
      expect(setup.requestBody).not.toHaveProperty("playerId");
      expect(setup.requestBody.actionId).toBe("session.setup.finalize");
      expect(setup.snapshot.receipt?.status).toBe("applied");
      expect(setup.snapshot.state.public.setupComplete).toBe(true);
      expect([...setup.snapshot.state.public.turn.order].sort()).toEqual(["p1", "p2"]);
      expectSafeLaterProjection(setup.snapshot, "p1", "p2");

      const guestAfterSetup = await readJsonResponse(await guestSetupRefresh, 200);
      expect(guestAfterSetup.version).toEqual(setup.snapshot.version);
      expect(guestAfterSetup.state.public.turn).toEqual(setup.snapshot.state.public.turn);
      expectSafeLaterProjection(guestAfterSetup, "p2", "p1");
      await expectObservedCursor(guestPage, setup.snapshot.version);

      const activePlayerId = setup.snapshot.state.public.turn.activePlayerId;
      expect(["p1", "p2"]).toContain(activePlayerId);
      const activePage = activePlayerId === "p1" ? hostPage : guestPage;
      const peerPage = activePlayerId === "p1" ? guestPage : hostPage;
      const activeSeat = activePlayerId;
      const peerSeat = activePlayerId === "p1" ? "p2" : "p1";

      await expectBoardAction(activePage, "Бросить кости");
      const peerRollRefresh = waitForSessionRead(peerPage, created.sessionId);
      const roll = await clickBoardAction(activePage, "Бросить кости");
      expect(roll.requestBody).not.toHaveProperty("playerId");
      expect(roll.requestBody.actionId).toBe("turn.roll");
      expect(roll.snapshot.receipt?.status).toBe("applied");
      expect(roll.snapshot.version.stateVersion).toBe(setup.snapshot.version.stateVersion + 1);
      expectSafeLaterProjection(roll.snapshot, activeSeat, peerSeat);

      const peerAfterRoll = await readJsonResponse(await peerRollRefresh, 200);
      expect(peerAfterRoll.version).toEqual(roll.snapshot.version);
      expect(peerAfterRoll.state.public.turn).toEqual(roll.snapshot.state.public.turn);
      expectSafeLaterProjection(peerAfterRoll, peerSeat, activeSeat);
      await expectObservedCursor(peerPage, roll.snapshot.version);

      const spoofed = await postBrowserAction(hostPage, {
        sessionId: created.sessionId,
        playerId: "p2",
        actionId: "turn.roll",
        commandId: commandId(),
        expectedStateVersion: roll.snapshot.version.stateVersion,
        params: {}
      });
      expect(spoofed.status).toBe(400);
      expect(spoofed.body).toMatchObject({ error: expect.stringMatching(/playerId/u) });
      expect(JSON.stringify(spoofed.body)).not.toMatch(/credential|privateInvites|ses_/iu);

      const stale = await postBrowserAction(activePage, {
        sessionId: created.sessionId,
        actionId: "turn.roll",
        commandId: commandId(),
        expectedStateVersion: setup.snapshot.version.stateVersion,
        params: {}
      });
      expect(stale.status).toBe(409);
      expect(stale.body).toMatchObject({ error: expect.stringMatching(/changed after version|reload it/iu) });
      expect(JSON.stringify(stale.body)).not.toMatch(/credential|privateInvites|ses_/iu);

      const unchangedHost = await getBrowserSession(hostPage, created.sessionId);
      const unchangedGuest = await getBrowserSession(guestPage, created.sessionId);
      expect(unchangedHost.version).toEqual(roll.snapshot.version);
      expect(unchangedGuest.version).toEqual(roll.snapshot.version);
      expect(unchangedHost.state.public.turn).toEqual(roll.snapshot.state.public.turn);
      expect(unchangedGuest.state.public.turn).toEqual(roll.snapshot.state.public.turn);
      expectSafeLaterProjection(unchangedHost, "p1", "p2");
      expectSafeLaterProjection(unchangedGuest, "p2", "p1");

      const guestReloadRead = waitForSessionRead(guestPage, created.sessionId);
      await guestPage.reload();
      const guestAfterReconnect = await readJsonResponse(await guestReloadRead, 200);
      expect(guestAfterReconnect.version).toEqual(roll.snapshot.version);
      expect(guestAfterReconnect.state.public.turn.activePlayerId)
        .toBe(roll.snapshot.state.public.turn.activePlayerId);
      expectSafeLaterProjection(guestAfterReconnect, "p2", "p1");
      await expectObservedCursor(guestPage, roll.snapshot.version);
      await expect(guestPage.getByText(new RegExp(
        `^Ход \\d+ · участник ${roll.snapshot.state.public.turn.activePlayerId} · ` +
        `${roll.snapshot.state.public.turn.phase}$`,
        "iu"
      ))).toBeVisible();
    } finally {
      await Promise.allSettled([guestContext.close(), hostContext.close()]);
    }
  });
});

async function createPlayerContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: PLAYER_URL });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: PLAYER_URL });
  await context.addInitScript(() => {
    const messages: string[] = [];
    const target = window as typeof window & { __estateRaceVersionEvents?: string[] };
    target.__estateRaceVersionEvents = messages;
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
        super(url, eventSourceInitDict);
        this.addEventListener("version", (event) => messages.push((event as MessageEvent).data));
      }
    };
  });
  return context;
}

const board = (page: Page) => page.getByRole("region", { name: FIELD_LABEL });

async function expectBoardAction(page: Page, label: string): Promise<void> {
  await expect(page.locator(".game-player-root")).toBeVisible();
  await expect(page.locator(".loading-state")).toHaveCount(0);
  await expect(board(page).getByRole("button", { name: label }))
    .toBeVisible({ timeout: BOARD_READY_TIMEOUT_MS });
}

const waitForSessionCreation = (page: Page) => page.waitForResponse((response) =>
  new URL(response.url()).pathname === "/api/runtime/sessions" &&
  response.request().method() === "POST"
);

const waitForInviteImport = (page: Page) => page.waitForResponse((response) =>
  new URL(response.url()).pathname === "/api/runtime/sessions/import" &&
  response.request().method() === "POST"
);

const waitForSessionRead = (page: Page, sessionId: string) => page.waitForResponse((response) =>
  new URL(response.url()).pathname === `/api/runtime/sessions/${encodeURIComponent(sessionId)}` &&
  response.request().method() === "GET"
);

const waitForSessionEvents = (page: Page, sessionId: string) => page.waitForResponse((response) =>
  new URL(response.url()).pathname ===
    `/api/runtime/sessions/${encodeURIComponent(sessionId)}/events` &&
  response.request().method() === "GET"
);

async function readJsonResponse(response: Response, status: number): Promise<RuntimeSnapshot> {
  const body = await response.text();
  expect(response.status(), body).toBe(status);
  return JSON.parse(body) as RuntimeSnapshot;
}

async function clickBoardAction(page: Page, label: string): Promise<ActionResult> {
  const actionRequest = page.waitForRequest((request) =>
    new URL(request.url()).pathname === "/api/runtime/actions" && request.method() === "POST"
  );
  const actionResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/runtime/actions" &&
    response.request().method() === "POST"
  );

  await board(page).getByRole("button", { name: label }).click();
  const [request, response] = await Promise.all([actionRequest, actionResponse]);
  const snapshot = await readJsonResponse(response, 200);
  return { requestBody: request.postDataJSON() as JsonRecord, snapshot };
}

async function postBrowserAction(page: Page, body: JsonRecord): Promise<{
  readonly status: number;
  readonly body: JsonRecord;
}> {
  return page.evaluate(async (input) => {
    const response = await fetch("/api/runtime/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(input)
    });
    return { status: response.status, body: await response.json() as JsonRecord };
  }, body);
}

async function getBrowserSession(page: Page, sessionId: string): Promise<RuntimeSnapshot> {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/runtime/sessions/${encodeURIComponent(id)}`, {
      credentials: "same-origin"
    });
    if (!response.ok) throw new Error(`Session GET failed with ${response.status}.`);
    return response.json() as Promise<RuntimeSnapshot>;
  }, sessionId);
}

async function expectObservedCursor(
  page: Page,
  expected: RuntimeSnapshot["version"]
): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const messages = (window as typeof window & { __estateRaceVersionEvents?: string[] })
      .__estateRaceVersionEvents ?? [];
    return messages.map((message) => JSON.parse(message) as JsonRecord);
  }), {
    message: `SSE did not publish state version ${expected.stateVersion}.`,
    timeout: 15_000
  }).toContainEqual({
    stateVersion: expected.stateVersion,
    lastEventSequence: expected.lastEventSequence
  });

  const messages = await page.evaluate(() =>
    (window as typeof window & { __estateRaceVersionEvents?: string[] })
      .__estateRaceVersionEvents ?? []
  );
  for (const message of messages) {
    const notification = JSON.parse(message) as JsonRecord;
    expect(Object.keys(notification).sort()).toEqual(["lastEventSequence", "stateVersion"]);
    expect(message).not.toMatch(
      /credential|privateInvites|"secret"\s*:|"players"\s*:|"state"\s*:|ses_/iu
    );
  }
}

function expectSafeLaterProjection(
  snapshot: RuntimeSnapshot,
  ownPlayerId: string,
  peerPlayerId: string
): void {
  expect(snapshot.state).not.toHaveProperty("secret");
  expect(snapshot).not.toHaveProperty("credential");
  expect(snapshot).not.toHaveProperty("privateInvites");
  expect(snapshot.state.players[ownPlayerId]).toBeDefined();
  expect(snapshot.state.players[peerPlayerId]).toBeDefined();
  const peerObjects = snapshot.state.players[peerPlayerId]?.objects ?? {};
  expect(peerObjects).not.toHaveProperty("heldExitCardId");
  expect(peerObjects).not.toHaveProperty("heldExitCardId2");
  expect(JSON.stringify(snapshot)).not.toMatch(/credential|privateInvites|ses_/iu);
}

function commandId(): string {
  return `cli_${randomBytes(16).toString("base64url")}`;
}
