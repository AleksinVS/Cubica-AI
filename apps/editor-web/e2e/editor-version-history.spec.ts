import { expect, test, type Page } from "@playwright/test";

/**
 * Production E2E for durable author history in the session-backed editor.
 *
 * The scenario edits a visible authoring property through the real UI, so each
 * Save exercises the browser controller, session lease, file write, durable
 * version creation and history refresh. Restore is also initiated from the UI;
 * the final property assertion proves that the active document/projection was
 * reloaded rather than merely updating the history list.
 */

const editorUrl = process.env.E2E_EDITOR_URL ?? "http://127.0.0.1:3202";

interface EditorSessionListResponse {
  readonly session: {
    readonly sessionId: string;
  };
}

interface SavedEditorFileResponse {
  readonly commit?: {
    readonly versionId?: string;
  };
}

interface EditorHistoryResponse {
  readonly versions: readonly { readonly versionId: string; readonly summary: string }[];
}

interface EditorRestoreResponse {
  readonly currentVersionId: string;
}

/** Selects `/root` and returns its editable `_label` field. */
async function openRootLabelField(page: Page) {
  const treeSidebar = page.locator('aside[aria-label="Навигация по манифесту"]');
  if (!await treeSidebar.isVisible()) {
    await page.getByRole("button", { name: "Дерево", exact: true }).click();
  }
  await expect(treeSidebar).toBeVisible();
  await treeSidebar.locator('[data-tree-pointer="/root"] .tree-row-main').click();
  const propertiesSidebar = page.locator('aside[aria-label="Свойства выбранного узла"]');
  await expect(propertiesSidebar).toBeVisible();
  const labelInput = propertiesSidebar.locator(".property-field").filter({ hasText: "_label" }).locator("input").first();
  // Locator actions have no default action timeout in this project. Make a
  // missing editor field fail with the normal assertion timeout instead of
  // consuming the whole multi-step scenario timeout.
  await expect(labelInput).toBeEditable();
  return labelInput;
}

/** Performs an ordinary one-click Save and waits for the durable version response. */
async function saveCurrentDocument(page: Page): Promise<string> {
  const saveButton = page.getByTestId("save-version-action");
  await expect(saveButton).toBeEnabled();
  const saveResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/editor/file") && response.request().method() === "PUT"
  );
  await saveButton.click();
  const saveResponse = await saveResponsePromise;
  const saved = (await saveResponse.json()) as SavedEditorFileResponse;
  expect(saveResponse.status(), JSON.stringify(saved)).toBe(200);
  expect(saved.commit?.versionId).toBeTruthy();
  await expect(saveButton).toBeDisabled();
  await expect(page.getByLabel("Статус редактора")).toContainText("Создана новая сохранённая версия");
  return saved.commit?.versionId ?? "";
}

test.describe("editor-web durable author history", () => {
  test("creates two Save versions and restores the older content as a new version", async ({ page, request }) => {
    // Two Save operations each run project-plugin validation. Production mode
    // is stable but the shared low-memory host can legitimately need more than
    // the suite-wide 45 seconds without indicating a functional timeout.
    test.setTimeout(120_000);
    let editorSessionId: string | undefined;

    try {
      const sessionResponsePromise = page.waitForResponse((response) =>
        response.url().endsWith("/api/editor/session") && response.request().method() === "POST"
      );
      await page.goto(`${editorUrl}/?gameId=simple-choice&file=game.authoring.json`);
      await expect(page.getByLabel("Панель инструментов редактора")).toContainText("Редактор Cubica");

      const sessionResponse = await sessionResponsePromise;
      expect(sessionResponse.status()).toBe(200);
      const sessionBody = (await sessionResponse.json()) as EditorSessionListResponse;
      editorSessionId = sessionBody.session.sessionId;
      // Session creation precedes the file/layout requests. Selecting a node
      // before this status can race `applyLoadedDocument`, which intentionally
      // closes a property panel opened against the intermediate document.
      await expect(page.getByLabel("Статус редактора")).toContainText("Loaded session");

      const firstLabel = `E2E сохранённая версия 1 · ${editorSessionId}`;
      const secondLabel = `E2E сохранённая версия 2 · ${editorSessionId}`;

      const firstLabelInput = await openRootLabelField(page);
      await firstLabelInput.fill(firstLabel);
      const firstVersionId = await saveCurrentDocument(page);

      const secondLabelInput = await openRootLabelField(page);
      await secondLabelInput.fill(secondLabel);
      const secondVersionId = await saveCurrentDocument(page);

      await page.getByRole("button", { name: "История", exact: true }).click();
      const historyPanel = page.locator('aside[aria-label="История"]');
      await expect(historyPanel).toBeVisible();
      await expect(historyPanel.getByText("Загружаем сохранённые версии…")).toBeHidden();
      await expect(historyPanel.getByTestId("history-error")).toHaveCount(0);
      const versionRows = historyPanel.getByTestId("history-version-row");
      await expect(versionRows.nth(0)).toBeVisible();
      await expect(versionRows.nth(1)).toBeVisible();

      // Confirm the two visible newest rows are our Save versions without
      // relying on a total row count (the UI page is intentionally bounded).
      const historyBeforeRestoreResponse = await request.get(
        `${editorUrl}/api/editor/history?sessionId=${encodeURIComponent(editorSessionId)}&limit=5`
      );
      expect(historyBeforeRestoreResponse.status()).toBe(200);
      const historyBeforeRestore = (await historyBeforeRestoreResponse.json()) as EditorHistoryResponse;
      expect(historyBeforeRestore.versions.slice(0, 2).map((version) => version.versionId))
        .toEqual([secondVersionId, firstVersionId]);

      // History is newest-first: our first Save is immediately below our second.
      await versionRows.nth(1).click();
      const details = historyPanel.getByTestId("history-version-details");
      await expect(details).toContainText("Изменённые файлы");
      const restoreButton = details.getByRole("button", { name: "Вернуть эту версию" });
      await expect(restoreButton).toBeEnabled();
      await restoreButton.click();

      const confirmation = page.getByRole("dialog", { name: "Вернуть выбранную версию?" });
      await expect(confirmation).toContainText("возврат будет сохранён как новая версия");
      const restoreResponsePromise = page.waitForResponse((response) =>
        response.url().endsWith("/api/editor/history") && response.request().method() === "POST"
      );
      await confirmation.getByRole("button", { name: "Вернуть версию", exact: true }).click();
      const restoreResponse = await restoreResponsePromise;
      const restored = (await restoreResponse.json()) as EditorRestoreResponse;
      expect(restoreResponse.status(), JSON.stringify(restored)).toBe(200);

      // The restore point itself is durable and appears without deleting either
      // original Save. These row assertions also wait for the controller refresh;
      // the Git integration test separately proves exact first-parent reachability.
      expect(restored.currentVersionId).not.toBe(firstVersionId);
      expect(restored.currentVersionId).not.toBe(secondVersionId);
      await expect(versionRows.first()).toContainText("Восстанов");
      await expect(versionRows.nth(1)).toBeVisible();
      await expect(versionRows.nth(2)).toBeVisible();

      const restoredLabelInput = await openRootLabelField(page);
      await expect(restoredLabelInput).toHaveValue(firstLabel);
      await expect(page.getByTestId("save-version-action")).toBeDisabled();
    } finally {
      await page.close().catch(() => undefined);
      if (editorSessionId !== undefined) {
        await request.delete(`${editorUrl}/api/editor/session`, {
          data: { sessionId: editorSessionId }
        }).catch(() => undefined);
      }
    }
  });
});
