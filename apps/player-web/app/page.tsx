import { GamePlayer } from "@/components/game-player";
import { getRuntimeApiUrl, loadGamePlayerContent } from "@/lib/game-content-resolvers";
import { resolveGameConfigData } from "@/plugins/game-config-data";
import { ru } from "@/lib/locale";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{
    gameId?: string;
    preview?: string;
    sessionId?: string;
    contentSourceId?: string;
    editorOrigin?: string;
    previewInstanceId?: string;
  }>;
};

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const gameId = params?.gameId;

  // player-web is a game-agnostic host (CLAUDE.md rule 10: no hardcoded game
  // id in platform layers). It cannot guess which game the caller wants, so
  // a missing/empty `?gameId=` must stop here with a clear error instead of
  // silently booting one specific game. This check runs before any session
  // or content fetch, so it never touches session-resume/localStorage logic.
  if (!gameId) {
    return <MissingGameIdScreen />;
  }

  const editorPreviewMode = params?.preview === "1";
  // `sessionId` remains an optional compatibility input for an already-bound
  // browser session. New editor previews intentionally omit it: Player Web must
  // create the session through its BFF so the one-time runtime credential is
  // captured in an HttpOnly cookie instead of being stranded in editor-web.
  const previewSessionId = editorPreviewMode && typeof params?.sessionId === "string" ? params.sessionId : undefined;
  const previewContentSourceId = editorPreviewMode && typeof params?.contentSourceId === "string"
    ? params.contentSourceId
    : undefined;
  const content = await loadGamePlayerContent(gameId, { contentSourceId: previewContentSourceId });
  const editorPreviewParentOrigin = editorPreviewMode && typeof params?.editorOrigin === "string"
    ? normalizeOrigin(params.editorOrigin)
    : undefined;
  const previewStorageScope = editorPreviewMode && typeof params?.previewInstanceId === "string"
    ? params.previewInstanceId
    : previewSessionId ?? previewContentSourceId ?? "temporary";
  const config = editorPreviewMode
    ? {
        ...resolveGameConfigData(content),
        storageKey: `cubica-preview-${gameId}-${previewStorageScope}`
      }
    : resolveGameConfigData(content);

  return (
    <GamePlayer
      runtimeApiUrl={getRuntimeApiUrl()}
      content={content}
      mockups={content.mockups}
      gameUi={content.ui}
      config={config}
      initialSessionId={previewSessionId}
      editorPreviewMode={editorPreviewMode}
      editorPreviewParentOrigin={editorPreviewParentOrigin}
      playerPluginBundles={content.pluginBundles ?? []}
      contentSourceId={previewContentSourceId}
    />
  );
}

function normalizeOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

/**
 * Blocking entry-point error shown when `?gameId=` is missing (or empty) from
 * the URL. It is rendered instead of `GamePlayer`, before any session is
 * created and before any localStorage/session-resume code runs, so it stays
 * out of that parallel workstream. The copy is intentionally generic: it must
 * not name any concrete game (this is the shared platform entry point).
 */
function MissingGameIdScreen() {
  return (
    <main className="entry-error" role="alert" aria-live="assertive">
      <section className="runtime-status-panel">
        <div className="runtime-status-copy">
          <span className="runtime-status-kicker">{ru.entryMissingGameIdKicker}</span>
          <h1>{ru.entryMissingGameIdTitle}</h1>
          <p>{ru.entryMissingGameIdDescription}</p>
        </div>
      </section>
    </main>
  );
}
