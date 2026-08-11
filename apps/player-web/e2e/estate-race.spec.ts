/**
 * Browser acceptance for the Estate Race S3 display and bounded action slice
 * (GSR-042).
 *
 * The browser creates one normal authenticated player session and performs one
 * production-random setup followed by one production-random roll. The
 * assertion follows the state and actions returned by Runtime API; it never
 * predicts a destination, forces dice, or derives card/jail state in the
 * client. If production randomness lands on a free object, the normal DOM flow
 * still covers decline → bid → pass. A second isolated preview proves the S3
 * card path for every possible production dice result.
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
  | "jail";

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
        lastCardId?: string;
        availableActions: Array<{
          actionId: string;
          label?: string;
          params?: Record<string, unknown>;
          disabled?: boolean;
        }>;
      };
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

test.describe("Estate Race S3", { tag: "@player" }, () => {
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
      name: "Estate Race · S3",
      level: 1
    })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Локальная партия: 2–6 участников", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Карточка", level: 2 })).toBeVisible();
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
      await expect(page.getByText(
        `Последний открытый результат: ${snapshot.state.public.board.lastCardId}`
      )).toBeVisible();
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
      `^Ход \\d+ · активен ${snapshot.state.public.turn.activePlayerId} · этап ${snapshot.state.public.turn.phase}$`,
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
      expect.objectContaining({ actionId: "turn.finish", label: "Завершить ход" })
    ]);
    expectPlayerSnapshotHasNoPlatformSecrets(roll.snapshot);

    await expect(page.getByRole("heading", { name: "Карточка", level: 2 })).toBeVisible();
    await expect(page.getByText(`Последний открытый результат: ${TECHNICAL_CARD_ID}`)).toBeVisible();
    await expect(board(page).getByRole("button", { name: "Завершить ход" })).toBeVisible();
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

/** Register one isolated source and create its session through Player Web. */
async function openPreviewSession(page: Page, source: PreviewSource): Promise<RuntimeSnapshot> {
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
  await expect(page.getByRole("heading", { name: "Estate Race · S3", level: 1 })).toBeVisible();
  await expect(board(page).getByRole("button", { name: "Определить порядок" }))
    .toBeVisible({ timeout: BOARD_PLUGIN_READY_TIMEOUT_MS });
  return snapshot;
}

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
  const requestBody = runtimeRequest.postDataJSON() as Record<string, unknown>;
  expect(JSON.stringify(requestBody)).not.toMatch(/random|deck|cardId|credential/iu);

  return {
    requestBody,
    snapshot
  };
}

async function submitAuctionBid(page: Page, amount: number): Promise<BrowserActionResult> {
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

/** The player HTTP boundary must never reveal deterministic random/deck internals. */
function expectPlayerSnapshotHasNoPlatformSecrets(snapshot: RuntimeSnapshot): void {
  expect(snapshot.state.secret?.random).toBeUndefined();
  expect(snapshot.state.secret?.decks).toBeUndefined();
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
