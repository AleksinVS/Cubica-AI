import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { realpath, writeFile } from "node:fs/promises";
import path from "node:path";

const editorUrl = process.env.E2E_EDITOR_URL ?? "http://127.0.0.1:3202";
const separator = "\n=======================\n";
const frameSelector = 'iframe[title="Предпросмотр игры"]';
const infoTitlePointer = "/screens/info-topbar/root/children/1/children/0/children/0/children/1/children/0";
const remainingDaysPointer = "/screens/info-topbar/root/children/0/children/0";
const trustMetricPointer = "/screens/info-topbar/root/children/0/children/2";
const firstTitle = 'Корпорация "Антарктика"';
const secondTitle = "Мы находимся далеко-далеко на юге…";

test.use({ actionTimeout: 20_000 });

type GameAuthoring = {
  root: { content: { data: { infos: { id: string; title: string; body: string }[];
    metrics: { metricId: string; label: string }[] } } };
};
type UiNode = { props?: { html?: string }; children?: UiNode[] };
type UiAuthoring = {
  root: { metric_specs: { id: string }[]; screens: { id: string; root: UiNode }[] };
};

function requireIsolatedEditor() {
  if (!process.env.E2E_EDITOR_PROJECT_ROOT) throw Error("E2E_EDITOR_PROJECT_ROOT must be an isolated project fixture");
}

async function openAntarctica(page: Page): Promise<string> {
  const opening = page.waitForResponse((response) =>
    response.url().endsWith("/api/editor/session") && response.request().method() === "POST");
  await page.goto(`${editorUrl}/?gameId=antarctica&file=game.authoring.json`);
  const response = await opening;
  expect(response.status()).toBe(200);
  const body = await response.json() as { session: { sessionId: string; worktreePath?: string } };
  const fixtureRoot = process.env.E2E_EDITOR_PROJECT_ROOT;
  if (!fixtureRoot) throw Error("Missing isolated editor project root");
  const worktreesRoot = await realpath(path.join(fixtureRoot, ".tmp", "editor-worktrees"));
  const sessionWorktree = await realpath(body.session.worktreePath ?? path.join(worktreesRoot, body.session.sessionId));
  expect(path.relative(worktreesRoot, sessionWorktree)).toBe(body.session.sessionId);
  await expect(page.locator(frameSelector)).toBeVisible({ timeout: 60_000 });
  // The first playable screen must appear without a manual Compile/Preview action.
  await expect(page.frameLocator(frameSelector).locator(`[data-preview-runtime-pointer="${infoTitlePointer}"]`))
    .toContainText(firstTitle, { timeout: 90_000 });
  await revealToolbar(page);
  await page.getByRole("button", { name: "Закрепить меню", exact: true }).click();
  return body.session.sessionId;
}

async function revealToolbar(page: Page) {
  const menu = page.locator('[aria-label="Плавающее меню редактора"]');
  const bounds = await menu.boundingBox();
  if (!bounds) throw Error("Missing floating editor menu");
  await page.mouse.move(bounds.x + bounds.width / 2, 2);
  await expect(menu).toHaveAttribute("data-expanded", "true");
}

async function selectPreviewNode(page: Page, pointer: string) {
  const node = page.frameLocator(frameSelector).locator(`[data-preview-runtime-pointer="${pointer}"]`);
  await expect(node).toBeVisible({ timeout: 60_000 });
  const target = { point: null as { x: number; y: number } | null };
  // Wait for actual layout metadata and an exposed point: a floating prompt can cover the center.
  await expect.poll(async () => {
    const dom = await node.boundingBox();
    const frame = await page.locator(frameSelector).boundingBox();
    if (!dom || !frame) return false;
    target.point = await page.evaluate(({ pointer, dom, frame }) => {
      const entities = (window as Window & { __adr108Entities?: {
        runtimePointer: string; bounds: { x: number; y: number; width: number; height: number }
      }[] }).__adr108Entities;
      const reported = entities?.find(item => item.runtimePointer === pointer)?.bounds;
      const expected = { x: dom.x - frame.x, y: dom.y - frame.y, width: dom.width, height: dom.height };
      if (!reported || !(Object.keys(expected) as (keyof typeof expected)[])
        .every(key => Math.abs(reported[key] - expected[key]) < 2)) return null;
      for (const [fx, fy] of [[0.5, 0.5], [0.08, 0.5], [0.92, 0.5], [0.5, 0.2], [0.5, 0.8]]) {
        const point = { x: dom.x + dom.width * fx!, y: dom.y + dom.height * fy! };
        const hit = document.elementFromPoint(point.x, point.y);
        if (hit && !hit.closest("button") && (hit.matches('[data-testid="preview-selection-overlay"]') ||
            hit.closest('[aria-label^="Выбран элемент:"]'))) return point;
      }
      return null;
    }, { pointer, dom, frame });
    return target.point !== null;
  }, { timeout: 15_000, message: `Ready exposed inspector point for ${pointer}` }).toBe(true);
  if (target.point === null) throw Error(`Missing inspector point for ${pointer}`);
  await page.mouse.click(target.point.x, target.point.y);
  return target.point;
}

