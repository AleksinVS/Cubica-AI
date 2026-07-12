import { ANTARCTICA_GAME_CONFIG_DATA } from "@cubica/antarctica-player-plugin/config-data";
import { activate as activateAntarcticaPlayer } from "@cubica/antarctica-player-plugin";
import { createDefaultGameConfigData } from "@/presenter/game-config";
import { playerPluginApi } from "@/plugins/player-plugin-api";
import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GamePlayer } from "./game-player";
import type { PlayerFacingContent, GamePlayerUiContent, PlayerWebPluginBundleReference } from "@cubica/contracts-manifest";
import antarcticaGameManifest from "../../../../games/antarctica/game.manifest.json";
import antarcticaWebUiManifest from "../../../../games/antarctica/ui/web/ui.manifest.json";

// Mock fetch globally
global.fetch = vi.fn();
activateAntarcticaPlayer(playerPluginApi);

const mockMetrics = {
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
  content: {
    data: {
      rules: {
        dayLimit: 60
      },
      metrics: [
        {
          metricId: "time",
          label: "Прошло дней",
          kind: "state",
          statePath: "public.metrics.time"
        },
        {
          metricId: "remainingDays",
          label: "Осталось дней",
          kind: "computed",
          computed: {
            expression: {
              "-": [
                { var: "content.rules.dayLimit" },
                { var: "public.metrics.time" }
              ]
            }
          }
        },
        { metricId: "pro", label: "Знания", kind: "state", statePath: "public.metrics.pro" },
        { metricId: "rep", label: "Доверие", kind: "state", statePath: "public.metrics.rep" },
        { metricId: "lid", label: "Энергия", kind: "state", statePath: "public.metrics.lid" },
        { metricId: "man", label: "Контроль", kind: "state", statePath: "public.metrics.man" },
        { metricId: "stat", label: "Статус", kind: "state", statePath: "public.metrics.stat" },
        { metricId: "cont", label: "Контакт", kind: "state", statePath: "public.metrics.cont" },
        { metricId: "constr", label: "Конструктив", kind: "state", statePath: "public.metrics.constr" }
      ],
      infos: [],
      boards: [],
      teamSelections: [],
      cards: []
    }
  }
};

const generatedAntarcticaUi = antarcticaWebUiManifest as unknown as GamePlayerUiContent;
const generatedAntarcticaContent: PlayerFacingContent = {
  ...mockContent,
  content: {
    data: antarcticaGameManifest.content.data
  }
};

const aiDrivenContent: PlayerFacingContent = {
  gameId: "ai-driven-choice",
  version: "1.0.0",
  name: "AI-Driven Choice",
  description: "Minimal AI-driven fixture",
  playerConfig: { min: 1, max: 1 },
  locale: "en-US",
  executionMode: "ai-driven",
  agentRuntime: {
    agentId: "scenario-agent",
    runtimeId: "mock",
    required: true,
    failurePolicy: "pause",
    surfaceCatalog: ["cubica.choiceList"]
  },
  actions: [],
  mockups: [],
  content: {
    data: {
      choices: [
        {
          id: "continue",
          title: "Continue through agent",
          actionId: "agent.continue"
        }
      ]
    }
  }
};

const aiDrivenSession = {
  sessionId: "ai-driven-session-id",
  gameId: "ai-driven-choice",
  version: {
    sessionId: "ai-driven-session-id",
    stateVersion: 0,
    lastEventSequence: 0
  },
  state: {
    public: {
      metrics: { turns: 0 },
      timeline: { screenId: "agent", stepIndex: 0 },
      ui: {},
      log: []
    }
  }
};

