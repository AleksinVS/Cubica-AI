/**
 * Browser acceptance for the first Estate Race gameplay slice (GSR-034).
 *
 * The test enters through the normal player-web URL, uses the accessible DOM
 * controls supplied beside the Phaser board, and observes authoritative
 * Runtime API snapshots. A bounded API-only progression is used between the
 * first purchase and the target rent landing: production sessions intentionally
 * use cryptographic random seeds, so forcing a die value in the browser would
 * test a path players never have.
 */

import {
  expect,
  test,
  type APIRequestContext,
  type Page
} from "@playwright/test";
import { randomBytes } from "node:crypto";

const GAME_ID = "estate-race";
const STORAGE_KEY = "cubica-estate-race-session-id";
const FIELD_LABEL = "Игровое поле Estate Race";
const MAX_PURCHASE_PROGRESS_ACTIONS = 180;
const MAX_PROGRESS_ACTIONS = 180;
const BOARD_PLUGIN_READY_TIMEOUT_MS = 30_000;

type RuntimeSnapshot = {
  sessionId: string;
  receipt?: {
    status: "applied" | "rejected";
    rejectionCode?: string;
  };
  version: {
    stateVersion: number;
  };
  state: {
    players: Record<string, { metrics: { cash: number; position: number } }>;
    secret?: {
      random?: unknown;
      decks?: unknown;
      [key: string]: unknown;
    };
    public: {
      turn: { activePlayerId: string; phase: string; turnNumber: number };
      board: {
        availableActions: Array<{
          actionId: string;
          params?: Record<string, unknown>;
        }>;
      };
      objects: {
        boardCells: Record<string, {
          attributes: {
            index: number;
            ownerPlayerId?: string;
            rent?: number;
          };
        }>;
      };
    };
  };
};

type BrowserActionResult = {
  requestBody: Record<string, unknown>;
  snapshot: RuntimeSnapshot;
};

