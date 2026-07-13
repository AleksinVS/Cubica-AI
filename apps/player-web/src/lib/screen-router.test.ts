import { describe, expect, it } from "vitest";
import type { GamePlayerUiContent, ScreenRoutingEntry } from "@cubica/contracts-manifest";

import { resolveLayoutModeFromRouting, resolveScreenKey } from "./screen-router";

const uiContent = {
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

const screenRouting: Array<ScreenRoutingEntry> = [
  {
    screenKey: "S1_LEFT",
    conditions: { screenId: "S1", layoutMode: "leftsidebar" },
  },
];

describe("screen router", () => {
  it("does not apply a layout-specific route when runtime UI did not request that layout", () => {
    expect(resolveScreenKey(screenRouting, "S1", 0, null, { activeScreen: "topbar" }, uiContent)).toBe("S1");
    expect(resolveLayoutModeFromRouting(screenRouting, "S1", 0, null, { activeScreen: "topbar" })).toBe("topbar");
  });

  it("applies a layout-specific route when runtime UI requests the matching layout", () => {
    expect(resolveScreenKey(screenRouting, "S1", 0, null, { activeScreen: "left-sidebar" }, uiContent)).toBe("S1_LEFT");
    expect(resolveLayoutModeFromRouting(screenRouting, "S1", 0, null, { activeScreen: "left-sidebar" })).toBe("leftsidebar");
  });

  it("prefers an explicit info screen over a generic screenId screen", () => {
    expect(resolveScreenKey([], "S1", 31, "i17", { activeScreen: "topbar" }, uiContent)).toBe("i17");
  });

  it("preserves the map-first runtime layout when explicitly requested", () => {
    expect(resolveLayoutModeFromRouting(undefined, "S1", 0, null, { activeScreen: "map-first" })).toBe("map-first");
  });
});
