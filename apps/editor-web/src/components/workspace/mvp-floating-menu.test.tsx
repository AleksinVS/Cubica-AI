import React, { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MvpFloatingMenu, type MvpMenuEntry } from "./mvp-floating-menu.tsx";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | undefined;
let root: Root | undefined;

function render(element: ReactElement): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(element));
}

function menu(): HTMLDivElement {
  const element = container?.querySelector("[aria-label='Плавающее меню редактора']");
  if (!(element instanceof HTMLDivElement)) throw new Error("menu was not rendered");
  return element;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

describe("MvpFloatingMenu", () => {
  it("exposes the six stable toolbar slots and maps rules to the Scenario slot", () => {
    const onModeChange = vi.fn();
    render(<MvpFloatingMenu activeMode="rules" onModeChange={onModeChange} />);

    const toolbar = menu().querySelector("[role='toolbar']");
    expect(toolbar?.getAttribute("aria-label")).toBe("Панель инструментов");
    expect(Array.from(toolbar?.querySelectorAll("button") ?? [], (button) => button.getAttribute("aria-label"))).toEqual([
      "Чат", "Редактор", "Рисование", "Игра", "Сценарий", "Добавить"
    ]);
    expect(toolbar?.querySelector("button[aria-label='Правила']")).toBeNull();
    expect(toolbar?.querySelector("button[aria-label='Сценарий']")?.getAttribute("aria-current")).toBe("page");
  });

  it("keeps every slot in the collapsed DOM while only the active slot is focusable", () => {
    render(<MvpFloatingMenu activeMode="editor" onModeChange={vi.fn()} defaultExpanded={false} />);

    const toolbarButtons = Array.from(menu().querySelectorAll("[role='toolbar'] button"));
    expect(toolbarButtons).toHaveLength(6);
    expect(toolbarButtons.find((button) => button.getAttribute("aria-label") === "Редактор")?.getAttribute("tabindex")).toBe("0");
    expect(toolbarButtons.filter((button) => button.getAttribute("tabindex") === "0")).toHaveLength(1);
    expect(menu().dataset.expanded).toBe("false");
  });

  it("reveals before checking a disabled active tool in the collapsed state", () => {
    const onModeChange = vi.fn();
    render(<MvpFloatingMenu activeMode="editor" onModeChange={onModeChange} defaultExpanded={false} disabledModes={{ editor: "Редактор недоступен" }} />);
    const editor = menu().querySelector("button[aria-label='Редактор']");
    if (!(editor instanceof HTMLButtonElement)) throw new Error("editor missing");
    expect(editor.disabled).toBe(false);
    act(() => editor.click());
    expect(menu().dataset.expanded).toBe("true");
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it("distinguishes a click from a drag started on any toolbar icon", () => {
    const onModeChange = vi.fn();
    render(<MvpFloatingMenu activeMode="chat" onModeChange={onModeChange} />);
    const editor = menu().querySelector("button[aria-label='Редактор']");
    if (!(editor instanceof HTMLButtonElement)) throw new Error("editor missing");

    act(() => {
      editor.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientX: 100 }));
      editor.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: 102 }));
      editor.click();
    });
    expect(onModeChange).toHaveBeenCalledWith("editor");

    act(() => {
      const icon = editor.querySelector("svg");
      if (!(icon instanceof SVGElement)) throw new Error("editor icon missing");
      icon.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 2, clientX: 100 }));
      menu().dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 2, clientX: 180 }));
      menu().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 2, clientX: 180 }));
      editor.click();
    });
    expect(onModeChange).toHaveBeenCalledTimes(1);
  });

  it("defers pointer capture until a toolbar gesture crosses the drag threshold", () => {
    render(<MvpFloatingMenu activeMode="chat" onModeChange={vi.fn()} />);
    const element = menu();
    const editor = element.querySelector("button[aria-label='Редактор']");
    if (!(editor instanceof HTMLButtonElement)) throw new Error("editor missing");
    const setPointerCapture = vi.fn();
    const hasPointerCapture = vi.fn(() => true);
    const releasePointerCapture = vi.fn();
    Object.assign(element, { setPointerCapture, hasPointerCapture, releasePointerCapture });
    act(() => {
      editor.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 8, clientX: 100 }));
    });
    expect(setPointerCapture).not.toHaveBeenCalled();
    act(() => {
      element.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 8, clientX: 120 }));
      element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 8, clientX: 120 }));
    });
    expect(setPointerCapture).toHaveBeenCalledWith(8);
    expect(releasePointerCapture).toHaveBeenCalledWith(8);
  });

  it("starts a drag from toolbar padding only after the movement threshold", () => {
    render(<MvpFloatingMenu activeMode="editor" onModeChange={vi.fn()} />);
    const element = menu();
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({ left: 60, right: 180, top: 0, bottom: 56, width: 120, height: 56, x: 60, y: 0, toJSON: () => ({}) });
    act(() => {
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 3, clientX: 100 }));
      element.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 3, clientX: 104 }));
      element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 3, clientX: 104 }));
    });
    expect(element.style.left).toBe("");
    act(() => {
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 4, clientX: 100 }));
      element.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 4, clientX: 150 }));
      element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 4, clientX: 150 }));
    });
    expect(element.style.left).toBe("110px");
  });

  it("supports keyboard placement and keeps the pin action keyboard accessible", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(320);
    render(<MvpFloatingMenu activeMode="editor" onModeChange={vi.fn()} />);
    const element = menu();
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({ left: 60, right: 180, top: 0, bottom: 56, width: 120, height: 56, x: 60, y: 0, toJSON: () => ({}) });
    const pin = element.querySelector("button[aria-label='Закрепить меню']");
    if (!(pin instanceof HTMLButtonElement)) throw new Error("pin missing");
    act(() => {
      pin.focus();
      pin.click();
      pin.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(pin.getAttribute("aria-pressed")).toBe("true");
    expect(element.style.left).toBe("84px");
  });

  it("reveals by proximity across the stable expanded width and collapses after leaving", () => {
    vi.useFakeTimers();
    render(<MvpFloatingMenu activeMode="editor" onModeChange={vi.fn()} defaultExpanded={false} />);
    const element = menu();
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({ left: 40, right: 340, top: 0, bottom: 52, width: 300, height: 52, x: 40, y: 0, toJSON: () => ({}) });
    act(() => document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 330, clientY: 18 })));
    expect(element.dataset.expanded).toBe("true");
    act(() => {
      document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 500, clientY: 500 }));
      vi.advanceTimersByTime(320);
    });
    expect(element.dataset.expanded).toBe("false");
  });

  it("collapses after pointer leave even when proximity coordinates are unavailable", () => {
    vi.useFakeTimers();
    render(<MvpFloatingMenu activeMode="play" onModeChange={vi.fn()} />);
    const element = menu();
    act(() => {
      element.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body, clientX: 1, clientY: 1 }));
      vi.advanceTimersByTime(319);
    });
    expect(element.dataset.expanded).toBe("true");
    act(() => vi.advanceTimersByTime(1));
    expect(element.dataset.expanded).toBe("false");
  });

  it("does not keep the toolbar open from a native mouse focus", () => {
    vi.useFakeTimers();
    render(<MvpFloatingMenu activeMode="editor" onModeChange={vi.fn()} />);
    const element = menu();
    const editor = element.querySelector("button[aria-label='Редактор']");
    if (!(editor instanceof HTMLButtonElement)) throw new Error("editor missing");
    act(() => {
      editor.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 20, clientX: 100 }));
      editor.focus();
      editor.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 20, clientX: 100 }));
      document.body.focus();
      vi.advanceTimersByTime(320);
    });
    expect(element.dataset.expanded).toBe("false");
  });

  it("does not retain focus hold after a mouse selection closes a popover", () => {
    vi.useFakeTimers();
    render(<MvpFloatingMenu activeMode="editor" onModeChange={vi.fn()} />);
    const element = menu();
    const scenario = element.querySelector("button[aria-label='Сценарий']");
    if (!(scenario instanceof HTMLButtonElement)) throw new Error("scenario missing");
    act(() => {
      scenario.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 30, clientX: 100 }));
      scenario.focus();
      scenario.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 30, clientX: 100 }));
      scenario.click();
    });
    const rules = element.querySelector("button[role='menuitem']");
    if (!(rules instanceof HTMLButtonElement)) throw new Error("rules missing");
    act(() => {
      rules.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 31, clientX: 100 }));
      rules.focus();
      rules.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 31, clientX: 100 }));
      rules.click();
      element.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body, clientX: 400, clientY: 400 }));
      vi.advanceTimersByTime(320);
    });
    expect(element.dataset.expanded).toBe("false");
  });

  it("cancels a pending drag when the pointer leaves before the threshold", () => {
    vi.useFakeTimers();
    render(<MvpFloatingMenu activeMode="editor" onModeChange={vi.fn()} />);
    const element = menu();
    act(() => {
      element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 32, clientX: 100 }));
      element.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body, pointerId: 32, clientX: 102 }));
      vi.advanceTimersByTime(320);
    });
    expect(element.dataset.expanded).toBe("false");
  });

  it("opens Scenario, keeps incompatible saved rows selectable, and routes Rules to onModeChange", () => {
    const savedStates: readonly MvpMenuEntry[] = [{ id: "s1", label: "Начало", disabledReason: "Снимок требует другой версии" }];
    const onSelectSavedState = vi.fn();
    const onModeChange = vi.fn();
    render(<MvpFloatingMenu activeMode="editor" onModeChange={onModeChange} savedStates={savedStates} onSelectSavedState={onSelectSavedState} onRefreshSavedStates={vi.fn()} onSaveState={vi.fn()} canSaveState />);
    const scenario = menu().querySelector("button[aria-label='Сценарий']");
    if (!(scenario instanceof HTMLButtonElement)) throw new Error("scenario missing");
    act(() => scenario.click());
    const menuItems = Array.from(menu().querySelectorAll("[role='menuitem']"));
    expect(menuItems[0]?.textContent).toContain("Правила");
    expect(menu().querySelector("h2#mvp-scenario-rules")).toBeNull();
    const saved = Array.from(menu().querySelectorAll("button[role='menuitem']")).find((button) => button.textContent?.includes("Начало"));
    if (!(saved instanceof HTMLButtonElement)) throw new Error("saved state missing");
    expect(saved.disabled).toBe(false);
    expect(saved.title).toBe("Снимок требует другой версии");
    expect(menu().querySelector("button[aria-label='Сохранить состояние'] svg")).not.toBeNull();
    act(() => saved.click());
    expect(onSelectSavedState).toHaveBeenCalledWith("s1");
    act(() => scenario.click());
    const rules = Array.from(menu().querySelectorAll("[role='menuitem']")).find((button) => button.textContent?.includes("Правила"));
    if (!(rules instanceof HTMLButtonElement)) throw new Error("rules row missing");
    act(() => rules.click());
    expect(onModeChange).toHaveBeenCalledWith("rules");
    expect(menu().querySelector("button[title='Проверить совместимость']")).toBeNull();
  });

  it("emits Add rows, respects disabled reasons, and updates pencil settings", () => {
    const onAddEntry = vi.fn();
    const onPencilChange = vi.fn();
    const onModeChange = vi.fn();
    render(<MvpFloatingMenu activeMode="drawing" onModeChange={onModeChange} addEntries={[{ id: "page", label: "Страница" }, { id: "item", label: "Элемент", disabledReason: "Выберите страницу" }]} onAddEntry={onAddEntry} onPencilChange={onPencilChange} />);
    const add = menu().querySelector("button[aria-label='Добавить']");
    const drawing = menu().querySelector("button[aria-label='Рисование']");
    if (!(add instanceof HTMLButtonElement) || !(drawing instanceof HTMLButtonElement)) throw new Error("toolbar triggers missing");
    act(() => add.click());
    const page = menu().querySelector("button[aria-label='Добавить']")?.parentElement?.parentElement?.querySelector("button[role='menuitem']");
    if (!(page instanceof HTMLButtonElement)) throw new Error("add row missing");
    act(() => page.click());
    expect(onAddEntry).toHaveBeenCalledWith("page");
    act(() => drawing.click());
    const blue = menu().querySelector("button[aria-label='Цвет карандаша: Синий']");
    if (!(blue instanceof HTMLButtonElement)) throw new Error("color swatch missing");
    act(() => blue.click());
    expect(onPencilChange).toHaveBeenLastCalledWith({ color: "#3b82f6", width: 3 });
    expect(onModeChange).toHaveBeenCalledWith("drawing");
  });
});
