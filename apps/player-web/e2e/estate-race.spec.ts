/**
 * Browser acceptance for the completed Estate Race S1 slice (GSR-040).
 *
 * The browser creates one normal authenticated player session and performs one
 * production-random setup followed by one production-random roll. The
 * assertion follows the state and actions returned
 * by Runtime API; it never predicts a destination, forces dice, or invents a
 * continuation for the intentionally blocked cells. Purchase/rent and the
 * complete tax/jail route remain covered by server/package proofs until the
 * browser has a deterministic, public way to reach those states.
 */

import {
  expect,
  test,
  type Page
} from "@playwright/test";

const GAME_ID = "estate-race";
const FIELD_LABEL = "Игровое поле Estate Race";
const BOARD_PLUGIN_READY_TIMEOUT_MS = 30_000;

type EstatePhase = "setup" | "roll" | "acquire" | "rent" | "tax" | "blocked" | "finish";

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
      setupComplete: boolean;
      turn: { activePlayerId: string; order: string[]; phase: EstatePhase; turnNumber: number };
      board: {
        lastRoll?: { values: number[]; total: number; isDouble: boolean } | null;
        availableActions: Array<{
          actionId: string;
          label?: string;
          params?: Record<string, unknown>;
        }>;
      };
    };
  };
};

type BrowserActionResult = {
  requestBody: Record<string, unknown>;
  snapshot: RuntimeSnapshot;
};

test.describe("Estate Race S1", { tag: "@player" }, () => {
  test("finalizes random participant order and presents one server-owned random landing", async ({ page }) => {
    // Includes a cold two-service startup while keeping one browser-created
    // session and its HttpOnly credential for the whole acceptance path.
    test.setTimeout(120_000);

    const createSession = waitForSessionCreation(page);
    await page.goto(`/?gameId=${GAME_ID}`);
    const creationResponse = await createSession;
    expect(creationResponse.status()).toBe(201);
    const browserSession = await creationResponse.json() as RuntimeSnapshot;
    expectPlayerSnapshotHasNoPlatformSecrets(browserSession);

    await expect(page.locator(".game-player-root")).toBeVisible();
    await expect(page.locator(".loading-state")).toHaveCount(0);
    await expect(page.getByRole("heading", {
      name: "Estate Race · S1",
      level: 1
    })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Локальная партия: 2–6 участников", level: 2 })).toBeVisible();
    await expect(board(page)).toBeVisible();
    await expect(board(page).getByTestId("interactive-board-canvas-host")).toBeVisible();
    await expect(board(page).getByRole("button", { name: "Определить порядок" }))
      .toBeVisible({ timeout: BOARD_PLUGIN_READY_TIMEOUT_MS });

    const participantIds = Object.keys(browserSession.state.players);
    expect(participantIds).toHaveLength(2);
    expect(browserSession.state.public.setupComplete).toBe(false);
    expect(browserSession.state.public.turn.phase).toBe("setup");

    const setup = await clickBoardAction(page, "Определить порядок");
    expect(setup.requestBody).not.toHaveProperty("playerId");
    expect(setup.requestBody.actionId).toBe("session.setup.finalize");
    expect(setup.requestBody.commandId).toMatch(/^cli_[A-Za-z0-9_-]{22}$/u);
    expect(setup.snapshot.state.public.setupComplete).toBe(true);
    expect(setup.snapshot.state.public.turn.phase).toBe("roll");
    expect([...setup.snapshot.state.public.turn.order].sort()).toEqual([...participantIds].sort());
    expect(setup.snapshot.state.public.turn.activePlayerId)
      .toBe(setup.snapshot.state.public.turn.order[0]);

    await expect(board(page).getByRole("button", { name: "Бросить кости" })).toBeVisible();

    const roll = await clickBoardAction(page, "Бросить кости");
    const { snapshot } = roll;
    expect(roll.requestBody).not.toHaveProperty("playerId");
    expect(roll.requestBody.actionId).toBe("turn.roll");
    expect(roll.requestBody.commandId).toMatch(/^cli_[A-Za-z0-9_-]{22}$/u);
    const activePlayer = snapshot.state.players[snapshot.state.public.turn.activePlayerId];
    expect(activePlayer).toBeDefined();
    expect(snapshot.state.public.turn.activePlayerId).toBe(setup.snapshot.state.public.turn.order[0]);
    expect(snapshot.state.public.board.lastRoll?.values).toHaveLength(2);
    expect(snapshot.state.public.board.lastRoll?.total).toBeGreaterThanOrEqual(2);
    expect(snapshot.state.public.board.lastRoll?.total).toBeLessThanOrEqual(12);
    expect(activePlayer?.metrics.position).toBe(snapshot.state.public.board.lastRoll?.total);
    expect(["acquire", "tax", "blocked", "finish"]).toContain(snapshot.state.public.turn.phase);

    // The manifest binds this text to public.turn. The browser therefore
    // presents the exact phase selected by Runtime, including blocked/tax.
    await expect(page.getByText(
      new RegExp(`активен ${snapshot.state.public.turn.activePlayerId} · этап ${snapshot.state.public.turn.phase}`, "i")
    )).toBeVisible();

    const availableActionIds = snapshot.state.public.board.availableActions.map((action) => action.actionId);
    if (snapshot.state.public.turn.phase === "blocked") {
      expect(availableActionIds).toEqual([]);
      await expect(board(page).getByRole("button")).toHaveCount(0);
      return;
    }

    if (snapshot.state.public.turn.phase === "tax") {
      expect(availableActionIds).toContain("tax.pay");
      await expect(board(page).getByRole("button", { name: "Оплатить налог" })).toBeVisible();
    } else if (snapshot.state.public.turn.phase === "acquire") {
      expect(availableActionIds.some((actionId) => actionId.startsWith("property.buy."))).toBe(true);
      await expect(board(page).getByRole("button", { name: "Купить участок" })).toBeVisible();
    } else if (snapshot.state.public.turn.phase === "finish") {
      expect(availableActionIds).toContain("turn.finish");
      await expect(board(page).getByRole("button", { name: "Завершить ход" })).toBeVisible();
    }
  });
});

const board = (page: Page) => page.getByRole("region", { name: FIELD_LABEL });

const waitForSessionCreation = (page: Page) => page.waitForResponse((response) =>
  response.url().endsWith("/api/runtime/sessions") && response.request().method() === "POST"
);

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

/** The player HTTP boundary must never reveal deterministic random/deck internals. */
function expectPlayerSnapshotHasNoPlatformSecrets(snapshot: RuntimeSnapshot): void {
  expect(snapshot.state.secret?.random).toBeUndefined();
  expect(snapshot.state.secret?.decks).toBeUndefined();
}
