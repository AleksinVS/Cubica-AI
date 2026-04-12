import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AntarcticaPlayer } from "./antarctica-player";
import type { PlayerFacingContent, AntarcticaPlayerUiContent } from "@cubica/contracts-manifest";

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

const mockS1Ui: AntarcticaPlayerUiContent = {
  id: "antarctica.ui.web",
  version: "1.0.0",
  gameId: "antarctica",
  entryPoint: "S1",
  screens: {
    S1: {
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
                  backgroundImage: "/images/left-sidebar/days.png",
                  value: "{{game.state.public.metrics.score}}"
                }
              },
              {
                type: "gameVariableComponent",
                id: "pro",
                props: {
                  caption: "Знания",
                  description: "Опыт",
                  backgroundImage: "/images/left-sidebar/znania.png",
                  value: "{{game.state.public.metrics.pro}}"
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
                    id: "btn-journal",
                    props: { caption: "Журнал ходов" },
                    actions: { onClick: { command: "showHistory", payload: {} } }
                  },
                  {
                    type: "buttonComponent",
                    id: "btn-hint",
                    props: { caption: "Подсказка" },
                    actions: { onClick: { command: "showHint", payload: {} } }
                  },
                  {
                    type: "buttonComponent",
                    id: "nav-left",
                    props: { caption: "Назад" }
                  },
                  {
                    type: "buttonComponent",
                    id: "nav-right",
                    props: { caption: "Вперед" }
                  }
                ]
              }
            ]
          }
        ]
      }
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
    expect(screen.getByRole("button", { name: /Журнал ходов/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Подсказка/i })).toBeDefined();
    expect((screen.getByRole("button", { name: /Назад/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Вперед/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector(".leftsidebar-screen")).toBeDefined();
    expect(document.querySelector(".right-illustration-container")).toBeNull();
  });

  it("keeps game-variables-container and main-content-area side-by-side in leftsidebar layout", async () => {
    // Simulate a runtime state that explicitly requests left-sidebar layout
    const sessionWithLeftSidebar = {
      ...mockSession,
      state: {
        ...mockSession.state,
        public: {
          ...mockSession.state.public,
          ui: { activeScreen: "left-sidebar" }
        }
      }
    };

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/runtime/sessions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(sessionWithLeftSidebar)
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <AntarcticaPlayer 
        runtimeApiUrl="http://localhost:8080" 
        content={mockContent} 
        mockups={[]} 
        antarcticaUi={mockS1Ui} 
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Остаток дней")).toBeDefined();
    });

    const leftsidebarScreen = document.querySelector(".leftsidebar-screen");
    expect(leftsidebarScreen).toBeDefined();

    const sidebar = leftsidebarScreen!.querySelector(".game-variables-container");
    const mainContent = leftsidebarScreen!.querySelector(".main-content-area");
    
    expect(sidebar).toBeDefined();
    expect(mainContent).toBeDefined();

    // Verify both elements are direct children of the grid container
    // and not nested inside each other (which would indicate stacking)
    const sidebarParent = sidebar!.parentElement;
    const mainContentParent = mainContent!.parentElement;
    
    expect(sidebarParent).toBe(leftsidebarScreen);
    expect(mainContentParent).toBe(leftsidebarScreen);
    
    // In a side-by-side grid layout, both should be immediate children of the grid container
    // and they should not contain each other
    expect(sidebar!.contains(mainContent!)).toBe(false);
    expect(mainContent!.contains(sidebar!)).toBe(false);
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
      const journalButton = document.getElementById("btn-journal");
      const leftArrowButton = document.getElementById("nav-left");
      const rightArrowButton = document.getElementById("nav-right");
      expect(hintButton).toBeDefined();
      expect(journalButton).toBeDefined();
      expect(leftArrowButton).toBeDefined();
      expect(rightArrowButton).toBeDefined();
      expect(hintButton?.textContent).toBe("Подсказка");
      expect(journalButton?.textContent).toBe("Журнал ходов");
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

    const metricImages = Array.from(document.querySelectorAll<HTMLElement>(".game-variable-image"));
    expect(metricImages.length).toBe(2);
    expect(
      metricImages.every(
        (node) => node.style.backgroundImage.includes("/images/left-sidebar/") || node.style.backgroundImage.includes("/images/top-sidebar/")
      )
    ).toBe(true);
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
    // Note: With mockContent (empty antarctica), boardCards is empty,
    // so the S1 action routing falls back to "requestServer"
    (global.fetch as any).mockImplementation((url: string, options: any) => {
      if (url === "/api/runtime/actions") {
        const body = JSON.parse(options.body);
        // When boardCards is empty, falls back to requestServer
        if (body.actionId === "requestServer") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ...mockSession, state: { ...mockSession.state, public: { ...mockSession.state.public, lastAction: "requestServer" } } })
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...mockSession, state: { ...mockSession.state, public: { ...mockSession.state.public, lastAction: body.actionId } } })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockSession) });
    });

    fireEvent.click(selectButtons[2]); // Card 3

    await waitFor(() => {
      // With empty boardCards, should fallback to requestServer
      expect(global.fetch).toHaveBeenCalledWith("/api/runtime/actions", expect.objectContaining({
        body: expect.stringContaining('"actionId":"requestServer"')
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
      expect(screen.getByText("Журнал ходов")).toBeDefined();
      expect(screen.getByText("Подсказка")).toBeDefined();
    });

    const journalButton = screen.getByRole("button", { name: /Журнал ходов/i });
    const hintButton = screen.getByRole("button", { name: /Подсказка/i });
    const leftArrowButton = screen.getByRole("button", { name: /Назад/i });
    const rightArrowButton = screen.getByRole("button", { name: /Вперед/i });
    
    // Mock the action dispatch fetch
    (global.fetch as any).mockImplementation((url: string, options: any) => {
      if (url === "/api/runtime/actions") {
        const body = JSON.parse(options.body);
        expect(["showHint", "showHistory"]).toContain(body.actionId);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...mockSession, state: { ...mockSession.state, public: { ...mockSession.state.public, lastAction: "showHint" } } })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockSession) });
    });
    (global.fetch as any).mockClear();

    fireEvent.click(journalButton);
    fireEvent.click(hintButton);
    fireEvent.click(leftArrowButton);
    fireEvent.click(rightArrowButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/runtime/actions", expect.any(Object));
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    expect((leftArrowButton as HTMLButtonElement).disabled).toBe(true);
    expect((rightArrowButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders the hint panel as a dedicated visual mode", async () => {
    const sessionWithHintPanel = {
      ...mockSession,
      state: {
        ...mockSession.state,
        public: {
          ...mockSession.state.public,
          ui: { activePanel: "hint" },
          timeline: { ...mockSession.state.public.timeline }
        }
      }
    };

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/runtime/sessions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(sessionWithHintPanel)
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <AntarcticaPlayer
        runtimeApiUrl="http://localhost:8080"
        content={mockContent}
        mockups={[]}
        antarcticaUi={mockS1Ui}
      />
    );

    await waitFor(() => {
      expect(document.querySelector(".antarctica-hint-screen")).toBeDefined();
      expect(document.querySelector(".hint-area")).toBeDefined();
      expect(document.querySelector(".hint-text")).toBeDefined();
      expect(screen.getByRole("button", { name: /Журнал ходов/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Подсказка/i })).toBeDefined();
    });
  });

  it("renders the journal panel as a dedicated visual mode", async () => {
    const sessionWithHistoryPanel = {
      ...mockSession,
      state: {
        ...mockSession.state,
        public: {
          ...mockSession.state.public,
          ui: { activePanel: "history" },
          log: [
            {
              actionId: "showHistory",
              capabilityFamily: "ui.panel",
              capability: "history",
              at: "2026-04-10T12:00:00Z"
            }
          ],
          timeline: { ...mockSession.state.public.timeline }
        }
      }
    };

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/runtime/sessions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(sessionWithHistoryPanel)
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <AntarcticaPlayer
        runtimeApiUrl="http://localhost:8080"
        content={mockContent}
        mockups={[]}
        antarcticaUi={mockS1Ui}
      />
    );

    await waitFor(() => {
      expect(document.querySelector(".journal-screen")).toBeDefined();
      expect(document.querySelector(".additional-background")).toBeDefined();
      expect(document.querySelector(".journal-container")).toBeDefined();
      expect(document.querySelector(".journal-cards-container")).toBeDefined();
      expect(document.querySelector(".journal-variables-container")).toBeDefined();
    });
  });

  it("filters runtime.server and requestServer entries from journal", async () => {
    const sessionWithServerLog = {
      ...mockSession,
      state: {
        ...mockSession.state,
        public: {
          ...mockSession.state.public,
          ui: { activePanel: "history" },
          log: [
            {
              actionId: "showHistory",
              capabilityFamily: "ui.panel",
              capability: "history",
              at: "2026-04-10T12:00:00Z"
            },
            {
              actionId: "requestServer",
              capabilityFamily: "runtime.server",
              capability: "request",
              at: "2026-04-10T12:01:00Z"
            },
            {
              actionId: "opening.card.3.advance",
              capabilityFamily: "runtime.server",
              capability: "advance",
              at: "2026-04-10T12:02:00Z"
            },
            {
              actionId: "opening.card.3",
              capabilityFamily: "runtime.server.request",
              capability: "select",
              at: "2026-04-10T12:03:00Z",
              kind: "opening-card-advance",
              summary: "Карточка 3"
            }
          ],
          timeline: { ...mockSession.state.public.timeline }
        }
      }
    };

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/runtime/sessions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(sessionWithServerLog)
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <AntarcticaPlayer
        runtimeApiUrl="http://localhost:8080"
        content={mockContent}
        mockups={[]}
        antarcticaUi={mockS1Ui}
      />
    );

    await waitFor(() => {
      expect(document.querySelector(".journal-screen")).toBeDefined();
    });

    // Journal should NOT show raw "Запрос" or "runtime.server" entries
    expect(screen.queryByText(/^Запрос$/)).toBeNull();
    expect(screen.queryByText(/runtime\.server/)).toBeNull();

    // Journal SHOULD show manifest-driven entries (kind=opening-card-advance)
    // that have proper user-facing summaries
    // Use queryAll to check multiple elements found (title + subtitle contain "Карточка 3")
    const card3Elements = screen.queryAllByText(/Карточка 3/);
    expect(card3Elements.length).toBeGreaterThan(0);
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
      expect(document.querySelector(".antarctica-player-shell")).toBeDefined();
      expect(document.querySelector(".panel")).toBeNull();
      expect(document.querySelector(".journal-list")).toBeNull();
      expect(document.querySelector(".mockup-list")).toBeNull();
    });
  });

  it("ensures topbar screen shell has topbar child classes when fallback renderer uses topbar mode", async () => {
    // No antarcticaUi so it falls back to AntarcticaFallbackRenderer
    // Initial state resolves to topbar layoutMode by default
    render(
      <AntarcticaPlayer
        runtimeApiUrl="http://localhost:8080"
        content={mockContent}
        mockups={[]}
      />
    );

    await waitFor(() => {
      // Should have topbar screen shell
      expect(document.querySelector(".topbar-screen-shell")).toBeDefined();
    });

    // When topbar shell is present, child areas must also have topbar classes
    const topbarShell = document.querySelector(".topbar-screen-shell");
    expect(topbarShell).not.toBeNull();

    // Verify child area classes are present
    const variablesContainer = topbarShell!.querySelector(".topbar-variables-container");
    const mainContent = topbarShell!.querySelector(".topbar-main-content");
    const cardsContainer = topbarShell!.querySelector(".topbar-cards-container");

    // At minimum one of these should exist when topbar mode is active
    // This test fails if topbar-screen-shell appears without topbar child classes
    expect(variablesContainer || mainContent || cardsContainer).toBeTruthy();
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
      expect(document.querySelector(".antarctica-fallback-renderer")).toBeDefined();
      expect(document.querySelector(".panel")).toBeNull();
      expect(document.querySelector(".journal-list")).toBeNull();
      expect(document.querySelector(".mockup-list")).toBeNull();
    });
  });
});