async function chooseInfo(page: Page, title: string) {
  await page.getByRole("button", { name: "Сценарий", exact: true }).click();
  await page.getByRole("menuitem", { name: `Содержимое · ${title}`, exact: true }).click();
  await expect(page.frameLocator(frameSelector).locator(`[data-preview-runtime-pointer="${infoTitlePointer}"]`))
    .toContainText(title, { timeout: 60_000 });
}

async function readAuthoring<T>(request: APIRequestContext, sessionId: string, filePath: string): Promise<T> {
  const query = new URLSearchParams({ gameId: "antarctica", filePath, sessionId });
  const response = await request.get(`${editorUrl}/api/editor/file?${query}`);
  expect(response.status()).toBe(200);
  return JSON.parse((await response.json() as { text: string }).text) as T;
}

async function closeSession(page: Page, request: APIRequestContext, sessionId: string | undefined) {
  if (!page.isClosed()) {
    const stem = `.tmp/adr108/browser-${test.info().testId.replace(/[^a-z0-9-]/gi, "_")}`;
    await page.screenshot({ path: `${stem}.png` }).catch(() => undefined);
    await writeFile(`${stem}.txt`, await page.locator("body").innerText()).catch(() => undefined);
  }
  await page.close().catch(() => undefined);
  if (sessionId) {
    await expect.poll(async () => {
      const deleted = await request.delete(`${editorUrl}/api/editor/session`, { data: { sessionId } });
      const body = await deleted.json();
      if (deleted.status() === 409 && body.code === "session_busy") return false;
      expect(deleted.ok(), JSON.stringify(body)).toBe(true);
      return true;
    }, { timeout: 30_000, intervals: [250, 500, 1000] }).toBe(true);
  }
}

