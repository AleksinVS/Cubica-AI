/**
 * UI tests for the «Проверки» (Checks) sidebar panel (Phase 8.1; design-spec §3.5;
 * UX §9.6). Rendered with react-dom/client + act, matching the other workspace
 * panel tests.
 *
 * Coverage: rows are grouped by severity; clicking a row triggers navigation; the
 * «Создать вид» quick fix appears only for a deterministic row and fires its
 * callback; «Исправить агентом» is always available and fires; an empty list
 * renders the «Нет проблем» state.
 */
import React, { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChecksSidebarPanel } from "./checks-sidebar-panel.tsx";
import { groupChecksBySeverity, type WorkspaceCheckItem } from "./checks-helpers.ts";

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

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = undefined;
  root = undefined;
});

function check(overrides: Partial<WorkspaceCheckItem> & { readonly id: string; readonly message: string }): WorkspaceCheckItem {
  return {
    severity: overrides.severity ?? "warning",
    source: overrides.source ?? "projection",
    badge: overrides.badge ?? "смысл",
    pointer: overrides.pointer ?? "/root/x",
    ...overrides
  };
}

describe("ChecksSidebarPanel", () => {
  it("renders the empty state when there are no checks", () => {
    render(
      <ChecksSidebarPanel groups={[]} onNavigate={vi.fn()} onQuickFix={vi.fn()} onQuickFixAll={vi.fn()} onFixWithAgent={vi.fn()} onCollapse={vi.fn()} />
    );
    expect(container?.querySelector("[data-testid='checks-empty']")?.textContent).toContain("Нет проблем");
  });

  it("groups rows by severity in error → warning order", () => {
    const groups = groupChecksBySeverity([
      check({ id: "w", severity: "warning", message: "Нет вида для Telegram", entityLabel: "Карточка «Маршрут»" }),
      check({ id: "e", severity: "error", message: "Invalid title", source: "schema", badge: "схема" })
    ]);
    render(
      <ChecksSidebarPanel groups={groups} onNavigate={vi.fn()} onQuickFix={vi.fn()} onQuickFixAll={vi.fn()} onFixWithAgent={vi.fn()} onCollapse={vi.fn()} />
    );
    const rendered = container?.querySelectorAll("[data-testid^='checks-group-']");
    expect(rendered?.length).toBe(2);
    expect((rendered?.[0] as HTMLElement).getAttribute("data-testid")).toBe("checks-group-error");
    expect((rendered?.[1] as HTMLElement).getAttribute("data-testid")).toBe("checks-group-warning");
    expect(container?.textContent).toContain("Нет вида для Telegram");
    expect(container?.textContent).toContain("Карточка");
    expect(container?.textContent).toContain("смысл");
  });

  it("navigates when a row is clicked", () => {
    const onNavigate = vi.fn();
    const item = check({ id: "e", severity: "error", message: "Invalid title" });
    render(
      <ChecksSidebarPanel
        groups={groupChecksBySeverity([item])}
        onNavigate={onNavigate}
        onQuickFix={vi.fn()}
        onQuickFixAll={vi.fn()}
        onFixWithAgent={vi.fn()}
        onCollapse={vi.fn()}
      />
    );
    const nav = container?.querySelector("[data-testid='checks-item-navigate']") as HTMLButtonElement | null;
    act(() => {
      nav?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onNavigate).toHaveBeenCalledWith(item);
  });

  it("shows «Создать вид» only for a deterministic row and fires the quick fix", () => {
    const onQuickFix = vi.fn();
    const missingView = check({ id: "mv", code: "entity-missing-view", quickFix: "create-view", entityId: "ui:card", message: "Нет вида" });
    const plain = check({ id: "p", message: "Прочее" });
    render(
      <ChecksSidebarPanel
        groups={groupChecksBySeverity([missingView, plain])}
        onNavigate={vi.fn()}
        onQuickFix={onQuickFix}
        onQuickFixAll={vi.fn()}
        onFixWithAgent={vi.fn()}
        onCollapse={vi.fn()}
      />
    );
    const quickFixButtons = container?.querySelectorAll("[data-testid='checks-item-quickfix']");
    expect(quickFixButtons?.length).toBe(1);
    act(() => {
      (quickFixButtons?.[0] as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onQuickFix).toHaveBeenCalledWith(missingView);
  });

  it("shows the group-level «Исправить все» only with ≥2 fill-label rows and fires the bulk fix", () => {
    const onQuickFixAll = vi.fn();
    const missA = check({ id: "la", severity: "error", source: "semantic", badge: "смысл", quickFix: "fill-label", entityId: "game:a", message: "Нет _label" });
    const missB = check({ id: "lb", severity: "error", source: "semantic", badge: "смысл", quickFix: "fill-label", entityId: "game:b", message: "Нет _label" });
    render(
      <ChecksSidebarPanel
        groups={groupChecksBySeverity([missA, missB])}
        onNavigate={vi.fn()}
        onQuickFix={vi.fn()}
        onQuickFixAll={onQuickFixAll}
        onFixWithAgent={vi.fn()}
        onCollapse={vi.fn()}
      />
    );
    const fixAll = container?.querySelector("[data-testid='checks-fix-all']") as HTMLButtonElement | null;
    expect(fixAll?.textContent).toContain("Исправить все (2)");
    // Each row also carries the single «Заполнить подпись» quick fix.
    expect(container?.querySelectorAll("[data-testid='checks-item-quickfix']").length).toBe(2);
    act(() => {
      fixAll?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onQuickFixAll).toHaveBeenCalledWith([missA, missB]);
  });

  it("hides «Исправить все» when only one fill-label row is present", () => {
    const only = check({ id: "l1", severity: "error", source: "semantic", quickFix: "fill-label", entityId: "game:a", message: "Нет _label" });
    render(
      <ChecksSidebarPanel
        groups={groupChecksBySeverity([only])}
        onNavigate={vi.fn()}
        onQuickFix={vi.fn()}
        onQuickFixAll={vi.fn()}
        onFixWithAgent={vi.fn()}
        onCollapse={vi.fn()}
      />
    );
    expect(container?.querySelector("[data-testid='checks-fix-all']")).toBeNull();
    expect(container?.querySelector("[data-testid='checks-item-quickfix']")?.textContent).toContain("Заполнить подпись");
  });

  it("offers «Исправить агентом» on every row and fires it", () => {
    const onFixWithAgent = vi.fn();
    const item = check({ id: "a", message: "Этап недостижим", badge: "сценарий" });
    render(
      <ChecksSidebarPanel
        groups={groupChecksBySeverity([item])}
        onNavigate={vi.fn()}
        onQuickFix={vi.fn()}
        onQuickFixAll={vi.fn()}
        onFixWithAgent={onFixWithAgent}
        onCollapse={vi.fn()}
      />
    );
    const agentButtons = container?.querySelectorAll("[data-testid='checks-item-agent']");
    expect(agentButtons?.length).toBe(1);
    act(() => {
      (agentButtons?.[0] as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onFixWithAgent).toHaveBeenCalledWith(item);
  });
});
