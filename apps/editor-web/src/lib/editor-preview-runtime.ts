/** Publishes a compiled editor preview and returns its current-build URL. */
import { randomUUID } from "node:crypto";
import type { EditorCompilerDiagnostic } from "./compiler-workflow";
import type { PlayerWebPluginBundleForRuntime } from "./project-plugin-validation";

const runtimeApiUrl = process.env.RUNTIME_API_URL ?? "http://127.0.0.1:3001";
const playerWebUrl = process.env.PLAYER_WEB_URL ?? "http://127.0.0.1:3000";
const previewRuntimeOperationTimeoutMs = 30_000;

export async function prepareRuntimeSession(
  gameId: string,
  editorOrigin: string | undefined,
  contentSource?: {
    readonly contentSourceId: string;
    readonly contentRoot: string;
    readonly pluginBundles: readonly PlayerWebPluginBundleForRuntime[];
  }
): Promise<{
  readonly ready: boolean;
  readonly playerUrl?: string;
  readonly sessionId?: string;
  readonly diagnostics: readonly EditorCompilerDiagnostic[];
}> {
  try {
    const readyResponse = await fetch(new URL("/readiness", runtimeApiUrl), {
      method: "GET",
      signal: AbortSignal.timeout(2500)
    });
    if (!readyResponse.ok) return readinessFailure(`runtime-api readiness returned HTTP ${readyResponse.status}.`);

    const reloadResponse = await fetch(new URL("/content/reload", runtimeApiUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        gameId,
        contentSourceId: contentSource?.contentSourceId,
        contentRoot: contentSource?.contentRoot,
        pluginBundles: contentSource?.pluginBundles
      }),
      signal: AbortSignal.timeout(previewRuntimeOperationTimeoutMs)
    }).catch((error: unknown) => {
      if (contentSource !== undefined) throw error;
      return undefined;
    });
    if (contentSource !== undefined && reloadResponse !== undefined && !reloadResponse.ok) {
      const body = (await reloadResponse.json().catch(() => ({}))) as { readonly error?: string };
      return readinessFailure(body.error ?? `runtime-api content reload returned HTTP ${reloadResponse.status}.`);
    }

    const playerUrl = new URL(playerWebUrl);
    playerUrl.searchParams.set("gameId", gameId);
    playerUrl.searchParams.set("preview", "1");
    playerUrl.searchParams.set("debugPaused", "true");
    playerUrl.searchParams.set("previewInstanceId", randomUUID());
    if (contentSource !== undefined) playerUrl.searchParams.set("contentSourceId", contentSource.contentSourceId);
    if (editorOrigin !== undefined) playerUrl.searchParams.set("editorOrigin", editorOrigin);

    return { ready: true, playerUrl: playerUrl.toString(), diagnostics: [] };
  } catch (error) {
    return readinessFailure(error instanceof Error ? error.message : "runtime-api is unavailable.");
  }
}

function readinessFailure(message: string): { readonly ready: false; readonly diagnostics: readonly EditorCompilerDiagnostic[] } {
  return {
    ready: false,
    diagnostics: [{ severity: "warning", source: "preview", pointer: "", label: "/", message }]
  };
}
