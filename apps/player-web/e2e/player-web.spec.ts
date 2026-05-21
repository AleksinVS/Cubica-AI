import { expect, test } from "@playwright/test";

const storageKey = "cubica-antarctica-session-id";

test.describe("player-web e2e", () => {
  test("boots Antarctica through Next.js proxy and dispatches a runtime action", async ({ page }) => {
    const createSession = page.waitForResponse((response) =>
      response.url().endsWith("/api/runtime/sessions") &&
      response.request().method() === "POST"
    );

    await page.goto("/");
    await expect(page.locator(".game-player-root")).toBeVisible();
    await expect(page.locator(".loading-state")).toHaveCount(0);

    const createSessionResponse = await createSession;
    expect(createSessionResponse.status()).toBe(201);

    await expect(page.getByRole("button", { name: /Журнал ходов/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Подсказка/i })).toBeVisible();
    await expect(page.locator(".game-variable")).toHaveCount(8);

    await page.getByRole("button", { name: /Подсказка/i }).click();
    await expect(page.locator(".hint-screen")).toBeVisible();
    await expect(page.locator(".hint-text")).toBeVisible();

    await page.getByRole("button", { name: /Журнал ходов/i }).click();
    await expect(page.getByRole("heading", { name: /Журнал ходов/i })).toBeVisible();

    const actionResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/runtime/actions") &&
      response.request().method() === "POST"
    );
    await page.getByRole("button", { name: /Подсказка/i }).click();
    await expect(page.locator(".hint-screen")).toBeVisible();
    expect((await actionResponse).status()).toBe(200);
  });

  test("uses portal launch binding and stores a launch-scoped session id", async ({ page, request }) => {
    const sessionResponse = await request.post("/api/runtime/sessions", {
      data: {
        gameId: "antarctica",
        playerId: "player-web"
      }
    });
    expect(sessionResponse.status()).toBe(201);
    const runtimeSession = await sessionResponse.json();

    let bindingPayload: Record<string, unknown> | null = null;
    await page.route("**/api/launch-sessions/resolve/e2e-token/1/runtime-binding", async (route) => {
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
    expect(postedBindingPayload.playerId).toBe("player-web");
    expect(typeof postedBindingPayload.deviceToken).toBe("string");

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
    await expect(page.getByRole("button", { name: "Choose path" })).toBeVisible();

    const createSessionResponse = await createSession;
    expect(createSessionResponse.status()).toBe(201);

    const actionResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/runtime/actions") &&
      response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Choose path" }).click();
    expect((await actionResponse).status()).toBe(200);

    await expect(page.getByRole("heading", { name: "Result" })).toBeVisible();
    await expect(page.getByText("Outcome: accepted")).toBeVisible();
    await expect(page.getByText("1")).toBeVisible();
  });
});