describe("AntarcticaPlayer S2 Board Screens (55..60, 61..66, 67..68, 69..70)", () => {
  // UI manifest with board screens for testing S2 board rendering
  const mockUiWithBoards: AntarcticaPlayerUiContent = {
    id: "antarctica.ui.web",
    version: "1.2.0",
    gameId: "antarctica",
    entryPoint: "S1",
    screens: {
      S1: mockS1Ui.screens.S1,
      "55..60": {
        type: "screen",
        title: "Выберите десятый шаг",
        root: {
          type: "screenComponent",
          props: { cssClass: "main-screen topbar-screen-shell" },
          children: [
            {
              type: "areaComponent",
              props: { cssClass: "game-variables-container topbar-variables-container" },
              children: [
                {
                  type: "gameVariableComponent",
                  id: "score",
                  props: {
                    caption: "Остаток дней",
                    value: "{{game.state.public.metrics.score}}"
                  }
                }
              ]
            },
            {
              type: "areaComponent",
              props: { cssClass: "main-content-area topbar-main-content" },
              children: [
                {
                  type: "areaComponent",
                  props: { cssClass: "board-header topbar-board-header" },
                  children: [
                    {
                      type: "areaComponent",
                      props: { cssClass: "board-title topbar-board-title" },
                      children: [
                        {
                          type: "cardComponent",
                          id: "board-title",
                          props: { text: "Теперь у вас есть еще несколько способов продолжить работу штаба." }
                        }
                      ]
                    }
                  ]
                },
                {
                  type: "areaComponent",
                  props: { cssClass: "cards-container topbar-cards-container" },
                  children: [
                    {
                      type: "cardComponent",
                      id: "card-55",
                      props: { text: "Привлечь скептиков" },
                      actions: { onClick: { command: "requestServer", payload: { actionId: "opening.card.55" } } }
                    },
                    {
                      type: "cardComponent",
                      id: "card-60",
                      props: { text: "Школа разведчика" },
                      actions: { onClick: { command: "requestServer", payload: { actionId: "opening.card.60" } } }
                    }
                  ]
                }
              ]
            }
          ]
        }
      },
      "61..66": {
        type: "screen",
        title: "Выберите одинадцатый шаг",
        root: {
          type: "screenComponent",
          props: { cssClass: "main-screen topbar-screen-shell" },
          children: [
            {
              type: "areaComponent",
              props: { cssClass: "game-variables-container topbar-variables-container" },
              children: [
                {
                  type: "gameVariableComponent",
                  id: "score",
                  props: {
                    caption: "Остаток дней",
                    value: "{{game.state.public.metrics.score}}"
                  }
                }
              ]
            },
            {
              type: "areaComponent",
              props: { cssClass: "main-content-area topbar-main-content" },
              children: [
                {
                  type: "areaComponent",
                  props: { cssClass: "board-header topbar-board-header" },
                  children: [
                    {
                      type: "cardComponent",
                      id: "board-title",
                      props: { text: "Отправка разведчиков требует особого подхода." }
                    }
                  ]
                },
                {
                  type: "areaComponent",
                  props: { cssClass: "cards-container topbar-cards-container" },
                  children: [
                    {
                      type: "cardComponent",
                      id: "card-61",
                      props: { text: "Отправить элитную группу" },
                      actions: { onClick: { command: "requestServer", payload: { actionId: "opening.card.61" } } }
                    }
                  ]
                }
              ]
            }
          ]
        }
      },
      "67..68": {
        type: "screen",
        title: "Выберите двенадцатый шаг",
        root: {
          type: "screenComponent",
          props: { cssClass: "main-screen topbar-screen-shell" },
          children: [
            {
              type: "areaComponent",
              props: { cssClass: "game-variables-container topbar-variables-container" },
              children: [
                {
                  type: "gameVariableComponent",
                  id: "score",
                  props: {
                    caption: "Остаток дней",
                    value: "{{game.state.public.metrics.score}}"
                  }
                }
              ]
            },
            {
              type: "areaComponent",
              props: { cssClass: "main-content-area topbar-main-content" },
              children: [
                {
                  type: "areaComponent",
                  props: { cssClass: "board-header topbar-board-header" },
                  children: [
                    {
                      type: "cardComponent",
                      id: "board-title",
                      props: { text: "Последняя проверка перед переездом." }
                    }
                  ]
                },
                {
                  type: "areaComponent",
                  props: { cssClass: "cards-container topbar-cards-container" },
                  children: [
                    {
                      type: "cardComponent",
                      id: "card-67",
                      props: { text: "Кабинетный анализ" },
                      actions: { onClick: { command: "requestServer", payload: { actionId: "opening.card.67" } } }
                    },
                    {
                      type: "cardComponent",
                      id: "card-68",
                      props: { text: "Оперативный сбор" },
                      actions: { onClick: { command: "requestServer", payload: { actionId: "opening.card.68" } } }
                    }
                  ]
                }
              ]
            }
          ]
        }
      },
      "69..70": {
        type: "screen",
        title: "Выберите тринадцатый шаг",
        root: {
          type: "screenComponent",
          props: { cssClass: "main-screen topbar-screen-shell" },
          children: [
            {
              type: "areaComponent",
              props: { cssClass: "game-variables-container topbar-variables-container" },
              children: [
                {
                  type: "gameVariableComponent",
                  id: "score",
                  props: {
                    caption: "Остаток дней",
                    value: "{{game.state.public.metrics.score}}"
                  }
                }
              ]
            },
            {
              type: "areaComponent",
              props: { cssClass: "main-content-area topbar-main-content" },
              children: [
                {
                  type: "areaComponent",
                  props: { cssClass: "board-header topbar-board-header" },
                  children: [
                    {
                      type: "cardComponent",
                      id: "board-title",
                      props: { text: "После переезда нужно укрепить позиции." }
                    }
                  ]
                },
                {
                  type: "areaComponent",
                  props: { cssClass: "cards-container topbar-cards-container" },
                  children: [
                    {
                      type: "cardComponent",
                      id: "card-69",
                      props: { text: "Осмотр территории" },
                      actions: { onClick: { command: "requestServer", payload: { actionId: "opening.card.69" } } }
                    },
                    {
                      type: "cardComponent",
                      id: "card-70",
                      props: { text: "Подготовка к зиме" },
                      actions: { onClick: { command: "requestServer", payload: { actionId: "opening.card.70" } } }
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    }
  };

  it("renders board screen 55..60 when screenId=S2 and stepIndex=30", async () => {
    const sessionAtBoard55_60 = {
      ...mockSession,
      state: {
        ...mockSession.state,
        public: {
          ...mockSession.state.public,
          timeline: { screenId: "S2", stepIndex: 30, stageId: "opening" }
        }
      }
    };

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/runtime/sessions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(sessionAtBoard55_60)
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <AntarcticaPlayer
        runtimeApiUrl="http://localhost:8080"
        content={mockContent}
        mockups={[]}
        antarcticaUi={mockUiWithBoards}
      />
    );

    await waitFor(() => {
      // Should render the manifest-driven board screen
      const renderer = document.querySelector(".s1-renderer");
      expect(renderer).toBeDefined();
      expect(document.querySelector(".topbar-screen-shell")).toBeDefined();
      expect(document.querySelector(".topbar-variables-container")).toBeDefined();
      expect(document.querySelector(".topbar-board-header")).toBeDefined();
      expect(document.querySelector(".topbar-cards-container")).toBeDefined();
      expect(screen.getByText("Теперь у вас есть еще несколько способов продолжить работу штаба.")).toBeDefined();
      // Board cards from manifest
      expect(screen.getByText("Привлечь скептиков")).toBeDefined();
      expect(screen.getByText("Школа разведчика")).toBeDefined();
    });
  });

  it("renders board screen 61..66 when screenId=S2 and stepIndex=32", async () => {
    const sessionAtBoard61_66 = {
      ...mockSession,
      state: {
        ...mockSession.state,
        public: {
          ...mockSession.state.public,
          timeline: { screenId: "S2", stepIndex: 32, stageId: "opening" }
        }
      }
    };

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/runtime/sessions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(sessionAtBoard61_66)
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <AntarcticaPlayer
        runtimeApiUrl="http://localhost:8080"
        content={mockContent}
        mockups={[]}
        antarcticaUi={mockUiWithBoards}
      />
    );

    await waitFor(() => {
      const renderer = document.querySelector(".s1-renderer");
      expect(renderer).toBeDefined();
      expect(document.querySelector(".topbar-screen-shell")).toBeDefined();
      expect(document.querySelector(".topbar-variables-container")).toBeDefined();
      expect(screen.getByText("Отправка разведчиков требует особого подхода.")).toBeDefined();
      // Board cards from manifest
      expect(screen.getByText("Отправить элитную группу")).toBeDefined();
    });
  });

  it("renders board screen 67..68 when screenId=S2 and stepIndex=34", async () => {
    const sessionAtBoard67_68 = {
      ...mockSession,
      state: {
        ...mockSession.state,
        public: {
          ...mockSession.state.public,
          timeline: { screenId: "S2", stepIndex: 34, stageId: "opening" }
        }
      }
    };

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/runtime/sessions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(sessionAtBoard67_68)
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <AntarcticaPlayer
        runtimeApiUrl="http://localhost:8080"
        content={mockContent}
        mockups={[]}
        antarcticaUi={mockUiWithBoards}
      />
    );

    await waitFor(() => {
      const renderer = document.querySelector(".s1-renderer");
      expect(renderer).toBeDefined();
      expect(document.querySelector(".topbar-screen-shell")).toBeDefined();
      expect(document.querySelector(".topbar-variables-container")).toBeDefined();
      expect(screen.getByText("Последняя проверка перед переездом.")).toBeDefined();
      // Board cards from manifest
      expect(screen.getByText("Кабинетный анализ")).toBeDefined();
      expect(screen.getByText("Оперативный сбор")).toBeDefined();
    });
  });

  it("renders board screen 69..70 when screenId=S2 and stepIndex=36", async () => {
    const sessionAtBoard69_70 = {
      ...mockSession,
      state: {
        ...mockSession.state,
        public: {
          ...mockSession.state.public,
          timeline: { screenId: "S2", stepIndex: 36, stageId: "opening" }
        }
      }
    };

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/runtime/sessions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(sessionAtBoard69_70)
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <AntarcticaPlayer
        runtimeApiUrl="http://localhost:8080"
        content={mockContent}
        mockups={[]}
        antarcticaUi={mockUiWithBoards}
      />
    );

    await waitFor(() => {
      const renderer = document.querySelector(".s1-renderer");
      expect(renderer).toBeDefined();
      expect(document.querySelector(".topbar-screen-shell")).toBeDefined();
      expect(document.querySelector(".topbar-variables-container")).toBeDefined();
      expect(screen.getByText("После переезда нужно укрепить позиции.")).toBeDefined();
      expect(screen.getByText("Осмотр территории")).toBeDefined();
      expect(screen.getByText("Подготовка к зиме")).toBeDefined();
    });
  });

  it("falls back to action catalog when stepIndex is not a mapped board step", async () => {
    // stepIndex 20 is not mapped to any board screen key
    const sessionAtUnknownBoard = {
      ...mockSession,
      state: {
        ...mockSession.state,
        public: {
          ...mockSession.state.public,
          timeline: { screenId: "S2", stepIndex: 20, stageId: "opening" }
        }
      }
    };

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/runtime/sessions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(sessionAtUnknownBoard)
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <AntarcticaPlayer
        runtimeApiUrl="http://localhost:8080"
        content={mockContent}
        mockups={[]}
        antarcticaUi={mockUiWithBoards}
      />
    );

    await waitFor(() => {
      // Should fall back since stepIndex 20 has no board screen mapping
      expect(screen.getByText(/Fallback action catalog/i)).toBeDefined();
      expect(document.querySelector(".antarctica-fallback-renderer")).toBeDefined();
      expect(document.querySelector(".panel")).toBeNull();
      expect(document.querySelector(".journal-list")).toBeNull();
      expect(document.querySelector(".mockup-list")).toBeNull();
    });
  });
});

describe("AntarcticaPlayer Info Variant Screens (i19, i19_1, i20, i21)", () => {
  const buildInfoMetrics = () => ([
    {
      type: "gameVariableComponent" as const,
      id: "score",
      props: {
        caption: "Остаток дней",
        backgroundImage: "/images/left-sidebar/days.png",
        value: "{{game.state.public.metrics.score}}"
      }
    },
    {
      type: "gameVariableComponent" as const,
      id: "pro",
      props: {
        caption: "Знания",
        backgroundImage: "/images/left-sidebar/znania.png",
        value: "{{game.state.public.metrics.pro}}"
      }
    }
  ]);

  const buildInfoVariantScreen = ({
    screenKey,
    title,
    body,
    actionId,
    buttonId = "btn-advance",
    buttonCaption = "Продолжить"
  }: {
    screenKey: string;
    title: string;
    body: string;
    actionId: string;
    buttonId?: string;
    buttonCaption?: string;
  }) => ({
    type: "screen" as const,
    title,
    root: {
      type: "screenComponent" as const,
      props: {
        cssClass: "main-screen info-screen-shell",
        backgroundImage: "/images/arctic-background.png"
      },
      children: [
        {
          type: "areaComponent" as const,
          props: { cssClass: "game-variables-container" },
          children: buildInfoMetrics()
        },
        {
          type: "areaComponent" as const,
          props: { cssClass: "main-content-area" },
          children: [
            {
              type: "areaComponent" as const,
              props: { cssClass: `info-content info-content--${screenKey}` },
              children: [
                {
                  type: "areaComponent" as const,
                  props: { cssClass: `info-event-card info-event-card--${screenKey}` },
                  children: [
                    {
                      type: "areaComponent" as const,
                      props: { cssClass: `info-event-illustration info-event-illustration--${screenKey}` }
                    },
                    {
                      type: "areaComponent" as const,
                      props: { cssClass: `info-event-text info-event-text--${screenKey}` },
                      children: [
                        {
                          type: "cardComponent" as const,
                          id: "info-title",
                          props: { text: title }
                        },
                        {
                          type: "cardComponent" as const,
                          id: "info-body",
                          props: { text: body }
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              type: "areaComponent" as const,
              props: { cssClass: "bottom-controls-container info-bottom-controls" },
              children: [
                {
                  type: "buttonComponent" as const,
                  id: buttonId,
                  props: { caption: buttonCaption },
                  actions: { onClick: { command: "requestServer", payload: { actionId } } }
                },
                {
                  type: "buttonComponent" as const,
                  id: "nav-left",
                  props: { caption: "Назад" }
                },
                {
                  type: "buttonComponent" as const,
                  id: "nav-right",
                  props: { caption: "Вперед" }
                },
                {
                  type: "buttonComponent" as const,
                  id: "btn-journal",
                  props: { caption: "Журнал ходов" },
                  actions: { onClick: { command: "showHistory", payload: {} } }
                }
              ]
            }
          ]
        }
      ]
    }
  });

  // UI manifest with info variant screens for testing info screen selection
  const mockUiWithInfoVariants: AntarcticaPlayerUiContent = {
    id: "antarctica.ui.web",
    version: "1.2.0",
    gameId: "antarctica",
    entryPoint: "S1",
    screens: {
      S1: mockS1Ui.screens.S1,
      i17: buildInfoVariantScreen({
        screenKey: "i17",
        title: "Ускорение процесса",
        body: "Настало время ускорить процесс переезда.",
        actionId: "opening.info.i17.advance"
      }),
      i18: buildInfoVariantScreen({
        screenKey: "i18",
        title: "Отправка разведчиков",
        body: "Разведчики готовы к отправке.",
        actionId: "opening.info.i18.advance"
      }),
      i19: buildInfoVariantScreen({
        screenKey: "i19",
        title: "Последствия переезда",
        body: "После переезда началась работа над укреплением позиций.",
        actionId: "opening.info.i19.advance"
      }),
      i19_1: buildInfoVariantScreen({
        screenKey: "i19_1",
        title: "Быстрый переезд",
        body: "Переезд был осуществлен быстро.",
        actionId: "opening.info.i19.advance"
      }),
      i20: buildInfoVariantScreen({
        screenKey: "i20",
        title: "Второй переезд",
        body: "Готовим второй переезд.",
        actionId: "opening.info.i20.advance"
      }),
      i21: buildInfoVariantScreen({
        screenKey: "i21",
        title: "Финальный экран",
        body: "История завершена.",
        actionId: "opening.info.i21.advance",
        buttonId: "btn-finish",
        buttonCaption: "Завершить"
      })
    }
  };

  it("renders i17 info screen when screenId=S1 and activeInfoId=i17", async () => {
    const sessionAtI17 = {
      ...mockSession,
      state: {
        ...mockSession.state,
        public: {
          ...mockSession.state.public,
          timeline: { screenId: "S1", stepIndex: 31, activeInfoId: "i17", stageId: "opening" }
        }
      }
    };

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/runtime/sessions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(sessionAtI17)
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <AntarcticaPlayer
        runtimeApiUrl="http://localhost:8080"
        content={mockContent}
        mockups={[]}
        antarcticaUi={mockUiWithInfoVariants}
      />
    );

    await waitFor(() => {
      const renderer = document.querySelector(".s1-renderer");
      expect(renderer).toBeDefined();
      expect(screen.getByText("Ускорение процесса")).toBeDefined();
      expect(document.querySelector(".info-event-card")).toBeDefined();
      expect(document.querySelector(".info-event-illustration")).toBeDefined();
      expect(document.querySelector(".info-event-text")).toBeDefined();
      expect(document.querySelector(".info-bottom-controls")).toBeDefined();
      expect(screen.getByRole("button", { name: /Продолжить/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Журнал ходов/i })).toBeDefined();
      expect((screen.getByRole("button", { name: /Назад/i }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole("button", { name: /Вперед/i }) as HTMLButtonElement).disabled).toBe(true);
    });

    const metricImages = Array.from(document.querySelectorAll<HTMLElement>(".game-variable-image"));
    expect(metricImages.length).toBe(2);
    expect(
      metricImages.every(
        (node) => node.style.backgroundImage.includes("/images/left-sidebar/") || node.style.backgroundImage.includes("/images/top-sidebar/")
      )
    ).toBe(true);
  });

  it("keeps the primary advance action wired for i17 info screen", async () => {
    const sessionAtI17 = {
      ...mockSession,
      state: {
        ...mockSession.state,
        public: {
          ...mockSession.state.public,
          timeline: { screenId: "S1", stepIndex: 31, activeInfoId: "i17", stageId: "opening" }
        }
      }
    };

    (global.fetch as any).mockImplementation((url: string, options: any) => {
      if (url.includes("/api/runtime/sessions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(sessionAtI17)
        });
      }

      if (url === "/api/runtime/actions") {
        const body = JSON.parse(options.body);
        expect(body.actionId).toBe("requestServer");
        expect(body.payload).toEqual({ actionId: "opening.info.i17.advance" });
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(sessionAtI17)
        });
      }

      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <AntarcticaPlayer
        runtimeApiUrl="http://localhost:8080"
        content={mockContent}
        mockups={[]}
        antarcticaUi={mockUiWithInfoVariants}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Продолжить/i })).toBeDefined();
    });

    (global.fetch as any).mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Продолжить/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/runtime/actions", expect.any(Object));
    });
  });

  it("renders i18 info screen when screenId=S1 and activeInfoId=i18", async () => {
    const sessionAtI18 = {
      ...mockSession,
      state: {
        ...mockSession.state,
        public: {
          ...mockSession.state.public,
          timeline: { screenId: "S1", stepIndex: 33, activeInfoId: "i18", stageId: "opening" }
        }
      }
    };

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/runtime/sessions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(sessionAtI18)
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <AntarcticaPlayer
        runtimeApiUrl="http://localhost:8080"
        content={mockContent}
        mockups={[]}
        antarcticaUi={mockUiWithInfoVariants}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Отправка разведчиков")).toBeDefined();
      expect(screen.getByText("Разведчики готовы к отправке.")).toBeDefined();
    });
  });

  it("renders i19 (default variant) when activeInfoId=i19", async () => {
    const sessionAtI19 = {
      ...mockSession,
      state: {
        ...mockSession.state,
        public: {
          ...mockSession.state.public,
          timeline: { screenId: "S1", stepIndex: 35, activeInfoId: "i19", stageId: "opening" }
        }
      }
    };

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/runtime/sessions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(sessionAtI19)
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <AntarcticaPlayer
        runtimeApiUrl="http://localhost:8080"
        content={mockContent}
        mockups={[]}
        antarcticaUi={mockUiWithInfoVariants}
      />
    );

    await waitFor(() => {
      const renderer = document.querySelector(".s1-renderer");
      expect(renderer).toBeDefined();
      expect(screen.getByText("Последствия переезда")).toBeDefined();
      expect(screen.getByText("После переезда началась работа над укреплением позиций.")).toBeDefined();
    });
  });

  it("renders i19_1 (fast variant) when activeInfoId=i19_1", async () => {
    const sessionAtI19_1 = {
      ...mockSession,
      state: {
        ...mockSession.state,
        public: {
          ...mockSession.state.public,
          timeline: { screenId: "S1", stepIndex: 35, activeInfoId: "i19_1", stageId: "opening" }
        }
      }
    };

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/runtime/sessions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(sessionAtI19_1)
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <AntarcticaPlayer
        runtimeApiUrl="http://localhost:8080"
        content={mockContent}
        mockups={[]}
        antarcticaUi={mockUiWithInfoVariants}
      />
    );

    await waitFor(() => {
      const renderer = document.querySelector(".s1-renderer");
      expect(renderer).toBeDefined();
      expect(screen.getByText("Быстрый переезд")).toBeDefined();
      expect(screen.getByText("Переезд был осуществлен быстро.")).toBeDefined();
    });
  });

  it("renders i20 (second relocation) when activeInfoId=i20", async () => {
    const sessionAtI20 = {
      ...mockSession,
      state: {
        ...mockSession.state,
        public: {
          ...mockSession.state.public,
          timeline: { screenId: "S1", stepIndex: 37, activeInfoId: "i20", stageId: "opening" }
        }
      }
    };

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/runtime/sessions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(sessionAtI20)
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <AntarcticaPlayer
        runtimeApiUrl="http://localhost:8080"
        content={mockContent}
        mockups={[]}
        antarcticaUi={mockUiWithInfoVariants}
      />
    );

    await waitFor(() => {
      const renderer = document.querySelector(".s1-renderer");
      expect(renderer).toBeDefined();
      expect(screen.getByText("Второй переезд")).toBeDefined();
      expect(screen.getByText("Продолжить")).toBeDefined();
    });
  });

  it("renders terminal i21 (ending) when activeInfoId=i21", async () => {
    const sessionAtI21 = {
      ...mockSession,
      state: {
        ...mockSession.state,
        public: {
          ...mockSession.state.public,
          timeline: { screenId: "S1", stepIndex: 38, activeInfoId: "i21", stageId: "opening" }
        }
      }
    };

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/runtime/sessions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(sessionAtI21)
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <AntarcticaPlayer
        runtimeApiUrl="http://localhost:8080"
        content={mockContent}
        mockups={[]}
        antarcticaUi={mockUiWithInfoVariants}
      />
    );

    await waitFor(() => {
      const renderer = document.querySelector(".s1-renderer");
      expect(renderer).toBeDefined();
      expect(screen.getByText("Финальный экран")).toBeDefined();
      expect(screen.getByText("История завершена.")).toBeDefined();
      expect(screen.getByText("Завершить")).toBeDefined();
    });
  });

  it("returns null for S1 when activeInfoId is not in UI screens, triggering fallback renderer", async () => {
    // activeInfoId is "i999" which is not in the manifest screens
    // With the fix: resolveScreenKey returns null, triggering fallback renderer
    // Since mockContent has empty antarctica, fallback renders action catalog
    const sessionAtUnknownInfo = {
      ...mockSession,
      state: {
        ...mockSession.state,
        public: {
          ...mockSession.state.public,
          timeline: { screenId: "S1", stepIndex: 35, activeInfoId: "i999", stageId: "opening" }
        }
      }
    };

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/runtime/sessions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(sessionAtUnknownInfo)
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <AntarcticaPlayer
        runtimeApiUrl="http://localhost:8080"
        content={mockContent}
        mockups={[]}
        antarcticaUi={mockUiWithInfoVariants}
      />
    );

    await waitFor(() => {
      // resolveScreenKey returns null when activeInfoId not in UI screens
      // Fallback renderer is used since screenDefinition is null
      // With empty antarctica content, fallback renders action catalog
      expect(screen.getByText(/Fallback action catalog/i)).toBeDefined();
    });
  });

  it("shows loading state when session is booting (not yet available)", async () => {
    // Mock a session that takes time to load via a slow promise
    let slowResolve: (value: any) => void;
    const slowPromise = new Promise<any>((resolve) => {
      slowResolve = resolve;
    });

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/runtime/sessions")) {
        return slowPromise;
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <AntarcticaPlayer
        runtimeApiUrl="http://localhost:8080"
        content={mockContent}
        mockups={[]}
        antarcticaUi={mockS1Ui}
      />
    );

    // While booting and session is null, should show loading state (not fallback catalog)
    await waitFor(() => {
      expect(screen.getByText(/Загрузка/i)).toBeDefined();
    });
    expect(screen.queryByText(/Fallback action catalog/i)).toBeNull();
  });

  it("does not show fallback catalog during boot even if session fetch fails", async () => {
    // Simulate session fetch that immediately rejects
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/runtime/sessions")) {
        return Promise.reject(new Error("Network error"));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <AntarcticaPlayer
        runtimeApiUrl="http://localhost:8080"
        content={mockContent}
        mockups={[]}
        antarcticaUi={mockS1Ui}
      />
    );

    // After boot completes with error, should show error state or loading
    // but NOT the fallback action catalog
    await waitFor(() => {
      expect(screen.queryByText(/Fallback action catalog/i)).toBeNull();
    });
  });
});
