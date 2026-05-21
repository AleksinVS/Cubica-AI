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
                  actions: { onClick: { command: "showHistory", payload: {} } }
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

    expect(mockOnAction).toHaveBeenCalledWith("showHistory", {});
    expect((screen.getByRole("button", { name: /Назад/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Вперед/i }) as HTMLButtonElement).disabled).toBe(true);
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
