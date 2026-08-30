import { describe, expect, it } from "vitest";
import type { GamePlayerUiContent, GameUiLayoutMode, ScreenRoutingEntry } from "@cubica/contracts-manifest";

import { resolveLayoutModeFromRouting, resolveScreenKey } from "./screen-router";

// Layout is a design-time choice declared in the UI manifest (ADR-093), so the
// router picks a layout variant screen from `defaultLayoutMode`, not from any
// server-side UI state. These fixtures vary that manifest-level declaration.
const baseUiContent = {
  id: "routing-test.ui.web",
  version: "1.0.0",
  gameId: "routing-test",
  entryPoint: "S1",
  screens: {
    S1: {
      type: "screen",
      title: "Topbar screen",
      root: { type: "screenComponent", props: {}, children: [] },
    },
    S1_LEFT: {
      type: "screen",
      title: "Left-sidebar screen",
      root: { type: "screenComponent", props: {}, children: [] },
    },
    i17: {
      type: "screen",
      title: "Info screen",
      root: { type: "screenComponent", props: {}, children: [] },
    },
  },
} satisfies GamePlayerUiContent;

const withLayout = (mode: GameUiLayoutMode | undefined): GamePlayerUiContent => ({
  ...baseUiContent,
  defaultLayoutMode: mode,
});

const screenRouting: Array<ScreenRoutingEntry> = [
  {
    screenKey: "S1_LEFT",
    conditions: { screenId: "S1", layoutMode: "leftsidebar" },
  },
];

describe("screen router", () => {
  it("does not apply a layout-specific route when the manifest declares a different design-time layout", () => {
    expect(resolveScreenKey(screenRouting, "S1", 0, null, withLayout("topbar"))).toBe("S1");
    expect(resolveLayoutModeFromRouting(screenRouting, "S1", 0, null, "topbar")).toBe("topbar");
  });

  it("defaults to topbar when the manifest declares no design-time layout", () => {
    expect(resolveScreenKey(screenRouting, "S1", 0, null, withLayout(undefined))).toBe("S1");
  });

  it("applies a layout-specific route when the manifest declares the matching design-time layout", () => {
    expect(resolveScreenKey(screenRouting, "S1", 0, null, withLayout("leftsidebar"))).toBe("S1_LEFT");
    expect(resolveLayoutModeFromRouting(screenRouting, "S1", 0, null, "leftsidebar")).toBe("leftsidebar");
  });

  it("prefers an explicit info screen over a generic screenId screen", () => {
    expect(resolveScreenKey([], "S1", 31, "i17", withLayout("topbar"))).toBe("i17");
  });

  it("preserves the map-first layout when it is the declared design-time layout", () => {
    expect(resolveLayoutModeFromRouting(undefined, "S1", 0, null, "map-first")).toBe("map-first");
  });
});
