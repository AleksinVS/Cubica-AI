import type { SessionOptions, ViewCommand } from "@cubica/sdk-core";

export interface RouterClient {
  fetchState(sessionId: string | null): Promise<unknown>;
  sendAction(sessionId: string | null, command: ViewCommand): Promise<unknown>;
}

const DEFAULT_TIMEOUT_MS = 10000;

const buildHeaders = (options: SessionOptions) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.authToken) {
    headers.Authorization = `Bearer ${options.authToken}`;
  }
  return headers;
};

/**
 * HTTP adapter for Router API. Uses a simple POST interface compatible с черновым /submit.
 */
export async function createRouterClient(options: SessionOptions): Promise<RouterClient> {
  const baseUrl = options.routerBaseUrl.replace(/\/$/, "");
  const headers = buildHeaders(options);
  const baseTimeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutMs = options.retryCount && options.retryCount > 0 ? baseTimeout * (options.retryCount + 1) : baseTimeout;

  const postJson = async (path: string, body: Record<string, unknown>) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    }).finally(() => clearTimeout(timer));

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Router responded with ${response.status}: ${text}`);
    }

    return response.json();
  };

  return {
    async fetchState(sessionId: string | null) {
      return postJson("/submit", { action: "StartGame", sessionId });
    },
    async sendAction(sessionId: string | null, command: ViewCommand) {
      return postJson("/submit", {
        sessionId,
        action: command.type,
        payload: command.payload
      });
    }
  };
}
