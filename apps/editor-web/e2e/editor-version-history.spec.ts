import { expect, test, type Page } from "@playwright/test";

const editorUrl = process.env.E2E_EDITOR_URL ?? "http://127.0.0.1:3202";

/** Save through the MVP interface; history restoration remains an API capability. */
async function saveElementLabel(page: Page, label: string): Promise<string> {
  await page
    .locator(
      '[data-wireframe-source-pointer="/root/screens/0/root/children/0/children/0"]',
    )
    .click();
  const panel = page.getByRole("complementary", {
    name: "Редактор элемента",
    exact: true,
  });
  await panel.getByLabel("Название элемента", { exact: true }).fill(label);
  await panel.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    panel.getByText("Название сохранено.", { exact: false }),
  ).toBeVisible({ timeout: 45_000 });
  await panel
    .getByRole("button", { name: "Закрыть редактор элемента" })
    .click();
  const saveResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/editor/file") &&
      response.request().method() === "PUT",
  );
  await page
    .getByRole("button", { name: "Сохранить версию", exact: true })
    .click();
  const response = await saveResponsePromise;
  const saved = await response.json();
  expect(response.status(), JSON.stringify(saved)).toBe(200);
  expect(saved.commit?.versionId).toBeTruthy();
  await expect(
    page.getByRole("button", { name: "Сохранить версию", exact: true }),
  ).toBeEnabled();
  await expect(page.getByTestId("editor-wireframe")).toBeVisible();
  return saved.commit.versionId;
}

test.describe("editor-web durable author history", { tag: "@editor" }, () => {
  test("saves two versions through MVP and restores older content through the history API", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    let sessionId: string | undefined;
    try {
      const opening = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/editor/session") &&
          response.request().method() === "POST",
      );
      await page.goto(
        `${editorUrl}/?gameId=simple-choice&file=game.authoring.json`,
      );
      const response = await opening;
      expect(response.status()).toBe(200);
      sessionId = (await response.json()).session.sessionId;
      await expect(page.getByTestId("editor-wireframe")).toBeVisible();
      const firstLabel = `Версия 1 · ${sessionId}`;
      const firstVersionId = await saveElementLabel(page, firstLabel);
      const secondVersionId = await saveElementLabel(
        page,
        `Версия 2 · ${sessionId}`,
      );
      const historyResponse = await request.get(
        `${editorUrl}/api/editor/history?sessionId=${sessionId}&limit=5`,
      );
      expect(historyResponse.status()).toBe(200);
      const history = await historyResponse.json();
      expect(
        history.versions
          .slice(0, 2)
          .map((version: { versionId: string }) => version.versionId),
      ).toEqual([secondVersionId, firstVersionId]);

      const restoreResponse = await request.post(
        `${editorUrl}/api/editor/history`,
        {
          data: {
            sessionId,
            versionId: firstVersionId,
            expectedHead: secondVersionId,
          },
        },
      );
      const restored = await restoreResponse.json();
      expect(restoreResponse.status(), JSON.stringify(restored)).toBe(200);
      expect(restored.currentVersionId).not.toBe(firstVersionId);
      expect(restored.currentVersionId).not.toBe(secondVersionId);
      const fileResponse = await request.get(
        `${editorUrl}/api/editor/file?gameId=simple-choice&filePath=ui/web.authoring.json&sessionId=${sessionId}`,
      );
      expect(fileResponse.status()).toBe(200);
      const document = JSON.parse((await fileResponse.json()).text);
      expect(document.root.screens[0].root.children[0].children[0]._label).toBe(
        firstLabel,
      );
    } finally {
      await page.close().catch(() => undefined);
      if (sessionId)
        await request.delete(`${editorUrl}/api/editor/session`, {
          data: { sessionId },
        });
    }
  });
});
