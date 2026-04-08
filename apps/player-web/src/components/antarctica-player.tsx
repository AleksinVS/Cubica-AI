"use client";

import { useEffect, useState, useTransition } from "react";
import type {
  PlayerFacingContent,
  PlayerFacingMockup,
  AntarcticaPlayerUiContent,
  AntarcticaPlayerS1UiContent,
  AntarcticaUiComponent,
  AntarcticaUiScreenComponentProps,
  AntarcticaUiAreaComponentProps,
  AntarcticaUiGameVariableComponentProps,
  AntarcticaUiCardComponentProps,
  AntarcticaUiButtonComponentProps,
  AntarcticaUiScreenDefinition
} from "@cubica/contracts-manifest";
import type { ActionSnapshot, SessionSnapshot } from "@/lib/antarctica";
import {
  getFallbackActionEntries,
  readCanAdvance,
  readCardFlags,
  readSelectedCardId,
  readTeamFlags,
  readTeamSelection,
  resolveAntarcticaContent,
  resolveBoardCards,
  resolveCurrentBoard,
  resolveCurrentInfoEntry,
  resolveCurrentTeamSelectionScene
} from "@/lib/antarctica";

export type { PlayerFacingMockup as AntarcticaMockup };

type AntarcticaPlayerProps = {
  runtimeApiUrl: string;
  content: PlayerFacingContent;
  mockups: Array<PlayerFacingMockup>;
  /**
   * Multi-screen UI manifest data for manifest-driven rendering.
   * Supports both the new multi-screen interface (AntarcticaPlayerUiContent)
   * and the deprecated S1-only interface (AntarcticaPlayerS1UiContent).
   * Screen selection is driven by runtime snapshot fields.
   */
  antarcticaUi?: AntarcticaPlayerUiContent;
};

type AntarcticaSession = SessionSnapshot & {
  gameId?: string;
};

type RuntimeLogEntry = {
  actionId: string;
  capability?: string;
  capabilityFamily?: string;
  functionName?: string;
  at?: string;
  payload?: unknown;
};

const storageKey = "cubica-antarctica-session-id";

const readNumber = (value: unknown, fallback: number) => (typeof value === "number" ? value : fallback);

const formatValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return "—";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
};

type RichTextProps = {
  html: string;
  className?: string;
};

function RichText({ html, className }: RichTextProps) {
  const normalized = html.trim();

  if (!normalized) {
    return null;
  }

  if (normalized.includes("<")) {
    return <div className={className} dangerouslySetInnerHTML={{ __html: normalized }} />;
  }

  return <p className={className}>{normalized}</p>;
}

// =============================================================================
// S1 Manifest-Driven Renderer
// Bounded to: screenComponent, areaComponent, gameVariableComponent,
// cardComponent, buttonComponent
// =============================================================================

type MetricsSnapshot = Record<string, unknown>;

/**
 * Resolves a binding expression like "{{game.state.public.metrics.score}}"
 * against the session snapshot.
 */
export function resolveMetricBinding(expression: string, metrics: MetricsSnapshot): string {
  // S1 UI manifest uses "{{game.state.public.metrics.*}}" pattern
  const match = expression.match(/^\{\{game\.state\.public\.metrics\.(\w+)\}\}$/);
  if (!match) {
    return expression;
  }
  const metricId = match[1];
  const value = metrics[metricId];
  return formatValue(value);
}

/**
 * Renders a gameVariableComponent (metric display in the sidebar).
 */
export function GameVariableComponent({
  component,
  metrics,
  backgroundImage
}: {
  component: AntarcticaUiComponent<AntarcticaUiGameVariableComponentProps>;
  metrics: MetricsSnapshot;
  backgroundImage?: string;
}) {
  const { caption, description, value } = component.props;
  const resolvedValue = resolveMetricBinding(value, metrics);

  return (
    <div className="game-variable">
      {backgroundImage && (
        <div className="game-variable-image" style={{ backgroundImage: `url(${backgroundImage})` }} />
      )}
      <div className="game-variable-content">
        <span className="game-variable-caption">{caption}</span>
        <strong className="game-variable-value">{resolvedValue}</strong>
        {description && <p className="game-variable-description">{description}</p>}
      </div>
    </div>
  );
}

