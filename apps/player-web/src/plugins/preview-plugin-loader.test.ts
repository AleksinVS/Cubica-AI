import { describe, expect, it } from "vitest";
import type { PlayerFacingContent, PlayerWebPluginBundleReference } from "@cubica/contracts-manifest";

import { resolveRegisteredGameConfigData } from "@/presenter/game-config-registry";
import {
  activatePlayerWebPluginBundles,
  loadPreviewPlayerWebPlugins
} from "./preview-plugin-loader";
import {
  resolveAccessibleBoardActionsProvider,
  resolvePhaserSceneFactory
} from "./phaser-scene-registry";

describe("preview plugin loader", () => {
  it("loads a session plugin module and lets it replace config data without a player-web restart", async () => {
    const gameId = "preview-loader-test";
    const source = `
      export function activate(api) {
        api.registerGameConfigData({
          gameId: "${gameId}",
          storageKey: "session-plugin-storage",
          fallbackMetrics: [],
          topbarScreenKeys: [],
          metricBackgroundImages: {}
        });
      }
    `;
    const bundle: PlayerWebPluginBundleReference = {
      pluginId: "preview-player",
      gameId,
      apiVersion: "2.0",
      target: "player-web",
      scope: "preview",
      contentHash: "a".repeat(64),
      url: `data:text/javascript;base64,${Buffer.from(source, "utf8").toString("base64")}`
    };

    const key = await loadPreviewPlayerWebPlugins({
      runtimeApiUrl: "http://runtime-api.local",
      bundles: [bundle]
    });
    const fallback = {
      gameId,
      storageKey: "fallback-storage",
      fallbackMetrics: [],
      topbarScreenKeys: [],
      metricBackgroundImages: {}
    };
    const content = {
      gameId,
      version: "1.0.0",
      name: "Preview",
      description: "Preview",
      locale: "ru",
      playerConfig: { min: 1, max: 1 },
      actions: [],
      mockups: []
    } satisfies PlayerFacingContent;

    expect(key).toBe(`${bundle.scope}:${bundle.pluginId}:${bundle.contentHash}`);
    expect(resolveRegisteredGameConfigData(content, fallback).storageKey).toBe("session-plugin-storage");
  });

  it("rejects a preview bundle when production scope is required", async () => {
    const bundle: PlayerWebPluginBundleReference = {
      pluginId: "preview-player",
      gameId: "preview-loader-test-scope",
      apiVersion: "2.0",
      target: "player-web",
      scope: "preview",
      contentHash: "b".repeat(64),
      url: "data:text/javascript,export function activate(){}"
    };

    await expect(loadPreviewPlayerWebPlugins({
      runtimeApiUrl: "http://runtime-api.local",
      bundles: [bundle],
      allowedScopes: new Set(["published"])
    })).rejects.toThrow(/unexpected bundle scope/);
  });

  it("loads a published plugin module through the same bundle contract", async () => {
    const gameId = "published-loader-test";
    const source = `
      export function activate(api) {
        api.registerGameConfigData({
          gameId: "${gameId}",
          storageKey: "published-plugin-storage",
          fallbackMetrics: [],
          topbarScreenKeys: [],
          metricBackgroundImages: {}
        });
      }
    `;
    const bundle: PlayerWebPluginBundleReference = {
      pluginId: "published-player",
      gameId,
      apiVersion: "2.0",
      target: "player-web",
      scope: "published",
      contentHash: "c".repeat(64),
      integrity: "sha256-test",
      url: `data:text/javascript;base64,${Buffer.from(source, "utf8").toString("base64")}`
    };

    const key = await loadPreviewPlayerWebPlugins({
      runtimeApiUrl: "http://runtime-api.local",
      bundles: [bundle],
      allowedScopes: new Set(["published"])
    });

    expect(key).toBe(`${bundle.scope}:${bundle.pluginId}:${bundle.contentHash}`);
  });

  it("releases scene and accessible-action contributions with its scoped bundle handle", async () => {
    const gameId = "scoped-board-plugin";
    const source = `
      export function activate(api) {
        api.registerPhaserSceneFactory("${gameId}", () => ({
          scene: {}, updateSession() {}, destroy() {}
        }));
        api.registerAccessibleBoardActionsProvider("${gameId}", () => ([{
          id: "move", label: "Move", actionId: "board.move"
        }]));
      }
    `;
    const bundle: PlayerWebPluginBundleReference = {
      pluginId: "scoped-board-player",
      gameId,
      apiVersion: "2.0",
      target: "player-web",
      scope: "preview",
      contentHash: "d".repeat(64),
      url: `data:text/javascript;base64,${Buffer.from(source, "utf8").toString("base64")}`
    };

    const handle = await activatePlayerWebPluginBundles({
      runtimeApiUrl: "http://runtime-api.local",
      bundles: [bundle]
    });

    expect(resolvePhaserSceneFactory(gameId)).toBeTypeOf("function");
    expect(resolveAccessibleBoardActionsProvider(gameId)).toBeTypeOf("function");
    handle.dispose();
    expect(resolvePhaserSceneFactory(gameId)).toBeUndefined();
    expect(resolveAccessibleBoardActionsProvider(gameId)).toBeUndefined();
  });
});
