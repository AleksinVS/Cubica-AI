#!/usr/bin/env node
/**
 * Minimal single-host service supervisor (ADR-067).
 *
 * WHAT THIS IS. A "supervisor" (супервайзер) is a long-running parent process
 * that starts a set of child services, watches them, and RESTARTS any child that
 * crashes or stops answering its health check. It is the INTERIM recovery loop
 * for single-host / non-HA environments (a test VPS, a demo box) until the
 * declared orchestrator model — Kubernetes Pod/Service or serverless per
 * PROJECT_OVERVIEW §5 — is actually built (LEGACY-0026). It is deliberately
 * dependency-free (only Node's own `child_process`/`fetch`) and single-node: no
 * clustering, no rolling restart, no distributed readiness. See the runbook
 * `docs/processes/service-recovery-runbook.md` and ADR-067 for the boundary and
 * the graduation trigger.
 *
 * WHAT IT RECOVERS. Only the PROCESS: a dead or unhealthy service is restarted.
 * It does NOT recover in-flight state — sessions are in-memory (LEGACY-0009), so
 * a restart loses live sessions until session persistence lands.
 *
 * TERMS.
 *   - "liveness": is the process up and the port answering at all? (HTTP 200 on a
 *     cheap URL — `/health` for runtime-api, `/` for the Next apps).
 *   - "readiness": are the service's dependencies OK so it can serve? runtime-api
 *     exposes `/readiness` (200 ready / 503 not). We probe readiness when a
 *     service declares a `readinessPath`, else fall back to liveness.
 *   - "backoff": the growing wait between restart attempts so a service that
 *     keeps failing is not hammered (exponential, capped).
 *   - "circuit breaker": after too many restarts in a short window we keep the
 *     service at max backoff and log loudly instead of spinning fast forever.
 *
 * USAGE.
 *   node scripts/ops/service-supervisor.mjs [--config <path>]
 *   SUPERVISOR_CONFIG=<path> node scripts/ops/service-supervisor.mjs
 *
 * The config JSON (optional) overrides the built-in delivery profile:
 *   { "healthIntervalMs": 5000, "services": [ { "name", "command", "args",
 *     "env", "port", "healthPath", "readinessPath", "startGraceMs" }, ... ] }
 *
 * The built-in default supervises the DELIVERY contour (runtime-api +
 * player-web). The authoring editor is a local tool, not a production service
 * yet (LEGACY-0036), so it is intentionally NOT in the default profile; add it
 * via a config file if you want the supervisor to keep it up too.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

// --- Tunables (all overridable from the config file). ----------------------
const DEFAULT_HEALTH_INTERVAL_MS = 5000; // how often to poll each service
const DEFAULT_START_GRACE_MS = 60_000; // health failures are ignored during startup
const HEALTH_TIMEOUT_MS = 3000; // per health-probe HTTP timeout
const UNHEALTHY_STRIKES = 3; // consecutive failed probes before a restart
const BACKOFF_BASE_MS = 1000; // first restart waits ~1s
const BACKOFF_MAX_MS = 30_000; // restart wait never exceeds 30s
const CRASH_WINDOW_MS = 60_000; // window used by the circuit breaker
const CRASH_WINDOW_LIMIT = 5; // >5 restarts within the window → "degraded" log

const runtimePort = Number(process.env.RUNTIME_API_PORT ?? 3001);
const playerPort = Number(process.env.PLAYER_WEB_PORT ?? 3000);
const runtimeUrl = `http://127.0.0.1:${runtimePort}`;

/**
 * Built-in DELIVERY profile: runtime-api (runs via strip-types — it has no
 * separate prod build yet) and player-web (`next start`, so it must be built
 * first — see the runbook). Ports and commands are overridable via a config.
 */
