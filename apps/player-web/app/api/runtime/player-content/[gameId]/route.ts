import { forwardRuntimeRequest } from "../../_shared";

type RouteContext = {
  params: Promise<{
    gameId: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  const { gameId } = await context.params;
  return forwardRuntimeRequest(`/games/${gameId}/player-content`, {
    method: "GET"
  });
}