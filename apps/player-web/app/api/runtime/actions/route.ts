import { forwardRuntimeRequest } from "../_shared";

export async function POST(request: Request) {
  const body = await request.text();

  return forwardRuntimeRequest("/actions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body
  });
}
