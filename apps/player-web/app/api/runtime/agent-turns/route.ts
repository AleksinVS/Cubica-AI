import { forwardRuntimeRequest } from "../_shared";

/**
 * Browser-safe proxy for Agent Turn requests.
 *
 * Player channels must talk to Cubica runtime-api, not directly to model
 * providers. This route keeps the same-origin browser boundary while the
 * runtime-api validates and persists accepted Agent Runtime output.
 */
export async function POST(request: Request) {
  const body = await request.text();

  return forwardRuntimeRequest("/agent-turns", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body
  });
}
