import type { AgentSurfaceState } from "@/types/game-state";
import type { GameManifestAgentFailurePolicy, GameMetricView } from "@cubica/contracts-manifest";

/**
 * Запрос от View или системы к Presenter.
 */
export interface ClientRequest {
  /**
   * Источник события: пользователь или система.
   */
  source: "user" | "system";

  /**
   * Тип события / действия.
   */
  type: string;

  /**
   * Данные, связанные с событием.
   */
  payload?: Record<string, unknown>;

  /**
   * Временная метка клиента (ISO 8601).
   */
  timestamp: string;
}

export type PlayerRuntimeStatus = "booting" | "ready" | "paused" | "retry" | "unavailable";

/**
 * Публичное состояние игрока, которое Presenter синхронизирует с View.
 *
 * Поля из game-specific состояния (currentBoard, boardCards и т.д.)
 * включаются через spread, поэтому тип — Record<string, unknown>
 * для совместимости с любым game-specific состоянием.
 * Компоненты View приводят нужные поля к конкретным типам через
 * game-specific плагины.
 */
export type PlayerState = Record<string, unknown> & {
  sessionId: string | null;
  metrics: Record<string, unknown>;
  metricViews: Record<string, GameMetricView>;
  screenKey: string | null;
  layoutMode: "leftsidebar" | "topbar";
  activePanel: string | null;
  runtimeStatus: PlayerRuntimeStatus;
  runtimeStatusReason: string | null;
  runtimeFailurePolicy: GameManifestAgentFailurePolicy | null;
  agentRuntimeRequired: boolean;
  error: string | null;
  errorStatus: number | null;
  booting: boolean;
  isPending: boolean;
  agentSurface: AgentSurfaceState;

  /* Runtime log entries for journal renderer */
  log: Array<Record<string, unknown>>;
};
