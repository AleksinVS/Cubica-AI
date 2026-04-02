import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "../errors.ts";
import { SessionService } from "../session/session.service.ts";
import { RuntimeService } from "../runtime/runtime.service.ts";
import { loadPlayerFacingContent } from "../content/contentService.ts";
import { buildReadinessResponse } from "../admin/health.ts";
import { parseCreateSessionRequest, parseDispatchActionRequest } from "./requestValidation.ts";

interface RuntimeApiServerOptions {
  port?: number;
}

const sessionService = new SessionService();
const runtimeService = new RuntimeService();

const sendJson = (response: ServerResponse, statusCode: number, payload: unknown) => {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
};

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) {
    return {};
  }

  const text = Buffer.concat(chunks).toString("utf-8");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
};

export function createRuntimeApiServer(options: RuntimeApiServerOptions = {}) {
  const port = options.port ?? Number(process.env.PORT ?? 3001);
  let activePort = port;

  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        sendJson(response, 200, { status: "ok", service: "runtime-api" });
        return;
      }

      if (request.method === "GET" && request.url === "/readiness") {
        const readinessResponse = await buildReadinessResponse(sessionService.getSessionStore());
        const statusCode = readinessResponse.ready ? 200 : 503;
        sendJson(response, statusCode, readinessResponse);
        return;
      }

      const playerContentMatch = request.method === "GET" && request.url?.match(/^\/games\/([^/]+)\/player-content$/);
      if (playerContentMatch) {
        const gameId = playerContentMatch[1];
        const { content } = await loadPlayerFacingContent({ gameId });
        sendJson(response, 200, content);
        return;
      }

      if (request.method === "POST" && request.url === "/sessions") {
        const body = await readJsonBody(request);
        const requestBody = parseCreateSessionRequest(body);
        const snapshot = await sessionService.createSession(requestBody);
        sendJson(response, 201, snapshot);
        return;
      }

      if (request.method === "GET" && request.url?.startsWith("/sessions/")) {
        const sessionId = request.url.slice("/sessions/".length);
        const snapshot = await sessionService.getSession(sessionId);

        if (!snapshot) {
          sendJson(response, 404, { error: `Session "${sessionId}" was not found` });
          return;
        }

        sendJson(response, 200, snapshot);
        return;
      }

      if (request.method === "POST" && request.url === "/actions") {
        const body = await readJsonBody(request);
        const requestBody = parseDispatchActionRequest(body);

        const sessionSnapshot = await sessionService.getSession(requestBody.sessionId);
        if (!sessionSnapshot) {
          throw new HttpError(404, `Session "${requestBody.sessionId}" was not found`);
        }

        const { response: dispatchResponse } = await runtimeService.dispatch({
          sessionStore: sessionService.getSessionStore(),
          gameId: sessionSnapshot.gameId,
          input: {
            sessionId: requestBody.sessionId,
            playerId: requestBody.playerId,
            actionId: requestBody.actionId,
            payload: requestBody.payload
          }
        });

        sendJson(response, 200, dispatchResponse);
        return;
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(response, error.statusCode, { error: error.message });
        return;
      }

      const message = error instanceof Error ? error.message : "Internal server error";
      sendJson(response, 500, { error: message });
    }
  });

  return {
    get port() {
      return activePort;
    },
    server,
    start() {
      return new Promise<void>((resolve) => {
        server.listen(port, () => {
          const address = server.address();
          if (address && typeof address === "object") {
            activePort = address.port;
          }
          resolve();
        });
      });
    }
  };
}
