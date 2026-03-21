"use client";

import { useEffect, useState, useTransition } from "react";
import type { PlayerFacingContent, PlayerFacingMockup } from "@cubica/contracts-manifest";
import type { ActionSnapshot, SessionSnapshot } from "@/lib/antarctica";
import {
  getFallbackActionEntries,
  readCanAdvance,
  readCardFlags,
  readSelectedCardId,
  resolveAntarcticaContent,
  resolveBoardCards,
  resolveCurrentBoard,
  resolveCurrentInfoEntry
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

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      try {
        const storedSessionId = window.localStorage.getItem(storageKey);
        const base = "/api/runtime/sessions";
        const response = storedSessionId
          ? await fetch(`${base}/${storedSessionId}`)
          : await fetch(base, {
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
  const boardCards = resolveBoardCards(antarctica, currentBoard);
  const selectedCardId = readSelectedCardId(session);
  const cardFlags = readCardFlags(session);
  const canAdvance = readCanAdvance(session);
  const fallbackActions = getFallbackActionEntries(content);
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
                <div className="status">
                  <span className="dot" />
                  {booting ? "booting" : session ? "live" : "idle"}
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
                          aria-disabled={isPending || !session ? "true" : "false"}
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
                                  aria-disabled={isPending || !session || isLocked ? "true" : "false"}
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
                            aria-disabled={isPending || !session ? "true" : "false"}
                          >
                            {selectedCard.advanceLabel ?? "Продолжить"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {!currentInfo && !currentBoard ? (
                    <>
                      <div className="section-title" style={{ marginTop: 0 }}>Fallback action catalog</div>
                      <div className="action-grid">
                        {fallbackActions.map((action) => (
                          <button
                            key={action.actionId}
                            className="action-button"
                            type="button"
                            onClick={() => dispatchAction(action.actionId)}
                            aria-disabled={isPending || !session ? "true" : "false"}
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
