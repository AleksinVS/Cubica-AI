import { applyJsonMergePatch } from "@cubica/view-protocol";
import type { ViewCommand } from "@cubica/view-protocol";
import type { PlayerFacingContent, GamePlayerUiContent } from "@cubica/contracts-manifest";
import { ManifestAction } from "@cubica/contracts-manifest";
import type {
  GameSession,
  MetricsSnapshot,
  RuntimeUiState
} from "@/types/game-state";
import {
  createNewSessionWithOptions,
  resumeSession,
  dispatchAction as dispatchRuntimeAction,
  getGameReadiness,
  previewTransportRoad as previewRuntimeTransportRoad,
  runAgentTurn as runRuntimeAgentTurn,
  RuntimeClientError
} from "@/presenter/runtime-client";
import {
  projectMetricViewsFromContent,
  projectMetricsFromContent
} from "@/lib/metric-projection";
import {
  bindPortalLaunchSession,
  launchScopedStorageKey,
  readPortalLaunchContext,
  type PortalLaunchContext
} from "@/presenter/portal-launch-client";
import { ReactViewGateway } from "@/presenter/react-view-gateway";
import type { GameConfig } from "@/presenter/game-config";
import { resolveScreenKey as resolveScreenKeyDefault, resolveLayoutModeFromRouting } from "@/lib/screen-router";
import { normalizePlayerLayoutMode } from "@/lib/player-layout-mode";
import type { ClientRequest } from "@/presenter/types";
import type { PlayerRuntimeStatus, PlayerState } from "@/presenter/types";
import type { CubicaJsonValue, CubicaSurface, CubicaSurfaceAction } from "@cubica/contracts-ai";
import type { GameManifestAgentFailurePolicy } from "@cubica/contracts-manifest";
import type { TransportRoadPreviewResponse } from "@cubica/contracts-session";

export type { ClientRequest, PlayerState } from "@/presenter/types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Resolves the participant attributed to the next local gameplay action.
 *
 * A hotseat session (several people sharing one browser) publishes the current
 * participant in `public.turn.activePlayerId`. Its shared launch identity is
 * absent from `state.players`, so the server-confirmed active participant wins.
 * A personal/network launch keeps its configured identity when that identity is
 * an authoritative player key, preventing the browser from impersonating the
 * active opponent. Games without a turn model also keep the configured id.
 */
