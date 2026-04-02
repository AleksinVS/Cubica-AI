#!/usr/bin/env node
/**
 * Antarctica local play runner.
 *
 * Spawns `services/runtime-api` and `apps/player-web` together for local development
 * without requiring any additional dependencies beyond Node.js.
 *
 * Usage:
 *   node scripts/antarctica/run-local-play.mjs
 *   npm run antarctica:play
 *
 * Environment:
 *   PORT               - runtime-api port (default: 3001)
 *   RUNTIME_API_URL    - player-web uses this to connect to runtime-api (default: http://127.0.0.1:3001)
 *   PLAYER_WEB_PORT    - player-web dev server port (default: 3000)
 */

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve script directory (ESM compatibility)
// Note: Script is at scripts/antarctica/run-local-play.mjs, so ../.. from there gives the repo root
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

// Default ports
const DEFAULT_RUNTIME_API_PORT = "3001";
const DEFAULT_PLAYER_WEB_PORT = "3000";

// Environment with defaults
const runtimeApiPort = process.env.PORT ?? DEFAULT_RUNTIME_API_PORT;
const runtimeApiUrl = process.env.RUNTIME_API_URL ?? `http://127.0.0.1:${runtimeApiPort}`;
const playerWebPort = process.env.PLAYER_WEB_PORT ?? DEFAULT_PLAYER_WEB_PORT;

// Track child processes for graceful shutdown
let runtimeApiProcess = null;
let playerWebProcess = null;

/**
 * Log a message with a timestamp and prefix.
 */
function log(prefix, message) {
  const timestamp = new Date().toISOString().split("T")[1].slice(0, 8);
  // eslint-disable-next-line no-console
  console.log(`[${timestamp}] [${prefix}] ${message}`);
}

/**
 * Spawn a child process with proper environment inheritance.
 */
function spawnProcess(command, args, env, name) {
  const child = spawn(command, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false
  });

  // Prefix output lines with process name
  child.stdout.on("data", (data) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      if (line) {
        log(name, line);
      }
    }
  });

  child.stderr.on("data", (data) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      if (line) {
        log(name, line);
      }
    }
  });

  child.on("error", (err) => {
    log(name, `Process error: ${err.message}`);
  });

  child.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      log(name, `Process exited with code ${code}`);
    } else if (signal) {
      log(name, `Process received signal ${signal}`);
    }
  });

  return child;
}

/**
 * Start runtime-api server.
 */
function startRuntimeApi() {
  log("runtime-api", `Starting on port ${runtimeApiPort}...`);

  runtimeApiProcess = spawnProcess(
    "npm",
    ["run", "dev", "--workspace", "services/runtime-api"],
    {
      PORT: runtimeApiPort
    },
    "runtime-api"
  );

  return runtimeApiProcess;
}

/**
 * Start player-web Next.js dev server.
 */
function startPlayerWeb() {
  log("player-web", `Starting on port ${playerWebPort}...`);
  log("player-web", `Using RUNTIME_API_URL=${runtimeApiUrl}`);

  playerWebProcess = spawnProcess(
    "npm",
    ["run", "dev", "--workspace", "@cubica/player-web"],
    {
      RUNTIME_API_URL: runtimeApiUrl,
      PORT: playerWebPort,
      NEXT_IGNORE_INCORRECT_LOCKFILE: "1"
    },
    "player-web"
  );

  return playerWebProcess;
}

/**
 * Stop all child processes gracefully.
 */
function stopAll(signal) {
  log("runner", `Received ${signal}, shutting down...`);

  if (runtimeApiProcess) {
    log("runner", "Stopping runtime-api...");
    runtimeApiProcess.kill("SIGTERM");
  }

  if (playerWebProcess) {
    log("runner", "Stopping player-web...");
    playerWebProcess.kill("SIGTERM");
  }
}

// Register signal handlers for graceful shutdown
process.on("SIGINT", () => stopAll("SIGINT"));
process.on("SIGTERM", () => stopAll("SIGTERM"));

// Handle exit events
process.on("exit", (code) => {
  if (code !== 0 && code !== null) {
    log("runner", `Exiting with code ${code}`);
  }
});

// Main execution
log("runner", "=".repeat(60));
log("runner", "Antarctica local play runner");
log("runner", "=".repeat(60));
log("runner", `Runtime API port: ${runtimeApiPort}`);
log("runner", `Runtime API URL: ${runtimeApiUrl}`);
log("runner", `Player Web port: ${playerWebPort}`);
log("runner", "");

// Start both services
log("runner", "Starting services...");
startRuntimeApi();
startPlayerWeb();

log("runner", "");
log("runner", "Both services are starting...");
log("runner", `Player Web will be available at http://127.0.0.1:${playerWebPort}`);
log("runner", `Runtime API at ${runtimeApiUrl}`);
log("runner", "");
log("runner", "Press Ctrl+C to stop all services");
