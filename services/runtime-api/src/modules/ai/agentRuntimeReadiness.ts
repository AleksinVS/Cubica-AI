/**
 * Agent Runtime readiness policy for AI-driven games.
 *
 * Agent Runtime is the server-side boundary that executes one AI agent turn.
 * The current migration slice intentionally has no production Agent Runtime
 * adapter yet, so required agent runtimes report as unavailable instead of
 * becoming a hidden dependency for deterministic games.
 */
import type { GameManifestAgentRuntimeConfig } from "@cubica/contracts-manifest";

export const MOCK_AGENT_RUNTIME_ID = "mock";

export type AgentRuntimeReadinessStatus = "ok" | "error";
export type AgentRuntimeReadinessMode = "not-required" | "configured" | "missing";

export interface AgentRuntimeReadinessResult {
  readonly status: AgentRuntimeReadinessStatus;
  readonly required: boolean;
  readonly mode: AgentRuntimeReadinessMode;
  readonly agentId?: string;
  readonly runtimeId?: string;
  readonly failurePolicy?: GameManifestAgentRuntimeConfig["failurePolicy"];
  readonly reason?: string;
}

/**
 * Local deterministic mock adapter switch.
 *
 * The mock Agent Runtime is a development and test adapter. It is intentionally
 * opt-in so an AI-driven game cannot silently run in production without a real
 * configured agent backend.
 */
export function isMockAgentRuntimeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CUBICA_ENABLE_MOCK_AGENT_RUNTIME === "true";
}

/**
 * Checks only the declared Agent Runtime dependency.
 *
 * This helper must stay independent from service-level readiness: deterministic
 * games call it with no required agent runtime and remain ready even when AI
 * infrastructure is absent.
 */
export function checkAgentRuntimeReadiness(
  agentRuntime: GameManifestAgentRuntimeConfig | undefined
): AgentRuntimeReadinessResult {
  if (agentRuntime?.required !== true) {
    return {
      status: "ok",
      required: false,
      mode: "not-required"
    };
  }

  if (agentRuntime.runtimeId === MOCK_AGENT_RUNTIME_ID && isMockAgentRuntimeEnabled()) {
    return {
      status: "ok",
      required: true,
      mode: "configured",
      agentId: agentRuntime.agentId,
      runtimeId: agentRuntime.runtimeId,
      failurePolicy: agentRuntime.failurePolicy
    };
  }

  return {
    status: "error",
    required: true,
    mode: "missing",
    agentId: agentRuntime.agentId,
    runtimeId: agentRuntime.runtimeId,
    failurePolicy: agentRuntime.failurePolicy,
    reason: agentRuntime.runtimeId === MOCK_AGENT_RUNTIME_ID
      ? "Mock Agent Runtime requires CUBICA_ENABLE_MOCK_AGENT_RUNTIME=true."
      : "Agent Runtime adapter is not configured in this runtime-api migration slice."
  };
}

export function buildAgentRuntimeUnavailableMessage(gameId: string, result: AgentRuntimeReadinessResult): string {
  return [
    `Game "${gameId}" requires Agent Runtime`,
    result.agentId === undefined ? undefined : `agentId="${result.agentId}"`,
    result.failurePolicy === undefined ? undefined : `failurePolicy="${result.failurePolicy}"`,
    "but Agent Runtime is not configured"
  ].filter(Boolean).join(" ");
}
