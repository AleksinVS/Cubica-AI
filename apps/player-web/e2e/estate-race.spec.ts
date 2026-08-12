/**
 * Browser acceptance for the Estate Race S0–S7 display and bounded action
 * slices (GSR-034, GSR-041–046).
 *
 * The browser creates one normal authenticated player session and performs one
 * production-random setup followed by one production-random roll. The
 * assertion follows the state and actions returned by Runtime API; it never
 * predicts a destination, forces dice, or derives card/jail state in the
 * client. If production randomness lands on a free object, the normal DOM flow
 * still covers decline → bid → pass. Isolated previews prove the S4 card and
 * building parameter paths plus S5 trade, obligation and bankruptcy paths.
 * The card preview still covers every possible production dice result.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import {
  expect,
  test,
  type Page
} from "@playwright/test";

const GAME_ID = "estate-race";
const FIELD_LABEL = "Игровое поле Estate Race";
const BOARD_PLUGIN_READY_TIMEOUT_MS = 30_000;
const RUNTIME_URL = process.env.E2E_RUNTIME_URL ?? "http://127.0.0.1:3201";
const REPO_ROOT = process.cwd();
const SOURCE_GAME_ROOT = path.join(REPO_ROOT, "games", GAME_ID);
const PREVIEW_ROOT = path.join(REPO_ROOT, ".tmp", "editor-worktrees");
const TECHNICAL_CARD_ID = "event-credit";
const TECHNICAL_CARD_CREDIT = 90;

type EstatePhase =
  | "setup"
  | "roll"
  | "acquire"
  | "rent"
  | "tax"
  | "blocked"
  | "finish"
  | "auction"
  | "jail"
  | "tradeDraft"
  | "tradeResponse"
  | "tradeClaim"
  | "obligation"
  | "liquidationMortgage"
  | "liquidationClaim";

type JsonRecord = Record<string, unknown>;

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
    players: Record<string, {
      metrics: { cash: number; position: number };
      status?: string;
    }>;
    secret?: {
      random?: unknown;
      decks?: unknown;
      [key: string]: unknown;
    };
    public: {
      setupComplete: boolean;
      outcome?: {
        status: "active" | "terminal";
        winnerPlayerId: string | null;
        reason: "none" | "last-active-player";
      };
      turn: { activePlayerId: string; order: string[]; phase: EstatePhase; turnNumber: number };
      board: {
        lastRoll?: { values: number[]; total: number; isDouble: boolean } | null;
        lastCardId?: string;
        availableActions: Array<{
          actionId: string;
          label?: string;
          params?: Record<string, unknown>;
          disabled?: boolean;
        }>;
      };
      bankBuildings: {
        housesAvailable: number;
        hotelsAvailable: number;
      };
      trade?: {
        status: string;
        proposerPlayerId?: string;
        targetPlayerId?: string;
        offeredCash?: number;
        requestedCash?: number;
      };
      obligation?: {
        status: string;
        amount?: number;
        creditorKind?: string;
        creditorPlayerId?: string;
      };
      liquidation?: {
        status: string;
        creditorPlayerId?: string;
        pendingCellId?: string;
      };
      objects?: Record<string, unknown>;
      auction: {
        resumePlayerId: string;
        cellId: string;
        currentBid: number;
        minimumIncrement: number;
        leaderPlayerId: string;
      };
    };
  };
};

type BrowserActionResult = {
  requestBody: Record<string, unknown>;
  snapshot: RuntimeSnapshot;
};

interface PublishedPluginBundle {
  readonly pluginId: string;
  readonly gameId: string;
  readonly apiVersion: string;
  readonly target: "player-web";
  readonly scope: "published";
  readonly contentHash: string;
  readonly filePath: string;
}

interface PreviewSource {
  readonly contentRoot: string;
  readonly contentSourceId: string;
  readonly pluginBundles: readonly [{
    readonly pluginId: string;
    readonly gameId: string;
    readonly apiVersion: string;
    readonly target: "player-web";
    readonly scope: "preview";
    readonly contentHash: string;
    readonly filePath: string;
  }];
}

const temporaryRoots = new Set<string>();

test.afterAll(() => {
  for (const root of temporaryRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

test.describe("Estate Race S0–S7", { tag: "@player" }, () => {
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
    await expectEstateRaceS7Surface(page);
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
    if (snapshot.state.public.board.lastCardId) {
      await page.getByRole("button", { name: "Открыть панель «Контекст»" }).click();
      const contextPanel = page.locator('[data-workspace-slot="context-panel"]');
      await expect(contextPanel.getByText(
        `Последняя открытая карта: ${snapshot.state.public.board.lastCardId}`
      )).toBeVisible();
      await page.getByRole("button", { name: "Закрыть панель «Контекст»" }).click();
    } else {
      // With no card effect, the first move starts at zero and ends on the
      // authoritative dice total. Card movement deliberately owns its own
      // server-side destination and is not inferred here.
      expect(activePlayer?.metrics.position).toBe(snapshot.state.public.board.lastRoll?.total);
    }
    expect(["acquire", "tax", "finish", "jail"]).toContain(snapshot.state.public.turn.phase);

    // The manifest binds this text to public.turn, so card, tax and jail
    // continuations remain exactly the phase selected by Runtime.
    await expect(page.getByText(new RegExp(
      `^Ход \\d+ · участник ${snapshot.state.public.turn.activePlayerId} · ${snapshot.state.public.turn.phase}$`,
      "i"
    ))).toBeVisible();

    const availableActionIds = snapshot.state.public.board.availableActions.map((action) => action.actionId);

    // Use only the normal server-declared actions when randomness happens to
    // land on an unowned object. No dice or eligibility state is forced here.
    if (
      snapshot.state.public.turn.phase === "acquire"
      && availableActionIds.includes("property.decline")
    ) {
      const decline = await clickBoardAction(page, "Отказаться");
      expect(decline.requestBody.params).toEqual({});
      expect(decline.snapshot.state.public.turn.phase).toBe("auction");
      expect(decline.snapshot.state.public.auction.cellId).not.toBe("");
      expect(decline.snapshot.state.public.auction.resumePlayerId).toBe(
        snapshot.state.public.turn.activePlayerId
      );
      expect(decline.snapshot.state.public.auction.currentBid).toBe(0);
      expect(decline.snapshot.state.public.auction.minimumIncrement).toBeGreaterThan(0);
      expect(decline.snapshot.state.public.board.availableActions.map((action) => action.actionId))
        .toEqual(expect.arrayContaining(["property.auction.bid", "property.auction.pass"]));

      // At the zero-bid start the authoritatively published increment is the
      // only amount supplied by this bounded smoke path.
      const bid = await submitAuctionBid(page, decline.snapshot.state.public.auction.minimumIncrement);
      expect(bid.requestBody.params).toEqual({
        amount: decline.snapshot.state.public.auction.minimumIncrement
      });
      expect(bid.snapshot.state.public.turn.phase).toBe("auction");
      expect(bid.snapshot.state.public.auction.currentBid).toBe(
        decline.snapshot.state.public.auction.minimumIncrement
      );
      expect(bid.snapshot.state.public.auction.leaderPlayerId).not.toBe("");

      const pass = await clickBoardAction(page, "Пас");
      expect(pass.requestBody.params).toEqual({});
      expect(pass.snapshot.state.public.turn.phase).toBe("finish");
      expect(pass.snapshot.state.public.auction).toEqual({
        resumePlayerId: "",
        cellId: "",
        currentBid: 0,
        minimumIncrement: decline.snapshot.state.public.auction.minimumIncrement,
        leaderPlayerId: ""
      });
      return;
    }

    if (snapshot.state.public.turn.phase === "tax") {
      expect(availableActionIds).toContain("tax.pay");
      await expect(board(page).getByRole("button", { name: "Оплатить налог" })).toBeVisible();
    } else if (snapshot.state.public.turn.phase === "jail") {
      expect(availableActionIds).toEqual(expect.arrayContaining(["jail.pay", "jail.roll"]));
      await expect(board(page).getByRole("button", { name: "Оплатить освобождение" })).toBeVisible();
      await expect(board(page).getByRole("button", { name: "Попытаться выбросить дубль" })).toBeVisible();
    } else if (snapshot.state.public.turn.phase === "acquire") {
      expect(availableActionIds).toContain("property.buy");
      await expect(board(page).getByRole("button", { name: "Купить объект" })).toBeVisible();
    } else if (snapshot.state.public.turn.phase === "finish") {
      expect(availableActionIds).toContain("turn.finish");
      await expect(board(page).getByRole("button", { name: "Завершить ход" })).toBeVisible();
    }
  });

  test("draws and resolves one exact technical card through the isolated preview boundary", async ({ page }) => {
    test.setTimeout(120_000);
    const source = materializeTechnicalCardPreview();
    const initial = await openPreviewSession(page, source);
    expectPlayerSnapshotHasNoPlatformSecrets(initial);

    const participantIds = Object.keys(initial.state.players);
    const setup = await clickBoardAction(page, "Определить порядок");
    expect(setup.requestBody).toMatchObject({
      actionId: "session.setup.finalize",
      params: {}
    });
    expect(setup.requestBody).not.toHaveProperty("playerId");
    expect(setup.snapshot.state.public.turn.phase).toBe("roll");
    expect([...setup.snapshot.state.public.turn.order].sort()).toEqual([...participantIds].sort());
    expect(setup.snapshot.state.public.board.availableActions.map((action) => action.actionId))
      .toContain("turn.roll");

    const actorId = setup.snapshot.state.public.turn.activePlayerId;
    const cashBefore = setup.snapshot.state.players[actorId]?.metrics.cash;
    expect(cashBefore).toBeDefined();
    const roll = await clickBoardAction(page, "Бросить кости");

    expect(roll.requestBody).toMatchObject({ actionId: "turn.roll", params: {} });
    expect(roll.requestBody).not.toHaveProperty("playerId");
    expect(JSON.stringify(roll.requestBody)).not.toMatch(/random|deck|cardId|credential/iu);
    expect(roll.snapshot.state.public.board.lastRoll?.total).toBeGreaterThanOrEqual(2);
    expect(roll.snapshot.state.public.board.lastRoll?.total).toBeLessThanOrEqual(12);
    expect(roll.snapshot.state.public.board.lastCardId).toBe(TECHNICAL_CARD_ID);
    expect(roll.snapshot.state.players[actorId]?.metrics.position)
      .toBe(roll.snapshot.state.public.board.lastRoll?.total);
    expect(roll.snapshot.state.players[actorId]?.metrics.cash).toBe(
      (cashBefore as number) + TECHNICAL_CARD_CREDIT
    );
    expect(roll.snapshot.state.public.turn.phase).toBe("finish");
    expect(roll.snapshot.state.public.board.availableActions).toEqual([
      expect.objectContaining({ actionId: "trade.open", label: "Предложить сделку" }),
      expect.objectContaining({ actionId: "turn.finish", label: "Завершить ход" })
    ]);
    expectPlayerSnapshotHasNoPlatformSecrets(roll.snapshot);

    await page.getByRole("button", { name: "Открыть панель «Контекст»" }).click();
    const contextPanel = page.locator('[data-workspace-slot="context-panel"]');
    await expect(contextPanel.getByText(`Последняя открытая карта: ${TECHNICAL_CARD_ID}`)).toBeVisible();
    await page.getByRole("button", { name: "Закрыть панель «Контекст»" }).click();
    await expect(board(page).getByRole("button", { name: "Завершить ход" })).toBeVisible();
  });

  test("submits building window and shortage auction parameters through DOM forms", async ({ page }) => {
    test.setTimeout(120_000);
    const source = materializeBuildingActionsPreview();
    const initial = await openPreviewSession(page, source, "Открыть окно застройки");
    expectPlayerSnapshotHasNoPlatformSecrets(initial);

    const opened = await submitBoardFormAction(page, "Открыть окно застройки", "Тип строения", "house");
    expect(opened.requestBody).toMatchObject({
      actionId: "property.build",
      params: { unitKind: "house" }
    });
    expect(opened.snapshot.state.public.turn.phase).toBe("buildingWindow");

    const requested = await submitBoardFormAction(
      page,
      "Подать заявку",
      "Идентификатор участка",
      "cell-05"
    );
    expect(requested.requestBody).toMatchObject({
      actionId: "property.build.request",
      params: { cellId: "cell-05" }
    });
    expect(requested.snapshot.state.public.turn.phase).toBe("buildingAuction");
    expect(requested.snapshot.state.public.board.availableActions.map((action) => action.actionId))
      .toEqual(expect.arrayContaining([
        "property.build.auction.bid",
        "property.build.auction.pass"
      ]));

    const bid = await submitBoardFormAction(page, "Сделать ставку", "Сумма ставки", "10");
    expect(bid.requestBody).toMatchObject({
      actionId: "property.build.auction.bid",
      params: { amount: 10 }
    });
    expect(bid.snapshot.state.public.turn.phase).toBe("buildingAuction");

    const pass = await clickBoardAction(page, "Пас");
    expect(pass.requestBody).toMatchObject({
      actionId: "property.build.auction.pass",
      params: {}
    });
    expect(pass.snapshot.state.public.turn.phase).toBe("finish");
  });

  test("submits sell and mortgage/redeem cell parameters through DOM forms", async ({ page }) => {
    test.setTimeout(120_000);
    const source = materializeSellMortgagePreview();
    const initial = await openPreviewSession(page, source, "Продать строение");
    const sellCellBefore = readEstateCell(initial, "cell-01");
    const mortgageCellBefore = readEstateCell(initial, "cell-11");
    const cashBeforeSell = initial.state.players.p1?.metrics.cash;
    expect(cashBeforeSell).toBeDefined();
    expect(sellCellBefore.improvementTier).toBe(1);
    expect(sellCellBefore.mortgaged).toBe(false);
    expect(mortgageCellBefore.improvementTier).toBe(0);
    expect(mortgageCellBefore.mortgaged).toBe(false);

    const sold = await submitBoardFormAction(
      page,
      "Продать строение",
      "Идентификатор участка",
      "cell-01"
    );
    expect(sold.requestBody).toMatchObject({
      actionId: "property.sell",
      params: { cellId: "cell-01" }
    });
    expect(readEstateCell(sold.snapshot, "cell-01").improvementTier)
      .toBe(Number(sellCellBefore.improvementTier) - 1);
    expect(sold.snapshot.state.players.p1?.metrics.cash)
      .toBe((cashBeforeSell as number) + Number(sellCellBefore.sellValue));
    expect(sold.snapshot.state.public.bankBuildings.housesAvailable)
      .toBe(initial.state.public.bankBuildings.housesAvailable + 1);
    expect(sold.snapshot.state.public.bankBuildings.hotelsAvailable)
      .toBe(initial.state.public.bankBuildings.hotelsAvailable);

    const cashBeforeMortgage = sold.snapshot.state.players.p1?.metrics.cash;
    const mortgaged = await submitBoardFormAction(
      page,
      "Заложить объект",
      "Идентификатор участка",
      "cell-11"
    );
    expect(mortgaged.requestBody).toMatchObject({
      actionId: "property.mortgage",
      params: { cellId: "cell-11" }
    });
    expect(readEstateCell(mortgaged.snapshot, "cell-11").mortgaged).toBe(true);
    expect(mortgaged.snapshot.state.players.p1?.metrics.cash)
      .toBe((cashBeforeMortgage as number) + Number(mortgageCellBefore.mortgageValue));
    expect(mortgaged.snapshot.state.public.bankBuildings)
      .toEqual(sold.snapshot.state.public.bankBuildings);

    const cashBeforeRedeem = mortgaged.snapshot.state.players.p1?.metrics.cash;
    const redeemed = await submitBoardFormAction(
      page,
      "Выкупить объект",
      "Идентификатор участка",
      "cell-11"
    );
    expect(redeemed.requestBody).toMatchObject({
      actionId: "property.redeem",
      params: { cellId: "cell-11" }
    });
    expect(readEstateCell(redeemed.snapshot, "cell-11").mortgaged).toBe(false);
    expect(redeemed.snapshot.state.players.p1?.metrics.cash)
      .toBe((cashBeforeRedeem as number) - Number(mortgageCellBefore.redeemCost));
    expect(redeemed.snapshot.state.public.bankBuildings)
      .toEqual(sold.snapshot.state.public.bankBuildings);
  });

  test("accepts a declared cash trade through the production DOM form", async ({ page }) => {
    test.setTimeout(120_000);
    const source = materializeTradePreview();
    const initial = await openPreviewSession(page, source, "Предложить сделку");
    const p1CashBefore = initial.state.players.p1?.metrics.cash;
    const p2CashBefore = initial.state.players.p2?.metrics.cash;
    expect(p1CashBefore).toBeDefined();
    expect(p2CashBefore).toBeDefined();

    const opened = await submitBoardFormFields(page, "Предложить сделку", {
      targetPlayerId: "p2"
    });
    expect(opened.requestBody).toMatchObject({
      actionId: "trade.open",
      params: { targetPlayerId: "p2" }
    });
    expect(opened.snapshot.state.public.turn.phase).toBe("tradeDraft");

    const cashSet = await submitBoardFormFields(page, "Указать деньги", {
      offeredCash: "100",
      requestedCash: "50"
    }, {
      offeredCash: "Предлагаемые деньги",
      requestedCash: "Запрашиваемые деньги"
    });
    expect(cashSet.requestBody).toMatchObject({
      actionId: "trade.cash.set",
      params: { offeredCash: 100, requestedCash: 50 }
    });

    const proposed = await clickBoardAction(page, "Передать предложение");
    expect(proposed.requestBody).toMatchObject({ actionId: "trade.propose", params: {} });
    expect(proposed.snapshot.state.public.turn.phase).toBe("tradeResponse");
    expect(proposed.snapshot.state.public.trade?.status).toBe("response");

    const accepted = await clickBoardAction(page, "Принять сделку");
    expect(accepted.requestBody).toMatchObject({ actionId: "trade.accept", params: {} });
    expect(accepted.snapshot.state.players.p1?.metrics.cash)
      .toBe((p1CashBefore as number) - 50);
    expect(accepted.snapshot.state.players.p2?.metrics.cash)
      .toBe((p2CashBefore as number) + 50);
    expect(accepted.snapshot.state.public.trade?.status).toBe("idle");
    expect(accepted.snapshot.state.public.turn.phase).toBe("finish");
  });

  test("resolves a mandatory obligation after a legal mortgage through DOM actions", async ({ page }) => {
    test.setTimeout(120_000);
    const source = materializeObligationPreview();
    const initial = await openPreviewSession(page, source, "Оплатить налог");
    const cashBefore = initial.state.players.p1?.metrics.cash;
    expect(cashBefore).toBe(30);
    const cellBefore = readEstateCell(initial, "cell-01");
    expect(cellBefore.mortgaged).toBe(false);

    const started = await clickBoardAction(page, "Оплатить налог");
    expect(started.requestBody).toMatchObject({ actionId: "tax.pay", params: {} });
    expect(started.snapshot.state.public.turn.phase).toBe("obligation");
    expect(started.snapshot.state.public.obligation?.status).toBe("active");
    expect(started.snapshot.state.public.obligation?.amount).toBe(70);

    const mortgaged = await submitBoardFormFields(page, "Заложить объект", {
      cellId: "cell-01"
    });
    expect(mortgaged.requestBody).toMatchObject({
      actionId: "property.mortgage",
      params: { cellId: "cell-01" }
    });
    expect(readEstateCell(mortgaged.snapshot, "cell-01").mortgaged).toBe(true);
    expect(mortgaged.snapshot.state.players.p1?.metrics.cash).toBe(75);

    const resolved = await clickBoardAction(page, "Погасить обязательство");
    expect(resolved.requestBody).toMatchObject({ actionId: "obligation.resolve", params: {} });
    expect(resolved.snapshot.state.players.p1?.metrics.cash).toBe(5);
    expect(resolved.snapshot.state.public.obligation?.status).toBe("idle");
    expect(resolved.snapshot.state.public.turn.phase).toBe("finish");
  });

  test("routes player and bank bankruptcy through creditor transfer and bank auction DOM paths", async ({ page }) => {
    test.setTimeout(180_000);

    const creditorSource = materializeCreditorBankruptcyPreview();
    const creditorInitial = await openPreviewSession(page, creditorSource, "Оплатить ренту");
    expect(creditorInitial.state.players.p1?.metrics.cash).toBe(1200);
    const rent = await clickBoardAction(page, "Оплатить ренту");
    expect(rent.requestBody).toMatchObject({ actionId: "property.rent", params: {} });
    expect(rent.snapshot.state.public.turn.phase).toBe("obligation");

    const declaredToCreditor = await submitBoardFormFields(page, "Объявить банкротство", {
      heldCardId: "",
      heldCardId2: ""
    });
    expect(declaredToCreditor.requestBody).toMatchObject({
      actionId: "bankruptcy.declare",
      params: { heldCardId: "", heldCardId2: "" }
    });
    expect(declaredToCreditor.snapshot.state.players.p1?.status).toBe("eliminated");
    expect(declaredToCreditor.snapshot.state.public.turn.phase).toBe("liquidationMortgage");
    expect(declaredToCreditor.snapshot.state.public.liquidation?.creditorPlayerId).toBe("p2");
    expect(declaredToCreditor.snapshot.state.public.liquidation?.pendingCellId).toBe("cell-05");

    const keptMortgage = await clickBoardAction(page, "Сохранить залог");
    expect(keptMortgage.requestBody).toMatchObject({
      actionId: "mortgage.transfer.keep",
      params: {}
    });
    expect(readEstateCell(keptMortgage.snapshot, "cell-05").mortgaged).toBe(true);
    expect(keptMortgage.snapshot.state.public.turn.phase).toBe("terminal");
    expect(keptMortgage.snapshot.state.public.outcome).toEqual({
      status: "terminal",
      winnerPlayerId: "p2",
      reason: "last-active-player"
    });

    const bankSource = materializeBankBankruptcyPreview();
    const bankInitial = await openPreviewSession(page, bankSource, "Оплатить налог");
    expect(bankInitial.state.players.p1?.metrics.cash).toBe(0);
    const bankTax = await clickBoardAction(page, "Оплатить налог");
    expect(bankTax.requestBody).toMatchObject({ actionId: "tax.pay", params: {} });

    const declaredToBank = await submitBoardFormFields(page, "Объявить банкротство", {
      heldCardId: "",
      heldCardId2: ""
    });
    expect(declaredToBank.requestBody).toMatchObject({
      actionId: "bankruptcy.declare",
      params: { heldCardId: "", heldCardId2: "" }
    });
    expect(declaredToBank.snapshot.state.players.p1?.status).toBe("eliminated");
    expect(readEstateCell(declaredToBank.snapshot, "cell-01").liquidationPending).toBe(true);
    expect(declaredToBank.snapshot.state.public.turn.phase).toBe("auction");

    const firstPass = await clickBoardAction(page, "Пас");
    expect(firstPass.requestBody).toMatchObject({ actionId: "property.auction.pass", params: {} });
    const secondPass = await clickBoardAction(page, "Пас");
    expect(secondPass.requestBody).toMatchObject({ actionId: "property.auction.pass", params: {} });
    expect(readEstateCell(secondPass.snapshot, "cell-01").ownerPlayerId).toBeNull();
    expect(readEstateCell(secondPass.snapshot, "cell-01").liquidationPending).toBe(false);
    expect(secondPass.snapshot.state.public.liquidation?.status).toBe("idle");
    expect(secondPass.snapshot.state.public.turn.phase).toBe("finish");

    const skipped = await clickBoardAction(page, "Завершить ход");
    expect(skipped.requestBody).toMatchObject({ actionId: "turn.finish", params: {} });
    expect(skipped.snapshot.state.public.turn.activePlayerId).toBe("p3");
  });

  test("finishes a coherent two-player bankruptcy through DOM liquidation and shows the server winner", async ({ page }) => {
    test.setTimeout(120_000);

    const source = materializeCreditorBankruptcyPreview();
    const initial = await openPreviewSession(page, source, "Оплатить ренту");
    expect(Object.keys(initial.state.players)).toEqual(["p1", "p2"]);
    expect(Object.values(initial.state.players).every((player) => player.status === "active")).toBe(true);
    expect(initial.state.public.outcome).toEqual({
      status: "active",
      winnerPlayerId: null,
      reason: "none"
    });

    const rent = await clickBoardAction(page, "Оплатить ренту");
    expect(rent.requestBody).toMatchObject({ actionId: "property.rent", params: {} });
    expect(rent.snapshot.state.public.turn.phase).toBe("obligation");

    const declared = await submitBoardFormFields(page, "Объявить банкротство", {
      heldCardId: "",
      heldCardId2: ""
    });
    expect(declared.requestBody).toMatchObject({
      actionId: "bankruptcy.declare",
      params: { heldCardId: "", heldCardId2: "" }
    });
    expect(declared.snapshot.state.players.p1?.status).toBe("eliminated");
    expect(declared.snapshot.state.public.turn.phase).toBe("liquidationMortgage");
    await expect(board(page).getByRole("button", { name: "Сохранить залог" })).toBeVisible();

    const terminal = await clickBoardAction(page, "Сохранить залог");
    expect(terminal.requestBody).toMatchObject({ actionId: "mortgage.transfer.keep", params: {} });
    expect(terminal.snapshot.state.public.outcome).toEqual({
      status: "terminal",
      winnerPlayerId: "p2",
      reason: "last-active-player"
    });
    expect(terminal.snapshot.state.public.turn.phase).toBe("terminal");
    expect(terminal.snapshot.state.public.board.availableActions).toEqual([]);
    await page.getByRole("button", { name: "Открыть панель «Контекст»" }).click();
    const contextPanel = page.locator('[data-workspace-slot="context-panel"]');
    await expect(contextPanel.getByText(
      /Подтверждённый итог:\s+победитель p2 · last-active-player/u
    )).toBeVisible();

    // The UI presents the exact server-owned winner; DOM controls remain the
    // accessible action surface and must be empty after terminal state.
    await expect(board(page).getByText("Сейчас нет доступных действий на поле.")).toBeVisible();
    await expect(board(page).getByRole("button", { name: "Сохранить залог" })).toHaveCount(0);
  });
});

/**
 * Materialize a nonpublishable preview copy without changing Estate Race.
 *
 * Every possible first 2d6 destination is an event cell in this isolated
 * source and its event collection contains one existing technical card. The
 * production setup still creates and shuffles the protected deck, while the
 * production turn plan still rolls, draws, applies and finishes normally.
 */