const DEFAULT_CONFIG = {
  healthIntervalMs: DEFAULT_HEALTH_INTERVAL_MS,
  services: [
    {
      name: "runtime-api",
      command: "npm",
      args: ["run", "dev", "--workspace", "services/runtime-api"],
      env: { PORT: String(runtimePort) },
      port: runtimePort,
      healthPath: "/health",
      readinessPath: "/readiness",
      startGraceMs: DEFAULT_START_GRACE_MS
    },
    {
      name: "player-web",
      command: "npm",
      args: ["run", "start", "--workspace", "@cubica/player-web", "--", "--hostname", "127.0.0.1", "--port", String(playerPort)],
      env: { PORT: String(playerPort), RUNTIME_API_URL: runtimeUrl, PLAYER_WEB_URL: `http://127.0.0.1:${playerPort}`, NEXT_IGNORE_INCORRECT_LOCKFILE: "1" },
      port: playerPort,
      healthPath: "/",
      startGraceMs: DEFAULT_START_GRACE_MS
    }
  ]
};

/** Loads the config file (argv `--config` or `SUPERVISOR_CONFIG`), else default. */
function loadConfig() {
  const flagIndex = process.argv.indexOf("--config");
  const configPath = flagIndex !== -1 ? process.argv[flagIndex + 1] : process.env.SUPERVISOR_CONFIG;
  if (configPath === undefined || configPath === "") {
    return DEFAULT_CONFIG;
  }
  const parsed = JSON.parse(readFileSync(configPath, "utf8"));
  return { healthIntervalMs: parsed.healthIntervalMs ?? DEFAULT_HEALTH_INTERVAL_MS, services: parsed.services ?? [] };
}

/** Timestamped, service-prefixed log line so multiplexed output stays readable. */
function log(name, message) {
  process.stdout.write(`[${new Date().toISOString()}] [supervisor] [${name}] ${message}\n`);
}

/** Restart wait: exponential in the restart count, capped (see "backoff"). */
function backoffFor(restartCount) {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, restartCount - 1));
}

/** One managed child: its config plus mutable runtime bookkeeping. */
class ManagedService {
  constructor(spec) {
    this.spec = spec;
    this.child = undefined;
    this.startedAt = 0;
    this.restartCount = 0;
    this.recentCrashes = []; // timestamps, trimmed to CRASH_WINDOW_MS
    this.healthStrikes = 0;
    this.restarting = false;
  }

  /** Spawns the child, wires its stdio to prefixed logs and its exit handler. */
  start() {
    this.restarting = false;
    this.startedAt = Date.now();
    this.healthStrikes = 0;
    log(this.spec.name, `starting: ${this.spec.command} ${this.spec.args.join(" ")}`);
    // `detached: true` makes the child its OWN process-group leader, so a single
    // signal to the negative pid (see `kill`) reaps the WHOLE tree — e.g. the
    // `npm` wrapper AND the `node`/`next` grandchild that actually holds the
    // port. Without this, killing only the direct child leaks the grandchild and
    // the port, so the restart cannot rebind. We keep the stdio pipes (not fully
    // detached) and never `unref`, because we still track and log the child.
    const child = spawn(this.spec.command, this.spec.args, {
      env: { ...process.env, ...this.spec.env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true
    });
    this.child = child;
    const pipe = (stream) => {
      stream.on("data", (chunk) => {
        for (const line of chunk.toString().split("\n")) {
          if (line.trim() !== "") {
            process.stdout.write(`[${this.spec.name}] ${line}\n`);
          }
        }
      });
    };
    pipe(child.stdout);
    pipe(child.stderr);
    child.on("exit", (code, signal) => this.onExit(code, signal));
    child.on("error", (error) => log(this.spec.name, `spawn error: ${error.message}`));
  }

  /** Child exited (crash or stop) → schedule a restart unless we are shutting down. */
  onExit(code, signal) {
    this.child = undefined;
    if (shuttingDown) {
      log(this.spec.name, `exited during shutdown (code=${code ?? "?"}, signal=${signal ?? "-"})`);
      return;
    }
    log(this.spec.name, `exited (code=${code ?? "?"}, signal=${signal ?? "-"}) — scheduling restart`);
    this.registerCrashAndRestart();
  }

  /** Records the crash for the circuit breaker and restarts after backoff. */
  registerCrashAndRestart() {
    if (this.restarting) {
      return;
    }
    this.restarting = true;
    const now = Date.now();
    this.recentCrashes = this.recentCrashes.filter((ts) => now - ts < CRASH_WINDOW_MS);
    this.recentCrashes.push(now);
    this.restartCount += 1;
    if (this.recentCrashes.length > CRASH_WINDOW_LIMIT) {
      log(this.spec.name, `DEGRADED: ${this.recentCrashes.length} restarts within ${CRASH_WINDOW_MS / 1000}s — check logs; holding at max backoff`);
    }
    const wait = backoffFor(this.restartCount);
    log(this.spec.name, `restart #${this.restartCount} in ${wait}ms`);
    setTimeout(() => {
      if (!shuttingDown) {
        this.start();
      }
    }, wait);
  }

  /**
   * Kills the current child's WHOLE process group (used by a health-driven
   * restart and by shutdown). `process.kill(-pid, …)` targets the group led by
   * the detached child, reaping the `npm` wrapper and its `node`/`next`
   * grandchild together so the port is actually released. Falls back to a plain
   * child kill if the group signal fails (e.g. the child already exited).
   */
  kill(signal) {
    const child = this.child;
    if (child === undefined || child.pid === undefined) {
      return;
    }
    try {
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        /* already gone */
      }
    }
  }