/**
 * Renders a cardComponent (interactive card in S1).
 */
export function CardComponent({
  component,
  onAction
}: {
  component: AntarcticaUiComponent<AntarcticaUiCardComponentProps>;
  onAction: (command: string, payload: Record<string, unknown>) => void;
}) {
  const { text } = component.props;
  const command = (component as AntarcticaUiComponent).actions?.onClick?.command;

  return (
    <article className="s1-card">
      <p className="s1-card-text">{text}</p>
      {command && (
        <button
          className="action-button"
          type="button"
          onClick={() => onAction(command, (component as AntarcticaUiComponent).actions?.onClick?.payload ?? {})}
        >
          Выбрать
        </button>
      )}
    </article>
  );
}

/**
 * Renders a buttonComponent (action button in S1).
 */
export function ButtonComponent({
  component,
  onAction
}: {
  component: AntarcticaUiComponent<AntarcticaUiButtonComponentProps>;
  onAction: (command: string, payload: Record<string, unknown>) => void;
}) {
  const { caption } = component.props;
  const command = (component as AntarcticaUiComponent).actions?.onClick?.command;
  const id = (component as AntarcticaUiComponent).id;

  return (
    <button
      id={id}
      className="action-button s1-button"
      type="button"
      onClick={() => command && onAction(command, (component as AntarcticaUiComponent).actions?.onClick?.payload ?? {})}
      disabled={!command}
    >
      {caption}
    </button>
  );
}

/**
 * Recursively renders a UI component tree from the S1 manifest.
 * Supports bounded component types only: screenComponent, areaComponent,
 * gameVariableComponent, cardComponent, buttonComponent.
 */
export function UiComponentNode({
  component,
  metrics,
  onAction
}: {
  component: AntarcticaUiComponent;
  metrics: MetricsSnapshot;
  onAction: (command: string, payload: Record<string, unknown>) => void;
}) {
  const children = component.children ?? [];

  switch (component.type) {
    case "screenComponent": {
      const props = component.props as AntarcticaUiScreenComponentProps;
      return (
        <div
          className={`s1-screen ${props.cssClass ?? ""}`}
          style={props.backgroundImage ? { backgroundImage: `url(${props.backgroundImage})` } : undefined}
        >
          {children.map((child, index) => (
            <UiComponentNode key={index} component={child} metrics={metrics} onAction={onAction} />
          ))}
        </div>
      );
    }

    case "areaComponent": {
      const props = component.props as AntarcticaUiAreaComponentProps;
      return (
        <div className={`s1-area ${props.cssClass ?? ""}`}>
          {children.map((child, index) => (
            <UiComponentNode key={index} component={child} metrics={metrics} onAction={onAction} />
          ))}
        </div>
      );
    }

    case "gameVariableComponent": {
      const props = component.props as AntarcticaUiGameVariableComponentProps;
      return (
        <GameVariableComponent
          component={component as AntarcticaUiComponent<AntarcticaUiGameVariableComponentProps>}
          metrics={metrics}
          backgroundImage={props.backgroundImage}
        />
      );
    }

    case "cardComponent": {
      return (
        <CardComponent
          component={component as AntarcticaUiComponent<AntarcticaUiCardComponentProps>}
          onAction={onAction}
        />
      );
    }

    case "buttonComponent": {
      return (
        <ButtonComponent
          component={component as AntarcticaUiComponent<AntarcticaUiButtonComponentProps>}
          onAction={onAction}
        />
      );
    }

    default:
      // Unknown component type: skip gracefully, do not throw
      return null;
  }
}

