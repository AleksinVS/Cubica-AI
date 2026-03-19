"use client";

import { useEffect, useState, useTransition } from "react";
import type { AntarcticaMockup, ActionSnapshot, SessionSnapshot } from "@/lib/antarctica";

type AntarcticaAction = {
  actionId: string;
  displayName: string;
  capabilityFamily: string;
  capability: string | null;
};

type AntarcticaPlayerProps = {
  runtimeApiUrl: string;
  manifest: {
    meta: {
      name: string;
      description: string;
      version: string;
    };
    config: {
      players: {
        min: number;
        max: number;
      };
      settings: {
        mode: string;
        locale: string;
      };
    };
    state: {
      public: Record<string, unknown>;
    };
  };
  actions: Array<AntarcticaAction>;
  mockups: Array<AntarcticaMockup>;
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

export function AntarcticaPlayer({ runtimeApiUrl, manifest, actions, mockups }: AntarcticaPlayerProps) {
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
  }, [manifest.meta.name]);

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

  return (
    <main className="shell">
      <div className="frame">
        <section className="hero">
          <div className="eyebrow">Cubica Player Web</div>
          <h1 className="title">{manifest.meta.name}</h1>
          <p className="subtitle">{manifest.meta.description}</p>
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
                  <strong>{readNumber((metrics as Record<string, unknown>).score, 60)}</strong>
                </div>
                <div className="metric">
                  <label>time</label>
                  <strong>{readNumber((metrics as Record<string, unknown>).time, 0)}</strong>
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
                  <div className="section-title">Action controls</div>
                  <div className="action-grid">
                    {actions.map((action) => (
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
                  <div className="status-row" style={{ marginTop: 14 }}>
                    <span className="chip">runtime: {runtimeApiUrl}</span>
                    <span className="chip">players: {manifest.config.players.min}-{manifest.config.players.max}</span>
                    <span className="chip">mode: {manifest.config.settings.mode}</span>
                    <span className="chip">locale: {manifest.config.settings.locale}</span>
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
                    <p style={{ marginTop: 10, color: "var(--accent)", fontFamily: "var(--font-ibm-plex-mono), monospace", fontSize: 12 }}>
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
