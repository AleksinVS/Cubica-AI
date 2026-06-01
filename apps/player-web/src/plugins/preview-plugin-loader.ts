/**
 * Browser loader for player-web plugin bundles.
 *
 * The loader resolves preview or published bundle URLs against runtime-api,
 * exposes the documented plugin API facade to the bundle, and calls activate()
 * after the browser imports the generated module. Runtime-api passes references
 * only; browser plugin code is never executed on the server.
 */
import type { PlayerWebPluginBundleReference } from "@cubica/contracts-manifest";

import { playerPluginApi } from "./player-plugin-api";
import * as playerPluginApiModule from "./player-plugin-api";

type PreviewPluginModule = {
  readonly activate?: (api: typeof playerPluginApi) => void;
};

const supportedPlayerPluginApiVersion = "1.0";

declare global {
  // The generated preview bundle imports the facade from this explicit global
  // instead of resolving private Next.js module paths in the browser.
  // eslint-disable-next-line no-var
  var __cubicaPlayerPluginApiModule: typeof playerPluginApiModule | undefined;
}

export async function loadPlayerWebPluginBundles(input: {
  readonly runtimeApiUrl: string;
  readonly bundles: readonly PlayerWebPluginBundleReference[];
  readonly allowedScopes?: ReadonlySet<PlayerWebPluginBundleReference["scope"]>;
}): Promise<string> {
  if (input.bundles.length === 0) {
    return "no-player-web-plugins";
  }

  globalThis.__cubicaPlayerPluginApiModule = playerPluginApiModule;
  const loadedKeys: string[] = [];

  for (const bundle of input.bundles) {
    if (bundle.target !== "player-web") {
      continue;
    }
    if (bundle.apiVersion !== supportedPlayerPluginApiVersion) {
      throw new Error(`Player plugin "${bundle.pluginId}" uses unsupported apiVersion "${bundle.apiVersion}".`);
    }
    if (input.allowedScopes !== undefined && !input.allowedScopes.has(bundle.scope)) {
      throw new Error(`Player plugin "${bundle.pluginId}" has unexpected bundle scope "${bundle.scope}".`);
    }
    const url = new URL(bundle.url, input.runtimeApiUrl);
    if (url.protocol !== "data:") {
      url.searchParams.set("v", bundle.contentHash);
    }
    const loaded = await import(/* webpackIgnore: true */ url.toString()) as PreviewPluginModule;
    if (typeof loaded.activate !== "function") {
      throw new Error(`Player plugin "${bundle.pluginId}" does not export activate(api).`);
    }
    loaded.activate(playerPluginApi);
    loadedKeys.push(`${bundle.scope}:${bundle.pluginId}:${bundle.contentHash}`);
  }

  return loadedKeys.join("|");
}

export const loadPreviewPlayerWebPlugins = loadPlayerWebPluginBundles;