function materializeTechnicalCardPreview(): PreviewSource {
  const sourceManifest = readJson<JsonRecord>(path.join(SOURCE_GAME_ROOT, "game.manifest.json"));
  const previewManifest = structuredClone(sourceManifest);
  const state = requireRecord(previewManifest.state, "preview.state");
  const publicState = requireRecord(state.public, "preview.state.public");
  const objects = requireRecord(publicState.objects, "preview.state.public.objects");
  const boardCells = requireRecord(objects.boardCells, "preview.state.public.objects.boardCells");
  const eventCards = requireRecord(objects.eventCards, "preview.state.public.objects.eventCards");
  const technicalCard = requireRecord(eventCards[TECHNICAL_CARD_ID], `eventCards.${TECHNICAL_CARD_ID}`);
  const technicalAttributes = requireRecord(
    technicalCard.attributes,
    `eventCards.${TECHNICAL_CARD_ID}.attributes`
  );
  if (
    technicalAttributes.effectKind !== "bank-credit" ||
    technicalAttributes.amount !== TECHNICAL_CARD_CREDIT ||
    technicalAttributes.label !== "Городская премия"
  ) {
    throw new Error("Estate Race technical preview requires the original bank-credit event card.");
  }

  // This source exists only under .tmp and is deleted by afterAll. It is not a
  // persistent fixture or publishable source of Estate Race content.
  objects.eventCards = { [TECHNICAL_CARD_ID]: structuredClone(technicalCard) };
  const preparedDestinations = new Set<number>();
  for (const value of Object.values(boardCells)) {
    const cell = requireRecord(value, "preview board cell");
    const facets = requireRecord(cell.facets, "preview board cell facets");
    const attributes = requireRecord(cell.attributes, "preview board cell attributes");
    if (
      typeof attributes.index === "number" &&
      attributes.index >= 2 &&
      attributes.index <= 12
    ) {
      facets.category = "event";
      attributes.kind = "event";
      preparedDestinations.add(attributes.index);
    }
  }
  expect([...preparedDestinations].sort((left, right) => left - right))
    .toEqual(Array.from({ length: 11 }, (_, index) => index + 2));

  const pluginMetadata = readJson<{ readonly bundles: readonly PublishedPluginBundle[] }>(
    path.join(SOURCE_GAME_ROOT, "published", "player-web-plugin-bundles.json")
  );
  const publishedBundle = pluginMetadata.bundles.find((candidate) =>
    candidate.gameId === GAME_ID &&
    candidate.target === "player-web" &&
    candidate.scope === "published"
  );
  if (!publishedBundle) {
    throw new Error("Published Estate Race player plugin bundle was not found.");
  }
  const sourceBundlePath = path.join(SOURCE_GAME_ROOT, publishedBundle.filePath);
  const sourceBytes = readFileSync(sourceBundlePath);
  const actualHash = createHash("sha256").update(sourceBytes).digest("hex");
  if (actualHash !== publishedBundle.contentHash) {
    throw new Error("Published Estate Race player plugin bundle is stale.");
  }

  const contentSourceId = `estate-s3-card-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const contentRoot = path.join(PREVIEW_ROOT, contentSourceId);
  const targetGameRoot = path.join(contentRoot, "games", GAME_ID);
  const targetUiRoot = path.join(targetGameRoot, "ui", "web");
  const targetBundleRoot = path.join(contentRoot, "preview-plugin-bundles");
  mkdirSync(targetUiRoot, { recursive: true });
  mkdirSync(targetBundleRoot, { recursive: true });
  temporaryRoots.add(contentRoot);

  writeFileSync(
    path.join(targetGameRoot, "game.manifest.json"),
    `${JSON.stringify(previewManifest, null, 2)}\n`,
    "utf8"
  );
  copyFileSync(
    path.join(SOURCE_GAME_ROOT, "ui", "web", "ui.manifest.json"),
    path.join(targetUiRoot, "ui.manifest.json")
  );
  const targetBundlePath = path.join(
    targetBundleRoot,
    `${publishedBundle.pluginId}.${publishedBundle.contentHash}.mjs`
  );
  copyFileSync(sourceBundlePath, targetBundlePath);

  return {
    contentRoot,
    contentSourceId,
    pluginBundles: [{
      pluginId: publishedBundle.pluginId,
      gameId: publishedBundle.gameId,
      apiVersion: publishedBundle.apiVersion,
      target: "player-web",
      scope: "preview",
      contentHash: publishedBundle.contentHash,
      filePath: toPosixPath(path.relative(contentRoot, targetBundlePath))
    }]
  };
}

/**
 * Materialize a deterministic S4 building preview without changing the game
 * package. Two complete owned groups let the normal mechanics plans open a
 * building window and accept a second actor's request; one available house
 * then makes the next step a shortage auction.
 */
function materializeBuildingActionsPreview(): PreviewSource {
  const sourceManifest = readJson<JsonRecord>(path.join(SOURCE_GAME_ROOT, "game.manifest.json"));
  const previewManifest = structuredClone(sourceManifest);
  const config = requireRecord(previewManifest.config, "preview.config");
  const turnModel = requireRecord(config.turnModel, "preview.config.turnModel");
  const phases = Array.isArray(turnModel.phases) ? turnModel.phases : [];
  turnModel.phases = ["finish", ...phases.filter((phase) => phase !== "finish")];

  const state = requireRecord(previewManifest.state, "preview.state");
  const publicState = requireRecord(state.public, "preview.state.public");
  publicState.setupComplete = true;
  publicState.bankBuildings = { housesAvailable: 1, hotelsAvailable: 12 };
  const board = requireRecord(publicState.board, "preview.state.public.board");
  board.availableActions = [{
    id: "building-open",
    label: "Открыть окно застройки",
    actionId: "property.build"
  }];

  const objects = requireRecord(publicState.objects, "preview.state.public.objects");
  const boardCells = requireRecord(objects.boardCells, "preview.state.public.objects.boardCells");
  for (const [cellId, ownerPlayerId] of [
    ["cell-01", "p1"], ["cell-02", "p1"],
    ["cell-05", "p2"], ["cell-08", "p2"], ["cell-09", "p2"]
  ] as const) {
    const cell = requireRecord(boardCells[cellId], `preview board cell ${cellId}`);
    const attributes = requireRecord(cell.attributes, `preview board cell ${cellId}.attributes`);
    attributes.ownerPlayerId = ownerPlayerId;
    attributes.improvementTier = 0;
    attributes.mortgaged = false;
  }
  // Keep the physical S4 inventory coherent: the three groups below deploy
  // 12 + 12 + 7 houses, leaving exactly one of the declared 32 in the bank.
  for (const [cellId, ownerPlayerId, tier] of [
    ["cell-11", "p1", 4], ["cell-13", "p1", 4], ["cell-14", "p1", 4],
    ["cell-16", "p1", 4], ["cell-18", "p1", 4], ["cell-19", "p1", 4],
    ["cell-21", "p1", 2], ["cell-23", "p1", 2], ["cell-24", "p1", 3]
  ] as const) {
    const cell = requireRecord(boardCells[cellId], `preview board cell ${cellId}`);
    const attributes = requireRecord(cell.attributes, `preview board cell ${cellId}.attributes`);
    attributes.ownerPlayerId = ownerPlayerId;
    attributes.improvementTier = tier;
    attributes.mortgaged = false;
  }

  return materializePreviewSource(previewManifest, "estate-s4-buildings");
}

/** Materialize a coherent one-house sale plus mortgage/redeem DOM preview. */
function materializeSellMortgagePreview(): PreviewSource {
  const sourceManifest = readJson<JsonRecord>(path.join(SOURCE_GAME_ROOT, "game.manifest.json"));
  const previewManifest = structuredClone(sourceManifest);
  const config = requireRecord(previewManifest.config, "preview.config");
  const turnModel = requireRecord(config.turnModel, "preview.config.turnModel");
  const phases = Array.isArray(turnModel.phases) ? turnModel.phases : [];
  turnModel.phases = ["finish", ...phases.filter((phase) => phase !== "finish")];

  const state = requireRecord(previewManifest.state, "preview.state");
  const publicState = requireRecord(state.public, "preview.state.public");
  publicState.setupComplete = true;
  publicState.bankBuildings = { housesAvailable: 30, hotelsAvailable: 12 };
  const board = requireRecord(publicState.board, "preview.state.public.board");
  board.availableActions = [
    { id: "building-sell", label: "Продать строение", actionId: "property.sell" },
    { id: "property-mortgage", label: "Заложить объект", actionId: "property.mortgage" },
    { id: "property-redeem", label: "Выкупить объект", actionId: "property.redeem" }
  ];

  const objects = requireRecord(publicState.objects, "preview.state.public.objects");
  const boardCells = requireRecord(objects.boardCells, "preview.state.public.objects.boardCells");
  for (const [cellId, tier, ownerPlayerId] of [
    ["cell-01", 1, "p1"],
    ["cell-02", 1, "p1"],
    ["cell-11", 0, "p1"]
  ] as const) {
    const cell = requireRecord(boardCells[cellId], `preview board cell ${cellId}`);
    const attributes = requireRecord(cell.attributes, `preview board cell ${cellId}.attributes`);
    attributes.ownerPlayerId = ownerPlayerId;
    attributes.improvementTier = tier;
    attributes.mortgaged = false;
    if (tier === 1) attributes.rent = attributes.rent1;
  }

  return materializePreviewSource(previewManifest, "estate-s4-sell-redeem");
}

/** Materialize a cash-only S5 trade so the browser asserts atomic balances. */
function materializeTradePreview(): PreviewSource {
  const sourceManifest = readJson<JsonRecord>(path.join(SOURCE_GAME_ROOT, "game.manifest.json"));
  const previewManifest = structuredClone(sourceManifest);
  const config = requireRecord(previewManifest.config, "preview.config");
  const turnModel = requireRecord(config.turnModel, "preview.config.turnModel");
  const phases = Array.isArray(turnModel.phases) ? turnModel.phases : [];
  turnModel.phases = ["finish", ...phases.filter((phase) => phase !== "finish")];
  const state = requireRecord(previewManifest.state, "preview.state");
  const playersTemplate = requireRecord(state.playersTemplate, "preview.state.playersTemplate");
  const metrics = requireRecord(playersTemplate.metrics, "preview.state.playersTemplate.metrics");
  metrics.cash = 1000;
  const publicState = requireRecord(state.public, "preview.state.public");
  publicState.setupComplete = true;
  const board = requireRecord(publicState.board, "preview.state.public.board");
  board.availableActions = [{
    id: "trade-open",
    label: "Предложить сделку",
    actionId: "trade.open"
  }];
  return materializePreviewSource(previewManifest, "estate-s5-trade");
}

/** Materialize the low-cash tax branch used to exercise legal mortgage liquidity. */
function materializeObligationPreview(): PreviewSource {
  const sourceManifest = readJson<JsonRecord>(path.join(SOURCE_GAME_ROOT, "game.manifest.json"));
  const previewManifest = structuredClone(sourceManifest);
  const config = requireRecord(previewManifest.config, "preview.config");
  const turnModel = requireRecord(config.turnModel, "preview.config.turnModel");
  const phases = Array.isArray(turnModel.phases) ? turnModel.phases : [];
  turnModel.phases = ["tax", ...phases.filter((phase) => phase !== "tax")];
  const state = requireRecord(previewManifest.state, "preview.state");
  const playersTemplate = requireRecord(state.playersTemplate, "preview.state.playersTemplate");
  const metrics = requireRecord(playersTemplate.metrics, "preview.state.playersTemplate.metrics");
  metrics.cash = 30;
  metrics.position = 4;
  const publicState = requireRecord(state.public, "preview.state.public");
  publicState.setupComplete = true;
  const board = requireRecord(publicState.board, "preview.state.public.board");
  board.availableActions = [{
    id: "pay-tax",
    label: "Оплатить налог",
    actionId: "tax.pay"
  }];
  const objects = requireRecord(publicState.objects, "preview.state.public.objects");
  const boardCells = requireRecord(objects.boardCells, "preview.state.public.objects.boardCells");
  const cell = requireRecord(boardCells["cell-01"], "preview board cell cell-01");
  const attributes = requireRecord(cell.attributes, "preview board cell cell-01.attributes");
  attributes.ownerPlayerId = "p1";
  attributes.improvementTier = 0;
  attributes.mortgaged = false;
  return materializePreviewSource(previewManifest, "estate-s5-obligation");
}

/** Materialize the player-creditor bankruptcy branch with one mortgaged asset. */
function materializeCreditorBankruptcyPreview(): PreviewSource {
  const sourceManifest = readJson<JsonRecord>(path.join(SOURCE_GAME_ROOT, "game.manifest.json"));
  const previewManifest = structuredClone(sourceManifest);
  const config = requireRecord(previewManifest.config, "preview.config");
  const turnModel = requireRecord(config.turnModel, "preview.config.turnModel");
  const phases = Array.isArray(turnModel.phases) ? turnModel.phases : [];
  turnModel.phases = ["rent", ...phases.filter((phase) => phase !== "rent")];
  const state = requireRecord(previewManifest.state, "preview.state");
  const playersTemplate = requireRecord(state.playersTemplate, "preview.state.playersTemplate");
  const metrics = requireRecord(playersTemplate.metrics, "preview.state.playersTemplate.metrics");
  metrics.cash = 1200;
  metrics.position = 1;
  const publicState = requireRecord(state.public, "preview.state.public");
  publicState.setupComplete = true;
  const board = requireRecord(publicState.board, "preview.state.public.board");
  board.lastRoll = { values: [3, 4], total: 7, isDouble: false };
  board.availableActions = [{
    id: "property-rent",
    label: "Оплатить ренту",
    actionId: "property.rent"
  }];
  const objects = requireRecord(publicState.objects, "preview.state.public.objects");
  const boardCells = requireRecord(objects.boardCells, "preview.state.public.objects.boardCells");
  setEstateCellOwner(boardCells, "cell-01", "p2", false);
  setEstateCellOwner(boardCells, "cell-05", "p1", true);
  const rentCell = requireRecord(boardCells["cell-01"], "preview board cell cell-01");
  const rentAttributes = requireRecord(rentCell.attributes, "preview board cell cell-01.attributes");
  rentAttributes.rent = 2000;
  rentAttributes.rent0 = 2000;
  return materializePreviewSource(previewManifest, "estate-s5-creditor-bankruptcy");
}

/** Materialize the bank-creditor bankruptcy branch with an auctionable lot. */
function materializeBankBankruptcyPreview(): PreviewSource {
  const sourceManifest = readJson<JsonRecord>(path.join(SOURCE_GAME_ROOT, "game.manifest.json"));
  const previewManifest = structuredClone(sourceManifest);
  const config = requireRecord(previewManifest.config, "preview.config");
  const players = requireRecord(config.players, "preview.config.players");
  players.min = 3;
  players.max = Math.max(Number(players.max), 3);
  const turnModel = requireRecord(config.turnModel, "preview.config.turnModel");
  const phases = Array.isArray(turnModel.phases) ? turnModel.phases : [];
  turnModel.phases = ["tax", ...phases.filter((phase) => phase !== "tax")];
  const state = requireRecord(previewManifest.state, "preview.state");
  const playersTemplate = requireRecord(state.playersTemplate, "preview.state.playersTemplate");
  const metrics = requireRecord(playersTemplate.metrics, "preview.state.playersTemplate.metrics");
  metrics.cash = 0;
  metrics.position = 4;
  const publicState = requireRecord(state.public, "preview.state.public");
  publicState.setupComplete = true;
  const board = requireRecord(publicState.board, "preview.state.public.board");
  board.availableActions = [{
    id: "pay-tax",
    label: "Оплатить налог",
    actionId: "tax.pay"
  }];
  const objects = requireRecord(publicState.objects, "preview.state.public.objects");
  const boardCells = requireRecord(objects.boardCells, "preview.state.public.objects.boardCells");
  setEstateCellOwner(boardCells, "cell-01", "p1", true);
  return materializePreviewSource(previewManifest, "estate-s5-bank-bankruptcy");
}

function setEstateCellOwner(
  boardCells: JsonRecord,
  cellId: string,
  ownerPlayerId: string,
  mortgaged: boolean
): void {
  const cell = requireRecord(boardCells[cellId], `preview board cell ${cellId}`);
  const attributes = requireRecord(cell.attributes, `preview board cell ${cellId}.attributes`);
  attributes.ownerPlayerId = ownerPlayerId;
  attributes.improvementTier = 0;
  attributes.mortgaged = mortgaged;
}

/** Copy one temporary manifest and the verified published player bundle. */
function materializePreviewSource(
  previewManifest: JsonRecord,
  sourcePrefix: string
): PreviewSource {
  const pluginMetadata = readJson<{ readonly bundles: readonly PublishedPluginBundle[] }>(
    path.join(SOURCE_GAME_ROOT, "published", "player-web-plugin-bundles.json")
  );
  const publishedBundle = pluginMetadata.bundles.find((candidate) =>
    candidate.gameId === GAME_ID &&
    candidate.target === "player-web" &&
    candidate.scope === "published"
  );
  if (!publishedBundle) {
    throw new Error("Published Estate Race player plugin bundle was not found.");
  }
  const sourceBundlePath = path.join(SOURCE_GAME_ROOT, publishedBundle.filePath);
  const sourceBytes = readFileSync(sourceBundlePath);
  const actualHash = createHash("sha256").update(sourceBytes).digest("hex");
  if (actualHash !== publishedBundle.contentHash) {
    throw new Error("Published Estate Race player plugin bundle is stale.");
  }

  const contentSourceId = `${sourcePrefix}-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const contentRoot = path.join(PREVIEW_ROOT, contentSourceId);
  const targetGameRoot = path.join(contentRoot, "games", GAME_ID);
  const targetUiRoot = path.join(targetGameRoot, "ui", "web");
  const targetBundleRoot = path.join(contentRoot, "preview-plugin-bundles");
  mkdirSync(targetUiRoot, { recursive: true });
  mkdirSync(targetBundleRoot, { recursive: true });
  temporaryRoots.add(contentRoot);

  writeFileSync(
    path.join(targetGameRoot, "game.manifest.json"),
    `${JSON.stringify(previewManifest, null, 2)}\n`,
    "utf8"
  );
  copyFileSync(
    path.join(SOURCE_GAME_ROOT, "ui", "web", "ui.manifest.json"),
    path.join(targetUiRoot, "ui.manifest.json")
  );
  const targetBundlePath = path.join(
    targetBundleRoot,
    `${publishedBundle.pluginId}.${publishedBundle.contentHash}.mjs`
  );
  copyFileSync(sourceBundlePath, targetBundlePath);

  return {
    contentRoot,
    contentSourceId,
    pluginBundles: [{
      pluginId: publishedBundle.pluginId,
      gameId: publishedBundle.gameId,
      apiVersion: publishedBundle.apiVersion,
      target: "player-web",
      scope: "preview",
      contentHash: publishedBundle.contentHash,
      filePath: toPosixPath(path.relative(contentRoot, targetBundlePath))
    }]
  };
}

