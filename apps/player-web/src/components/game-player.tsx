"use client";

import { pausePreviewDom } from "@/lib/preview-renderer-pause";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, SyntheticEvent } from "react";
import type {
  PlayerFacingContent,
  PlayerWebPluginBundleReference,
  PlayerFacingMockup,
  GamePlayerUiContent,
  GameUiComponent
} from "@cubica/contracts-manifest";
import { ManifestAction } from "@cubica/contracts-manifest";
import { useLocale } from "@/components/locale-context";
import type { PlayerState } from "@/presenter/types";
import type { EditorDebugBridgeRequest, EditorPreviewSceneRequest, EditorPreviewPrototypeRequest } from "@cubica/contracts-session";
import type { ViewCommand } from "@cubica/view-protocol";
import type { GameConfigData } from "@/presenter/game-config";
import { GamePresenter } from "@/presenter/game-presenter";
import { ReactViewGateway } from "@/presenter/react-view-gateway";
import { buildGameConfig, resolveRegisteredGameConfigData } from "@/presenter/game-config-registry";
import {
  activatePlayerWebPluginBundles,
  type PlayerWebPluginLoadHandle
} from "@/plugins/preview-plugin-loader";
import { ManifestRenderer } from "@/components/manifest/manifest-renderer";
import {
  previewPanelRootPointer,
  previewScreenRootPointer,
  withPreviewPrototypeOverride
} from "@/components/manifest/preview-prototype-override";
import { SafeModeRenderer } from "@/components/safe-mode-renderer";
import { CubicaSurfaceRenderer } from "@/components/surface/cubica-surface-renderer";
import { RuntimeStatusPanel } from "@/components/runtime-status-panel";
import { PublicJournalDownload } from "@/components/public-journal-download";
import {
  useEditorPreviewBridge,
  type EditorPreviewCompletedAction,
  type EditorPreviewSessionSnapshot
} from "@/components/editor-preview-bridge";
import { scrollPreviewSceneFocus } from "@/components/editor-preview-scene-focus";
import {
  createEmptyGameAssetResolver,
  loadGameAssetResolver,
  resolveThemeBackgroundStyle,
  uiUsesGameAssets,
  type GameAssetResolver
} from "@/lib/game-asset-resolver";
import { applyGameStylesheetLinks } from "@/lib/game-stylesheet-links";
import type { PlayerLayoutMode } from "@/lib/player-layout-mode";
import { createManifestActionAdapter } from "@/lib/manifest-action-adapter";
import { restorePreviewSession } from "@/presenter/runtime-client";
import { SessionSetupPanel } from "@/components/session-setup-panel";
import { SessionParticipants } from "@/components/session-participants";
import { AgentControlPanel } from "@/components/agent-control-panel";
import { SessionAiDebriefPanel } from "@/components/session-ai-debrief-panel";
import { buildPrivateInviteFragment } from "@/lib/private-invite-fragment";

export type { PlayerFacingMockup as GameMockup };

const EMPTY_PLAYER_PLUGIN_BUNDLES: readonly PlayerWebPluginBundleReference[] = [];

export type GamePlayerProps = {
  runtimeApiUrl: string;
  content: PlayerFacingContent;
  mockups: Array<PlayerFacingMockup>;
  gameUi?: GamePlayerUiContent;
  /** Serializable game configuration data (passed from Server Component). */
  config: GameConfigData;
  /** Optional editor preview session created by runtime-api before opening player-web. */
  initialSessionId?: string;
  /** Enables metadata bridge from preview iframe back to editor-web. */
  editorPreviewMode?: boolean;
  /** Parent editor origin used as the target for preview postMessage calls. */
  editorPreviewParentOrigin?: string;
  /** Preview or published player-web plugin bundles served by runtime-api. */
  playerPluginBundles?: readonly PlayerWebPluginBundleReference[];
  /** Optional generated content source used by editor preview sessions. */
  contentSourceId?: string;
  /** Authoring compile token supplied by the editor URL, then advanced by refresh ack. */
  previewRevision?: string;
};

/**
 * Корневой компонент игрового плеера.
 *
 * Создаёт Presenter и ViewGateway, подписывается на команды от Presenter
 * и обновляет React-состояние. Вся бизнес-логика (boot, dispatch, routing)
 * делегирована Presenter.
 *
 * GameConfigData передаётся через пропсы от Server Component,
 * а функциональные резолверы предоставляются через реестр
 * (game-config-registry) и объединяются с данными на клиенте.
 */