const mockS1Ui: GamePlayerUiContent = {
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
                id: "remainingDays",
                props: {
                  metricId: "remainingDays",
                  backgroundImage: "/images/left-sidebar/days.png",
                  layout: "prominent"
                }
              },
              {
                type: "gameVariableComponent",
                id: "pro",
                props: {
                  metricId: "pro",
                  backgroundImage: "/images/left-sidebar/znania.png"
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
                    actions: { onClick: { command: "showPanel", payload: { panelId: "history" } } }
                  },
                  {
                    type: "buttonComponent",
                    id: "btn-hint",
                    props: { caption: "Подсказка" },
                    actions: { onClick: { command: "showPanel", payload: { panelId: "hint" } } }
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
  },
  panels: {
    history: {
      type: "panel",
      mode: "overlay",
      title: "Журнал ходов",
      root: {
        type: "screenComponent",
        props: { cssClass: "main-screen journal-screen" },
        children: [
          {
            type: "areaComponent",
            props: { cssClass: "journal-container" },
            children: [
              {
                type: "richTextComponent",
                props: { html: "<h1 class=\"heading-h1\">Журнал ходов</h1>" }
              }
            ]
          }
        ]
      }
    },
    hint: {
      type: "panel",
      mode: "overlay",
      title: "Подсказка",
      root: {
        type: "screenComponent",
        props: { cssClass: "main-screen hint-screen" },
        children: [
          {
            type: "areaComponent",
            props: { cssClass: "hint-area" }
          },
          {
            type: "richTextComponent",
            props: { html: "{{hintText}}", cssClass: "hint-text" }
          },
          {
            type: "areaComponent",
            props: { cssClass: "button-container panel-buttons" },
            children: [
              {
                type: "buttonComponent",
                id: "btn-journal",
                props: { caption: "Журнал ходов", variant: "helper" },
                actions: { onClick: { command: "showPanel", payload: { panelId: "history" } } }
              },
              {
                type: "buttonComponent",
                id: "btn-hint",
                props: { caption: "Подсказка", variant: "helper" },
                actions: { onClick: { command: "closePanel", payload: { panelId: "hint" } } }
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
  version: {
    sessionId: "test-session-id",
    stateVersion: 0,
    lastEventSequence: 0
  },
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

describe("GamePlayer S1 DOM Rendering", () => {
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

  it("shows a paused runtime status when required Agent Runtime is unavailable", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/runtime/games/ai-driven-choice/readiness")) {
        return Promise.resolve(new Response(JSON.stringify({
          ready: false,
          service: "runtime-api",
          gameId: "ai-driven-choice",
          executionMode: "ai-driven",
          dependencies: {
            agentRuntime: {
              status: "error",
              required: true,
              mode: "missing",
              runtimeId: "mock",
              failurePolicy: "pause",
              reason: "Mock Agent Runtime requires CUBICA_ENABLE_MOCK_AGENT_RUNTIME=true."
            }
          }
        }), { status: 503 }));
      }

      if (url.includes("/api/runtime/sessions")) {
        throw new Error("AI-driven session should not be created when readiness is paused.");
      }

      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });
    (global.fetch as any).mockImplementation(fetchMock);

    render(
      <GamePlayer
        config={createDefaultGameConfigData(aiDrivenContent)}
        runtimeApiUrl="http://localhost:8080"
        content={aiDrivenContent}
        mockups={[]}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Игра поставлена на паузу")).toBeDefined();
    });
    expect(screen.getByRole("button", { name: "Повторить" })).toBeDefined();
    expect(screen.queryByText(/Загрузка/i)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/runtime/sessions", expect.anything());
  });

  it("uses explicit deterministic fallback without calling Agent Turn", async () => {
    const fallbackContent: PlayerFacingContent = {
      ...aiDrivenContent,
      agentRuntime: {
        ...aiDrivenContent.agentRuntime!,
        failurePolicy: "deterministicFallback",
        deterministicFallbackActionId: "choose.option"
      }
    };
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/runtime/games/ai-driven-choice/readiness")) {
        return Promise.resolve(new Response(JSON.stringify({
          ready: false,
          service: "runtime-api",
          gameId: "ai-driven-choice",
          executionMode: "ai-driven",
          dependencies: {
            agentRuntime: {
              status: "error",
              required: true,
              mode: "missing",
              runtimeId: "mock",
              failurePolicy: "deterministicFallback",
              reason: "Agent Runtime unavailable; deterministic fallback is enabled."
            }
          }
        }), { status: 503 }));
      }

      if (url === "/api/runtime/sessions") {
        return Promise.resolve(new Response(JSON.stringify(aiDrivenSession), { status: 201 }));
      }

      if (url === "/api/runtime/agent-turns") {
        throw new Error("Agent Turn should not run while deterministic fallback is active.");
      }

      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });
    (global.fetch as any).mockImplementation(fetchMock);

    render(
      <GamePlayer
        config={createDefaultGameConfigData(fallbackContent)}
        runtimeApiUrl="http://localhost:8080"
        content={fallbackContent}
        mockups={[]}
      />
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/runtime/sessions", expect.anything());
    });
    expect(fetchMock).not.toHaveBeenCalledWith("/api/runtime/agent-turns", expect.anything());
    expect(screen.queryByText("Игра поставлена на паузу")).toBeNull();
  });

  it("renders a validated Cubica choice list returned by an Agent Turn", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/runtime/games/ai-driven-choice/readiness")) {
        return Promise.resolve(new Response(JSON.stringify({
          ready: true,
          service: "runtime-api",
          gameId: "ai-driven-choice",
          executionMode: "ai-driven",
          dependencies: {
            agentRuntime: {
              status: "ok",
              required: true,
              mode: "configured",
              runtimeId: "mock",
              failurePolicy: "pause"
            }
          }
        }), { status: 200 }));
      }

      if (url === "/api/runtime/sessions") {
        return Promise.resolve(new Response(JSON.stringify(aiDrivenSession), { status: 201 }));
      }

      if (url === "/api/runtime/agent-turns") {
        return Promise.resolve(new Response(JSON.stringify({
          sessionId: aiDrivenSession.sessionId,
          version: {
            sessionId: aiDrivenSession.sessionId,
            stateVersion: 1,
            lastEventSequence: 1
          },
          state: {
            public: {
              ...aiDrivenSession.state.public,
              log: [{ kind: "agent-turn", summary: "Agent Runtime prepared the next AI-driven turn." }]
            }
          },
          agentTurn: {
            schemaVersion: "1.0.0",
            turnId: "turn-web-test",
            agentId: "scenario-agent",
            ok: true,
            narration: "Agent Runtime prepared the next AI-driven turn.",
            surface: {
              schemaVersion: "1.0.0",
              surfaceId: "surface-web-test",
              catalogVersion: "2026-06-11",
              mode: "primary-gameplay",
              title: "Agent turn",
              root: {
                id: "root",
                kind: "cubica.choiceList",
                props: {
                  label: "Agent Runtime prepared the next AI-driven turn.",
                  choices: [{ id: "continue", label: "Continue" }]
                },
                actions: [{
                  id: "agent.continue",
                  kind: "agentTurn",
                  label: "Continue",
                  payload: { choiceId: "continue" },
                  sideEffectPolicy: "system-approved"
                }]
              }
            },
            audit: {
              source: "mock",
              createdAt: "2026-06-11T00:00:00.000Z"
            }
          }
        }), { status: 200 }));
      }

      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });
    (global.fetch as any).mockImplementation(fetchMock);

    render(
      <GamePlayer
        config={createDefaultGameConfigData(aiDrivenContent)}
        runtimeApiUrl="http://localhost:8080"
        content={aiDrivenContent}
        mockups={[]}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Agent turn")).toBeDefined();
      expect(screen.getByRole("button", { name: "Continue" })).toBeDefined();
    });
    expect(document.querySelector(".cubica-surface")).toBeDefined();
    expect(
      (document.querySelector(".game-player-root") as HTMLElement).style.getPropertyValue("--game-background-image")
    ).toBe("");
  });

  it("renders the S1 manifest-driven UI when at screen S1 and hides top metrics", async () => {
    render(
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA} 
        runtimeApiUrl="http://localhost:8080" 
        content={mockContent} 
        mockups={[]} 
        gameUi={mockS1Ui} 
      />
    );

    // Wait for session to load and renderer to switch to S1
    await waitFor(() => {
      expect(screen.getByText("Осталось дней")).toBeDefined();
    });

    expect(
      (document.querySelector(".game-player-root") as HTMLElement).style.getPropertyValue("--game-background-image")
    ).toBe('url("/images/arctic-background.png")');

    // Check that top metrics are HIDDEN in S1 mode
    const topMetrics = document.querySelector(".metrics");
    expect(topMetrics).toBeNull();

    // Check for main layout regions
    const renderer = document.querySelector(".game-renderer");
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
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA} 
        runtimeApiUrl="http://localhost:8080" 
        content={mockContent} 
        mockups={[]} 
        gameUi={mockS1Ui} 
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Осталось дней")).toBeDefined();
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
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA} 
        runtimeApiUrl="http://localhost:8080" 
        content={mockContent} 
        mockups={[]} 
        gameUi={mockS1Ui} 
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
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA} 
        runtimeApiUrl="http://localhost:8080" 
        content={mockContent} 
        mockups={[]} 
        gameUi={mockS1Ui} 
      />
    );

    await waitFor(() => {
      // remainingDays is computed from dayLimit 60 and time 10.
      const remainingDayElements = screen.getAllByText("50");
      expect(remainingDayElements.length).toBeGreaterThanOrEqual(1);
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
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA} 
        runtimeApiUrl="http://localhost:8080" 
        content={mockContent} 
        mockups={[]} 
        gameUi={mockS1Ui} 
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
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA} 
        runtimeApiUrl="http://localhost:8080" 
        content={mockContent} 
        mockups={[]} 
        gameUi={mockS1Ui} 
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
    
    (global.fetch as any).mockClear();

    fireEvent.click(journalButton);
    fireEvent.click(leftArrowButton);
    fireEvent.click(rightArrowButton);

    await waitFor(() => {
      expect(document.querySelector(".journal-screen")).not.toBeNull();
    });

    expect(global.fetch).not.toHaveBeenCalledWith("/api/runtime/actions", expect.any(Object));
    expect(hintButton).toBeDefined();
    expect((leftArrowButton as HTMLButtonElement).disabled).toBe(true);
    expect((rightArrowButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens the hint manifest panel without dispatching a runtime action", async () => {
    render(
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA}
        runtimeApiUrl="http://localhost:8080"
        content={mockContent}
        mockups={[]}
        gameUi={mockS1Ui}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Подсказка")).toBeDefined();
    });

    (global.fetch as any).mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Подсказка/i }));

    await waitFor(() => {
      expect(document.querySelector(".hint-screen")).not.toBeNull();
      expect(document.querySelector(".hint-text")).not.toBeNull();
    });

    expect(global.fetch).not.toHaveBeenCalledWith("/api/runtime/actions", expect.any(Object));
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
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA}
        runtimeApiUrl="http://localhost:8080"
        content={mockContent}
        mockups={[]}
        gameUi={mockS1Ui}
      />
    );

    await waitFor(() => {
      expect(document.querySelector(".hint-screen")).toBeDefined();
      expect(document.querySelector(".hint-area")).toBeDefined();
      expect(document.querySelector(".hint-text")).toBeDefined();
      expect(screen.getByRole("button", { name: /Журнал ходов/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /Подсказка/i })).toBeDefined();
    });
  });

  it("uses config registered by an asynchronously loaded player plugin before booting the presenter", async () => {
    const gameId = "async-plugin-game";
    const pluginSource = `
      export function activate(api) {
        api.registerGameConfigData({
          gameId: "${gameId}",
          playerId: "plugin-player",
          storageKey: "async-plugin-session-id",
          fallbackMetrics: [],
          topbarScreenKeys: [],
          metricBackgroundImages: {}
        });
        api.registerGameConfigFactory("${gameId}", function createAsyncPluginConfig(data) {
          return {
            ...data,
            topbarScreenKeys: new Set(data.topbarScreenKeys),
            resolveScreenKey() {
              return null;
            },
            resolveLayoutMode() {
              return "topbar";
            },
            resolveGameState() {
              return {
                currentInfo: {
                  id: "i0",
                  title: "Plugin info screen",
                  body: "Rendered through the async plugin resolver.",
                  advanceActionId: "intro.advance",
                  advanceLabel: "Continue"
                }
              };
            },
            createManifestActionAdapter(_content, _gameState, dispatchAction) {
              return (_command, payload) => dispatchAction(String(payload.advanceActionId ?? "noop"), payload);
            }
          };
        });
      }
    `;
    const bundle: PlayerWebPluginBundleReference = {
      pluginId: "async-plugin",
      gameId,
      apiVersion: "2.0",
      target: "player-web",
      scope: "published",
      contentHash: "d".repeat(64),
      url: `data:text/javascript;base64,${Buffer.from(pluginSource, "utf8").toString("base64")}`
    };
    const content: PlayerFacingContent = {
      gameId,
      version: "1.0.0",
      name: "Async Plugin Game",
      description: "A game that needs an async plugin resolver.",
      playerConfig: { min: 1, max: 1 },
      locale: "en-US",
      actions: [],
      mockups: [],
      content: { data: {} }
    };
    const gameUi: GamePlayerUiContent = {
      id: "async-plugin-game.ui.web",
      version: "1.0.0",
      gameId,
      entryPoint: "S1",
      screens: {
        S1: {
          type: "screen",
          title: "Wrong manifest screen",
          layoutMode: "topbar",
          root: {
            type: "screenComponent",
            props: {},
            children: [
              {
                type: "cardComponent",
                id: "wrong-card",
                props: { text: "Wrong card screen" },
              }
            ]
          }
        }
      }
    };
    const session = {
      sessionId: "async-plugin-session",
      gameId,
      version: { sessionId: "async-plugin-session", stateVersion: 1, lastEventSequence: 0 },
      state: {
        public: {
          metrics: {},
          timeline: { screenId: "S1", stepIndex: 0, activeInfoId: "i0" }
        },
        secret: {}
      }
    };

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/runtime/sessions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(session)
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <GamePlayer
        config={{
          gameId,
          playerId: "fallback-player",
          storageKey: "fallback-session-id",
          fallbackMetrics: [],
          topbarScreenKeys: ["S1"],
          metricBackgroundImages: {}
        }}
        runtimeApiUrl="http://localhost:8080"
        content={content}
        mockups={[]}
        gameUi={gameUi}
        playerPluginBundles={[bundle]}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Plugin info screen")).toBeDefined();
      expect(screen.getByText("Rendered through the async plugin resolver.")).toBeDefined();
    });
    expect(screen.queryByText("Wrong card screen")).toBeNull();
  });

  it("uses the latest info screen as the default hint when no dedicated hint exists", async () => {
    const contentWithPreviousInfo: PlayerFacingContent = {
      ...mockContent,
      description: "Описание игры не должно быть подсказкой по умолчанию",
      content: {
        data: {
          infos: [
            {
              id: "i1",
              stepIndex: 1,
              screenId: "S1",
              title: "Предыдущий инфо-экран",
              body: "Текст предыдущего инфо-экрана для подсказки.",
              advanceActionId: "opening.info.i1.advance",
              advanceLabel: "Продолжить"
            }
          ],
          boards: [
            {
              id: "board-2",
              stepIndex: 2,
              screenId: "S2",
              title: "Текущий board",
              cardIds: []
            }
          ],
          teamSelections: [],
          cards: []
        }
      }
    };
    const sessionWithHintOnBoard = {
      ...mockSession,
      state: {
        ...mockSession.state,
        public: {
          ...mockSession.state.public,
          ui: { activePanel: "hint" },
          timeline: { screenId: "S2", stageId: "stage_intro", stepIndex: 2 }
        }
      }
    };

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/runtime/sessions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(sessionWithHintOnBoard)
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA}
        runtimeApiUrl="http://localhost:8080"
        content={contentWithPreviousInfo}
        mockups={[]}
        gameUi={mockS1Ui}
      />
    );

    await waitFor(() => {
      expect(document.querySelector(".hint-screen")).toBeDefined();
      expect(screen.getByText(/Предыдущий инфо-экран/)).toBeDefined();
      expect(screen.getByText(/Текст предыдущего инфо-экрана для подсказки/)).toBeDefined();
      expect(screen.queryByText(/Описание игры не должно быть подсказкой/)).toBeNull();
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
              actionId: "opening.card.3",
              kind: "opening-card-advance",
              entityType: "card",
              displayMode: "card",
              cardId: "3",
              frontText: "Карточка 3",
              backText: "Результат Карточки 3",
              metricChanges: [
                { metricId: "pro", delta: 5 }
              ],
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
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA}
        runtimeApiUrl="http://localhost:8080"
        content={mockContent}
        mockups={[]}
        gameUi={generatedAntarcticaUi}
      />
    );

    await waitFor(() => {
      expect(document.querySelector(".journal-screen")).not.toBeNull();
      expect(document.querySelector(".journal-container")).not.toBeNull();
      expect(document.querySelector(".journal-entry-columns")).not.toBeNull();
      expect(document.querySelector(".journal-variables-container")).not.toBeNull();
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
              actionId: "opening.card.2",
              kind: "opening-card-advance",
              entityType: "card",
              displayMode: "card",
              cardId: "2",
              frontText: "Карточка 2",
              backText: "Результат Карточки 2",
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
              at: "2026-04-10T12:03:00Z",
              kind: "opening-card-advance",
              cardId: "3",
              frontText: "Карточка 3",
              backText: "Результат Карточки 3"
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
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA}
        runtimeApiUrl="http://localhost:8080"
        content={mockContent}
        mockups={[]}
        gameUi={generatedAntarcticaUi}
      />
    );

    await waitFor(() => {
      expect(document.querySelector(".journal-screen")).not.toBeNull();
    });

    // Journal should NOT show raw "Запрос" or "runtime.server" entries
    expect(screen.queryByText(/^Запрос$/)).toBeNull();
    expect(screen.queryByText(/runtime\.server/)).toBeNull();

    // Journal SHOULD show manifest-driven card entries with proper
    // user-facing summaries.
    const card3Elements = screen.queryAllByText(/Карточка 3/);
    expect(card3Elements.length).toBeGreaterThan(0);
  });

  it("renders safe-mode fallback when gameUi is missing", async () => {
    render(
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA}
        runtimeApiUrl="http://localhost:8080"
        content={{...mockContent, playerConfig: { ...mockContent.playerConfig, min: 1, max: 1 } }}
        mockups={[]}
      />
    );

    await waitFor(() => {
      // Without gameUi, SafeModeRenderer renders action cards through ManifestRenderer
      expect(document.querySelector(".game-player-root")).toBeDefined();
      expect(document.querySelector(".game-renderer")).toBeDefined();
      expect(document.querySelector(".panel")).toBeNull();
      expect(document.querySelector(".journal-list")).toBeNull();
      expect(document.querySelector(".mockup-list")).toBeNull();
    });
  });

  it("ensures topbar screen shell has topbar child classes when fallback renderer uses topbar mode", async () => {
    // No gameUi so it falls back to FallbackRenderer
    // Initial state resolves to topbar layoutMode by default
    render(
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA}
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

  it("renders safe-mode fallback when screenId is not S1 even if gameUi is present", async () => {
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
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA}
        runtimeApiUrl="http://localhost:8080"
        content={{...mockContent, playerConfig: { ...mockContent.playerConfig, min: 1, max: 1 } }}
        mockups={[]}
        gameUi={mockS1Ui}
      />
    );

    await waitFor(() => {
      // S2 not in gameUi.screens, so SafeModeRenderer renders fallback through ManifestRenderer
      expect(document.querySelector(".game-renderer")).toBeDefined();
      expect(document.querySelector(".panel")).toBeNull();
      expect(document.querySelector(".journal-list")).toBeNull();
      expect(document.querySelector(".mockup-list")).toBeNull();
    });
  });
});

