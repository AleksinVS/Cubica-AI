"use client";

import React, { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { PreviewPoint, PreviewRect } from "@cubica/editor-engine";
import type { FloatingRect } from "./mvp-floating-placement";
import styles from "./mvp-floating-prompt.module.css";

export function compactPromptWidth(text: string, minimum = 180): number {
  return Math.min(440, Math.max(minimum, 28 + Math.max(0, ...text.split("\n").map((line) => line.length)) * 7));
}

/** Coordinates are relative to the containing preview surface, just like hit-test rectangles. */
export function MvpFloatingPrompt({ point, avoid, width = 280, className = "", label, children, onPlacementChange }: {
  readonly point: PreviewPoint;
  readonly avoid?: PreviewRect;
  readonly width?: number;
  readonly className?: string;
  readonly label: string;
  readonly children: ReactNode;
  readonly onPlacementChange?: (rect: FloatingRect | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const placementCallback = useRef(onPlacementChange);
  placementCallback.current = onPlacementChange;
  const positioned = useRef(false);
  const [position, setPosition] = useState({ x: point.x + 8, y: point.y + 6 });
  const positionRef = useRef(position);
  positionRef.current = position;
  const gesture = useRef<{ id: number; x: number; y: number; left: number; top: number; text: boolean; ready: boolean; moved: boolean; timer?: ReturnType<typeof setTimeout> } | null>(null);
  const suppressClick = useRef(false);

  function reportPlacement() {
    const rect = ref.current?.getBoundingClientRect();
    if (rect !== undefined) placementCallback.current?.({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
  }

  function clamp(x: number, y: number) {
    const element = ref.current;
    const parent = element?.offsetParent?.getBoundingClientRect();
    const rect = element?.getBoundingClientRect();
    const left = parent?.left ?? 0;
    const top = parent?.top ?? 0;
    const right = Math.min(parent?.right ?? window.innerWidth, window.innerWidth);
    const bottom = Math.min(parent?.bottom ?? window.innerHeight, window.innerHeight);
    const minX = Math.max(8, 8 - left);
    const minY = Math.max(8, 8 - top);
    return {
      x: Math.max(minX, Math.min(x, right - left - (rect?.width ?? width) - 8)),
      y: Math.max(minY, Math.min(y, bottom - top - (rect?.height ?? 100) - 8))
    };
  }

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    if (!positioned.current) {
      positioned.current = true;
      const rect = element.getBoundingClientRect();
      const parent = element.offsetParent?.getBoundingClientRect();
      const right = Math.min(parent?.right ?? window.innerWidth, window.innerWidth) - (parent?.left ?? 0);
      const bottom = Math.min(parent?.bottom ?? window.innerHeight, window.innerHeight) - (parent?.top ?? 0);
      let x = point.x + 8;
      let y = point.y + 6;
      if (avoid !== undefined) {
        if (avoid.x + avoid.width + 8 + rect.width <= right - 8) x = Math.max(x, avoid.x + avoid.width + 8);
        else if (avoid.x - rect.width - 8 >= Math.max(8, 8 - (parent?.left ?? 0))) x = avoid.x - rect.width - 8;
        else if (avoid.y + avoid.height + 8 + rect.height <= bottom - 8) y = avoid.y + avoid.height + 8;
        else if (avoid.y - rect.height - 8 >= Math.max(8, 8 - (parent?.top ?? 0))) y = avoid.y - rect.height - 8;
      }
      setPosition(clamp(x, y));
    }
    const keepVisible = () => {
      setPosition((current) => {
        const next = clamp(current.x, current.y);
        return next.x === current.x && next.y === current.y ? current : next;
      });
      reportPlacement();
    };
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(keepVisible);
    observer?.observe(element);
    window.addEventListener("resize", keepVisible);
    return () => { observer?.disconnect(); window.removeEventListener("resize", keepVisible); };
  }, [width]);

  useLayoutEffect(() => { reportPlacement(); }, [position.x, position.y, width]);
  useLayoutEffect(() => () => { placementCallback.current?.(null); }, []);

  useLayoutEffect(() => () => { if (gesture.current?.timer !== undefined) clearTimeout(gesture.current.timer); }, []);

  return <div ref={ref} className={`${styles.window} ${className}`} aria-label={label}
    style={{ left: position.x, top: position.y, "--prompt-width": `${width}px` } as CSSProperties}
    onPointerDown={(event) => event.stopPropagation()}
    onPointerDownCapture={(event) => {
      if (event.button !== 0) return;
      const box = event.currentTarget.getBoundingClientRect();
      // Leave the browser's bottom-right resize grip alone.
      if (event.clientX >= box.right - 18 && event.clientY >= box.bottom - 18) return;
      const text = event.target instanceof Element && event.target.closest("textarea,input,[contenteditable=true]") !== null;
      const state = { id: event.pointerId, x: event.clientX, y: event.clientY, left: positionRef.current.x, top: positionRef.current.y, text, ready: !text || event.altKey, moved: false, timer: undefined as ReturnType<typeof setTimeout> | undefined };
      gesture.current = state;
      // A normal text drag selects. Holding briefly first moves the whole window from text too.
      if (text && !state.ready) state.timer = setTimeout(() => { state.ready = true; }, 350);
    }}
    onPointerMoveCapture={(event) => {
      const state = gesture.current;
      if (state === null || state.id !== event.pointerId) return;
      const dx = event.clientX - state.x;
      const dy = event.clientY - state.y;
      if (Math.hypot(dx, dy) < 5) return;
      if (!state.ready) {
        if (state.timer !== undefined) clearTimeout(state.timer);
        gesture.current = null;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      state.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setPosition(clamp(state.left + dx, state.top + dy));
    }}
    onPointerUpCapture={(event) => {
      const state = gesture.current;
      if (state?.timer !== undefined) clearTimeout(state.timer);
      gesture.current = null;
      if (state?.moved) {
        event.preventDefault();
        event.stopPropagation();
        suppressClick.current = true;
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={() => {
      if (gesture.current?.timer !== undefined) clearTimeout(gesture.current.timer);
      gesture.current = null;
    }}
    onClickCapture={(event) => {
      if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); }
    }}
  >{children}</div>;
}
