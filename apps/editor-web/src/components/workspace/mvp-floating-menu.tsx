import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { MvpMenuIcon, type MvpMenuIconName } from "./mvp-menu-icons.tsx";
import styles from "./mvp-floating-menu.module.css";

export type MvpMenuMode = "chat" | "editor" | "drawing" | "play" | "rules";
export type MvpPlayState = "idle" | "running" | "paused";

export interface MvpMenuEntry {
  readonly id: string;
  readonly label: string;
}

export type MvpDisabledModes = Partial<Record<MvpMenuMode | "scenario", string>>;

const MAIN_ITEMS: ReadonlyArray<{
  readonly mode: MvpMenuMode | "scenario";
  readonly label: string;
  readonly icon: MvpMenuIconName;
}> = [
  { mode: "chat", label: "Чат", icon: "chat" },
  { mode: "editor", label: "Редактор", icon: "editor" },
  { mode: "drawing", label: "Рисование", icon: "drawing" },
  { mode: "play", label: "Игра", icon: "play" },
  { mode: "scenario", label: "Сценарий", icon: "scenario" },
  { mode: "rules", label: "Правила", icon: "rules" }
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function viewportWidth(): number {
  return typeof window === "undefined" || window.innerWidth <= 0 ? 320 : window.innerWidth;
}

/**
 * Compact, self-contained editor tool menu. The active tool is controlled by
 * `activeMode`; all scenario rows are caller-owned and only emit selection
 * callbacks. The optional save action has no state mutation inside this menu.
 */
export interface MvpFloatingMenuProps {
  readonly activeMode: MvpMenuMode;
  readonly onModeChange: (mode: MvpMenuMode) => void;
  readonly playState?: MvpPlayState;
  readonly savedStates?: readonly MvpMenuEntry[];
  readonly scenarioStages?: readonly MvpMenuEntry[];
  readonly onSelectSavedState?: (id: string) => void;
  readonly onSelectScenarioStage?: (id: string) => void;
  readonly onSaveState?: () => void;
  readonly canSaveState?: boolean;
  readonly disabledModes?: MvpDisabledModes;
  /** Starts open to match the expanded desktop editor surface. */
  readonly defaultExpanded?: boolean;
}

export function MvpFloatingMenu({
  activeMode,
  onModeChange,
  playState = "idle",
  savedStates = [],
  scenarioStages = [],
  onSelectSavedState,
  onSelectScenarioStage,
  onSaveState,
  canSaveState = false,
  disabledModes = {},
  defaultExpanded = true
}: MvpFloatingMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const activeToolRef = useRef<HTMLButtonElement | null>(null);
  const scenarioTriggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragRef = useRef<{ pointerId: number; startX: number; startLeft: number } | null>(null);
  const collapsedInteractionRef = useRef(false);
  const focusAfterRevealRef = useRef(false);
  const holdsRef = useRef({ pinned: false, focus: false, pointer: false, popover: false });
  const [revealed, setRevealed] = useState(defaultExpanded);
  const [pinned, setPinned] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [pointerWithin, setPointerWithin] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const [popoverLeft, setPopoverLeft] = useState<number | null>(null);

  const isExpanded = revealed || pinned || focusWithin || pointerWithin || popoverOpen || dragRef.current !== null;

  const clearCollapseTimer = useCallback(() => {
    if (collapseTimerRef.current !== undefined) {
      clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = undefined;
    }
  }, []);

  const updatePopover = useCallback((value: boolean | ((open: boolean) => boolean)) => {
    const nextValue = typeof value === "function" ? value(holdsRef.current.popover) : value;
    holdsRef.current.popover = nextValue;
    setPopoverOpen(nextValue);
  }, []);

  const requestCollapse = useCallback(() => {
    clearCollapseTimer();
    collapseTimerRef.current = setTimeout(() => {
      collapseTimerRef.current = undefined;
      const holds = holdsRef.current;
      if (!holds.pinned && !holds.focus && !holds.pointer && !holds.popover && dragRef.current === null) {
        setRevealed(false);
      }
    }, 250);
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

  const recenter = useCallback(() => {
    setLeft(null);
  }, []);

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

  useEffect(() => {
    return () => {
      clearCollapseTimer();
    };
  }, [clearCollapseTimer]);

  useLayoutEffect(() => {
    if (focusAfterRevealRef.current && isExpanded) {
      focusAfterRevealRef.current = false;
      if (activeToolRef.current && !activeToolRef.current.disabled) {
        activeToolRef.current.focus();
      } else {
        menuRef.current?.querySelector<HTMLButtonElement>("[role='toolbar'] button:not(:disabled)")?.focus();
      }
    }
  }, [isExpanded]);

  useEffect(() => {
    const handleProximity = (event: PointerEvent) => {
      const element = menuRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const within =
        event.clientX >= rect.left - 24 &&
        event.clientX <= rect.right + 24 &&
        event.clientY >= rect.top - 24 &&
        event.clientY <= rect.bottom + 24;
      if (within) {
        clearCollapseTimer();
        holdsRef.current.pointer = true;
        setPointerWithin(true);
        setRevealed(true);
      } else if (holdsRef.current.pointer) {
        holdsRef.current.pointer = false;
        setPointerWithin(false);
        if (!holdsRef.current.pinned && !holdsRef.current.focus && !holdsRef.current.popover && dragRef.current === null) {
          requestCollapse();
        }
      }
    };
    document.addEventListener("pointermove", handleProximity);
    return () => document.removeEventListener("pointermove", handleProximity);
  }, [clearCollapseTimer, requestCollapse]);

  useEffect(() => {
    if (!popoverOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const element = menuRef.current;
      if (element && !element.contains(event.target as Node)) updatePopover(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      updatePopover(false);
      scenarioTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [popoverOpen, updatePopover]);

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

  useLayoutEffect(() => {
    clampPopover();
  }, [clampPopover, isExpanded, left]);

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
    const reclamp = () => {
      clampMenuLeft(left);
      clampPopover();
    };
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(reclamp) : undefined;
    observer?.observe(menu);
    window.addEventListener("resize", reclamp);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", reclamp);
    };
  }, [clampMenuLeft, clampPopover, left]);

  const handlePointerEnter = () => {
    clearCollapseTimer();
    holdsRef.current.pointer = true;
    setPointerWithin(true);
    setRevealed(true);
  };

  const handlePointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = menuRef.current?.getBoundingClientRect();
    const withinProximity = Boolean(
      rect &&
        event.clientX >= rect.left - 24 &&
        event.clientX <= rect.right + 24 &&
        event.clientY >= rect.top - 24 &&
        event.clientY <= rect.bottom + 24
    );
    holdsRef.current.pointer = withinProximity;
    setPointerWithin(withinProximity);
    if (!withinProximity && !holdsRef.current.pinned && !holdsRef.current.focus && !holdsRef.current.popover && dragRef.current === null) {
      requestCollapse();
    }
  };

  const handleFocusCapture = () => {
    clearCollapseTimer();
    holdsRef.current.focus = true;
    setFocusWithin(true);
    setRevealed(true);
  };

  const handleBlurCapture = () => {
    window.setTimeout(() => {
      const element = menuRef.current;
      const stillFocused = Boolean(element && element.contains(document.activeElement));
      holdsRef.current.focus = stillFocused;
      setFocusWithin(stillFocused);
      if (!stillFocused && !holdsRef.current.pinned && !holdsRef.current.pointer && !holdsRef.current.popover && dragRef.current === null) {
        requestCollapse();
      }
    }, 0);
  };

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    clearCollapseTimer();
    const startLeft = currentLeft();
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startLeft };
    setRevealed(true);
    if (typeof event.currentTarget.setPointerCapture === "function") {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // happy-dom and older browsers can expose capture without a live pointer.
      }
    }
  };

  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    clampMenuLeft(drag.startLeft + event.clientX - drag.startX);
  };

  const finishDrag = (event?: React.PointerEvent<HTMLButtonElement>) => {
    if (event && dragRef.current && event.pointerId !== dragRef.current.pointerId) return;
    dragRef.current = null;
    if (!holdsRef.current.pinned && !holdsRef.current.focus && !holdsRef.current.pointer && !holdsRef.current.popover) requestCollapse();
  };

  const handleDragKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
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
    if (!isExpanded || collapsedInteractionRef.current) {
      collapsedInteractionRef.current = false;
      event.preventDefault();
      revealAndFocus();
      return;
    }
    updatePopover(false);
    onModeChange(mode);
  };

  const closeScenarioAndRestoreFocus = useCallback(() => {
    updatePopover(false);
    scenarioTriggerRef.current?.focus();
  }, [updatePopover]);

  const playLabel = playState === "running" ? "Пауза игры" : playState === "paused" ? "Продолжить игру" : "Игра";

  return (
    <div
      ref={menuRef}
      className={`${styles.menu} ${left !== null ? styles.isPositioned : ""}`}
      style={left !== null ? { left } : undefined}
      data-expanded={isExpanded ? "true" : "false"}
      aria-label="Плавающее меню редактора"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
    >
      {isExpanded ? (
        <>
          <div className={styles.mainControls} role="toolbar" aria-label="Инструменты редактора">
            {MAIN_ITEMS.map((item) => {
              const disabledReason = disabledModes[item.mode];
              const disabled = disabledReason !== undefined;
              const isScenario = item.mode === "scenario";
              const label = item.mode === "play" ? playLabel : item.label;
              const icon: MvpMenuIconName = item.mode === "play" && playState === "running" ? "pause" : item.icon;
              return (
                <button
                  key={item.mode}
                  ref={(element) => {
                    if (isScenario) scenarioTriggerRef.current = element;
                    if (item.mode === activeMode) activeToolRef.current = element;
                  }}
                  type="button"
                  className={`${styles.control} ${activeMode === item.mode ? styles.isActive : ""}`}
                  aria-label={label}
                  aria-current={!isScenario && activeMode === item.mode ? "page" : undefined}
                  aria-expanded={isScenario ? popoverOpen : undefined}
                  aria-haspopup={isScenario ? "menu" : undefined}
                  aria-disabled={disabled || undefined}
                  disabled={disabled}
                  title={disabledReason ?? label}
                  onClick={(event) => {
                    if (disabled) return;
                    if (isScenario) {
                      updatePopover((open) => !open);
                      return;
                    }
                    handleModeClick(item.mode, event);
                  }}
                >
                  <MvpMenuIcon name={icon} />
                </button>
              );
            })}
          </div>
          <div className={styles.secondaryControls} aria-label="Настройки меню">
            <button
              type="button"
              className={styles.handle}
              aria-label="Переместить меню по горизонтали"
              title="Переместить меню по горизонтали"
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
              onLostPointerCapture={() => finishDrag()}
              onKeyDown={handleDragKeyDown}
            >
              <MvpMenuIcon name="drag" />
            </button>
            <button
              type="button"
              className={`${styles.control} ${styles.pinButton} ${pinned ? styles.isPinned : ""}`}
              aria-label={pinned ? "Открепить меню" : "Закрепить меню"}
              aria-pressed={pinned}
              title={pinned ? "Открепить меню" : "Закрепить меню"}
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
        </>
      ) : (
        <button
          type="button"
          className={`${styles.control} ${styles.isActive}`}
          aria-label={activeMode === "play" ? playLabel : MAIN_ITEMS.find((item) => item.mode === activeMode)?.label}
          title={disabledModes[activeMode] ?? "Нажмите, чтобы показать меню"}
          onPointerDown={() => {
            collapsedInteractionRef.current = true;
          }}
          onClick={(event) => handleModeClick(activeMode, event)}
        >
          <MvpMenuIcon
            name={activeMode === "play" && playState === "running" ? "pause" : MAIN_ITEMS.find((item) => item.mode === activeMode)?.icon ?? "editor"}
          />
        </button>
      )}

      {isExpanded && popoverOpen ? (
        <div
          ref={popoverRef}
          className={styles.popover}
          style={popoverLeft !== null ? { left: popoverLeft, transform: "none" } : undefined}
          role="menu"
          aria-label="Сценарий"
        >
          <section className={styles.group} aria-labelledby="mvp-saved-states">
            <h2 id="mvp-saved-states" className={styles.groupTitle}>
              Сохранённые состояния
            </h2>
            {savedStates.length > 0 ? (
              savedStates.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={styles.row}
                  role="menuitem"
                  onClick={() => {
                    onSelectSavedState?.(entry.id);
                    closeScenarioAndRestoreFocus();
                  }}
                >
                  {entry.label}
                </button>
              ))
            ) : (
              <p className={styles.empty}>Нет сохранённых состояний</p>
            )}
            {onSaveState ? (
              <button
                type="button"
                className={styles.saveButton}
                disabled={!canSaveState}
                title={canSaveState ? "Сохранить состояние" : "Сохранение недоступно"}
                onClick={() => {
                  onSaveState();
                  closeScenarioAndRestoreFocus();
                }}
              >
                Сохранить состояние
              </button>
            ) : null}
          </section>
          <section className={styles.group} aria-labelledby="mvp-scenario-stages">
            <h2 id="mvp-scenario-stages" className={styles.groupTitle}>
              Этапы сценария
            </h2>
            {scenarioStages.length > 0 ? (
              scenarioStages.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={styles.row}
                  role="menuitem"
                  onClick={() => {
                    onSelectScenarioStage?.(entry.id);
                    closeScenarioAndRestoreFocus();
                  }}
                >
                  {entry.label}
                </button>
              ))
            ) : (
              <p className={styles.empty}>Этапы не объявлены</p>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
