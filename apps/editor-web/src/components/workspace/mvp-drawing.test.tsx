import React, { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MvpDrawing } from "./mvp-drawing.tsx";
import {
  canAppendDrawingPoint,
  canStartDrawingStroke,
  clampPopupPosition,
  getContainedImageFrame,
  isDrawingImageSizeAllowed,
  MVP_DRAWING_IMAGE_LIMITS,
  MVP_DRAWING_LIMITS,
  normalizeDrawingPoint
} from "./mvp-drawing-model.ts";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | undefined;
let root: Root | undefined;

function render(element: ReactElement): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(element));
}

function stage(): HTMLDivElement {
  const element = container?.querySelector("[aria-label='Область рисования']");
  if (!(element instanceof HTMLDivElement)) throw new Error("drawing stage was not rendered");
  return element;
}

function setSurfaceBounds(element: Element, width = 320, height = 180): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) })
  });
}

function drawOneStroke(): void {
  const svg = container?.querySelector("svg");
  if (!(svg instanceof SVGSVGElement)) throw new Error("drawing canvas was not rendered");
  setSurfaceBounds(svg);
  act(() => {
    svg.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 3, clientX: 24, clientY: 36 }));
    svg.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 3, clientX: 84, clientY: 72 }));
    svg.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 3, clientX: 84, clientY: 72 }));
  });
}

