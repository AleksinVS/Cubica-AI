/**
 * Server-only runtime proxy helpers.
 *
 * Runtime credentials never cross into browser JSON. Player Web stores one
 * credential per runtime session in an HttpOnly cookie whose name is derived
 * from a hash of the session id, then adds the bearer header only while
 * forwarding same-origin BFF requests to runtime-api.
 */

import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

const runtimeApiUrl = process.env.RUNTIME_API_URL ?? "http://127.0.0.1:3001";
const RUNTIME_CREDENTIAL_COOKIE_PREFIX = "cubica_runtime_";
const RUNTIME_COOKIE_PATH = "/api/runtime";
/**
 * Local sessions survive ordinary browser restarts without exposing the
 * credential to JavaScript. Thirty days bounds abandoned credentials while
 * matching the durable session id kept in localStorage.
 */
const RUNTIME_CREDENTIAL_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const MAX_BROWSER_RUNTIME_BODY_BYTES = 256 * 1024;

type JsonRecord = Record<string, unknown>;

export type BrowserSessionBodyInspection =
  | { readonly ok: true; readonly sessionId: string }
  | { readonly ok: false; readonly error: string };

export type BoundedBrowserBodyResult =
  | { readonly ok: true; readonly body: string }
  | { readonly ok: false; readonly response: NextResponse };

/**
 * Read a browser request with a hard byte cap before JSON parsing or proxying.
 *
 * `Content-Length` is only an optimization: a missing or deliberately smaller
 * header cannot bypass the streaming count.
 */
export async function readBoundedBrowserRuntimeBody(
  request: Request,
  maxBytes = MAX_BROWSER_RUNTIME_BODY_BYTES
): Promise<BoundedBrowserBodyResult> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength)) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Content-Length must be a non-negative integer." }, { status: 400 })
      };
    }
    if (Number(declaredLength) > maxBytes) {
      return { ok: false, response: bodyTooLargeResponse(maxBytes) };
    }
  }

  if (request.body === null) {
    return { ok: true, body: "" };
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let body = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel("runtime request body exceeded its byte limit");
        return { ok: false, response: bodyTooLargeResponse(maxBytes) };
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    return { ok: true, body };
  } finally {
    reader.releaseLock();
  }
}

export function runtimeCredentialCookieName(sessionId: string): string {
  const digest = createHash("sha256").update(sessionId, "utf8").digest("base64url");
  return `${RUNTIME_CREDENTIAL_COOKIE_PREFIX}${digest}`;
}

/**
 * Reads only the routing key needed by the BFF and rejects legacy identity or
 * payload claims before they can cross the browser trust boundary.
 */
export function inspectBrowserSessionBody(body: string): BrowserSessionBodyInspection {
  const parsed = parseRecord(body);
  if (parsed === null || typeof parsed.sessionId !== "string" || parsed.sessionId.trim() === "") {
    return { ok: false, error: "A valid sessionId is required." };
  }
  if (Object.hasOwn(parsed, "playerId") || Object.hasOwn(parsed, "payload")) {
    return { ok: false, error: "playerId and payload are not accepted by the runtime BFF." };
  }
  return { ok: true, sessionId: parsed.sessionId };
}

export async function requestRuntime(path: string, init: RequestInit): Promise<Response> {
  return fetch(new URL(path, runtimeApiUrl), init);
}

export async function forwardRuntimeRequest(path: string, init: RequestInit): Promise<Response> {
  return proxyRuntimeResponse(await requestRuntime(path, init));
}

export async function forwardAuthenticatedRuntimeRequest(
  request: NextRequest,
  sessionId: string,
  path: string,
  init: RequestInit
): Promise<Response> {
  const credential = request.cookies.get(runtimeCredentialCookieName(sessionId))?.value;
  if (!credential) {
    return NextResponse.json(
      { error: "Runtime session credential is missing. Reopen or recreate the session." },
      { status: 401 }
    );
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${credential}`);
  return forwardRuntimeRequest(path, { ...init, headers });
}

/**
 * Converts a credential-bearing create-session response into a browser-safe
 * snapshot and session-scoped HttpOnly cookie.
 */
export async function browserSessionResponse(upstream: Response): Promise<Response> {
  const text = await upstream.text();
  if (!upstream.ok) {
    return proxyRuntimeText(upstream, text);
  }

  const parsed = parseRecord(text);
  if (parsed === null) {
    return NextResponse.json(
      { error: "Runtime create-session response was not a JSON object." },
      { status: 502 }
    );
  }
  const sessionId = parsed.sessionId;
  const credential = parsed.credential;
  if (typeof sessionId !== "string" || sessionId.trim() === "" || typeof credential !== "string" || credential === "") {
    return NextResponse.json(
      { error: "Runtime create-session response did not include a valid session credential." },
      { status: 502 }
    );
  }

  const { credential: _credential, ...safeSnapshot } = parsed;
  const response = NextResponse.json(safeSnapshot, {
    status: upstream.status,
    headers: { "Cache-Control": "no-store" }
  });
  setRuntimeCredentialCookie(response, sessionId, credential);
  return response;
}

/** Adds a runtime credential to an existing server-side handoff response. */
export function setRuntimeCredentialCookie(
  response: NextResponse,
  sessionId: string,
  credential: string
): void {
  response.cookies.set(runtimeCredentialCookieName(sessionId), credential, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: RUNTIME_COOKIE_PATH,
    maxAge: RUNTIME_CREDENTIAL_MAX_AGE_SECONDS
  });
}

export function proxyRuntimeResponse(upstream: Response): Promise<Response> {
  return upstream.text().then((text) => proxyRuntimeText(upstream, text));
}

function proxyRuntimeText(upstream: Response, text: string): Response {
  return new Response(text, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function parseRecord(text: string): JsonRecord | null {
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as JsonRecord
      : null;
  } catch {
    return null;
  }
}

function bodyTooLargeResponse(maxBytes: number): NextResponse {
  return NextResponse.json(
    { error: `Request body exceeds the ${maxBytes}-byte limit.` },
    { status: 413 }
  );
}
