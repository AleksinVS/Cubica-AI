"use client";

/**
 * Generic host for a manifest-declared interactive Phaser board.
 *
 * The canvas is a spatial view, never a source of gameplay truth. The game
 * plugin receives the latest player-facing snapshot and sends user intent
 * through `dispatchAction`; runtime rejection remains visible to both the scene
 * (as a rejected Promise) and the ordinary player-web error UI. A parallel DOM
 * action list makes the same projected actions usable without precise dragging.
 */

import { useEffect, useRef, useState } from "react";
import type {
  GameUiInteractiveBoardSurfaceProps,
  PlayerFacingContent
} from "@cubica/contracts-manifest";

import type { GameSession } from "@/types/game-state";
import type { GameAssetResolver } from "@/lib/game-asset-resolver";
import {
  resolvePhaserSceneFactory,
  type AccessibleBoardAction,
  type InteractiveBoardSceneHandle
} from "@/plugins/phaser-scene-registry";

import styles from "./interactive-board-surface.module.css";

export function InteractiveBoardSurface({
  gameId,
  content,
  session,
  assets,
  manifestProps,
  dispatchAction,
  isPending = false
}: {
  readonly gameId: string;
  readonly content: PlayerFacingContent;
  readonly session: GameSession;
  readonly assets: GameAssetResolver;
  readonly manifestProps: GameUiInteractiveBoardSurfaceProps;
  readonly dispatchAction: (
    actionId: string,
    params?: Record<string, unknown>
  ) => Promise<void>;
  readonly isPending?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<InteractiveBoardSceneHandle | null>(null);
  const sessionRef = useRef(session);
  const dispatchRef = useRef(dispatchAction);
  const isPendingRef = useRef(isPending);
  const [accessibleActions, setAccessibleActions] = useState<readonly AccessibleBoardAction[]>([]);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);

  sessionRef.current = session;
  dispatchRef.current = dispatchAction;
  isPendingRef.current = isPending;

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) {
      return;
    }

    try {
      handle.updateSession(session);
      setAccessibleActions(handle.getAccessibleActions?.(session) ?? []);
    } catch (error) {
      setDiagnostic(errorMessage(error, "Не удалось обновить интерактивное поле."));
    }
  }, [isPending, session]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const factory = resolvePhaserSceneFactory(gameId);
    if (!factory) {
      setDiagnostic("Игра не предоставила сцену для интерактивного поля.");
      return;
    }

    let cancelled = false;
    let game: import("phaser").Game | null = null;
    let handle: InteractiveBoardSceneHandle | null = null;
    let resizeObserver: ResizeObserver | null = null;

    void import("phaser")
      .then((loadedModule) => {
        if (cancelled) {
          return;
        }

        // The browser receives the typed ESM namespace. Keeping this assignment
        // explicit also makes it obvious that Phaser has one platform-owned
        // import site rather than a plugin-local fallback import.
        const Phaser: typeof import("phaser") = loadedModule;
        const initialSession = sessionRef.current;
        handle = factory({
          Phaser,
          sceneId: manifestProps.sceneId,
          content,
          session: initialSession,
          assets,
          isInteractionPending: () => isPendingRef.current,
          dispatchAction: (actionId, params) => {
            if (isPendingRef.current) {
              return Promise.reject(new Error("Дождитесь завершения предыдущего действия."));
            }
            return dispatchRef.current(actionId, params);
          }
        });

        if (!(handle.scene instanceof Phaser.Scene)) {
          throw new Error("Фабрика поля вернула несовместимую сцену Phaser.");
        }

        game = new Phaser.Game({
          type: Phaser.AUTO,
          parent: container,
          width: boundedDimension(manifestProps.designWidth, 1400),
          height: boundedDimension(manifestProps.designHeight, 1000),
          backgroundColor: "#00000000",
          render: { antialias: true },
          scale: {
            mode: Phaser.Scale.FIT,
            autoCenter: Phaser.Scale.CENTER_BOTH,
            width: boundedDimension(manifestProps.designWidth, 1400),
            height: boundedDimension(manifestProps.designHeight, 1000)
          },
          scene: handle.scene
        });

        if (cancelled) {
          destroySurface(handle, game);
          handle = null;
          game = null;
          return;
        }

        handleRef.current = handle;
        handle.updateSession(initialSession);
        setAccessibleActions(handle.getAccessibleActions?.(initialSession) ?? []);
        setDiagnostic(null);

        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(() => game?.scale.refresh());
          resizeObserver.observe(container);
        }
      })
      .catch((error: unknown) => {
        // A factory can fail after allocating listeners but before Phaser.Game
        // exists. Release that partial handle immediately instead of waiting for
        // React to unmount a diagnostic surface.
        if (handleRef.current === handle) {
          handleRef.current = null;
        }
        destroySurface(handle, game);
        handle = null;
        game = null;
        if (!cancelled) {
          setDiagnostic(errorMessage(error, "Не удалось запустить интерактивное поле."));
        }
      });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (handleRef.current === handle) {
        handleRef.current = null;
      }
      destroySurface(handle, game);
    };
  }, [assets, content, gameId, manifestProps.designHeight, manifestProps.designWidth, manifestProps.sceneId]);

  const label = manifestProps.accessibleLabel ?? "Интерактивное игровое поле";

  const runAccessibleAction = async (action: AccessibleBoardAction) => {
    if (isPending || pendingActionId !== null || action.disabled === true) return;
    setPendingActionId(action.id);
    setDiagnostic(null);
    try {
      await dispatchAction(action.actionId, { ...action.params });
    } catch (error) {
      // The scene receives the same rejection through its injected dispatcher.
      // This local message keeps keyboard users in the context of their action.
      setDiagnostic(errorMessage(error, "Действие на поле отклонено."));
    } finally {
      setPendingActionId(null);
    }
  };

  return (
    <section className={styles.surface} aria-label={label}>
      <div
        ref={containerRef}
        className={styles.canvasHost}
        aria-hidden="true"
        data-testid="interactive-board-canvas-host"
      />

      <div className={styles.accessibleControls}>
        <h2 className={styles.controlsTitle}>Действия на поле</h2>
        {accessibleActions.length > 0 ? (
          <ul className={styles.actionList}>
            {accessibleActions.map((action, index) => {
              const descriptionId = `${manifestProps.sceneId}-board-action-${index}-description`;
              return (
                <li key={action.id}>
                  <button
                    type="button"
                    className={styles.actionButton}
                    disabled={action.disabled === true || isPending || pendingActionId !== null}
                    aria-describedby={action.description ? descriptionId : undefined}
                    onClick={() => void runAccessibleAction(action)}
                  >
                    {pendingActionId === action.id ? "Выполняется…" : action.label}
                  </button>
                  {action.description ? (
                    <span id={descriptionId} className={styles.actionDescription}>
                      {action.description}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.emptyActions}>Сейчас нет доступных действий на поле.</p>
        )}
      </div>

      {diagnostic ? <p className={styles.diagnostic} role="alert">{diagnostic}</p> : null}
    </section>
  );
}

function boundedDimension(value: number | undefined, fallback: number): number {
  if (!Number.isInteger(value) || value === undefined) {
    return fallback;
  }
  return Math.min(1920, Math.max(320, value));
}

function destroySurface(
  handle: InteractiveBoardSceneHandle | null,
  game: import("phaser").Game | null
): void {
  // Plugin listeners must stop before Phaser starts destroying the scene and
  // its texture/input managers. Both calls are intentionally idempotent at the
  // host boundary because React Strict Mode mounts effects twice in development.
  try {
    handle?.destroy();
  } finally {
    game?.destroy(true);
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== "" ? error.message : fallback;
}
