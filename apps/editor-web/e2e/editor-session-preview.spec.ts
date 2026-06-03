import { expect, test, type Locator } from "@playwright/test";
import { appendFile } from "node:fs/promises";
import path from "node:path";

const editorUrl = process.env.E2E_EDITOR_URL ?? "http://127.0.0.1:3202";
const runtimeUrl = process.env.E2E_RUNTIME_URL ?? "http://127.0.0.1:3201";

interface EditorSessionListResponse {
  readonly session: {
    readonly sessionId: string;
    readonly branchName: string;
  };
}

interface EditorPreviewResponse {
  readonly ready?: boolean;
  readonly playerUrl?: string;
  readonly sourceMaps?: readonly unknown[];
  readonly diagnostics?: readonly { readonly message?: string }[];
}

interface PlayerContentWithPlugins {
  readonly pluginBundles?: readonly {
    readonly pluginId: string;
    readonly contentHash: string;
    readonly scope?: string;
    readonly url: string;
  }[];
}

async function centerOfFrameElement(locator: Locator): Promise<{ readonly x: number; readonly y: number }> {
  const rect = await locator.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    };
  });

  expect(rect.width).toBeGreaterThan(0);
  expect(rect.height).toBeGreaterThan(0);
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2
  };
}

async function expectLocatorWidthStable(locator: Locator, expectedWidth: number, tolerancePx = 2): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs((box?.width ?? 0) - expectedWidth)).toBeLessThanOrEqual(tolerancePx);
}

