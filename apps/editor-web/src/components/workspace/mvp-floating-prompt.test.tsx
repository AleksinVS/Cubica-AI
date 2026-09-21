import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MvpFloatingPrompt } from "./mvp-floating-prompt";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalOffsetParent === undefined) delete (HTMLElement.prototype as { offsetParent?: Element | null }).offsetParent;
  else Object.defineProperty(HTMLElement.prototype, "offsetParent", originalOffsetParent);
});

describe("MvpFloatingPrompt placement", () => {
  it("uses the preview parent edge when avoiding selected bounds", async () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get(this: HTMLElement) {
      return this.getAttribute("aria-label") === "Окно у края" ? parent : null;
    } });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      const width = this === parent ? 360 : 180;
      const height = this === parent ? 300 : 90;
      const x = Number.parseFloat(this.style.left) || 0;
      const y = Number.parseFloat(this.style.top) || 0;
      return { x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON: () => ({}) };
    });
    const root = createRoot(parent);
    await act(async () => root.render(<MvpFloatingPrompt point={{ x: 250, y: 120 }}
      avoid={{ x: 230, y: 110, width: 90, height: 70 }} width={180} label="Окно у края">Текст</MvpFloatingPrompt>));
    const prompt = parent.querySelector<HTMLElement>("[aria-label='Окно у края']")!;
    expect(Number.parseFloat(prompt.style.left)).toBe(42);
    expect(Number.parseFloat(prompt.style.left) + 180).toBeLessThan(230);
    await act(async () => root.unmount());
    parent.remove();
  });

  it("reports its real rect after initial placement, manual drag, and content resize", async () => {
    const callbacks = new Set<() => void>();
    class TestResizeObserver {
      constructor(callback: () => void) { callbacks.add(callback); }
      observe() {}
      disconnect() { callbacks.clear(); }
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    let promptWidth = 180;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      const x = Number.parseFloat(this.style.left) || 0;
      const y = Number.parseFloat(this.style.top) || 0;
      const width = this.getAttribute("aria-label") === "Проверка окна" ? promptWidth : 0;
      const height = this.getAttribute("aria-label") === "Проверка окна" ? 90 : 0;
      return { x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON: () => ({}) };
    });
    if (Element.prototype.setPointerCapture === undefined) {
      Object.defineProperty(Element.prototype, "setPointerCapture", { configurable: true, value: vi.fn() });
      Object.defineProperty(Element.prototype, "hasPointerCapture", { configurable: true, value: vi.fn(() => false) });
    }
    const onPlacementChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<MvpFloatingPrompt point={{ x: 300, y: 160 }} width={180}
      label="Проверка окна" onPlacementChange={onPlacementChange}><span>Текст</span></MvpFloatingPrompt>));
    const prompt = container.querySelector<HTMLElement>("[aria-label='Проверка окна']")!;
    expect(onPlacementChange).toHaveBeenLastCalledWith({ x: 308, y: 166, width: 180, height: 90 });

    await act(async () => {
      prompt.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 7, clientX: 310, clientY: 168 }));
      prompt.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, button: 0, pointerId: 7, clientX: 350, clientY: 188 }));
      prompt.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 7, clientX: 350, clientY: 188 }));
    });
    expect(onPlacementChange).toHaveBeenLastCalledWith({ x: 348, y: 186, width: 180, height: 90 });

    promptWidth = 250;
    await act(async () => { callbacks.forEach((callback) => callback()); });
    expect(onPlacementChange).toHaveBeenLastCalledWith({ x: 348, y: 186, width: 250, height: 90 });
    await act(async () => root.unmount());
    expect(onPlacementChange).toHaveBeenLastCalledWith(null);
    container.remove();
  });
});