test.describe("Estate Race GSR-034", () => {
  test("renders two-player board and completes first purchase and p2-to-p1 rent", async ({ page }) => {
    // The acceptance path includes a cold two-service startup plus a bounded
    // search of up to MAX_PROGRESS_ACTIONS authoritative requests. The former
    // 90-second total deadline could expire after the target rent state had
    // already been reached but before the browser reloaded that snapshot.
    test.setTimeout(180_000);

    const createSession = waitForSessionCreation(page);
    await page.goto(`/?gameId=${GAME_ID}`);
    const creationResponse = await createSession;
    expect(creationResponse.status()).toBe(201);
    const browserSession = await creationResponse.json() as RuntimeSnapshot;
    expectPlayerSnapshotHasNoPlatformSecrets(browserSession);

    await expect(page.locator(".game-player-root")).toBeVisible();
    await expect(page.locator(".loading-state")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Estate Race · прототип", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Игрок 1", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Игрок 2", level: 2 })).toBeVisible();
    await expect(board(page)).toBeVisible();
    await expect(board(page).getByTestId("interactive-board-canvas-host")).toBeVisible();
    await expect(board(page).getByRole("button", { name: "Бросить кости" }))
      .toBeVisible({ timeout: BOARD_PLUGIN_READY_TIMEOUT_MS });

    // Keep one browser-created session and its HttpOnly credential throughout
    // the acceptance path. Production dice remain random; when the first roll
    // is not a purchase, authoritative public actions progress the same session
    // until p1 reaches an unowned estate.
    const afterFirstRoll = (await clickBoardAction(page, "Бросить кости")).snapshot;
    const purchaseOpportunity = afterFirstRoll.state.public.turn.activePlayerId === "p1"
      && afterFirstRoll.state.public.turn.phase === "acquire"
      ? afterFirstRoll
      : await progressToFirstPlayerPurchaseOpportunity(page.request, afterFirstRoll);
    await openBrowserSession(page, purchaseOpportunity.sessionId);
    await expect(board(page).getByRole("button", { name: "Купить участок" }))
      .toBeVisible({ timeout: BOARD_PLUGIN_READY_TIMEOUT_MS });

    const purchase = await clickBoardAction(page, "Купить участок");
    expect(purchase.requestBody).not.toHaveProperty("playerId");
    expect(purchase.requestBody.commandId).toMatch(/^cli_[A-Za-z0-9_-]{22}$/u);
    expect(purchase.requestBody.params).toEqual(expect.objectContaining({ cellId: expect.any(String) }));

    const ownedCell = Object.values(purchase.snapshot.state.public.objects.boardCells)
      .find((cell) => cell.attributes.ownerPlayerId === "p1");
    expect(ownedCell).toBeDefined();
    expect(purchase.snapshot.state.players.p1.metrics.cash).toBeLessThan(900);

    const finishPurchaseTurn = await clickBoardAction(page, "Завершить ход");
    expect(finishPurchaseTurn.requestBody).not.toHaveProperty("playerId");
    expect(finishPurchaseTurn.snapshot.state.public.turn.activePlayerId).toBe("p2");

    // Progress valid turns through the same player-web Runtime API proxy until
    // p2 is required to pay p1. This keeps random state and all rule decisions
    // server-owned while avoiding dozens of visually identical browser clicks.
    const beforeRent = await progressToSecondPlayerRent(page.request, finishPurchaseTurn.snapshot);
    const landedIndex = beforeRent.state.players.p2.metrics.position;
    const landedCell = Object.values(beforeRent.state.public.objects.boardCells)
      .find((cell) => cell.attributes.index === landedIndex);
    expect(landedCell?.attributes.ownerPlayerId).toBe("p1");
    expect(landedCell?.attributes.rent).toEqual(expect.any(Number));

    await openBrowserSession(page, beforeRent.sessionId);
    await expect(page.getByText(/активен p2 · этап rent/i)).toBeVisible();
    await expect(board(page).getByRole("button", { name: "Оплатить ренту" }))
      .toBeVisible({ timeout: BOARD_PLUGIN_READY_TIMEOUT_MS });

    const p1CashBefore = beforeRent.state.players.p1.metrics.cash;
    const p2CashBefore = beforeRent.state.players.p2.metrics.cash;
    const rent = landedCell?.attributes.rent as number;
    const rentPayment = await clickBoardAction(page, "Оплатить ренту");

    // This is the hotseat seam: the browser never claims actor p2. Runtime
    // resolves it from the authenticated controller and authoritative turn.
    expect(rentPayment.requestBody).not.toHaveProperty("playerId");
    expect(rentPayment.snapshot.state.players.p1.metrics.cash).toBe(p1CashBefore + rent);
    expect(rentPayment.snapshot.state.players.p2.metrics.cash).toBe(p2CashBefore - rent);
    expect(rentPayment.snapshot.state.public.turn.phase).toBe("finish");
  });
});

const board = (page: Page) => page.getByRole("region", { name: FIELD_LABEL });

const waitForSessionCreation = (page: Page) => page.waitForResponse((response) =>
  response.url().endsWith("/api/runtime/sessions") && response.request().method() === "POST"
);

async function openBrowserSession(page: Page, sessionId: string): Promise<void> {
  await page.evaluate(
    ({ storageKey, nextSessionId }) => window.localStorage.setItem(storageKey, nextSessionId),
    { storageKey: STORAGE_KEY, nextSessionId: sessionId }
  );
  const restoredSession = page.waitForResponse((response) =>
    response.url().includes(`/api/runtime/sessions/${sessionId}`)
    && response.request().method() === "GET"
  );
  await page.reload();
  const response = await restoredSession;
  const responseText = await response.text();
  expect(
    response.status(),
    `restoring runtime session ${sessionId} returned: ${responseText}`
  ).toBe(200);
  const snapshot = JSON.parse(responseText) as RuntimeSnapshot;
  expect(snapshot.sessionId, `restored response must describe session ${sessionId}`).toBe(sessionId);
  expectPlayerSnapshotHasNoPlatformSecrets(snapshot);
  await expect(page.locator(".loading-state")).toHaveCount(0);
}

async function clickBoardAction(page: Page, label: string): Promise<BrowserActionResult> {
  const actionRequest = page.waitForRequest((request) =>
    request.url().endsWith("/api/runtime/actions") && request.method() === "POST"
  );
  const actionResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/runtime/actions") && response.request().method() === "POST"
  );

  await board(page).getByRole("button", { name: label }).click();
  const [runtimeRequest, runtimeResponse] = await Promise.all([actionRequest, actionResponse]);
  expect(runtimeResponse.status()).toBe(200);

  const snapshot = await runtimeResponse.json() as RuntimeSnapshot;
  expect(
    snapshot.receipt?.status,
    `${label} was rejected: ${snapshot.receipt?.rejectionCode ?? "unknown reason"}`
  ).toBe("applied");
  expectPlayerSnapshotHasNoPlatformSecrets(snapshot);

  return {
    requestBody: runtimeRequest.postDataJSON() as Record<string, unknown>,
    snapshot
  };
}

