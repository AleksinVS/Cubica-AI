import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { ManifestRenderer } from "./manifest/manifest-renderer";
import { resolveMetricBinding } from "@/lib/metric-resolvers";
import type { GamePlayerS1UiContent } from "@cubica/contracts-manifest";

describe("ManifestRenderer", () => {
  const mockScreenDefinition: GamePlayerS1UiContent["screen"] = {
    type: "screen",
    title: "Opening Screen",
    root: {
      type: "screenComponent",
      props: { cssClass: "main-screen", backgroundImage: "/images/bg.png" },
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
                value: "{{game.state.public.metrics.score}}",
                backgroundImage: "/images/left-sidebar/days.png"
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
                  props: { text: "Test Card Text" },
                  actions: { onClick: { command: "requestServer", payload: { id: 1 } } }
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
                  props: { caption: "Журнал" },
                  actions: { onClick: { command: "showPanel", payload: { panelId: "history" } } }
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
  };

  const mockMetrics = {
    score: 45,
    pro: 10
  };

  const mockOnAction = vi.fn();

  it("renders the sidebar with resolved metrics", () => {
    render(
      <ManifestRenderer
        screenDefinition={mockScreenDefinition}
        metrics={mockMetrics}
        onAction={mockOnAction}
      />
    );

    expect(screen.getByText("Остаток дней")).toBeDefined();
    expect(screen.getByText("45")).toBeDefined();
    const metricBadge = document.querySelector<HTMLElement>(".game-variable-image");
    expect(metricBadge?.style.backgroundImage).toContain("/images/left-sidebar/days.png");
  });

  it("renders topbar metric value without a background image", () => {
    const screenWithoutMetricImage: GamePlayerS1UiContent["screen"] = {
      ...mockScreenDefinition,
      root: {
        type: "screenComponent",
        props: { cssClass: "topbar-screen-shell" },
        children: [
          {
            type: "areaComponent",
            props: { cssClass: "topbar-metrics" },
            children: [
              {
                type: "gameVariableComponent",
                id: "score",
                props: {
                  caption: "Score",
                  value: "{{game.state.public.metrics.score}}"
                }
              }
            ]
          }
        ]
      }
    };

    render(
      <ManifestRenderer
        screenDefinition={screenWithoutMetricImage}
        metrics={mockMetrics}
        onAction={mockOnAction}
        layoutMode="topbar"
      />
    );

    expect(screen.getByText("45")).toBeDefined();
    expect(screen.getByText("Score")).toBeDefined();
  });

  it("renders metricId components from game-owned metricViews", () => {
    const screenWithMetricId: GamePlayerS1UiContent["screen"] = {
      ...mockScreenDefinition,
      root: {
        type: "screenComponent",
        props: { cssClass: "topbar-screen-shell" },
        children: [
          {
            type: "areaComponent",
            props: { cssClass: "topbar-metrics" },
            children: [
              {
                type: "gameVariableComponent",
                id: "remainingDays",
                props: {
                  metricId: "remainingDays"
                }
              }
            ]
          }
        ]
      }
    };

    render(
      <ManifestRenderer
        screenDefinition={screenWithMetricId}
        metrics={{ remainingDays: 50 }}
        onAction={mockOnAction}
        layoutMode="topbar"
        gameState={{
          metricViews: {
            remainingDays: {
              metricId: "remainingDays",
              label: "Осталось дней",
              value: 50,
              formattedValue: "50",
              kind: "computed"
            }
          }
        }}
      />
    );

    expect(screen.getByText("50")).toBeDefined();
    expect(screen.getByText("Осталось дней")).toBeDefined();
  });

  it("renders cards with correct text", () => {
    render(
      <ManifestRenderer
        screenDefinition={mockScreenDefinition}
        metrics={mockMetrics}
        onAction={mockOnAction}
      />
    );

    expect(screen.getByText("Test Card Text")).toBeDefined();
  });

  it("renders neutral map-first workspace slots without game-specific structural classes", () => {
    const mapAction = vi.fn();
    const mapFirstScreen: GamePlayerS1UiContent["screen"] = {
      type: "screen",
      title: "Spatial workspace fixture",
      layoutMode: "map-first",
      root: {
        type: "screenComponent",
        props: {},
        children: [
          {
            type: "areaComponent",
            props: { workspaceSlot: "board" },
            children: [{ type: "richTextComponent", props: { html: "<p>Neutral board</p>" } }]
          },
          {
            type: "areaComponent",
            props: { workspaceSlot: "status" },
            children: [{ type: "richTextComponent", props: { html: "<p>Neutral status</p>" } }]
          },
          {
            type: "areaComponent",
            props: { workspaceSlot: "primary-panel", cssClass: "legacy-primary-layout" },
            children: [{ type: "richTextComponent", props: { html: "<p>Neutral overview</p>" } }]
          },
          {
            type: "areaComponent",
            props: { workspaceSlot: "context-panel", cssClass: "legacy-context-layout" },
            children: [{ type: "richTextComponent", props: { html: "<p>Neutral context</p>" } }]
          },
          {
            type: "areaComponent",
            props: { workspaceSlot: "action-tray" },
            children: [{
              type: "buttonComponent",
              props: { caption: "Продолжить" },
              actions: { onClick: { command: "advance", payload: { step: 2 } } }
            }]
          }
        ]
      }
    };

    render(
      <ManifestRenderer
        screenDefinition={mapFirstScreen}
        metrics={{}}
        onAction={mapAction}
      />
    );

    expect(document.querySelector(".game-renderer--map-first")).toBeDefined();
    expect(document.querySelector(".map-first-screen")).toBeDefined();
    expect(document.querySelector('[data-workspace-slot="board"]')).toBeDefined();
    expect(document.querySelector('[data-workspace-slot="status"]')).toBeDefined();
    expect(screen.getByText("Neutral board")).toBeDefined();

    const primaryPanel = document.querySelector<HTMLElement>('[data-workspace-slot="primary-panel"]')!;
    const contextPanel = document.querySelector<HTMLElement>('[data-workspace-slot="context-panel"]')!;
    const primaryToggle = screen.getByRole("button", { name: "Открыть панель «Обзор»" });
    const contextToggle = screen.getByRole("button", { name: "Открыть панель «Контекст»" });

    // Authored classes remain available for content decoration but cannot own
    // the platform drawer's coordinates or dimensions.
    expect(primaryPanel.classList.contains("legacy-primary-layout")).toBe(false);
    expect(primaryPanel.querySelector(".legacy-primary-layout")).not.toBeNull();
    expect(contextPanel.classList.contains("legacy-context-layout")).toBe(false);
    expect(contextPanel.querySelector(".legacy-context-layout")).not.toBeNull();

    expect(primaryPanel.hidden).toBe(true);
    expect(contextPanel.hidden).toBe(true);
    expect(primaryToggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(primaryToggle);
    expect(primaryPanel.hidden).toBe(false);
    expect(contextPanel.hidden).toBe(true);
    expect(document.activeElement).toBe(primaryPanel);

    fireEvent.click(contextToggle);
    expect(primaryPanel.hidden).toBe(true);
    expect(contextPanel.hidden).toBe(false);
    expect(document.activeElement).toBe(contextPanel);

    // Critical declarative actions stay usable while a drawer overlays the map.
    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }));
    expect(mapAction).toHaveBeenCalledWith("advance", { step: 2 });

    fireEvent.keyDown(contextPanel, { key: "Escape" });
    expect(contextPanel.hidden).toBe(true);
    expect(document.activeElement).toBe(contextToggle);
  });

  it("dispatches action when card button is clicked", () => {
    render(
      <ManifestRenderer
        screenDefinition={mockScreenDefinition}
        metrics={mockMetrics}
        onAction={mockOnAction}
      />
    );

    const button = screen.getByText("Выбрать");
    fireEvent.click(button);

    expect(mockOnAction).toHaveBeenCalledWith("requestServer", { id: 1 });
  });

  it("renders projected object view cards and obeys interactive props", () => {
    render(
      <ManifestRenderer
        screenDefinition={{
          type: "screen",
          title: "Object Views",
          root: {
            type: "screenComponent",
            props: {},
            children: [
              {
                type: "areaComponent",
                props: {},
                itemTemplate: {
                  collection: "{{objectViews.choices}}",
                  itemKey: "choice",
                },
                children: [
                  {
                    type: "cardComponent",
                    id: "choice-card",
                    props: {
                      title: "{{choice.title}}",
                      summary: "{{choice.summary}}",
                      visualState: "{{choice.visualState}}",
                      interactive: "{{choice.interactive}}",
                      selectLabel: "Choose",
                    },
                    actions: {
                      onClick: {
                        command: "requestServer",
                        payload: { actionId: "{{choice.actionId}}" },
                      },
                    },
                  },
                ],
              },
            ],
          },
        }}
        metrics={mockMetrics}
        onAction={mockOnAction}
        gameState={{
          objectViews: {
            choices: [
              {
                title: "Take the clear path",
                summary: "Back text",
                visualState: "locked",
                interactive: false,
                actionId: "choice.accept",
              },
            ],
          },
        }}
      />
    );

    expect(screen.getByText("Back text")).toBeDefined();
    expect(document.querySelector(".fallback-card-locked")).not.toBeNull();
    const button = screen.getByRole("button", { name: "Choose" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.click(button);

    expect(mockOnAction).not.toHaveBeenCalledWith("requestServer", { actionId: "choice.accept" });
  });

  it("renders an item-template area when optional props are omitted", () => {
    render(
      <ManifestRenderer
        screenDefinition={{
          type: "screen",
          title: "Declarative log",
          root: {
            type: "screenComponent",
            props: {},
            children: [
              {
                type: "areaComponent",
                itemTemplate: {
                  collection: "{{public.log}}",
                  itemKey: "entry",
                },
                children: [
                  {
                    type: "richTextComponent",
                    props: { html: "<p>{{entry.summary}}</p>" },
                  },
                ],
              },
            ],
          },
        }}
        metrics={{}}
        onAction={mockOnAction}
        gameState={{ public: { log: [{ summary: "First entry" }] } }}
      />
    );

    expect(screen.getByText("First entry")).toBeDefined();
  });

  it("renders bottom buttons and dispatches action", () => {
    render(
      <ManifestRenderer
        screenDefinition={mockScreenDefinition}
        metrics={mockMetrics}
        onAction={mockOnAction}
      />
    );

    const button = screen.getByText("Журнал");
    fireEvent.click(button);

    expect(mockOnAction).toHaveBeenCalledWith("showPanel", { panelId: "history" });
    expect((screen.getByRole("button", { name: /Назад/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Вперед/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("emits runtime pointer metadata only in editor preview mode", () => {
    const { rerender } = render(
      <ManifestRenderer
        screenDefinition={mockScreenDefinition}
        metrics={mockMetrics}
        onAction={mockOnAction}
        screenKey="S1"
      />
    );

    expect(document.querySelector("[data-preview-runtime-pointer]")).toBeNull();

    rerender(
      <ManifestRenderer
        screenDefinition={mockScreenDefinition}
        metrics={mockMetrics}
        onAction={mockOnAction}
        screenKey="S1"
        editorPreviewMode
      />
    );

    expect(document.querySelector("[data-preview-runtime-pointer='/screens/S1/root']")).not.toBeNull();
    expect(document.querySelector("[data-preview-runtime-pointer='/screens/S1/root/children/0']")).not.toBeNull();
  });
});

describe("resolveMetricBinding", () => {
  it("resolves metric expressions correctly", () => {
    const metrics = { score: 100, pro: 5 };
    expect(resolveMetricBinding("{{game.state.public.metrics.score}}", metrics)).toBe("100");
    expect(resolveMetricBinding("{{game.state.public.metrics.pro}}", metrics)).toBe("5");
  });

  it("returns plain text as-is, returns '—' for unresolvable expressions", () => {
    const metrics = { score: 100 };
    expect(resolveMetricBinding("score", metrics)).toBe("score");
    // Unresolvable {{...}} paths return "—" (empty from resolver → "—" fallback)
    expect(resolveMetricBinding("{{other.pattern}}", metrics)).toBe("—");
  });

  it("returns '—' for missing metrics", () => {
    const metrics = {};
    expect(resolveMetricBinding("{{game.state.public.metrics.missing}}", metrics)).toBe("—");
  });
});