function setTextareaValue(text: string): void {
  const textarea = container?.querySelector("textarea");
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("textarea was not rendered");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(textarea, text);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function typeFocusedText(text: string): void {
  for (const character of text) {
    const target = document.activeElement;
    if (!(target instanceof HTMLElement)) throw new Error("focused typing target was not rendered");
    const event = new KeyboardEvent("keydown", { key: character, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    if (!event.defaultPrevented && target instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? start;
      setter?.call(target, `${target.value.slice(0, start)}${character}${target.value.slice(end)}`);
      target.setSelectionRange(start + character.length, start + character.length);
      target.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

describe("MvpDrawing model", () => {
  it("keeps contained image coordinates aligned after letterboxing", () => {
    const frame = getContainedImageFrame({ width: 320, height: 180 }, { width: 100, height: 200 });
    expect(frame).toEqual({ x: 115, y: 0, width: 90, height: 180 });
    expect(normalizeDrawingPoint(160, 90, { left: 0, top: 0, width: 320, height: 180 }, frame)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("clamps the prompt bubble even on the minimum viewport", () => {
    expect(clampPopupPosition({ x: 1, y: 1 }, { width: 320, height: 180 })).toEqual({ left: 42, top: 8 });
  });

  it("keeps drawing collections bounded at 512 strokes and 20,000 points", () => {
    expect(canStartDrawingStroke(MVP_DRAWING_LIMITS.maxStrokes - 1, 0)).toBe(true);
    expect(canStartDrawingStroke(MVP_DRAWING_LIMITS.maxStrokes, 0)).toBe(false);
    expect(canAppendDrawingPoint(MVP_DRAWING_LIMITS.maxPoints - 1, 1)).toBe(false);
    expect(canAppendDrawingPoint(MVP_DRAWING_LIMITS.maxPoints - 1, 0)).toBe(true);
    const boundedPoints = Array.from({ length: MVP_DRAWING_LIMITS.maxPoints }, (_, index) => ({ x: index / MVP_DRAWING_LIMITS.maxPoints, y: 0 }));
    expect(boundedPoints).toHaveLength(20_000);
  });

  it("rejects decoded images beyond the edge or pixel budget", () => {
    expect(isDrawingImageSizeAllowed({ width: MVP_DRAWING_IMAGE_LIMITS.maxEdge, height: 100 })).toBe(true);
    expect(isDrawingImageSizeAllowed({ width: MVP_DRAWING_IMAGE_LIMITS.maxEdge + 1, height: 100 })).toBe(false);
    expect(isDrawingImageSizeAllowed({ width: 4096, height: 4096 })).toBe(false);
  });
});

describe("MvpDrawing", () => {
  it("focuses the launcher and accepts the first and subsequent typed characters", () => {
    render(<MvpDrawing onSubmit={vi.fn().mockResolvedValue(undefined)} />);
    setSurfaceBounds(stage());
    drawOneStroke();

    const launcher = container?.querySelector("button[aria-label='Открыть ввод промта']");
    if (!(launcher instanceof HTMLButtonElement)) throw new Error("prompt launcher was not rendered");
    expect(document.activeElement).toBe(launcher);

    act(() => typeFocusedText("П"));

    const textarea = container?.querySelector("textarea");
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
    expect(document.activeElement).toBe(textarea);
    expect((textarea as HTMLTextAreaElement).selectionStart).toBe(1);
    expect((textarea as HTMLTextAreaElement).selectionEnd).toBe(1);

    act(() => typeFocusedText("ромт"));

    expect((textarea as HTMLTextAreaElement).value).toBe("Промт");
    expect(document.activeElement).toBe(textarea);
  });

  it("restores launcher focus after a temporary disabled state", () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MvpDrawing onSubmit={onSubmit} />);
    setSurfaceBounds(stage());
    drawOneStroke();

    const undoButton = container?.querySelector("button[aria-label='Отменить последний штрих или текст']");
    if (!(undoButton instanceof HTMLButtonElement)) throw new Error("undo button was not rendered");
    undoButton.focus();

    act(() => root?.render(<MvpDrawing onSubmit={onSubmit} disabled />));
    expect(container?.querySelector("button[aria-label='Открыть ввод промта']")).toBeNull();

    act(() => root?.render(<MvpDrawing onSubmit={onSubmit} />));
    const launcher = container?.querySelector("button[aria-label='Открыть ввод промта']");
    expect(launcher).toBeInstanceOf(HTMLButtonElement);
    expect(document.activeElement).toBe(launcher);
  });

  it("keeps Text separate from Prompt", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MvpDrawing onSubmit={onSubmit} />);
    setSurfaceBounds(stage());
    drawOneStroke();

    const launcher = container?.querySelector("button[aria-label='Открыть ввод промта']");
    expect(launcher).not.toBeNull();
    act(() => (launcher as HTMLButtonElement).click());
    act(() => setTextareaValue("Подпиши кнопку"));
    const textButton = container?.querySelector("button[aria-label='Добавить текст на рисунок']");
    expect(textButton).not.toBeNull();
    act(() => (textButton as HTMLButtonElement).click());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(container?.querySelector("text")?.textContent).toBe("Подпиши кнопку");
  });

  it("preserves the prompt when submission fails", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("Сервис недоступен"));
    const region = { x: 0.1, y: 0.2, width: 0.5, height: 0.4 };
    render(<MvpDrawing onSubmit={onSubmit} region={region} />);
    drawOneStroke();
    act(() => (container?.querySelector("button[aria-label='Открыть ввод промта']") as HTMLButtonElement).click());
    act(() => setTextareaValue("Измени цвет"));
    await act(async () => {
      (container?.querySelector("button[aria-label='Отправить промт']") as HTMLButtonElement).click();
    });
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ prompt: "Измени цвет", region }));
    expect((container?.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Измени цвет");
    expect(container?.querySelector("[role='status']")?.textContent).toContain("Сервис недоступен");
  });

  it("discards a cancelled pointer stroke", () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MvpDrawing onSubmit={onSubmit} />);
    const svg = container?.querySelector("svg");
    if (!(svg instanceof SVGSVGElement)) throw new Error("drawing canvas was not rendered");
    setSurfaceBounds(svg);
    act(() => {
      svg.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 4, clientX: 20, clientY: 20 }));
      svg.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 4, clientX: 60, clientY: 60 }));
      svg.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 4, clientX: 60, clientY: 60 }));
    });
    expect(container?.querySelectorAll("path, circle")).toHaveLength(0);
    expect(container?.querySelector("button[aria-label='Открыть ввод промта']")).toBeNull();
  });

  it("cleans an active stroke when pointer capture is lost", () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MvpDrawing onSubmit={onSubmit} />);
    const svg = container?.querySelector("svg");
    if (!(svg instanceof SVGSVGElement)) throw new Error("drawing canvas was not rendered");
    setSurfaceBounds(svg);
    act(() => {
      svg.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 5, clientX: 20, clientY: 20 }));
      svg.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 5, clientX: 60, clientY: 60 }));
      svg.dispatchEvent(new PointerEvent("lostpointercapture", { bubbles: true, pointerId: 5 }));
    });
    act(() => {
      svg.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 5, clientX: 60, clientY: 60 }));
    });
    expect(container?.querySelectorAll("path, circle")).toHaveLength(0);
  });

  it("rejects unsupported and oversized uploads locally", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MvpDrawing onSubmit={onSubmit} />);
    const input = container?.querySelector("input[type='file']");
    if (!(input instanceof HTMLInputElement)) throw new Error("upload input was not rendered");
    const unsupported = new File(["hello"], "note.svg", { type: "image/svg+xml" });
    Object.defineProperty(input, "files", { configurable: true, value: [unsupported] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(container?.querySelector("[role='status']")?.textContent).toContain("PNG, JPEG и WebP");

    const oversized = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "large.png", { type: "image/png" });
    Object.defineProperty(input, "files", { configurable: true, value: [oversized] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(container?.querySelector("[role='status']")?.textContent).toContain("8 МБ");
  });

  it("keeps the newest upload when asynchronous decoding completes out of order", async () => {
    const readers: ControlledReader[] = [];
    const images: ControlledImage[] = [];
    class ControlledReader {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(file: File) {
        this.result = `data:${file.name}`;
        readers.push(this);
      }
      finish() { this.onload?.(); }
    }
    class ControlledImage {
      naturalWidth = 100;
      naturalHeight = 100;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() { images.push(this); }
      set src(_value: string) {}
      finish() { this.onload?.(); }
    }
    vi.stubGlobal("FileReader", ControlledReader);
    vi.stubGlobal("Image", ControlledImage);
    render(<MvpDrawing onSubmit={vi.fn().mockResolvedValue(undefined)} />);
    const input = container?.querySelector("input[type='file']");
    if (!(input instanceof HTMLInputElement)) throw new Error("upload input was not rendered");
    const first = new File(["first"], "first.png", { type: "image/png" });
    const second = new File(["second"], "second.png", { type: "image/png" });
    Object.defineProperty(input, "files", { configurable: true, value: [first] });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    Object.defineProperty(input, "files", { configurable: true, value: [second] });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(readers).toHaveLength(2);

    await act(async () => {
      readers[1]?.finish();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    images[0]?.finish();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    readers[0]?.finish();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(container?.querySelector("img")?.getAttribute("src")).toBe("data:second.png");
  });

});
