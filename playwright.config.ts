import { defineConfig, devices } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const runtimePort = Number(process.env.E2E_RUNTIME_PORT ?? 3201);
const playerPort = Number(process.env.E2E_PLAYER_PORT ?? 3200);
const editorPort = Number(process.env.E2E_EDITOR_PORT ?? 3202);
const runtimeUrl = `http://127.0.0.1:${runtimePort}`;
const playerUrl = `http://127.0.0.1:${playerPort}`;
const editorUrl = `http://127.0.0.1:${editorPort}`;
const editorProjectRoot = process.env.E2E_EDITOR_PROJECT_ROOT ?? prepareEditorProjectRoot();

process.env.E2E_EDITOR_PROJECT_ROOT = editorProjectRoot;
process.env.E2E_EDITOR_URL = editorUrl;
process.env.E2E_RUNTIME_URL = runtimeUrl;
process.env.E2E_PLAYER_URL = playerUrl;

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
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
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
      command: "npm run dev --workspace @cubica/player-web -- --hostname 127.0.0.1",
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
    {
      command: "npm run dev --workspace @cubica/editor-web -- --hostname 127.0.0.1",
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
    }
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