export function resolveRuntimeActorPlayerId(
  session: GameSession | null,
  configuredPlayerId: string
): string {
  const state = session?.state;
  const players = isRecord(state) ? state.players : undefined;
  const publicState = isRecord(state) ? state.public : undefined;
  const turn = isRecord(publicState) ? publicState.turn : undefined;
  const activePlayerId = isRecord(turn) ? turn.activePlayerId : undefined;

  // A configured identity that exists in the authoritative participant map is
  // a personal/network player and must never impersonate the active opponent.
  // Hotseat launches use a host identity that is absent from this map, so only
  // those sessions intentionally follow the currently active participant.
  if (isRecord(players) && Object.hasOwn(players, configuredPlayerId)) {
    return configuredPlayerId;
  }

  return typeof activePlayerId === "string" && activePlayerId.trim() !== ""
    ? activePlayerId
    : configuredPlayerId;
}

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
  private runtimeStatus: PlayerRuntimeStatus = "booting";
  private runtimeStatusReason: string | null = null;
  private runtimeFailurePolicy: GameManifestAgentFailurePolicy | null = null;
  private error: string | null = null;
  private errorStatus: number | null = null;
  private agentSurface: CubicaSurface | null = null;
  private dismissedPanel: string | null = null;
  private currentActivePanel: string | null = null;
  private launchContext: PortalLaunchContext | null = null;
  private contentSourceId: string | undefined;
  private deterministicFallbackActive = false;

  constructor(options: {
    gateway: ReactViewGateway;
    content: PlayerFacingContent;
    gameUi?: GamePlayerUiContent;
    config: GameConfig;
    contentSourceId?: string;
  }) {
    this.gateway = options.gateway;
    this.content = options.content;
    this.gameUi = options.gameUi;
    this.config = options.config;
    this.contentSourceId = options.contentSourceId;
  }

  /**
   * Runtime snapshot currently owned by the presenter.
   *
   * Editor preview uses it to report server-authoritative debugger snapshots
   * without exposing editor-specific concepts to runtime-api or player plugins.
   */
  get sessionSnapshot(): GameSession | null {
    return this.session;
  }

  /**
   * Публичное состояние для подписки View.
   */
  get playerState(): PlayerState {
    const publicState = this.session?.state?.public as Record<string, unknown> | undefined;
    const rawMetrics = { ...(publicState?.metrics as MetricsSnapshot) ?? {} };
    const projectedMetrics = projectMetricsFromContent(this.content, publicState ?? {}, rawMetrics);
    const metrics = this.config.resolveMetrics
      ? this.config.resolveMetrics(projectedMetrics)
      : projectedMetrics;
    const metricViews = projectMetricViewsFromContent(this.content, publicState ?? {}, metrics);
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

    // The selected screen is the most local declarative owner of its layout.
    // Routing only chooses a screen; it must not silently downgrade an
    // explicit map-first workspace to the historical topbar fallback.
    const declaredScreenLayout = screenKey
      ? normalizePlayerLayoutMode(this.gameUi?.screens[screenKey]?.layoutMode)
      : undefined;
    const layoutMode = declaredScreenLayout ?? (
      this.config.resolveLayoutMode
        ? this.config.resolveLayoutMode(screenKey, runtimeUi, gameState)
        : resolveLayoutModeFromRouting(screenRouting, currentScreenId, currentStepIndex, activeInfoId, runtimeUi) ?? "topbar"
    );

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
      metricViews,
      screenKey,
      layoutMode,
      activePanel,
      runtimeStatus: this.runtimeStatus,
      runtimeStatusReason: this.runtimeStatusReason,
      runtimeFailurePolicy: this.runtimeFailurePolicy,
      agentRuntimeRequired: this.content.agentRuntime?.required === true,
      error: this.error,
      errorStatus: this.errorStatus,
      booting: this.booting,
      isPending: this.isPending,
      agentSurface: this.agentSurface,
      log: Array.isArray(publicState?.log) ? (publicState?.log as Array<Record<string, unknown>>) : [],
    };
  }

  /**
   * Выполняет начальную загрузку сессии.
   */
  async boot(): Promise<void> {
    this.booting = true;
    this.runtimeStatus = "booting";
    this.runtimeStatusReason = null;
    this.runtimeFailurePolicy = null;
    this.deterministicFallbackActive = false;
    this.clearError();
    await this.syncView();

    try {
      if (!(await this.ensureLaunchReady())) {
        return;
      }

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
        this.clearError();
        await this.ensureAiDrivenSurface();
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
          this.agentSurface = null;
          this.clearError();
          await this.ensureAiDrivenSurface();
        } catch (error) {
          if (!(error instanceof RuntimeClientError) || error.statusCode !== 404) {
            throw error;
          }
          const data = await this.createSession();
          this.session = { ...data, gameId: this.config.gameId };
          if (typeof window !== "undefined") {
            window.localStorage.setItem(this.config.storageKey, data.sessionId);
          }
          this.agentSurface = null;
          this.clearError();
          await this.ensureAiDrivenSurface();
        }
      } else {
        const data = await this.createSession();
        this.session = { ...data, gameId: this.config.gameId };
        if (typeof window !== "undefined") {
          window.localStorage.setItem(this.config.storageKey, data.sessionId);
        }
        this.agentSurface = null;
        this.clearError();
        await this.ensureAiDrivenSurface();
      }
    } catch (err) {
      this.captureError(err, "Failed to initialize player");
    } finally {
      this.booting = false;
      if (this.runtimeStatus === "booting") {
        this.runtimeStatus = this.session === null ? "unavailable" : "ready";
      }
      await this.syncView();
    }
  }

  /**
   * Сбрасывает игру: удаляет localStorage и создаёт новую сессию.
   */
  async resetGame(): Promise<void> {
    this.booting = true;
    this.runtimeStatus = "booting";
    this.runtimeStatusReason = null;
    this.runtimeFailurePolicy = null;
    this.deterministicFallbackActive = false;
    this.clearError();
    this.agentSurface = null;
    if (typeof window !== "undefined") {
      const storageKey = this.launchContext
        ? launchScopedStorageKey(this.config.storageKey, this.launchContext)
        : this.config.storageKey;
      window.localStorage.removeItem(storageKey);
    }
    try {
      if (!(await this.ensureLaunchReady())) {
        return;
      }
      const data = this.launchContext
        ? await bindPortalLaunchSession(this.launchContext, this.config.playerId)
        : await this.createSession();
      this.session = { ...data, gameId: data.gameId || this.config.gameId };
      if (typeof window !== "undefined") {
        const storageKey = this.launchContext
          ? launchScopedStorageKey(this.config.storageKey, this.launchContext)
          : this.config.storageKey;
        window.localStorage.setItem(storageKey, data.sessionId);
      }
      this.clearError();
      await this.ensureAiDrivenSurface();
    } catch (err) {
      this.captureError(err, "Failed to reset player");
    } finally {
      this.booting = false;
      if (this.runtimeStatus === "booting") {
        this.runtimeStatus = this.session === null ? "unavailable" : "ready";
      }
      await this.syncView();
    }
  }

  /**
   * Обрабатывает событие от View или системы.
   */
  async handleEvent(request: ClientRequest): Promise<void> {
    if (this.booting || this.isPending || !this.session) {
      return;
    }

    if (request.type === ManifestAction.SHOW_PANEL) {
      const panelId = request.payload?.panelId ?? request.payload?.panel;
      if (typeof panelId === "string" && panelId.trim() !== "") {
        this.dismissedPanel = null;
        this.currentActivePanel = panelId;
        await this.syncView();
      }
      return;
    }

    if (request.type === ManifestAction.CLOSE_PANEL || request.type === ManifestAction.DISMISS_PANEL) {
      const panelId = request.payload?.panelId ?? request.payload?.panel;
      this.dismissedPanel = typeof panelId === "string" ? panelId : this.currentActivePanel;
      this.currentActivePanel = null;
      await this.syncView();
      return;
    }

    this.isPending = true;
    this.clearError();
    await this.syncView();

    try {
      if (request.type === ManifestAction.RESET_GAME) {
        await this.resetGame();
        return;
      }

      const next = await dispatchRuntimeAction(
        this.session.sessionId,
        resolveRuntimeActorPlayerId(this.session, this.config.playerId),
        request.type,
        this.session.version.stateVersion,
        request.payload ?? {}
      );

      // Merge snapshot: объединяем текущее состояние с новым delta
      const merged = applyJsonMergePatch(
        this.session as unknown as import("@cubica/view-protocol").JsonValue,
        next as unknown as import("@cubica/view-protocol").JsonValue
      ) as unknown as GameSession;

      this.session = merged;
      this.agentSurface = null;
      this.clearError();
    } catch (err) {
      await this.refreshSessionAfterVersionConflict(err);
      this.captureError(err, "Action dispatch failed");
    } finally {
      this.isPending = false;
      await this.syncView();
    }
  }

  /**
   * Dispatches intent from an interactive board and preserves rejection.
   *
   * Ordinary DOM controls use `handleEvent`, which captures errors for the
   * shared error panel. A dragged canvas object additionally needs a rejected
   * Promise so its game-owned scene can animate the preview back to the last
   * authoritative snapshot. This method updates the same presenter state and
   * error UI, then rethrows without letting the canvas become a second state
   * owner.
   */
  async handleBoardAction(
    actionId: string,
    payload: Record<string, unknown> = {}
  ): Promise<void> {
    if (this.booting || !this.session) {
      throw new Error("Игровая сессия еще не готова к действию на поле.");
    }
    if (this.isPending) {
      throw new Error("Дождитесь завершения предыдущего действия.");
    }

    this.isPending = true;
    this.clearError();
    await this.syncView();

    try {
      const next = await dispatchRuntimeAction(
        this.session.sessionId,
        resolveRuntimeActorPlayerId(this.session, this.config.playerId),
        actionId,
        this.session.version.stateVersion,
        payload
      );
      this.session = applyJsonMergePatch(
        this.session as unknown as import("@cubica/view-protocol").JsonValue,
        next as unknown as import("@cubica/view-protocol").JsonValue
      ) as unknown as GameSession;
      this.agentSurface = null;
      this.clearError();
    } catch (error) {
      await this.refreshSessionAfterVersionConflict(error);
      this.captureError(error, "Board action dispatch failed");
      throw error instanceof Error
        ? error
        : new Error("Действие на поле отклонено игровой системой.");
    } finally {
      this.isPending = false;
      await this.syncView();
    }
  }

  /**
   * Calculates a road against the current authoritative snapshot without
   * starting a gameplay transition.
   *
   * Preview state belongs to the interactive view, not to the Presenter. This
   * method therefore does not set the shared pending flag, replace the session
   * snapshot or copy preview failures into the persistent player error panel.
   */
  async previewTransportRoad(
    actionId: string,
    params: Record<string, unknown>
  ): Promise<TransportRoadPreviewResponse> {
    if (this.booting || !this.session) {
      throw new Error("Игровая сессия еще не готова к расчёту дороги.");
    }

    return previewRuntimeTransportRoad({
      sessionId: this.session.sessionId,
      expectedStateVersion: this.session.version.stateVersion,
      playerId: resolveRuntimeActorPlayerId(this.session, this.config.playerId),
      actionId,
      params
    });
  }

  /**
   * Handles a command emitted by a validated `CubicaSurface`.
   *
   * A surface action is only player intent. The Presenter routes it through
   * runtime-api, where Agent Runtime output and state effects are validated
   * before the next snapshot is accepted.
   */
  async handleSurfaceAction(action: CubicaSurfaceAction): Promise<void> {
    if (this.booting || this.isPending || !this.session) {
      return;
    }

    if (action.kind === "noop") {
      return;
    }

    if (!isSupportedPlayerSurfaceAction(action)) {
      this.captureError(new Error(`Surface action kind "${action.kind}" is not supported by player-web.`), "Surface action rejected");
      await this.syncView();
      return;
    }

    this.isPending = true;
    this.clearError();
    await this.syncView();

    try {
      if (action.kind === "agentTurn") {
        await this.runAgentTurn(action.id, action.payload);
      } else {
        const actionId = action.target ?? action.id;
        const next = await dispatchRuntimeAction(
          this.session.sessionId,
          resolveRuntimeActorPlayerId(this.session, this.config.playerId),
          actionId,
          this.session.version.stateVersion,
          surfacePayloadToRecord(action.payload)
        );
        this.session = { ...next, gameId: this.config.gameId };
        this.agentSurface = null;
      }
      this.clearError();
    } catch (err) {
      await this.refreshSessionAfterVersionConflict(err);
      this.captureError(err, "Surface action failed");
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

  private async ensureLaunchReady(): Promise<boolean> {
    if (!this.requiresAgentRuntime()) {
      return true;
    }

    const readiness = await getGameReadiness(this.config.gameId, this.contentSourceId);
    if (readiness.ready) {
      this.runtimeStatus = "booting";
      this.runtimeStatusReason = null;
      this.runtimeFailurePolicy = null;
      return true;
    }

    const agentRuntime = readiness.dependencies.agentRuntime;
    const failurePolicy = agentRuntime?.failurePolicy ?? this.content.agentRuntime?.failurePolicy ?? null;
    const fallbackActionId = this.content.agentRuntime?.deterministicFallbackActionId;
    if (failurePolicy === "deterministicFallback" && typeof fallbackActionId === "string" && fallbackActionId.length > 0) {
      this.deterministicFallbackActive = true;
      this.runtimeStatus = "booting";
      this.runtimeStatusReason = agentRuntime?.reason ?? "Agent Runtime unavailable; deterministic fallback is enabled.";
      this.runtimeFailurePolicy = failurePolicy;
      return true;
    }
    const reason =
      agentRuntime?.reason ??
      readiness.dependencies.gameContent?.message ??
      "Required Agent Runtime is unavailable.";

    this.error = reason;
    this.errorStatus = readiness.statusCode;
    this.runtimeStatus = statusForFailurePolicy(failurePolicy);
    this.runtimeStatusReason = reason;
    this.runtimeFailurePolicy = failurePolicy;
    return false;
  }

  private requiresAgentRuntime(): boolean {
    return this.content.agentRuntime?.required === true &&
      (this.content.executionMode === "ai-driven" || this.content.executionMode === "hybrid");
  }

  private createSession(): Promise<GameSession> {
    return createNewSessionWithOptions({
      gameId: this.config.gameId,
      playerId: this.config.playerId,
      contentSourceId: this.contentSourceId
    }) as Promise<GameSession>;
  }

  private async ensureAiDrivenSurface(): Promise<void> {
    if (this.session === null) {
      return;
    }
    if (this.content.executionMode !== "ai-driven" || this.content.agentRuntime?.required !== true) {
      return;
    }
    if (this.deterministicFallbackActive) {
      return;
    }
    await this.runAgentTurn(undefined, {});
  }

  private async runAgentTurn(actionId: string | undefined, payload: unknown): Promise<void> {
    if (this.session === null) {
      return;
    }
    const next = await runRuntimeAgentTurn(this.session.sessionId, this.config.playerId, actionId, payload);
    this.session = {
      sessionId: next.sessionId,
      gameId: this.config.gameId,
      version: next.version,
      state: next.state,
      actionAvailability: next.actionAvailability
    };
    this.agentSurface = next.agentTurn.surface ?? null;
    this.runtimeStatus = "ready";
    this.runtimeStatusReason = null;
    this.runtimeFailurePolicy = null;
  }

  private clearError(): void {
    this.error = null;
    this.errorStatus = null;
  }

  /**
   * Refreshes the authoritative snapshot after a stale action without
   * repeating that action. The facilitator must review the new state and
   * explicitly submit a new intent, which prevents a hidden double payment.
   */
  private async refreshSessionAfterVersionConflict(error: unknown): Promise<void> {
    if (!(error instanceof RuntimeClientError) || error.statusCode !== 409 || this.session === null) {
      return;
    }

    try {
      const refreshed = await resumeSession(this.session.sessionId);
      this.session = { ...refreshed, gameId: this.config.gameId };
      this.agentSurface = null;
    } catch {
      // Preserve the original 409 as the user-facing error. A subsequent boot
      // or manual reload will use the normal session recovery path.
    }
  }

  private captureError(error: unknown, fallback: string): void {
    this.error = error instanceof Error ? error.message : fallback;
    this.errorStatus = error instanceof RuntimeClientError ? error.statusCode : null;
    this.runtimeStatusReason = this.error;
    if (error instanceof RuntimeClientError && error.statusCode === 503 && this.requiresAgentRuntime()) {
      const failurePolicy = this.content.agentRuntime?.failurePolicy ?? null;
      this.runtimeStatus = statusForFailurePolicy(failurePolicy);
      this.runtimeFailurePolicy = failurePolicy;
      return;
    }
    if (this.session === null || this.booting) {
      this.runtimeStatus = "unavailable";
    }
  }
}

function surfacePayloadToRecord(payload: CubicaJsonValue | undefined): Record<string, unknown> {
  if (payload === undefined || payload === null) {
    return {};
  }
  if (typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return { value: payload };
}

function isSupportedPlayerSurfaceAction(
  action: CubicaSurfaceAction
): action is CubicaSurfaceAction & { readonly kind: "agentTurn" | "runtimeAction" } {
  return action.kind === "agentTurn" || action.kind === "runtimeAction";
}

function statusForFailurePolicy(policy: GameManifestAgentFailurePolicy | null): PlayerRuntimeStatus {
  if (policy === "pause") {
    return "paused";
  }
  if (policy === "retry") {
    return "retry";
  }
  return "unavailable";
}
