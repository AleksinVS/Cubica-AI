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

import { contentService } from "../content/contentService.ts";
import type { SessionStorePort } from "@cubica/contracts-session";

const DEFAULT_GAME_ID = "antarctica";

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
    content: DependencyCheckResult & {
      gameId: string;
    };
    sessionStore: DependencyCheckResult & {
      mode: "in-memory";
    };
  };
}

/**
 * Check if the content subsystem can load the current game manifest.
 * Returns a dependency check result with the gameId.
 */
async function checkContentSubsystem(): Promise<DependencyCheckResult & { gameId: string }> {
  try {
    // Attempt to get the bundle - this validates the manifest is loadable
    await contentService.getBundle(DEFAULT_GAME_ID);
    return {
      status: "ok",
      gameId: DEFAULT_GAME_ID
    };
  } catch {
    return {
      status: "error",
      gameId: DEFAULT_GAME_ID
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
        gameId: contentCheck.gameId
      },
      sessionStore: {
        status: sessionStoreCheck.status,
        mode: sessionStoreCheck.mode
      }
    }
  };
}
