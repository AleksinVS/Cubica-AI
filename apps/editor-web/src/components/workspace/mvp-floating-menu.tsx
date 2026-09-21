import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { MvpMenuIcon, type MvpMenuIconName } from "./mvp-menu-icons.tsx";
import styles from "./mvp-floating-menu.module.css";

export type MvpMenuMode = "chat" | "editor" | "drawing" | "play" | "rules";
export type MvpPlayState = "idle" | "running" | "paused";

export interface MvpMenuEntry {
  readonly id: string;
  readonly label: string;
  readonly disabledReason?: string;
}

export type MvpDisabledModes = Partial<Record<MvpMenuMode | "scenario", string>>;

type MainMenuItem = {
  readonly mode: MvpMenuMode | "scenario" | "add";
  readonly label: string;
  readonly icon: MvpMenuIconName;
};

const MAIN_ITEMS: ReadonlyArray<MainMenuItem> = [
  { mode: "chat", label: "Чат", icon: "chat" },
  { mode: "editor", label: "Редактор", icon: "editor" },
  { mode: "drawing", label: "Рисование", icon: "drawing" },
  { mode: "play", label: "Игра", icon: "play" },
  { mode: "scenario", label: "Сценарий", icon: "scenario" },
  { mode: "add", label: "Добавить", icon: "add" }
];

const PENCIL_COLORS = [
  { value: "#ef4444", label: "Красный" },
  { value: "#f97316", label: "Оранжевый" },
  { value: "#eab308", label: "Жёлтый" },
  { value: "#22c55e", label: "Зелёный" },
  { value: "#3b82f6", label: "Синий" },
  { value: "#a855f7", label: "Фиолетовый" },
  { value: "#202731", label: "Чёрный" }
] as const;

const PENCIL_WIDTHS = [1, 3, 5, 8] as const;
const DRAG_THRESHOLD = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function viewportWidth(): number {
  return typeof window === "undefined" || window.innerWidth <= 0 ? 320 : window.innerWidth;
}

type OpenPopover = "scenario" | "drawing" | "add" | null;
type DragState = { pointerId: number; startX: number; startLeft: number; moved: boolean };

/** Compact editor toolbar with caller-owned mode and row data. */
export interface MvpFloatingMenuProps {
  readonly activeMode: MvpMenuMode;
  readonly onModeChange: (mode: MvpMenuMode) => void;
  readonly playState?: MvpPlayState;
  readonly savedStates?: readonly MvpMenuEntry[];
  readonly scenarioStages?: readonly MvpMenuEntry[];
  readonly addEntries?: readonly MvpMenuEntry[];
  readonly onSelectSavedState?: (id: string) => void;
  readonly onSelectScenarioStage?: (id: string) => void;
  readonly onAddEntry?: (id: string) => void;
  readonly onSaveState?: () => void;
  readonly onDeleteSavedState?: (id: string) => void;
  /** @deprecated Kept for caller compatibility; compatibility is checked by the caller. */
  readonly onRefreshSavedStates?: () => void;
  readonly canSaveState?: boolean;
  readonly disabledModes?: MvpDisabledModes;
  readonly pencilColor?: string;
  readonly pencilWidth?: number;
  readonly onPencilChange?: (value: { color: string; width: number }) => void;
  readonly defaultExpanded?: boolean;
}

