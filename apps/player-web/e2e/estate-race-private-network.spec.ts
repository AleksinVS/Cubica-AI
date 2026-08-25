/** S10 browser acceptance for private invite capabilities and peer refresh. */
import { randomBytes } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Page, type Response } from "@playwright/test";

const GAME_ID = "estate-race";
const PLAYER_URL = process.env.E2E_PLAYER_URL ?? "http://127.0.0.1:3200";
const FIELD_LABEL = "Игровое поле Estate Race";
type JsonValue = string | number | boolean | null | JsonRecord | JsonValue[];
type JsonRecord = { [key: string]: JsonValue };
type Participant = { seatId: string; playerId: string; kind: string; joinState: string };
type Player = { objects?: JsonRecord };
type EstateState = {
  players: Record<string, Player>;
  public: { setupComplete: boolean; turn: { activePlayerId: string; phase: string; order: string[] } };
  secret?: JsonValue;
};
type Snapshot = {
  sessionId: string;
  version: { stateVersion: number; lastEventSequence?: number };
  state: EstateState;
  participants: Participant[];
  privateInvites?: Array<{ seatId: string; playerId: string; inviteToken: string; expiresAt: string }>;
  credential?: string;
  receipt?: { status: string; rejectionCode?: string };
  actionAvailability?: Array<{ actionId: string; status: string }>;
};
type S10Window = Window & { __s10Events?: string[] };
type CursorEvent = { stateVersion?: number; lastEventSequence?: number };

