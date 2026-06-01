import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { JournalRenderer } from "./journal-renderer";
import type { RuntimeLogEntry, MetricsSnapshot } from "@/types/game-state";
import type { FallbackMetricSpec } from "@/presenter/game-config";
import type { PlayerFacingContent } from "@cubica/contracts-manifest";

const mockFallbackMetrics: ReadonlyArray<FallbackMetricSpec> = [
  {
    id: "score",
    caption: "Остаток дней",
    aliases: ["score"],
    sidebarImage: "/images/days.png",
    topbarImage: "/images/days.png"
  },
  {
    id: "pro",
    caption: "Знания",
    aliases: ["pro"],
    sidebarImage: "/images/znania.png",
    topbarImage: "/images/znania.png"
  }
];

const mockMetrics: MetricsSnapshot = {
  score: 42,
  pro: 15
};

const mockLogEntry: RuntimeLogEntry = {
  actionId: "opening.card.1",
  entityType: "card",
  displayMode: "card",
  cardId: "1",
  at: "2026-05-16T10:00:00Z",
  frontText: "Front text of card 1",
  backText: "Back text of card 1 — result after flip",
  metricsBefore: { score: 45, pro: 12 },
  metricsAfter: { score: 42, pro: 15 },
  metricChanges: [
    { metricId: "score", delta: -3 },
    { metricId: "pro", delta: 3 }
  ]
};

const mockGameState = {
  boardCards: [
    { cardId: "1", summary: "Front text of card 1", backText: "Back text of card 1 — result after flip" }
  ]
};

const mockContent: PlayerFacingContent = {
  gameId: "antarctica",
  version: "1.0.0",
  name: "Антарктика",
  description: "Тестовое описание",
  playerConfig: { min: 1, max: 1 },
  locale: "ru-RU",
  actions: [],
  mockups: [],
  content: {
    data: {
      infos: [],
      boards: [],
      teamSelections: [],
      cards: [
        { cardId: "1", summary: "Front text of card 1", backText: "Back text of card 1 — result after flip" }
      ]
    }
  }
};

describe("JournalRenderer", () => {
  it("renders two-column card entry with front and back text", () => {
    render(
      <JournalRenderer
        metrics={mockMetrics}
        log={[mockLogEntry]}
        onJournal={vi.fn()}
        onHint={vi.fn()}
        onClose={vi.fn()}
        fallbackMetrics={mockFallbackMetrics}
        gameState={mockGameState}
        content={mockContent}
      />
    );

    // Front and back text should be present
    expect(screen.getByText("Front text of card 1")).toBeDefined();
    expect(screen.getByText("Back text of card 1 — result after flip")).toBeDefined();

    // Labels should be present
    expect(screen.getByText("Исходная карточка")).toBeDefined();
    expect(screen.getByText("Результат")).toBeDefined();

    // Two-column layout elements should exist
    expect(document.querySelector(".journal-entry-columns")).toBeDefined();
    expect(document.querySelector(".journal-entry-front")).toBeDefined();
    expect(document.querySelector(".journal-entry-back")).toBeDefined();
    expect(document.querySelector(".journal-entry-divider")).toBeDefined();
  });

  it("renders metric values with diff superscript", () => {
    render(
      <JournalRenderer
        metrics={mockMetrics}
        log={[mockLogEntry]}
        onJournal={vi.fn()}
        onHint={vi.fn()}
        onClose={vi.fn()}
        fallbackMetrics={mockFallbackMetrics}
        gameState={mockGameState}
        content={mockContent}
      />
    );

    // Current values should render
    expect(screen.getByText("42")).toBeDefined();
    expect(screen.getByText("15")).toBeDefined();

    // Diff superscripts should render (JournalVariable renders <sup> with the delta)
    expect(screen.getByText("-3")).toBeDefined();
    expect(screen.getByText("+3")).toBeDefined();

    // Metric cluster wrapper should exist
    expect(document.querySelector(".journal-entry-metrics")).toBeDefined();
  });

  it("filters out non-card log entries", () => {
    const mixedLog: Array<RuntimeLogEntry> = [
      { actionId: "opening.info.i0.advance", at: "2026-05-16T09:00:00Z" },
      mockLogEntry,
      { actionId: "opening.info.i1.advance", at: "2026-05-16T09:01:00Z" }
    ];

    render(
      <JournalRenderer
        metrics={mockMetrics}
        log={mixedLog}
        onJournal={vi.fn()}
        onHint={vi.fn()}
        onClose={vi.fn()}
        fallbackMetrics={mockFallbackMetrics}
        gameState={mockGameState}
        content={mockContent}
      />
    );

    // Only the card entry text should appear
    expect(screen.getByText("Front text of card 1")).toBeDefined();

    // Info-screen action IDs should NOT appear
    expect(screen.queryByText("opening.info.i0.advance")).toBeNull();
    expect(screen.queryByText("opening.info.i1.advance")).toBeNull();

    // Only one journal-entry-card should exist
    expect(document.querySelectorAll(".journal-entry-card").length).toBe(1);
  });

  it("shows empty state when no card entries exist", () => {
    render(
      <JournalRenderer
        metrics={mockMetrics}
        log={[{ actionId: "opening.info.i0.advance", at: "2026-05-16T09:00:00Z" }]}
        onJournal={vi.fn()}
        onHint={vi.fn()}
        onClose={vi.fn()}
        fallbackMetrics={mockFallbackMetrics}
      />
    );

    expect(screen.getByText("Пока нет записей о выбранных карточках.")).toBeDefined();
    expect(document.querySelector(".journal-empty-state")).toBeDefined();
    expect(document.querySelector(".journal-entry-card")).toBeNull();
  });
});
