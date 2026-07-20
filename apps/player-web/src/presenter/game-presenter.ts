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
  RuntimeClientError,
  shouldRetainPendingRuntimeCommand
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
import { resolveScreenKey as resolveScreenKeyDefault, resolveLayoutModeFromRouting, resolveDesignLayoutMode } from "@/lib/screen-router";
import { normalizePlayerLayoutMode } from "@/lib/player-layout-mode";
import type { ClientRequest } from "@/presenter/types";
import type { PlayerRuntimeStatus, PlayerState } from "@/presenter/types";
import type { CubicaJsonValue, CubicaSurface, CubicaSurfaceAction } from "@cubica/contracts-ai";
import type { GameManifestAgentFailurePolicy } from "@cubica/contracts-manifest";
import type { TransportRoadPreviewResponse } from "@cubica/contracts-session";
import {
  clearPendingRuntimeCommand,
  createRuntimeActionEnvelope,
  createRuntimeAgentTurnEnvelope,
  loadPendingRuntimeCommand,
  pendingCommandMatchesAction,
  pendingCommandMatchesAgentTurn,
  savePendingRuntimeCommand,
  type PendingRuntimeCommand,
  type RuntimeActionEnvelope,
  type RuntimeAgentTurnEnvelope
} from "@/presenter/command-outbox";

export type { ClientRequest, PlayerState } from "@/presenter/types";