export function GamePlayer({
  runtimeApiUrl,
  content: initialContent,
  gameUi: initialGameUi,
  config: configData,
  initialSessionId,
  editorPreviewMode = false,
  editorPreviewParentOrigin,
  playerPluginBundles = EMPTY_PLAYER_PLUGIN_BUNDLES,
  contentSourceId,
  previewRevision
}: GamePlayerProps) {
  const [content, setContent] = useState(initialContent);
  const [gameUi, setGameUi] = useState(initialGameUi);
  const [activePreviewRevision, setActivePreviewRevision] = useState(previewRevision ?? "unverified");
  const previewRefreshEpochRef = useRef(0);
  const previewSceneActiveRef = useRef(false);
  const [previewSceneActive, setPreviewSceneActive] = useState(false);
  const previewPrototypeRef = useRef<{ readonly runtimePointer: string; readonly requestId: string;
    readonly component: GameUiComponent } | null>(null);
  const previewPrototypeEpochRef = useRef(0);
  const [previewPrototype, setPreviewPrototype] = useState<typeof previewPrototypeRef.current>(null);
  const t = useLocale();
  const playerPluginSignature = useMemo(
    () => playerPluginBundles.map((bundle) => `${bundle.scope}:${bundle.pluginId}:${bundle.contentHash}`).join("|"),
    [playerPluginBundles]
  );
  // TSK-20260719 R4b: whether the game needs the asset index (ADR-063) is
  // still decided from the UI manifest alone (`uiUsesGameAssets(gameUi)`),
  // not from the plugin config's themeBackgroundImage — a game that declares
  // an `asset:<id>` background AND uses `asset:` anywhere in its UI manifest
  // (the common case; every screen carries at least one such reference once
  // migrated) already loads the resolver through this existing check. A game
  // that used *only* a config-level `asset:` theme background with no
  // UI-manifest asset reference at all would need this check widened to also
  // look at `fullConfig.themeBackgroundImage`; left as a known, narrow gap
  // (documented below) rather than reordering hook initialization around a
  // config value that is not always available on the first render (a
  // registered plugin's config only replaces the server default once
  // `playerPluginState.status === "ready"`).
  const needsGameAssets = useMemo(() => uiUsesGameAssets(gameUi), [gameUi]);
  const [gameAssets, setGameAssets] = useState<GameAssetResolver | null>(
    () => needsGameAssets ? null : createEmptyGameAssetResolver()
  );
  const [playerPluginState, setPlayerPluginState] = useState<{
    readonly status: "loading" | "ready" | "error";
    readonly key: string;
    readonly message?: string;
  }>(() => ({
    status: playerPluginBundles.length > 0 ? "loading" : "ready",
    key: playerPluginSignature
  }));
  const activeConfigData = useMemo(
    () => playerPluginState.status === "ready"
      ? resolveRegisteredGameConfigData(initialContent, configData)
      : configData,
    [initialContent, configData, playerPluginState.key, playerPluginState.status]
  );
  const fullConfig = useMemo(
    () => buildGameConfig(activeConfigData),
    [activeConfigData, playerPluginState.key, playerPluginState.status]
  );

  const [playerState, setPlayerState] = useState<PlayerState | null>(null);
  const [screenKey, setScreenKey] = useState<string | undefined>(undefined);
  const [layoutMode, setLayoutMode] = useState<PlayerLayoutMode>("topbar");
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [lastCompletedPreviewAction, setLastCompletedPreviewAction] = useState<EditorPreviewCompletedAction | undefined>(
    undefined
  );

  useEffect(() => {
    if (!needsGameAssets) {
      setGameAssets(createEmptyGameAssetResolver());
      return;
    }

    let cancelled = false;
    setGameAssets(null);
    void loadGameAssetResolver({ runtimeApiUrl, gameId: content.gameId, contentSourceId }).then((resolver) => {
      if (!cancelled) {
        setGameAssets(resolver);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [content.gameId, contentSourceId, needsGameAssets, runtimeApiUrl]);

  // Game-owned stylesheets (ADR-091): inject a <link> per declared asset:<id>
  // once the asset resolver is loaded, and remove them on unmount/reload. The
  // stable signature avoids re-injecting when the array identity changes but its
  // contents do not. The renderer stays game-agnostic — it applies whatever the
  // manifest lists without knowing the game.
  const gameStylesheetSignature = useMemo(
    () => (gameUi?.stylesheets ?? []).join("|"),
    [gameUi?.stylesheets]
  );
  useEffect(() => {
    const references = gameUi?.stylesheets;
    if (references === undefined || references.length === 0 || gameAssets === null) {
      return;
    }
    return applyGameStylesheetLinks({ references, resolver: gameAssets });
    // gameStylesheetSignature captures the reference contents; gameAssets flips
    // from null to the loaded resolver.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameStylesheetSignature, gameAssets]);

  const presenterRef = useRef<GamePresenter | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const handleEditorDebugSession = useCallback(async (request: EditorDebugBridgeRequest) => {
    const presenter = presenterRef.current;
    if (presenter === null) throw new Error("Отладочная сессия ещё не готова.");
    return presenter.handleEditorDebugCommand(request);
  }, []);
  const handlePreviewContentRefresh = useCallback(async (request: { sessionId: string; revision: string }) => {
    const epoch = ++previewRefreshEpochRef.current;
    const presenter = presenterRef.current;
    if (!editorPreviewMode || contentSourceId === undefined || presenter?.sessionSnapshot?.sessionId !== request.sessionId ||
        presenter.sessionSnapshot.debugPaused !== true) throw new Error("Preview must be paused before refreshing its UI.");
    const path = `/api/runtime/player-content/${encodeURIComponent(initialContent.gameId)}?contentSourceId=${encodeURIComponent(contentSourceId)}`;
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error(`Preview content returned HTTP ${response.status}.`);
    const next = await response.json() as PlayerFacingContent;
    if (epoch !== previewRefreshEpochRef.current) throw new Error("A newer preview refresh superseded this request.");
    const gameplay = (value: PlayerFacingContent) => JSON.stringify({ ...value, ui: undefined, mockups: undefined });
    if (next.gameId !== initialContent.gameId || gameplay(next) !== gameplay(initialContent)) return { requiresRestart: true };
    await presenter.updatePreviewUi(next);
    if (epoch !== previewRefreshEpochRef.current) throw new Error("A newer preview refresh superseded this request.");
    setContent(next);
    setGameUi(next.ui);
    previewPrototypeEpochRef.current += 1;
    previewPrototypeRef.current = null;
    setPreviewPrototype(null);
    setActivePreviewRevision(request.revision);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return {};
  }, [contentSourceId, editorPreviewMode, initialContent]);
  const handlePreviewScene = useCallback(async (request: EditorPreviewSceneRequest) => {
    const presenter = presenterRef.current;
    if (presenter?.sessionSnapshot?.sessionId !== request.sessionId) throw new Error("Preview scene belongs to another session.");
    await presenter.showPreviewScene(request.selector);
    previewPrototypeEpochRef.current += 1;
    previewPrototypeRef.current = null;
    setPreviewPrototype(null);
    previewSceneActiveRef.current = request.selector !== null;
    setPreviewSceneActive(request.selector !== null);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    scrollPreviewSceneFocus(rootRef.current, request.selector?.focusRuntimePointer);
  }, []);
  const handlePreviewPrototype = useCallback(async (request: EditorPreviewPrototypeRequest) => {
    const presenter = presenterRef.current;
    if (!editorPreviewMode || presenter?.sessionSnapshot?.sessionId !== request.sessionId ||
        presenter.sessionSnapshot.debugPaused !== true) {
      throw new Error("A paused preview session is required for prototype display.");
    }
    if (request.component === null) {
      if (previewPrototypeRef.current !== null &&
          previewPrototypeRef.current.runtimePointer !== request.runtimePointer) {
        throw new Error("Prototype preview target changed before clearing.");
      }
      previewPrototypeRef.current = null;
      setPreviewPrototype(null);
    } else {
      const current = presenter.playerState;
      const replacement = request.component as unknown as GameUiComponent;
      const screenKey = current.screenKey;
      const panelKey = current.activePanel;
      const screen = screenKey === null ? undefined : gameUi?.screens[screenKey];
      const panel = panelKey === null ? undefined : gameUi?.panels?.[panelKey];
      const screenVisible = !panel || screen?.layoutMode === "map-first" || current.layoutMode === "map-first";
      const matched = (screenVisible && screen && screenKey !== null && withPreviewPrototypeOverride(
        screen, previewScreenRootPointer(screenKey), request.runtimePointer, replacement
      )) || (panel && panelKey !== null && withPreviewPrototypeOverride(
        panel, previewPanelRootPointer(panelKey), request.runtimePointer, replacement
      ));
      if (!matched) throw new Error("Prototype target is not in the current compiled scene.");
      const next = { runtimePointer: request.runtimePointer, requestId: request.requestId, component: replacement };
      previewPrototypeRef.current = next;
      setPreviewPrototype(next);
    }
    const epoch = ++previewPrototypeEpochRef.current;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (epoch !== previewPrototypeEpochRef.current) throw new Error("A newer preview replaced this prototype.");
  }, [editorPreviewMode, gameUi]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || playerState?.debugPaused !== true) return;
    return pausePreviewDom(root);
  }, [playerState?.debugPaused]);
  const previewSessionSnapshot = useMemo<EditorPreviewSessionSnapshot | undefined>(() => {
    const snapshot = presenterRef.current?.sessionSnapshot;
    if (snapshot === null || snapshot === undefined || snapshot.version === undefined) {
      return undefined;
    }

    return {
      sessionId: snapshot.sessionId,
      gameId: snapshot.gameId,
      version: snapshot.version,
      state: snapshot.state
    };
  }, [playerState]);
  const previewTimeline = (presenterRef.current?.renderSessionSnapshot?.state?.public as
    Record<string, unknown> | undefined)?.timeline as Record<string, unknown> | undefined;
  const previewSceneContext = {
    ...(typeof previewTimeline?.screenId === "string" ? { screenId: previewTimeline.screenId } : {}),
    ...(typeof previewTimeline?.stepIndex === "number" ? { stepIndex: previewTimeline.stepIndex } : {}),
    ...(typeof previewTimeline?.activeInfoId === "string" ? { activeInfoId: previewTimeline.activeInfoId } : {})
  };
  const handleEditorPreviewRestore = useCallback(async (request: {
    readonly sessionId: string;
    readonly state: Record<string, unknown>;
    readonly version: { readonly stateVersion: number; readonly lastEventSequence: number };
    readonly targetEventSequence?: number;
  }) => {
    const activeSessionId = presenterRef.current?.sessionSnapshot?.sessionId;
    if (activeSessionId === undefined || request.sessionId !== activeSessionId) {
      throw new Error("Preview restore request does not match the active player session.");
    }
    return restorePreviewSession(request);
  }, []);
  useEditorPreviewBridge(rootRef, {
    enabled: editorPreviewMode,
    parentOrigin: editorPreviewParentOrigin,
    refreshSignal: `${screenKey ?? ""}:${layoutMode}:${activePanel ?? ""}:${playerState?.sessionId ?? ""}:${playerState?.log?.length ?? 0}:${activePreviewRevision}:${previewPrototype?.requestId ?? ""}`,
    sessionSnapshot: previewSessionSnapshot,
    compileRevision: activePreviewRevision,
    screenKey: screenKey ?? undefined,
    scene: previewSceneContext,
    prototypePreview: previewPrototype === null ? undefined :
      { runtimePointer: previewPrototype.runtimePointer, requestId: previewPrototype.requestId },
    lastCompletedAction: lastCompletedPreviewAction,
    onRestorePreviewSession: handleEditorPreviewRestore,
    onDebugSession: handleEditorDebugSession,
    onRefreshPreviewContent: handlePreviewContentRefresh,
    onShowPreviewScene: handlePreviewScene,
    onShowPreviewPrototype: handlePreviewPrototype
  });

  useEffect(() => {
    if (playerPluginBundles.length === 0) {
      setPlayerPluginState((current) =>
        current.status === "ready" && current.key === playerPluginSignature
          ? current
          : { status: "ready", key: playerPluginSignature }
      );
      return;
    }

    let cancelled = false;
    let loadHandle: PlayerWebPluginLoadHandle | null = null;
    const allowedScopes = new Set<PlayerWebPluginBundleReference["scope"]>(editorPreviewMode ? ["preview"] : ["published"]);
    setPlayerPluginState({ status: "loading", key: playerPluginSignature });
    void activatePlayerWebPluginBundles({ runtimeApiUrl, bundles: playerPluginBundles, allowedScopes })
      .then((handle) => {
        if (cancelled) {
          handle.dispose();
        } else {
          loadHandle = handle;
          setPlayerPluginState({ status: "ready", key: handle.key });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPlayerPluginState({
            status: "error",
            key: playerPluginSignature,
            message: error instanceof Error ? error.message : "Player plugin load failed."
          });
        }
      });

    return () => {
      cancelled = true;
      loadHandle?.dispose();
    };
  }, [editorPreviewMode, playerPluginBundles, playerPluginSignature, runtimeApiUrl]);

  useEffect(() => {
    if (playerPluginState.status !== "ready") {
      return;
    }

    const gateway = new ReactViewGateway();
    const presenter = new GamePresenter({
      gateway,
      content: initialContent,
      gameUi: initialGameUi,
      config: fullConfig,
      contentSourceId,
      editorPreviewMode
    });
    presenterRef.current = presenter;

    if (initialSessionId && typeof window !== "undefined") {
      window.localStorage.setItem(fullConfig.storageKey, initialSessionId);
    }

    const unsubscribe = gateway.subscribe((command: ViewCommand) => {
      switch (command.type) {
        case "SYNC_STATE": {
          const state = command.payload?.state as PlayerState | undefined;
          if (state) {
            setPlayerState(state);
            // WHY: mirror screenKey/layoutMode unconditionally from the
            // authoritative presenter state instead of only assigning on
            // truthy values. `state.screenKey` is `string | null` and
            // becomes null once the game transitions into a state that has
            // no manifest screen (e.g. it moves to an agent-surface or
            // safe-mode state). The previous "only set when truthy" logic
            // never cleared the local screenKey in that case, so the render
            // branch below kept matching the OLD screenKey against
            // `gameUi.screens` and kept showing a stale manifest screen
            // instead of falling through to CubicaSurfaceRenderer /
            // SafeModeRenderer. Mirroring `?? undefined` here makes the
            // local screenKey state track the server-driven truth exactly.
            setScreenKey(state.screenKey ?? undefined);
            setLayoutMode(state.layoutMode);
            if (state.activePanel) {
              setActivePanel(state.activePanel);
            } else {
              setActivePanel(null);
            }
          }
          break;
        }
        case "NAVIGATE": {
          const nextScreenKey = command.payload?.screenKey as string | undefined;
          const nextLayoutMode = command.payload?.layoutMode as PlayerLayoutMode | undefined;
          if (nextScreenKey) {
            setScreenKey(nextScreenKey);
          }
          if (nextLayoutMode) {
            setLayoutMode(nextLayoutMode);
          }
          break;
        }
        case "SHOW_PANEL": {
          const panel = command.payload?.panel as string | undefined;
          if (panel) {
            setActivePanel(panel);
          }
          break;
        }
      }
    });

    void presenter.boot();

    return () => {
      unsubscribe();
      presenter.dispose();
      presenterRef.current = null;
    };
  }, [initialContent, contentSourceId, initialGameUi, fullConfig, initialSessionId, playerPluginState.status]);

  const handleAction = async (actionId: string, payload?: Record<string, unknown>) => {
    if (previewSceneActiveRef.current || previewPrototypeRef.current !== null) return;
    const presenter = presenterRef.current;
    if (!presenter) return;
    const beforeSequence = presenter.sessionSnapshot?.version?.lastEventSequence ?? -1;
    const timestamp = new Date().toISOString();

    const request = {
      source: "user" as const,
      type: actionId,
      payload: payload ?? {},
      timestamp
    };

    await presenter.handleEvent(request);
    const afterSnapshot = presenter.sessionSnapshot;
    if (
      editorPreviewMode &&
      afterSnapshot !== null &&
      afterSnapshot.version !== undefined &&
      afterSnapshot.version.lastEventSequence > beforeSequence
    ) {
      setLastCompletedPreviewAction({
        actionId,
        params: payload ?? {},
        timestamp
      });
    }
  };

  const handleManifestAction = (command: string, payload: Record<string, unknown>) => {
    if (previewSceneActiveRef.current || previewPrototypeRef.current !== null) return;
    const presenter = presenterRef.current;
    if (!presenter) return;

    if (handlePanelCommand(command, payload)) {
      return;
    }

    const adapter = createManifestActionAdapter({
      dispatchAction: (actionId, actionParams) => handleAction(actionId, actionParams),
      onError: (message) => {
        console.error(message);
      }
    });
    adapter(command, payload);
  };

  const handlePanelCommand = (command: string, payload: Record<string, unknown>): boolean => {
    if (command === ManifestAction.SHOW_PANEL) {
      const panelId = payload.panelId ?? payload.panel;
      if (typeof panelId === "string" && panelId.trim() !== "") {
        void handleAction(ManifestAction.SHOW_PANEL, { panelId });
      }
      return true;
    }

    if (command === ManifestAction.CLOSE_PANEL || command === ManifestAction.DISMISS_PANEL) {
      const panelId = payload.panelId ?? payload.panel ?? activePanel;
      void handleAction(ManifestAction.CLOSE_PANEL, typeof panelId === "string" ? { panelId } : {});
      return true;
    }

    return false;
  };

  const handleRetryBoot = () => {
    const presenter = presenterRef.current;
    if (!presenter) return;
    void presenter.boot();
  };

  const handleSessionSetup = (selection: { participantCount: number; agentSeatCount: number; accessMode?: "local" | "private-invite" }) => {
    void presenterRef.current?.createSessionFromSetup(selection);
  };

  const handleRefreshAgentControl = () => {
    void presenterRef.current?.refreshSession();
  };

  const handleSurfaceAction = (action: Parameters<GamePresenter["handleSurfaceAction"]>[0]) => {
    if (previewSceneActiveRef.current || previewPrototypeRef.current !== null) return;
    const presenter = presenterRef.current;
    if (!presenter) return;
    void presenter.handleSurfaceAction(action);
  };

  const handleBoardAction = async (
    actionId: string,
    payload?: Record<string, unknown>
  ): Promise<void> => {
    if (previewSceneActiveRef.current || previewPrototypeRef.current !== null) throw new Error("Authoring preview is read-only.");
    const presenter = presenterRef.current;
    if (!presenter) {
      throw new Error("Игровая сессия еще не готова к действию на поле.");
    }
    await presenter.handleBoardAction(actionId, payload ?? {});
  };

  const handleBoardRoadPreview = (
    actionId: string,
    params: Record<string, unknown>
  ) => {
    if (previewSceneActiveRef.current || previewPrototypeRef.current !== null) return Promise.reject(new Error("Authoring preview is read-only."));
    const presenter = presenterRef.current;
    if (!presenter) {
      return Promise.reject(new Error("Игровая сессия еще не готова к расчёту дороги."));
    }
    return presenter.previewTransportRoad(actionId, params);
  };

  const state = playerState;
  // WHY: shared layouts consume a neutral CSS variable. Only an active game
  // plugin can provide the game-owned asset assigned to it. TSK-20260719 R4b:
  // themeBackgroundImage may itself be an `asset:<id>` marker, resolved
  // through the same fail-closed channel as every other image property
  // (ADR-063) — an ordinary path/URL still passes through unchanged.
  const rootStyle = resolveThemeBackgroundStyle(fullConfig.themeBackgroundImage, gameAssets) as
    | CSSProperties
    | undefined;

  if (playerPluginState.status === "error") {
    return (
      <main ref={rootRef} className="shell game-player-root" style={rootStyle}>
        <div className="error inline-error">{playerPluginState.message}</div>
      </main>
    );
  }

  if (!state || playerPluginState.status === "loading") {
    return (
      <main ref={rootRef} className="shell game-player-root" style={rootStyle}>
        <div className="loading-state">
          <div className="loading-spinner" />
          <span>{t.loading}</span>
        </div>
      </main>
    );
  }

  if (state.sessionSetup) {
    return (
      <main ref={rootRef} className="shell game-player-root" style={rootStyle}>
        <SessionSetupPanel
          setup={state.sessionSetup}
          isPending={state.booting}
          error={state.error}
          onSubmit={handleSessionSetup}
        />
      </main>
    );
  }

  if (state.runtimeStatus !== "ready") {
    return (
      <main ref={rootRef} className="shell game-player-root" style={rootStyle}>
        <RuntimeStatusPanel
          status={state.runtimeStatus}
          reason={state.runtimeStatusReason ?? state.error}
          failurePolicy={state.runtimeFailurePolicy}
          agentRuntimeRequired={state.agentRuntimeRequired}
          onRetry={handleRetryBoot}
        />
      </main>
    );
  }

  const agentControl = state.agentControl;
  if (agentControl.kind === "invalid") {
    return (
      <main ref={rootRef} className="shell game-player-root" style={rootStyle}>
        <SessionParticipants participants={state.participants} />
        <AgentControlPanel invalid onRefresh={handleRefreshAgentControl} />
      </main>
    );
  }
  if (agentControl.kind === "valid" && agentControl.value.status === "paused") {
    return (
      <main ref={rootRef} className="shell game-player-root" style={rootStyle}>
        <SessionParticipants participants={state.participants} />
        <AgentControlPanel control={agentControl.value} onRefresh={handleRefreshAgentControl} />
      </main>
    );
  }

  const metrics = state.metrics;
  const originalPanel = state.activePanel ? gameUi?.panels?.[state.activePanel] : undefined;
  const originalScreen = screenKey ? gameUi?.screens[screenKey] : undefined;
  const activeManifestPanel = originalPanel && state.activePanel && previewPrototype
    ? withPreviewPrototypeOverride(originalPanel, previewPanelRootPointer(state.activePanel),
        previewPrototype.runtimePointer, previewPrototype.component) ?? originalPanel
    : originalPanel;
  const activeManifestScreen = originalScreen && screenKey && previewPrototype
    ? withPreviewPrototypeOverride(originalScreen, previewScreenRootPointer(screenKey),
        previewPrototype.runtimePointer, previewPrototype.component) ?? originalScreen
    : originalScreen;
  const keepsMapBehindPanel = Boolean(
    activeManifestPanel && activeManifestScreen && (
      activeManifestScreen.layoutMode === "map-first" || layoutMode === "map-first"
    )
  );
  const sessionSnapshot = presenterRef.current?.renderSessionSnapshot ?? undefined;
  const blockPrototypeInteraction = previewPrototype === null ? undefined : (event: SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <main ref={rootRef} className="shell game-player-root" style={rootStyle}
      onClickCapture={blockPrototypeInteraction}
      onPointerDownCapture={blockPrototypeInteraction}
      onKeyDownCapture={blockPrototypeInteraction}
      onSubmitCapture={blockPrototypeInteraction}>
      {previewSceneActive ? <div role="status" style={{ position: "absolute", top: 8, right: 8, zIndex: 1000,
        padding: "6px 10px", borderRadius: 6, background: "#17252ddd", color: "#fff", pointerEvents: "none" }}>
        Сцена для редактирования · прохождение на паузе
      </div> : null}
      {state.privateInvites.length > 0 ? <PrivateInvitePanel gameId={content.gameId} sessionId={state.sessionId ?? ""} invites={state.privateInvites} onDismiss={() => presenterRef.current?.dismissPrivateInvites()} /> : null}
      <SessionParticipants participants={state.participants} />
      {agentControl.kind === "valid" && agentControl.value.status === "facilitatorTakeover" ? (
        <AgentControlPanel control={agentControl.value} onRefresh={handleRefreshAgentControl} />
      ) : null}
      <PublicJournalDownload sessionId={state.sessionId} runtimeStatus={state.runtimeStatus} />
      <SessionAiDebriefPanel
        sessionId={state.sessionId}
        runtimeStatus={state.runtimeStatus}
        viewerRole={state.viewerRole}
        profile={content.aiDebrief}
      />
      {activeManifestPanel && !keepsMapBehindPanel ? (
        <ManifestRenderer
          screenDefinition={activeManifestPanel}
          metrics={metrics}
          onAction={handleManifestAction}
          screenKey={state.activePanel ?? undefined}
          rootRuntimePointer={`/panels/${state.activePanel}/root`}
          layoutMode={layoutMode}
          metricBackgroundImages={fullConfig.metricBackgroundImages}
          gameState={state as Record<string, unknown>}
          designArtifacts={gameUi?.designArtifacts}
          editorPreviewMode={editorPreviewMode}
          content={content}
          session={sessionSnapshot}
          onBoardAction={handleBoardAction}
          onBoardRoadPreview={handleBoardRoadPreview}
          assetResolver={gameAssets}
          isPending={state.isPending}
        />
      ) : state.agentSurface ? (
        <CubicaSurfaceRenderer
          surface={state.agentSurface}
          isPending={state.isPending}
          onAction={handleSurfaceAction}
        />
      ) : screenKey && activeManifestScreen ? (
        <>
          <ManifestRenderer
            screenDefinition={activeManifestScreen}
            metrics={metrics}
            onAction={handleManifestAction}
            screenKey={screenKey}
            layoutMode={layoutMode}
            metricBackgroundImages={fullConfig.metricBackgroundImages}
            gameState={state as Record<string, unknown>}
            designArtifacts={gameUi?.designArtifacts}
            editorPreviewMode={editorPreviewMode}
            content={content}
            session={sessionSnapshot}
            onBoardAction={handleBoardAction}
            onBoardRoadPreview={handleBoardRoadPreview}
            assetResolver={gameAssets}
            isPending={state.isPending}
          />
          {keepsMapBehindPanel && activeManifestPanel ? (
            <div className="map-first-manifest-panel-layer" role="presentation">
              <ManifestRenderer
                screenDefinition={activeManifestPanel}
                metrics={metrics}
                onAction={handleManifestAction}
                screenKey={state.activePanel ?? undefined}
                rootRuntimePointer={`/panels/${state.activePanel}/root`}
                layoutMode={layoutMode}
                metricBackgroundImages={fullConfig.metricBackgroundImages}
                gameState={state as Record<string, unknown>}
                designArtifacts={gameUi?.designArtifacts}
                editorPreviewMode={editorPreviewMode}
                content={content}
                session={sessionSnapshot}
                onBoardAction={handleBoardAction}
                onBoardRoadPreview={handleBoardRoadPreview}
                assetResolver={gameAssets}
                isPending={state.isPending}
                embeddedOverlay
              />
            </div>
          ) : null}
        </>
      ) : state.booting || !state.sessionId ? (
        <div className="loading-state">
          <div className="loading-spinner" />
          <span>{t.loading}</span>
        </div>
      ) : (
        <SafeModeRenderer
          content={content}
          gameState={state as Record<string, unknown>}
          metrics={metrics}
          fallbackMetrics={fullConfig.fallbackMetrics}
          gameUi={gameUi}
          layoutMode={layoutMode === "map-first" ? "topbar" : layoutMode}
          screenKey={screenKey}
          dispatchAction={handleAction}
          fallbackScreenBuilder={fullConfig.fallbackScreenBuilder}
          onManifestAction={handleManifestAction}
          isPending={state.isPending}
          sessionId={state.sessionId}
          editorPreviewMode={editorPreviewMode}
          assetResolver={gameAssets}
        />
      )}
      {state.error ? <div className="error inline-error">{state.error}</div> : null}
    </main>
  );
}

function PrivateInvitePanel({ gameId, sessionId, invites, onDismiss }: { gameId: string; sessionId: string; invites: ReadonlyArray<{ credential: string }>; onDismiss: () => void }) {
  const [message, setMessage] = useState<string | null>(null);
  return <aside className="session-invite-panel" aria-labelledby="session-invite-title">
    <div className="session-invite-panel__heading">
      <div>
        <h2 id="session-invite-title">Ссылки для приглашения</h2>
        <p>Каждая ссылка управляет только указанным местом. Передавайте её лично участнику.</p>
      </div>
      <button className="session-invite-panel__close" type="button" onClick={onDismiss}>Закрыть</button>
    </div>
    <div className="session-invite-panel__list">
      {invites.map((invite, index) => {
        const query = new URLSearchParams({ gameId });
        const link = `${window.location.origin}${window.location.pathname}?${query.toString()}${buildPrivateInviteFragment({ sessionId, invite })}`;
        const label = `Скопировать ссылку-приглашение ${index + 1}`;
        return <div className="session-invite-panel__seat" key={invite.credential}>
          <span><strong>Приглашение {index + 1}</strong><small>Личное удостоверение участника</small></span>
          <button type="button" aria-label={label} onClick={() => {
            const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
            if (!clipboard) { setMessage("Не удалось скопировать ссылку"); return; }
            void clipboard.writeText(link).then(() => setMessage("Ссылка скопирована")).catch(() => setMessage("Не удалось скопировать ссылку"));
          }}>Скопировать</button>
        </div>;
      })}
    </div>
    {message ? <p className="session-invite-panel__status" role="status" aria-live="polite">{message}</p> : null}
  </aside>;
}
