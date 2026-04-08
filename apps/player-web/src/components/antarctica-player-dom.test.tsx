import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AntarcticaPlayer } from "./antarctica-player";
import type { PlayerFacingContent, AntarcticaPlayerS1UiContent } from "@cubica/contracts-manifest";

// Mock fetch globally
global.fetch = vi.fn();

const mockMetrics = {
  score: 45,
  time: 10,
  pro: 20,
  rep: 30,
  lid: 40,
  man: 50,
  stat: 60,
  cont: 70,
  constr: 80
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
  antarctica: {
    infos: [],
    boards: [],
    teamSelections: [],
    cards: []
  }
};

const mockS1Ui: AntarcticaPlayerS1UiContent = {
  id: "antarctica.ui.web",
  version: "1.0.0",
  gameId: "antarctica",
  entryPoint: "S1",
  screen: {
    type: "screen",
    title: "Antarctica S1",
    root: {
      type: "screenComponent",
      props: {
        cssClass: "main-screen",
        backgroundImage: "/images/arctic-background.png"
      },
      children: [
        {
          type: "areaComponent",
          props: { cssClass: "game-variables-container" },
          children: [
            {
              type: "gameVariableComponent",
              id: "score",
              props: {
                caption: "Остаток дней",
                description: "Время",
                backgroundImage: "/images/top-sidebar/days-top.png",
                value: "{{game.state.public.metrics.score}}"
              }
            }
          ]
        },
        {
          type: "areaComponent",
          props: { cssClass: "main-content-area" },
          children: [
            {
              type: "areaComponent",
              props: { cssClass: "cards-container" },
              children: [
                {
                  type: "cardComponent",
                  id: "card-1",
                  props: { text: "Тестовая карточка 1" },
                  actions: { onClick: { command: "requestServer", payload: { cardId: "1" } } }
                },
                {
                  type: "cardComponent",
                  id: "card-2",
                  props: { text: "Тестовая карточка 2" },
                  actions: { onClick: { command: "requestServer", payload: { cardId: "2" } } }
                },
                {
                  type: "cardComponent",
                  id: "card-3",
                  props: { text: "Тестовая карточка 3" },
                  actions: { onClick: { command: "requestServer", payload: { cardId: "3" } } }
                },
                {
                  type: "cardComponent",
                  id: "card-4",
                  props: { text: "Тестовая карточка 4" },
                  actions: { onClick: { command: "requestServer", payload: { cardId: "4" } } }
                },
                {
                  type: "cardComponent",
                  id: "card-5",
                  props: { text: "Тестовая карточка 5" },
                  actions: { onClick: { command: "requestServer", payload: { cardId: "5" } } }
                },
                {
                  type: "cardComponent",
                  id: "card-6",
                  props: { text: "Тестовая карточка 6" },
                  actions: { onClick: { command: "requestServer", payload: { cardId: "6" } } }
                }
              ]
            },
            {
              type: "areaComponent",
              props: { cssClass: "bottom-controls-container" },
              children: [
                {
                  type: "buttonComponent",
                  id: "btn-hint",
                  props: { caption: "Подсказка" },
                  actions: { onClick: { command: "showHint", payload: {} } }
                }
              ]
            }
          ]
        }
      ]
    }
  }
};

const mockSession = {
  sessionId: "test-session-id",
  state: {
    public: {
      metrics: mockMetrics,
      timeline: {
        screenId: "S1",
        stageId: "stage_intro",
        stepIndex: 0
      }
    }
  }
};

