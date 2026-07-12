/**
 * Browser acceptance for the complete Cards Money Trains mock session.
 *
 * One spatially presented action is executed through the keyboard-accessible
 * board control, the long deterministic middle is progressed through the same
 * player-web Runtime API proxy, and the irreversible finish handshake returns
 * to visible DOM controls. This keeps the test bounded while proving both UI
 * interaction seams use one authoritative persisted session.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const GAME_ID = "cards-money-trains-mock";
const BOARD_LABEL = "Транспортная карта игры. Все доступные действия дублируются обычными кнопками под полем.";
const BOARD_READY_TIMEOUT_MS = 30_000;
const transcript = readTranscriptIfReady();

interface TranscriptStep {
  readonly order: number;
  readonly actionId: string;
  readonly params?: Record<string, unknown> | null;
  readonly expected: {
    readonly phase: string;
    readonly turnNumber: number;
    readonly status?: "active" | "finished";
    readonly finishConfirmationPending?: boolean;
  };
}

interface CompleteSessionTranscript {
  readonly fixtureKind: "complete-mock-session";
  readonly gameId: typeof GAME_ID;
  readonly steps: ReadonlyArray<TranscriptStep>;
}

interface RuntimeSnapshot {
  readonly sessionId: string;
  /** Create/GET include gameId; action responses intentionally omit it. */
  readonly gameId?: string;
  readonly version: {
    readonly stateVersion: number;
  };
  readonly state: {
    readonly secret?: { readonly decks?: unknown; [key: string]: unknown };
    readonly public: {
      readonly session: {
        readonly phase: string;
        readonly turnNumber: number;
        readonly status: string;
        readonly finishConfirmationPending: boolean;
      };
      readonly ranking?: {
        readonly groups?: ReadonlyArray<unknown> | Record<string, unknown>;
      } | null;
    };
  };
}

