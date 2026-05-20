import { applyJsonMergePatch } from "@cubica/sdk-core";
import type { ViewCommand } from "@cubica/sdk-core";
import type { PlayerFacingContent, GamePlayerUiContent } from "@cubica/contracts-manifest";
import { ManifestAction } from "@cubica/contracts-manifest";
import type {
  GameSession,
  MetricsSnapshot,
  RuntimeUiState
} from "@/types/game-state";
import type { SessionSnapshot, ActionSnapshot } from "@/lib/game-content-resolvers";
import { resolveMetricValueByAliases } from "@/lib/metric-resolvers";
import {
  createNewSession,
  resumeSession,
  dispatchAction as dispatchRuntimeAction
} from "@/presenter/runtime-client";
import {
  bindPortalLaunchSession,
  launchScopedStorageKey,
  readPortalLaunchContext,
  type PortalLaunchContext
} from "@/presenter/portal-launch-client";
import { ReactViewGateway } from "@/presenter/react-view-gateway";
import type { GameConfig } from "@/presenter/game-config";
import { resolveScreenKey as resolveScreenKeyDefault, resolveLayoutModeFromRouting } from "@/lib/screen-router";
import type { ClientRequest } from "@/presenter/types";
import type { PlayerState } from "@/presenter/types";

export type { ClientRequest, PlayerState } from "@/presenter/types";

/**
 * Generic Presenter для игрового Web-плеера.
 *
 * Отвечает за:
 *  • boot сессии (создание / восстановление);
 *  • dispatch действий в runtime-api;
 *  • применение JSON Merge Patch к состоянию;
 *  • генерацию ViewCommand для React View.
 *
 * Не содержит game-specific хардкодов: gameId, playerId, storageKey,
 * правила маршрутизации экранов, fallback-метрики и разрешение content
 * передаются через {@link GameConfig} извне.
 */
export class GamePresenter {
  private gateway: ReactViewGateway;
  private content: PlayerFacingContent;
  private gameUi: GamePlayerUiContent | undefined;
  private config: GameConfig;

  private session: GameSession | null = null;
  private booting = true;
  private isPending = false;
  private error: string | null = null;
  private dismissedPanel: string | null = null;
  private currentActivePanel: string | null = null;
  private launchContext: PortalLaunchContext | null = null;

  constructor(options: {
    gateway: ReactViewGateway;
    content: PlayerFacingContent;
    gameUi?: GamePlayerUiContent;
    config: GameConfig;
  }) {
    this.gateway = options.gateway;
    this.content = options.content;
    this.gameUi = options.gameUi;
    this.config = options.config;
  }

  /**
   * Публичное состояние для подписки View.
   */
  get playerState(): PlayerState {
    const publicState = this.session?.state?.public as Record<string, unknown> | undefined;
    const rawMetrics = { ...(publicState?.metrics as MetricsSnapshot) ?? {} };
    const metrics = this.config.resolveMetrics
      ? this.config.resolveMetrics(rawMetrics)
      : rawMetrics;
    const timeline = (publicState?.timeline as Record<string, unknown> | undefined) ?? {};
    const runtimeUi = (publicState?.ui as RuntimeUiState | undefined) ?? {};

    const currentScreenId =
      typeof timeline.screenId === "string"
        ? timeline.screenId
        : typeof timeline.screen_id === "string"
          ? timeline.screen_id
          : null;

    const currentStepIndex =
      typeof timeline.stepIndex === "number"
        ? timeline.stepIndex
        : typeof timeline.step_index === "number"
          ? timeline.step_index
          : null;

    const activeInfoId =
      typeof timeline.activeInfoId === "string"
        ? timeline.activeInfoId
        : typeof timeline.active_info_id === "string"
          ? timeline.active_info_id
          : null;

    const gameState = this.config.resolveGameState(this.content, this.session);

    const screenRouting = this.gameUi?.screenRouting;
    const screenKey = this.gameUi
      ? this.config.resolveScreenKey
        ? this.config.resolveScreenKey(currentScreenId, currentStepIndex, activeInfoId, runtimeUi, this.gameUi)
        : resolveScreenKeyDefault(screenRouting, currentScreenId, currentStepIndex, activeInfoId, runtimeUi, this.gameUi)
      : null;

    const layoutMode = this.config.resolveLayoutMode
      ? this.config.resolveLayoutMode(screenKey, runtimeUi, gameState)
      : resolveLayoutModeFromRouting(screenRouting, currentScreenId, currentStepIndex, activeInfoId, runtimeUi) ?? "topbar";

    const rawActivePanel = typeof runtimeUi.activePanel === "string" ? runtimeUi.activePanel : null;
    let activePanel: string | null = null;
    if (rawActivePanel && rawActivePanel !== this.dismissedPanel) {
      activePanel = rawActivePanel;
    } else if (!this.dismissedPanel && this.currentActivePanel) {
      /* Preserve current panel if server didn't specify a new one and user didn't dismiss it */
      activePanel = this.currentActivePanel;
    }
    this.currentActivePanel = activePanel;

    return {
      ...gameState,
      sessionId: this.session?.sessionId ?? null,
      metrics,
      screenKey,
      layoutMode,
      activePanel,
      error: this.error,
      booting: this.booting,
      isPending: this.isPending,
      log: Array.isArray(publicState?.log) ? (publicState?.log as Array<Record<string, unknown>>) : [],
    };
  }

