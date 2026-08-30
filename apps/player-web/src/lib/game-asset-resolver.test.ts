/** Unit tests for one-request asset index caching and fail-closed id lookup. */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearGameAssetResolverCache,
  createGameAssetResolver,
  loadGameAssetResolver,
  resolveGameAssetReference,
  resolveThemeBackgroundStyle,
  uiUsesGameAssets
} from "./game-asset-resolver";

const index = {
  gameId: "test-game",
  assets: {
    board: { url: "/game-assets/test-game/board/abc.svg", kind: "image" as const },
    token: { url: "/game-assets/test-game/token/def.png", kind: "image" as const }
  }
};

afterEach(() => {
  clearGameAssetResolverCache();
  vi.unstubAllGlobals();
});

describe("game asset resolver", () => {
  it("resolves ids against runtime-api and fails fast for unknown ids", () => {
    const resolver = createGameAssetResolver(index, "https://runtime.example/base");
    expect(resolver.ids()).toEqual(["board", "token"]);
    expect(resolver.url("board")).toBe("https://runtime.example/game-assets/test-game/board/abc.svg");
    expect(() => resolver.url("missing")).toThrow(/not available/u);
  });

  it("fetches an index once per runtime/game pair", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(index), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    const first = loadGameAssetResolver({ runtimeApiUrl: "https://runtime.example", gameId: "test-game" });
    const second = loadGameAssetResolver({ runtimeApiUrl: "https://runtime.example", gameId: "test-game" });

    expect(await first).toBe(await second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns an empty resolver when index delivery fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const resolver = await loadGameAssetResolver({ runtimeApiUrl: "https://runtime.example", gameId: "test-game" });
    expect(resolver.ids()).toEqual([]);
    expect(() => resolver.url("board")).toThrow(/not available/u);
  });

  it("resolves asset references, preserves URLs and drops unknown ids", () => {
    const resolver = createGameAssetResolver(index, "https://runtime.example");
    const warn = vi.fn();
    expect(resolveGameAssetReference("/images/legacy.png", resolver, warn)).toBe("/images/legacy.png");
    expect(resolveGameAssetReference("asset:board", resolver, warn)).toContain("/game-assets/test-game/board/");
    expect(resolveGameAssetReference("asset:missing", resolver, warn)).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("detects asset references and interactive board surfaces without game knowledge", () => {
    expect(uiUsesGameAssets({ root: { type: "interactiveBoardSurface" } })).toBe(true);
    expect(uiUsesGameAssets({ props: { backgroundImage: "asset:board" } })).toBe(true);
    expect(uiUsesGameAssets({ props: { backgroundImage: "/images/legacy.png" } })).toBe(false);
  });

  // TSK-20260719 R4b: resolveThemeBackgroundStyle generalizes the asset:<id>
  // channel to the one config-level (plugin-owned) image reference, so a game
  // plugin's themeBackgroundImage resolves the same way as any UI-manifest
  // image property.
  describe("resolveThemeBackgroundStyle", () => {
    it("builds the CSS custom property from a resolved asset: reference", () => {
      const resolver = createGameAssetResolver(index, "https://runtime.example");
      const style = resolveThemeBackgroundStyle("asset:board", resolver);
      expect(style).toEqual({
        "--game-background-image": 'url("https://runtime.example/game-assets/test-game/board/abc.svg")'
      });
    });

    it("passes an ordinary path/URL through unchanged (pre-ADR-063 games)", () => {
      const resolver = createGameAssetResolver(index, "https://runtime.example");
      const style = resolveThemeBackgroundStyle("/images/legacy-theme.png", resolver);
      expect(style).toEqual({
        "--game-background-image": 'url("/images/legacy-theme.png")'
      });
    });

    it("returns undefined (no CSS property) when there is no configured background", () => {
      const resolver = createGameAssetResolver(index, "https://runtime.example");
      expect(resolveThemeBackgroundStyle(undefined, resolver)).toBeUndefined();
    });

    it("fails closed and warns when the asset id is unknown or the resolver is not ready yet", () => {
      const resolver = createGameAssetResolver(index, "https://runtime.example");
      const warn = vi.fn();
      expect(resolveThemeBackgroundStyle("asset:missing-theme", resolver, warn)).toBeUndefined();
      expect(warn).toHaveBeenCalledOnce();

      const warnWhileLoading = vi.fn();
      expect(resolveThemeBackgroundStyle("asset:board", null, warnWhileLoading)).toBeUndefined();
      expect(warnWhileLoading).toHaveBeenCalledOnce();
    });
  });
});