test.describe("Estate Race private network", { tag: "@player" }, () => {
  test("keeps invite and seat secrets private while peers follow SSE refresh", async ({ browser }) => {
    // The dev profile compiles each newly touched BFF route on demand. Keep
    // assertions individually bounded while allowing one cold two-context run.
    test.setTimeout(300_000);
    const host = await context(browser);
    const guest = await context(browser);
    const anonymous = await browser.newContext({ baseURL: PLAYER_URL });
    const hostPage = await host.newPage();
    const guestPage = await guest.newPage();
    try {
      await hostPage.goto(`/?gameId=${GAME_ID}`);
      await expect(hostPage.getByRole("heading", { name: "Кто участвует в игре?" })).toBeVisible();
      await hostPage.getByLabel("Игра по приглашениям").check();
      const createRequest = hostPage.waitForRequest((request) => new URL(request.url()).pathname === "/api/runtime/sessions" && request.method() === "POST");
      const create = waitFor(hostPage, "/api/runtime/sessions", "POST");
      await hostPage.getByRole("button", { name: "Начать игру" }).click();
      expect((await createRequest).postDataJSON()).toMatchObject({ accessMode: "private-invite", participantCount: 2, agentSeatCount: 0 });
      const created = await json(await create, 201) as Snapshot;
      expect(created.participants).toEqual([
        { seatId: "p1", playerId: "p1", kind: "human", joinState: "joined" },
        { seatId: "p2", playerId: "p2", kind: "human", joinState: "invited" }
      ]);
      expect(created.privateInvites).toHaveLength(1);
      const invite = created.privateInvites?.[0];
      expect(invite).toBeDefined();
      expect(Object.keys(invite ?? {}).sort()).toEqual(["expiresAt", "inviteToken", "playerId", "seatId"]);
      expect(created).not.toHaveProperty("credential");
      if (!invite) throw new Error("Private invite was not returned by session creation.");
      await expectCursor(hostPage, created.version);
      const hostEventsBeforeClaim = await sessionEventCount(hostPage);
      const copy = hostPage.getByRole("button", { name: "Скопировать ссылку" });
      await expect(copy).toBeVisible();
      await copy.click();
      const inviteUrl = new URL(await hostPage.evaluate(() => navigator.clipboard.readText()));
      expect(inviteUrl.search).toBe(`?gameId=${GAME_ID}`);
      const fragment = new URLSearchParams(inviteUrl.hash.slice(1));
      expect([...fragment.keys()].sort()).toEqual(["inviteToken", "sessionId"]);
      expect(fragment.get("sessionId")).toBe(created.sessionId);
      expect(fragment.get("inviteToken")).toBe(invite.inviteToken);
      expect(inviteUrl.search).not.toMatch(/inviteToken|playerId|seatId/iu);
      expect(inviteUrl.hash).not.toMatch(/credential|playerId|seatId/iu);

      const claim = waitFor(guestPage, `/api/runtime/sessions/${created.sessionId}/private-invite-claims`, "POST");
      await guestPage.goto(inviteUrl.toString());
      const guestSnapshot = await json(await claim, 200) as Snapshot;
      expect(guestSnapshot.sessionId).toBe(created.sessionId);
      expectSafeProjection(guestSnapshot, "p2", "p1");
      await expectSessionEventCount(hostPage, hostEventsBeforeClaim + 1);
      await expect(
        hostPage.getByRole("region", { name: "Участники" }).getByRole("listitem")
          .filter({ hasText: /p2\s*Человек · Подключён/u })
      ).toContainText("Подключён");
      const hostClaimSnapshot = await sessionGet(hostPage, created.sessionId);
      expect(guestSnapshot.version.stateVersion).toBe(created.version.stateVersion + 1);
      expect(hostClaimSnapshot.version).toEqual(guestSnapshot.version);
      expect(hostClaimSnapshot.actionAvailability?.find(({ actionId }) =>
        actionId === "session.setup.finalize"
      )?.status).toBe("available");
      await expect.poll(() => guestPage.url()).toBe(`${PLAYER_URL}/?gameId=${GAME_ID}`);
      const cookies = await guest.cookies(`${PLAYER_URL}/api/runtime`);
      const capabilityCookie = cookies.find((cookie) => cookie.path === "/api/runtime" && cookie.httpOnly);
      expect(capabilityCookie).toMatchObject({ path: "/api/runtime", httpOnly: true, sameSite: "Strict" });
      expect(capabilityCookie?.value).toMatch(/^ses_[A-Za-z0-9_-]{43}$/u);
      expect(capabilityCookie?.value).not.toBe(invite.inviteToken);
      expect(await guestPage.evaluate(() => document.cookie)).not.toContain("ses_");
      const anonymousRead = await anonymous.request.get(
        `${PLAYER_URL}/api/runtime/sessions/${encodeURIComponent(created.sessionId)}`
      );
      const anonymousBody = await anonymousRead.text();
      expect(anonymousRead.status()).toBe(401);
      expect(anonymousBody).not.toMatch(/privateInvites|inviteToken|inv_[A-Za-z0-9_-]+|ses_[A-Za-z0-9_-]+/u);
      await expectCursor(guestPage, guestSnapshot.version);

      await expectBoardAction(hostPage, "Определить порядок");
      const setupRead = waitForSessionReadVersion(
        guestPage,
        created.sessionId,
        guestSnapshot.version.stateVersion + 1
      );
      const setup = await clickAction(hostPage, "Определить порядок");
      expect(setup.request.actionId).toBe("session.setup.finalize");
      expect(setup.request).not.toHaveProperty("playerId");
      expect(setup.snapshot.receipt?.status).toBe("applied");
      const setupRefresh = await json(await setupRead, 200) as Snapshot;
      expect(setupRefresh.version).toEqual(setup.snapshot.version);
      expectSafeProjection(setupRefresh, "p2", "p1");
      await expectCursor(guestPage, setup.snapshot.version);

      const active = setup.snapshot.state.public.turn.activePlayerId as string;
      const activePage = active === "p1" ? hostPage : guestPage;
      const peerPage = active === "p1" ? guestPage : hostPage;
      const activeSnapshot = active === "p1" ? setup.snapshot : setupRefresh;
      expect(activeSnapshot.actionAvailability?.find(({ actionId }) => actionId === "turn.roll")?.status).toBe("available");
      await expectBoardAction(activePage, "Бросить кости");
      const peerRead = waitForSessionReadVersion(
        peerPage,
        created.sessionId,
        setup.snapshot.version.stateVersion + 1
      );
      const roll = await clickAction(activePage, "Бросить кости");
      expect(roll.request.actionId).toBe("turn.roll");
      expect(roll.request).not.toHaveProperty("playerId");
      expect(roll.snapshot.receipt?.status).toBe("applied");
      const peer = await json(await peerRead, 200) as Snapshot;
      expect(peer.version).toEqual(roll.snapshot.version);
      expectSafeProjection(peer, active === "p1" ? "p2" : "p1", active);
      await expectCursor(peerPage, roll.snapshot.version);

      const spoof = await postAction(hostPage, { sessionId: created.sessionId, playerId: "p2", actionId: "turn.roll", commandId: commandId(), expectedStateVersion: roll.snapshot.version.stateVersion, params: {} });
      expect(spoof.status).toBe(400);
      expect(JSON.stringify(spoof.body)).not.toMatch(/inviteToken|privateInvites|ses_/iu);
      const stale = await postAction(activePage, { sessionId: created.sessionId, actionId: "turn.roll", commandId: commandId(), expectedStateVersion: setup.snapshot.version.stateVersion, params: {} });
      expect(stale.status).toBe(409);
      expect(JSON.stringify(stale.body)).not.toMatch(/inviteToken|privateInvites|ses_/iu);
      const unchanged = await sessionGet(guestPage, created.sessionId);
      expect(unchanged.version).toEqual(roll.snapshot.version);
      expect(unchanged.state.public.turn).toEqual(roll.snapshot.state.public.turn);

      const reconnectRead = waitForSessionReadVersion(
        guestPage,
        created.sessionId,
        roll.snapshot.version.stateVersion
      );
      await guestPage.reload();
      const reconnected = await json(await reconnectRead, 200) as Snapshot;
      expect(reconnected.version).toEqual(roll.snapshot.version);
      expect(reconnected.state.public.turn.activePlayerId).toBe(roll.snapshot.state.public.turn.activePlayerId);
      expectSafeProjection(reconnected, "p2", "p1");
      await expectCursor(guestPage, roll.snapshot.version);

      await guestPage.setViewportSize({ width: 390, height: 844 });
      const actionToggle = board(guestPage).getByRole("button", { name: "Действия" });
      const overviewToggle = guestPage.getByRole("button", { name: "Открыть панель «Обзор»" });
      const fitMap = board(guestPage).getByRole("button", { name: "Показать всю карту" });
      await expect(actionToggle).toBeVisible();
      await expect(overviewToggle).toBeVisible();
      await expect(fitMap).toBeEnabled({ timeout: 60_000 });
      await fitMap.click();
      await guestPage.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
      const [actionBounds, overviewBounds] = await Promise.all([
        actionToggle.boundingBox(),
        overviewToggle.boundingBox()
      ]);
      expect(actionBounds).not.toBeNull();
      expect(overviewBounds).not.toBeNull();
      if (actionBounds && overviewBounds) {
        expect(actionBounds.x + actionBounds.width).toBeLessThan(overviewBounds.x);
      }
    } finally { await Promise.allSettled([anonymous.close(), host.close(), guest.close()]); }
  });
});