  /**
   * Выполняет начальную загрузку сессии.
   */
  async boot(): Promise<void> {
    try {
      const portalLaunchContext = readPortalLaunchContext();

      if (portalLaunchContext) {
        const data = await bindPortalLaunchSession(portalLaunchContext, this.config.playerId);
        this.launchContext = portalLaunchContext;
        this.session = { ...data, gameId: data.gameId || this.config.gameId };
        if (typeof window !== "undefined") {
          window.localStorage.setItem(
            launchScopedStorageKey(this.config.storageKey, portalLaunchContext),
            data.sessionId
          );
        }
        this.error = null;
        return;
      }

      const storedSessionId =
        typeof window !== "undefined"
          ? window.localStorage.getItem(this.config.storageKey)
          : null;

      if (storedSessionId) {
        try {
          const data = await resumeSession(storedSessionId);
          this.session = { ...data, gameId: this.config.gameId };
          this.error = null;
        } catch {
          const data = await createNewSession(this.config.gameId, this.config.playerId);
          this.session = { ...data, gameId: this.config.gameId };
          if (typeof window !== "undefined") {
            window.localStorage.setItem(this.config.storageKey, data.sessionId);
          }
          this.error = null;
        }
      } else {
        const data = await createNewSession(this.config.gameId, this.config.playerId);
        this.session = { ...data, gameId: this.config.gameId };
        if (typeof window !== "undefined") {
          window.localStorage.setItem(this.config.storageKey, data.sessionId);
        }
        this.error = null;
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Failed to initialize player";
    } finally {
      this.booting = false;
      await this.syncView();
    }
  }

  /**
   * Сбрасывает игру: удаляет localStorage и создаёт новую сессию.
   */
  async resetGame(): Promise<void> {
    this.booting = true;
    this.error = null;
    if (typeof window !== "undefined") {
      const storageKey = this.launchContext
        ? launchScopedStorageKey(this.config.storageKey, this.launchContext)
        : this.config.storageKey;
      window.localStorage.removeItem(storageKey);
    }
    try {
      const data = this.launchContext
        ? await bindPortalLaunchSession(this.launchContext, this.config.playerId)
        : await createNewSession(this.config.gameId, this.config.playerId);
      this.session = { ...data, gameId: data.gameId || this.config.gameId };
      if (typeof window !== "undefined") {
        const storageKey = this.launchContext
          ? launchScopedStorageKey(this.config.storageKey, this.launchContext)
          : this.config.storageKey;
        window.localStorage.setItem(storageKey, data.sessionId);
      }
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Failed to reset player";
    } finally {
      this.booting = false;
      await this.syncView();
    }
  }

  /**
   * Обрабатывает событие от View или системы.
   */
  async handleEvent(request: ClientRequest): Promise<void> {
    if (this.booting || !this.session) {
      return;
    }

    this.isPending = true;
    await this.syncView();

    try {
      if (request.type === ManifestAction.SHOW_HISTORY || request.type === ManifestAction.SHOW_HINT) {
        this.dismissedPanel = null;
      }

      if (request.type === ManifestAction.SHOW_HISTORY) {
        this.currentActivePanel = "history";
      }

      if (request.type === ManifestAction.SHOW_HINT) {
        this.currentActivePanel = "hint";
      }

      if (request.type === ManifestAction.RESET_GAME) {
        await this.resetGame();
        return;
      }

      if (request.type === ManifestAction.DISMISS_PANEL) {
        this.dismissedPanel = (request.payload?.panel as string) ?? null;
        this.currentActivePanel = null;
        await this.syncView();
        return;
      }

      const next = await dispatchRuntimeAction(
        this.session.sessionId,
        this.config.playerId,
        request.type,
        request.payload ?? {}
      );

      // Merge snapshot: объединяем текущее состояние с новым delta
      const merged = applyJsonMergePatch(
        this.session as unknown as import("@cubica/sdk-core").JsonValue,
        next as unknown as import("@cubica/sdk-core").JsonValue
      ) as unknown as GameSession;

      this.session = merged;
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Action dispatch failed";
    } finally {
      this.isPending = false;
      await this.syncView();
    }
  }

  /**
   * Создаёт адаптер для UI-команд манифеста.
   * Делегирует game-specific логику в GameConfig.
   */
  createManifestActionAdapter(
    dispatchAction: (actionId: string, payload?: Record<string, unknown>) => void,
    onError: (message: string) => void
  ): (command: string, payload: Record<string, unknown>) => void {
    const gameState = this.config.resolveGameState(this.content, this.session);
    return this.config.createManifestActionAdapter(this.content, gameState, dispatchAction, onError);
  }

  /**
   * Отправляет текущее состояние в View через gateway.
   */
  private async syncView(): Promise<void> {
    const state = this.playerState;
    const commands: ViewCommand[] = [
      {
        type: "SYNC_STATE",
        payload: { state },
        meta: { isSync: true, priority: "high" }
      }
    ];

    if (state.screenKey) {
      commands.push({
        type: "NAVIGATE",
        payload: { screenKey: state.screenKey, layoutMode: state.layoutMode }
      });
    }

    if (state.activePanel) {
      commands.push({
        type: "SHOW_PANEL",
        payload: { panel: state.activePanel }
      });
    }

    for (const command of commands) {
      await this.gateway.dispatch(command);
    }
  }
}
