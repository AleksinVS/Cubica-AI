import { forwardRuntimeRequest } from "../../../_shared";

type RouteContext = {
  params: Promise<{
    gameId: string;
  }>;
};

/**
 * Browser-safe proxy for game-specific readiness.
 *
 * AI-driven games need Agent Runtime readiness before the player creates or
 * resumes a session. The browser still talks only to player-web; runtime-api
 * remains the authoritative owner of dependency checks.
 */
export async function GET(request: Request, context: RouteContext) {
  const { gameId } = await context.params;
  const requestUrl = new URL(request.url);
  const runtimePath = new URL(`/games/${gameId}/readiness`, "http://player-web.local");
  const contentSourceId = requestUrl.searchParams.get("contentSourceId");
  if (contentSourceId !== null) {
    runtimePath.searchParams.set("contentSourceId", contentSourceId);
  }

  return forwardRuntimeRequest(`${runtimePath.pathname}${runtimePath.search}`, {
    method: "GET"
  });
}
