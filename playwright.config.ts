import { defineConfig, devices } from "@playwright/test";

const runtimePort = Number(process.env.E2E_RUNTIME_PORT ?? 3201);
const playerPort = Number(process.env.E2E_PLAYER_PORT ?? 3200);
const runtimeUrl = `http://127.0.0.1:${runtimePort}`;
const playerUrl = `http://127.0.0.1:${playerPort}`;

export default defineConfig({
  testDir: "./apps/player-web/e2e",
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
        PORT: String(runtimePort)
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
    }
  ]
});