test.describe("editor-web session preview", () => {
  test("opens a session worktree and prepares player preview with contentSourceId", async ({ page, request }) => {
    let editorSessionId: string | undefined;

    try {
      const sessionResponsePromise = page.waitForResponse((response) =>
        response.url().endsWith("/api/editor/session") && response.request().method() === "POST"
      );

      await page.goto(`${editorUrl}/?gameId=simple-choice&file=game.authoring.json`);
      await expect(page.getByLabel("Editor toolbar")).toContainText("Cubica Editor");

      const sessionResponse = await sessionResponsePromise;
      expect(sessionResponse.status()).toBe(200);
      const sessionBody = (await sessionResponse.json()) as EditorSessionListResponse;
      editorSessionId = sessionBody.session.sessionId;
      expect(sessionBody.session.branchName).toContain(`editor/session/${editorSessionId}`);

      await expect(page.getByLabel("Editor status")).toContainText(sessionBody.session.branchName);
      const previewStage = page.locator('section[aria-label="Game preview"]');
      const previewStageBeforeRightSidebar = await previewStage.boundingBox();
      expect(previewStageBeforeRightSidebar).not.toBeNull();

      await page.locator('aside[aria-label="Manifest navigation"] .tree-row-main').first().click();
      const propertiesSidebar = page.locator('aside[aria-label="Selected node properties"]');
      await expect(propertiesSidebar).toBeVisible();
      await expect(propertiesSidebar.locator(".property-panel-sidebar")).toBeVisible();
      await expectLocatorWidthStable(previewStage, previewStageBeforeRightSidebar?.width ?? 0);
      await expect(page.locator('aside[aria-label="Authoring JSON editor"]')).toHaveCount(0);
      await page.getByRole("button", { name: "JSON", exact: true }).click();
      const jsonSidebar = page.locator('aside[aria-label="Authoring JSON editor"]');
      await expect(jsonSidebar).toBeVisible();
      await expectLocatorWidthStable(previewStage, previewStageBeforeRightSidebar?.width ?? 0);
      await jsonSidebar.getByRole("button", { name: "Collapse" }).click();
      await expect(jsonSidebar).toHaveCount(0);

      const leftSidebar = page.locator('aside[aria-label="Manifest navigation"]');
      const leftSidebarBeforeResize = await leftSidebar.boundingBox();
      expect(leftSidebarBeforeResize).not.toBeNull();
      const leftResizeHandle = page.getByTestId("left-sidebar-resize-handle");
      const leftResizeHandleBox = await leftResizeHandle.boundingBox();
      expect(leftResizeHandleBox).not.toBeNull();
      await page.mouse.move(
        (leftResizeHandleBox?.x ?? 0) + (leftResizeHandleBox?.width ?? 0) / 2,
        (leftResizeHandleBox?.y ?? 0) + (leftResizeHandleBox?.height ?? 0) / 2
      );
      await page.mouse.down();
      await page.mouse.move(
        (leftResizeHandleBox?.x ?? 0) + (leftResizeHandleBox?.width ?? 0) / 2 + 80,
        (leftResizeHandleBox?.y ?? 0) + (leftResizeHandleBox?.height ?? 0) / 2
      );
      await page.mouse.up();
      const leftSidebarAfterResize = await leftSidebar.boundingBox();
      expect(leftSidebarAfterResize?.width ?? 0).toBeGreaterThan((leftSidebarBeforeResize?.width ?? 0) + 50);

      const previewButton = page.getByRole("button", { name: "Preview", exact: true });
      await expect(previewButton).toBeEnabled();

      const previewResponsePromise = page.waitForResponse((response) =>
        response.url().endsWith("/api/editor/preview") && response.request().method() === "POST"
      );
      await previewButton.click();

      const previewResponse = await previewResponsePromise;
      expect(previewResponse.status()).toBe(200);
      const previewBody = (await previewResponse.json()) as EditorPreviewResponse;
      expect(previewBody.ready, JSON.stringify(previewBody.diagnostics ?? [])).toBe(true);
      expect(previewBody.playerUrl).toBeDefined();
      expect((previewBody.sourceMaps ?? []).length).toBeGreaterThan(0);

      const playerUrl = new URL(previewBody.playerUrl ?? "");
      expect(playerUrl.searchParams.get("preview")).toBe("1");
      expect(playerUrl.searchParams.get("contentSourceId")).toBe(editorSessionId);
      expect(playerUrl.searchParams.get("sessionId")).toBeTruthy();

      const contentResponse = await request.get(
        `${runtimeUrl}/games/simple-choice/player-content?contentSourceId=${editorSessionId}`
      );
      expect(contentResponse.status()).toBe(200);

      const editorStatus = page.getByLabel("Editor status");
      await expect(editorStatus).toContainText("Preview:");
      const frame = page.frameLocator('iframe[title="Game preview"]');
      await expect(frame.getByRole("heading", { name: "Simple Choice" })).toBeVisible();
      await expect(frame.locator("[data-preview-runtime-pointer]").first()).toBeVisible();
      await expect(editorStatus).toContainText(/[1-9][0-9]* selectable/);

      await page.getByLabel("Preview mode").getByRole("button", { name: "Inspect" }).click();
      const overlay = page.getByTestId("preview-selection-overlay");
      const selectableMetric = frame.locator('[data-preview-semantic-role="gameVariableComponent"]').first();
      await expect(selectableMetric).toBeVisible();
      const targetPoint = await centerOfFrameElement(selectableMetric);
      await overlay.click({ modifiers: ["Control"], position: targetPoint });
      await expect(page.locator('aside[aria-label="Selected node properties"]')).toBeVisible();
      await expect(page.locator(".preview-highlight-frame")).toBeVisible();
      await overlay.click({ button: "right", position: targetPoint });
      await expect(page.locator(".preview-object-context-menu")).toBeVisible();
    } finally {
      await page.close().catch(() => undefined);
      if (editorSessionId !== undefined) {
        await request.delete(`${editorUrl}/api/editor/session`, {
          data: { sessionId: editorSessionId }
        });
      }
    }
  });

  test("supports Inspect selection and context menu for Antarctica fallback preview", async ({ page, request }) => {
    let editorSessionId: string | undefined;

    try {
      const sessionResponsePromise = page.waitForResponse((response) =>
        response.url().endsWith("/api/editor/session") && response.request().method() === "POST"
      );

      await page.goto(`${editorUrl}/?gameId=antarctica&file=game.authoring.json`);
      await expect(page.getByLabel("Editor toolbar")).toContainText("Cubica Editor");

      const sessionResponse = await sessionResponsePromise;
      expect(sessionResponse.status()).toBe(200);
      const sessionBody = (await sessionResponse.json()) as EditorSessionListResponse;
      editorSessionId = sessionBody.session.sessionId;

      const previewButton = page.getByRole("button", { name: "Preview", exact: true });
      await expect(previewButton).toBeEnabled();
      const previewResponsePromise = page.waitForResponse((response) =>
        response.url().endsWith("/api/editor/preview") && response.request().method() === "POST"
      );
      await previewButton.click();
      const previewResponse = await previewResponsePromise;
      expect(previewResponse.status()).toBe(200);
      const previewBody = (await previewResponse.json()) as EditorPreviewResponse;
      expect(previewBody.ready, JSON.stringify(previewBody.diagnostics ?? [])).toBe(true);

      const editorStatus = page.getByLabel("Editor status");
      const frame = page.frameLocator('iframe[title="Game preview"]');
      const titleEntity = frame.locator('[data-preview-runtime-pointer="/content/data/infos/0/title"]');
      await expect(titleEntity).toBeVisible();
      await expect(editorStatus).toContainText(/[1-9][0-9]* selectable/);

      await page.getByLabel("Preview mode").getByRole("button", { name: "Inspect" }).click();
      const overlay = page.getByTestId("preview-selection-overlay");
      const targetPoint = await centerOfFrameElement(titleEntity);
      await overlay.click({ modifiers: ["Control"], position: targetPoint });

      const propertiesSidebar = page.locator('aside[aria-label="Selected node properties"]');
      await expect(propertiesSidebar).toBeVisible();
      await expect(propertiesSidebar).toContainText("/root/content/data/infos/0/title");
      await expect(page.locator(".preview-highlight-frame")).toContainText("info-title");

      await overlay.click({ button: "right", position: targetPoint });
      const contextMenu = page.locator(".preview-object-context-menu");
      await expect(contextMenu).toBeVisible();
      await expect(contextMenu).toContainText("info-title");
    } finally {
      await page.close().catch(() => undefined);
      if (editorSessionId !== undefined) {
        await request.delete(`${editorUrl}/api/editor/session`, {
          data: { sessionId: editorSessionId }
        });
      }
    }
  });

  test("rolls back preview runtime state without dirtying authoring JSON", async ({ page, request }) => {
    let editorSessionId: string | undefined;

    try {
      const sessionResponsePromise = page.waitForResponse((response) =>
        response.url().endsWith("/api/editor/session") && response.request().method() === "POST"
      );

      await page.goto(`${editorUrl}/?gameId=simple-choice&file=game.authoring.json`);
      await expect(page.getByLabel("Editor toolbar")).toContainText("Cubica Editor");

      const sessionResponse = await sessionResponsePromise;
      const sessionBody = (await sessionResponse.json()) as EditorSessionListResponse;
      editorSessionId = sessionBody.session.sessionId;

      const previewButton = page.getByRole("button", { name: "Preview", exact: true });
      const previewResponsePromise = page.waitForResponse((response) =>
        response.url().endsWith("/api/editor/preview") && response.request().method() === "POST"
      );
      await previewButton.click();
      const previewResponse = await previewResponsePromise;
      const previewBody = (await previewResponse.json()) as EditorPreviewResponse;
      expect(previewBody.ready, JSON.stringify(previewBody.diagnostics ?? [])).toBe(true);

      const frame = page.frameLocator('iframe[title="Game preview"]');
      await expect(frame.getByRole("heading", { name: "Simple Choice" })).toBeVisible();
      await page.getByRole("button", { name: "Timeline" }).click();
      const timelinePanel = page.locator('aside[aria-label="Timeline"]');
      await expect(timelinePanel).not.toContainText("Chronology");
      await expect(timelinePanel).toContainText("T0");
      await expect(timelinePanel).toContainText("Initial runtime state");
      const traceDetails = page.getByLabel("Preview trace details");
      await expect(traceDetails).toContainText("Current T0");
      await expect(traceDetails.getByRole("button", { name: "Reset to start" })).toBeVisible();
      await expect(traceDetails.getByRole("button", { name: "Replay current" })).toBeVisible();

      await expect(page.getByLabel("Preview mode").getByRole("button", { name: "Inspect" })).toBeVisible();
      const floatingProperties = page.locator(".property-panel");
      await expect(floatingProperties).toBeHidden();
      await frame.getByRole("button", { name: "Choose path" }).click();
      await expect(frame.getByRole("heading", { name: "Result" })).toBeVisible();
      await expect(timelinePanel).toContainText("T1");
      await expect(timelinePanel).toContainText("choice.accept");
      await expect(traceDetails).toContainText("Current T1");
      await expect(traceDetails.getByLabel("Selected trace event payload")).toContainText("choice.accept");

      await timelinePanel.getByRole("button", { name: /T0.*Initial runtime state/ }).click();
      await expect(traceDetails).toContainText("T0: Initial runtime state");
      const rollbackResponsePromise = page.waitForResponse((response) =>
        response.url().endsWith("/api/editor/preview/rollback") && response.request().method() === "POST"
      );
      await traceDetails.getByRole("button", { name: "Restore selected" }).click();
      const rollbackResponse = await rollbackResponsePromise;
      expect(rollbackResponse.status()).toBe(200);

      await expect(frame.getByRole("heading", { name: "Simple Choice" })).toBeVisible();
      await expect(timelinePanel).not.toContainText("T1");
      await expect(traceDetails).toContainText("Current T0");
      await expect(page.getByLabel("Editor status")).toContainText("Clean");

      await frame.getByRole("button", { name: "Choose path" }).click();
      await expect(frame.getByRole("heading", { name: "Result" })).toBeVisible();
      await expect(timelinePanel.getByRole("button", { name: /T1.*choice.accept/ })).toHaveCount(1);
      await expect(traceDetails).toContainText("Current T1");
    } finally {
      await page.close().catch(() => undefined);
      if (editorSessionId !== undefined) {
        await request.delete(`${editorUrl}/api/editor/session`, {
          data: { sessionId: editorSessionId }
        });
      }
    }
  });

  test("serves changed Antarctica session plugin bundle to preview", async ({ page, request }) => {
    let editorSessionId: string | undefined;

    try {
      const sessionResponsePromise = page.waitForResponse((response) =>
        response.url().endsWith("/api/editor/session") && response.request().method() === "POST"
      );

      await page.goto(`${editorUrl}/?gameId=antarctica&file=game.authoring.json`);
      await expect(page.getByLabel("Editor toolbar")).toContainText("Cubica Editor");

      const sessionResponse = await sessionResponsePromise;
      expect(sessionResponse.status()).toBe(200);
      const sessionBody = (await sessionResponse.json()) as EditorSessionListResponse;
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
          "index.ts"
        ),
        `\nexport const E2E_PREVIEW_MARKER = ${JSON.stringify(marker)};\n`,
        "utf8"
      );

      const previewButton = page.getByRole("button", { name: "Preview", exact: true });
      await expect(previewButton).toBeEnabled();
      const previewResponsePromise = page.waitForResponse((response) =>
        response.url().endsWith("/api/editor/preview") && response.request().method() === "POST"
      );
      await previewButton.click();

      const previewResponse = await previewResponsePromise;
      expect(previewResponse.status()).toBe(200);
      const previewBody = (await previewResponse.json()) as EditorPreviewResponse;
      expect(previewBody.ready, JSON.stringify(previewBody.diagnostics ?? [])).toBe(true);

      const contentResponse = await request.get(
        `${runtimeUrl}/games/antarctica/player-content?contentSourceId=${editorSessionId}`
      );
      expect(contentResponse.status()).toBe(200);
      const content = (await contentResponse.json()) as PlayerContentWithPlugins;
      expect(content.pluginBundles?.[0]?.pluginId).toBe("antarctica-player");
      expect(content.pluginBundles?.[0]?.scope).toBe("preview");

      const bundleUrl = new URL(content.pluginBundles?.[0]?.url ?? "", runtimeUrl);
      const bundleResponse = await request.get(bundleUrl.toString());
      expect(bundleResponse.status()).toBe(200);
      expect(await bundleResponse.text()).toContain(marker);
    } finally {
      await page.close().catch(() => undefined);
      if (editorSessionId !== undefined) {
        await request.delete(`${editorUrl}/api/editor/session`, {
          data: { sessionId: editorSessionId }
        });
      }
    }
  });
});
