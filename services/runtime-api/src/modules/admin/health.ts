/**
 * Admin health and readiness helpers.
 *
 * This module provides bounded readiness checking for the runtime-api.
 * It reports only in-process runtime dependencies:
 * - Content subsystem: can the runtime load the current game manifest?
 * - Session store: can the configured backing dependency answer a real probe?
 *
 * It does NOT check:
 * - Distributed system state (single-process only)
 * - Background workers (none exist in this block)
 */

import type { GameManifestExecutionMode } from "@cubica/contracts-manifest";
import type { SessionStorePort } from "@cubica/contracts-session";
import {
  buildAgentRuntimeUnavailableMessage,
  checkAgentRuntimeReadiness,
  type AgentRuntimeReadinessResult
} from "../ai/agentRuntimeReadiness.ts";
import { listAvailableGameIds, loadGameManifest } from "../content/contentService.ts";
import { HttpError } from "../errors.ts";

/**
 * Result of a single dependency check.
 */
export interface DependencyCheckResult {
  status: "ok" | "error";
  [key: string]: unknown;
}

/**
 * Readiness response shape.
 */
export interface ReadinessResponse {
  ready: boolean;
  service: "runtime-api";
  dependencies: {
    content: DependencyCheckResult;
    sessionStore: DependencyCheckResult & {
      // WHY: `mode` reports the REAL session store backing the runtime, derived
      // from the injected store at request time. It is no longer the literal
      // "in-memory": swapping in another `SessionStorePort` (e.g. a Redis-backed
      // store) must be reflected honestly, so the type is a free-form string.
      mode: string;
    };
  };
}

export interface GameReadinessResponse {
  ready: boolean;
  service: "runtime-api";
  gameId: string;
  contentSourceId?: string;
  executionMode?: GameManifestExecutionMode;
  dependencies: ReadinessResponse["dependencies"] & {
    gameContent: DependencyCheckResult & {
      gameId: string;
    };
    agentRuntime: AgentRuntimeReadinessResult;
  };
}

/**
 * Injectable dependencies for the content subsystem probe.
 *
 * A "probe" here is a real, executed check (not a placeholder). The default
 * probe exercises the actual content pipeline; tests inject a failing probe to
 * prove the readiness check honestly reports content failures.
 */
export interface ContentProbe {
  /** Discover the ids of games that can be loaded. */
  listGameIds(): Promise<readonly string[]>;
  /** Load (read + JSON parse + schema validate) a game's manifest. */
  loadManifest(gameId: string): Promise<unknown>;
}

/**
 * Default content probe wired to the shared content service. Discovering a game
 * id from the repository (instead of hardcoding one) keeps this check
 * platform-pure: no game-specific ids leak into the core runtime layer.
 */
const defaultContentProbe: ContentProbe = {
  listGameIds: () => listAvailableGameIds(),
  loadManifest: (gameId) => loadGameManifest(gameId)
};

/**
 * Check whether the content subsystem is actually functional.
 *
 * This is a REAL probe: it discovers an available game and attempts to load its
 * manifest through the same pipeline the runtime uses. A missing games
 * directory, an unreadable manifest, invalid JSON, or a schema violation all
 * surface here as `status: "error"` / `ready: false`, so `/readiness` can no
 * longer report a healthy content subsystem while it is in fact broken.
 */
