"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PlayerFacingContent,
  PlayerFacingMockup,
  GamePlayerUiContent
} from "@cubica/contracts-manifest";
import { ManifestAction } from "@cubica/contracts-manifest";
import { useLocale, LocaleProvider } from "@/lib/locale";
import { ru } from "@/lib/locale/ru";
import type { PlayerState } from "@/presenter/types";
import type { RuntimeLogEntry } from "@/types/game-state";
import type { ViewCommand } from "@cubica/sdk-core";
import type { GameConfigData } from "@/presenter/game-config";
import { GamePresenter } from "@/presenter/game-presenter";
import { ReactViewGateway } from "@/presenter/react-view-gateway";
import { buildGameConfig } from "@/presenter/game-config-registry";
import "@/plugins/register-games";
import { ManifestRenderer } from "@/components/manifest/manifest-renderer";
import { SafeModeRenderer } from "@/components/safe-mode-renderer";
import { HintRenderer } from "@/components/panels/hint-renderer";
import { JournalRenderer } from "@/components/panels/journal-renderer";

export type { PlayerFacingMockup as GameMockup };

export type GamePlayerProps = {
  runtimeApiUrl: string;
  content: PlayerFacingContent;
  mockups: Array<PlayerFacingMockup>;
  gameUi?: GamePlayerUiContent;
  /** Serializable game configuration data (passed from Server Component). */
  config: GameConfigData;
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
export function GamePlayer({ runtimeApiUrl, content, mockups, gameUi, config: configData }: GamePlayerProps) {
  const t = useLocale();
  const fullConfig = useMemo(
    () => buildGameConfig(configData),
    [configData]
  );

  const [playerState, setPlayerState] = useState<PlayerState | null>(null);
  const [screenKey, setScreenKey] = useState<string | undefined>(undefined);
  const [layoutMode, setLayoutMode] = useState<"leftsidebar" | "topbar">("topbar");
  const [activePanel, setActivePanel] = useState<string | null>(null);

  const presenterRef = useRef<GamePresenter | null>(null);

  useEffect(() => {
    const gateway = new ReactViewGateway();
    const presenter = new GamePresenter({
      gateway,
      content,
      gameUi,
      config: fullConfig
    });
    presenterRef.current = presenter;

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
  }, [content, gameUi, fullConfig]);

  const handleAction = (actionId: string, payload?: Record<string, unknown>) => {
    const presenter = presenterRef.current;
    if (!presenter) return;

    const request = {
      source: "user" as const,
      type: actionId,
      payload: payload ?? {},
      timestamp: new Date().toISOString()
    };

    void presenter.handleEvent(request);
  };

  const handleManifestAction = (command: string, payload: Record<string, unknown>) => {
    const presenter = presenterRef.current;
    if (!presenter) return;

    const adapter = presenter.createManifestActionAdapter(
      (actionId, actionPayload) => handleAction(actionId, actionPayload),
      (message) => {
        console.error(message);
      }
    );
    adapter(command, payload);
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

  const state = playerState;

  if (!state) {
    return (
      <main className="shell game-player-root">
        <div className="loading-state">
          <div className="loading-spinner" />
          <span>{t.loading}</span>
        </div>
      </main>
    );
  }

  const metrics = state.metrics;
  const log = state.log;

  return (
    <main className="shell game-player-root">
      {state.activePanel === "history" ? (
        <JournalRenderer
          metrics={metrics}
          log={log as Array<RuntimeLogEntry>}
          onJournal={() => handleDismissPanel("history")}
          onHint={() => handleAction(ManifestAction.SHOW_HINT)}
          onClose={() => handleDismissPanel("history")}
          fallbackMetrics={fullConfig.fallbackMetrics}
          gameState={state as Record<string, unknown>}
          content={content}
        />
      ) : state.activePanel === "hint" ? (
        <HintRenderer
          content={content}
          metrics={metrics}
          log={log as Array<{ actionId: string; payload?: unknown; capability?: string; capabilityFamily?: string; at?: string }>}
          onJournal={() => handleAction(ManifestAction.SHOW_HISTORY)}
          onHint={() => handleDismissPanel("hint")}
          onClose={() => handleDismissPanel("hint")}
          fallbackMetrics={fullConfig.fallbackMetrics}
          defaultHintText={fullConfig.resolveHintText?.(content, state as Record<string, unknown>) ?? null}
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
          dispatchAction={handleAction}
          fallbackScreenBuilder={fullConfig.fallbackScreenBuilder}
          onManifestAction={handleManifestAction}
          onJournal={() => handleAction(ManifestAction.SHOW_HISTORY)}
          onHint={() => handleAction(ManifestAction.SHOW_HINT)}
          isPending={state.isPending}
          sessionId={state.sessionId}
        />
      )}
      {state.error ? <div className="error inline-error">{state.error}</div> : null}
    </main>
  );
}
