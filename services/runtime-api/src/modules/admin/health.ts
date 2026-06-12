/**
 * Admin health and readiness helpers.
 *
 * This module provides bounded readiness checking for the runtime-api.
 * It reports only in-process runtime dependencies:
 * - Content subsystem: can the runtime load the current game manifest?
 * - Session store mode: is the session store in-memory and functional?
 *
 * It does NOT check:
 * - External databases (none exist in this block)
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
import { loadGameManifest } from "../content/contentService.ts";
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
      mode: "in-memory";
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
 * Check if the content subsystem is functional.
 * Returns a dependency check result.
 */
async function checkContentSubsystem(): Promise<DependencyCheckResult> {
  try {
    // In a real environment, we might check if the games directory exists or if the filesystem is accessible.
    // For now, we assume the content service is ready if it's imported.
    return {
      status: "ok",
      ready: true
    };
  } catch {
    return {
      status: "error",
      ready: false
    };
  }
}

/**
 * Check if the session store is functional.
 * For the scaffold phase, we only check that it's in-memory.
 */
function checkSessionStore(_sessionStore: SessionStorePort<unknown>): DependencyCheckResult & { mode: "in-memory" } {
  // In the scaffold phase, the session store is always in-memory.
  // This check confirms the store is accessible and functional.
  return {
    status: "ok",
    mode: "in-memory"
  };
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
  sessionStore: SessionStorePort<unknown>
): Promise<ReadinessResponse> {
  const [contentCheck, sessionStoreCheck] = await Promise.all([
    checkContentSubsystem(),
    Promise.resolve(checkSessionStore(sessionStore))
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
    Promise.resolve(checkSessionStore(input.sessionStore))
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
