import { defineConfig, devices } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * Playwright configuration for the three-service e2e path
 * (runtime-api + player-web + editor-web).
 *
 * Server modes (E2E_SERVER_MODE):
 * - "dev" (default): Next.js apps run through `next dev`. Convenient for
 *   iterating, but `next dev` compiles routes on demand DURING the tests.
 *   On weak hosts (~4 cores) that on-demand compilation starves the
 *   interactive preview round-trip and the heavy editor dev compile can be
 *   SIGTERM'd outright (see
 *   docs/reviews/2026-07-05-remediation-closeout-and-e2e-blockers.md).
 * - "prod": Next.js apps run through `next start` against a prebuilt `.next`.
 *   No compilation happens while tests run, so the interactive loop only
 *   costs render + HTTP. Builds MUST be done beforehand and sequentially —
 *   use `npm run test:e2e:prod` (scripts/dev/run-e2e-prod.mjs), which builds
 *   player-web and editor-web one at a time with the correct build-time envs
 *   (player-web bakes RUNTIME_API_URL into its rewrites at build time).
 *
 * Low-resource mode (E2E_LOW_RESOURCE=1): disables trace/video/screenshot
 * capture. Playwright records trace and video during EVERY run and only
 * decides retention afterwards ("retain-on-failure"), so recording itself
 * costs CPU — a real tax on a starved host. CI keeps full capture.
 *
 * Player-only mode (E2E_PLAYER_ONLY=1): starts runtime-api and player-web but
 * not editor-web. Use it for delivery tests that never visit the authoring
 * surface; this avoids a second Next.js dev process on the shared host.
 */
const serverMode = process.env.E2E_SERVER_MODE === "prod" ? "prod" : "dev";
const lowResource = process.env.E2E_LOW_RESOURCE === "1";
const playerOnly = process.env.E2E_PLAYER_ONLY === "1";

const runtimePort = Number(process.env.E2E_RUNTIME_PORT ?? 3201);
const playerPort = Number(process.env.E2E_PLAYER_PORT ?? 3200);
const editorPort = Number(process.env.E2E_EDITOR_PORT ?? 3202);
const runtimeUrl = `http://127.0.0.1:${runtimePort}`;
const playerUrl = `http://127.0.0.1:${playerPort}`;
const editorUrl = `http://127.0.0.1:${editorPort}`;
const editorProjectRoot = playerOnly
  ? ""
  : process.env.E2E_EDITOR_PROJECT_ROOT ?? prepareEditorProjectRoot();

if (!playerOnly) {
  process.env.E2E_EDITOR_PROJECT_ROOT = editorProjectRoot;
  process.env.E2E_EDITOR_URL = editorUrl;
}
process.env.E2E_RUNTIME_URL = runtimeUrl;
process.env.E2E_PLAYER_URL = playerUrl;

/** `next dev`/`next start` command for a workspace app, bound to loopback. */
function nextAppCommand(workspace: string, port: number): string {
  const script = serverMode === "prod" ? "start" : "dev";
  return `npm run ${script} --workspace ${workspace} -- --hostname 127.0.0.1 --port ${port}`;
}

export default defineConfig({
  testDir: "./apps",
  testMatch: "**/e2e/*.spec.ts",
  timeout: 45_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["dot"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: playerUrl,
    trace: lowResource ? "off" : "retain-on-failure",
    screenshot: lowResource ? "off" : "only-on-failure",
    video: lowResource ? "off" : "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: [
    {
      command: "npm run dev --workspace services/runtime-api",
      url: `${runtimeUrl}/health`,
      env: {
        PORT: String(runtimePort),
        CUBICA_ENABLE_MOCK_AGENT_RUNTIME: "false",
        EDITOR_PREVIEW_WORKTREES_ROOTS: [
          path.join(process.cwd(), ".tmp", "editor-worktrees"),
          path.join(editorProjectRoot, ".tmp", "editor-worktrees")
        ].join(path.delimiter)
      },
      timeout: 120_000,
      reuseExistingServer: !process.env.CI
    },
    {
      command: nextAppCommand("@cubica/player-web", playerPort),
      url: playerUrl,
      env: {
        PORT: String(playerPort),
        RUNTIME_API_URL: runtimeUrl,
        PLAYER_WEB_URL: playerUrl,
        NEXT_IGNORE_INCORRECT_LOCKFILE: "1"
      },
      timeout: 120_000,
      reuseExistingServer: !process.env.CI
    },
    ...(!playerOnly ? [{
      command: nextAppCommand("@cubica/editor-web", editorPort),
      url: editorUrl,
      env: {
        PORT: String(editorPort),
        RUNTIME_API_URL: runtimeUrl,
        PLAYER_WEB_URL: playerUrl,
        EDITOR_PROJECT_ROOT: editorProjectRoot,
        NEXT_IGNORE_INCORRECT_LOCKFILE: "1"
      },
      timeout: 120_000,
      reuseExistingServer: !process.env.CI
    }] : [])
  ]
});

function prepareEditorProjectRoot(): string {
  const repoRoot = process.cwd();
  const targetRoot = path.join(repoRoot, ".tmp", "e2e-editor-project");
  rmSync(targetRoot, { recursive: true, force: true });
  mkdirSync(targetRoot, { recursive: true });

  copyFixturePath("games", targetRoot);
  copyFixturePath(path.join("docs", "architecture", "schemas"), targetRoot);
  copyFixturePath(path.join("scripts", "manifest-tools"), targetRoot);

  execFileSync("git", ["init"], { cwd: targetRoot, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "e2e@cubica.local"], { cwd: targetRoot, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Cubica E2E"], { cwd: targetRoot, stdio: "ignore" });
  execFileSync("git", ["add", "--", "games", "docs", "scripts"], { cwd: targetRoot, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "Create editor e2e fixture"], { cwd: targetRoot, stdio: "ignore" });

  return targetRoot;
}

function copyFixturePath(relativePath: string, targetRoot: string): void {
  const sourcePath = path.join(process.cwd(), relativePath);
  if (!existsSync(sourcePath)) {
    throw new Error(`Required e2e fixture path was not found: ${sourcePath}`);
  }

  cpSync(sourcePath, path.join(targetRoot, relativePath), {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}.git${path.sep}`) && !source.endsWith(`${path.sep}.git`)
  });
}