async function context(browser: Browser): Promise<BrowserContext> {
  const result = await browser.newContext({ baseURL: PLAYER_URL });
  await result.grantPermissions(["clipboard-read", "clipboard-write"], { origin: PLAYER_URL });
  await result.addInitScript(() => {
    const events: string[] = [];
    (window as S10Window).__s10Events = events;
    const Native = window.EventSource;
    window.EventSource = class extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        this.addEventListener("version", (event) => events.push((event as MessageEvent<string>).data));
      }
    };
  });
  return result;
}
const board = (page: Page) => page.getByRole("region", { name: FIELD_LABEL });
async function expectBoardAction(page: Page, label: string): Promise<void> {
  const action = board(page).getByRole("button", { name: label });
  const toggle = board(page).getByRole("button", { name: "Действия" });
  await expect(toggle).toBeVisible({ timeout: 60_000 });
  if (await toggle.getAttribute("aria-expanded") !== "true") {
    await toggle.click();
  }
  await expect(action).toBeVisible({ timeout: 60_000 });
  await expect(action).toBeEnabled();
}
const waitFor = (page: Page, path: string, method: string) => page.waitForResponse((response) =>
  new URL(response.url()).pathname === path && response.request().method() === method
);
const waitForSessionReadVersion = (page: Page, sessionId: string, stateVersion: number) =>
  waitForSessionRead(page, sessionId, (snapshot) => snapshot.version.stateVersion === stateVersion);