describe("GamePlayer S2 Board Screens (55..60, 61..66, 67..68, 69..70)", () => {
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
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA}
        runtimeApiUrl="http://localhost:8080"
        content={generatedAntarcticaContent}
        mockups={[]}
        gameUi={generatedAntarcticaUi}
      />
    );

    await waitFor(() => {
      // Should render the manifest-driven board screen
      const renderer = document.querySelector(".game-renderer");
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
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA}
        runtimeApiUrl="http://localhost:8080"
        content={generatedAntarcticaContent}
        mockups={[]}
        gameUi={generatedAntarcticaUi}
      />
    );

    await waitFor(() => {
      const renderer = document.querySelector(".game-renderer");
      expect(renderer).toBeDefined();
      expect(document.querySelector(".topbar-screen-shell")).toBeDefined();
      expect(document.querySelector(".topbar-variables-container")).toBeDefined();
      expect(screen.getByText("Отправка разведчиков требует особого подхода.")).toBeDefined();
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
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA}
        runtimeApiUrl="http://localhost:8080"
        content={generatedAntarcticaContent}
        mockups={[]}
        gameUi={generatedAntarcticaUi}
      />
    );

    await waitFor(() => {
      const renderer = document.querySelector(".game-renderer");
      expect(renderer).toBeDefined();
      expect(document.querySelector(".topbar-screen-shell")).toBeDefined();
      expect(document.querySelector(".topbar-variables-container")).toBeDefined();
      expect(screen.getByText("Последняя проверка перед переездом: нужно понять, достаточно ли надежен новый айсберг.")).toBeDefined();
      // Board cards from manifest (merged 67..70 screen)
      expect(screen.getByText("Кабинетный анализ")).toBeDefined();
      expect(screen.getByText("Отправить экспертную группу")).toBeDefined();
    });
  });

  it("renders board screen 67..70 when screenId=S2 and stepIndex=36", async () => {
    const sessionAtBoard67_70_step36 = {
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
          json: () => Promise.resolve(sessionAtBoard67_70_step36)
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA}
        runtimeApiUrl="http://localhost:8080"
        content={generatedAntarcticaContent}
        mockups={[]}
        gameUi={generatedAntarcticaUi}
      />
    );

    await waitFor(() => {
      const renderer = document.querySelector(".game-renderer");
      expect(renderer).toBeDefined();
      expect(document.querySelector(".topbar-screen-shell")).toBeDefined();
      expect(document.querySelector(".topbar-variables-container")).toBeDefined();
      // Both step 34 and 36 resolve to the same 67..70 screen
      expect(screen.getByText("После переезда нужно укрепить позиции и решить, готовиться ли ко второму переходу.")).toBeDefined();
      expect(screen.getByText("Готовить второй переезд")).toBeDefined();
      expect(screen.getByText("Взять паузу")).toBeDefined();
    });
  });

  it("renders safe-mode fallback when stepIndex is not a mapped board step", async () => {
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
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA}
        runtimeApiUrl="http://localhost:8080"
        content={generatedAntarcticaContent}
        mockups={[]}
        gameUi={generatedAntarcticaUi}
      />
    );

    await waitFor(() => {
      // Should fall back to SafeModeRenderer since stepIndex 20 has no board screen mapping
      expect(document.querySelector(".game-renderer")).toBeDefined();
      expect(document.querySelector(".panel")).toBeNull();
      expect(document.querySelector(".journal-list")).toBeNull();
      expect(document.querySelector(".mockup-list")).toBeNull();
    });
  });
});

