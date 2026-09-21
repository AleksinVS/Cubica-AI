import { expect, test } from "@playwright/test";

const editorUrl = process.env.E2E_EDITOR_URL ?? "http://127.0.0.1:3202";

test("opens the actual preview immediately and selects an authored element", { tag: "@editor" }, async ({ page, request }) => {
  test.setTimeout(90_000);
  let sessionId: string | undefined;
  try {
    const opening = page.waitForResponse(response =>
      response.url().endsWith("/api/editor/session") && response.request().method() === "POST"
    );
    await page.goto(`${editorUrl}/?gameId=simple-choice&file=game.authoring.json`);
    const response = await opening;
    expect(response.status()).toBe(200);
    const body = await response.json();
    sessionId = body.session.sessionId;

    await expect(page.getByTestId("editor-wireframe")).toHaveCount(0);
    const frame = page.frameLocator("iframe[title='Предпросмотр игры']");
    const node = frame.locator('[data-preview-runtime-pointer="/screens/intro/root/children/0/children/0"]');
    await expect(node).toBeVisible({ timeout: 60_000 });
    const bounds = await node.boundingBox();
    if (!bounds) throw Error("No bounds for the rendered element");
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await expect(page.getByRole("textbox", { name: "Единый текст элемента" })).toBeVisible();
  } finally {
    await page.close().catch(() => undefined);
    if (sessionId !== undefined) {
      await request.delete(`${editorUrl}/api/editor/session`, { data: { sessionId } });
    }
  }
});
