import { expect, test } from "@playwright/test";
import { appendFile } from "node:fs/promises";
import path from "node:path";

const editorUrl = process.env.E2E_EDITOR_URL ?? "http://127.0.0.1:3202";
const runtimeUrl = process.env.E2E_RUNTIME_URL ?? "http://127.0.0.1:3201";
interface EditorSessionListResponse {
  readonly session: { readonly sessionId: string };
}
interface EditorPreviewResponse {
  readonly ready?: boolean;
  readonly diagnostics?: readonly { readonly message?: string }[];
}
interface PlayerContentWithPlugins {
  readonly pluginBundles?: readonly {
    readonly pluginId: string;
    readonly scope?: string;
    readonly url: string;
  }[];
}

// These scenarios replace the removed tree/JSON/timeline UI tests. They exercise
// the same real session, compiler and runtime through the approved MVP surfaces.
test.describe("editor MVP", { tag: "@editor" }, () => {
  test("edits a candidate, transforms an element, restores current UI and sends a drawing", async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1600, height: 1200 });
    let editorSessionId: string | undefined;
    try {
      const opening = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/editor/session") &&
          r.request().method() === "POST",
      );
      await page.goto(
        editorUrl + "/?gameId=simple-choice&file=game.authoring.json",
      );
      const response = await opening;
      const body = await response.json();
      if (response.status() !== 200) throw Error("Session creation failed");
      editorSessionId = body.session.sessionId;
      await expect(page.getByTestId("editor-wireframe")).toBeVisible({
        timeout: 45000,
      });
      await page
        .getByRole("button", { name: "Закрепить меню", exact: true })
        .click();
      const score = page.locator(
        '[data-wireframe-source-pointer="/root/screens/0/root/children/0/children/0"]',
      );
      await score.click();
      const panel = page.getByRole("complementary", {
        name: "Редактор элемента",
        exact: true,
      });
      await expect(panel).toBeVisible();
      await panel
        .getByLabel("Название элемента", { exact: true })
        .fill("Счёт MVP");
      await panel
        .getByRole("button", { name: "Сохранить", exact: true })
        .click();
      await expect(
        panel.getByText("Название сохранено.", { exact: false }),
      ).toBeVisible({ timeout: 45000 });
      await panel
        .getByLabel("Авторское описание элемента", { exact: true })
        .fill("Показывает текущий счёт.");
      await panel
        .getByRole("button", { name: "Сохранить описание", exact: true })
        .click();
      await expect(
        panel.getByText("Авторское описание сохранено.", { exact: false }),
      ).toBeVisible({ timeout: 45000 });

      await panel
        .getByRole("button", { name: "Закрыть редактор элемента" })
        .click();
      await page
        .locator(
          '[data-wireframe-source-pointer="/root/screens/0/root/children/1/children/0"]',
        )
        .click();
      await panel
        .getByLabel("Разовая правка элемента", { exact: true })
        .fill("Измени текст на «Проверка MVP»");
      await panel.getByRole("button", { name: "Подготовить вариант" }).click();
      const candidate = page.getByRole("region", {
        name: "Предложенное изменение",
      });
      await expect(candidate).toBeVisible({ timeout: 60000 });
      await expect(
        candidate.getByRole("button", { name: "Применить изменение" }),
      ).toBeEnabled({ timeout: 45000 });
      await expect(
        page
          .frameLocator('iframe[title="Предпросмотр предложенного изменения"]')
          .getByText("Проверка MVP", { exact: true }),
      ).toBeVisible({ timeout: 20000 });

      await candidate
        .getByRole("button", { name: "Применить изменение" })
        .click();
      await expect(candidate).not.toBeVisible({ timeout: 60000 });

      await expect(
        page.getByRole("button", { name: /^(Игра|Продолжить игру)$/ }),
      ).toBeEnabled({ timeout: 60000 });
      await page
        .getByRole("button", { name: /^(Игра|Продолжить игру)$/ })
        .click();
      const frame = page.locator('iframe[title="Предпросмотр игры"]');
      await expect(frame).toBeVisible({ timeout: 60000 });
      await expect(
        page.getByRole("button", { name: "Пауза игры", exact: true }),
      ).toBeVisible({ timeout: 60000 });
      const player = page.frameLocator('iframe[title="Предпросмотр игры"]');
      await expect(
        player.getByRole("button", {
          name: "Choose the option with the visible tradeoff.",
        }),
      ).toBeVisible({ timeout: 20000 });
      await page
        .getByRole("button", { name: "Пауза игры", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Продолжить игру", exact: true }),
      ).toBeEnabled({ timeout: 15000 });
      await page.getByRole("button", { name: "Сценарий", exact: true }).click();
      await page
        .getByRole("button", { name: "Сохранить состояние", exact: true })
        .click();
      await page.getByRole("dialog").getByLabel("Название").fill("До выбора");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Сохранить состояние" })
        .click();
      await expect(page.getByRole("dialog")).not.toBeVisible({
        timeout: 15000,
      });
      await page.getByRole("button", { name: "Сценарий", exact: true }).click();
      await expect(
        page.getByRole("menuitem", { name: "До выбора", exact: true }),
      ).toBeEnabled();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Редактор", exact: true }).click();

      const metric = player.locator(
        '[data-preview-runtime-pointer="/screens/intro/root/children/0/children/0"]',
      );
      await expect(metric).toBeVisible();
      const metricBox = await metric.boundingBox();
      if (!metricBox) throw Error("Missing metric");
      await page.mouse.click(
        metricBox.x + metricBox.width / 2,
        metricBox.y + metricBox.height / 2,
      );
      await expect(
        page.getByRole("button", {
          name: "Изменить размер элемента",
          exact: true,
        }),
      ).toBeEnabled({ timeout: 15000 });
      await page.mouse.move(800, 700);
      await expect(
        page.getByRole("listbox", { name: "Слои под указателем" }),
      ).not.toBeVisible({ timeout: 5_000 });
      const resize = await page
        .getByRole("button", { name: "Изменить размер элемента", exact: true })
        .boundingBox();
      if (!resize) throw new Error("Missing resize handle");
      const beforeResizeUrl = await frame.getAttribute("src");
      await page.mouse.move(
        resize.x + resize.width / 2,
        resize.y + resize.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        resize.x + resize.width / 2 + 60,
        resize.y + resize.height / 2 + 20,
        { steps: 6 },
      );
      await page.mouse.up();
      await expect
        .poll(() => frame.getAttribute("src"), { timeout: 60000 })
        .not.toBe(beforeResizeUrl);
      await expect(metric).toBeVisible({ timeout: 20000 });
      await expect
        .poll(
          () =>
            metric.evaluate((el) =>
              Math.round(el.getBoundingClientRect().width),
            ),
          { timeout: 10000 },
        )
        .toBe(Math.round(metricBox.width) + 60);

      await expect(
        page.getByRole("button", { name: "Продолжить игру", exact: true }),
      ).toBeEnabled({ timeout: 15000 });
      await page
        .getByRole("button", { name: "Продолжить игру", exact: true })
        .click();
      await player
        .getByRole("button", {
          name: "Choose the option with the visible tradeoff.",
        })
        .click();
      await expect(
        player.getByRole("heading", { name: "Result", exact: true }),
      ).toBeVisible({ timeout: 15000 });
      await page.getByRole("button", { name: "Сценарий", exact: true }).click();
      await page
        .getByRole("menuitem", { name: "До выбора", exact: true })
        .click();
      await expect(
        player.getByRole("button", {
          name: "Choose the option with the visible tradeoff.",
        }),
      ).toBeVisible({ timeout: 15000 });
      await expect(
        page.getByRole("button", { name: "Продолжить игру", exact: true }),
      ).toBeEnabled({ timeout: 15000 });
      await expect
        .poll(
          () =>
            metric.evaluate((el) =>
              Math.round(el.getBoundingClientRect().width),
            ),
          { timeout: 10000 },
        )
        .toBe(Math.round(metricBox.width) + 60);

      // Saving an author version must preserve the current paused preview.
      const restoredPreviewUrl = await frame.getAttribute("src");
      const versionSave = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/editor/file") &&
          response.request().method() === "PUT",
      );
      await page
        .getByRole("button", { name: "Сохранить версию", exact: true })
        .click();
      expect((await versionSave).status()).toBe(200);
      await expect(
        page.getByRole("button", { name: "Сохранить версию", exact: true }),
      ).toBeEnabled();
      await expect(frame).toHaveAttribute("src", restoredPreviewUrl!);
      await expect(
        page.getByRole("button", { name: "Продолжить игру", exact: true }),
      ).toBeEnabled();

      const restoredMetricBox = await metric.boundingBox();
      if (!restoredMetricBox) throw new Error("Missing restored metric");
      await page.mouse.click(
        restoredMetricBox.x + restoredMetricBox.width / 2,
        restoredMetricBox.y + restoredMetricBox.height / 2,
      );
      await expect(panel).toBeVisible();
      await panel
        .getByLabel("Разовая правка элемента", { exact: true })
        .fill("Сделай показатель заметнее");
      await panel.getByRole("button", { name: "Подготовить вариант" }).click();
      await expect(
        page.getByRole("region", { name: "Чат с агентом" }),
      ).toBeVisible();
      await expect(
        page.getByText("Сделай показатель заметнее", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Контекст выбранного источника (", { exact: false }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Правила", exact: true }),
      ).toBeEnabled();

      await page.getByRole("button", { name: "Правила", exact: true }).click();
      await expect(page.getByTestId("mvp-rules-panel")).toBeVisible();
      await page
        .getByTestId("mvp-rules-text")
        .fill("Игрок делает один выбор и получает результат.");
      await page
        .getByTestId("mvp-rules-panel")
        .getByRole("button", { name: "Сохранить", exact: true })
        .click();
      await expect(
        page
          .getByTestId("mvp-rules-panel")
          .getByRole("button", { name: "Сохранить", exact: true }),
      ).toBeDisabled({ timeout: 45000 });

      await page.getByRole("button", { name: "Чат", exact: true }).click();
      const chatInput = page.getByPlaceholder(
        "Опишите изменение для выбранного объекта",
      );
      await chatInput.fill("Как работать с редактором?");
      await chatInput.press("Enter");
      await expect(
        page.getByText("Подключён локальный помощник.", { exact: false }),
      ).toBeVisible({ timeout: 20000 });
      await page
        .getByRole("button", { name: "＋ Новый диалог", exact: true })
        .click();
      await expect(
        page.getByText("Как работать с редактором?", { exact: true }),
      ).not.toBeVisible();
      await page
        .getByRole("complementary", { name: "Диалоги", exact: true })
        .getByRole("button", { name: "Работа над игрой", exact: true })
        .click();
      await expect(
        page.getByText("Как работать с редактором?", { exact: true }),
      ).toBeVisible();

      await page
        .getByRole("button", { name: "Рисование", exact: true })
        .click();
      const canvas = page.getByLabel("Холст рисования", { exact: true });
      const rect = await canvas.boundingBox();
      if (!rect) throw Error("Missing drawing canvas");
      await page.mouse.move(rect.x + 200, rect.y + 200);
      await page.mouse.down();
      await page.mouse.move(rect.x + 300, rect.y + 220, { steps: 8 });
      await page.mouse.up();
      await expect(
        page.getByRole("button", { name: "Открыть ввод промта" }),
      ).toBeVisible();
      await page.keyboard.type("Button");
      await expect(
        page.getByLabel("Инструкция для промта или текстовая пометка"),
      ).toHaveValue("Button");
      await page
        .getByRole("button", { name: "Добавить текст на рисунок" })
        .click();

      await page.locator("input[type=file]").setInputFiles({
        name: "reference.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
          "base64",
        ),
      });
      await expect(page.locator("input[type=file]")).toBeEnabled();
      await page.mouse.click(rect.x + 400, rect.y + 350);
      await page.getByRole("button", { name: "Открыть ввод промта" }).click();
      await page
        .getByLabel("Инструкция для промта или текстовая пометка")
        .fill("Объясни этот рисунок");
      await page
        .getByRole("button", { name: "Отправить промт", exact: true })
        .click();
      await expect(
        page.getByRole("region", { name: "Чат с агентом" }),
      ).toBeVisible({ timeout: 15000 });
      await expect(
        page
          .getByRole("complementary", { name: "Материалы диалога" })
          .getByRole("img", { name: "Исходное изображение" }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("complementary", { name: "Материалы диалога" })
          .getByRole("img", { name: "Рисунок и надписи" }),
      ).toBeVisible();

      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "Правила", exact: true }).click();
    } finally {
      await page.close().catch(() => undefined);
      if (editorSessionId)
        await request.delete(`${editorUrl}/api/editor/session`, {
          data: { sessionId: editorSessionId },
        });
    }
  });
  test("serves changed Antarctica session plugin bundle to preview", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    let editorSessionId: string | undefined;

    try {
      const sessionResponsePromise = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/editor/session") &&
          response.request().method() === "POST",
      );

      await page.goto(
        `${editorUrl}/?gameId=antarctica&file=game.authoring.json`,
      );
      await expect(page.getByTestId("editor-wireframe")).toBeVisible();

      const sessionResponse = await sessionResponsePromise;
      expect(sessionResponse.status()).toBe(200);
      const sessionBody =
        (await sessionResponse.json()) as EditorSessionListResponse;
      editorSessionId = sessionBody.session.sessionId;

      const marker = `e2e-session-plugin-${editorSessionId}`;
      const editorProjectRoot = process.env.E2E_EDITOR_PROJECT_ROOT;
      expect(editorProjectRoot).toBeTruthy();
      await appendFile(
        path.join(
          editorProjectRoot ?? "",
          ".tmp",
          "editor-worktrees",
          editorSessionId,
          "games",
          "antarctica",
          "plugins",
          "antarctica-player",
          "src",
          "index.ts",
        ),
        `\nexport const E2E_PREVIEW_MARKER = ${JSON.stringify(marker)};\n`,
        "utf8",
      );

      const previewButton = page.getByRole("button", {
        name: "Подготовить превью",
        exact: true,
      });
      await expect(previewButton).toBeEnabled();
      const previewResponsePromise = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/editor/preview") &&
          response.request().method() === "POST",
      );
      await previewButton.click();

      const previewResponse = await previewResponsePromise;
      expect(previewResponse.status()).toBe(200);
      const previewBody =
        (await previewResponse.json()) as EditorPreviewResponse;
      expect(
        previewBody.ready,
        JSON.stringify(previewBody.diagnostics ?? []),
      ).toBe(true);

      const contentResponse = await request.get(
        `${runtimeUrl}/games/antarctica/player-content?contentSourceId=${editorSessionId}`,
      );
      expect(contentResponse.status()).toBe(200);
      const content =
        (await contentResponse.json()) as PlayerContentWithPlugins;
      expect(content.pluginBundles?.[0]?.pluginId).toBe("antarctica-player");
      expect(content.pluginBundles?.[0]?.scope).toBe("preview");

      const bundleUrl = new URL(
        content.pluginBundles?.[0]?.url ?? "",
        runtimeUrl,
      );
      const bundleResponse = await request.get(bundleUrl.toString());
      expect(bundleResponse.status()).toBe(200);
      expect(await bundleResponse.text()).toContain(marker);
    } finally {
      await page.close().catch(() => undefined);
      if (editorSessionId !== undefined) {
        await request.delete(`${editorUrl}/api/editor/session`, {
          data: { sessionId: editorSessionId },
        });
      }
    }
  });
});
