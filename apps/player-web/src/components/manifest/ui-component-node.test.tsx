/**
 * Regression tests for `moveAdvanceActionToForwardNavigation` in
 * ui-component-node.tsx (P0 review Finding 7a).
 *
 * Background: older UI manifests can place a standalone "Продолжить"
 * (Continue) button next to the "nav-right" navigation arrow. Both trigger
 * the same server-side advance action, so the renderer merges the advance
 * button's action onto nav-right and drops the standalone button. The bug
 * was that this merge ALWAYS wrote `disabled: advanceProps.disabled === true`
 * onto the resulting nav-right button — forcing `disabled: false` even when
 * the advance action never declared a `disabled` field at all, silently
 * discarding whatever `disabled` value nav-right already had from the
 * manifest.
 *
 * These tests render a full screen through ManifestRenderer (the public
 * surface) rather than calling the private merge function directly, so the
 * assertions cover the actual rendered `<button disabled>` attribute that
 * players interact with.
 */

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { ManifestRenderer } from "./manifest-renderer";
import type { GamePlayerS1UiContent } from "@cubica/contracts-manifest";

/** Builds a minimal screen with a btn-advance + nav-right pair for merge testing. */
function buildScreen(options: {
  advanceDisabled?: boolean;
  navRightDisabled?: boolean;
}): GamePlayerS1UiContent["screen"] {
  const advanceProps: Record<string, unknown> = { caption: "Продолжить" };
  if (options.advanceDisabled !== undefined) {
    advanceProps.disabled = options.advanceDisabled;
  }

  const navRightProps: Record<string, unknown> = { caption: "Вперед", variant: "nav" };
  if (options.navRightDisabled !== undefined) {
    navRightProps.disabled = options.navRightDisabled;
  }

  return {
    type: "screen",
    title: "Advance merge test screen",
    root: {
      type: "screenComponent",
      props: { cssClass: "main-screen" },
      children: [
        {
          type: "areaComponent",
          props: { cssClass: "bottom-controls-container" },
          children: [
            {
              type: "buttonComponent",
              id: "btn-advance",
              props: advanceProps,
              actions: { onClick: { command: "requestServer", payload: { actionId: "advance.action" } } }
            },
            {
              type: "buttonComponent",
              id: "nav-right",
              props: navRightProps
            }
          ]
        }
      ]
    }
  };
}

describe("moveAdvanceActionToForwardNavigation (via ManifestRenderer)", () => {
  it("does NOT force the merged nav-right button disabled when the advance action has no explicit disabled", () => {
    render(
      <ManifestRenderer
        screenDefinition={buildScreen({})}
        metrics={{}}
        onAction={vi.fn()}
      />
    );

    // The standalone btn-advance must be removed (merged into nav-right).
    expect(document.getElementById("btn-advance")).toBeNull();

    const navRight = document.getElementById("nav-right") as HTMLButtonElement | null;
    expect(navRight).not.toBeNull();
    // Regression: previously this was always forced to `disabled` because
    // `advanceProps.disabled === true` evaluates to `false` when
    // `disabled` is undefined, and that `false` was unconditionally written
    // — which happened to look "not disabled" here, but see the next test
    // for the case this masked.
    expect(navRight!.disabled).toBe(false);
  });

  it("preserves nav-right's own explicit disabled when the advance action does not declare one", () => {
    // nav-right itself is manifest-declared as disabled (e.g. "not yet
    // allowed to advance"). The advance action has no `disabled` field.
    // Before the fix, the merge unconditionally wrote
    // `disabled: advanceProps.disabled === true` (=> false), silently
    // clearing nav-right's own disabled state. The fix must leave it alone.
    render(
      <ManifestRenderer
        screenDefinition={buildScreen({ navRightDisabled: true })}
        metrics={{}}
        onAction={vi.fn()}
      />
    );

    const navRight = document.getElementById("nav-right") as HTMLButtonElement | null;
    expect(navRight).not.toBeNull();
    expect(navRight!.disabled).toBe(true);
  });

  it("propagates an explicit disabled: true from the advance action onto the merged nav-right button", () => {
    render(
      <ManifestRenderer
        screenDefinition={buildScreen({ advanceDisabled: true })}
        metrics={{}}
        onAction={vi.fn()}
      />
    );

    const navRight = document.getElementById("nav-right") as HTMLButtonElement | null;
    expect(navRight).not.toBeNull();
    expect(navRight!.disabled).toBe(true);
  });

  it("propagates an explicit disabled: false from the advance action onto the merged nav-right button", () => {
    render(
      <ManifestRenderer
        screenDefinition={buildScreen({ advanceDisabled: false, navRightDisabled: true })}
        metrics={{}}
        onAction={vi.fn()}
      />
    );

    const navRight = document.getElementById("nav-right") as HTMLButtonElement | null;
    expect(navRight).not.toBeNull();
    // Explicit `false` on the advance action wins over nav-right's own
    // disabled: true, since it was explicitly declared.
    expect(navRight!.disabled).toBe(false);
  });

  it("dispatches the advance action's command when the merged nav-right button is clicked", () => {
    const onAction = vi.fn();
    const { container } = render(
      <ManifestRenderer
        screenDefinition={buildScreen({})}
        metrics={{}}
        onAction={onAction}
      />
    );

    const navRight = container.querySelector("#nav-right") as HTMLButtonElement;
    navRight.click();

    expect(onAction).toHaveBeenCalledWith("requestServer", { actionId: "advance.action" });
  });
});
