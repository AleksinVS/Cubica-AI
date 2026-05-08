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
 * Поля из game-specific состояния (currentBoard, boardCards и т.д.)
 * включаются через spread, поэтому тип — Record<string, unknown>
 * для совместимости с любым game-specific состоянием.
 * Компоненты View приводят нужные поля к конкретным типам через
 * game-specific плагины.
 */
export type PlayerState = Record<string, unknown> & {
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