export function MvpFloatingMenu({
  activeMode,
  onModeChange,
  playState = "idle",
  savedStates = [],
  scenarioStages = [],
  addEntries = [],
  onSelectSavedState,
  onSelectScenarioStage,
  onAddEntry,
  onSaveState,
  onDeleteSavedState,
  onRefreshSavedStates,
  canSaveState = false,
  disabledModes = {},
  pencilColor = "#ef4444",
  pencilWidth = 3,
  onPencilChange,
  defaultExpanded = true
}: MvpFloatingMenuProps) {
  void onRefreshSavedStates;

  const menuRef = useRef<HTMLDivElement>(null);
  const activeToolRef = useRef<HTMLButtonElement | null>(null);
  const scenarioTriggerRef = useRef<HTMLButtonElement | null>(null);
  const drawingTriggerRef = useRef<HTMLButtonElement | null>(null);
  const addTriggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const pointerInteractionRef = useRef(false);
  const pointerInteractionResetRef = useRef<number | undefined>(undefined);
  const pointerFocusRef = useRef(false);
  const focusAfterRevealRef = useRef(false);
  const holdsRef = useRef({ pinned: false, focus: false, pointer: false, popover: false });
  const [revealed, setRevealed] = useState(defaultExpanded);
  const [pinned, setPinned] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [pointerWithin, setPointerWithin] = useState(false);
  const [openPopover, setOpenPopover] = useState<OpenPopover>(null);
  const [dragging, setDragging] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const [popoverLeft, setPopoverLeft] = useState<number | null>(null);
  const [selectedPencilColor, setSelectedPencilColor] = useState(pencilColor);
  const [selectedPencilWidth, setSelectedPencilWidth] = useState(pencilWidth);

  const isExpanded = revealed || pinned || focusWithin || pointerWithin || openPopover !== null || dragging;
  const popoverOpen = openPopover !== null;
  const activeMainMode = activeMode === "rules" ? "scenario" : activeMode;

  useEffect(() => setSelectedPencilColor(pencilColor), [pencilColor]);
  useEffect(() => setSelectedPencilWidth(pencilWidth), [pencilWidth]);

  const clearCollapseTimer = useCallback(() => {
    if (collapseTimerRef.current !== undefined) {
      clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = undefined;
    }
  }, []);

  const clearPointerInteractionReset = useCallback(() => {
    if (pointerInteractionResetRef.current !== undefined) {
      clearTimeout(pointerInteractionResetRef.current);
      pointerInteractionResetRef.current = undefined;
    }
  }, []);

  const schedulePointerInteractionReset = useCallback(() => {
    clearPointerInteractionReset();
    pointerInteractionResetRef.current = window.setTimeout(() => {
      pointerInteractionResetRef.current = undefined;
      pointerInteractionRef.current = false;
    }, 0);
  }, [clearPointerInteractionReset]);

  const setPopover = useCallback((next: OpenPopover) => {
    holdsRef.current.popover = next !== null;
    setOpenPopover(next);
  }, []);

  const requestCollapse = useCallback(() => {
    clearCollapseTimer();
    collapseTimerRef.current = setTimeout(() => {
      collapseTimerRef.current = undefined;
      const holds = holdsRef.current;
      if (!holds.pinned && !holds.focus && !holds.pointer && !holds.popover && dragRef.current === null) setRevealed(false);
    }, 320);
  }, [clearCollapseTimer]);

  const measureWidth = useCallback(() => {
    const element = menuRef.current;
    if (!element) return Math.min(360, viewportWidth() - 16);
    const measured = element.getBoundingClientRect().width || element.scrollWidth;
    return measured > 0 ? measured : Math.min(360, viewportWidth() - 16);
  }, []);

  const clampMenuLeft = useCallback(
    (nextLeft: number) => {
      const width = measureWidth();
      setLeft(clamp(nextLeft, 8, viewportWidth() - width - 8));
    },
    [measureWidth]
  );

  const currentLeft = useCallback(() => {
    const element = menuRef.current;
    if (left !== null) return left;
    const measured = element?.getBoundingClientRect();
    const width = measureWidth();
    return measured && measured.width > 0 ? measured.left : (viewportWidth() - width) / 2;
  }, [left, measureWidth]);

  const recenter = useCallback(() => setLeft(null), []);

  const revealAndFocus = useCallback(() => {
    clearCollapseTimer();
    focusAfterRevealRef.current = true;
    setRevealed(true);
  }, [clearCollapseTimer]);

  const moveByKeyboard = useCallback(
    (amount: number) => {
      const width = measureWidth();
      setLeft((previousLeft) => {
        const baseLeft = previousLeft ?? currentLeft();
        return clamp(baseLeft + amount, 8, viewportWidth() - width - 8);
      });
    },
    [currentLeft, measureWidth]
  );

  useEffect(() => () => {
    clearCollapseTimer();
    clearPointerInteractionReset();
  }, [clearCollapseTimer, clearPointerInteractionReset]);

  useLayoutEffect(() => {
    if (focusAfterRevealRef.current && isExpanded) {
      focusAfterRevealRef.current = false;
      if (activeToolRef.current && !activeToolRef.current.disabled) activeToolRef.current.focus();
      else menuRef.current?.querySelector<HTMLButtonElement>("[role='toolbar'] button:not([tabindex='-1'])")?.focus();
    }
  }, [isExpanded]);

  useEffect(() => {
    const handleProximity = (event: PointerEvent) => {
      const element = menuRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const within = event.clientX >= rect.left - 24 && event.clientX <= rect.right + 24 && event.clientY >= rect.top - 24 && event.clientY <= rect.bottom + 24;
      if (within) {
        clearCollapseTimer();
        holdsRef.current.pointer = true;
        setPointerWithin(true);
        setRevealed(true);
      } else if (holdsRef.current.pointer) {
        holdsRef.current.pointer = false;
        setPointerWithin(false);
        if (!holdsRef.current.pinned && !holdsRef.current.focus && !holdsRef.current.popover && dragRef.current === null) requestCollapse();
      }
    };
    document.addEventListener("pointermove", handleProximity);
    return () => document.removeEventListener("pointermove", handleProximity);
  }, [clearCollapseTimer, requestCollapse]);

  useEffect(() => {
    if (!popoverOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const element = menuRef.current;
      if (element && !element.contains(event.target as Node)) setPopover(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      const trigger = openPopover === "scenario" ? scenarioTriggerRef : openPopover === "drawing" ? drawingTriggerRef : addTriggerRef;
      setPopover(null);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openPopover, popoverOpen, setPopover]);

  const clampPopover = useCallback(() => {
    const menu = menuRef.current;
    const popover = popoverRef.current;
    if (!menu || !popover || !popoverOpen) return;
    const menuRect = menu.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const menuWidth = menuRect.width || measureWidth();
    const popoverWidth = popoverRect.width || Math.min(288, viewportWidth() - 16);
    const centered = (menuWidth - popoverWidth) / 2;
    const minimum = 8 - menuRect.left;
    const maximum = viewportWidth() - 8 - menuRect.left - popoverWidth;
    setPopoverLeft(clamp(centered, minimum, maximum));
  }, [measureWidth, popoverOpen]);

  useLayoutEffect(() => clampPopover(), [clampPopover, isExpanded, left]);

  useEffect(() => {
    const handleResize = () => {
      if (left !== null) clampMenuLeft(left);
      clampPopover();
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [clampMenuLeft, clampPopover, left]);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu || left === null) return;
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => clampMenuLeft(left)) : undefined;
    observer?.observe(menu);
    return () => observer?.disconnect();
  }, [clampMenuLeft, left]);

  const handlePointerEnter = () => {
    clearCollapseTimer();
    holdsRef.current.pointer = true;
    setPointerWithin(true);
    setRevealed(true);
  };

  const handlePointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
    void event;
    if (dragRef.current && !dragRef.current.moved) {
      dragRef.current = null;
      setDragging(false);
    }
    pointerInteractionRef.current = false;
    if (pointerFocusRef.current) {
      holdsRef.current.focus = false;
      setFocusWithin(false);
    }
    holdsRef.current.pointer = false;
    setPointerWithin(false);
    if (!holdsRef.current.pinned && !holdsRef.current.focus && !holdsRef.current.popover && dragRef.current === null) requestCollapse();
  };

  const handleFocusCapture = () => {
    clearCollapseTimer();
    if (pointerInteractionRef.current) {
      pointerFocusRef.current = true;
      holdsRef.current.focus = false;
      setFocusWithin(false);
      setRevealed(true);
      return;
    }
    pointerFocusRef.current = false;
    holdsRef.current.focus = true;
    setFocusWithin(true);
    setRevealed(true);
  };

  const handleBlurCapture = () => {
    window.setTimeout(() => {
      const element = menuRef.current;
      const stillFocused = Boolean(element && element.contains(document.activeElement));
      const shouldHoldFocus = stillFocused && !pointerInteractionRef.current && !pointerFocusRef.current;
      if (!stillFocused) pointerFocusRef.current = false;
      holdsRef.current.focus = shouldHoldFocus;
      setFocusWithin(shouldHoldFocus);
      if (!shouldHoldFocus && !holdsRef.current.pinned && !holdsRef.current.pointer && !holdsRef.current.popover && dragRef.current === null) requestCollapse();
    }, 0);
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    pointerInteractionRef.current = true;
    holdsRef.current.focus = false;
    setFocusWithin(false);
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest("[role='menu']")) return;
    const inToolbar = target.closest("[data-mvp-toolbar]") || target === menuRef.current;
    if (!inToolbar) return;
    clearCollapseTimer();
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startLeft: currentLeft(), moved: false };
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(delta) < DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      if (typeof event.currentTarget.setPointerCapture === "function") {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // happy-dom and older browsers can expose capture without a live pointer.
        }
      }
    }
    setDragging(true);
    setRevealed(true);
    event.preventDefault();
    clampMenuLeft(drag.startLeft + delta);
  };

  const finishDrag = (event?: React.PointerEvent<HTMLDivElement>) => {
    if (event && dragRef.current && event.pointerId !== dragRef.current.pointerId) return;
    const hadPointerInteraction = pointerInteractionRef.current;
    const moved = dragRef.current?.moved ?? false;
    if (event && typeof event.currentTarget.hasPointerCapture === "function") {
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture is optional in the DOM used by component tests.
      }
    }
    dragRef.current = null;
    pointerInteractionRef.current = hadPointerInteraction;
    if (hadPointerInteraction) schedulePointerInteractionReset();
    setDragging(false);
    if (moved) suppressClickRef.current = true;
    if (!holdsRef.current.pinned && !holdsRef.current.focus && !holdsRef.current.pointer && !holdsRef.current.popover) requestCollapse();
  };

  const handleDragKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveByKeyboard(-24);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      moveByKeyboard(24);
    } else if (event.key === "Home") {
      event.preventDefault();
      recenter();
    }
  };

  const handleModeClick = (mode: MvpMenuMode, event: React.MouseEvent<HTMLButtonElement>) => {
    if (!isExpanded) {
      event.preventDefault();
      revealAndFocus();
      return;
    }
    setPopover(null);
    onModeChange(mode);
  };

  const closePopoverAndRestoreFocus = useCallback(() => {
    const trigger = openPopover === "scenario" ? scenarioTriggerRef : openPopover === "drawing" ? drawingTriggerRef : addTriggerRef;
    const restoringPointerFocus = pointerInteractionRef.current;
    if (restoringPointerFocus) clearPointerInteractionReset();
    setPopover(null);
    trigger.current?.focus();
    if (restoringPointerFocus) schedulePointerInteractionReset();
  }, [clearPointerInteractionReset, openPopover, schedulePointerInteractionReset, setPopover]);

  const choosePencil = (color: string, width: number) => {
    setSelectedPencilColor(color);
    setSelectedPencilWidth(width);
    onPencilChange?.({ color, width });
  };

  const playLabel = playState === "running" ? "Пауза игры" : playState === "paused" ? "Продолжить игру" : "Игра";

  return (
    <div
      ref={menuRef}
      className={`${styles.menu} ${left !== null ? styles.isPositioned : ""} ${!isExpanded ? styles.isCollapsed : ""}`}
      style={left !== null ? { left } : undefined}
      data-expanded={isExpanded ? "true" : "false"}
      aria-label="Плавающее меню редактора"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={() => finishDrag()}
      onKeyDown={handleDragKeyDown}
      onClickCapture={(event) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
    >
      <div className={styles.mainControls} role="toolbar" aria-label="Панель инструментов" title="Панель инструментов" data-mvp-toolbar>
        {MAIN_ITEMS.map((item) => {
          const isScenario = item.mode === "scenario";
          const isAdd = item.mode === "add";
          const isDrawing = item.mode === "drawing";
          const isActive = item.mode === activeMainMode;
          const disabledReason = isScenario ? disabledModes.scenario : item.mode === "add" ? undefined : disabledModes[item.mode];
          const disabled = disabledReason !== undefined;
          const label = item.mode === "play" ? playLabel : item.label;
          const icon: MvpMenuIconName = item.mode === "play" && playState === "running" ? "pause" : item.icon;
          const visible = isExpanded || isActive;
          return (
            <button
              key={item.mode}
              ref={(element) => {
                if (isScenario) scenarioTriggerRef.current = element;
                if (isDrawing) drawingTriggerRef.current = element;
                if (isAdd) addTriggerRef.current = element;
                if (isActive) activeToolRef.current = element;
              }}
              type="button"
              className={`${styles.control} ${isActive ? styles.isActive : ""} ${!visible ? styles.isHidden : ""}`}
              aria-label={label}
              aria-current={isActive ? "page" : undefined}
              aria-expanded={(isScenario || isDrawing || isAdd) ? openPopover === item.mode : undefined}
              aria-haspopup={(isScenario || isDrawing || isAdd) ? "menu" : undefined}
              aria-disabled={disabled || undefined}
              disabled={disabled && isExpanded}
              tabIndex={visible ? 0 : -1}
              title={disabledReason ?? label}
              onClick={(event) => {
                if (!isExpanded) {
                  handleModeClick(activeMode, event);
                  return;
                }
                if (disabled) return;
                if (isScenario || isDrawing || isAdd) {
                  if (isDrawing) onModeChange("drawing");
                  setPopover(openPopover === item.mode ? null : item.mode);
                }
                else handleModeClick(item.mode, event);
              }}
            >
              <MvpMenuIcon name={icon} />
            </button>
          );
        })}
      </div>
      <div className={styles.secondaryControls} aria-label="Панель инструментов" data-mvp-toolbar>
        <button
          type="button"
          className={`${styles.control} ${styles.pinButton} ${pinned ? styles.isPinned : ""} ${!isExpanded ? styles.isHidden : ""}`}
          aria-label={pinned ? "Открепить меню" : "Закрепить меню"}
          aria-pressed={pinned}
          title={pinned ? "Открепить меню" : "Закрепить меню"}
          tabIndex={isExpanded ? 0 : -1}
          onClick={() => {
            clearCollapseTimer();
            const nextPinned = !holdsRef.current.pinned;
            holdsRef.current.pinned = nextPinned;
            setPinned(nextPinned);
            setRevealed(true);
          }}
        >
          <MvpMenuIcon name="pin" />
        </button>
      </div>

      {isExpanded && popoverOpen ? (
        <div
          ref={popoverRef}
          className={styles.popover}
          style={popoverLeft !== null ? { left: popoverLeft, transform: "none" } : undefined}
          role="menu"
          aria-label={openPopover === "scenario" ? "Сценарий" : openPopover === "drawing" ? "Настройки рисования" : "Добавить"}
        >
          {openPopover === "scenario" ? (
            <>
              <section className={styles.group} aria-label="Правила">
                <button type="button" className={styles.row} role="menuitem" disabled={disabledModes.rules !== undefined} title={disabledModes.rules} onClick={() => { onModeChange("rules"); closePopoverAndRestoreFocus(); }}>
                  <MvpMenuIcon name="rules" />
                  <span>Правила</span>
                </button>
              </section>
              <section className={styles.group} aria-labelledby="mvp-saved-states">
                <h2 id="mvp-saved-states" className={styles.groupTitle}>Сохранённые состояния</h2>
                {savedStates.length > 0 ? savedStates.map((entry) => (
                  <div key={entry.id} className={styles.savedRow}>
                    <button type="button" className={styles.row} role="menuitem" title={entry.disabledReason} onClick={() => { onSelectSavedState?.(entry.id); closePopoverAndRestoreFocus(); }}>
                      <span>{entry.label}{entry.disabledReason ? <small>{entry.disabledReason}</small> : null}</span>
                    </button>
                    {onDeleteSavedState ? <button type="button" className={styles.deleteButton} role="menuitem" aria-label={`Удалить сохранение «${entry.label}»`} onClick={() => onDeleteSavedState(entry.id)}>×</button> : null}
                  </div>
                )) : <p className={styles.empty}>Нет сохранённых состояний</p>}
                {onSaveState ? (
                  <button type="button" className={styles.saveButton} disabled={!canSaveState} aria-label={canSaveState ? "Сохранить состояние" : "Сохранение недоступно"} title={canSaveState ? "Сохранить состояние" : "Сохранение недоступно"} onClick={() => { onSaveState(); closePopoverAndRestoreFocus(); }}>
                    <MvpMenuIcon name="save" />
                  </button>
                ) : null}
              </section>
              <section className={styles.group} aria-labelledby="mvp-scenario-stages">
                <h2 id="mvp-scenario-stages" className={styles.groupTitle}>Этапы сценария</h2>
                {scenarioStages.length > 0 ? scenarioStages.map((entry) => (
                  <button key={entry.id} type="button" className={styles.row} role="menuitem" disabled={entry.disabledReason !== undefined} title={entry.disabledReason} onClick={() => { onSelectScenarioStage?.(entry.id); closePopoverAndRestoreFocus(); }}>
                    <span>{entry.label}{entry.disabledReason ? <small>{entry.disabledReason}</small> : null}</span>
                  </button>
                )) : <p className={styles.empty}>Этапы не объявлены</p>}
              </section>
            </>
          ) : openPopover === "add" ? (
            <section className={styles.group} aria-labelledby="mvp-add-items">
              <h2 id="mvp-add-items" className={styles.groupTitle}>Добавить</h2>
              {addEntries.length > 0 ? addEntries.map((entry) => (
                <button key={entry.id} type="button" className={styles.row} role="menuitem" disabled={entry.disabledReason !== undefined} title={entry.disabledReason} onClick={() => { onAddEntry?.(entry.id); closePopoverAndRestoreFocus(); }}>
                  <span>{entry.label}{entry.disabledReason ? <small>{entry.disabledReason}</small> : null}</span>
                </button>
              )) : <p className={styles.empty}>Действия добавления не объявлены</p>}
            </section>
          ) : (
            <>
              <section className={styles.group} aria-labelledby="mvp-pencil-colors">
                <h2 id="mvp-pencil-colors" className={styles.groupTitle}>Цвет</h2>
                <div className={styles.swatches}>
                  {PENCIL_COLORS.map((color) => <button key={color.value} type="button" className={`${styles.swatch} ${selectedPencilColor === color.value ? styles.swatchActive : ""}`} style={{ backgroundColor: color.value }} aria-label={`Цвет карандаша: ${color.label}`} aria-pressed={selectedPencilColor === color.value} title={color.label} onClick={() => choosePencil(color.value, selectedPencilWidth)} />)}
                </div>
              </section>
              <section className={styles.group} aria-labelledby="mvp-pencil-widths">
                <h2 id="mvp-pencil-widths" className={styles.groupTitle}>Толщина</h2>
                <div className={styles.widths}>
                  {PENCIL_WIDTHS.map((width) => <button key={width} type="button" className={`${styles.widthButton} ${selectedPencilWidth === width ? styles.widthActive : ""}`} aria-label={`Толщина карандаша: ${width} пикс.`} aria-pressed={selectedPencilWidth === width} onClick={() => choosePencil(selectedPencilColor, width)}>{width}</button>)}
                </div>
              </section>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
