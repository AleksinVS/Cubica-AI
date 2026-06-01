import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  runPluginValidationProcess,
  validateAndBundleProjectPlugins
} from "./project-plugin-validation";

const repoRoot = path.resolve(process.cwd(), ".tmp", "project-plugin-validation-tests");

describe("project-local plugin validation", () => {
  beforeEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
    await writeMinimalPlatformApi(repoRoot);
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("validates plugin.json through the JSON Schema and builds a preview bundle", async () => {
    await writePlugin({
      gameId: "demo-game",
      pluginId: "demo-player",
      source: `
        import type { PlayerPluginApi } from "@cubica/player-web/plugin-api";

        export function activate(api: PlayerPluginApi): void {
          api.registerGameConfigData({ gameId: "demo-game", playerId: "p", storageKey: "s", fallbackMetrics: [], topbarScreenKeys: [], metricBackgroundImages: {} });
        }
      `
    });

    const result = await validateAndBundleProjectPlugins({ repoRoot, gameId: "demo-game" });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.playerWebBundles).toHaveLength(1);
    expect(result.playerWebBundles[0]).toMatchObject({
      pluginId: "demo-player",
      gameId: "demo-game",
      target: "player-web"
    });
    expect(result.playerWebBundles[0].filePath).toMatch(/^\.tmp\/editor-plugin-bundles\/demo-game\/demo-player\/[a-f0-9]{64}\.mjs$/u);
  }, 20_000);

  it("rejects npm dependencies while dependenciesPolicy is platform-only", async () => {
    await writePlugin({
      gameId: "demo-game",
      pluginId: "demo-player",
      packageJsonExtra: {
        dependencies: {
          lodash: "1.0.0"
        }
      }
    });

    const result = await validateAndBundleProjectPlugins({ repoRoot, gameId: "demo-game" });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toContain("dependenciesPolicy=platform-only forbids package.json dependencies");
  });

  it("rejects unsafe package script declarations instead of executing shell strings", async () => {
    await writePlugin({
      gameId: "demo-game",
      pluginId: "demo-player",
      packageJsonExtra: {
        scripts: {
          typecheck: "echo unsafe && rm -rf .tmp"
        }
      }
    });

    const result = await validateAndBundleProjectPlugins({ repoRoot, gameId: "demo-game" });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toContain("script \"typecheck\" must be declared as");
  });

  it("reports validation process timeouts and failures", async () => {
    const timeout = await runPluginValidationProcess({
      file: process.execPath,
      args: ["-e", "setTimeout(() => {}, 1000)"],
      cwd: repoRoot,
      timeoutMs: 25
    });
    const failure = await runPluginValidationProcess({
      file: process.execPath,
      args: ["-e", "process.stderr.write('boom'); process.exit(7)"],
      cwd: repoRoot,
      timeoutMs: 1000
    });

    expect(timeout.ok).toBe(false);
    expect(timeout.timedOut).toBe(true);
    expect(failure.ok).toBe(false);
    expect(failure.exitCode).toBe(7);
    expect(failure.stderr).toContain("boom");
  });

  it("keeps manifest-driven games plugin-free", async () => {
    await mkdir(path.join(repoRoot, "games", "simple-choice"), { recursive: true });

    const result = await validateAndBundleProjectPlugins({ repoRoot, gameId: "simple-choice" });

    expect(result.ok).toBe(true);
    expect(result.playerWebBundles).toEqual([]);
  });
});

async function writeMinimalPlatformApi(root: string): Promise<void> {
  const filePath = path.join(root, "apps", "player-web", "src", "plugins", "player-plugin-api.ts");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `
      export interface GameConfigData {
        gameId: string;
        playerId: string;
        storageKey: string;
        fallbackMetrics: readonly unknown[];
        topbarScreenKeys: readonly string[];
        metricBackgroundImages: Record<string, string>;
      }
      export interface PlayerPluginApi {
        registerGameConfigData(data: GameConfigData): void;
        registerGameConfigFactory(gameId: string, factory: unknown): void;
      }
    `,
    "utf8"
  );
}

async function writePlugin(input: {
  readonly gameId: string;
  readonly pluginId: string;
  readonly source?: string;
  readonly packageJsonExtra?: Record<string, unknown>;
}): Promise<void> {
  const pluginRoot = path.join(repoRoot, "games", input.gameId, "plugins", input.pluginId);
  await mkdir(path.join(pluginRoot, "src"), { recursive: true });
  await writeFile(
    path.join(pluginRoot, "plugin.json"),
    `${JSON.stringify({
      $schema: "../../../../docs/architecture/schemas/plugin.schema.json",
      id: input.pluginId,
      gameId: input.gameId,
      apiVersion: "1.0",
      targets: {
        "player-web": {
          entry: "src/index.ts",
          contributes: {
            gameConfigFactory: true
          }
        }
      },
      validation: {
        typecheck: "typecheck"
      },
      permissions: {
        network: false,
        filesystem: "plugin-root-only",
        environment: []
      },
      dependenciesPolicy: "platform-only"
    }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(pluginRoot, "package.json"),
    `${JSON.stringify({
      name: `@cubica/${input.pluginId}`,
      private: true,
      type: "module",
      scripts: {
        typecheck: "tsc -p tsconfig.json --noEmit"
      },
      ...input.packageJsonExtra
    }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(pluginRoot, "src", "index.ts"),
    input.source ?? `
      import type { PlayerPluginApi } from "@cubica/player-web/plugin-api";

      export function activate(api: PlayerPluginApi): void {
        void api;
      }
    `,
    "utf8"
  );
}
