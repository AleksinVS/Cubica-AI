import { forwardRuntimeRequest } from "../../_shared";

type RouteContext = {
  params: Promise<{
    gameId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { gameId } = await context.params;
  const requestUrl = new URL(request.url);
  const runtimePath = new URL(`/games/${gameId}/player-content`, "http://player-web.local");
  const contentSourceId = requestUrl.searchParams.get("contentSourceId");
  if (contentSourceId !== null) {
    runtimePath.searchParams.set("contentSourceId", contentSourceId);
  }

  return forwardRuntimeRequest(`${runtimePath.pathname}${runtimePath.search}`, {
    method: "GET"
  });
}
