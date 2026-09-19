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
  act(() => {
    root?.render(element);
  });
}

function menu(): HTMLDivElement {
  const element = container?.querySelector("[aria-label='Плавающее меню редактора']");
  if (!(element instanceof HTMLDivElement)) throw new Error("menu was not rendered");
  return element;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = undefined;
  root = undefined;
});

describe("MvpFloatingMenu", () => {
  it("keeps six tools in the approved order and collapses after a delayed leave", () => {
    vi.useFakeTimers();
    render(<MvpFloatingMenu activeMode="editor" onModeChange={vi.fn()} />);

    const labels = Array.from(menu().querySelectorAll("[role='toolbar'] button"), (button) => button.getAttribute("aria-label"));
    expect(labels).toEqual(["Чат", "Редактор", "Рисование", "Игра", "Сценарий", "Правила"]);

    act(() => {
      menu().dispatchEvent(new PointerEvent("pointerover", { bubbles: true, relatedTarget: document.body, clientX: 20, clientY: 20 }));
      menu().dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body, clientX: 500, clientY: 500 }));
      vi.advanceTimersByTime(249);
    });
    expect(menu().querySelector("[role='toolbar']")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(menu().querySelector("[role='toolbar']")).toBeNull();
    expect(menu().querySelector("button[title='Нажмите, чтобы показать меню']")).not.toBeNull();
  });

  it("retains the expanded menu while focus is inside and supports pin/unpin", () => {
    vi.useFakeTimers();
    render(<MvpFloatingMenu activeMode="chat" onModeChange={vi.fn()} />);
    const dragHandle = menu().querySelector("button[aria-label='Переместить меню по горизонтали']");
    if (!(dragHandle instanceof HTMLButtonElement)) throw new Error("drag handle missing");
    const outside = document.createElement("button");
    document.body.appendChild(outside);

    act(() => {
      dragHandle.focus();
      menu().dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body, clientX: 500, clientY: 500 }));
      vi.advanceTimersByTime(300);
    });
    expect(menu().querySelector("[role='toolbar']")).not.toBeNull();

    const pin = menu().querySelector("button[aria-label='Закрепить меню']");
    if (!(pin instanceof HTMLButtonElement)) throw new Error("pin missing");
    act(() => {
      pin.click();
      pin.focus();
      vi.advanceTimersByTime(300);
    });
    expect(pin.getAttribute("aria-pressed")).toBe("true");
    expect(menu().querySelector("[role='toolbar']")).not.toBeNull();

    act(() => {
      pin.click();
      vi.advanceTimersByTime(300);
    });
    expect(menu().querySelector("[role='toolbar']")).not.toBeNull();
    act(() => {
      outside.focus();
      vi.advanceTimersByTime(0);
      vi.advanceTimersByTime(250);
    });
    expect(menu().querySelector("[role='toolbar']")).toBeNull();
    outside.remove();
  });

  it("uses real focus transitions as an expansion hold", () => {
    vi.useFakeTimers();
    render(<MvpFloatingMenu activeMode="chat" onModeChange={vi.fn()} />);
    const dragHandle = menu().querySelector("button[aria-label='Переместить меню по горизонтали']");
    if (!(dragHandle instanceof HTMLButtonElement)) throw new Error("drag handle missing");
    const outside = document.createElement("button");
    document.body.appendChild(outside);

    act(() => {
      dragHandle.focus();
      outside.focus();
      vi.advanceTimersByTime(0);
      vi.advanceTimersByTime(249);
    });
    expect(menu().querySelector("[role='toolbar']")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(menu().querySelector("[role='toolbar']")).toBeNull();
    outside.remove();
  });

  it("moves focus into the active tool when a collapsed keyboard/touch reveal occurs", () => {
    render(<MvpFloatingMenu activeMode="editor" onModeChange={vi.fn()} defaultExpanded={false} />);
    const collapsed = menu().querySelector("button[title='Нажмите, чтобы показать меню']");
    if (!(collapsed instanceof HTMLButtonElement)) throw new Error("collapsed control missing");
    act(() => {
      collapsed.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      collapsed.click();
    });
    expect(menu().querySelector("[role='toolbar']")).not.toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Редактор");
  });

  it("allows a disabled current mode to reveal the menu for touch users", () => {
    render(
      <MvpFloatingMenu
        activeMode="editor"
        onModeChange={vi.fn()}
        defaultExpanded={false}
        disabledModes={{ editor: "Редактор недоступен" }}
      />
    );
    const collapsed = menu().querySelector("button[title='Редактор недоступен']");
    if (!(collapsed instanceof HTMLButtonElement)) throw new Error("disabled collapsed control missing");
    expect(collapsed.disabled).toBe(false);
    act(() => {
      collapsed.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      collapsed.click();
    });
    expect(menu().querySelector<HTMLButtonElement>("button[aria-label='Редактор']")?.disabled).toBe(true);
  });

  it("reveals on proximity and collapses after leaving the proximity zone", () => {
    vi.useFakeTimers();
    render(<MvpFloatingMenu activeMode="editor" onModeChange={vi.fn()} defaultExpanded={false} />);
    const element = menu();
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      left: 120,
      right: 164,
      top: 16,
      bottom: 66,
      width: 44,
      height: 50,
      x: 120,
      y: 16,
      toJSON: () => ({})
    });
    act(() => {
      document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 118, clientY: 40 }));
    });
    expect(menu().querySelector("[role='toolbar']")).not.toBeNull();
    act(() => {
      document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 500, clientY: 500 }));
      vi.advanceTimersByTime(250);
    });
    expect(menu().querySelector("[role='toolbar']")).toBeNull();
  });

  it("calls the controlled mode handler and does not treat Scenario as an active mode", () => {
    const onModeChange = vi.fn();
    render(<MvpFloatingMenu activeMode="chat" onModeChange={onModeChange} />);

    const editor = menu().querySelector("button[aria-label='Редактор']");
    const scenario = menu().querySelector("button[aria-label='Сценарий']");
    if (!(editor instanceof HTMLButtonElement) || !(scenario instanceof HTMLButtonElement)) throw new Error("tools missing");
    act(() => {
      editor.click();
      scenario.click();
    });
    expect(onModeChange).toHaveBeenCalledOnce();
    expect(onModeChange).toHaveBeenCalledWith("editor");
    expect(scenario.getAttribute("aria-current")).toBeNull();
    expect(menu().querySelector("[role='menu'][aria-label='Сценарий']")).not.toBeNull();
  });

  it("renders caller-owned Scenario groups and emits selection/save callbacks", () => {
    const savedStates: readonly MvpMenuEntry[] = [{ id: "s1", label: "Начало" }];
    const scenarioStages: readonly MvpMenuEntry[] = [{ id: "stage-2", label: "Переправа" }];
    const onSelectSavedState = vi.fn();
    const onSelectScenarioStage = vi.fn();
    const onSaveState = vi.fn();
    render(
      <MvpFloatingMenu
        activeMode="editor"
        onModeChange={vi.fn()}
        savedStates={savedStates}
        scenarioStages={scenarioStages}
        onSelectSavedState={onSelectSavedState}
        onSelectScenarioStage={onSelectScenarioStage}
        onSaveState={onSaveState}
        canSaveState
      />
    );

    const trigger = menu().querySelector("button[aria-label='Сценарий']");
    if (!(trigger instanceof HTMLButtonElement)) throw new Error("scenario trigger missing");
    act(() => trigger.click());
    const saved = menu().querySelector("button[role='menuitem']");
    const stage = Array.from(menu().querySelectorAll("button[role='menuitem']")).find((button) => button.textContent === "Переправа");
    const save = menu().querySelector("button[title='Сохранить состояние']");
    if (!(saved instanceof HTMLButtonElement) || !(stage instanceof HTMLButtonElement) || !(save instanceof HTMLButtonElement)) {
      throw new Error("Scenario rows missing");
    }
    act(() => saved.click());
    expect(onSelectSavedState).toHaveBeenCalledWith("s1");
    expect(menu().querySelector("[role='menu']")).toBeNull();
    act(() => trigger.click());
    const reopenedStage = Array.from(menu().querySelectorAll("button[role='menuitem']")).find((button) => button.textContent === "Переправа");
    if (!(reopenedStage instanceof HTMLButtonElement)) throw new Error("Scenario stage missing after reopen");
    act(() => reopenedStage.click());
    expect(onSelectScenarioStage).toHaveBeenCalledWith("stage-2");
    expect(menu().querySelector("[role='menu']")).toBeNull();
    act(() => trigger.click());
    const reopenedSave = menu().querySelector("button[title='Сохранить состояние']");
    if (!(reopenedSave instanceof HTMLButtonElement)) throw new Error("save action missing after reopen");
    act(() => reopenedSave.click());
    expect(onSaveState).toHaveBeenCalledOnce();
    expect(menu().querySelector("[role='menu']")).toBeNull();
    expect(menu().querySelector("button[aria-label='Сценарий']")?.getAttribute("aria-current")).toBeNull();
  });

  it("keeps save unavailable explicit and does not invent rows", () => {
    render(<MvpFloatingMenu activeMode="editor" onModeChange={vi.fn()} onSaveState={vi.fn()} />);
    act(() => {
      menu().querySelector("button[aria-label='Сценарий']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(menu().textContent).toContain("Нет сохранённых состояний");
    expect(menu().textContent).toContain("Этапы не объявлены");
    const save = menu().querySelector("button[title='Сохранение недоступно']");
    expect(save?.hasAttribute("disabled")).toBe(true);
  });

  it("clamps keyboard movement and recenters with Home", () => {
    const viewportWidthMock = vi.spyOn(window, "innerWidth", "get").mockReturnValue(320);
    render(<MvpFloatingMenu activeMode="editor" onModeChange={vi.fn()} />);
    const element = menu();
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      left: 60,
      right: 180,
      top: 16,
      bottom: 72,
      width: 120,
      height: 56,
      x: 60,
      y: 16,
      toJSON: () => ({})
    });
    const handle = element.querySelector("button[aria-label='Переместить меню по горизонтали']");
    if (!(handle instanceof HTMLButtonElement)) throw new Error("drag handle missing");
    act(() => {
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(element.style.left).toBe("84px");
    act(() => {
      for (let index = 0; index < 20; index += 1) {
        handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      }
    });
    expect(element.style.left).toBe("192px");
    act(() => {
      for (let index = 0; index < 20; index += 1) {
        handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      }
    });
    expect(element.style.left).toBe("8px");
    viewportWidthMock.mockReturnValue(200);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(element.style.left).toBe("8px");
    act(() => {
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      for (let index = 0; index < 20; index += 1) {
        handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      }
    });
    expect(element.style.left).toBe("72px");
    act(() => {
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    });
    expect(element.style.left).toBe("");
  });

  it("closes Scenario on Escape and restores trigger focus", () => {
    render(<MvpFloatingMenu activeMode="editor" onModeChange={vi.fn()} />);
    const trigger = menu().querySelector("button[aria-label='Сценарий']");
    if (!(trigger instanceof HTMLButtonElement)) throw new Error("scenario trigger missing");
    act(() => trigger.click());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(menu().querySelector("[role='menu']")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
