/**
 * Server-only runtime proxy helpers.
 *
 * The controller credential never crosses into browser JSON. Player Web stores
 * one credential per runtime session in an HttpOnly cookie whose name is
 * derived from a hash of the session id, then adds the bearer header only while
 * forwarding same-origin BFF requests to runtime-api.
 *
 * Private-session creation is the narrow exception: the host browser receives
 * guest bearer capabilities long enough to render invite links. They remain
 * JavaScript-readable until the host dismisses that creation-only surface;
 * imported participant credentials are immediately moved to HttpOnly cookies.
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
const MAX_SERVER_TIMING_HEADER_LENGTH = 512;
const MAX_SERVER_TIMING_DURATION_MS = Number.MAX_SAFE_INTEGER;
const RUNTIME_SERVER_TIMING_METRICS = [
  "dispatch",
  "scheduler",
  "reload",
  "projection",
  "action-availability",
  "total"
] as const;
const REQUIRED_RUNTIME_SERVER_TIMING_METRICS = new Set([
  "dispatch",
  "projection",
  "action-availability",
  "total"
]);
const RUNTIME_SERVER_TIMING_METRIC_PATTERN =
  /^(dispatch|scheduler|reload|projection|action-availability|total);dur=(\d+(?:\.\d{1,3})?)$/u;

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
 * Proxies a downloadable runtime document without converting its body to text.
 * Public journal bytes are already canonical JSON from runtime-api; decoding
 * and re-encoding them in the BFF could change Unicode or escape sequences.
 */
export async function forwardAuthenticatedRuntimeDownloadRequest(
  request: NextRequest,
  sessionId: string,
  path: string,
  init: RequestInit = { method: "GET" }
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
  return proxyPublicJournalResponse(await requestRuntime(path, { ...init, headers }));
}

/**
 * Keeps only the download headers needed by the public journal contract.
 * Runtime diagnostics, cookies and internal identifiers must not cross BFF.
 */
export async function proxyPublicJournalResponse(upstream: Response): Promise<Response> {
  const body = await upstream.arrayBuffer();
  const headers = new Headers({
    "Content-Type": sanitizePublicJournalContentType(upstream.headers.get("content-type")),
    "Cache-Control": "no-store"
  });
  const contentDisposition = sanitizePublicJournalContentDisposition(
    upstream.headers.get("content-disposition")
  );
  if (contentDisposition !== null) {
    headers.set("Content-Disposition", contentDisposition);
  }

  return new Response(body, {
    status: upstream.status,
    headers
  });
}

function sanitizePublicJournalContentType(value: string | null): string {
  if (value !== null && /^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(value.trim())) {
    return value.trim();
  }
  return "application/json; charset=utf-8";
}

function sanitizePublicJournalContentDisposition(value: string | null): string | null {
  if (value === null || value.length > 512 || /[\r\n]/u.test(value)) {
    return null;
  }
  const normalized = value.trim();
  if (
    !/^attachment;\s*filename(?:\*|)=(?:"[^"\r\n]{1,240}"|UTF-8''[A-Za-z0-9._~%+-]{1,240})$/u.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

/**
 * Converts a credential-bearing create-session response into a browser-safe
 * snapshot and session-scoped HttpOnly cookie.
 */
export async function browserSessionResponse(
  upstream: Response,
  options: { readonly secureCookie?: boolean } = {}
): Promise<Response> {
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
  setRuntimeCredentialCookie(response, sessionId, credential, { secure: options.secureCookie });
  return response;
}

/** Adds a runtime credential to an existing server-side handoff response. */
export function setRuntimeCredentialCookie(
  response: NextResponse,
  sessionId: string,
  credential: string,
  options: { readonly secure?: boolean } = {}
): void {
  response.cookies.set(runtimeCredentialCookieName(sessionId), credential, {
    httpOnly: true,
    sameSite: "strict",
    secure: options.secure ?? process.env.NODE_ENV === "production",
    path: RUNTIME_COOKIE_PATH,
    maxAge: RUNTIME_CREDENTIAL_MAX_AGE_SECONDS
  });
}

/**
 * Keeps production credentials Secure except for an explicit loopback-only E2E
 * opt-in. The hostname check prevents the test flag from weakening a deployed
 * non-local origin if it is accidentally propagated outside the test runner.
 */
export function runtimeCredentialCookieIsSecure(request: Request): boolean {
  if (process.env.NODE_ENV !== "production") {
    return false;
  }
  if (process.env.CUBICA_ALLOW_INSECURE_LOCAL_RUNTIME_COOKIE !== "1") {
    return true;
  }
  try {
    const hostname = new URL(request.url).hostname;
    return hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "[::1]" && hostname !== "::1";
  } catch {
    return true;
  }
}

export function proxyRuntimeResponse(upstream: Response): Promise<Response> {
  return upstream.text().then((text) => proxyRuntimeText(upstream, text));
}

function proxyRuntimeText(upstream: Response, text: string): Response {
  // This is a deliberate response-header allowlist. In particular, cookies,
  // authentication challenges and arbitrary diagnostic headers from the
  // internal runtime must never cross the browser-facing trust boundary.
  const headers = new Headers({
    "Content-Type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  const serverTiming = sanitizeRuntimeServerTiming(upstream.headers.get("server-timing"));
  if (serverTiming !== null) {
    headers.set("Server-Timing", serverTiming);
  }

  return new Response(text, {
    status: upstream.status,
    headers
  });
}

/**
 * Validate and canonicalize the one diagnostic header allowed through the
 * browser-facing proxy.
 *
 * The accepted grammar is deliberately narrower than the full Server-Timing
 * standard: known metric names plus a non-negative decimal duration. This
 * keeps runtime-provided descriptions or extension parameters from becoming a
 * channel for session data, secrets or response-header injection.
 */
export function sanitizeRuntimeServerTiming(value: string | null): string | null {
  if (value === null || value.length === 0 || value.length > MAX_SERVER_TIMING_HEADER_LENGTH) {
    return null;
  }

  const accepted = new Map<string, number>();
  for (const rawMetric of value.split(",")) {
    const match = RUNTIME_SERVER_TIMING_METRIC_PATTERN.exec(rawMetric.trim());
    if (match === null) {
      return null;
    }
    const [, metricName, rawDuration] = match;
    if (accepted.has(metricName)) {
      return null;
    }
    const duration = Number(rawDuration);
    if (
      !Number.isFinite(duration) ||
      duration < 0 ||
      duration > MAX_SERVER_TIMING_DURATION_MS
    ) {
      return null;
    }
    accepted.set(metricName, duration);
  }

  for (const metricName of REQUIRED_RUNTIME_SERVER_TIMING_METRICS) {
    if (!accepted.has(metricName)) {
      return null;
    }
  }

  return RUNTIME_SERVER_TIMING_METRICS
    .flatMap((metricName) => {
      const duration = accepted.get(metricName);
      return duration === undefined
        ? []
        : [`${metricName};dur=${duration.toFixed(3)}`];
    })
    .join(", ");
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
