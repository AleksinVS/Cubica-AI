import { GamePlayer } from "@/components/game-player";
import { getRuntimeApiUrl, loadGamePlayerContent } from "@/lib/game-content-resolvers";
import { resolveGameConfigData } from "@/plugins/game-config-data";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{
    gameId?: string;
    preview?: string;
    sessionId?: string;
    contentSourceId?: string;
    editorOrigin?: string;
  }>;
};

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const gameId = params?.gameId || "antarctica";
  const previewSessionId = params?.preview === "1" && typeof params.sessionId === "string" ? params.sessionId : undefined;
  const previewContentSourceId = previewSessionId && typeof params?.contentSourceId === "string"
    ? params.contentSourceId
    : undefined;
  const content = await loadGamePlayerContent(gameId, { contentSourceId: previewContentSourceId });
  const editorPreviewParentOrigin = previewSessionId && typeof params?.editorOrigin === "string"
    ? normalizeOrigin(params.editorOrigin)
    : undefined;
  const config = previewSessionId
    ? {
        ...resolveGameConfigData(content),
        storageKey: `cubica-preview-${gameId}-${previewSessionId}`
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
      editorPreviewMode={previewSessionId !== undefined}
      editorPreviewParentOrigin={editorPreviewParentOrigin}
      playerPluginBundles={content.pluginBundles ?? []}
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
