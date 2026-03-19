import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  CreateSessionInput,
  DispatchActionInput
} from "@cubica/contracts-session";
import { HttpError } from "../errors.ts";
import { dispatchRuntimeAction } from "../runtime/actionDispatcher.ts";
import { extractInitialState, loadGameBundle } from "../content/manifestLoader.ts";
import { InMemorySessionStore } from "../session/inMemorySessionStore.ts";
import { parseCreateSessionRequest, parseDispatchActionRequest } from "./requestValidation.ts";

interface RuntimeApiServerOptions {
  port?: number;
}

const sessionStore = new InMemorySessionStore<Record<string, unknown>>();

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

      if (request.method === "POST" && request.url === "/sessions") {
        const body = await readJsonBody(request);
        const requestBody = parseCreateSessionRequest(body);
        const gameId = requestBody.gameId ?? "antarctica";
        const bundle = await loadGameBundle(gameId);
        const createSessionInput = {
          gameId,
          playerId: requestBody.playerId,
          initialState: extractInitialState(bundle) as Record<string, unknown>
        } satisfies CreateSessionInput<Record<string, unknown>>;
        const snapshot = await sessionStore.createSession(createSessionInput);

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
        const requestBody = parseDispatchActionRequest(body);

        const { snapshot } = await dispatchRuntimeAction({
          sessionStore,
          input: {
            sessionId: requestBody.sessionId,
            playerId: requestBody.playerId,
            actionId: requestBody.actionId,
            payload: requestBody.payload
          } satisfies DispatchActionInput
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