test.describe("Antarctica semantic authoring projection", { tag: "@editor" }, () => {
  test.beforeEach(async ({ page }) => {
    requireIsolatedEditor();
    await page.addInitScript(() => {
      if (window !== window.top) return;
      window.addEventListener("message", event => {
        if (event.data?.source === "cubica-player-web" && event.data?.type === "previewEntities") {
          (window as Window & { __adr108Entities?: unknown }).__adr108Entities = event.data.entities;
        }
      });
    });
    const userId = `e2e-semantic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await page.route("**/api/editor/session", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.continue({ postData: JSON.stringify({ ...route.request().postDataJSON(), userId }) });
    });
  });

  test("keeps transient layers separate from the measured prompt at both viewport edges", async ({ page, request }) => {
    test.setTimeout(180_000);
    let sessionId: string | undefined;
    try {
      await page.setViewportSize({ width: 1600, height: 1200 });
      sessionId = await openAntarctica(page);
      const panel = page.locator('[aria-label="Редактор элемента"]');
      for (const sample of [
        { width: 1600, height: 1200, pointer: infoTitlePointer, name: "center" },
        { width: 1600, height: 1200, pointer: "/screens/info-topbar/root/children/0/children/7", name: "right" },
        { width: 390, height: 844, pointer: infoTitlePointer, name: "narrow" }
      ]) {
        if (await panel.isVisible()) await panel.getByRole("button", { name: "Закрыть редактор элемента" }).click();
        await page.setViewportSize({ width: sample.width, height: sample.height });
        const point = await selectPreviewNode(page, sample.pointer);
        const layers = page.getByRole("listbox", { name: "Слои под указателем", exact: true });
        await layers.getByRole("option").first().focus();
        await expect.poll(async () => {
          const a = await panel.boundingBox();
          const b = await layers.boundingBox();
          if (!a || !b) return false;
          const disjoint = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
          return disjoint && b.x >= 0 && b.y >= 0 && b.x + b.width <= sample.width + 1 && b.y + b.height <= sample.height + 1;
        }).toBe(true);
        if (sample.name === "right") {
          const a = (await panel.boundingBox())!;
          const b = (await layers.boundingBox())!;
          expect(a.x + a.width).toBeLessThanOrEqual(point.x);
          expect(b.x).toBeGreaterThanOrEqual(point.x);
        }
        await page.screenshot({ path: `.tmp/ui-compare/editor-feedback-20260921/placement-${sample.name}.png` });
      }
    } finally { await closeSession(page, request, sessionId); }
  });

  test("edits the actual selected info title while preserving its UI binding and sibling", async ({ page, request }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1600, height: 1200 });
    let sessionId: string | undefined;
    try {
      sessionId = await openAntarctica(page);
      const gameBefore = await readAuthoring<GameAuthoring>(request, sessionId, "game.authoring.json");
      const uiBefore = await readAuthoring<UiAuthoring>(request, sessionId, "ui/web.authoring.json");
      expect(gameBefore.root.content.data.infos.slice(0, 2).map((info) => info.title))
        .toEqual([firstTitle, secondTitle]);

      await selectPreviewNode(page, infoTitlePointer);
      const panel = page.locator('[aria-label="Редактор элемента"]');
      await expect(panel).toBeVisible();
      const draft = panel.getByRole("textbox", { name: "Единый текст элемента" });
      const sections = (await draft.inputValue()).split(separator);
      expect(sections).toHaveLength(3);
      expect(sections[2]).toContain(`Содержание:\n  Текст заголовка: ${JSON.stringify(firstTitle)}`);
      expect(sections[2]).toMatch(/^Элемент:\n  Название элемента:/m);
      expect(sections[2]).not.toContain("{{currentInfo.title}}");
      expect(sections[2]).not.toMatch(/\b(?:_type|_projection|contentRuntimePointer|sourcePointer):/u);
      await page.screenshot({ path: ".tmp/adr108/semantic-title.png" });
      for (const viewport of [{ width: 768, height: 1024 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await expect.poll(async () => {
          const bounds = await panel.boundingBox();
          return !!bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1;
        }).toBe(true);
        await page.screenshot({ path: `.tmp/adr108/semantic-title-${viewport.width}.png` });
      }
      await page.setViewportSize({ width: 1600, height: 1200 });
      const changedTitle = `Корпорация Антарктика — проверка ${Date.now()}`;
      sections[2] = sections[2].replace(
        `Текст заголовка: ${JSON.stringify(firstTitle)}`,
        `Текст заголовка: ${JSON.stringify(changedTitle)}`
      );
      await draft.fill(sections.join(separator));
      await panel.getByRole("button", { name: "Сохранить элемент" }).click();
      const candidate = page.getByRole("region", { name: "Предложенное изменение" });
      await expect(candidate).toBeVisible({ timeout: 60_000 });
      await expect(candidate).toContainText("Изменение игрового содержимого или правила затронет все его отображения.");
      await candidate.getByRole("button", { name: "Применить изменение" }).click();
      await expect(candidate).not.toBeVisible({ timeout: 60_000 });
      await expect(page.frameLocator(frameSelector).locator(`[data-preview-runtime-pointer="${infoTitlePointer}"]`))
        .toContainText(changedTitle, { timeout: 90_000 });

      const gameAfter = await readAuthoring<GameAuthoring>(request, sessionId, "game.authoring.json");
      const uiAfter = await readAuthoring<UiAuthoring>(request, sessionId, "ui/web.authoring.json");
      expect(gameAfter.root.content.data.infos[0].title).toBe(changedTitle);
      expect(gameAfter.root.content.data.infos[0].body).toBe(gameBefore.root.content.data.infos[0].body);
      expect(gameAfter.root.content.data.infos.slice(1)).toEqual(gameBefore.root.content.data.infos.slice(1));
      expect(uiAfter).toEqual(uiBefore);
      const titleNode = uiAfter.root.screens.find((screen) => screen.id === "info-topbar")
        ?.root.children?.[1]?.children?.[0]?.children?.[0]?.children?.[1]?.children?.[0];
      expect(titleNode?.props?.html).toBe("{{currentInfo.title}}");

      if (await panel.isVisible()) await panel.getByRole("button", { name: "Закрыть редактор элемента" }).click();
      await chooseInfo(page, secondTitle);
      await selectPreviewNode(page, infoTitlePointer);
      const otherDraft = await panel.getByRole("textbox", { name: "Единый текст элемента" }).inputValue();
      expect(otherDraft.split(separator)[2]).toContain(`Текст заголовка: ${JSON.stringify(secondTitle)}`);
      expect(otherDraft).not.toContain(changedTitle);
    } finally {
      await closeSession(page, request, sessionId);
    }
  });

  test("shows the remaining-days rule in words from one game metric catalog", async ({ page, request }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1600, height: 1200 });
    let sessionId: string | undefined;
    try {
      sessionId = await openAntarctica(page);
      await selectPreviewNode(page, remainingDaysPointer);
      const panel = page.locator('[aria-label="Редактор элемента"]');
      const yaml = (await panel.getByRole("textbox", { name: "Единый текст элемента" }).inputValue()).split(separator)[2];
      expect(yaml).toContain('Название показателя: "Остаток дней"');
      expect(yaml).toMatch(/Правило вычисления:.*Из значения.*вычесть значение/u);
      expect(yaml).not.toMatch(/(?:\{\{|"var"|"-"|public\.metrics\.|content\.rules\.|Правило требует проверки агентом)/u);
      await page.screenshot({ path: ".tmp/adr108/semantic-rule.png" });

      const game = await readAuthoring<GameAuthoring>(request, sessionId, "game.authoring.json");
      const ui = await readAuthoring<UiAuthoring>(request, sessionId, "ui/web.authoring.json");
      const metricIds = game.root.content.data.metrics.map((metric) => metric.metricId);
      const visibleMetricIds = ui.root.metric_specs.map((metric) => metric.id);
      expect(metricIds).toHaveLength(9);
      expect(new Set(metricIds).size).toBe(metricIds.length);
      expect(visibleMetricIds).toHaveLength(8);
      expect(new Set(visibleMetricIds).size).toBe(visibleMetricIds.length);
      expect(visibleMetricIds.every((id) => metricIds.includes(id))).toBe(true);
      expect(metricIds.filter((id) => id === "remainingDays")).toHaveLength(1);
    } finally {
      await closeSession(page, request, sessionId);
    }
  });

  test("previews prototype defaults in the same locked frame and restores the instance draft", async ({ page, request }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1600, height: 1200 });
    let sessionId: string | undefined;
    try {
      sessionId = await openAntarctica(page);
      const frame = page.frameLocator(frameSelector);
      const trustMetric = frame.locator(`[data-preview-runtime-pointer="${trustMetricPointer}"]`);
      await expect(trustMetric).toContainText("Доверие");
      await selectPreviewNode(page, trustMetricPointer);
      const panel = page.locator('[aria-label="Редактор элемента"]');
      const draft = panel.getByRole("textbox", { name: "Единый текст элемента" });
      const original = await draft.inputValue();
      expect(original.split(separator)).toHaveLength(3);
      const unsaved = `Черновик экземпляра ${Date.now()}${original.slice(original.indexOf(separator))}`;
      await draft.fill(unsaved);
      await expect(panel.getByRole("button", { name: "Слои: Доверие", exact: true })).toBeVisible();
      await panel.getByRole("button", { name: /Слои:/u }).click();
      await page.getByRole("option", { name: "Редактировать прототип" }).click();
      await expect(panel.getByText(/Прототип:/u)).toBeVisible({ timeout: 60_000 });
      await expect(trustMetric).toContainText("Знания", { timeout: 60_000 });
      await expect(trustMetric).not.toContainText("Доверие");
      expect(await draft.inputValue()).not.toContain("Черновик экземпляра");
      await page.screenshot({ path: ".tmp/adr108/semantic-prototype.png" });

      const token = `same-document-${Date.now()}`;
      await frame.locator("html").evaluate((html, value) => {
        (html.ownerDocument as Document & { __e2ePreviewToken?: string }).__e2ePreviewToken = value;
      }, token);
      await panel.getByRole("button", { name: "Сохранить элемент" }).click();
      await expect(panel.getByRole("status")).toContainText("Изменений нет.");
      expect(await frame.locator("html").evaluate((html) =>
        (html.ownerDocument as Document & { __e2ePreviewToken?: string }).__e2ePreviewToken)).toBe(token);
      await expect(page.getByRole("region", { name: "Предложенное изменение" })).not.toBeVisible();

      // A live game action in the background must not advance the scene while the prototype is open.
      const advance = frame.getByRole("button", { name: "Вперед", exact: true });
      await expect(advance).toBeEnabled();
      await advance.evaluate((button) => (button as HTMLButtonElement).click());
      await expect(frame.locator(`[data-preview-runtime-pointer="${infoTitlePointer}"]`)).toContainText(firstTitle);
      await expect(panel.getByText(/Прототип:/u)).toBeVisible();
      await panel.getByRole("button", { name: "Вернуться к экземпляру" }).click();
      await expect(trustMetric).toContainText("Доверие", { timeout: 60_000 });
      await expect(draft).toHaveValue(unsaved);
      expect(await frame.locator("html").evaluate((html) =>
        (html.ownerDocument as Document & { __e2ePreviewToken?: string }).__e2ePreviewToken)).toBe(token);

      await draft.fill(original);
      await panel.getByRole("button", { name: "Сохранить элемент" }).click({ button: "right" });
      await panel.getByRole("button", { name: "Сохранить как шаблон", exact: true }).click();
      await expect(panel.getByRole("status")).toContainText("Прототип сохранён", { timeout: 60_000 });
      await expect(page.getByText("Обновляем игру… Можно продолжать редактирование.", { exact: true })).not.toBeVisible({ timeout: 60_000 });
      expect(await frame.locator("html").evaluate((html) =>
        (html.ownerDocument as Document & { __e2ePreviewToken?: string }).__e2ePreviewToken)).toBe(token);
    } finally {
      await closeSession(page, request, sessionId);
    }
  });

  test("clears an applied prototype when selection changes before its acknowledgement", async ({ page, request }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1600, height: 1200 });
    await page.addInitScript(() => {
      if (window !== window.top) return;
      type HeldAck = { data: unknown; origin: string; source: MessageEventSource | null };
      const probe = {
        intercepted: false,
        held: null as HeldAck | null,
        release() {
          const message = this.held;
          if (message === null) throw Error("No prototype acknowledgement was held");
          this.held = null;
          window.dispatchEvent(new MessageEvent("message", message));
        }
      };
      (window as Window & { __adr108PrototypeAck?: typeof probe }).__adr108PrototypeAck = probe;
      window.addEventListener("message", (event) => {
        if (probe.intercepted || event.data?.source !== "cubica-player-web" ||
            event.data?.type !== "previewPrototypeResult" || event.data?.ok !== true) return;
        probe.intercepted = true;
        probe.held = { data: event.data, origin: event.origin, source: event.source };
        event.stopImmediatePropagation();
      }, true);
    });

    let sessionId: string | undefined;
    try {
      sessionId = await openAntarctica(page);
      const frame = page.frameLocator(frameSelector);
      const trustMetric = frame.locator(`[data-preview-runtime-pointer="${trustMetricPointer}"]`);
      await expect(trustMetric).toContainText("Доверие");
      await selectPreviewNode(page, trustMetricPointer);
      const panel = page.locator('[aria-label="Редактор элемента"]');
      await expect(panel.getByRole("button", { name: "Слои: Доверие", exact: true })).toBeVisible();
      await panel.getByRole("button", { name: /Слои:/u }).click();
      await page.getByRole("option", { name: "Редактировать прототип" }).click();

      // The player has applied the real compiled replacement, while the editor still awaits its first ack.
      await expect.poll(() => page.evaluate(() => Boolean(
        (window as Window & { __adr108PrototypeAck?: { held: unknown } }).__adr108PrototypeAck?.held
      ))).toBe(true);
      await expect(trustMetric).toContainText("Знания", { timeout: 60_000 });
      await expect(panel.getByText(/Прототип:/u)).not.toBeVisible();

      // An outside click first clears the existing selection; the next selects the title.
      await selectPreviewNode(page, infoTitlePointer);
      await selectPreviewNode(page, infoTitlePointer);
      const draft = panel.getByRole("textbox", { name: "Единый текст элемента" });
      await expect(panel.getByRole("button", { name: "Слои: Заголовок текущей информации", exact: true })).toBeVisible();
      await page.evaluate(() => {
        (window as Window & { __adr108PrototypeAck?: { release: () => void } }).__adr108PrototypeAck?.release();
      });

      await expect(trustMetric).toContainText("Доверие", { timeout: 60_000 });
      await expect(panel.getByText(/Прототип:/u)).not.toBeVisible();
      await expect.poll(() => draft.inputValue()).toContain(`Текст заголовка: ${JSON.stringify(firstTitle)}`);

      // A later explicit open/return must still work after the canceled operation drains.
      await selectPreviewNode(page, trustMetricPointer);
      await selectPreviewNode(page, trustMetricPointer);
      await expect(panel.getByRole("button", { name: "Слои: Доверие", exact: true })).toBeVisible();
      await panel.getByRole("button", { name: /Слои:/u }).click();
      await page.getByRole("option", { name: "Редактировать прототип" }).click();
      await expect(panel.getByText(/Прототип:/u)).toBeVisible({ timeout: 60_000 });
      await expect(trustMetric).toContainText("Знания");
      await panel.getByRole("button", { name: "Вернуться к экземпляру" }).click();
      await expect(trustMetric).toContainText("Доверие", { timeout: 60_000 });
    } finally {
      await closeSession(page, request, sessionId);
    }
  });

  test("reloads the frame if the player rejects clearing an active prototype", async ({ page, request }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1600, height: 1200 });
    await page.addInitScript(() => {
      if (window === window.top) return;
      const probe = { armed: false, injected: false };
      (window as Window & { __adr108ClearFailure?: typeof probe }).__adr108ClearFailure = probe;
      window.addEventListener("message", (event) => {
        if (!probe.armed || probe.injected || event.data?.source !== "cubica-editor-web" ||
            event.data?.type !== "showPreviewPrototype" || event.data?.component !== null) return;
        probe.injected = true;
        event.stopImmediatePropagation();
        // Do not apply the null replacement: this leaves the real player override active.
        sessionStorage.setItem("adr108:e2e-clear-failure", "1");
        window.parent.postMessage({ source: "cubica-player-web", type: "previewPrototypeResult",
          protocolVersion: 1, requestId: event.data.requestId,
          sessionId: event.data.sessionId, ok: false, error: "E2E clear rejection" }, event.origin);
      }, true);
    });

    let sessionId: string | undefined;
    try {
      sessionId = await openAntarctica(page);
      const frame = page.frameLocator(frameSelector);
      const trustMetric = frame.locator(`[data-preview-runtime-pointer="${trustMetricPointer}"]`);
      await expect(trustMetric).toContainText("Доверие", { timeout: 60_000 });
      await selectPreviewNode(page, trustMetricPointer);
      const panel = page.locator('[aria-label="Редактор элемента"]');
      await expect(panel.getByRole("button", { name: "Слои: Доверие", exact: true })).toBeVisible();
      await panel.getByRole("button", { name: /Слои:/u }).click();
      await page.getByRole("option", { name: "Редактировать прототип" }).click();
      await expect(panel.getByText(/Прототип:/u)).toBeVisible({ timeout: 60_000 });
      await expect(trustMetric).toContainText("Знания");

      const token = `failed-clear-document-${Date.now()}`;
      await frame.locator("html").evaluate((html, value) => {
        const player = html.ownerDocument.defaultView as (Window & {
          __adr108ClearFailure?: { armed: boolean; injected: boolean }
        }) | null;
        if (!player?.__adr108ClearFailure) throw Error("Missing clear-failure probe in player frame");
        player.__adr108ClearFailure.armed = true;
        (html.ownerDocument as Document & { __adr108DocumentToken?: string }).__adr108DocumentToken = value;
      }, token);
      expect(await frame.locator("html").evaluate((html) =>
        (html.ownerDocument as Document & { __adr108DocumentToken?: string }).__adr108DocumentToken)).toBe(token);
      await panel.getByRole("button", { name: "Вернуться к экземпляру" }).click();

      // Ordinary clear keeps the document; losing this token proves failure recovery reloaded it.
      await expect.poll(() => frame.locator("html").evaluate((html) =>
        (html.ownerDocument as Document & { __adr108DocumentToken?: string }).__adr108DocumentToken)
        .catch(() => token), { timeout: 90_000 }).toBeUndefined();
      expect(await frame.locator("html").evaluate((html) =>
        html.ownerDocument.defaultView?.sessionStorage.getItem("adr108:e2e-clear-failure"))).toBe("1");
      await expect(trustMetric).toContainText("Доверие", { timeout: 90_000 });
      await expect(panel.getByText(/Прототип:/u)).not.toBeVisible();
      await selectPreviewNode(page, infoTitlePointer);
      await expect.poll(() => panel.getByRole("textbox", { name: "Единый текст элемента" }).inputValue())
        .toContain(`Текст заголовка: ${JSON.stringify(firstTitle)}`);
    } finally {
      await closeSession(page, request, sessionId);
    }
  });
});
