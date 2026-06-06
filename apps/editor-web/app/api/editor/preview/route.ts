/**
 * Prepares a runtime/player preview from editor-web.
 *
 * The route compiles the selected game's authoring manifests, checks runtime
 * readiness over HTTP, creates a runtime-api session when available, and
 * returns a player-web URL. Runtime unavailability is reported as a structured
 * readiness diagnostic with HTTP 200 so the UI can show it without treating it
 * as a route crash.
 */
import {
  compileGameForEditor,
  loadPreviewSelectionSourceMaps,
  type EditorCompilerDiagnostic
} from "@/lib/compiler-workflow";
import { EditorRepositoryError } from "@/lib/editor-repository";
import { evaluateEditorSessionCompatibility, repoRootForSession, touchEditorSession } from "@/lib/editor-session-store";
import { configuredEditorProjectRoot } from "@/lib/editor-project-root";
import {
  validateAndBundleProjectPlugins,
  type PlayerWebPluginBundleForRuntime
} from "@/lib/project-plugin-validation";

export const runtime = "nodejs";

const runtimeApiUrl = process.env.RUNTIME_API_URL ?? "http://127.0.0.1:3001";
const playerWebUrl = process.env.PLAYER_WEB_URL ?? "http://127.0.0.1:3000";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<{
      readonly gameId: string;
      readonly sessionId: string;
    }>;

    if (typeof body.gameId !== "string") {
      throw new EditorRepositoryError("Preview requests require gameId.", 400);
    }

    const { repoRoot, session } = await repoRootForSession(body.sessionId, body.gameId);
    if (session !== undefined) {
      const compatibility = evaluateEditorSessionCompatibility(session);
      if (!compatibility.ok) {
        return Response.json({
          ok: false,
          ready: false,
          gameId: body.gameId,
          diagnostics: compatibility.diagnostics.map((message) => previewReadinessDiagnostic(`upgrade required: ${message}`)),
          artifacts: []
        });
      }
    }

    const workflowRepoRoot = repoRoot ?? configuredEditorProjectRoot();
    const compile = await compileGameForEditor({ gameId: body.gameId, checkOnly: false, repoRoot: workflowRepoRoot });
    if (!compile.ok) {
      if (session !== undefined) {
        await touchEditorSession(session.sessionId);
      }
      return Response.json({
        ok: false,
        ready: false,
        gameId: body.gameId,
        diagnostics: compile.diagnostics,
        artifacts: compile.artifacts
      });
    }

    const pluginValidation = session === undefined
      ? { ok: true, diagnostics: [], playerWebBundles: [] }
      : await validateAndBundleProjectPlugins({ gameId: body.gameId, repoRoot: session.worktreePath });
    if (!pluginValidation.ok) {
      if (session !== undefined) {
        await touchEditorSession(session.sessionId);
      }
      return Response.json({
        ok: false,
        ready: false,
        gameId: body.gameId,
        diagnostics: pluginValidation.diagnostics,
        artifacts: compile.artifacts
      });
    }

    const readiness = await prepareRuntimeSession(body.gameId, requestOrigin(request), session === undefined
      ? undefined
      : {
          contentSourceId: session.sessionId,
          contentRoot: session.worktreePath,
          pluginBundles: pluginValidation.playerWebBundles
        });
    if (session !== undefined) {
      await touchEditorSession(session.sessionId);
    }
    const sourceMaps = readiness.ready ? await loadPreviewSelectionSourceMaps(body.gameId, workflowRepoRoot) : [];
    return Response.json({
      ok: readiness.ready,
      ready: readiness.ready,
      gameId: body.gameId,
      playerUrl: readiness.playerUrl,
      sessionId: readiness.sessionId,
      sourceMaps,
      diagnostics: readiness.diagnostics,
      artifacts: compile.artifacts
    });
  } catch (error) {
    return errorResponse(error);
  }
}

async function prepareRuntimeSession(
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
    if (!readyResponse.ok) {
      return readinessFailure(`runtime-api readiness returned HTTP ${readyResponse.status}.`);
    }

    const reloadResponse = await fetch(new URL("/content/reload", runtimeApiUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        gameId,
        contentSourceId: contentSource?.contentSourceId,
        contentRoot: contentSource?.contentRoot,
        pluginBundles: contentSource?.pluginBundles
      }),
      signal: AbortSignal.timeout(2500)
    }).catch((error: unknown) => {
      if (contentSource !== undefined) {
        throw error;
      }
      return undefined;
    });
    if (contentSource !== undefined && reloadResponse !== undefined && !reloadResponse.ok) {
      const body = (await reloadResponse.json().catch(() => ({}))) as { readonly error?: string };
      return readinessFailure(body.error ?? `runtime-api content reload returned HTTP ${reloadResponse.status}.`);
    }

    const sessionResponse = await fetch(new URL("/sessions", runtimeApiUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameId, playerId: "editor-preview", contentSourceId: contentSource?.contentSourceId }),
      signal: AbortSignal.timeout(2500)
    });
    if (!sessionResponse.ok) {
      const body = (await sessionResponse.json().catch(() => ({}))) as { readonly error?: string };
      return readinessFailure(body.error ?? `runtime-api session creation returned HTTP ${sessionResponse.status}.`);
    }

    const session = (await sessionResponse.json()) as { readonly sessionId?: string };
    if (typeof session.sessionId !== "string") {
      return readinessFailure("runtime-api did not return a sessionId for preview.");
    }

    const playerUrl = new URL(playerWebUrl);
    playerUrl.searchParams.set("gameId", gameId);
    playerUrl.searchParams.set("preview", "1");
    playerUrl.searchParams.set("sessionId", session.sessionId);
    if (contentSource !== undefined) {
      playerUrl.searchParams.set("contentSourceId", contentSource.contentSourceId);
    }
    if (editorOrigin !== undefined) {
      playerUrl.searchParams.set("editorOrigin", editorOrigin);
    }

    return {
      ready: true,
      playerUrl: playerUrl.toString(),
      sessionId: session.sessionId,
      diagnostics: []
    };
  } catch (error) {
    return readinessFailure(error instanceof Error ? error.message : "runtime-api is unavailable.");
  }
}

function requestOrigin(request: Request): string | undefined {
  const headerOrigin = request.headers.get("origin");
  if (headerOrigin !== null) {
    return headerOrigin;
  }

  try {
    return new URL(request.url).origin;
  } catch {
    return undefined;
  }
}

function readinessFailure(message: string): {
  readonly ready: false;
  readonly diagnostics: readonly EditorCompilerDiagnostic[];
} {
  return {
    ready: false,
    diagnostics: [previewReadinessDiagnostic(message)]
  };
}

function previewReadinessDiagnostic(message: string): EditorCompilerDiagnostic {
  return {
    severity: "warning",
    source: "preview",
    pointer: "",
    label: "/",
    message
  };
}

function errorResponse(error: unknown): Response {
  if (error instanceof EditorRepositoryError) {
    return Response.json({ error: error.message }, { status: error.statusCode });
  }

  return Response.json({ error: error instanceof Error ? error.message : "Unexpected editor preview failure." }, { status: 500 });
}