describe("GamePlayer Info Variant Screens (i19, i19_1, i20, i21)", () => {
  const buildInfoMetrics = () => ([
    {
      type: "gameVariableComponent" as const,
      id: "remainingDays",
      props: {
        backgroundImage: "/images/left-sidebar/days.png",
        metricId: "remainingDays"
      }
    },
    {
      type: "gameVariableComponent" as const,
      id: "pro",
      props: {
        backgroundImage: "/images/left-sidebar/znania.png",
        metricId: "pro"
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
                  actions: { onClick: { command: "showPanel", payload: { panelId: "history" } } }
                }
              ]
            }
          ]
        }
      ]
    }
  });

  // UI manifest with info variant screens for testing info screen selection
  const mockUiWithInfoVariants: GamePlayerUiContent = {
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
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA}
        runtimeApiUrl="http://localhost:8080"
        content={generatedAntarcticaContent}
        mockups={[]}
        gameUi={generatedAntarcticaUi}
      />
    );

    await waitFor(() => {
      const renderer = document.querySelector(".game-renderer");
      expect(renderer).toBeDefined();
      expect(screen.getByText("Ускорение процесса")).toBeDefined();
      expect(document.querySelector(".info-event-card")).toBeDefined();
      expect(document.querySelector(".info-event-illustration")).toBeDefined();
      expect(document.querySelector(".info-event-text")).toBeDefined();
      expect(document.querySelector(".info-bottom-controls")).toBeDefined();
      expect(screen.queryByRole("button", { name: /Продолжить/i })).toBeNull();
      expect(screen.getByRole("button", { name: /Журнал ходов/i })).toBeDefined();
      expect((screen.getByRole("button", { name: /Назад/i }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole("button", { name: /Вперед/i }) as HTMLButtonElement).disabled).toBe(false);
    });

    const metricImages = Array.from(document.querySelectorAll<HTMLElement>(".game-variable-image"));
    expect(metricImages.length).toBe(8);
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
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA}
        runtimeApiUrl="http://localhost:8080"
        content={generatedAntarcticaContent}
        mockups={[]}
        gameUi={generatedAntarcticaUi}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Вперед/i })).toBeDefined();
    });

    (global.fetch as any).mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Вперед/i }));

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
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA}
        runtimeApiUrl="http://localhost:8080"
        content={generatedAntarcticaContent}
        mockups={[]}
        gameUi={generatedAntarcticaUi}
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
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA}
        runtimeApiUrl="http://localhost:8080"
        content={generatedAntarcticaContent}
        mockups={[]}
        gameUi={generatedAntarcticaUi}
      />
    );

    await waitFor(() => {
      const renderer = document.querySelector(".game-renderer");
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
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA}
        runtimeApiUrl="http://localhost:8080"
        content={generatedAntarcticaContent}
        mockups={[]}
        gameUi={generatedAntarcticaUi}
      />
    );

    await waitFor(() => {
      const renderer = document.querySelector(".game-renderer");
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
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA}
        runtimeApiUrl="http://localhost:8080"
        content={generatedAntarcticaContent}
        mockups={[]}
        gameUi={generatedAntarcticaUi}
      />
    );

    await waitFor(() => {
      const renderer = document.querySelector(".game-renderer");
      expect(renderer).toBeDefined();
      expect(screen.getByText("Второй переезд")).toBeDefined();
      expect(screen.queryByText("Продолжить")).toBeNull();
      expect((screen.getByRole("button", { name: /Вперед/i }) as HTMLButtonElement).disabled).toBe(false);
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
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA}
        runtimeApiUrl="http://localhost:8080"
        content={generatedAntarcticaContent}
        mockups={[]}
        gameUi={generatedAntarcticaUi}
      />
    );

    await waitFor(() => {
      const renderer = document.querySelector(".game-renderer");
      expect(renderer).toBeDefined();
      expect(screen.getByText("Финальный экран")).toBeDefined();
      expect(screen.getByText("История завершена.")).toBeDefined();
      expect(screen.queryByText("Завершить")).toBeNull();
      expect((screen.getByRole("button", { name: /Вперед/i }) as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it("renders early info i0 through the reusable info UI variant", async () => {
    // The normalized UI manifest has one info-topbar screen. The concrete
    // scenario text still comes from currentInfo in player-facing content.
    const mockContentWithInfo: PlayerFacingContent = {
      ...mockContent,
      content: {
        data: {
          infos: [
            {
              id: "i0",
              stepIndex: 0,
              screenId: "S1",
              title: 'Корпорация "Антарктика"',
              body: "бизнес-квест (основан на идеях Джона Коттера)",
              advanceActionId: "opening.info.i0.advance",
              advanceLabel: "Продолжить"
            }
          ],
          boards: [],
          teamSelections: [],
          cards: []
        }
      }
    };

    const sessionAtI0 = {
      ...mockSession,
      state: {
        ...mockSession.state,
        public: {
          ...mockSession.state.public,
          timeline: { screenId: "S1", stepIndex: 0, activeInfoId: "i0", stageId: "opening" }
        }
      }
    };

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/runtime/sessions")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(sessionAtI0)
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA}
        runtimeApiUrl="http://localhost:8080"
        content={mockContentWithInfo}
        mockups={[]}
        gameUi={generatedAntarcticaUi}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Корпорация "Антарктика"')).toBeDefined();
      expect(screen.queryByText("Продолжить")).toBeNull();
      expect((screen.getByRole("button", { name: /Вперед/i }) as HTMLButtonElement).disabled).toBe(false);
      // S1 manifest screen should NOT be rendered (it contains test cards)
      expect(screen.queryByText("Тестовая карточка 1")).toBeNull();
    });
  });

  it("renders safe-mode fallback when activeInfoId has no dedicated UI screen", async () => {
    // activeInfoId is "i999" which is not in the manifest screens.
    // resolveScreenKey returns null so SafeModeRenderer is used.
    // Since mockContent has empty antarctica data, the fallback renders through ManifestRenderer.
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
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA}
        runtimeApiUrl="http://localhost:8080"
        content={mockContent}
        mockups={[]}
        gameUi={mockUiWithInfoVariants}
      />
    );

    await waitFor(() => {
      // SafeModeRenderer renders through ManifestRenderer since screenDefinition is null
      expect(document.querySelector(".game-renderer")).toBeDefined();
    });
  });

  it("shows loading state when session is booting (not yet available)", async () => {
    // Mock a session that takes time to load via a slow promise that
    // intentionally never resolves during this test.
    const slowPromise = new Promise<any>(() => {});

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/runtime/sessions")) {
        return slowPromise;
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA}
        runtimeApiUrl="http://localhost:8080"
        content={generatedAntarcticaContent}
        mockups={[]}
        gameUi={mockS1Ui}
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
      <GamePlayer config={ANTARCTICA_GAME_CONFIG_DATA}
        runtimeApiUrl="http://localhost:8080"
        content={generatedAntarcticaContent}
        mockups={[]}
        gameUi={mockS1Ui}
      />
    );

    // After boot completes with error, should show error state or loading
    // but NOT the fallback action catalog
    await waitFor(() => {
      expect(screen.queryByText(/Fallback action catalog/i)).toBeNull();
    });
  });
});

