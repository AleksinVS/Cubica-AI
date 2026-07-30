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
 *   player-web and editor-web one at a time before starting the services.
 *
 * E2E profiles (E2E_PROFILE): "full", "smoke", "player", "editor", or
 * "portal". Tags select the matching tests, while every profile remains on
 * the installed Desktop Chrome emulation with one worker.
 *
 * The first pass never records trace/video. Those modes record throughout a
 * successful test even when Playwright later discards them. The production
 * harness performs a failure-only `--last-failed --trace on` diagnostic rerun.
 */
const serverMode = process.env.E2E_SERVER_MODE === "prod" ? "prod" : "dev";
const supportedProfiles = ["full", "smoke", "player", "editor", "portal"] as const;
type E2EProfile = typeof supportedProfiles[number];
// Preserve the former player-only switch as a compatibility alias while
// keeping one source of truth for test filtering and server selection.
const requestedProfile = process.env.E2E_PROFILE ??
  (process.env.E2E_PLAYER_ONLY === "1" ? "player" : "full");
if (!supportedProfiles.includes(requestedProfile as E2EProfile)) {
  throw new Error(`Unsupported E2E_PROFILE: ${requestedProfile}`);
}
const e2eProfile = requestedProfile as E2EProfile;
const playerOnly = e2eProfile === "smoke" ||
  e2eProfile === "player" ||
  e2eProfile === "portal";
const profileGrep = e2eProfile === "full" ? undefined : new RegExp(`@${e2eProfile}`);

const runtimePort = Number(process.env.E2E_RUNTIME_PORT ?? 3201);
const playerPort = Number(process.env.E2E_PLAYER_PORT ?? 3200);
const editorPort = Number(process.env.E2E_EDITOR_PORT ?? 3202);
const runtimeUrl = `http://127.0.0.1:${runtimePort}`;
// Browsers treat localhost as a potentially trustworthy local origin. Using
// that canonical name keeps production Secure cookies enabled in E2E while
// still binding the owned server process to the IPv4 loopback interface.
const playerUrl = `http://localhost:${playerPort}`;
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
  reporter: process.env.CI ? "dot" : "list",
  use: {
    baseURL: playerUrl,
    trace: "off",
    screenshot: "only-on-failure",
    video: "off"
  },
  projects: [
    {
      name: e2eProfile === "full" ? "chromium" : `chromium-${e2eProfile}`,
      grep: profileGrep,
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