/** Register one isolated source and create its session through Player Web. */
async function openPreviewSession(
  page: Page,
  source: PreviewSource,
  initialActionLabel = "Определить порядок"
): Promise<RuntimeSnapshot> {
  const reload = await page.request.post(`${RUNTIME_URL}/content/reload`, {
    data: {
      gameId: GAME_ID,
      contentSourceId: source.contentSourceId,
      contentRoot: source.contentRoot,
      pluginBundles: source.pluginBundles
    }
  });
  expect(reload.status(), await reload.text()).toBe(200);

  const create = await page.request.post("/api/runtime/sessions", {
    data: {
      gameId: GAME_ID,
      contentSourceId: source.contentSourceId
    }
  });
  const createText = await create.text();
  expect(create.status(), createText).toBe(201);
  expect(create.headers()["set-cookie"] ?? "").toMatch(/HttpOnly/iu);
  const snapshot = JSON.parse(createText) as RuntimeSnapshot;
  expect(snapshot.version.stateVersion).toBe(0);
  expect(snapshot).not.toHaveProperty("credential");
  expectPlayerSnapshotHasNoPlatformSecrets(snapshot);

  await page.goto(
    `/?gameId=${GAME_ID}&preview=1&sessionId=${encodeURIComponent(snapshot.sessionId)}` +
    `&contentSourceId=${encodeURIComponent(source.contentSourceId)}`
  );
  await expect(page.locator(".game-player-root")).toBeVisible();
  await expect(page.locator(".loading-state")).toHaveCount(0);
  await expectEstateRaceS7Surface(page);
  await expect(board(page).getByRole("button", { name: initialActionLabel }))
    .toBeVisible({ timeout: BOARD_PLUGIN_READY_TIMEOUT_MS });
  return snapshot;
}

