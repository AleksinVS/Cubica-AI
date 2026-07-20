/**
 * Tests for cardComponent front/back flip (ADR-094).
 *
 * The flip is a GENERAL, declarative renderer capability:
 *   - A card gets two faces ONLY when it carries `backText` (the outcome text).
 *   - It flips to the back when its presentation `visualState === "resolved"`.
 *   - Cards without `backText` render exactly as before (backward compatible).
 *
 * These tests assert on stable, semantic DOM — the plain `game-card-front` /
 * `game-card-back` hooks and `aria-hidden` — rather than the scoped CSS-module
 * class names, so they are independent of how the bundler hashes module classes.
 *
 * The final test uses a NEUTRAL fixture (no game names or ids) to prove the
 * capability is game-agnostic, per the platform-purity rule.
 */

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import React from "react";
import type {
  GameUiComponent,
  GameUiCardComponentProps
} from "@cubica/contracts-manifest";
import { CardComponent } from "./card-component";

type CardActions = { onClick: { command: string; payload?: Record<string, unknown> } };

/** Builds a minimal cardComponent node for direct rendering. */
function makeCard(
  props: GameUiCardComponentProps,
  actions?: CardActions,
  id = "opt-1"
): GameUiComponent<GameUiCardComponentProps> {
  return {
    id,
    type: "cardComponent",
    props,
    ...(actions ? { actions } : {})
  } as unknown as GameUiComponent<GameUiCardComponentProps>;
}

describe("CardComponent front/back flip (ADR-094)", () => {
  it("renders a single-sided card (no flip structure) when there is no backText", () => {
    const { container } = render(
      <CardComponent component={makeCard({ title: "Опция", summary: "Передняя сторона" })} onAction={() => {}} />
    );
    expect(container.querySelector(".game-card-back")).toBeNull();
    expect(container.querySelector(".game-card-front")).toBeNull();
    expect(container.querySelector(".game-card")).not.toBeNull();
  });

  it("renders both faces when backText is present, keeping the back present but hidden until flipped", () => {
    const { container, getByText } = render(
      <CardComponent
        component={makeCard({ title: "Опция A", summary: "Передняя", backText: "Последствие A" })}
        onAction={() => {}}
      />
    );
    const front = container.querySelector(".game-card-front");
    const back = container.querySelector(".game-card-back");
    expect(front).not.toBeNull();
    expect(back).not.toBeNull();
    // Back content is in the DOM (public content) but hidden from assistive tech until flip.
    expect(getByText("Последствие A")).toBeTruthy();
    expect(back?.getAttribute("aria-hidden")).toBe("true");
    expect(front?.getAttribute("aria-hidden")).toBeNull();
  });

  it("flips to the back and hides the front when visualState is resolved", () => {
    const { container } = render(
      <CardComponent
        component={makeCard({ title: "Опция A", summary: "Передняя", backText: "Результат", visualState: "resolved" })}
        onAction={() => {}}
      />
    );
    const front = container.querySelector(".game-card-front");
    const back = container.querySelector(".game-card-back");
    expect(front?.getAttribute("aria-hidden")).toBe("true");
    expect(back?.getAttribute("aria-hidden")).toBeNull();
    // A resolved (flipped) card is done and must not be re-selectable.
    expect(container.querySelector("article")?.getAttribute("aria-disabled")).toBe("true");
  });

  it("does not build a flip for a resolved card that has no backText (nothing to reveal)", () => {
    const { container } = render(
      <CardComponent
        component={makeCard({ title: "Опция", summary: "Передняя", visualState: "resolved" })}
        onAction={() => {}}
      />
    );
    expect(container.querySelector(".game-card-back")).toBeNull();
    expect(container.querySelector(".game-card-front")).toBeNull();
  });

  it("dispatches the select action from the front while unresolved, but not once resolved", () => {
    const onAction = vi.fn();
    const actions: CardActions = { onClick: { command: "requestServer", payload: { actionId: "opening.card.1" } } };

    const { container, rerender } = render(
      <CardComponent component={makeCard({ title: "A", summary: "s", backText: "b" }, actions)} onAction={onAction} />
    );
    fireEvent.click(container.querySelector("article")!);
    expect(onAction).toHaveBeenCalledWith("requestServer", { actionId: "opening.card.1" });

    onAction.mockClear();
    rerender(
      <CardComponent
        component={makeCard({ title: "A", summary: "s", backText: "b", visualState: "resolved" }, actions)}
        onAction={onAction}
      />
    );
    fireEvent.click(container.querySelector("article")!);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("is game-agnostic: a neutral card (no game names/ids) flips on resolved", () => {
    // Neutral fixture proving the flip is a general capability, not an Antarctica hack.
    const { container, getByText } = render(
      <CardComponent
        component={makeCard({ title: "Option", summary: "Front", backText: "Back result", visualState: "resolved" })}
        onAction={() => {}}
      />
    );
    expect(getByText("Back result")).toBeTruthy();
    expect(container.querySelector(".game-card-front")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".game-card-back")?.getAttribute("aria-hidden")).toBeNull();
  });
});
