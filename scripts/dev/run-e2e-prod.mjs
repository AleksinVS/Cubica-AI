#!/usr/bin/env node
/**
 * Runs the e2e suite with Next.js apps in PRODUCTION mode.
 *
 * Why this exists: on weak hosts (~4 cores) `next dev` compiles routes on
 * demand while tests interact with the app, which starves the interactive
 * editor-preview round-trip (clicks time out) and the editor dev compile can
 * be SIGTERM'd under load. Details and the empirical diagnosis live in
 * docs/reviews/2026-07-05-remediation-closeout-and-e2e-blockers.md.
 *
 * The bypass: build once BEFORE the tests, then serve with `next start`
 * (no compilation during the run). Two constraints make this script
 * non-trivial:
 * 1. Builds must run SEQUENTIALLY — parallel `next build` workers get
 *    SIGTERM'd on the 4-core host (proven empirically; a lone build passes).
 * 2. player-web bakes RUNTIME_API_URL into its rewrites at BUILD time
 *    (next.config.ts `rewrites()` is evaluated during `next build`), so the
 *    build must see the same runtime URL the tests will use.
 *
 * Usage: npm run test:e2e:prod [-- <playwright args>]
 * Extra args are forwarded to `playwright test`
 * (e.g. `npm run test:e2e:prod -- apps/editor-web/e2e`).
 */
import { spawnSync } from "node:child_process";

const runtimePort = Number(process.env.E2E_RUNTIME_PORT ?? 3201);
const playerPort = Number(process.env.E2E_PLAYER_PORT ?? 3200);
const runtimeUrl = `http://127.0.0.1:${runtimePort}`;
const playerUrl = `http://127.0.0.1:${playerPort}`;

/** Run a command inheriting stdio; abort the whole run on failure. */
function run(label, command, args, extraEnv = {}) {
  console.log(`\n[e2e-prod] ${label}: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv }
  });
  if (result.status !== 0) {
    console.error(`[e2e-prod] step failed: ${label} (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

// Sequential builds — never in parallel on this class of host (see header).
run("build player-web", "npm", ["run", "build", "--workspace", "@cubica/player-web"], {
  // Baked into player-web rewrites at build time; must match the e2e runtime URL.
  RUNTIME_API_URL: runtimeUrl,
  PLAYER_WEB_URL: playerUrl,
  NEXT_IGNORE_INCORRECT_LOCKFILE: "1"
});

run("build editor-web", "npm", ["run", "build", "--workspace", "@cubica/editor-web"], {
  NEXT_IGNORE_INCORRECT_LOCKFILE: "1"
});

// Playwright starts/reuses the servers itself; prod mode switches its
// webServer commands to `next start` (see playwright.config.ts).
const playwrightArgs = ["playwright", "test", ...process.argv.slice(2)];
run("playwright (prod servers)", "npx", playwrightArgs, {
  E2E_SERVER_MODE: "prod",
  // Recording trace/video costs CPU during the run; keep the starved host
  // focused on the app itself. Override with E2E_LOW_RESOURCE=0 if needed.
  E2E_LOW_RESOURCE: process.env.E2E_LOW_RESOURCE ?? "1"
});