const board = (page: Page) => page.getByRole("region", { name: FIELD_LABEL });

async function expectEstateRaceS7Surface(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Estate Race", level: 1 })).toBeVisible();
  await expect(board(page)).toBeVisible();
  await expect(board(page)).toHaveAttribute("data-layout-mode", "map-first");

  await expect(page.getByRole("button", { name: "Открыть панель «Обзор»" })).toBeVisible();
  await page.getByRole("button", { name: "Открыть панель «Обзор»" }).click();
  const economyPanel = page.locator('[data-workspace-slot="primary-panel"]');
  await expect(economyPanel).toBeVisible();
  await expect(economyPanel.getByRole("heading", { name: "Участники и экономика", level: 2 }))
    .toBeVisible();

  await expect(page.getByRole("button", { name: "Открыть панель «Контекст»" })).toBeVisible();
  await page.getByRole("button", { name: "Открыть панель «Контекст»" }).click();
  const contextPanel = page.locator('[data-workspace-slot="context-panel"]');
  await expect(contextPanel).toBeVisible();
  await expect(contextPanel.getByRole("heading", { name: "Контекст решения", level: 2 }))
    .toBeVisible();
  await expect(contextPanel.getByRole("heading", {
    name: "Пауза для разбора · необязательно",
    level: 2
  })).toBeVisible();
  await page.getByRole("button", { name: "Закрыть панель «Контекст»" }).click();
  await board(page).getByRole("button", { name: "Действия" }).click();
  await expect(board(page).getByRole("button", { name: "Закрыть действия" })).toBeVisible();
}