/**
 * Bounded manifest-driven S1 renderer.
 * Renders the Antarctica opening screen (S1) from the UI manifest data,
 * binding metric values from the session snapshot and wiring button/card
 * actions to the standard runtime action dispatch path.
 *
 * Layout follows left-sidebar-6-cards mockup:
 * - Left sidebar (260px): game variables/metrics
 * - Main area: cards grid (3x2) + bottom controls
 * - Right decor (370px): arctic illustration placeholder
 */
export function AntarcticaS1Renderer({
  screenDefinition,
  metrics,
  onAction
}: {
  screenDefinition: AntarcticaUiScreenDefinition;
  metrics: MetricsSnapshot;
  onAction: (command: string, payload: Record<string, unknown>) => void;
}) {
  return (
    <div className="s1-renderer">
      {/* Left/center: manifest-driven screen content */}
      <UiComponentNode component={screenDefinition.root} metrics={metrics} onAction={onAction} />
      {/* Right decor: placeholder for arctic illustration (per mockup) */}
      <div className="right-illustration-container">
        <div className="right-illustration-placeholder">
          <p>Антарктическая иллюстрация</p>
          <p style={{ fontSize: "12px", opacity: 0.7 }}>(анимация: айсберги и кит)</p>
        </div>
      </div>
    </div>
  );
}

