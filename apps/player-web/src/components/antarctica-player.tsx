"use client";

import { useEffect, useState, useTransition } from "react";
import type { PlayerFacingContent, PlayerFacingMockup } from "@cubica/contracts-manifest";
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

export function AntarcticaPlayer({ runtimeApiUrl, content, mockups }: AntarcticaPlayerProps) {
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

  const dispatchAction = (actionId: string) => {
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
              actionId
            })
          });

          if (!response.ok) {
            const payload = (await response.json()) as { error?: string };
            throw new Error(payload.error ?? `Action "${actionId}" failed`);
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

  const publicState = session?.state?.public as Record<string, unknown> | undefined;
  const metrics = (publicState?.metrics as Record<string, unknown> | undefined) ?? {};
  const timeline = (publicState?.timeline as Record<string, unknown> | undefined) ?? {};
  const log = Array.isArray(publicState?.log) ? (publicState?.log as Array<RuntimeLogEntry>) : [];

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
        </section>
      </div>
    </main>
  );
}