const waitForSessionCreation = (page: Page) => page.waitForResponse((response) =>
  response.url().endsWith("/api/runtime/sessions") && response.request().method() === "POST"
);

async function clickBoardAction(page: Page, label: string): Promise<BrowserActionResult> {
  const previousRoundTrip = await boardRoundTripMarker(page);
  const actionRequest = page.waitForRequest((request) =>
    request.url().endsWith("/api/runtime/actions") && request.method() === "POST"
  );
  const actionResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/runtime/actions") && response.request().method() === "POST"
  );

  await board(page).getByRole("button", { name: label }).click();
  const [runtimeRequest, runtimeResponse] = await Promise.all([actionRequest, actionResponse]);
  expect(runtimeResponse.status()).toBe(200);
  await expectBoardRoundTrip(page, previousRoundTrip);

  const snapshot = await runtimeResponse.json() as RuntimeSnapshot;
  expect(
    snapshot.receipt?.status,
    `${label} was rejected: ${snapshot.receipt?.rejectionCode ?? "unknown reason"}`
  ).toBe("applied");
  expectPlayerSnapshotHasNoPlatformSecrets(snapshot);
  const requestBody = runtimeRequest.postDataJSON() as Record<string, unknown>;
  expect(JSON.stringify(requestBody)).not.toMatch(/random|deck|credential/iu);

  return {
    requestBody,
    snapshot
  };
}

