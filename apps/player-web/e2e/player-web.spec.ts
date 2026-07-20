import { expect, test } from "@playwright/test";

const storageKey = "cubica-antarctica-session-id";

test.describe("player-web e2e", () => {
  test("boots Antarctica through Next.js proxy and dispatches a runtime action", async ({ page }) => {
    const createSession = page.waitForResponse((response) =>
      response.url().endsWith("/api/runtime/sessions") &&
      response.request().method() === "POST"
    );

    // player-web is a game-agnostic entry point (ARC-003): it no longer
    // defaults a bare "/" to a specific game, so this test passes gameId
    // explicitly like every other game-boot test in this file.
    await page.goto("/?gameId=antarctica");
    await expect(page.locator(".game-player-root")).toBeVisible();
    await expect(page.locator(".loading-state")).toHaveCount(0);

    const createSessionResponse = await createSession;
    expect(createSessionResponse.status()).toBe(201);

    await expect(page.getByRole("button", { name: /Журнал ходов/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Подсказка/i })).toBeVisible();
    await expect(page.locator(".game-variable")).toHaveCount(8);
    await expect(page.getByText('Корпорация "Антарктика"')).toBeVisible();
    await expect(page.locator(".game-card")).toHaveCount(0);

    const advanceResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/runtime/actions") &&
      response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Вперед" }).click();
    expect((await advanceResponse).status()).toBe(200);
    await expect(page.getByText("Мы находимся далеко-далеко на юге…")).toBeVisible();

    await page.getByRole("button", { name: /Подсказка/i }).click();
    await expect(page.locator(".hint-screen")).toBeVisible();
    await expect(page.locator(".hint-text")).toBeVisible();

    await page.getByRole("button", { name: /Журнал ходов/i }).click();
    await expect(page.getByRole("heading", { name: /Журнал ходов/i })).toBeVisible();

    // Hint is a UI-only panel (ADR-053, TSK-20260615): showing it is a
    // client-side SHOW_PANEL command, not a server round-trip. The old
    // assertion here waited for a /api/runtime/actions POST that no longer
    // happens after the hint was migrated out of the game manifest — it was a
    // stale false-red. Assert the panel renders client-side instead.
    await page.getByRole("button", { name: /Подсказка/i }).click();
    await expect(page.locator(".hint-screen")).toBeVisible();
  });

  test("uses portal launch binding and stores a launch-scoped session id", async ({ page, request }) => {
    const sessionResponse = await request.post("/api/runtime/sessions", {
      data: {
        gameId: "antarctica"
      }
    });
    expect(sessionResponse.status()).toBe(201);
    const runtimeSession = await sessionResponse.json();

    let bindingPayload: Record<string, unknown> | null = null;
    await page.route("**/api/portal/runtime-session", async (route) => {
      bindingPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          runtimeSessionId: runtimeSession.sessionId,
          runtimeSession
        })
      });
    });

    await page.goto("/?launchToken=e2e-token&launchCounter=1&gameId=antarctica");
    await expect(page.locator(".game-player-root")).toBeVisible();
    await expect(page.locator(".loading-state")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Журнал ходов/i })).toBeVisible();

    expect(bindingPayload).not.toBeNull();
    const postedBindingPayload = bindingPayload as unknown as Record<string, unknown>;
    expect(postedBindingPayload).toEqual({ token: "e2e-token", counter: "1" });

    const scopedSessionId = await page.evaluate((key) => window.localStorage.getItem(key), `${storageKey}:launch:e2e-token:1`);
    expect(scopedSessionId).toBe(runtimeSession.sessionId);
  });

  test("boots simple-choice without a game plugin and dispatches a manifest action", async ({ page }) => {
    const createSession = page.waitForResponse((response) =>
      response.url().endsWith("/api/runtime/sessions") &&
      response.request().method() === "POST"
    );

    await page.goto("/?gameId=simple-choice");
    await expect(page.locator(".game-player-root")).toBeVisible();
    await expect(page.locator(".loading-state")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Simple Choice" })).toBeVisible();
    const chooseOption = page.getByRole("button", { name: "Choose the option with the visible tradeoff." });
    await expect(chooseOption).toBeVisible();

    const createSessionResponse = await createSession;
    expect(createSessionResponse.status()).toBe(201);

    const actionResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/runtime/actions") &&
      response.request().method() === "POST"
    );
    await chooseOption.click();
    expect((await actionResponse).status()).toBe(200);

    await expect(page.getByRole("heading", { name: "Result" })).toBeVisible();
    await expect(page.getByText("Outcome: accepted")).toBeVisible();
    await expect(page.getByText("Supply token: 1")).toBeVisible();
  });

  test("shows paused state for AI-driven game when Agent Runtime is unavailable", async ({ page }) => {
    const readinessResponse = page.waitForResponse((response) =>
      response.url().includes("/api/runtime/games/ai-driven-choice/readiness") &&
      response.request().method() === "GET"
    );

    await page.goto("/?gameId=ai-driven-choice");

    expect((await readinessResponse).status()).toBe(503);
    await expect(page.locator(".game-player-root")).toBeVisible();
    await expect(page.locator(".loading-state")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Игра поставлена на паузу" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
  });

  test("shows an entry-point error and creates no session when gameId is missing (ARC-003)", async ({ page }) => {
    let sessionRequested = false;
    await page.route("**/api/runtime/sessions", (route) => {
      sessionRequested = true;
      return route.continue();
    });

    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Не указан идентификатор игры" })).toBeVisible();
    await expect(page.locator(".game-player-root")).toHaveCount(0);
    expect(sessionRequested).toBe(false);
  });
});