export async function checkContentSubsystem(
  probe: ContentProbe = defaultContentProbe
): Promise<DependencyCheckResult> {
  try {
    const gameIds = await probe.listGameIds();
    if (gameIds.length === 0) {
      return {
        status: "error",
        ready: false,
        message: "No loadable game manifests were found; content subsystem cannot be verified."
      };
    }

    // Probe the first (stable, sorted) available game. Loading one real manifest
    // exercises repository access, JSON parsing and schema validation, which is
    // enough to confirm the content subsystem is wired up and functional.
    const probeGameId = gameIds[0];
    await probe.loadManifest(probeGameId);
    return {
      status: "ok",
      ready: true,
      probedGameId: probeGameId
    };
  } catch (error) {
    return {
      status: "error",
      ready: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Derive a human-readable session-store mode from the injected store.
 *
 * The port exposes its mode explicitly. The class-name fallback is retained
 * only for older injected test doubles. Examples:
 *   `InMemorySessionStore` -> "in-memory"
 *   `RedisSessionStore`     -> "redis"
 * This keeps readiness honest: whatever store is injected is reported, rather
 * than a hardcoded "in-memory".
 */
export function deriveSessionStoreMode(sessionStore: SessionStorePort<unknown>): string {
  if (typeof sessionStore.mode === "string" && sessionStore.mode.length > 0) {
    return sessionStore.mode;
  }
  const className = sessionStore?.constructor?.name ?? "";
  // Strip the conventional `SessionStore` / `Store` suffix, then convert the
  // remaining CamelCase class name to a kebab-case mode label.
  const base = className.replace(/SessionStore$/, "").replace(/Store$/, "");
  if (base.length === 0) {
    return "unknown";
  }
  return base.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/**
 * Check the session store and report its REAL mode.
 *
 * PostgreSQL readiness executes a real query. This prevents the service from
 * accepting traffic merely because a pool object was constructed successfully.
 */
export async function checkSessionStore(
  sessionStore: SessionStorePort<unknown>
): Promise<DependencyCheckResult & { mode: string }> {
  const mode = deriveSessionStoreMode(sessionStore);
  try {
    // PostgreSQL executes `SELECT 1`; the in-memory test/dev adapter resolves
    // without external work. A failed dependency therefore makes readiness
    // fail instead of merely reporting that a store object exists.
    await sessionStore.checkReadiness();
    return { status: "ok", mode };
  } catch (error) {
    return {
      status: "error",
      mode,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Determine overall readiness based on dependency checks.
 */
export function calculateReadiness(
  contentCheck: DependencyCheckResult,
  sessionStoreCheck: DependencyCheckResult
): boolean {
  return contentCheck.status === "ok" && sessionStoreCheck.status === "ok";
}

/**
 * Build the full readiness response.
 */
export async function buildReadinessResponse(
  sessionStore: SessionStorePort<unknown>,
  options: { contentProbe?: ContentProbe } = {}
): Promise<ReadinessResponse> {
  const [contentCheck, sessionStoreCheck] = await Promise.all([
    checkContentSubsystem(options.contentProbe),
    checkSessionStore(sessionStore)
  ]);

  const ready = calculateReadiness(contentCheck, sessionStoreCheck);

  return {
    ready,
    service: "runtime-api",
    dependencies: {
      content: {
        status: contentCheck.status,
        ready: contentCheck.ready
      },
      sessionStore: {
        status: sessionStoreCheck.status,
        mode: sessionStoreCheck.mode
      }
    }
  };
}

export async function buildGameReadinessResponse(input: {
  sessionStore: SessionStorePort<unknown>;
  gameId: string;
  contentSourceId?: string;
}): Promise<GameReadinessResponse> {
  const [contentCheck, sessionStoreCheck] = await Promise.all([
    checkContentSubsystem(),
    checkSessionStore(input.sessionStore)
  ]);

  const baseDependencies = {
    content: {
      status: contentCheck.status,
      ready: contentCheck.ready
    },
    sessionStore: {
      status: sessionStoreCheck.status,
      mode: sessionStoreCheck.mode
    }
  };

  try {
    const manifest = await loadGameManifest(input.gameId, input.contentSourceId);
    const executionMode = manifest.executionMode ?? "deterministic";
    const agentRuntime = checkAgentRuntimeReadiness(manifest.agentRuntime);
    const ready = calculateReadiness(contentCheck, sessionStoreCheck) && agentRuntime.status === "ok";

    return {
      ready,
      service: "runtime-api",
      gameId: input.gameId,
      contentSourceId: input.contentSourceId,
      executionMode,
      dependencies: {
        ...baseDependencies,
        gameContent: {
          status: "ok",
          gameId: input.gameId
        },
        agentRuntime
      }
    };
  } catch (error) {
    return {
      ready: false,
      service: "runtime-api",
      gameId: input.gameId,
      contentSourceId: input.contentSourceId,
      dependencies: {
        ...baseDependencies,
        gameContent: {
          status: "error",
          gameId: input.gameId,
          message: error instanceof Error ? error.message : String(error)
        },
        agentRuntime: {
          status: "ok",
          required: false,
          mode: "not-required"
        }
      }
    };
  }
}

export async function assertGameLaunchReady(input: {
  gameId: string;
  contentSourceId?: string;
}): Promise<void> {
  const manifest = await loadGameManifest(input.gameId, input.contentSourceId);
  const agentRuntime = checkAgentRuntimeReadiness(manifest.agentRuntime);
  if (agentRuntime.status !== "ok") {
    if (
      manifest.agentRuntime?.failurePolicy === "deterministicFallback" &&
      typeof manifest.agentRuntime.deterministicFallbackActionId === "string" &&
      manifest.agentRuntime.deterministicFallbackActionId.length > 0
    ) {
      return;
    }
    throw new HttpError(503, buildAgentRuntimeUnavailableMessage(input.gameId, agentRuntime));
  }
}