async function submitBoardFormAction(
  page: Page,
  actionLabel: string,
  fieldLabel: string,
  value: string
): Promise<BrowserActionResult> {
  return submitBoardFormFields(page, actionLabel, {
    [await resolveFormFieldName(page, actionLabel, fieldLabel)]: value
  });
}

/** Submit every scalar declared by a server action's accessible form. */
async function submitBoardFormFields(
  page: Page,
  actionLabel: string,
  values: Record<string, string>,
  fieldLabels: Readonly<Record<string, string>> = {}
): Promise<BrowserActionResult> {
  const previousRoundTrip = await boardRoundTripMarker(page);
  const actionRequest = page.waitForRequest((request) =>
    request.url().endsWith("/api/runtime/actions") && request.method() === "POST"
  );
  const actionResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/runtime/actions") && response.request().method() === "POST"
  );

  const form = board(page).getByRole("form", { name: actionLabel });
  await expect(form).toBeVisible({ timeout: BOARD_PLUGIN_READY_TIMEOUT_MS });
  for (const [name, value] of Object.entries(values)) {
    const field = fieldLabels[name] === undefined
      ? form.locator(`[name="${name}"]`)
      : form.getByLabel(fieldLabels[name]);
    await expect(field).toHaveCount(1);
    if (await field.evaluate((element) => element.tagName === "SELECT")) {
      await field.selectOption(value);
    } else {
      await field.fill(value);
    }
  }
  await form.getByRole("button", { name: actionLabel }).click();
  const [runtimeRequest, runtimeResponse] = await Promise.all([actionRequest, actionResponse]);
  expect(runtimeResponse.status()).toBe(200);
  await expectBoardRoundTrip(page, previousRoundTrip);

  const snapshot = await runtimeResponse.json() as RuntimeSnapshot;
  expect(
    snapshot.receipt?.status,
    `${actionLabel} was rejected: ${snapshot.receipt?.rejectionCode ?? "unknown reason"}`
  ).toBe("applied");
  expectPlayerSnapshotHasNoPlatformSecrets(snapshot);
  const requestBody = runtimeRequest.postDataJSON() as Record<string, unknown>;
  expect(JSON.stringify(requestBody)).not.toMatch(/random|deck|credential/iu);
  return { requestBody, snapshot };
}

