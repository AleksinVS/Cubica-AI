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
 * 2. player-web's server-side content loader must use the same Runtime API URL
 *    as the later production server. Browser Runtime calls themselves stay
 *    behind explicit authenticated route handlers and never use a catch-all
 *    rewrite.
 *
 * Usage: npm run test:e2e:prod [-- --profile full|smoke|player|editor|portal]
 *                              [playwright args]
 * Extra args are forwarded to `playwright test`
 * (e.g. `npm run test:e2e:prod -- apps/editor-web/e2e`).
 */
import { spawnSync } from "node:child_process";

const supportedProfiles = new Set(["full", "smoke", "player", "editor", "portal"]);
const forwardedArgs = process.argv.slice(2);
let profile = process.env.E2E_PROFILE ?? "full";
const profileIndex = forwardedArgs.indexOf("--profile");
if (profileIndex !== -1) {
  const requestedProfile = forwardedArgs[profileIndex + 1];
  if (!requestedProfile) {
    console.error("[e2e-prod] --profile requires a value");
    process.exit(2);
  }
  profile = requestedProfile;
  forwardedArgs.splice(profileIndex, 2);
}
if (!supportedProfiles.has(profile)) {
  console.error(`[e2e-prod] unsupported profile: ${profile}`);
  process.exit(2);
}

const runtimePort = Number(process.env.E2E_RUNTIME_PORT ?? 3201);
const playerPort = Number(process.env.E2E_PLAYER_PORT ?? 3200);
const runtimeUrl = `http://127.0.0.1:${runtimePort}`;
// Keep editor and player on the same loopback site. Using `localhost` for the
// iframe while the editor uses `127.0.0.1` makes SameSite runtime credentials
// third-party cookies, so the browser correctly withholds them from actions.
const playerUrl = `http://127.0.0.1:${playerPort}`;

/** Run a command inheriting stdio and return its exit result to the caller. */
function run(label, command, args, extraEnv = {}) {
  console.log(`\n[e2e-prod] ${label}: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv }
  });
  return result;
}

function requireSuccess(label, result) {
  if (result.status !== 0) {
    console.error(`[e2e-prod] step failed: ${label} (exit ${result.status ?? 1})`);
    process.exit(result.status ?? 1);
  }
}

// Every current profile needs player-web. Editor and full additionally need
// editor-web; the two builds always remain strictly sequential.
requireSuccess("build player-web", run(
  "build player-web",
  "npm",
  ["run", "build", "--workspace", "@cubica/player-web"],
  {
    RUNTIME_API_URL: runtimeUrl,
    PLAYER_WEB_URL: playerUrl,
    NEXT_IGNORE_INCORRECT_LOCKFILE: "1"
  }
));

if (profile === "full" || profile === "editor") {
  requireSuccess("build editor-web", run(
    "build editor-web",
    "npm",
    ["run", "build", "--workspace", "@cubica/editor-web"],
    { NEXT_IGNORE_INCORRECT_LOCKFILE: "1" }
  ));
}

// Playwright starts/reuses the servers itself; prod mode switches its
// webServer commands to `next start` (see playwright.config.ts).
const playwrightEnv = {
  E2E_SERVER_MODE: "prod",
  E2E_PROFILE: profile,
  E2E_PLAYER_ONLY: ["smoke", "player", "portal"].includes(profile) ? "1" : "0",
  // Production builds normally require Secure runtime cookies. Local E2E runs
  // over plain HTTP, so player-web accepts this opt-in only for loopback hosts.
  CUBICA_ALLOW_INSECURE_LOCAL_RUNTIME_COOKIE: "1"
};
const firstPass = run(
  `playwright ${profile} first pass`,
  "npx",
  ["playwright", "test", "--max-failures=1", ...forwardedArgs],
  playwrightEnv
);

if (firstPass.status === 0) {
  process.exit(0);
}

// Only a genuine test failure gets a diagnostic retry. A signal or launch
// failure is not made noisier by attempting another browser/server startup.
if (typeof firstPass.status === "number") {
  run(
    `playwright ${profile} diagnostic rerun`,
    "npx",
    ["playwright", "test", "--last-failed", "--trace=on", "--reporter=dot", ...forwardedArgs],
    playwrightEnv
  );
}

// The diagnostic rerun is evidence only. The original first-pass failure stays
// blocking even when the isolated retry happens to pass.
process.exit(firstPass.status ?? 1);