  /** True once the startup grace window has elapsed (health failures now count). */
  pastStartupGrace() {
    const grace = this.spec.startGraceMs ?? DEFAULT_START_GRACE_MS;
    return this.child !== undefined && Date.now() - this.startedAt > grace;
  }

  /** The URL to probe: readiness when declared (richer signal), else liveness. */
  probeUrl() {
    const path = this.spec.readinessPath ?? this.spec.healthPath ?? "/";
    return `http://127.0.0.1:${this.spec.port}${path}`;
  }
}

let shuttingDown = false;
const config = loadConfig();
const services = config.services.map((spec) => new ManagedService(spec));

/** Probes one URL; resolves true on HTTP 2xx within the timeout, else false. */
async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.status >= 200 && response.status < 300;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The health loop (the "recovery loop"): every interval, probe each running
 * service that is past its startup grace. UNHEALTHY_STRIKES consecutive failures
 * trigger a kill — the child's exit handler then restarts it with backoff.
 */
async function healthTick() {
  if (shuttingDown) {
    return;
  }
  await Promise.all(
    services.map(async (service) => {
      if (!service.pastStartupGrace() || service.restarting) {
        return;
      }
      const healthy = await probe(service.probeUrl());
      if (healthy) {
        if (service.healthStrikes > 0) {
          log(service.spec.name, "healthy again");
        }
        service.healthStrikes = 0;
        return;
      }
      service.healthStrikes += 1;
      log(service.spec.name, `health probe failed (${service.healthStrikes}/${UNHEALTHY_STRIKES}) ${service.probeUrl()}`);
      if (service.healthStrikes >= UNHEALTHY_STRIKES) {
        log(service.spec.name, "unhealthy — killing to trigger restart");
        service.healthStrikes = 0;
        service.kill("SIGTERM");
      }
    })
  );
}

/** Graceful shutdown: stop the loop, SIGTERM the children, exit after a grace. */
function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  log("all", `received ${signal} — stopping services`);
  clearInterval(healthTimer);
  for (const service of services) {
    service.kill("SIGTERM");
  }
  setTimeout(() => {
    for (const service of services) {
      service.kill("SIGKILL");
    }
    process.exit(0);
  }, 5000);
}

if (services.length === 0) {
  log("all", "no services configured — nothing to supervise");
  process.exit(1);
}

log("all", `supervising ${services.length} service(s): ${services.map((s) => s.spec.name).join(", ")}`);
for (const service of services) {
  service.start();
}
const healthTimer = setInterval(() => void healthTick(), config.healthIntervalMs);
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