async function resolveFormFieldName(page: Page, actionLabel: string, fieldLabel: string): Promise<string> {
  const field = board(page).getByRole("form", { name: actionLabel }).getByLabel(fieldLabel);
  await expect(field).toHaveCount(1);
  return field.getAttribute("name").then((name) => {
    if (!name) throw new Error(`Form field ${fieldLabel} has no declared name.`);
    return name;
  });
}

async function submitAuctionBid(page: Page, amount: number): Promise<BrowserActionResult> {
  const previousRoundTrip = await boardRoundTripMarker(page);
  const actionRequest = page.waitForRequest((request) =>
    request.url().endsWith("/api/runtime/actions") && request.method() === "POST"
  );
  const actionResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/runtime/actions") && response.request().method() === "POST"
  );

  const form = board(page).getByRole("form", { name: "Сделать ставку" });
  await form.getByRole("spinbutton", { name: "Сумма ставки" }).fill(String(amount));
  await form.getByRole("button", { name: "Сделать ставку" }).click();
  const [runtimeRequest, runtimeResponse] = await Promise.all([actionRequest, actionResponse]);
  expect(runtimeResponse.status()).toBe(200);
  await expectBoardRoundTrip(page, previousRoundTrip);
  const snapshot = await runtimeResponse.json() as RuntimeSnapshot;
  expect(
    snapshot.receipt?.status,
    `Сделать ставку отклонено: ${snapshot.receipt?.rejectionCode ?? "unknown reason"}`
  ).toBe("applied");
  expectPlayerSnapshotHasNoPlatformSecrets(snapshot);
  const requestBody = runtimeRequest.postDataJSON() as Record<string, unknown>;
  expect(JSON.stringify(requestBody)).not.toMatch(/random|deck|cardId|credential/iu);
  return {
    requestBody,
    snapshot
  };
}

