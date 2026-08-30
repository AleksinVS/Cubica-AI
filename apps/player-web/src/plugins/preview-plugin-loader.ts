/**
 * Browser loader for player-web plugin bundles.
 *
 * The loader resolves preview or published bundle URLs against runtime-api,
 * fetches their exact bytes, verifies every declared SHA-256 integrity digest,
 * and only then imports those same verified bytes. Runtime-api passes
 * references only; browser plugin code is never executed on the server.
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
      const bundleBytes = await fetchVerifiedBundleBytes(bundle, url);
      // A data module is constructed from the bytes already hashed above. An
      // import of the original network URL would create a second fetch and a
      // time-of-check/time-of-use gap in which different bytes could execute.
      const verifiedModuleUrl = `data:text/javascript;base64,${bytesToBase64(bundleBytes)}`;
      const loaded = await import(/* webpackIgnore: true */ verifiedModuleUrl) as PreviewPluginModule;
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

/** Fetch and verify a bundle before any of its JavaScript can execute. */
async function fetchVerifiedBundleBytes(
  bundle: PlayerWebPluginBundleReference,
  url: URL
): Promise<Uint8Array> {
  const expectedIntegrity = bundle.integrity;
  if (bundle.scope === "published" && expectedIntegrity === undefined) {
    throw new Error(`Published player plugin "${bundle.pluginId}" is missing its required SHA-256 integrity digest.`);
  }
  if (expectedIntegrity !== undefined && !/^sha256-[A-Za-z0-9+/]{43}=$/u.test(expectedIntegrity)) {
    throw new Error(`Player plugin "${bundle.pluginId}" has an invalid SHA-256 integrity digest.`);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Player plugin "${bundle.pluginId}" bundle request failed with HTTP ${response.status}.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());

  // Preview bundles are short-lived editor artifacts. Their explicit exception
  // is only that integrity may be absent; when the editor supplies a digest it
  // is verified exactly like a published artifact.
  if (expectedIntegrity !== undefined) {
    if (globalThis.crypto?.subtle === undefined) {
      throw new Error(`Player plugin "${bundle.pluginId}" cannot be verified because browser cryptography is unavailable.`);
    }
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
    const actualIntegrity = `sha256-${bytesToBase64(digest)}`;
    if (actualIntegrity !== expectedIntegrity) {
      throw new Error(`Player plugin "${bundle.pluginId}" failed SHA-256 integrity verification.`);
    }
  }

  return bytes;
}

/** Encode bytes without depending on Node's Buffer in the browser bundle. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function disposeAll(disposers: Array<() => void>): void {
  for (const dispose of disposers.splice(0).reverse()) {
    dispose();
  }
}