/**
 * Regression test for the "sticky screenKey" bug (P0 review Finding 2).
 *
 * Background: GamePlayer keeps a local React screenKey/layoutMode mirror of
 * the presenter's authoritative `PlayerState.screenKey`. The SYNC_STATE
 * handler used to update that mirror ONLY when the incoming value was
 * truthy, and never cleared it otherwise. When the game legitimately
 * transitions into a state that has no manifest screen (e.g. `screenKey`
 * becomes `null` because the new screenId/stepIndex has no mapped UI
 * screen), the stale previous screenKey stuck around and the player kept
 * rendering the OLD manifest screen instead of falling through to
 * SafeModeRenderer.
 *
 * This test drives a real screen -> no-screen transition through the
 * default (non-plugin) GameConfig screen router: the UI manifest only
 * declares screen "S1", so once the session's `timeline.screenId` moves to
 * an unmapped screen ("S2"), `resolveScreenKey` legitimately returns null.
 */
describe("GamePlayer sticky screenKey regression (Finding 2)", () => {
  const stickyGameId = "sticky-screenkey-regression-game";
  const fallbackActionMarker = "Fallback Action Marker";

  const stickyContent: PlayerFacingContent = {
    gameId: stickyGameId,
    version: "1.0.0",
    name: "Sticky ScreenKey Regression Game",
    description: "Fixture game for the sticky screenKey regression test.",
    playerConfig: { min: 1, max: 1 },
    locale: "en-US",
    actions: [
      {
        actionId: "fallback.action",
        displayName: fallbackActionMarker,
        capabilityFamily: "runtime.server",
        capability: "advance"
      }
    ],
    mockups: [],
    content: { data: {} }
  };

  const stickyGameUi: GamePlayerUiContent = {
    id: `${stickyGameId}.ui.web`,
    version: "1.0.0",
    gameId: stickyGameId,
    entryPoint: "S1",
    screens: {
      S1: {
        type: "screen",
        title: "Sticky S1",
        root: {
          type: "screenComponent",
          props: { cssClass: "sticky-test-s1-screen" },
          children: [
            {
              type: "buttonComponent",
              id: "advance-btn",
              props: { caption: "Advance to no-screen state" },
              actions: { onClick: { command: "requestServer", payload: { actionId: "advance-to-nowhere" } } }
            }
          ]
        }
      }
    }
  };

  const stickyInitialSession = {
    sessionId: "sticky-session-1",
    gameId: stickyGameId,
    version: { sessionId: "sticky-session-1", stateVersion: 0, lastEventSequence: 0 },
    state: {
      public: {
        metrics: {},
        timeline: { screenId: "S1", stepIndex: 0 }
      }
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("falls through to the fallback catalog instead of the stale S1 screen once screenKey clears", async () => {
    (global.fetch as any).mockImplementation((url: string, _options: any) => {
      if (url === "/api/runtime/actions") {
        // The server moves the session to screenId "S2", which has no
        // mapped UI screen in `stickyGameUi.screens` — so the presenter's
        // next `playerState.screenKey` is legitimately `null`.
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              ...stickyInitialSession,
              state: {
                ...stickyInitialSession.state,
                public: {
                  ...stickyInitialSession.state.public,
                  timeline: { screenId: "S2", stepIndex: 1 }
                }
              }
            })
        });
      }
      if (url.includes("/api/runtime/sessions")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(stickyInitialSession) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <GamePlayer
        config={createDefaultGameConfigData(stickyContent, stickyGameUi)}
        runtimeApiUrl="http://localhost:8080"
        content={stickyContent}
        mockups={[]}
        gameUi={stickyGameUi}
      />
    );

    // Initially screenKey resolves to "S1" and the manifest screen renders.
    await waitFor(() => {
      expect(document.querySelector(".sticky-test-s1-screen")).not.toBeNull();
      expect(screen.getByText("Advance to no-screen state")).toBeDefined();
    });

    fireEvent.click(screen.getByText("Advance to no-screen state"));

    // After the transition, screenId "S2" has no mapped UI screen, so
    // screenKey must clear and the player must fall through to
    // SafeModeRenderer's fallback action catalog — NOT keep showing S1.
    await waitFor(() => {
      expect(screen.getByText(fallbackActionMarker)).toBeDefined();
    });
    expect(document.querySelector(".sticky-test-s1-screen")).toBeNull();
    expect(screen.queryByText("Advance to no-screen state")).toBeNull();
  });
});
