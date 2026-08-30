import type { ViewCommand } from "@cubica/view-protocol";
import type { SessionSnapshot } from "@/lib/game-content-resolvers";
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
  shouldRetainPendingRuntimeCommand,
  subscribeToSessionEvents,
  claimPrivateInvite,
  recoverGuestSeat,
  consumePrivateInviteFragment,
  type SessionEventSubscription
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
import type { PlayerRuntimeStatus, PlayerState, PlayerSessionSetup } from "@/presenter/types";
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
import { normalizeAgentControl } from "@/presenter/agent-control-validation";

export type { ClientRequest, PlayerState } from "@/presenter/types";

function hostManagementHintKey(sessionId: string): string {
  return `cubica-host-management:${sessionId}`;
}

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
  private sessionSetup: PlayerSessionSetup | null = null;
  private readonly sessionSetupEnabled: boolean;
  private sessionEvents: SessionEventSubscription | null = null;
  private sessionLifecycle = 0;
  private hostManagementHint = false;

  constructor(options: {
    gateway: ReactViewGateway;
    content: PlayerFacingContent;
    gameUi?: GamePlayerUiContent;
    config: GameConfig;
    contentSourceId?: string;
    sessionSetupEnabled?: boolean;
  }) {
    this.gateway = options.gateway;
    this.content = options.content;
    this.gameUi = options.gameUi;
    this.config = options.config;
    this.contentSourceId = options.contentSourceId;
    this.sessionSetupEnabled = options.sessionSetupEnabled ?? true;
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

  dispose(): void {
    this.beginSessionLifecycle();
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
      participants: this.session?.participants ?? [],
      actionAvailability: this.session?.actionAvailability ?? [],
      privateInvites: this.session?.privateInvites ?? [],
      hostManagementHint: this.hostManagementHint,
      agentControl: normalizeAgentControl(this.session?.agentControl),
      sessionSetup: this.sessionSetup,
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
    // A repeated boot replaces the old lifecycle rather than leaving an SSE
    // listener attached to a session that is no longer presenter-owned.
    const lifecycle = this.beginSessionLifecycle();
    this.booting = true;
    this.runtimeStatus = "booting";
    this.runtimeStatusReason = null;
    this.runtimeFailurePolicy = null;
    this.deterministicFallbackActive = false;
    this.clearError();
    // Fragment removal is deliberately synchronous and precedes all network work.
    const invite = consumePrivateInviteFragment();
    await this.syncView();

    try {
      if (!(await this.ensureLaunchReady())) {
        return;
      }

      const portalLaunchContext = readPortalLaunchContext();

      if (invite) {
        const data = await claimPrivateInvite(invite.sessionId, invite.inviteToken);
        if (!this.adoptSessionSnapshot(data, lifecycle, true)) return;
        if (typeof window !== "undefined") window.localStorage.setItem(this.config.storageKey, data.sessionId);
        this.clearError();
        await this.recoverPendingCommandOrEnsureAiSurface();
        return;
      } else if (portalLaunchContext) {
        const data = await bindPortalLaunchSession(portalLaunchContext);
        if (!this.adoptSessionSnapshot(data, lifecycle, true)) return;
        this.launchContext = portalLaunchContext;
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
          this.hostManagementHint = window.localStorage.getItem(hostManagementHintKey(storedSessionId)) === "1";
          if (!this.adoptSessionSnapshot(data, lifecycle, true)) return;
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
          // Its former setup is not authenticated client state. The accepted
          // recovery path creates a manifest-minimum all-human replacement.
          const data = await this.createSession();
          this.recordHostManagementHint(data);
          if (!this.adoptSessionSnapshot(data, lifecycle, true)) return;
          if (typeof window !== "undefined") {
            window.localStorage.setItem(this.config.storageKey, data.sessionId);
          }
          this.agentSurface = null;
          this.clearError();
          await this.recoverPendingCommandOrEnsureAiSurface();
        }
      } else {
        const setup = this.getSessionSetup();
        if (setup !== null) {
          this.sessionSetup = setup;
          return;
        }
        const data = await this.createSession();
        this.recordHostManagementHint(data);
        if (!this.adoptSessionSnapshot(data, lifecycle, true)) return;
        if (typeof window !== "undefined") {
          window.localStorage.setItem(this.config.storageKey, data.sessionId);
        }
        this.agentSurface = null;
        this.clearError();
        await this.recoverPendingCommandOrEnsureAiSurface();
      }
    } catch (err) {
      if (lifecycle === this.sessionLifecycle) {
        this.captureError(err, "Failed to initialize player");
      }
    } finally {
      if (lifecycle === this.sessionLifecycle) {
        this.booting = false;
        if (this.runtimeStatus === "booting") {
          this.runtimeStatus = this.session === null ? "unavailable" : "ready";
        }
        this.startSessionEvents(lifecycle);
        await this.syncView();
      }
    }
  }

  /**
   * Сбрасывает игру: удаляет localStorage и создаёт новую сессию.
   */
  async resetGame(): Promise<void> {
    const lifecycle = this.beginSessionLifecycle();
    const declaredSetup = this.getSessionSetup();
    const resetOptions = this.session === null
      ? undefined
      : {
          participantCount: this.session.participants.length,
          agentSeatCount: this.session.participants.some((participant) => participant.joinState !== "local")
            ? 0
            : this.session.participants.filter((participant) => participant.kind === "agent").length,
          ...(this.session.participants.some((participant) => participant.joinState !== "local")
            ? { accessMode: "private-invite" as const }
            : {})
        };
    this.booting = true;
    this.runtimeStatus = "booting";
    this.runtimeStatusReason = null;
    this.runtimeFailurePolicy = null;
    this.deterministicFallbackActive = false;
    this.clearError();
    this.agentSurface = null;
    this.sessionSetup = null;
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
        : this.session === null && declaredSetup !== null
          ? null
          : await this.createSession(resetOptions);
      if (data === null) {
        this.sessionSetup = declaredSetup;
        return;
      }
      if (!this.adoptSessionSnapshot(data, lifecycle, true)) return;
      this.recordHostManagementHint(data);
      if (typeof window !== "undefined") {
        const storageKey = this.launchContext
          ? launchScopedStorageKey(this.config.storageKey, this.launchContext)
          : this.config.storageKey;
        window.localStorage.setItem(storageKey, data.sessionId);
      }
      this.clearError();
      await this.recoverPendingCommandOrEnsureAiSurface();
    } catch (err) {
      if (lifecycle === this.sessionLifecycle) {
        this.captureError(err, "Failed to reset player");
      }
    } finally {
      if (lifecycle === this.sessionLifecycle) {
        this.booting = false;
        if (this.runtimeStatus === "booting") {
          this.runtimeStatus = this.session === null ? "unavailable" : "ready";
        }
        this.startSessionEvents(lifecycle);
        await this.syncView();
      }
    }
  }

  /** Starts a session after the generic local seat setup was confirmed. */
  async createSessionFromSetup(selection: {
    participantCount: number;
    agentSeatCount: number;
    accessMode?: "local" | "private-invite";
  }): Promise<void> {
    if (this.booting || this.session !== null || this.sessionSetup === null) {
      return;
    }

    const setup = this.sessionSetup;
    if (!isValidSessionSetupSelection(selection, setup)) {
      return;
    }

    const lifecycle = this.beginSessionLifecycle();
    this.booting = true;
    this.runtimeStatus = "booting";
    this.runtimeStatusReason = null;
    this.clearError();
    this.sessionSetup = null;
    await this.syncView();

    try {
      if (!(await this.ensureLaunchReady())) {
        this.sessionSetup = setup;
        return;
      }
      const data = await this.createSession(selection.accessMode === "private-invite"
        ? { participantCount: selection.participantCount, agentSeatCount: 0, accessMode: "private-invite" }
        : { participantCount: selection.participantCount, agentSeatCount: selection.agentSeatCount });
      if (!this.adoptSessionSnapshot(data, lifecycle, true)) return;
      this.recordHostManagementHint(data);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(this.config.storageKey, data.sessionId);
      }
      this.clearError();
      await this.recoverPendingCommandOrEnsureAiSurface();
    } catch (err) {
      if (lifecycle === this.sessionLifecycle) {
        this.sessionSetup = setup;
        this.captureError(err, "Failed to create player session");
      }
    } finally {
      if (lifecycle === this.sessionLifecycle) {
        this.booting = false;
        if (this.runtimeStatus === "booting") {
          this.runtimeStatus = this.session === null ? "unavailable" : "ready";
        }
        this.startSessionEvents(lifecycle);
        await this.syncView();
      }
    }
  }

  /** Refreshes the authoritative session snapshot through a safe GET. */
  async refreshSession(): Promise<void> {
    if (this.session === null || this.booting || this.isPending) {
      return;
    }
    const lifecycle = this.sessionLifecycle;
    const sessionId = this.session.sessionId;
    try {
      const refreshed = await resumeSession(sessionId);
      if (this.adoptSessionSnapshot(refreshed, lifecycle)) {
        this.agentSurface = null;
        this.clearError();
      }
    } catch (error) {
      if (lifecycle === this.sessionLifecycle) {
        this.captureError(error, "Failed to refresh player session");
      }
    } finally {
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
    const lifecycle = this.sessionLifecycle;
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
      if (this.adoptSessionSnapshot(next, lifecycle)) {
        this.agentSurface = null;
      }
      this.clearError();
    } catch (err) {
      await this.refreshSessionAfterVersionConflict(err, lifecycle);
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
    const lifecycle = this.sessionLifecycle;
    this.clearError();
    await this.syncView();

    try {
      const next = await this.dispatchGameIntent(actionId, payload);
      if (this.adoptSessionSnapshot(next, lifecycle)) {
        this.agentSurface = null;
      }
      this.clearError();
    } catch (error) {
      await this.refreshSessionAfterVersionConflict(error, lifecycle);
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
    const lifecycle = this.sessionLifecycle;
    this.clearError();
    await this.syncView();

    try {
      if (action.kind === "agentTurn") {
        const actionId = action.target;
        if (typeof actionId !== "string" || actionId.trim() === "") {
          throw new Error(`Surface Agent Turn "${action.id}" has no published actionId target.`);
        }
        await this.runAgentTurn(actionId, surfacePayloadToRecord(action.payload), lifecycle);
      } else {
        const actionId = action.target;
        if (typeof actionId !== "string" || actionId.trim() === "") {
          throw new Error(`Surface runtime action "${action.id}" has no published actionId target.`);
        }
        const next = await this.dispatchGameIntent(actionId, surfacePayloadToRecord(action.payload));
        if (this.adoptSessionSnapshot(next, lifecycle)) {
          this.agentSurface = null;
        }
      }
      this.clearError();
    } catch (err) {
      await this.refreshSessionAfterVersionConflict(err, lifecycle);
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

  private createSession(options?: { participantCount?: number; agentSeatCount?: number; accessMode?: "private-invite" }): Promise<GameSession> {
    return createNewSessionWithOptions({
      gameId: this.config.gameId,
      contentSourceId: this.contentSourceId,
      ...options
    }) as Promise<GameSession>;
  }

  async recoverGuestSeat(seatId: string) {
    if (!this.session) throw new Error("Игровая сессия еще не готова.");
    return recoverGuestSeat(this.session.sessionId, seatId);
  }

  private recordHostManagementHint(snapshot: GameSession): void {
    this.hostManagementHint = Array.isArray(snapshot.privateInvites) && snapshot.privateInvites.length > 0;
    if (this.hostManagementHint && typeof window !== "undefined") {
      window.localStorage.setItem(hostManagementHintKey(snapshot.sessionId), "1");
    }
  }

  private beginSessionLifecycle(): number {
    this.sessionEvents?.stop();
    this.sessionEvents = null;
    this.sessionLifecycle += 1;
    return this.sessionLifecycle;
  }

  private startSessionEvents(lifecycle: number): void {
    if (lifecycle !== this.sessionLifecycle) return;
    this.sessionEvents?.stop();
    this.sessionEvents = null;
    if (this.session === null) return;
    const sessionId = this.session.sessionId;
    this.sessionEvents = subscribeToSessionEvents(sessionId, (snapshot) => {
      if (snapshot.sessionId !== sessionId) return;
      if (this.adoptSessionSnapshot(snapshot, lifecycle)) {
        void this.syncView();
      }
    });
  }

  /**
   * Owns every authoritative snapshot replacement for one credential lifecycle.
   * Cursors are lexicographically monotonic: stateVersion first, then event
   * sequence. Equal cursors are deliberately refreshable because a GET is
   * principal-scoped; creation-only invite tokens remain local until joined.
   */
  private adoptSessionSnapshot(
    snapshot: SessionSnapshot,
    lifecycle: number,
    replaceCurrent = false
  ): boolean {
    if (lifecycle !== this.sessionLifecycle) return false;

    const current = this.session;
    if (!replaceCurrent && current !== null) {
      if (snapshot.sessionId !== current.sessionId) return false;
      const stateVersionDelta = snapshot.version.stateVersion - current.version.stateVersion;
      const eventSequenceDelta = snapshot.version.lastEventSequence - current.version.lastEventSequence;
      if (stateVersionDelta < 0 || (stateVersionDelta === 0 && eventSequenceDelta < 0)) {
        return false;
      }
    }

    const existingInvites = !replaceCurrent && current?.sessionId === snapshot.sessionId
      ? current.privateInvites ?? []
      : [];
    const invites = snapshot.privateInvites ?? existingInvites;
    const joined = new Set(snapshot.participants.filter((participant) => participant.joinState === "joined").map((participant) => participant.playerId));
    this.session = {
      ...snapshot,
      gameId: snapshot.gameId || this.config.gameId,
      privateInvites: invites.filter((invite) => !joined.has(invite.playerId))
    };
    return true;
  }

  private getSessionSetup(): PlayerSessionSetup | null {
    if (!this.sessionSetupEnabled) return null;
    const playerConfig = this.content.playerConfig;
    const agentSeats = playerConfig.agentSeats;
    const minParticipants = Number.isInteger(playerConfig.min) && playerConfig.min > 0
      ? playerConfig.min
      : 1;
    const maxParticipants = Number.isInteger(playerConfig.max) && playerConfig.max >= minParticipants
      ? playerConfig.max
      : minParticipants;
    const maxAgentSeats = agentSeats !== undefined && Number.isInteger(agentSeats.max) && agentSeats.max > 0
      ? Math.min(agentSeats.max, maxParticipants)
      : 0;
    if (minParticipants === maxParticipants && maxAgentSeats === 0) return null;
    return {
      participantCount: minParticipants,
      minParticipants,
      maxParticipants,
      maxAgentSeats
    };
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
    params: Record<string, unknown>,
    lifecycle = this.sessionLifecycle
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
    this.applyAgentTurnSnapshot(next, lifecycle);
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
    const lifecycle = this.sessionLifecycle;
    if (pending.endpoint === "action") {
      const next = await dispatchRuntimeAction(pending.envelope).catch((error: unknown) => {
        if (!shouldRetainPendingRuntimeCommand(error)) {
          clearPendingRuntimeCommand(pending.envelope.sessionId);
        }
        throw error;
      });
      clearPendingRuntimeCommand(pending.envelope.sessionId);
      if (this.adoptSessionSnapshot(next, lifecycle)) {
        this.agentSurface = null;
      }
      return;
    }

    const next = await this.sendAgentTurnEnvelope(pending.envelope);
    this.applyAgentTurnSnapshot(next, lifecycle);
  }

  private applyAgentTurnSnapshot(
    next: Awaited<ReturnType<typeof runRuntimeAgentTurn>>,
    lifecycle: number
  ): void {
    const snapshot: SessionSnapshot = {
      sessionId: next.sessionId,
      gameId: this.config.gameId,
      participants: next.participants,
      version: next.version,
      state: next.state,
      actionAvailability: next.actionAvailability,
      ...(next.agentControl === undefined ? {} : { agentControl: next.agentControl })
    };
    if (!this.adoptSessionSnapshot(snapshot, lifecycle)) return;
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
  private async refreshSessionAfterVersionConflict(error: unknown, lifecycle: number): Promise<void> {
    if (!(error instanceof RuntimeClientError) || error.statusCode !== 409 || this.session === null) {
      return;
    }

    // Runtime checks an existing receipt before returning 409. Therefore a
    // conflict certifies that this logical command was not admitted and its
    // stale envelope must not block the replacement intent.
    clearPendingRuntimeCommand(this.session.sessionId);

    try {
      const refreshed = await resumeSession(this.session.sessionId);
      if (this.adoptSessionSnapshot(refreshed, lifecycle)) {
        this.agentSurface = null;
      }
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

function isValidSessionSetupSelection(
  selection: { participantCount: number; agentSeatCount: number },
  setup: PlayerSessionSetup
): boolean {
  return Number.isInteger(selection.participantCount) &&
    selection.participantCount >= setup.minParticipants &&
    selection.participantCount <= setup.maxParticipants &&
    Number.isInteger(selection.agentSeatCount) &&
    selection.agentSeatCount >= 0 &&
    selection.agentSeatCount <= Math.min(setup.maxAgentSeats, selection.participantCount);
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