const boardRoundTripMarker = (page: Page) => board(page)
  .getByTestId("interactive-board-canvas-host")
  .getAttribute("data-last-action-round-trip-ms", { timeout: 1_000 })
  .catch(() => null);

async function expectBoardRoundTrip(page: Page, previousMarker: string | null): Promise<void> {
  await expect.poll(() => boardRoundTripMarker(page), {
    message: "board DOM did not apply the authoritative action snapshot",
    timeout: 30_000
  }).not.toBe(previousMarker);
}

/** The player HTTP boundary must never reveal deterministic random/deck internals. */
function expectPlayerSnapshotHasNoPlatformSecrets(snapshot: RuntimeSnapshot): void {
  expect(snapshot.state.secret?.random).toBeUndefined();
  expect(snapshot.state.secret?.decks).toBeUndefined();
}

function readEstateCell(snapshot: RuntimeSnapshot, cellId: string): JsonRecord {
  const publicState = snapshot.state.public as unknown as JsonRecord;
  const objects = requireRecord(publicState.objects, "snapshot.state.public.objects");
  const boardCells = requireRecord(objects.boardCells, "snapshot.state.public.objects.boardCells");
  const cell = requireRecord(boardCells[cellId], `snapshot board cell ${cellId}`);
  return requireRecord(cell.attributes, `snapshot board cell ${cellId}.attributes`);
}

function readJson<T>(absolutePath: string): T {
  return JSON.parse(readFileSync(absolutePath, "utf8")) as T;
}

function requireRecord(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}
