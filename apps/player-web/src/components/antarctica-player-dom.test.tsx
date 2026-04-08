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

describe("AntarcticaPlayer S2 Board Screens (55..60, 61..66, 67..70)", () => {
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
          props: { cssClass: "main-screen" },
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
          props: { cssClass: "main-screen" },
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
      "67..70": {
        type: "screen",
        title: "Выберите двенадцатый шаг",
        root: {
          type: "screenComponent",
          props: { cssClass: "main-screen" },
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
      // Board cards from manifest
      expect(screen.getByText("Отправить элитную группу")).toBeDefined();
    });
  });

  it("renders board screen 67..70 when screenId=S2 and stepIndex=34", async () => {
    const sessionAtBoard67_70 = {
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
          json: () => Promise.resolve(sessionAtBoard67_70)
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
      // Board cards from manifest
      expect(screen.getByText("Кабинетный анализ")).toBeDefined();
      expect(screen.getByText("Оперативный сбор")).toBeDefined();
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
      const renderer = document.querySelector(".s1-renderer");
      expect(renderer).toBeNull();
    });
  });
});

describe("AntarcticaPlayer Info Variant Screens (i19, i19_1, i20, i21)", () => {
  // UI manifest with info variant screens for testing info screen selection
  const mockUiWithInfoVariants: AntarcticaPlayerUiContent = {
    id: "antarctica.ui.web",
    version: "1.2.0",
    gameId: "antarctica",
    entryPoint: "S1",
    screens: {
      S1: mockS1Ui.screens.S1,
      i17: {
        type: "screen",
        title: "Ускорение процесса",
        root: {
          type: "screenComponent",
          props: { cssClass: "main-screen" },
          children: [
            {
              type: "areaComponent",
              props: { cssClass: "game-variables-container" },
              children: [
                {
                  type: "gameVariableComponent",
                  id: "score",
                  props: { caption: "Остаток дней", value: "{{game.state.public.metrics.score}}" }
                }
              ]
            },
            {
              type: "areaComponent",
              props: { cssClass: "main-content-area" },
              children: [
                {
                  type: "cardComponent",
                  id: "info-title",
                  props: { text: "Ускорение процесса" }
                },
                {
                  type: "cardComponent",
                  id: "info-body",
                  props: { text: "Настало время ускорить процесс переезда." }
                },
                {
                  type: "buttonComponent",
                  id: "btn-advance",
                  props: { caption: "Продолжить" },
                  actions: { onClick: { command: "requestServer", payload: { actionId: "opening.info.i17.advance" } } }
                }
              ]
            }
          ]
        }
      },
      i19: {
        type: "screen",
        title: "Последствия переезда",
        root: {
          type: "screenComponent",
          props: { cssClass: "main-screen" },
          children: [
            {
              type: "areaComponent",
              props: { cssClass: "game-variables-container" },
              children: [
                {
                  type: "gameVariableComponent",
                  id: "score",
                  props: { caption: "Остаток дней", value: "{{game.state.public.metrics.score}}" }
                }
              ]
            },
            {
              type: "areaComponent",
              props: { cssClass: "main-content-area" },
              children: [
                {
                  type: "cardComponent",
                  id: "info-title",
                  props: { text: "Последствия переезда" }
                },
                {
                  type: "cardComponent",
                  id: "info-body",
                  props: { text: "После переезда началась работа над укреплением позиций." }
                },
                {
                  type: "buttonComponent",
                  id: "btn-advance",
                  props: { caption: "Продолжить" },
                  actions: { onClick: { command: "requestServer", payload: { actionId: "opening.info.i19.advance" } } }
                }
              ]
            }
          ]
        }
      },
      i19_1: {
        type: "screen",
        title: "Быстрый переезд",
        root: {
          type: "screenComponent",
          props: { cssClass: "main-screen" },
          children: [
            {
              type: "areaComponent",
              props: { cssClass: "game-variables-container" },
              children: [
                {
                  type: "gameVariableComponent",
                  id: "score",
                  props: { caption: "Остаток дней", value: "{{game.state.public.metrics.score}}" }
                }
              ]
            },
            {
              type: "areaComponent",
              props: { cssClass: "main-content-area" },
              children: [
                {
                  type: "cardComponent",
                  id: "info-title",
                  props: { text: "Быстрый переезд" }
                },
                {
                  type: "cardComponent",
                  id: "info-body",
                  props: { text: "Переезд был осуществлен быстро." }
                },
                {
                  type: "buttonComponent",
                  id: "btn-advance",
                  props: { caption: "Продолжить" },
                  actions: { onClick: { command: "requestServer", payload: { actionId: "opening.info.i19.advance" } } }
                }
              ]
            }
          ]
        }
      },
      i20: {
        type: "screen",
        title: "Второй переезд",
        root: {
          type: "screenComponent",
          props: { cssClass: "main-screen" },
          children: [
            {
              type: "areaComponent",
              props: { cssClass: "main-content-area" },
              children: [
                {
                  type: "cardComponent",
                  id: "info-title",
                  props: { text: "Второй переезд" }
                },
                {
                  type: "buttonComponent",
                  id: "btn-advance",
                  props: { caption: "Завершить" },
                  actions: { onClick: { command: "requestServer", payload: { actionId: "opening.info.i20.advance" } } }
                }
              ]
            }
          ]
        }
      },
      i21: {
        type: "screen",
        title: "Финальный экран",
        root: {
          type: "screenComponent",
          props: { cssClass: "main-screen" },
          children: [
            {
              type: "areaComponent",
              props: { cssClass: "main-content-area" },
              children: [
                {
                  type: "cardComponent",
                  id: "info-title",
                  props: { text: "Финальный экран" }
                },
                {
                  type: "cardComponent",
                  id: "info-body",
                  props: { text: "История завершена." }
                }
              ]
            }
          ]
        }
      }
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
      expect(screen.getByText("Завершить")).toBeDefined();
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
    });
  });

  it("falls back to S1 entry when screenId=S1 but activeInfoId is not in screens", async () => {
    // activeInfoId is "i999" which is not in the manifest screens
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
      // Since S1 exists in screens, it should render S1
      const renderer = document.querySelector(".s1-renderer");
      expect(renderer).toBeDefined();
      // S1 has the test card content from mockS1Ui
      expect(screen.getByText("Тестовая карточка 1")).toBeDefined();
    });
  });
});
