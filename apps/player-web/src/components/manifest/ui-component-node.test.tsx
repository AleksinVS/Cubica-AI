/**
 * Tests for the generic UI renderer (ui-component-node.tsx) under ADR-055
 * (player renderer purity / declarative action binding).
 *
 * Under ADR-055 the generic renderer no longer knows any specific game: it does
 * NOT hardcode button ids, does NOT rewrite the component tree to move an
 * "advance" action from a standalone button onto a navigation arrow, and does
 * NOT branch on a game's CSS class name. Instead:
 *   - which control carries which action is declared in the UI manifest (the
 *     forward-nav button simply owns the `onClick` advance action), and
 *   - the decorative background layer is driven by the declarative
 *     `decorativeBackground` prop (or the platform-owned topbar layout mode),
 *     not by a game-authored CSS class.
 *
 * These tests render through ManifestRenderer (the public surface) and assert
 * the rendered DOM the player actually interacts with.
 */

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { ManifestRenderer } from "./manifest-renderer";
import type { GamePlayerS1UiContent } from "@cubica/contracts-manifest";

/**
 * Builds a screen whose forward-nav button directly declares the advance action
 * (the ADR-055 declarative model), alongside a back button. Optional props let
 * a test set the nav button's own `disabled` or the screen's decorative flag.
 */
function buildScreen(options: {
  navRightDisabled?: boolean;
  decorativeBackground?: boolean;
  layoutMode?: "leftsidebar" | "topbar";
} = {}): GamePlayerS1UiContent["screen"] {
  const navRightProps: Record<string, unknown> = { caption: "Вперед", variant: "nav" };
  if (options.navRightDisabled !== undefined) {
    navRightProps.disabled = options.navRightDisabled;
  }

  const screenProps: Record<string, unknown> = { cssClass: "main-screen" };
  if (options.decorativeBackground !== undefined) {
    screenProps.decorativeBackground = options.decorativeBackground;
  }

  return {
    type: "screen",
    title: "Declarative action binding test screen",
    // ManifestRenderer defaults layoutMode to "topbar" (which itself draws the
    // decorative layer); tests that isolate the `decorativeBackground` prop set
    // a non-topbar mode so only the prop can trigger the layer.
    ...(options.layoutMode ? { layoutMode: options.layoutMode } : {}),
    root: {
      type: "screenComponent",
      props: screenProps,
      children: [
        {
          type: "areaComponent",
          props: { cssClass: "bottom-controls-container" },
          children: [
            {
              type: "buttonComponent",
              id: "nav-left",
              props: { caption: "Назад", variant: "nav" }
            },
            {
              type: "buttonComponent",
              id: "nav-right",
              props: navRightProps,
              // ADR-055: the forward-nav button itself carries the advance
              // action — the renderer no longer moves it from a separate button.
              actions: { onClick: { command: "requestServer", payload: { actionId: "advance.action" } } }
            }
          ]
        }
      ]
    }
  };
}

describe("UiComponentNode declarative action binding (ADR-055)", () => {
  it("dispatches the action declared directly on the forward-nav button when clicked", () => {
    const onAction = vi.fn();
    const { container } = render(
      <ManifestRenderer screenDefinition={buildScreen()} metrics={{}} onAction={onAction} />
    );

    const navRight = container.querySelector("#nav-right") as HTMLButtonElement;
    expect(navRight).not.toBeNull();
    navRight.click();

    expect(onAction).toHaveBeenCalledWith("requestServer", { actionId: "advance.action" });
  });

  it("renders every declared child as-is without removing or rewriting any button", () => {
    // The old renderer removed a standalone advance button and merged it into
    // nav-right. The pure renderer must leave the declared tree untouched: both
    // buttons the manifest declares are present.
    const { container } = render(
      <ManifestRenderer screenDefinition={buildScreen()} metrics={{}} onAction={vi.fn()} />
    );

    expect(container.querySelector("#nav-left")).not.toBeNull();
    expect(container.querySelector("#nav-right")).not.toBeNull();
  });

  it("respects a button's own declared disabled prop", () => {
    const { container } = render(
      <ManifestRenderer screenDefinition={buildScreen({ navRightDisabled: true })} metrics={{}} onAction={vi.fn()} />
    );

    const navRight = container.querySelector("#nav-right") as HTMLButtonElement;
    expect(navRight).not.toBeNull();
    expect(navRight.disabled).toBe(true);
  });

  it("renders the decorative background layer when props.decorativeBackground is true (non-topbar)", () => {
    const { container } = render(
      <ManifestRenderer
        screenDefinition={buildScreen({ layoutMode: "leftsidebar", decorativeBackground: true })}
        metrics={{}}
        onAction={vi.fn()}
      />
    );

    expect(container.querySelector(".additional-background")).not.toBeNull();
  });

  it("does not render the decorative background layer without the declarative signal (non-topbar)", () => {
    // No decorativeBackground prop and a non-topbar layout mode → no extra
    // layer. (In topbar mode the platform-owned layout draws it regardless.)
    const { container } = render(
      <ManifestRenderer
        screenDefinition={buildScreen({ layoutMode: "leftsidebar" })}
        metrics={{}}
        onAction={vi.fn()}
      />
    );

    expect(container.querySelector(".additional-background")).toBeNull();
  });
});
