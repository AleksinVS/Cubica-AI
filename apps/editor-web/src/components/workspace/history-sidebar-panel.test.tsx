/** UI contract tests for the author-facing durable history sidebar. */
import React, { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EditorVersionDetails, EditorVersionSummary } from "@/lib/editor-version-contracts";
import { HistorySidebarPanel, formatExactVersionTime, formatRelativeVersionTime } from "./history-sidebar-panel.tsx";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement | undefined;
let root: Root | undefined;

function render(element: ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(element));
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

const summary: EditorVersionSummary = {
  versionId: "opaque-v1",
  kind: "save",
  createdAt: "2026-07-11T09:00:00.000Z",
  authorName: "Автор",
  summary: "Обновлён первый сценарий",
  authorComment: "Готово для проверки",
  changedFileCount: 1
};
const details: EditorVersionDetails = {
  ...summary,
  changes: [{ kind: "updated", filePath: "games/demo/authoring/game.authoring.json", summary: "Изменён заголовок", source: "user" }]
};

function panel(overrides: Partial<React.ComponentProps<typeof HistorySidebarPanel>> = {}) {
  return <HistorySidebarPanel
    versions={[summary]}
    listState="ready"
    detailsState="idle"
    restoreState="idle"
    isDirty={false}
    onCollapse={vi.fn()}
    onRetry={vi.fn()}
    onLoadMore={vi.fn()}
    onSelectVersion={vi.fn()}
    onRestore={vi.fn()}
    {...overrides}
  />;
}

describe("HistorySidebarPanel", () => {
  it("renders loading, empty and retryable error states", () => {
    render(panel({ versions: [], listState: "loading" }));
    expect(container?.querySelector("[data-testid='history-loading']")).not.toBeNull();
    act(() => root?.render(panel({ versions: [], listState: "ready" })));
    expect(container?.querySelector("[data-testid='history-empty']")?.textContent).toContain("пока нет");
    const onRetry = vi.fn();
    act(() => root?.render(panel({ versions: [], listState: "error", error: "Сервис недоступен", onRetry })));
    expect(container?.textContent).toContain("Сервис недоступен");
    act(() => (container?.querySelector("[data-testid='history-error'] button") as HTMLButtonElement).click());
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("selects a row and loads an earlier cursor page", () => {
    const onSelectVersion = vi.fn();
    const onLoadMore = vi.fn();
    render(panel({ nextCursor: "opaque-cursor", onSelectVersion, onLoadMore }));
    act(() => (container?.querySelector("[data-testid='history-version-row']") as HTMLButtonElement).click());
    expect(onSelectVersion).toHaveBeenCalledWith("opaque-v1");
    act(() => (container?.querySelector(".history-load-more") as HTMLButtonElement).click());
    expect(onLoadMore).toHaveBeenCalledOnce();
    expect(container?.textContent).not.toContain("commit");
  });

  it("shows exact and relative time in separate accessible forms", () => {
    expect(formatRelativeVersionTime(summary.createdAt, Date.parse("2026-07-11T09:05:00.000Z"))).toContain("5 минут");
    expect(formatExactVersionTime(summary.createdAt)).not.toBe("неизвестно");
    render(panel());
    const time = container?.querySelector("time");
    expect(time?.getAttribute("datetime")).toBe(summary.createdAt);
    expect(time?.getAttribute("aria-label")).toContain("Точное время");
  });

  it("blocks restore while dirty and explains the required Save", () => {
    render(panel({ selectedVersionId: summary.versionId, selectedDetails: details, detailsState: "ready", isDirty: true }));
    expect(container?.textContent).toContain("Сначала сохраните");
    expect((container?.querySelector(".history-restore-action") as HTMLButtonElement).disabled).toBe(true);
  });

  it("requires confirmation and explains that a new version will be created", () => {
    const onRestore = vi.fn();
    render(panel({ selectedVersionId: summary.versionId, selectedDetails: details, detailsState: "ready", onRestore }));
    act(() => (container?.querySelector(".history-restore-action") as HTMLButtonElement).click());
    expect(container?.querySelector("[role='dialog']")?.textContent).toContain("новая версия");
    act(() => (container?.querySelector(".history-restore-confirm") as HTMLButtonElement).click());
    expect(onRestore).toHaveBeenCalledWith("opaque-v1");
  });

  it("focuses the restore confirmation and closes it with Escape", () => {
    render(panel({ selectedVersionId: summary.versionId, selectedDetails: details, detailsState: "ready" }));
    act(() => (container?.querySelector(".history-restore-action") as HTMLButtonElement).click());
    expect(document.activeElement).toBe(container?.querySelector(".history-restore-confirm"));
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(container?.querySelector("[role='dialog']")).toBeNull();
  });
});