const waitForSessionRead = (
  page: Page,
  sessionId: string,
  predicate: (snapshot: Snapshot) => boolean
  ) => page.waitForResponse(async (response) => {
    if (
      new URL(response.url()).pathname !== `/api/runtime/sessions/${encodeURIComponent(sessionId)}` ||
      response.request().method() !== "GET" ||
      response.status() !== 200
    ) return false;
    return predicate(await response.json() as Snapshot);
  }, { timeout: 60_000 });
async function json(response: Response, status: number): Promise<Snapshot> {
  const body = await response.text();
  expect(response.status(), body).toBe(status);
  return JSON.parse(body) as Snapshot;
}
async function clickAction(page: Page, label: string): Promise<{ request: JsonRecord; snapshot: Snapshot }> {
  const request = page.waitForRequest((request) =>
    new URL(request.url()).pathname === "/api/runtime/actions" && request.method() === "POST"
  );
  const response = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/runtime/actions" && response.request().method() === "POST"
  );
  await board(page).getByRole("button", { name: label }).click();
  const [req, res] = await Promise.all([request, response]);
  return { request: req.postDataJSON() as JsonRecord, snapshot: await json(res, 200) };
}
async function postAction(page: Page, body: JsonRecord): Promise<{ status: number; body: JsonRecord }> {
  return page.evaluate(async (input: string) => {
    const response = await fetch("/api/runtime/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: input
    });
    return { status: response.status, body: await response.json() as JsonRecord };
  }, JSON.stringify(body));
}
async function sessionGet(page: Page, id: string): Promise<Snapshot> {
  return page.evaluate(async (sessionId) => {
    const response = await fetch(`/api/runtime/sessions/${encodeURIComponent(sessionId)}`, {
      credentials: "same-origin"
    });
    return response.json() as Promise<Snapshot>;
  }, id);
}
function expectSafeProjection(snapshot: Snapshot, own: string, peer: string): void {
  expect(snapshot.state).not.toHaveProperty("secret");
  expect(snapshot).not.toHaveProperty("privateInvites");
  expect(snapshot).not.toHaveProperty("credential");
  expect(snapshot.state.players[own]).toBeDefined();
  expect(snapshot.state.players[peer]).toBeDefined();
  expect(snapshot.state.players[peer]?.objects).not.toHaveProperty("heldExitCardId");
  expect(snapshot.state.players[peer]?.objects).not.toHaveProperty("heldExitCardId2");
  expect(JSON.stringify(snapshot)).not.toMatch(/inviteToken|privateInvites|credential|ses_/iu);
}
async function expectCursor(page: Page, version: Snapshot["version"]): Promise<void> {
  await expect.poll(async (): Promise<CursorEvent[]> => {
    const events = await page.evaluate(() => (window as S10Window).__s10Events ?? []);
    return events.map((event) => JSON.parse(event) as CursorEvent);
  }).toContainEqual(expect.objectContaining({ stateVersion: version.stateVersion }));
}
const sessionEventCount = (page: Page): Promise<number> =>
  page.evaluate(() => ((window as S10Window).__s10Events ?? []).length);
async function expectSessionEventCount(page: Page, minimum: number): Promise<void> {
  await expect.poll(() => sessionEventCount(page)).toBeGreaterThanOrEqual(minimum);
}
function commandId(): string { return `cli_${randomBytes(16).toString("base64url")}`; }
