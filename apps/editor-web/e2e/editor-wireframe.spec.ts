import { expect, test } from "@playwright/test";

const editorUrl = process.env.E2E_EDITOR_URL ?? "http://127.0.0.1:3202";

test("selects structural authoring nodes before the first compiled preview", { tag: "@editor" }, async ({ page, request }) => {
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

    const wireframe = page.getByTestId("editor-wireframe");
    await expect(wireframe).toBeVisible();
    await expect(wireframe.getByLabel("Выбрать экран")).toBeVisible();
    // The object-template node may not yet resolve to an editable entity. It
    // must still visibly acknowledge selection and retain its source pointer.
    const node = wireframe.locator("[data-wireframe-source-pointer]").last();
    await node.click();
    await expect(node).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("iframe[title='Предпросмотр игры']")).toHaveCount(0);
  } finally {
    await page.close().catch(() => undefined);
    if (sessionId !== undefined) {
      await request.delete(`${editorUrl}/api/editor/session`, { data: { sessionId } });
    }
  }
});
