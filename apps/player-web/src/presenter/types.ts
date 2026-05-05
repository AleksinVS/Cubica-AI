import type { ActionEntry } from "@/lib/game-content-resolvers";

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

/**
 * Публичное состояние игрока, которое Presenter синхронизирует с View.
 *
 * TGameState — game-specific часть состояния (currentBoard, boardCards и т.д.).
 * Generic слой платформы не знает о структуре TGameState,
 * он только мержит её с base-полями (sessionId, metrics, screenKey и т.д.).
 */
export type PlayerState<TGameState> = TGameState & {
  sessionId: string | null;
  metrics: Record<string, unknown>;
  screenKey: string | null;
  layoutMode: "leftsidebar" | "topbar";
  activePanel: string | null;
  error: string | null;
  booting: boolean;
  isPending: boolean;

  /* Runtime log entries for journal renderer */
  log: Array<Record<string, unknown>>;
};
