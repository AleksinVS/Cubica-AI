const runtimeApiUrl = process.env.RUNTIME_API_URL ?? "http://127.0.0.1:3001";

export async function forwardRuntimeRequest(path: string, init: RequestInit) {
  const response = await fetch(new URL(path, runtimeApiUrl), init);
  const text = await response.text();

  return new Response(text, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "application/json; charset=utf-8"
    }
  });
}
