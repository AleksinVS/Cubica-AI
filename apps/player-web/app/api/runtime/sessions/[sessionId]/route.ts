import { forwardRuntimeRequest } from "../../_shared";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  return forwardRuntimeRequest(`/sessions/${sessionId}`, {
    method: "GET"
  });
}
