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
import { render, fireEvent } from "@testing-library/react";
import React from "react";
import { ManifestRenderer } from "./manifest-renderer";
import type { GamePlayerS1UiContent } from "@cubica/contracts-manifest";
import { createGameAssetResolver } from "@/lib/game-asset-resolver";

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

  it("disables a runtime action from the server session projection", () => {
    const { container } = render(
      <ManifestRenderer
        screenDefinition={buildScreen()}
        metrics={{}}
        onAction={vi.fn()}
        session={{
          sessionId: "session-1",
          gameId: "neutral-game",
          version: { sessionId: "session-1", stateVersion: 1, lastEventSequence: 1 },
          state: {},
          actionAvailability: [{
            actionId: "requestServer",
            status: "unavailable",
            reasonCode: "state_condition_failed",
            basisStateVersion: 1
          }]
        }}
      />
    );

    const navRight = container.querySelector("#nav-right") as HTMLButtonElement;
    expect(navRight.disabled).toBe(true);
    expect(navRight.title).toContain("текущем состоянии игры");
  });

  it("disables manifest actions while Presenter waits for the previous command", () => {
    const { container } = render(
      <ManifestRenderer
        screenDefinition={buildScreen()}
        metrics={{}}
        onAction={vi.fn()}
        isPending
      />
    );

    expect((container.querySelector("#nav-right") as HTMLButtonElement).disabled).toBe(true);
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

  it("recognizes interactiveBoardSurface and fails visibly without a session bridge", () => {
    const screen = {
      type: "screen",
      title: "Neutral interactive board",
      root: {
        type: "interactiveBoardSurface",
        props: { sceneId: "main", designWidth: 1400, designHeight: 1000 }
      }
    } as unknown as GamePlayerS1UiContent["screen"];

    const { getByRole } = render(
      <ManifestRenderer screenDefinition={screen} metrics={{}} onAction={vi.fn()} />
    );

    expect(getByRole("alert").textContent).toContain("не подключено к игровой сессии");
  });

  it("resolves asset ids in the documented screen background property", () => {
    const screen = buildScreen();
    screen.root.props = { ...screen.root.props, backgroundImage: "asset:board" };
    const resolver = createGameAssetResolver({
      gameId: "test-game",
      assets: {
        board: { url: "/game-assets/test-game/board/hash.svg", kind: "image" }
      }
    }, "https://runtime.example");

    const { container } = render(
      <ManifestRenderer
        screenDefinition={screen}
        metrics={{}}
        onAction={vi.fn()}
        assetResolver={resolver}
      />
    );

    expect((container.querySelector(".game-screen") as HTMLElement).style.backgroundImage)
      .toContain("https://runtime.example/game-assets/test-game/board/hash.svg");
  });

  /**
   * TSK-20260719 R4b: the platform generalized `asset:<id>` resolution
   * (previously only `screenComponent.props.backgroundImage`, see above) to
   * every other declared image property — `gameVariableComponent.backgroundImage`,
   * `imageComponent.src`, and the config-level theme background (covered by
   * a dedicated pure-function test in `lib/game-asset-resolver.test.ts`). The
   * tests below exercise the two remaining UI-manifest properties through the
   * same public ManifestRenderer surface as the screenComponent case.
   */
  describe("generalized asset:<id> resolution (TSK-20260719 R4b)", () => {
    it("resolves asset ids in gameVariableComponent's backgroundImage", () => {
      const screen = {
        type: "screen",
        title: "Metric badge test screen",
        root: {
          type: "screenComponent",
          props: {},
          children: [
            {
              type: "gameVariableComponent",
              id: "pro",
              props: { metricId: "pro", backgroundImage: "asset:badge" }
            }
          ]
        }
      } as unknown as GamePlayerS1UiContent["screen"];
      const resolver = createGameAssetResolver({
        gameId: "test-game",
        assets: { badge: { url: "/game-assets/test-game/badge/hash.png", kind: "image" } }
      }, "https://runtime.example");

      const { container } = render(
        <ManifestRenderer screenDefinition={screen} metrics={{}} onAction={vi.fn()} assetResolver={resolver} />
      );

      const badge = container.querySelector(".game-variable-image") as HTMLElement;
      expect(badge).not.toBeNull();
      expect(badge.style.backgroundImage).toContain("https://runtime.example/game-assets/test-game/badge/hash.png");
    });

    it("fails closed (no broken image, console warning) when a gameVariableComponent asset id is unknown", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const screen = {
        type: "screen",
        title: "Metric badge test screen",
        root: {
          type: "screenComponent",
          props: {},
          children: [
            {
              type: "gameVariableComponent",
              id: "pro",
              props: { metricId: "pro", backgroundImage: "asset:missing-badge" }
            }
          ]
        }
      } as unknown as GamePlayerS1UiContent["screen"];
      const resolver = createGameAssetResolver(
        { gameId: "test-game", assets: {} },
        "https://runtime.example"
      );

      const { container } = render(
        <ManifestRenderer screenDefinition={screen} metrics={{}} onAction={vi.fn()} assetResolver={resolver} />
      );

      // No image layer is rendered; the component falls back to its plain
      // (no-background) presentation instead of a broken url().
      expect(container.querySelector(".game-variable-image")).toBeNull();
      expect(container.querySelector(".game-variable-value--plain")).not.toBeNull();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("resolves an imageComponent src that combines a {{template}} with an asset: marker, template first", () => {
      const screen = {
        type: "screen",
        title: "Image component test screen",
        root: {
          type: "screenComponent",
          props: {},
          children: [
            {
              type: "imageComponent",
              id: "info-illustration",
              props: {
                src: "asset:info-{{currentInfo.id}}",
                alt: "{{currentInfo.title}}",
                cssClass: "info-event-illustration"
              }
            }
          ]
        }
      } as unknown as GamePlayerS1UiContent["screen"];
      // The registered asset id is the template's *substituted* form
      // (info-i5), proving substitution ran before asset resolution.
      const resolver = createGameAssetResolver({
        gameId: "test-game",
        assets: { "info-i5": { url: "/game-assets/test-game/info-i5/hash.png", kind: "image" } }
      }, "https://runtime.example");

      const { container } = render(
        <ManifestRenderer
          screenDefinition={screen}
          metrics={{}}
          onAction={vi.fn()}
          assetResolver={resolver}
          gameState={{ currentInfo: { id: "i5", title: "Ледяной шторм" } }}
        />
      );

      // imageComponent does not mirror its manifest `id` onto the DOM element
      // (only buttonComponent does today), so tests target the declared
      // cssClass instead — the same selector globals.css itself uses.
      const illustration = container.querySelector(".info-event-illustration") as HTMLElement;
      expect(illustration).not.toBeNull();
      expect(illustration.style.backgroundImage)
        .toContain("https://runtime.example/game-assets/test-game/info-i5/hash.png");
      expect(illustration.getAttribute("aria-label")).toBe("Ледяной шторм");
    });

    it("fails closed for a decorative imageComponent when the templated asset id is unknown", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const screen = {
        type: "screen",
        title: "Image component test screen",
        root: {
          type: "screenComponent",
          props: {},
          children: [
            {
              type: "imageComponent",
              id: "info-illustration",
              props: { src: "asset:info-{{currentInfo.id}}", cssClass: "info-event-illustration" }
            }
          ]
        }
      } as unknown as GamePlayerS1UiContent["screen"];
      // Pre-existing content gap (LEGACY-0023): some currentInfo.id values have
      // no registered illustration yet. The registry stays empty on purpose.
      const resolver = createGameAssetResolver({ gameId: "test-game", assets: {} }, "https://runtime.example");

      const { container } = render(
        <ManifestRenderer
          screenDefinition={screen}
          metrics={{}}
          onAction={vi.fn()}
          assetResolver={resolver}
          gameState={{ currentInfo: { id: "i11" } }}
        />
      );

      const illustration = container.querySelector(".info-event-illustration") as HTMLElement;
      expect(illustration).not.toBeNull();
      // No backgroundImage style at all — never `url(undefined)`.
      expect(illustration.style.backgroundImage).toBe("");
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("fails closed for a plain <img> imageComponent by omitting the src attribute", () => {
      const screen = {
        type: "screen",
        title: "Image component test screen",
        root: {
          type: "screenComponent",
          props: {},
          children: [
            {
              type: "imageComponent",
              id: "plain-image",
              props: { src: "asset:missing-plain-image", alt: "plain", cssClass: "plain-image-test" }
            }
          ]
        }
      } as unknown as GamePlayerS1UiContent["screen"];
      const resolver = createGameAssetResolver({ gameId: "test-game", assets: {} }, "https://runtime.example");

      const { container } = render(
        <ManifestRenderer screenDefinition={screen} metrics={{}} onAction={vi.fn()} assetResolver={resolver} />
      );

      const image = container.querySelector("img.plain-image-test") as HTMLImageElement;
      expect(image).not.toBeNull();
      // React omits the attribute entirely for an undefined src, so the
      // browser never issues a spurious request for a broken image.
      expect(image.hasAttribute("src")).toBe(false);
    });
  });

  describe("backdrop-dismiss action on a container (journal/hint panels)", () => {
    // A container (areaComponent/screenComponent) that declares actions.onClick
    // behaves as a dismissible backdrop: a click on its own empty area runs the
    // command, but clicks on its children do not. This is how the Antarctica
    // journal ("журнал ходов") closes on an empty-space click, matching the
    // reference Bootstrap modal's backdrop dismiss — with no game specifics in
    // the renderer.
    const buildPanel = (): GamePlayerS1UiContent["screen"] => ({
      type: "screen",
      title: "Backdrop dismiss panel",
      root: {
        type: "screenComponent",
        props: { cssClass: "main-screen journal-screen" },
        children: [
          {
            type: "areaComponent",
            props: { cssClass: "journal-main-content" },
            actions: { onClick: { command: "closePanel", payload: { panelId: "history" } } },
            children: [
              {
                type: "areaComponent",
                props: { cssClass: "journal-container" },
                children: [
                  { type: "richTextComponent", props: { html: "<p>entry text</p>" } },
                  {
                    type: "buttonComponent",
                    id: "btn-journal-close",
                    props: { caption: "закрыть" },
                    actions: { onClick: { command: "closePanel", payload: { panelId: "history" } } }
                  }
                ]
              }
            ]
          }
        ]
      }
    } as unknown as GamePlayerS1UiContent["screen"]);

    it("dispatches closePanel when the backdrop's own area is clicked", () => {
      const onAction = vi.fn();
      const { container } = render(
        <ManifestRenderer screenDefinition={buildPanel()} metrics={{}} onAction={onAction} />
      );
      const backdrop = container.querySelector(".journal-main-content") as HTMLElement;
      expect(backdrop).not.toBeNull();
      // fireEvent.click sets event.target to the element itself, so
      // target === currentTarget: a genuine empty-space (backdrop) click.
      fireEvent.click(backdrop);
      expect(onAction).toHaveBeenCalledWith("closePanel", { panelId: "history" });
    });

    it("does NOT dispatch closePanel when a child inside the container is clicked", () => {
      const onAction = vi.fn();
      const { container } = render(
        <ManifestRenderer screenDefinition={buildPanel()} metrics={{}} onAction={onAction} />
      );
      // Clicking the inner content box (a descendant) bubbles up to the backdrop
      // handler, but target !== currentTarget there, so it must not close.
      const inner = container.querySelector(".journal-container") as HTMLElement;
      fireEvent.click(inner);
      expect(onAction).not.toHaveBeenCalledWith("closePanel", { panelId: "history" });
    });
  });
});
