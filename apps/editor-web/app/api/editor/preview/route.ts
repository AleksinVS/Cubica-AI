/**
 * Prepares a runtime/player preview from editor-web.
 *
 * The route compiles the selected game's authoring manifests, checks runtime
 * readiness over HTTP, publishes the temporary content source, and returns a
 * player-web URL. Player Web creates the browser-owned runtime session through
 * its credential-protecting BFF after the iframe loads. Runtime unavailability is reported as a structured
 * readiness diagnostic with HTTP 200 so the UI can show it without treating it
 * as a route crash.
 */
import {
  compileGameForEditor,
  loadPreviewSelectionSourceMaps,
  type EditorCompilerDiagnostic
} from "@/lib/compiler-workflow";
import { EditorRepositoryError } from "@/lib/editor-repository";
import { evaluateEditorSessionCompatibility, repoRootForSession, withEditorSessionMutationLease } from "@/lib/editor-session-store";
import { configuredEditorProjectRoot } from "@/lib/editor-project-root";
import { validateAndBundleProjectPlugins } from "@/lib/project-plugin-validation";
import { prepareRuntimeSession } from "@/lib/editor-preview-runtime";
import {
  copyCandidatePluginBundles,
  createEditorCurrentPreview,
  recoverPendingEditorCurrentPreview
} from "@/lib/editor-mutation-candidate";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<{
      readonly gameId: string;
      readonly sessionId: string;
      readonly reuseLivePreview: boolean;
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

    if (session !== undefined) {
      return withEditorSessionMutationLease(session.sessionId, "preview-build", () =>
        buildSessionPreview(body.gameId!, session.sessionId, session.worktreePath, requestOrigin(request), body.reuseLivePreview === true)
      );
    }

    const workflowRepoRoot = repoRoot ?? configuredEditorProjectRoot();
    const compile = await compileGameForEditor({ gameId: body.gameId, checkOnly: false, repoRoot: workflowRepoRoot });
    if (!compile.ok) {
      return Response.json({
        ok: false,
        ready: false,
        gameId: body.gameId,
        diagnostics: compile.diagnostics,
        artifacts: compile.artifacts
      });
    }

    const readiness = await prepareRuntimeSession(body.gameId, requestOrigin(request));
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

async function buildSessionPreview(
  gameId: string,
  sessionId: string,
  worktreeRoot: string,
  origin: string | undefined,
  reuseLivePreview: boolean
): Promise<Response> {
  // Finish any registration whose HTTP result was ambiguous before allocating
  // another root. Until then both possible runtime roots must remain available.
  const pending = await recoverPendingEditorCurrentPreview({ repoRoot: worktreeRoot, sessionId });
  if (pending !== undefined) {
    const recovery = await prepareRuntimeSession(gameId, origin, {
      contentSourceId: sessionId,
      contentRoot: pending.repoRoot,
      pluginBundles: pending.pluginBundles
    });
    if (!recovery.ready) {
      return Response.json({ ok: false, ready: false, gameId, diagnostics: recovery.diagnostics, artifacts: [] });
    }
    await pending.commit();
  }

  const current = await createEditorCurrentPreview({ repoRoot: worktreeRoot, sessionId, gameId });
  try {
    const compile = await compileGameForEditor({
      gameId, checkOnly: false, repoRoot: worktreeRoot, generatedArtifactRoot: current.repoRoot
    });
    if (!compile.ok) {
      return Response.json({ ok: false, ready: false, gameId, diagnostics: compile.diagnostics, artifacts: compile.artifacts });
    }
    const pluginValidation = await validateAndBundleProjectPlugins({ gameId, repoRoot: worktreeRoot });
    if (!pluginValidation.ok) {
      return Response.json({
        ok: false, ready: false, gameId,
        diagnostics: pluginValidation.diagnostics,
        artifacts: compile.artifacts
      });
    }
    await copyCandidatePluginBundles({
      sourceRoot: worktreeRoot,
      candidateRoot: current.repoRoot,
      relativeFilePaths: pluginValidation.playerWebBundles.map((bundle) => bundle.filePath)
    });
    const sourceMaps = await loadPreviewSelectionSourceMaps(gameId, worktreeRoot, current.repoRoot);
    const identity = await comparePublishedPreview(current.previousRoot, current.repoRoot, gameId,
      compile.artifacts.filter((artifact) => artifact.kind === "ui").map((artifact) => artifact.generatedFile));
    if (reuseLivePreview && identity.sameGameplay && identity.sameUi) {
      // No player-facing bytes changed. Keep the registered root and live frame.
      return Response.json({ ok: true, ready: true, gameId, refreshKind: "unchanged",
        sourceMaps, diagnostics: [], artifacts: compile.artifacts });
    }
    await current.stage(pluginValidation.playerWebBundles);
    const readiness = await prepareRuntimeSession(gameId, origin, {
      contentSourceId: sessionId,
      contentRoot: current.repoRoot,
      pluginBundles: pluginValidation.playerWebBundles
    });
    if (readiness.ready) await current.commit();
    return Response.json({
      ok: readiness.ready,
      ready: readiness.ready,
      gameId,
      playerUrl: readiness.playerUrl,
      refreshKind: reuseLivePreview && identity.sameGameplay ? "ui" : "restart",
      sessionId: readiness.sessionId,
      sourceMaps: readiness.ready ? sourceMaps : [],
      diagnostics: readiness.diagnostics,
      artifacts: compile.artifacts
    });
  } finally {
    await current.discard();
  }
}

async function comparePublishedPreview(previousRoot: string | undefined, nextRoot: string,
  gameId: string, uiFiles: readonly string[]): Promise<{ sameGameplay: boolean; sameUi: boolean }> {
  if (previousRoot === undefined) return { sameGameplay: false, sameUi: false };
  const gameManifest = `games/${gameId}/game.manifest.json`;
  // The generated game manifest owns both rules and the typed Mechanics IR.
  // Plugins can change resolver behavior independently. The player also caches
  // the content-source asset index for the frame lifetime, so changed assets
  // require a new frame to avoid retaining stale hashed URLs.
  const sameGameplay = await sameFile(previousRoot, nextRoot, gameManifest) &&
    await sameTree(path.join(previousRoot, "games", gameId, "plugins"),
      path.join(nextRoot, "games", gameId, "plugins")) &&
    await sameTree(path.join(previousRoot, "games", gameId, "assets"),
      path.join(nextRoot, "games", gameId, "assets"));
  if (!sameGameplay) return { sameGameplay: false, sameUi: false };
  const uiComparisons = await Promise.all(uiFiles.map((file) => sameFile(previousRoot, nextRoot, file)));
  return { sameGameplay: true, sameUi: uiComparisons.every(Boolean) };
}

async function sameFile(leftRoot: string, rightRoot: string, file: string): Promise<boolean> {
  try {
    const [left, right] = await Promise.all([readFile(path.join(leftRoot, file)), readFile(path.join(rightRoot, file))]);
    return left.equals(right);
  } catch { return false; }
}

async function sameTree(left: string, right: string): Promise<boolean> {
  const entries = async (directory: string) => {
    try { return (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  };
  const [leftEntries, rightEntries] = await Promise.all([entries(left), entries(right)]);
  if (leftEntries.length !== rightEntries.length) return false;
  for (let index = 0; index < leftEntries.length; index += 1) {
    const a = leftEntries[index]!;
    const b = rightEntries[index]!;
    if (a.name !== b.name || a.isDirectory() !== b.isDirectory() || a.isFile() !== b.isFile()) return false;
    if (a.isDirectory()) {
      if (!await sameTree(path.join(left, a.name), path.join(right, b.name))) return false;
    } else if (a.isFile()) {
      if (!await sameFile(left, right, a.name)) return false;
    } else return false;
  }
  return true;
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
