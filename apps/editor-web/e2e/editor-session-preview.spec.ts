import { expect, test } from "@playwright/test";
import { appendFile } from "node:fs/promises";
import path from "node:path";

const editorUrl = process.env.E2E_EDITOR_URL ?? "http://127.0.0.1:3202";
const runtimeUrl = process.env.E2E_RUNTIME_URL ?? "http://127.0.0.1:3201";
const separator = "\n=======================\n";

function withOneOff(raw: string, intent: string): string {
  const boundary = raw.indexOf(separator);
  if (boundary < 0) throw Error("Missing first prompt separator");
  return intent + raw.slice(boundary);
}
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
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (error) => console.error("Editor browser error:", error.stack));
    const userId = `e2e-mvp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await page.route("**/api/editor/session", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.continue({ postData: JSON.stringify({ ...route.request().postDataJSON(), userId }) });
    });
  });
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
      await page.getByRole("button", { name: "Закрепить меню", exact: true }).click();
      await expect(page.getByRole("button", { name: "Открепить меню", exact: true })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "Чат", exact: true }).click();
      await page.getByRole("button", { name: "＋ Новый диалог", exact: true }).click();
      const conversations = page.getByRole("complementary", { name: "Диалоги", exact: true });
      const initialChatTitle = await conversations.locator('button[aria-current="true"]').innerText();
      await page.getByRole("button", { name: "Редактор", exact: true }).click();
      const score = page.locator(
        '[data-wireframe-source-pointer="/root/screens/0/root/children/0/children/0"]',
      );
      await score.click();
      const panel = page.locator('[aria-label="Редактор элемента"]');
      await expect(panel).toBeVisible();
      const draft = panel.getByRole("textbox", { name: "Единый текст элемента" });
      const original = await draft.inputValue();
      const sections = original.split(separator);
      expect(sections).toHaveLength(3);
      const scoreLabel = `Счёт MVP ${Date.now()}`;
      sections[1] = "Показывает текущий счёт.";
      sections[2] = sections[2].replace(/^_label:.*(?=\n|$)/, `_label: ${JSON.stringify(scoreLabel)}`);
      await draft.fill(sections.join(separator));
      await panel.getByRole("button", { name: "Сохранить элемент" }).click();
      await expect(
        panel.getByText("Авторское описание сохранено.", { exact: false }),
      ).toBeVisible({ timeout: 45000 });
      const savedSource = await request.get(`${editorUrl}/api/editor/file?gameId=simple-choice&filePath=ui/web.authoring.json&sessionId=${editorSessionId}`);
      expect(savedSource.status()).toBe(200);
      const savedUi = JSON.parse((await savedSource.json()).text);
      expect(savedUi.root.screens[0].root.children[0].children[0]._label).toBe(scoreLabel);
      expect(savedUi.root.screens[0].root.children[0].children[0]._prompt.raw).toBe("Показывает текущий счёт.");

      await panel
        .getByRole("button", { name: "Закрыть редактор элемента" })
        .click();
      await page
        .locator(
          '[data-wireframe-source-pointer="/root/screens/0/root/children/1/children/0"]',
        )
        .click();
      const buttonDraft = panel.getByRole("textbox", { name: "Единый текст элемента" });
      const candidateText = `Проверка MVP ${Date.now()}`;
      await buttonDraft.fill(withOneOff(await buttonDraft.inputValue(), `Измени текст на «${candidateText}»`));
      await panel.getByRole("button", { name: "Сохранить элемент" }).click();
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
          .getByText(candidateText, { exact: true }),
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
      const resizeHandle = page.getByRole("button", { name: "Изменить размер элемента: se" });
      await expect(resizeHandle).toBeEnabled({ timeout: 15000 });
      await page.mouse.move(800, 700);
      await expect(
        page.getByRole("listbox", { name: "Слои под указателем" }),
      ).not.toBeVisible({ timeout: 5_000 });
      const resize = await resizeHandle.boundingBox();
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
      await page.getByRole("button", { name: "Выбор игры" }).click();
      await expect(page.getByRole("combobox", { name: "Текущая игра" })).toHaveValue("simple-choice");
      await page.getByRole("button", { name: "Сохранить версию", exact: true }).click();
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
      const metricDraft = panel.getByRole("textbox", { name: "Единый текст элемента" });
      const freePrompt = `Сделай показатель заметнее (${Date.now()})`;
      await metricDraft.fill(withOneOff(await metricDraft.inputValue(), freePrompt));
      await panel.getByRole("button", { name: "Сохранить элемент" }).click();
      await expect(
        page.getByRole("region", { name: "Чат с агентом" }),
      ).toBeVisible();
      await expect(
        page.getByText(freePrompt, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Контекст выбранного источника (", { exact: false }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Сценарий", exact: true }).click();
      await page.getByRole("menuitem", { name: "Правила", exact: true }).click();
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
        .getByRole("button", { name: initialChatTitle, exact: true })
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
      await expect(page.getByLabel("Инструкция для промта или текстовая пометка")).toBeVisible();
      await page.keyboard.type("Button");
      await expect(
        page.getByLabel("Инструкция для промта или текстовая пометка"),
      ).toHaveValue("Button");
      await page
        .getByRole("button", { name: "Текст на рисунке" })
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
      await expect(page.getByLabel("Инструкция для промта или текстовая пометка")).toBeVisible();
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
      await page.getByRole("button", { name: "Сценарий", exact: true }).click();
      await page.getByRole("menuitem", { name: "Правила", exact: true }).click();
    } finally {
      await page.close().catch(() => undefined);
      if (editorSessionId)
        await request.delete(`${editorUrl}/api/editor/session`, {
          data: { sessionId: editorSessionId },
        });
    }
  });
  test("keeps one editable draft and reveals the toolbar across its full width", async ({ page, request }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1200, height: 900 });
    let sessionId: string | undefined;
    try {
      const opening = page.waitForResponse((response) => response.url().endsWith("/api/editor/session") && response.request().method() === "POST");
      await page.goto(`${editorUrl}/?gameId=simple-choice&file=game.authoring.json`);
      const response = await opening;
      expect(response.status()).toBe(200);
      sessionId = (await response.json()).session.sessionId;
      await expect(page.getByTestId("editor-wireframe")).toBeVisible();

      const menu = page.locator('[aria-label="Плавающее меню редактора"]');
      const reveal = async () => {
        const box = await menu.boundingBox();
        if (!box) throw Error("Missing toolbar proximity area");
        await page.mouse.move(box.x + box.width / 2, 2);
        await expect(menu).toHaveAttribute("data-expanded", "true");
      };
      const toolbar = page.getByRole("toolbar", { name: "Панель инструментов" });
      await expect(toolbar.getByRole("button")).toHaveCount(6);
      await reveal();
      await expect(menu).toHaveAttribute("data-expanded", "true");
      const active = toolbar.locator('[aria-current="page"]');
      const expanded = await active.boundingBox();
      if (!expanded) throw Error("Missing active tool");
      await page.mouse.move(1100, 700);
      await expect(menu).toHaveAttribute("data-expanded", "false");
      const menuBox = await menu.boundingBox();
      if (!menuBox) throw Error("Missing floating toolbar");
      await page.mouse.move(menuBox.x + menuBox.width - 10, menuBox.y + menuBox.height / 2);
      await expect(menu).toHaveAttribute("data-expanded", "true");
      const revealed = await active.boundingBox();
      if (!revealed) throw Error("Missing revealed active tool");
      expect(Math.abs(revealed.x - expanded.x)).toBeLessThan(1);

      await page.locator('[data-wireframe-source-pointer="/root/screens/0/root/children/0/children/0"]').click();
      const panel = page.locator('[aria-label="Редактор элемента"]');
      const draft = panel.getByRole("textbox", { name: "Единый текст элемента" });
      const initial = await draft.inputValue();
      expect(initial.split(separator)).toHaveLength(3);
      await draft.focus();
      await draft.evaluate((node) => (node as HTMLTextAreaElement).setSelectionRange(0, 0));
      await page.keyboard.type("x");
      await draft.evaluate((node, marker) => {
        const textarea = node as HTMLTextAreaElement;
        const pos = textarea.value.indexOf(marker) + marker.length;
        textarea.setSelectionRange(pos, pos);
      }, separator);
      await page.keyboard.type("y");
      await draft.evaluate((node) => {
        const textarea = node as HTMLTextAreaElement;
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      });
      await page.keyboard.type("z");
      await draft.press("ControlOrMeta+z");
      await draft.press("ControlOrMeta+z");
      await draft.press("ControlOrMeta+z");
      await expect(draft).toHaveValue(initial);

      const invalid = `${initial}${separator}лишний раздел`;
      await draft.fill(invalid);
      await panel.getByRole("button", { name: "Сохранить элемент" }).click();
      await expect(panel.getByRole("status")).toContainText("Количество разделителей: 3; нужно 2");
      await expect(draft).toHaveValue(invalid);
      await expect(page.getByRole("region", { name: "Предложенное изменение" })).toHaveCount(0);
      await reveal();
      await page.getByRole("button", { name: "Чат", exact: true }).click();
      await expect(panel).not.toBeVisible();
      await reveal();
      await page.getByRole("button", { name: "Редактор", exact: true }).click();
      await expect(draft).toBeVisible();
      await expect(draft).toHaveValue(invalid);
    } finally {
      await page.close().catch(() => undefined);
      if (sessionId) await request.delete(`${editorUrl}/api/editor/session`, { data: { sessionId } });
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
      const sessionResponse = await sessionResponsePromise;
      expect(sessionResponse.status()).toBe(200);
      const sessionBody =
        (await sessionResponse.json()) as EditorSessionListResponse;
      editorSessionId = sessionBody.session.sessionId;
      await expect(page.getByTestId("editor-wireframe")).toBeVisible({ timeout: 45_000 });

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
