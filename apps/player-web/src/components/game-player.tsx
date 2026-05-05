"use client";

import { useEffect, useRef, useState } from "react";
import type {
  PlayerFacingContent,
  PlayerFacingMockup,
  GamePlayerUiContent
} from "@cubica/contracts-manifest";
import type { PlayerState } from "@/presenter/types";
import type { ViewCommand } from "@cubica/sdk-core";
import { GamePresenter } from "@/presenter/game-presenter";
import { ReactViewGateway } from "@/presenter/react-view-gateway";
import type { AntarcticaGameState } from "@/presenter/game-config";
import { ManifestRenderer } from "@/components/manifest/manifest-renderer";
import { FallbackRenderer } from "@/components/fallback-renderer";
import { HintRenderer } from "@/components/panels/hint-renderer";
import { JournalRenderer } from "@/components/panels/journal-renderer";

export type { PlayerFacingMockup as GameMockup };

export type GamePlayerProps = {
  runtimeApiUrl: string;
  content: PlayerFacingContent;
  mockups: Array<PlayerFacingMockup>;
  gameUi?: GamePlayerUiContent;
  config: any;
};

/**
 * Корневой компонент игрока Антарктиды.
 *
 * Создаёт Presenter и ViewGateway, подписывается на команды от Presenter
 * и обновляет React-состояние. Вся бизнес-логика (boot, dispatch, routing)
 * делегирована Presenter.
 */
export function GamePlayer({ runtimeApiUrl, content, mockups, gameUi, config }: GamePlayerProps) {
  const [playerState, setPlayerState] = useState<PlayerState<AntarcticaGameState> | null>(null);
  const [screenKey, setScreenKey] = useState<string | undefined>(undefined);
  const [layoutMode, setLayoutMode] = useState<"leftsidebar" | "topbar">("topbar");
  const [activePanel, setActivePanel] = useState<string | null>(null);

  const presenterRef = useRef<GamePresenter<AntarcticaGameState, GamePlayerUiContent> | null>(null);

  useEffect(() => {
    const gateway = new ReactViewGateway();
    const presenter = new GamePresenter<AntarcticaGameState, GamePlayerUiContent>({
      gateway,
      content,
      gameUi,
      config
    });
    presenterRef.current = presenter;

    const unsubscribe = gateway.subscribe((command: ViewCommand) => {
      switch (command.type) {
        case "SYNC_STATE": {
          const state = command.payload?.state as PlayerState<AntarcticaGameState> | undefined;
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
  }, [content, gameUi]);

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
      type: "dismiss_panel",
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
          <span>Загрузка...</span>
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
          log={log as Array<{ actionId: string; payload?: unknown; capability?: string; capabilityFamily?: string; at?: string }>}
          onJournal={() => handleDismissPanel("history")}
          onHint={() => handleAction("showHint")}
          onClose={() => handleDismissPanel("history")}
          fallbackMetrics={config.fallbackMetrics}
        />
      ) : state.activePanel === "hint" ? (
        <HintRenderer
          content={content}
          metrics={metrics}
          log={log as Array<{ actionId: string; payload?: unknown; capability?: string; capabilityFamily?: string; at?: string }>}
          onJournal={() => handleAction("showHistory")}
          onHint={() => handleDismissPanel("hint")}
          onClose={() => handleDismissPanel("hint")}
          fallbackMetrics={config.fallbackMetrics}
        />
      ) : screenKey && gameUi?.screens[screenKey] ? (
        <ManifestRenderer
          screenDefinition={gameUi.screens[screenKey]}
          metrics={metrics}
          onAction={handleManifestAction}
          screenKey={screenKey}
          layoutMode={layoutMode}
          metricBackgroundImages={config.metricBackgroundImages}
        />
      ) : state.booting || !state.sessionId ? (
        <div className="loading-state">
          <div className="loading-spinner" />
          <span>Загрузка...</span>
        </div>
      ) : (
        <FallbackRenderer
          content={content}
          runtimeApiUrl={runtimeApiUrl}
          sessionId={state.sessionId}
          isPending={state.isPending}
          metrics={metrics}
          currentInfo={state.currentInfo}
          currentBoard={state.currentBoard}
          currentTeamSelection={state.currentTeamSelection}
          cardFlags={state.cardFlags}
          selectedCardId={state.selectedCardId}
          selectedCard={state.selectedCard}
          boardCards={state.boardCards}
          teamFlags={state.teamFlags}
          selectedMemberIds={state.selectedMemberIds}
          pickCount={state.pickCount}
          canAdvance={state.canAdvance}
          fallbackActions={state.fallbackActions}
          dispatchAction={handleAction}
          layoutMode={layoutMode}
          onJournal={() => handleAction("showHistory")}
          onHint={() => handleAction("showHint")}
          fallbackMetrics={config.fallbackMetrics}
        />
      )}
      {state.error ? <div className="error inline-error">{state.error}</div> : null}
    </main>
  );
}