describe("AntarcticaPlayer S1 DOM Rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/runtime/sessions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSession)
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    localStorage.clear();
  });

  it("renders the S1 manifest-driven UI when at screen S1 and hides top metrics", async () => {
    render(
      <AntarcticaPlayer 
        runtimeApiUrl="http://localhost:8080" 
        content={mockContent} 
        mockups={[]} 
        antarcticaUi={mockS1Ui} 
      />
    );

    // Wait for session to load and renderer to switch to S1
    await waitFor(() => {
      expect(screen.getByText("Остаток дней")).toBeDefined();
    });

    // Check that top metrics are HIDDEN in S1 mode
    const topMetrics = document.querySelector(".metrics");
    expect(topMetrics).toBeNull();

    // Check for main layout regions
    const renderer = document.querySelector(".s1-renderer");
    expect(renderer).toBeDefined();

    const sidebar = document.querySelector(".game-variables-container");
    expect(sidebar).toBeDefined();

    const cardsContainer = document.querySelector(".cards-container");
    expect(cardsContainer).toBeDefined();

    const bottomControls = document.querySelector(".bottom-controls-container");
    expect(bottomControls).toBeDefined();

    const rightDecor = document.querySelector(".right-illustration-container");
    expect(rightDecor).toBeDefined();
    expect(screen.getByText("Антарктическая иллюстрация")).toBeDefined();
  });

  it("passes component IDs to buttons", async () => {
    render(
      <AntarcticaPlayer 
        runtimeApiUrl="http://localhost:8080" 
        content={mockContent} 
        mockups={[]} 
        antarcticaUi={mockS1Ui} 
      />
    );

    await waitFor(() => {
      const hintButton = document.getElementById("btn-hint");
      expect(hintButton).toBeDefined();
      expect(hintButton?.textContent).toBe("Подсказка");
    });
  });

  it("resolves and displays metric bindings in the sidebar", async () => {
    render(
      <AntarcticaPlayer 
        runtimeApiUrl="http://localhost:8080" 
        content={mockContent} 
        mockups={[]} 
        antarcticaUi={mockS1Ui} 
      />
    );

    await waitFor(() => {
      // Metric value for 'score' is 45 in mockMetrics
      const scoreElements = screen.getAllByText("45");
      expect(scoreElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders 6 cards and handles click with payload", async () => {
    render(
      <AntarcticaPlayer 
        runtimeApiUrl="http://localhost:8080" 
        content={mockContent} 
        mockups={[]} 
        antarcticaUi={mockS1Ui} 
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Тестовая карточка 1")).toBeDefined();
      expect(screen.getByText("Тестовая карточка 6")).toBeDefined();
    });

    const selectButtons = screen.getAllByRole("button", { name: /Выбрать/i });
    expect(selectButtons.length).toBe(6);

    // Mock the action dispatch fetch to check payload
    (global.fetch as any).mockImplementation((url: string, options: any) => {
      if (url === "/api/runtime/actions") {
        const body = JSON.parse(options.body);
        expect(body.actionId).toBe("requestServer");
        expect(body.payload).toEqual({ cardId: "3" });
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...mockSession, state: { ...mockSession.state, public: { ...mockSession.state.public, lastAction: "requestServer" } } })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockSession) });
    });

    fireEvent.click(selectButtons[2]); // Card 3

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/runtime/actions", expect.objectContaining({
        body: expect.stringContaining('"payload":{"cardId":"3"}')
      }));
    });
  });

  it("renders bottom control buttons and handles clicks", async () => {
    render(
      <AntarcticaPlayer 
        runtimeApiUrl="http://localhost:8080" 
        content={mockContent} 
        mockups={[]} 
        antarcticaUi={mockS1Ui} 
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Подсказка")).toBeDefined();
    });

    const hintButton = screen.getByRole("button", { name: /Подсказка/i });
    
    // Mock the action dispatch fetch
    (global.fetch as any).mockImplementation((url: string, options: any) => {
      if (url === "/api/runtime/actions") {
        const body = JSON.parse(options.body);
        expect(body.actionId).toBe("showHint");
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...mockSession, state: { ...mockSession.state, public: { ...mockSession.state.public, lastAction: "showHint" } } })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockSession) });
    });

    fireEvent.click(hintButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/runtime/actions", expect.any(Object));
    });
  });

  it("falls back to action catalog when antarcticaUi is missing", async () => {
    render(
      <AntarcticaPlayer 
        runtimeApiUrl="http://localhost:8080" 
        content={{...mockContent, playerConfig: { ...mockContent.playerConfig, min: 1, max: 1 } }} 
        mockups={[]} 
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Fallback action catalog/i)).toBeDefined();
    });
  });

  it("falls back to action catalog when screenId is not S1 even if antarcticaUi is present", async () => {
    const sessionWithS2 = {
      ...mockSession,
      state: {
        ...mockSession.state,
        public: {
          ...mockSession.state.public,
          timeline: { ...mockSession.state.public.timeline, screenId: "S2" }
        }
      }
    };

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/runtime/sessions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(sessionWithS2)
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <AntarcticaPlayer 
        runtimeApiUrl="http://localhost:8080" 
        content={{...mockContent, playerConfig: { ...mockContent.playerConfig, min: 1, max: 1 } }} 
        mockups={[]} 
        antarcticaUi={mockS1Ui}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Fallback action catalog/i)).toBeDefined();
      // Should NOT render S1 renderer
      const renderer = document.querySelector(".s1-renderer");
      expect(renderer).toBeNull();
    });
  });
});