async function progressToFirstPlayerPurchaseOpportunity(
  request: APIRequestContext,
  initial: RuntimeSnapshot
): Promise<RuntimeSnapshot> {
  let snapshot = initial;

  for (let index = 0; index < MAX_PURCHASE_PROGRESS_ACTIONS; index += 1) {
    const turn = snapshot.state.public.turn;
    if (turn.activePlayerId === "p1" && turn.phase === "acquire") {
      return snapshot;
    }

    const availableAction = snapshot.state.public.board.availableActions[0];
    expect(
      availableAction,
      `turn ${turn.turnNumber} (${turn.activePlayerId}/${turn.phase}) needs an action`
    ).toBeDefined();
    snapshot = await postRuntimeAction(
      request,
      snapshot.sessionId,
      snapshot.version.stateVersion,
      availableAction.actionId,
      availableAction.params
    );
  }

  throw new Error(
    `p1 did not reach a purchasable estate within ${MAX_PURCHASE_PROGRESS_ACTIONS} valid runtime actions`
  );
}

async function progressToSecondPlayerRent(
  request: APIRequestContext,
  initial: RuntimeSnapshot
): Promise<RuntimeSnapshot> {
  let snapshot = initial;

  for (let index = 0; index < MAX_PROGRESS_ACTIONS; index += 1) {
    const turn = snapshot.state.public.turn;
    if (turn.activePlayerId === "p2" && turn.phase === "rent") {
      return snapshot;
    }

    const availableAction = snapshot.state.public.board.availableActions[0];
    expect(availableAction, `turn ${turn.turnNumber} (${turn.activePlayerId}/${turn.phase}) needs an action`).toBeDefined();
    snapshot = await postRuntimeAction(
      request,
      snapshot.sessionId,
      snapshot.version.stateVersion,
      availableAction.actionId,
      availableAction.params
    );
  }

  throw new Error(`p2 did not reach a p1 estate within ${MAX_PROGRESS_ACTIONS} valid runtime actions`);
}

async function postRuntimeAction(
  request: APIRequestContext,
  sessionId: string,
  expectedStateVersion: number,
  actionId: string,
  params?: Record<string, unknown>
): Promise<RuntimeSnapshot> {
  const response = await request.post("/api/runtime/actions", {
    data: {
      sessionId,
      expectedStateVersion,
      actionId,
      commandId: `cli_${randomBytes(16).toString("base64url")}`,
      params: params ?? {}
    }
  });
  expect(response.status()).toBe(200);
  const snapshot = await response.json() as RuntimeSnapshot;
  expect(
    snapshot.receipt?.status,
    `${actionId} was rejected: ${snapshot.receipt?.rejectionCode ?? "unknown reason"}`
  ).toBe("applied");
  expectPlayerSnapshotHasNoPlatformSecrets(snapshot);
  return snapshot;
}

/** The player HTTP boundary must never reveal deterministic random/deck internals. */
function expectPlayerSnapshotHasNoPlatformSecrets(snapshot: RuntimeSnapshot): void {
  expect(snapshot.state.secret?.random).toBeUndefined();
  expect(snapshot.state.secret?.decks).toBeUndefined();
}
