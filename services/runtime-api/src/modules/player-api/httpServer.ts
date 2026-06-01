import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpError } from "../errors.ts";
import { SessionService } from "../session/session.service.ts";
import { RuntimeService } from "../runtime/runtime.service.ts";
import {
  clearPlayerFacingContentCache,
  getPublishedPlayerWebPluginBundleSource,
  getPlayerWebPluginBundleFile,
  loadPlayerFacingContent,
  registerLocalPlayerFacingContentSourceWithPlugins,
  type LocalPlayerWebPluginBundle
} from "../content/contentService.ts";
import { buildReadinessResponse } from "../admin/health.ts";
import {
  assertContentSourceId,
  assertGameId,
  parseCreateSessionRequest,
  parseDispatchActionRequest
} from "./requestValidation.ts";

interface RuntimeApiServerOptions {
  port?: number;
}

const sessionService = new SessionService();
const runtimeService = new RuntimeService();
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");
const defaultEditorWorktreesRoot = path.join(repositoryRoot, ".tmp", "editor-worktrees");
// Keep editor preview content local-only while allowing e2e or desktop editor
// runs to point runtime-api at an isolated project Git repository.
const editorWorktreesRoots = parseEditorPreviewWorktreesRoots(
  process.env.EDITOR_PREVIEW_WORKTREES_ROOTS,
  defaultEditorWorktreesRoot
);

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
      const requestUrl = new URL(request.url ?? "/", "http://runtime-api.local");

      if (request.method === "GET" && requestUrl.pathname === "/health") {
        sendJson(response, 200, { status: "ok", service: "runtime-api" });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/readiness") {
        const readinessResponse = await buildReadinessResponse(sessionService.getSessionStore());
        const statusCode = readinessResponse.ready ? 200 : 503;
        sendJson(response, statusCode, readinessResponse);
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/content/reload") {
        const body = await readJsonBody(request);
        const gameId = typeof (body as { gameId?: unknown }).gameId === "string"
          ? (body as { gameId: string }).gameId
          : undefined;
        if (gameId !== undefined) {
          assertGameId(gameId, "gameId");
        }
        const contentSourceId = typeof (body as { contentSourceId?: unknown }).contentSourceId === "string"
          ? (body as { contentSourceId: string }).contentSourceId
          : undefined;
        const contentRoot = typeof (body as { contentRoot?: unknown }).contentRoot === "string"
          ? (body as { contentRoot: string }).contentRoot
          : undefined;
        if (contentSourceId !== undefined) {
          assertContentSourceId(contentSourceId, "contentSourceId");
        }
        if (contentSourceId !== undefined && contentRoot !== undefined) {
          const safeContentRoot = assertEditorPreviewContentRoot(contentRoot);
          registerLocalPlayerFacingContentSourceWithPlugins(
            contentSourceId,
            safeContentRoot,
            parseLocalPlayerWebPluginBundles(body, safeContentRoot)
          );
        }
        const clearedGameIds = clearPlayerFacingContentCache(gameId, contentSourceId);
        sendJson(response, 200, { ok: true, contentSourceId, clearedGameIds });
        return;
      }

      const pluginBundleMatch = request.method === "GET" &&
        requestUrl.pathname.match(/^\/content-sources\/([^/]+)\/plugin-bundles\/([^/]+)\/([a-f0-9]{64})\.mjs$/u);
      if (pluginBundleMatch) {
        const [, encodedContentSourceId, encodedPluginId, contentHash] = pluginBundleMatch;
        const contentSourceId = decodeURIComponent(encodedContentSourceId);
        const pluginId = decodeURIComponent(encodedPluginId);
        assertContentSourceId(contentSourceId, "contentSourceId");
        assertPluginId(pluginId, "pluginId");
        const filePath = getPlayerWebPluginBundleFile({ contentSourceId, pluginId, contentHash });
        const source = await readFile(filePath, "utf8");
        response.writeHead(200, {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
          "Content-Type": "text/javascript; charset=utf-8"
        });
        response.end(source);
        return;
      }

      const publishedPluginBundleMatch = request.method === "GET" &&
        requestUrl.pathname.match(/^\/published-plugin-bundles\/([^/]+)\/([^/]+)\/([a-f0-9]{64})\.mjs$/u);
      if (publishedPluginBundleMatch) {
        const [, gameId, pluginId, contentHash] = publishedPluginBundleMatch;
        assertGameId(gameId, "gameId");
        assertPluginId(pluginId, "pluginId");
        const source = await getPublishedPlayerWebPluginBundleSource({ gameId, pluginId, contentHash });
        response.writeHead(200, {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Type": "text/javascript; charset=utf-8"
        });
        response.end(source);
        return;
      }

      const playerContentMatch = request.method === "GET" && requestUrl.pathname.match(/^\/games\/([^/]+)\/player-content$/);
      if (playerContentMatch) {
        const gameId = playerContentMatch[1];
        assertGameId(gameId, "gameId");
        const contentSourceId = requestUrl.searchParams.get("contentSourceId") ?? undefined;
        if (contentSourceId !== undefined) {
          assertContentSourceId(contentSourceId, "contentSourceId");
        }
        const { content } = await loadPlayerFacingContent({ gameId, contentSourceId });
        sendJson(response, 200, content);
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/sessions") {
        const body = await readJsonBody(request);
        const requestBody = parseCreateSessionRequest(body);
        const snapshot = await sessionService.createSession(requestBody);
        sendJson(response, 201, snapshot);
        return;
      }

      if (request.method === "GET" && requestUrl.pathname.startsWith("/sessions/")) {
        const sessionId = requestUrl.pathname.slice("/sessions/".length);
        const snapshot = await sessionService.getSession(sessionId);

        if (!snapshot) {
          sendJson(response, 404, { error: `Session "${sessionId}" was not found` });
          return;
        }

        sendJson(response, 200, snapshot);
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/actions") {
        const body = await readJsonBody(request);
        const requestBody = parseDispatchActionRequest(body);

        const sessionSnapshot = await sessionService.getSession(requestBody.sessionId);
        if (!sessionSnapshot) {
          throw new HttpError(404, `Session "${requestBody.sessionId}" was not found`);
        }

        const { response: dispatchResponse } = await runtimeService.dispatch({
          sessionStore: sessionService.getSessionStore(),
          gameId: sessionSnapshot.gameId,
          contentSourceId: sessionService.getContentSourceId(requestBody.sessionId),
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

      // eslint-disable-next-line no-console
      console.error("Internal Server Error:", error);
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

function assertEditorPreviewContentRoot(contentRoot: string): string {
  const resolved = path.resolve(contentRoot);
  const isAllowed = editorWorktreesRoots.some((allowedRoot) => {
    return resolved === allowedRoot || resolved.startsWith(`${allowedRoot}${path.sep}`);
  });
  if (!isAllowed) {
    throw new HttpError(400, "contentRoot must point to a local editor preview worktree.");
  }
  return resolved;
}

function parseLocalPlayerWebPluginBundles(body: unknown, contentRoot: string): readonly LocalPlayerWebPluginBundle[] {
  const rawBundles = (body as { readonly pluginBundles?: unknown }).pluginBundles;
  if (rawBundles === undefined) {
    return [];
  }
  if (!Array.isArray(rawBundles)) {
    throw new HttpError(400, "pluginBundles must be an array when provided.");
  }

  return rawBundles.map((rawBundle, index) => {
    if (typeof rawBundle !== "object" || rawBundle === null || Array.isArray(rawBundle)) {
      throw new HttpError(400, `pluginBundles[${index}] must be an object.`);
    }
    const bundle = rawBundle as Record<string, unknown>;
    const pluginId = assertString(bundle.pluginId, `pluginBundles[${index}].pluginId`);
    const gameId = assertString(bundle.gameId, `pluginBundles[${index}].gameId`);
    const apiVersion = assertString(bundle.apiVersion, `pluginBundles[${index}].apiVersion`);
    const target = assertString(bundle.target, `pluginBundles[${index}].target`);
    const scope = typeof bundle.scope === "string" ? bundle.scope : "preview";
    const contentHash = assertString(bundle.contentHash, `pluginBundles[${index}].contentHash`);
    const relativeFilePath = assertString(bundle.filePath, `pluginBundles[${index}].filePath`);

    assertGameId(gameId, `pluginBundles[${index}].gameId`);
    assertPluginId(pluginId, `pluginBundles[${index}].pluginId`);
    if (target !== "player-web") {
      throw new HttpError(400, `pluginBundles[${index}].target must be "player-web".`);
    }
    if (scope !== "preview") {
      throw new HttpError(400, `pluginBundles[${index}].scope must be "preview" for contentSource bundles.`);
    }
    if (!/^[a-f0-9]{64}$/u.test(contentHash)) {
      throw new HttpError(400, `pluginBundles[${index}].contentHash must be a SHA-256 hex digest.`);
    }

    const filePath = assertEditorPreviewRelativeFile(contentRoot, relativeFilePath);
    return { pluginId, gameId, apiVersion, target, scope: "preview", contentHash, filePath };
  });
}

function assertString(value: unknown, pathLabel: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `${pathLabel} must be a non-empty string.`);
  }
  return value;
}

function assertPluginId(value: string, pathLabel: string): void {
  if (!/^[a-z][a-z0-9-]*$/u.test(value)) {
    throw new HttpError(400, `${pathLabel} must be a safe plugin id.`);
  }
}

function assertEditorPreviewRelativeFile(contentRoot: string, relativeFilePath: string): string {
  if (path.isAbsolute(relativeFilePath) || relativeFilePath.includes("\0")) {
    throw new HttpError(400, "plugin bundle filePath must be relative to contentRoot.");
  }
  const resolved = path.resolve(contentRoot, relativeFilePath);
  if (resolved === contentRoot || !resolved.startsWith(`${contentRoot}${path.sep}`)) {
    throw new HttpError(400, "plugin bundle filePath must stay inside contentRoot.");
  }
  return resolved;
}

function parseEditorPreviewWorktreesRoots(rawRoots: string | undefined, fallbackRoot: string): readonly string[] {
  const configuredRoots = (rawRoots ?? "")
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter((item) => item !== "")
    .map((item) => path.resolve(item));

  return configuredRoots.length > 0 ? configuredRoots : [path.resolve(fallbackRoot)];
}
