import { expect, test } from "@playwright/test";
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

      await expect(page.getByLabel("Editor toolbar")).toContainText(sessionBody.session.branchName);
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

      const previewStage = page.getByLabel("Game preview");
      await expect(previewStage).toContainText("ready");
      const frame = page.frameLocator('iframe[title="Game preview"]');
      await expect(frame.getByRole("heading", { name: "Simple Choice" })).toBeVisible();
      await expect(frame.locator("[data-preview-runtime-pointer]").first()).toBeVisible();
      await expect(previewStage).toContainText(/[1-9][0-9]* selectable/);
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

      const previewStage = page.getByLabel("Game preview");
      const frame = page.frameLocator('iframe[title="Game preview"]');
      await expect(frame.getByRole("heading", { name: "Simple Choice" })).toBeVisible();
      await expect(page.getByLabel("Timeline")).toContainText("T0: Initial runtime state");

      await previewStage.getByRole("button", { name: "Inspect" }).click();
      const floatingProperties = page.locator(".property-panel");
      await floatingProperties.waitFor({ state: "visible", timeout: 1500 }).catch(() => undefined);
      if (await floatingProperties.isVisible()) {
        await floatingProperties.getByRole("button", { name: "Collapse" }).click();
        await expect(floatingProperties).toBeHidden();
      }
      await frame.getByRole("button", { name: "Choose path" }).click();
      await expect(frame.getByRole("heading", { name: "Result" })).toBeVisible();
      await expect(page.getByLabel("Timeline")).toContainText("T1: choice.accept");

      const rollbackResponsePromise = page.waitForResponse((response) =>
        response.url().endsWith("/api/editor/preview/rollback") && response.request().method() === "POST"
      );
      await page.getByLabel("Timeline").getByRole("button", { name: /T0: Initial runtime state/ }).click();
      const rollbackResponse = await rollbackResponsePromise;
      expect(rollbackResponse.status()).toBe(200);

      await expect(frame.getByRole("heading", { name: "Simple Choice" })).toBeVisible();
      await expect(page.getByLabel("Timeline")).not.toContainText("T1: choice.accept");
      await expect(page.getByLabel("Editor toolbar")).toContainText("Clean");
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
