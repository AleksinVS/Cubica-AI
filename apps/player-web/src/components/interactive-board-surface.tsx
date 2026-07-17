"use client";

/**
 * Generic host for a manifest-declared interactive Phaser board.
 *
 * The canvas is a spatial view, never a source of gameplay truth. The game
 * plugin receives the latest player-facing snapshot and sends user intent
 * through `dispatchAction`; runtime rejection remains visible to both the scene
 * (as a rejected Promise) and the ordinary player-web error UI. A separately
 * registered pure provider projects the same server-authorized actions into DOM
 * controls, so keyboard access survives slow or failed Phaser initialization.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GameUiInteractiveBoardSurfaceProps,
  PlayerFacingContent
} from "@cubica/contracts-manifest";
import type { TransportRoadPreviewResponse } from "@cubica/contracts-session";

import type { GameSession } from "@/types/game-state";
import type { GameAssetResolver } from "@/lib/game-asset-resolver";
import {
  resolveAccessibleBoardActionsProvider,
  resolvePhaserSceneFactory,
  type AccessibleBoardAction,
  type AccessibleBoardActionField,
  type InteractiveBoardActionDraft,
  type InteractiveBoardActionDraftValue,
  type InteractiveBoardSceneHandle
} from "@/plugins/phaser-scene-registry";

import styles from "./interactive-board-surface.module.css";
import type { PlayerLayoutMode } from "@/lib/player-layout-mode";

export function InteractiveBoardSurface({
  gameId,
  content,
  session,
  assets,
  manifestProps,
  dispatchAction,
  previewTransportRoad,
  isPending = false,
  layoutMode = "topbar"
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
  /** Read-only server calculation used only by declared transport actions. */
  readonly previewTransportRoad?: (
    actionId: string,
    params: Record<string, unknown>
  ) => Promise<TransportRoadPreviewResponse>;
  readonly isPending?: boolean;
  readonly layoutMode?: PlayerLayoutMode;
}) {
  const surfaceRef = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<InteractiveBoardSceneHandle | null>(null);
  const sessionRef = useRef(session);
  const dispatchRef = useRef(dispatchAction);
  const previewTransportRoadRef = useRef(previewTransportRoad);
  const isPendingRef = useRef(isPending);
  const actionDraftRef = useRef<InteractiveBoardActionDraft | null>(null);
  const roadPreviewRef = useRef<RoadPreviewState | null>(null);
  const previewRequestSequenceRef = useRef(0);
  const draftScopeRef = useRef({ gameId, stateVersion: session.version.stateVersion });
  const [accessibleActions, setAccessibleActions] = useState<readonly AccessibleBoardAction[]>([]);
  const [actionDraft, setActionDraft] = useState<InteractiveBoardActionDraft | null>(null);
  const [sceneDiagnostic, setSceneDiagnostic] = useState<string | null>(null);
  const [actionDiagnostic, setActionDiagnostic] = useState<string | null>(null);
  const [dispatchDiagnostic, setDispatchDiagnostic] = useState<string | null>(null);
  const [previewDiagnostic, setPreviewDiagnostic] = useState<string | null>(null);
  const [roadPreview, setRoadPreview] = useState<RoadPreviewState | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [pendingPreviewActionId, setPendingPreviewActionId] = useState<string | null>(null);
  const [sceneReady, setSceneReady] = useState(false);

  sessionRef.current = session;
  dispatchRef.current = dispatchAction;
  previewTransportRoadRef.current = previewTransportRoad;
  isPendingRef.current = isPending;

  /** Invalidate a calculation whenever its endpoint intent may have changed. */
  const clearRoadPreview = useCallback(() => {
    previewRequestSequenceRef.current += 1;
    roadPreviewRef.current = null;
    setRoadPreview(null);
    setPreviewDiagnostic(null);
    setPendingPreviewActionId(null);
    handleRef.current?.updateSpatialPreview?.(null);
  }, []);

  useEffect(() => {
    const previousScope = draftScopeRef.current;
    const stateVersion = session.version.stateVersion;
    if (previousScope.gameId === gameId && previousScope.stateVersion === stateVersion) return;

    // A new authoritative snapshot invalidates every local selection. Keeping
    // even a visually plausible old endpoint would let the canvas and DOM form
    // imply that runtime had accepted state which it never confirmed.
    draftScopeRef.current = { gameId, stateVersion };
    actionDraftRef.current = null;
    setActionDraft(null);
    handleRef.current?.updateActionDraft?.(null);
    clearRoadPreview();
  }, [clearRoadPreview, gameId, session.version.stateVersion]);

  useEffect(() => {
    const handle = handleRef.current;

    if (handle) {
      try {
        handle.updateSession(session);
        setSceneDiagnostic(null);
      } catch (error) {
        setDispatchDiagnostic(null);
        setSceneDiagnostic(errorMessage(error, "Не удалось обновить интерактивное поле."));
      }
    }

    try {
      // Keep this projection outside the scene-update try/catch. A broken
      // visual adapter must not prevent keyboard users from receiving the
      // actions from the newest authoritative snapshot.
      setAccessibleActions(resolveAccessibleActions(gameId, session, handle));
      setActionDiagnostic(null);
    } catch (error) {
      // Fail closed on a broken projection so stale actions from an older
      // snapshot cannot remain clickable after the authoritative turn changes.
      setAccessibleActions([]);
      setDispatchDiagnostic(null);
      setActionDiagnostic(errorMessage(error, "Не удалось обновить доступные действия поля."));
    }
  }, [gameId, isPending, session]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const factory = resolvePhaserSceneFactory(gameId);
    if (!factory) {
      setDispatchDiagnostic(null);
      setSceneDiagnostic("Игра не предоставила сцену для интерактивного поля.");
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
          },
          onActionDraftChange: (draft) => {
            // Plugins are trusted, but clone and narrow this contribution so a
            // bundle cannot smuggle nested mutable state into the generic host.
            const normalized = normalizeActionDraft(draft);
            clearRoadPreview();
            actionDraftRef.current = normalized;
            setActionDraft(normalized);
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
            // FIT preserves the historical embedded board. A map-first board
            // owns the whole workspace, so RESIZE gives its camera the actual
            // viewport while the scene keeps its declared logical world bounded.
            mode: layoutMode === "map-first" ? Phaser.Scale.RESIZE : Phaser.Scale.FIT,
            autoCenter: layoutMode === "map-first" ? Phaser.Scale.NO_CENTER : Phaser.Scale.CENTER_BOTH,
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
        setSceneReady(true);
        handle.updateSession(initialSession);
        handle.updateActionDraft?.(actionDraftRef.current);
        const currentPreview = roadPreviewRef.current;
        handle.updateSpatialPreview?.(currentPreview ? {
          actionId: currentPreview.actionId,
          points: currentPreview.response.polyline
        } : null);
        try {
          setAccessibleActions(resolveAccessibleActions(gameId, initialSession, handle));
          setActionDiagnostic(null);
        } catch (error) {
          // A projection failure must not tear down an otherwise usable visual
          // scene. The ordinary controls stay empty and explain the problem.
          setAccessibleActions([]);
          setDispatchDiagnostic(null);
          setActionDiagnostic(errorMessage(error, "Не удалось обновить доступные действия поля."));
        }
        setSceneDiagnostic(null);

        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver((entries) => {
            const observed = entries.at(-1);
            if (!game || !observed) return;

            const width = Math.max(1, observed.contentRect.width);
            const height = Math.max(1, observed.contentRect.height);
            // `refresh()` recalculates from Phaser's previously cached parent
            // bounds before reading the new DOM bounds. Feeding the observed
            // content size first makes RESIZE update the canvas in the same
            // frame and prevents a viewport change from leaving stale pixels.
            game.scale.setParentSize(width, height);
          });
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
        setSceneReady(false);
        destroySurface(handle, game);
        handle = null;
        game = null;
        if (!cancelled) {
          setDispatchDiagnostic(null);
          setSceneDiagnostic(errorMessage(error, "Не удалось запустить интерактивное поле."));
        }
      });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (handleRef.current === handle) {
        handleRef.current = null;
      }
      setSceneReady(false);
      destroySurface(handle, game);
    };
  }, [assets, clearRoadPreview, content, gameId, layoutMode, manifestProps.designHeight, manifestProps.designWidth, manifestProps.sceneId]);

  const label = manifestProps.accessibleLabel ?? "Интерактивное игровое поле";

  const runAccessibleAction = async (
    action: AccessibleBoardAction,
    submittedParams: Record<string, unknown> = {}
  ) => {
    if (isPending || pendingActionId !== null || action.disabled === true) return;
    const params = mergeActionParameters(action, submittedParams, actionDraftRef.current);
    if (action.preview?.kind === "transport-road") {
      const endpointKey = roadPreviewKey(action, params);
      if (!endpointKey || roadPreviewRef.current?.actionId !== action.actionId
        || roadPreviewRef.current.endpointKey !== endpointKey) {
        setPreviewDiagnostic("Сначала рассчитайте маршрут для выбранных станций.");
        return;
      }
    }
    setPendingActionId(action.id);
    setDispatchDiagnostic(null);
    try {
      await dispatchAction(action.actionId, params);
      clearRoadPreview();
    } catch (error) {
      // The scene receives the same rejection through its injected dispatcher.
      // This local message keeps keyboard users in the context of their action.
      setDispatchDiagnostic(errorMessage(error, "Действие на поле отклонено."));
    } finally {
      setPendingActionId(null);
    }
  };

  /** Ask runtime for a route without sending payment or changing the session. */
  const runRoadPreview = async (
    action: AccessibleBoardAction,
    submittedParams: Record<string, unknown>
  ) => {
    const preview = action.preview;
    const request = previewTransportRoadRef.current;
    if (preview?.kind !== "transport-road" || !request) {
      setPreviewDiagnostic("Предварительный расчёт маршрута сейчас недоступен.");
      return;
    }
    const allParams = mergeActionParameters(action, submittedParams, actionDraftRef.current);
    const endpointParams = pickRoadPreviewParameters(action, allParams);
    const endpointKey = roadPreviewKey(action, endpointParams);
    if (!endpointKey) {
      setPreviewDiagnostic("Выберите две станции, которые нужно соединить.");
      return;
    }

    clearRoadPreview();
    const requestSequence = ++previewRequestSequenceRef.current;
    setPendingPreviewActionId(action.id);
    try {
      const response = await request(action.actionId, endpointParams);
      // A canvas click, form edit or authoritative snapshot can invalidate an
      // in-flight response. Such a response must never reappear on the map.
      if (previewRequestSequenceRef.current !== requestSequence) return;
      if (response.usedStateVersion !== sessionRef.current.version.stateVersion
        || response.actionId !== action.actionId) {
        throw new Error("Сервер вернул расчёт для другой версии состояния или действия.");
      }
      const next = { actionId: action.actionId, endpointKey, response };
      roadPreviewRef.current = next;
      setRoadPreview(next);
      setPreviewDiagnostic(null);
      handleRef.current?.updateSpatialPreview?.({
        actionId: action.actionId,
        points: response.polyline
      });
    } catch (error) {
      if (previewRequestSequenceRef.current !== requestSequence) return;
      setPreviewDiagnostic(errorMessage(error, "Не удалось рассчитать маршрут."));
    } finally {
      if (previewRequestSequenceRef.current === requestSequence) {
        setPendingPreviewActionId(null);
      }
    }
  };

  const updateDraftParameter = (
    actionId: string,
    name: string,
    value: InteractiveBoardActionDraftValue | undefined
  ) => {
    clearRoadPreview();
    const previous = actionDraftRef.current;
    const params: Record<string, InteractiveBoardActionDraftValue> = previous?.actionId === actionId
      ? { ...previous.params }
      : {};
    if (value === undefined) {
      delete params[name];
    } else {
      params[name] = value;
    }
    const next: InteractiveBoardActionDraft = { actionId, params };
    actionDraftRef.current = next;
    setActionDraft(next);
    handleRef.current?.updateActionDraft?.(next);
  };

  const diagnostic = dispatchDiagnostic ?? previewDiagnostic ?? actionDiagnostic ?? sceneDiagnostic;

  const runCameraCommand = (command: (handle: InteractiveBoardSceneHandle) => void) => {
    const handle = handleRef.current;
    if (!handle) return;
    try {
      command(handle);
      setSceneDiagnostic(null);
    } catch (error) {
      setSceneDiagnostic(errorMessage(error, "Не удалось изменить обзор карты."));
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await surfaceRef.current?.requestFullscreen();
      }
    } catch (error) {
      setSceneDiagnostic(errorMessage(error, "Не удалось переключить полноэкранный режим."));
    }
  };

  return (
    <section
      ref={surfaceRef}
      className={`${styles.surface} ${layoutMode === "map-first" ? styles.surfaceMapFirst : ""}`}
      aria-label={label}
      data-layout-mode={layoutMode}
    >
      <div
        ref={containerRef}
        className={styles.canvasHost}
        aria-hidden="true"
        data-testid="interactive-board-canvas-host"
      />

      {layoutMode === "map-first" ? (
        <div className={styles.cameraControls} aria-label="Управление обзором карты">
          <button
            type="button"
            className={styles.cameraButton}
            disabled={!sceneReady}
            aria-label="Увеличить карту"
            onClick={() => runCameraCommand((handle) => handle.zoomBy?.(1.2))}
          >
            +
          </button>
          <button
            type="button"
            className={styles.cameraButton}
            disabled={!sceneReady}
            aria-label="Уменьшить карту"
            onClick={() => runCameraCommand((handle) => handle.zoomBy?.(1 / 1.2))}
          >
            −
          </button>
          <button
            type="button"
            className={styles.cameraButtonWide}
            disabled={!sceneReady}
            onClick={() => runCameraCommand((handle) => handle.fitToView?.())}
          >
            Показать всю карту
          </button>
          <button
            type="button"
            className={styles.cameraButtonWide}
            onClick={() => void toggleFullscreen()}
          >
            На весь экран
          </button>
        </div>
      ) : null}

      <div className={styles.accessibleControls}>
        <h2 className={styles.controlsTitle}>Действия на поле</h2>
        {accessibleActions.length > 0 ? (
          <ul className={styles.actionList}>
            {accessibleActions.map((action, index) => {
              const descriptionId = `${manifestProps.sceneId}-board-action-${index}-description`;
              // Capture the narrowed array before entering the event closure.
              // The action object is external plugin data and TypeScript
              // correctly refuses to assume its optional field is unchanged.
              const fields = action.fields;
              const matchingDraft = actionDraft?.actionId === action.actionId ? actionDraft : null;
              const currentPreviewKey = roadPreviewKey(
                action,
                mergeActionParameters(action, {}, matchingDraft)
              );
              const hasCurrentPreview = action.preview?.kind !== "transport-road" || (
                currentPreviewKey !== null
                && roadPreview?.actionId === action.actionId
                && roadPreview.endpointKey === currentPreviewKey
              );
              return (
                <li key={action.id}>
                  {fields && fields.length > 0 ? (
                    <form
                      className={styles.actionForm}
                      aria-label={action.label}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void runAccessibleAction(action, readActionForm(event.currentTarget, fields));
                      }}
                    >
                      {fields.map((field) => (
                        <AccessibleActionField
                          key={field.name}
                          action={action}
                          field={field}
                          value={resolveActionFieldValue(action, field, matchingDraft)}
                          onValueChange={(value) => updateDraftParameter(action.actionId, field.name, value)}
                          disabled={action.disabled === true || isPending || pendingActionId !== null}
                        />
                      ))}
                      {action.preview?.kind === "transport-road" ? (
                        <button
                          type="button"
                          className={styles.previewButton}
                          disabled={
                            action.disabled === true
                            || isPending
                            || pendingActionId !== null
                            || pendingPreviewActionId !== null
                            || currentPreviewKey === null
                            || previewTransportRoad === undefined
                          }
                          onClick={(event) => {
                            const form = event.currentTarget.form;
                            if (!form) return;
                            void runRoadPreview(action, readActionForm(form, fields));
                          }}
                        >
                          {pendingPreviewActionId === action.id ? "Рассчитывается…" : "Рассчитать маршрут"}
                        </button>
                      ) : null}
                      {action.preview?.kind === "transport-road" && hasCurrentPreview && roadPreview ? (
                        <p className={styles.previewResult} role="status">
                          Сегментов по областям: {roadPreview.response.regionSegments}.
                          {roadPreview.response.candidateCount > 1
                            ? ` Равноценных маршрутов: ${roadPreview.response.candidateCount}; выбран один воспроизводимый вариант.`
                            : " Маршрут однозначен."}
                        </p>
                      ) : null}
                      <button
                        type="submit"
                        className={styles.actionButton}
                        disabled={
                          action.disabled === true
                          || isPending
                          || pendingActionId !== null
                          || pendingPreviewActionId !== null
                          || !hasCurrentPreview
                        }
                        aria-describedby={action.description ? descriptionId : undefined}
                      >
                        {pendingActionId === action.id ? "Выполняется…" : action.label}
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className={styles.actionButton}
                      disabled={action.disabled === true || isPending || pendingActionId !== null}
                      aria-describedby={action.description ? descriptionId : undefined}
                      onClick={() => void runAccessibleAction(action)}
                    >
                      {pendingActionId === action.id ? "Выполняется…" : action.label}
                    </button>
                  )}
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

/** Render one plugin-projected field without teaching the host game rules. */
function AccessibleActionField({
  action,
  field,
  value,
  onValueChange,
  disabled
}: {
  readonly action: AccessibleBoardAction;
  readonly field: AccessibleBoardActionField;
  readonly value: InteractiveBoardActionDraftValue | undefined;
  readonly onValueChange: (value: InteractiveBoardActionDraftValue | undefined) => void;
  readonly disabled: boolean;
}) {
  const id = `${action.id}-${field.name}`;
  if (field.kind === "select") {
    return (
      <label className={styles.actionField} htmlFor={id}>
        <span>{field.label}</span>
        <select
          id={id}
          name={field.name}
          required={field.required === true}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onValueChange(event.currentTarget.value || null)}
          disabled={disabled}
        >
          {field.required === true ? <option value="">Выберите…</option> : null}
          {field.options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled === true}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className={styles.actionField} htmlFor={id}>
      <span>{field.label}</span>
      <input
        id={id}
        name={field.name}
        type="number"
        required={field.required === true}
        value={typeof value === "number" ? value : ""}
        onChange={(event) => {
          const rawValue = event.currentTarget.value;
          const numberValue = event.currentTarget.valueAsNumber;
          onValueChange(rawValue === "" || !Number.isFinite(numberValue) ? null : numberValue);
        }}
        min={field.min}
        max={field.max}
        step={field.step}
        disabled={disabled}
      />
    </label>
  );
}

/** Resolve a controlled field from the shared draft, then authored defaults. */
function resolveActionFieldValue(
  action: AccessibleBoardAction,
  field: AccessibleBoardActionField,
  draft: InteractiveBoardActionDraft | null
): InteractiveBoardActionDraftValue | undefined {
  if (draft && Object.prototype.hasOwnProperty.call(draft.params, field.name)) {
    return draft.params[field.name];
  }
  if (field.defaultValue !== undefined) return field.defaultValue;
  const declared = action.params?.[field.name];
  if (
    typeof declared === "string"
    || typeof declared === "boolean"
    || declared === null
    || (typeof declared === "number" && Number.isFinite(declared))
  ) {
    return declared;
  }
  return undefined;
}

/** Convert browser form values into the primitive action parameters AJV expects. */
function readActionForm(
  form: HTMLFormElement,
  fields: readonly AccessibleBoardActionField[]
): Record<string, unknown> {
  const formData = new FormData(form);
  const params: Record<string, unknown> = {};
  for (const field of fields) {
    const value = formData.get(field.name);
    if (typeof value !== "string" || value === "") continue;
    params[field.name] = field.kind === "number" ? Number(value) : value;
  }
  return params;
}

/** Merge authored defaults, form values and explicit draft tombstones safely. */
function mergeActionParameters(
  action: AccessibleBoardAction,
  submittedParams: Record<string, unknown>,
  draft: InteractiveBoardActionDraft | null
): Record<string, unknown> {
  const params: Record<string, unknown> = { ...action.params };
  for (const field of action.fields ?? []) {
    if (params[field.name] === undefined && field.defaultValue !== undefined) {
      params[field.name] = field.defaultValue;
    }
  }
  Object.assign(params, submittedParams);
  if (draft?.actionId !== action.actionId) return params;
  for (const [name, value] of Object.entries(draft.params)) {
    if (value === null) {
      delete params[name];
    } else {
      params[name] = value;
    }
  }
  return params;
}

/** Copy only endpoint references declared by the plugin preview contribution. */
function pickRoadPreviewParameters(
  action: AccessibleBoardAction,
  params: Record<string, unknown>
): Record<string, unknown> {
  if (action.preview?.kind !== "transport-road") return {};
  const names = action.preview.endpointParameters;
  return {
    [names.from]: params[names.from],
    [names.to]: params[names.to]
  };
}

/** Stable key proving that the shown calculation matches the selected endpoints. */
function roadPreviewKey(
  action: AccessibleBoardAction,
  params: Record<string, unknown>
): string | null {
  if (action.preview?.kind !== "transport-road") return null;
  const names = action.preview.endpointParameters;
  const from = params[names.from];
  const to = params[names.to];
  return typeof from === "string" && from !== "" && typeof to === "string" && to !== ""
    ? JSON.stringify([names.from, from, names.to, to])
    : null;
}

type RoadPreviewState = {
  readonly actionId: string;
  readonly endpointKey: string;
  readonly response: TransportRoadPreviewResponse;
};

/** Clone a plugin contribution and keep only finite JSON scalar parameters. */
function normalizeActionDraft(
  draft: InteractiveBoardActionDraft | null
): InteractiveBoardActionDraft | null {
  if (!draft || draft.actionId.trim() === "") return null;
  const params: Record<string, InteractiveBoardActionDraftValue> = {};
  for (const [name, value] of Object.entries(draft.params)) {
    if (
      typeof value === "string"
      || typeof value === "boolean"
      || value === null
      || (typeof value === "number" && Number.isFinite(value))
    ) {
      params[name] = value;
    }
  }
  return { actionId: draft.actionId, params };
}

/**
 * Prefer the engine-independent provider and retain the scene callback only as
 * a same-major compatibility fallback for plugins not migrated yet.
 */
function resolveAccessibleActions(
  gameId: string,
  session: GameSession,
  handle: InteractiveBoardSceneHandle | null
): readonly AccessibleBoardAction[] {
  const provider = resolveAccessibleBoardActionsProvider(gameId);
  return provider?.(session) ?? handle?.getAccessibleActions?.(session) ?? [];
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
