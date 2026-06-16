"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PlayerFacingContent,
  PlayerWebPluginBundleReference,
  PlayerFacingMockup,
  GamePlayerUiContent
} from "@cubica/contracts-manifest";
import { ManifestAction } from "@cubica/contracts-manifest";
import { useLocale, LocaleProvider } from "@/lib/locale";
import { ru } from "@/lib/locale/ru";
import type { PlayerState } from "@/presenter/types";
import type { ViewCommand } from "@cubica/sdk-core";
import type { GameConfigData } from "@/presenter/game-config";
import { GamePresenter } from "@/presenter/game-presenter";
import { ReactViewGateway } from "@/presenter/react-view-gateway";
import { buildGameConfig, resolveRegisteredGameConfigData } from "@/presenter/game-config-registry";
import { loadPlayerWebPluginBundles } from "@/plugins/preview-plugin-loader";
import { ManifestRenderer } from "@/components/manifest/manifest-renderer";
import { SafeModeRenderer } from "@/components/safe-mode-renderer";
import { CubicaSurfaceRenderer } from "@/components/surface/cubica-surface-renderer";
import { RuntimeStatusPanel } from "@/components/runtime-status-panel";
import {
  useEditorPreviewBridge,
  type EditorPreviewCompletedAction,
  type EditorPreviewSessionSnapshot
} from "@/components/editor-preview-bridge";

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
  content,
  mockups,
  gameUi,
  config: configData,
  initialSessionId,
  editorPreviewMode = false,
  editorPreviewParentOrigin,
  playerPluginBundles = EMPTY_PLAYER_PLUGIN_BUNDLES,
  contentSourceId
}: GamePlayerProps) {
  const t = useLocale();
  const playerPluginSignature = useMemo(
    () => playerPluginBundles.map((bundle) => `${bundle.scope}:${bundle.pluginId}:${bundle.contentHash}`).join("|"),
    [playerPluginBundles]
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
      ? resolveRegisteredGameConfigData(content, configData)
      : configData,
    [content, configData, playerPluginState.key, playerPluginState.status]
  );
  const fullConfig = useMemo(
    () => buildGameConfig(activeConfigData),
    [activeConfigData, playerPluginState.key, playerPluginState.status]
  );

  const [playerState, setPlayerState] = useState<PlayerState | null>(null);
  const [screenKey, setScreenKey] = useState<string | undefined>(undefined);
  const [layoutMode, setLayoutMode] = useState<"leftsidebar" | "topbar">("topbar");
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [lastCompletedPreviewAction, setLastCompletedPreviewAction] = useState<EditorPreviewCompletedAction | undefined>(
    undefined
  );

  const presenterRef = useRef<GamePresenter | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
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
  useEditorPreviewBridge(rootRef, {
    enabled: editorPreviewMode,
    parentOrigin: editorPreviewParentOrigin,
    refreshSignal: `${screenKey ?? ""}:${layoutMode}:${activePanel ?? ""}:${playerState?.sessionId ?? ""}:${playerState?.log?.length ?? 0}`,
    sessionSnapshot: previewSessionSnapshot,
    lastCompletedAction: lastCompletedPreviewAction
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
    const allowedScopes = new Set<PlayerWebPluginBundleReference["scope"]>(editorPreviewMode ? ["preview"] : ["published"]);
    setPlayerPluginState({ status: "loading", key: playerPluginSignature });
    void loadPlayerWebPluginBundles({ runtimeApiUrl, bundles: playerPluginBundles, allowedScopes })
      .then((key) => {
        if (!cancelled) {
          setPlayerPluginState({ status: "ready", key });
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
    };
  }, [editorPreviewMode, playerPluginBundles, playerPluginSignature, runtimeApiUrl]);

  useEffect(() => {
    if (playerPluginState.status !== "ready") {
      return;
    }

    const gateway = new ReactViewGateway();
    const presenter = new GamePresenter({
      gateway,
      content,
      gameUi,
      config: fullConfig,
      contentSourceId
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
            if (state.screenKey) {
              setScreenKey(state.screenKey);
            }
            if (state.layoutMode) {
              setLayoutMode(state.layoutMode);
            }
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
          const nextLayoutMode = command.payload?.layoutMode as "leftsidebar" | "topbar" | undefined;
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
      presenterRef.current = null;
    };
  }, [content, contentSourceId, gameUi, fullConfig, initialSessionId, playerPluginState.status]);

  const handleAction = async (actionId: string, payload?: Record<string, unknown>) => {
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
        payload: payload ?? {},
        timestamp
      });
    }
  };

  const handleManifestAction = (command: string, payload: Record<string, unknown>) => {
    const presenter = presenterRef.current;
    if (!presenter) return;

    if (handlePanelCommand(command, payload)) {
      return;
    }

    const adapter = presenter.createManifestActionAdapter(
      (actionId, actionPayload) => handleAction(actionId, actionPayload),
      (message) => {
        console.error(message);
      }
    );
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

  const handleDismissPanel = (panel: string) => {
    const presenter = presenterRef.current;
    if (!presenter) return;

    void presenter.handleEvent({
      source: "user" as const,
      type: ManifestAction.DISMISS_PANEL,
      payload: { panel },
      timestamp: new Date().toISOString()
    });
  };

  const handleRetryBoot = () => {
    const presenter = presenterRef.current;
    if (!presenter) return;
    void presenter.boot();
  };

  const handleSurfaceAction = (action: Parameters<GamePresenter["handleSurfaceAction"]>[0]) => {
    const presenter = presenterRef.current;
    if (!presenter) return;
    void presenter.handleSurfaceAction(action);
  };

  const state = playerState;

  if (playerPluginState.status === "error") {
    return (
      <main ref={rootRef} className="shell game-player-root">
        <div className="error inline-error">{playerPluginState.message}</div>
      </main>
    );
  }

  if (!state || playerPluginState.status === "loading") {
    return (
      <main ref={rootRef} className="shell game-player-root">
        <div className="loading-state">
          <div className="loading-spinner" />
          <span>{t.loading}</span>
        </div>
      </main>
    );
  }

  if (state.runtimeStatus !== "ready") {
    return (
      <main ref={rootRef} className="shell game-player-root">
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

  const metrics = state.metrics;
  const activeManifestPanel = state.activePanel ? gameUi?.panels?.[state.activePanel] : undefined;

  return (
    <main ref={rootRef} className="shell game-player-root">
      {activeManifestPanel ? (
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
        />
      ) : state.agentSurface ? (
        <CubicaSurfaceRenderer
          surface={state.agentSurface}
          isPending={state.isPending}
          onAction={handleSurfaceAction}
        />
      ) : screenKey && gameUi?.screens[screenKey] ? (
        <ManifestRenderer
          screenDefinition={gameUi.screens[screenKey]}
          metrics={metrics}
          onAction={handleManifestAction}
          screenKey={screenKey}
          layoutMode={layoutMode}
          metricBackgroundImages={fullConfig.metricBackgroundImages}
          gameState={state as Record<string, unknown>}
          designArtifacts={gameUi?.designArtifacts}
          editorPreviewMode={editorPreviewMode}
        />
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
          layoutMode={layoutMode}
          screenKey={screenKey}
          dispatchAction={handleAction}
          fallbackScreenBuilder={fullConfig.fallbackScreenBuilder}
          onManifestAction={handleManifestAction}
          onJournal={() => handleAction(ManifestAction.SHOW_PANEL, { panelId: "history" })}
          onHint={() => handleAction(ManifestAction.SHOW_PANEL, { panelId: "hint" })}
          isPending={state.isPending}
          sessionId={state.sessionId}
          editorPreviewMode={editorPreviewMode}
        />
      )}
      {state.error ? <div className="error inline-error">{state.error}</div> : null}
    </main>
  );
}