export function AntarcticaPlayer({ runtimeApiUrl, content, mockups, antarcticaUi }: AntarcticaPlayerProps) {
  const [session, setSession] = useState<AntarcticaSession | null>(null);
  const [booting, setBooting] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /**
   * Creates a new session via POST and stores the sessionId in localStorage.
   * Returns the new session data.
   */
  const createNewSession = async (): Promise<SessionSnapshot> => {
    const base = "/api/runtime/sessions";
    const response = await fetch(base, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        gameId: "antarctica",
        playerId: "player-web"
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.status}`);
    }

    const data = (await response.json()) as SessionSnapshot;
    window.localStorage.setItem(storageKey, data.sessionId);
    return data;
  };

  /**
   * Resets the game: clears localStorage session and creates a new session.
   * Used both for stale session recovery and for the "Новая игра" button.
   */
  const resetGame = async () => {
    setBooting(true);
    setError(null);

    try {
      // Clear any stale session from localStorage
      window.localStorage.removeItem(storageKey);

      // Create fresh session
      const data = await createNewSession();

      setSession(data);
      setError(null);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Failed to reset player");
    } finally {
      setBooting(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      try {
        const storedSessionId = window.localStorage.getItem(storageKey);
        const base = "/api/runtime/sessions";

        let response: Response;

        if (storedSessionId) {
          // Try to resume existing session
          response = await fetch(`${base}/${storedSessionId}`);

          // If session is stale (e.g., runtime restarted), fall back to creating new session
          if (!response.ok) {
            console.warn(`Stale session detected (${storedSessionId}), creating new session`);
            const newSession = await createNewSession();
            if (!cancelled) {
              setSession(newSession);
              setError(null);
            }
            return;
          }
        } else {
          // No stored session, create new one
          response = await fetch(base, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              gameId: "antarctica",
              playerId: "player-web"
            })
          });
        }

        if (!response.ok) {
          throw new Error(`Failed to initialize session: ${response.status}`);
        }

        const data = (await response.json()) as SessionSnapshot;
        if (!storedSessionId) {
          window.localStorage.setItem(storageKey, data.sessionId);
        }

        if (!cancelled) {
          setSession(data);
          setError(null);
        }
      } catch (bootError) {
        if (!cancelled) {
          setError(bootError instanceof Error ? bootError.message : "Failed to initialize player");
        }
      } finally {
        if (!cancelled) {
          setBooting(false);
        }
      }
    };

    void boot();

    return () => {
      cancelled = true;
    };
  }, [content.name]);

  const dispatchAction = (actionId: string, payload?: Record<string, unknown>) => {
    if (!session) {
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          const response = await fetch("/api/runtime/actions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              sessionId: session.sessionId,
              playerId: "player-web",
              actionId,
              payload: payload ?? {}
            })
          });

          if (!response.ok) {
            const errorPayload = (await response.json()) as { error?: string };
            throw new Error(errorPayload.error ?? `Action "${actionId}" failed`);
          }

          const next = (await response.json()) as ActionSnapshot;
          setSession((current) => (current ? { ...current, ...next } : ({ ...next } as AntarcticaSession)));
          setError(null);
        } catch (actionError) {
          setError(actionError instanceof Error ? actionError.message : "Action dispatch failed");
        }
      })();
    });
  };

  /**
   * Maps S1 UI manifest commands to action IDs for dispatch.
   * Commands are mapped to action IDs as defined in the game manifest.
   * When a command has no explicit mapping, dispatch fails gracefully.
   */
  const dispatchS1Action = (command: string, payload: Record<string, unknown>) => {
    // Map UI manifest commands to action IDs from game.manifest.json
    // These commands correspond to runtime.actions.requestServer, showHint, etc.
    const commandToActionId: Record<string, string> = {
      requestServer: "requestServer",
      showHint: "showHint",
      showHistory: "showHistory",
      showScreenWithLeftSideBar: "showScreenWithLeftSideBar"
    };

    const actionId = commandToActionId[command];
    if (actionId) {
      dispatchAction(actionId, payload);
    } else {
      setError(`Unknown S1 command: ${command}`);
    }
  };

  const publicState = session?.state?.public as Record<string, unknown> | undefined;
  const metrics = (publicState?.metrics as Record<string, unknown> | undefined) ?? {};
  const timeline = (publicState?.timeline as Record<string, unknown> | undefined) ?? {};
  const log = Array.isArray(publicState?.log) ? (publicState?.log as Array<RuntimeLogEntry>) : [];

  // Read the current screen ID from timeline (supports both snake_case and camelCase)
  const currentScreenId = (typeof timeline.screenId === "string"
    ? timeline.screenId
    : typeof timeline.screen_id === "string"
      ? timeline.screen_id
      : null) as string | null;

  // Read stepIndex for board-to-manifest-key resolution
  const currentStepIndex = (typeof timeline.stepIndex === "number"
    ? timeline.stepIndex
    : typeof timeline.step_index === "number"
      ? timeline.step_index
      : null) as number | null;

  // Read activeInfoId for variant info screen disambiguation (i19 vs i19_1)
  const activeInfoId = (typeof timeline.activeInfoId === "string"
    ? timeline.activeInfoId
    : typeof timeline.active_info_id === "string"
      ? timeline.active_info_id
      : null) as string | null;

  /**
   * Resolves the manifest screen key for S2 board screens.
   * S2 boards are keyed by their card range in the manifest (e.g., "55..60", "61..66", "67..70").
   * stepIndex 30 → "55..60", stepIndex 32 → "61..66", stepIndex 34 → "67..70".
   */
  const resolveBoardScreenKey = (stepIndex: number | null): string | null => {
    if (stepIndex === null) return null;
    if (stepIndex === 30) return "55..60";
    if (stepIndex === 32) return "61..66";
    if (stepIndex === 34) return "67..70";
    return null;
  };

  /**
   * Resolves the manifest screen key for the current timeline state.
   *
   * Screen selection contract (from CONTRACT_INDEX.md):
   * - For S2 (board) screens: use stepIndex to derive the board key
   * - For S1 (info) screens: use activeInfoId to select variant (e.g., i19 vs i19_1)
   * - When screenId is provided but not found in screens, return null to trigger fallback
   * - entryPoint is used only when no screenId is available (initial state)
   */
  const resolveScreenKey = (
    screenId: string | null,
    stepIndex: number | null,
    infoId: string | null
  ): string | null => {
    if (screenId === "S2") {
      // Board screens: derive manifest screen key from stepIndex
      const boardKey = resolveBoardScreenKey(stepIndex);
      if (boardKey && antarcticaUi?.screens[boardKey]) {
        return boardKey;
      }
      // Board screen not in manifest — return null to trigger fallback
      return null;
    } else if (screenId === "S1") {
      // Info screens: use activeInfoId for variant disambiguation (i19 vs i19_1)
      if (infoId && antarcticaUi?.screens[infoId]) {
        return infoId;
      }
      // activeInfoId not in manifest screens — use S1 directly if available
      if (antarcticaUi?.screens["S1"]) {
        return "S1";
      }
      // S1 not in manifest — return null to trigger fallback
      return null;
    }

    // For other screenId values, check if it exists directly in screens
    if (screenId && antarcticaUi?.screens[screenId]) {
      return screenId;
    }

    // No valid screen found — return null to trigger fallback
    return null;
  };

  const screenKey = antarcticaUi ? resolveScreenKey(currentScreenId, currentStepIndex, activeInfoId) : null;
  const screenDefinition = screenKey ? antarcticaUi?.screens[screenKey] : null;

  const antarctica = resolveAntarcticaContent(content);
  const currentInfo = resolveCurrentInfoEntry(antarctica, publicState as Record<string, unknown>);
  const currentBoard = resolveCurrentBoard(antarctica, publicState as Record<string, unknown>);
  const currentTeamSelection = resolveCurrentTeamSelectionScene(antarctica, publicState as Record<string, unknown>);
  const selectedCardId = readSelectedCardId(session);
  const cardFlags = readCardFlags(session);
  const boardCards = resolveBoardCards(antarctica, currentBoard, cardFlags);
  const teamFlags = readTeamFlags(session);
  const teamSelectionState = readTeamSelection(session);
  const canAdvance = readCanAdvance(session);
  const fallbackActions = getFallbackActionEntries(content);
  const selectedMemberIds = teamSelectionState.selectedMemberIds ?? [];
  const pickCount = teamSelectionState.pickCount ?? 0;
  const selectedTeamMemberIds =
    selectedMemberIds.length > 0 ? selectedMemberIds : Object.keys(teamFlags).filter((memberId) => teamFlags[memberId]?.selected);
  const selectedCard =
    selectedCardId && boardCards.length > 0
      ? boardCards.find((card) => card.cardId === selectedCardId) ?? null
      : null;

  return (
    <main className="shell">
      <div className="frame">
        <section className="hero">
          <div className="eyebrow">Cubica Player Web</div>
          <h1 className="title">{content.name}</h1>
          <p className="subtitle">{content.description}</p>
        </section>

        <section className="grid">
          {screenDefinition ? (
            /* Manifest-driven rendering for in-scope tail screens (S1 info variants and S2 boards) */
            <AntarcticaS1Renderer
              screenDefinition={screenDefinition}
              metrics={metrics}
              onAction={dispatchS1Action}
            />
          ) : (
            <>
              <div className="panel">
                <div className="panel-inner">
                  <div className="session-header">
                    <div>
                      <div className="eyebrow">Session</div>
                      <h2 style={{ margin: "8px 0 0", fontSize: "1.4rem" }}>
                        {session ? session.sessionId : "Preparing Antarctica session"}
                      </h2>
                    </div>
                    <div className="session-controls">
                      <div className="status">
                        <span className="dot" />
                        {booting ? "booting" : session ? "live" : "idle"}
                      </div>
                      <button
                        className="action-button secondary"
                        type="button"
                        onClick={resetGame}
                        disabled={isPending || booting || !session}
                        style={{ marginLeft: 12 }}
                      >
                        Новая игра
                      </button>
                    </div>
                  </div>

                  <div className="metrics">
                    <div className="metric">
                      <label>score</label>
                      <strong>{readNumber(metrics.score, 60)}</strong>
                    </div>
                    <div className="metric">
                      <label>time</label>
                      <strong>{readNumber(metrics.time, 0)}</strong>
                    </div>
                    <div className="metric">
                      <label>stage</label>
                      <strong>{formatValue(timeline.stageId ?? timeline.stage_id)}</strong>
                    </div>
                    <div className="metric">
                      <label>screen</label>
                      <strong>{formatValue(timeline.screenId ?? timeline.screen_id)}</strong>
                    </div>
                  </div>

                  <div className="content-grid">
                    <section className="actions">
                      <div className="section-title">Current scene</div>

                      {currentInfo ? (
                        <div className="scene-card">
                          <h3 className="scene-title">{currentInfo.title}</h3>
                          <RichText className="scene-body" html={currentInfo.body} />
                          <div className="status-row" style={{ marginTop: 16 }}>
                            <span className="chip">info: {currentInfo.id}</span>
                            <span className="chip">step: {currentInfo.stepIndex}</span>
                          </div>
                          <div className="action-grid" style={{ marginTop: 14 }}>
                            <button
                              className="action-button"
                              type="button"
                              onClick={() => dispatchAction(currentInfo.advanceActionId)}
                              disabled={isPending || !session}
                            >
                              {currentInfo.advanceLabel ?? "Продолжить"}
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {!currentInfo && currentBoard ? (
                        <div className="scene-card">
                          <h3 className="scene-title">{currentBoard.title}</h3>
                          <RichText className="scene-body" html={currentBoard.body ?? ""} />
                          <div className="status-row" style={{ marginTop: 16 }}>
                            <span className="chip">board: {currentBoard.id}</span>
                            <span className="chip">step: {currentBoard.stepIndex}</span>
                            {selectedCardId ? <span className="chip">selected: {selectedCardId}</span> : null}
                          </div>

                          <div className="board-card-list">
                            {boardCards.map((card) => {
                              const flags = cardFlags[card.cardId] ?? {};
                              const isLocked = flags.locked === true;
                              const isSelected = flags.selected === true || selectedCardId === card.cardId;
                              const isResolved = flags.resolved === true;

                              return (
                                <article
                                  key={card.cardId}
                                  className={`board-card${isSelected ? " board-card-selected" : ""}${isLocked ? " board-card-locked" : ""}`}
                                >
                                  <div className="board-card-header">
                                    <strong>{card.title}</strong>
                                    <span className="chip">#{card.cardId}</span>
                                  </div>
                                  <p className="board-card-summary">{card.summary}</p>
                                  <div className="status-row">
                                    {isSelected ? <span className="chip">selected</span> : null}
                                    {isResolved ? <span className="chip">resolved</span> : null}
                                    {isLocked ? <span className="chip">locked</span> : null}
                                  </div>
                                  <div className="action-grid">
                                    <button
                                      className="action-button"
                                      type="button"
                                      onClick={() => dispatchAction(card.selectActionId)}
                                      disabled={isPending || !session || isLocked || isSelected}
                                    >
                                      {card.selectLabel ?? "Выбрать"}
                                    </button>
                                  </div>
                                </article>
                              );
                            })}
                          </div>

                          {selectedCard && selectedCard.advanceActionId && canAdvance ? (
                            <div className="action-grid" style={{ marginTop: 16 }}>
                              <button
                                className="action-button"
                                type="button"
                                onClick={() => dispatchAction(selectedCard.advanceActionId!)}
                                disabled={isPending || !session}
                              >
                                {selectedCard.advanceLabel ?? "Продолжить"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {!currentInfo && !currentBoard && currentTeamSelection ? (
                        <div className="scene-card">
                          <h3 className="scene-title">{currentTeamSelection.title}</h3>
                          <RichText className="scene-body" html={currentTeamSelection.body} />
                          <div className="status-row" style={{ marginTop: 16 }}>
                            <span className="chip">team-selection: {currentTeamSelection.id}</span>
                            <span className="chip">step: {currentTeamSelection.stepIndex}</span>
                            <span className="chip">
                              picked: {pickCount}/{currentTeamSelection.requiredPickCount}
                            </span>
                          </div>

                          {selectedTeamMemberIds.length > 0 ? (
                            <div className="status-row" style={{ marginTop: 10 }}>
                              {selectedTeamMemberIds.map((memberId) => (
                                <span key={memberId} className="chip">
                                  selected: {memberId}
                                </span>
                              ))}
                            </div>
                          ) : null}

                          <div className="team-member-list">
                            {currentTeamSelection.members.map((member) => {
                              const flags = teamFlags[member.memberId] ?? {};
                              const isSelected = flags.selected === true || selectedMemberIds.includes(member.memberId);
                              const isPickLimitReached = pickCount >= currentTeamSelection.requiredPickCount;

                              return (
                                <article
                                  key={member.memberId}
                                  className={`team-member-card${isSelected ? " team-member-card-selected" : ""}`}
                                >
                                  <div className="team-member-header">
                                    <strong>{member.name}</strong>
                                    <span className="chip">#{member.memberId}</span>
                                  </div>
                                  <p className="board-card-summary">{member.summary}</p>
                                  <div className="status-row">
                                    {isSelected ? <span className="chip">selected</span> : null}
                                    {isPickLimitReached && !isSelected ? <span className="chip">limit reached</span> : null}
                                  </div>
                                  <div className="action-grid">
                                    <button
                                      className="action-button"
                                      type="button"
                                      onClick={() => dispatchAction(member.selectActionId)}
                                      disabled={isPending || !session || isSelected || isPickLimitReached}
                                    >
                                      {member.selectLabel ?? "Выбрать"}
                                    </button>
                                  </div>
                                </article>
                              );
                            })}
                          </div>

                          <div className="action-grid" style={{ marginTop: 16 }}>
                            <button
                              className="action-button"
                              type="button"
                              onClick={() => dispatchAction(currentTeamSelection.confirmActionId)}
                              disabled={isPending || !session || pickCount !== currentTeamSelection.requiredPickCount}
                            >
                              {currentTeamSelection.confirmLabel ?? "Подтвердить"}
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {!currentInfo && !currentBoard && !currentTeamSelection ? (
                        <>
                          <div className="section-title" style={{ marginTop: 0 }}>Fallback action catalog</div>
                          <div className="action-grid">
                            {fallbackActions.map((action) => (
                              <button
                                key={action.actionId}
                                className="action-button"
                                type="button"
                                onClick={() => dispatchAction(action.actionId)}
                                disabled={isPending || !session}
                              >
                                {action.displayName}
                              </button>
                            ))}
                          </div>
                        </>
                      ) : null}

                      <div className="status-row" style={{ marginTop: 14 }}>
                        <span className="chip">runtime: {runtimeApiUrl}</span>
                        <span className="chip">players: {content.playerConfig.min}-{content.playerConfig.max}</span>
                        <span className="chip">locale: {content.locale}</span>
                      </div>
                      {error ? <div className="error">{error}</div> : null}
                    </section>

                    <section className="journal">
                      <div className="section-title">Journal</div>
                      <ul className="journal-list">
                        {log.length === 0 ? (
                          <li className="journal-item">
                            Session will surface actions here.
                            <small>No runtime log entries yet.</small>
                          </li>
                        ) : (
                          log.map((entry, index) => (
                            <li key={`${entry.actionId}-${index}`} className="journal-item">
                              <strong>{entry.actionId}</strong>
                              <small>
                                {entry.capabilityFamily ?? "unknown"} / {entry.capability ?? "unknown"}
                              </small>
                              <small>{entry.at ?? "no timestamp"}</small>
                            </li>
                          ))
                        )}
                      </ul>
                    </section>
                  </div>
                </div>
              </div>

              <aside className="panel">
                <div className="panel-inner">
                  <div className="section-title">Antarctica mockups</div>
                  <div className="mockup-list">
                    {mockups.map((mockup) => (
                      <article key={mockup.id} className="mockup-card">
                        <strong>{mockup.name}</strong>
                        <p>{mockup.description}</p>
                        <p
                          style={{
                            marginTop: 10,
                            color: "var(--accent)",
                            fontFamily: "var(--font-ibm-plex-mono), monospace",
                            fontSize: 12
                          }}
                        >
                          {mockup.type} · {mockup.imagePath || "no image path"}
                        </p>
                      </article>
                    ))}
                  </div>
                </div>
              </aside>
            </>
          )}
        </section>

      </div>
    </main>
  );
}
