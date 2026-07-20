/** Unit tests for game-agnostic game-owned stylesheet injection (ADR-091). */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createGameAssetResolver } from "./game-asset-resolver";
import {
  GAME_STYLESHEET_LINK_ATTRIBUTE,
  applyGameStylesheetLinks
} from "./game-stylesheet-links";

const runtimeApiUrl = "http://runtime-api.test/";

const resolver = createGameAssetResolver(
  {
    gameId: "styled-fixture",
    assets: {
      theme: { url: "/game-stylesheets/styled-fixture/theme/aaa.css", kind: "css" },
      extra: { url: "/game-stylesheets/styled-fixture/extra/bbb.css", kind: "css" }
    }
  },
  runtimeApiUrl
);

function injectedLinks(): HTMLLinkElement[] {
  return Array.from(
    document.head.querySelectorAll<HTMLLinkElement>(`link[${GAME_STYLESHEET_LINK_ATTRIBUTE}]`)
  );
}

describe("applyGameStylesheetLinks", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
  });
  afterEach(() => {
    document.head.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("injects one stylesheet link per resolved reference, after platform styles", () => {
    // A pre-existing platform stylesheet stands in for platform-owned CSS.
    const platform = document.createElement("style");
    platform.textContent = ".platform{}";
    document.head.appendChild(platform);

    const dispose = applyGameStylesheetLinks({
      references: ["asset:theme", "asset:extra"],
      resolver,
      warn: () => {}
    });

    const links = injectedLinks();
    expect(links).toHaveLength(2);
    expect(links[0].rel).toBe("stylesheet");
    expect(links[0].getAttribute("href")).toBe(`${runtimeApiUrl}game-stylesheets/styled-fixture/theme/aaa.css`);
    expect(links[1].getAttribute("href")).toBe(`${runtimeApiUrl}game-stylesheets/styled-fixture/extra/bbb.css`);

    // Order: game links come AFTER the platform style node (ADR-091).
    const children = Array.from(document.head.children);
    expect(children.indexOf(platform)).toBeLessThan(children.indexOf(links[0]));

    dispose();
  });

  it("removes exactly the injected links on dispose", () => {
    const unrelated = document.createElement("link");
    unrelated.rel = "stylesheet";
    unrelated.href = "/platform.css";
    document.head.appendChild(unrelated);

    const dispose = applyGameStylesheetLinks({
      references: ["asset:theme"],
      resolver,
      warn: () => {}
    });
    expect(injectedLinks()).toHaveLength(1);

    dispose();
    expect(injectedLinks()).toHaveLength(0);
    // The platform link is untouched.
    expect(document.head.querySelector('link[href="/platform.css"]')).not.toBeNull();
  });

  it("fails closed for an unknown asset id: nothing injected, warning emitted", () => {
    const warn = vi.fn();
    const dispose = applyGameStylesheetLinks({
      references: ["asset:missing"],
      resolver,
      warn
    });

    expect(injectedLinks()).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("fails closed when the resolver is not ready (null)", () => {
    const warn = vi.fn();
    const dispose = applyGameStylesheetLinks({
      references: ["asset:theme"],
      resolver: null,
      warn
    });

    expect(injectedLinks()).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("rejects a reference that does not use the asset:<id> form", () => {
    const warn = vi.fn();
    const dispose = applyGameStylesheetLinks({
      references: ["/platform/theme.css"],
      resolver,
      warn
    });

    expect(injectedLinks()).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    dispose();
  });
});
