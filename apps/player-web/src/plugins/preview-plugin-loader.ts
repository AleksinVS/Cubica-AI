/**
 * Browser loader for player-web plugin bundles.
 *
 * The loader resolves preview or published bundle URLs against runtime-api,
 * exposes the documented plugin API facade to the bundle, and calls activate()
 * after the browser imports the generated module. Runtime-api passes references
 * only; browser plugin code is never executed on the server.
 */
import type { PlayerWebPluginBundleReference } from "@cubica/contracts-manifest";

import { createScopedPlayerPluginApi } from "./player-plugin-api";
import * as playerPluginApiModule from "./player-plugin-api";

type PreviewPluginModule = {
  readonly activate?: (api: ReturnType<typeof createScopedPlayerPluginApi>) => void | (() => void);
};

/** Active bundle set whose scoped contributions can be released together. */
export interface PlayerWebPluginLoadHandle {
  readonly key: string;
  dispose(): void;
}

const supportedPlayerPluginApiVersion = "2.0";

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
  return (await activatePlayerWebPluginBundles(input)).key;
}

/**
 * Loads bundles and retains ownership of registrations made during activation.
 *
 * The older `loadPlayerWebPluginBundles` wrapper still returns only a key for
 * compatibility. GamePlayer uses this scoped form so switching preview bundle
 * or game removes the previous Phaser factory instead of leaving global state.
 */
export async function activatePlayerWebPluginBundles(input: {
  readonly runtimeApiUrl: string;
  readonly bundles: readonly PlayerWebPluginBundleReference[];
  readonly allowedScopes?: ReadonlySet<PlayerWebPluginBundleReference["scope"]>;
}): Promise<PlayerWebPluginLoadHandle> {
  if (input.bundles.length === 0) {
    return { key: "no-player-web-plugins", dispose() {} };
  }

  globalThis.__cubicaPlayerPluginApiModule = playerPluginApiModule;
  const loadedKeys: string[] = [];
  const disposers: Array<() => void> = [];
  const scopedApi = createScopedPlayerPluginApi((dispose) => disposers.push(dispose));

  try {
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
      const deactivate = loaded.activate(scopedApi);
      if (typeof deactivate === "function") {
        disposers.push(deactivate);
      }
      loadedKeys.push(`${bundle.scope}:${bundle.pluginId}:${bundle.contentHash}`);
    }
  } catch (error) {
    disposeAll(disposers);
    throw error;
  }

  let disposed = false;
  return {
    key: loadedKeys.join("|"),
    dispose() {
      if (!disposed) {
        disposed = true;
        disposeAll(disposers);
      }
    }
  };
}

export const loadPreviewPlayerWebPlugins = loadPlayerWebPluginBundles;

function disposeAll(disposers: Array<() => void>): void {
  for (const dispose of disposers.splice(0).reverse()) {
    dispose();
  }
}