/**
 * Generic Presenter для игрового Web-плеера.
 *
 * Отвечает за:
 *  • boot сессии (создание / восстановление);
 *  • dispatch действий в runtime-api;
 *  • полную замену локального снимка серверным снимком;
 *  • генерацию ViewCommand для React View.
 *
 * Не содержит game-specific хардкодов: gameId, storageKey,
 * правила маршрутизации экранов, fallback-метрики и разрешение content
 * передаются через {@link GameConfig} извне. Идентичность игрока намеренно
 * не входит в клиентский config: runtime определяет субъект по защищённой
 * сессионной cookie (нечитаемому браузерным кодом файлу идентификации).
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
        ? this.config.resolveScreenKey(currentScreenId, currentStepIndex, activeInfoId, this.gameUi)
        : resolveScreenKeyDefault(screenRouting, currentScreenId, currentStepIndex, activeInfoId, this.gameUi)
      : null;

    // The selected screen is the most local declarative owner of its layout.
    // Routing only chooses a screen; it must not silently downgrade an
    // explicit map-first workspace to the historical topbar fallback.
    const declaredScreenLayout = screenKey
      ? normalizePlayerLayoutMode(this.gameUi?.screens[screenKey]?.layoutMode)
      : undefined;
    // Design-time layout declared by the UI manifest (ADR-093); fallback source
    // when a selected screen does not declare its own layoutMode.
    const designLayoutMode = resolveDesignLayoutMode(this.gameUi);
    const layoutMode = declaredScreenLayout ?? (
      this.config.resolveLayoutMode
        ? this.config.resolveLayoutMode(screenKey, gameState)
        : resolveLayoutModeFromRouting(screenRouting, currentScreenId, currentStepIndex, activeInfoId, designLayoutMode) ?? "topbar"
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
        const data = await bindPortalLaunchSession(portalLaunchContext);
        this.launchContext = portalLaunchContext;
        this.session = { ...data, gameId: data.gameId || this.config.gameId };
        if (typeof window !== "undefined") {
          window.localStorage.setItem(
            launchScopedStorageKey(this.config.storageKey, portalLaunchContext),
            data.sessionId
          );
        }
        this.clearError();
        await this.recoverPendingCommandOrEnsureAiSurface();
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
          await this.recoverPendingCommandOrEnsureAiSurface();
        } catch (error) {
          if (!(error instanceof RuntimeClientError) || (error.statusCode !== 401 && error.statusCode !== 404)) {
            throw error;
          }
          // The stored id outlived either its server record or its HttpOnly
          // credential. A command tied to that inaccessible session can never
          // be recovered and must not block the fresh local session.
          clearPendingRuntimeCommand(storedSessionId);
          const data = await this.createSession();
          this.session = { ...data, gameId: this.config.gameId };
          if (typeof window !== "undefined") {
            window.localStorage.setItem(this.config.storageKey, data.sessionId);
          }
          this.agentSurface = null;
          this.clearError();
          await this.recoverPendingCommandOrEnsureAiSurface();
        }
      } else {
        const data = await this.createSession();
        this.session = { ...data, gameId: this.config.gameId };
        if (typeof window !== "undefined") {
          window.localStorage.setItem(this.config.storageKey, data.sessionId);
        }
        this.agentSurface = null;
        this.clearError();
        await this.recoverPendingCommandOrEnsureAiSurface();
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
        ? await bindPortalLaunchSession(this.launchContext)
        : await this.createSession();
      this.session = { ...data, gameId: data.gameId || this.config.gameId };
      if (typeof window !== "undefined") {
        const storageKey = this.launchContext
          ? launchScopedStorageKey(this.config.storageKey, this.launchContext)
          : this.config.storageKey;
        window.localStorage.setItem(storageKey, data.sessionId);
      }
      this.clearError();
      await this.recoverPendingCommandOrEnsureAiSurface();
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

      const next = await this.dispatchGameIntent(request.type, request.payload ?? {});

      // Runtime responses are authoritative complete snapshots. Treating them
      // as JSON Merge Patch could preserve deleted or secret-stale local keys.
      this.session = { ...next, gameId: this.config.gameId };
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
      const next = await this.dispatchGameIntent(actionId, payload);
      this.session = { ...next, gameId: this.config.gameId };
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
      actionId,
      params
    });
  }

  /**
   * Handles a command emitted by a validated `CubicaSurface`.
   *
   * A surface action is only player intent. The Presenter routes it through
   * runtime-api, where the selected published Game Intent and its mechanics
   * transaction are validated before the next snapshot is accepted.
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
        const actionId = action.target;
        if (typeof actionId !== "string" || actionId.trim() === "") {
          throw new Error(`Surface Agent Turn "${action.id}" has no published actionId target.`);
        }
        await this.runAgentTurn(actionId, surfacePayloadToRecord(action.payload));
      } else {
        const actionId = action.target;
        if (typeof actionId !== "string" || actionId.trim() === "") {
          throw new Error(`Surface runtime action "${action.id}" has no published actionId target.`);
        }
        const next = await this.dispatchGameIntent(actionId, surfacePayloadToRecord(action.payload));
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
      contentSourceId: this.contentSourceId
    }) as Promise<GameSession>;
  }

  /**
   * Retries a command that may have reached runtime before a reload.
   *
   * Recovery always sends the stored envelope unchanged. If no command is
   * pending, AI-driven games can safely request their initial surface.
   */
  private async recoverPendingCommandOrEnsureAiSurface(): Promise<void> {
    if (this.session === null) return;
    const pending = loadPendingRuntimeCommand(this.session.sessionId);
    if (pending === null) {
      await this.ensureAiDrivenSurface();
      return;
    }

    try {
      await this.retryPendingCommand(pending);
      this.clearError();
    } catch (error) {
      if (!shouldRetainPendingRuntimeCommand(error)) {
        clearPendingRuntimeCommand(pending.envelope.sessionId);
      }
      // Unknown transport failures and explicit transient HTTP responses keep
      // the outbox: runtime may already have committed the command, so any
      // retry must retain the original identity and envelope.
      this.error = error instanceof Error ? error.message : "Pending gameplay command could not be recovered.";
      this.errorStatus = error instanceof RuntimeClientError ? error.statusCode : null;
    }
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
    const initialActionId = (this.content.agentRuntime as { readonly initialActionId?: unknown }).initialActionId;
    if (typeof initialActionId !== "string" || initialActionId.trim() === "") {
      throw new Error("AI-driven game does not publish an initial Agent Turn actionId.");
    }
    await this.runAgentTurn(initialActionId, {});
  }

  private async runAgentTurn(
    actionId: string,
    params: Record<string, unknown>
  ): Promise<void> {
    if (this.session === null) {
      return;
    }
    const pending = loadPendingRuntimeCommand(this.session.sessionId);
    let envelope: RuntimeAgentTurnEnvelope;
    if (pending !== null) {
      if (!pendingCommandMatchesAgentTurn(pending, actionId, params)) {
        throw new Error("A different gameplay command is still awaiting a confirmed result.");
      }
      envelope = pending.envelope;
    } else {
      envelope = createRuntimeAgentTurnEnvelope({
        sessionId: this.session.sessionId,
        actionId,
        expectedStateVersion: this.session.version.stateVersion,
        params
      });
      savePendingRuntimeCommand({ endpoint: "agent-turn", envelope });
    }

    const next = await this.sendAgentTurnEnvelope(envelope);
    this.applyAgentTurnSnapshot(next);
  }

  private async dispatchGameIntent(
    actionId: string,
    params: Record<string, unknown>
  ): Promise<Awaited<ReturnType<typeof dispatchRuntimeAction>>> {
    if (this.session === null) {
      throw new Error("Игровая сессия еще не готова к действию.");
    }

    const pending = loadPendingRuntimeCommand(this.session.sessionId);
    let envelope: RuntimeActionEnvelope;
    if (pending !== null) {
      if (!pendingCommandMatchesAction(pending, actionId, params)) {
        throw new Error("A different gameplay command is still awaiting a confirmed result.");
      }
      envelope = pending.envelope;
    } else {
      envelope = createRuntimeActionEnvelope({
        sessionId: this.session.sessionId,
        actionId,
        expectedStateVersion: this.session.version.stateVersion,
        params
      });
      savePendingRuntimeCommand({ endpoint: "action", envelope });
    }

    try {
      const snapshot = await dispatchRuntimeAction(envelope);
      clearPendingRuntimeCommand(envelope.sessionId);
      return snapshot;
    } catch (error) {
      if (!shouldRetainPendingRuntimeCommand(error)) {
        clearPendingRuntimeCommand(envelope.sessionId);
      }
      throw error;
    }
  }

  private async sendAgentTurnEnvelope(
    envelope: RuntimeAgentTurnEnvelope
  ): Promise<Awaited<ReturnType<typeof runRuntimeAgentTurn>>> {
    try {
      const snapshot = await runRuntimeAgentTurn(envelope);
      clearPendingRuntimeCommand(envelope.sessionId);
      return snapshot;
    } catch (error) {
      if (!shouldRetainPendingRuntimeCommand(error)) {
        clearPendingRuntimeCommand(envelope.sessionId);
      }
      throw error;
    }
  }

  private async retryPendingCommand(pending: PendingRuntimeCommand): Promise<void> {
    if (pending.endpoint === "action") {
      const next = await dispatchRuntimeAction(pending.envelope).catch((error: unknown) => {
        if (!shouldRetainPendingRuntimeCommand(error)) {
          clearPendingRuntimeCommand(pending.envelope.sessionId);
        }
        throw error;
      });
      clearPendingRuntimeCommand(pending.envelope.sessionId);
      this.session = { ...next, gameId: this.config.gameId };
      this.agentSurface = null;
      return;
    }

    const next = await this.sendAgentTurnEnvelope(pending.envelope);
    this.applyAgentTurnSnapshot(next);
  }

  private applyAgentTurnSnapshot(
    next: Awaited<ReturnType<typeof runRuntimeAgentTurn>>
  ): void {
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

    // Runtime checks an existing receipt before returning 409. Therefore a
    // conflict certifies that this logical command was not admitted and its
    // stale envelope must not block the replacement intent.
    clearPendingRuntimeCommand(this.session.sessionId);

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
