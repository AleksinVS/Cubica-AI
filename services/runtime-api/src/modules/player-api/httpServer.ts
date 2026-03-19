import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extractInitialState, loadGameBundle } from "../content/manifestLoader.ts";
import { InMemorySessionStore } from "../session/inMemorySessionStore.ts";

interface RuntimeApiServerOptions {
  port?: number;
}

interface JsonRequestBody {
  gameId?: string;
  sessionId?: string;
  playerId?: string;
  actionId?: string;
  payload?: unknown;
}

const sessionStore = new InMemorySessionStore<Record<string, unknown>>();

const sendJson = (response: ServerResponse, statusCode: number, payload: unknown) => {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
};

const readJsonBody = async (request: IncomingMessage): Promise<JsonRequestBody> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) {
    return {};
  }

  const text = Buffer.concat(chunks).toString("utf-8");
  return JSON.parse(text) as JsonRequestBody;
};

export function createRuntimeApiServer(options: RuntimeApiServerOptions = {}) {
  const port = options.port ?? Number(process.env.PORT ?? 3001);

  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        sendJson(response, 200, { status: "ok", service: "runtime-api" });
        return;
      }

      if (request.method === "POST" && request.url === "/sessions") {
        const body = await readJsonBody(request);
        const gameId = body.gameId ?? "antarctica";
        const bundle = await loadGameBundle(gameId);
        const snapshot = await sessionStore.createSession({
          gameId,
          playerId: body.playerId,
          initialState: extractInitialState(bundle) as Record<string, unknown>
        });

        sendJson(response, 201, {
          sessionId: snapshot.sessionId,
          gameId: snapshot.gameId,
          version: snapshot.version,
          state: snapshot.state
        });
        return;
      }

      if (request.method === "GET" && request.url?.startsWith("/sessions/")) {
        const sessionId = request.url.slice("/sessions/".length);
        const snapshot = await sessionStore.getSession(sessionId);

        if (!snapshot) {
          sendJson(response, 404, { error: `Session "${sessionId}" was not found` });
          return;
        }

        sendJson(response, 200, snapshot);
        return;
      }

      if (request.method === "POST" && request.url === "/actions") {
        const body = await readJsonBody(request);

        if (!body.sessionId || !body.actionId) {
          sendJson(response, 400, { error: "sessionId and actionId are required" });
          return;
        }

        const snapshot = await sessionStore.dispatchAction({
          sessionId: body.sessionId,
          playerId: body.playerId,
          actionId: body.actionId,
          payload: body.payload
        });

        sendJson(response, 200, {
          sessionId: snapshot.sessionId,
          version: snapshot.version,
          state: snapshot.state
        });
        return;
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal server error";
      sendJson(response, 500, { error: message });
    }
  });

  return {
    port,
    server,
    start() {
      return new Promise<void>((resolve) => {
        server.listen(port, () => resolve());
      });
    }
  };
}