test.describe("Cards Money Trains complete mock session", () => {
  test.skip(transcript === null, "complete mock transcript is being produced by the game-content slice");

  test("starts by keyboard and completes the facilitator finish handshake in the same session", async ({ page, request }) => {
    test.setTimeout(180_000);
    expect(transcript).not.toBeNull();
    const steps = transcript!.steps;
    expect(steps[0]?.actionId).toBe("mock.setup.start");

    const creation = page.waitForResponse((response) =>
      response.url().endsWith("/api/runtime/sessions") && response.request().method() === "POST"
    );
    await page.goto(`/?gameId=${GAME_ID}`);
    const created = await (await creation).json() as RuntimeSnapshot;
    expect(created.gameId).toBe(GAME_ID);
    expectNoFutureDecks(created);

    await expect(page.locator(".game-player-root")).toBeVisible();
    await expect(page.locator(".loading-state")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Карты, деньги, поезда", level: 1 })).toBeVisible();
    await expect(page.getByText(/MOCK — только разработка/i)).toBeVisible();
    const board = page.getByRole("region", { name: BOARD_LABEL });
    await expect(board.getByTestId("interactive-board-canvas-host")).toBeVisible();

    // Keyboard activation proves the Phaser map has an equivalent ordinary
    // DOM action; no pointer coordinates or drag gesture are required.
    const startButton = board.getByRole("button", { name: "MOCK: подтвердить команды и начать игру" });
    await expect(startButton).toBeVisible({ timeout: BOARD_READY_TIMEOUT_MS });
    await startButton.focus();
    const started = await pressButtonAndReadSnapshot(page, startButton, "Enter");
    expect(started.requestBody.actionId).toBe("mock.setup.start");
    expectStep(started.snapshot, steps[0]);

    const firstFinishIndex = steps.findIndex((step) => step.actionId === "session.finish.request");
    expect(firstFinishIndex).toBeGreaterThan(1);
    let snapshot = started.snapshot;

    // Six test turns contain many repetitive facilitator clicks. Progress the
    // deterministic middle through the same Next.js proxy, preserving the one
    // browser-owned session and checking every returned player projection.
    for (const step of steps.slice(1, firstFinishIndex)) {
      snapshot = await postAction(request, snapshot, step);
      expectStep(snapshot, step);
    }
    expect(snapshot.state.public.session.turnNumber).toBeGreaterThan(6);
    expect(snapshot.state.public.session.status).toBe("active");

    await reloadStoredSession(page, snapshot.sessionId);
    await expect(page.getByText(new RegExp(`Ход:\\s*${snapshot.state.public.session.turnNumber}`, "i"))).toBeVisible();

    // Execute request → cancel → request → confirm through the manifest-owned
    // buttons. Any non-finish step in this tail (for example ranking) remains
    // a normal authoritative API action, after which the browser reloads it.
    for (const step of steps.slice(firstFinishIndex)) {
      const controlId = finishControlId(step.actionId);
      if (controlId === null) {
        snapshot = await postAction(request, snapshot, step);
        expectStep(snapshot, step);
        await reloadStoredSession(page, snapshot.sessionId);
        continue;
      }

      const control = page.locator(`[id="${controlId}"]`);
      await expect(control).toBeVisible();
      const result = await clickButtonAndReadSnapshot(page, control);
      expect(result.requestBody.actionId).toBe(step.actionId);
      snapshot = result.snapshot;
      expectStep(snapshot, step);
    }

    expect(snapshot.state.public.session.phase).toBe("finished");
    expect(snapshot.state.public.session.status).toBe("finished");
    expect(snapshot.state.public.ranking).not.toBeNull();
    await expect(page.getByText(/Этап:\s*finished/i)).toBeVisible();
  });
});

function readTranscriptIfReady(): CompleteSessionTranscript | null {
  const fixturePath = path.join(
    process.cwd(),
    "games",
    "cards-money-trains-mock",
    "fixtures",
    "complete-session-transcript.json"
  );
  try {
    const parsed = JSON.parse(readFileSync(fixturePath, "utf8")) as Partial<CompleteSessionTranscript>;
    return parsed.fixtureKind === "complete-mock-session" && parsed.gameId === GAME_ID
      ? parsed as CompleteSessionTranscript
      : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function postAction(
  request: APIRequestContext,
  current: RuntimeSnapshot,
  step: TranscriptStep
): Promise<RuntimeSnapshot> {
  const response = await request.post("/api/runtime/actions", {
    data: {
      sessionId: current.sessionId,
      expectedStateVersion: current.version.stateVersion,
      playerId: "player-web",
      actionId: step.actionId,
      ...(step.params ? { params: step.params } : {})
    }
  });
  const responseText = await response.text();
  expect(response.status(), `${step.order} ${step.actionId}: ${responseText}`).toBe(200);
  const snapshot = JSON.parse(responseText) as RuntimeSnapshot;
  expectNoFutureDecks(snapshot);
  return snapshot;
}

async function reloadStoredSession(page: Page, sessionId: string): Promise<void> {
  const restored = page.waitForResponse((response) =>
    response.url().includes(`/api/runtime/sessions/${sessionId}`) && response.request().method() === "GET"
  );
  await page.reload();
  const response = await restored;
  expect(response.status()).toBe(200);
  expectNoFutureDecks(await response.json() as RuntimeSnapshot);
  await expect(page.locator(".loading-state")).toHaveCount(0);
}

async function pressButtonAndReadSnapshot(
  page: Page,
  button: ReturnType<Page["locator"]>,
  key: string
) {
  const requestPromise = page.waitForRequest((request) =>
    request.url().endsWith("/api/runtime/actions") && request.method() === "POST"
  );
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/runtime/actions") && response.request().method() === "POST"
  );
  await button.press(key);
  return readBrowserAction(await requestPromise, await responsePromise);
}

async function clickButtonAndReadSnapshot(page: Page, button: ReturnType<Page["locator"]>) {
  const requestPromise = page.waitForRequest((request) =>
    request.url().endsWith("/api/runtime/actions") && request.method() === "POST"
  );
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/runtime/actions") && response.request().method() === "POST"
  );
  await button.click();
  return readBrowserAction(await requestPromise, await responsePromise);
}

async function readBrowserAction(runtimeRequest: { postDataJSON(): unknown }, runtimeResponse: { status(): number; json(): Promise<unknown> }) {
  expect(runtimeResponse.status()).toBe(200);
  const snapshot = await runtimeResponse.json() as RuntimeSnapshot;
  expectNoFutureDecks(snapshot);
  return {
    requestBody: runtimeRequest.postDataJSON() as Record<string, unknown>,
    snapshot
  };
}

function finishControlId(actionId: string): string | null {
  if (actionId === "session.finish.request") return "facilitator.finish-request";
  if (actionId === "session.finish.cancel") return "facilitator.finish-cancel";
  if (actionId === "session.finish.confirm") return "facilitator.finish-confirm";
  return null;
}

function expectStep(snapshot: RuntimeSnapshot, step: TranscriptStep): void {
  expect(snapshot.state.public.session.phase, `phase after ${step.order} ${step.actionId}`).toBe(step.expected.phase);
  expect(snapshot.state.public.session.turnNumber, `turn after ${step.order} ${step.actionId}`).toBe(step.expected.turnNumber);
  if (step.expected.status !== undefined) {
    expect(snapshot.state.public.session.status).toBe(step.expected.status);
  }
  if (step.expected.finishConfirmationPending !== undefined) {
    expect(snapshot.state.public.session.finishConfirmationPending).toBe(step.expected.finishConfirmationPending);
  }
}

function expectNoFutureDecks(snapshot: RuntimeSnapshot): void {
  expect(snapshot.state.secret?.decks).toBeUndefined();
}
