/**
 * Server-side portal launch exchange.
 *
 * The browser proves possession of the launch link, while this BFF owns the
 * stable device token and intercepts the runtime bearer before returning the
 * safe session snapshot to JavaScript.
 */

import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  readBoundedBrowserRuntimeBody,
  setRuntimeCredentialCookie
} from "../../runtime/_shared";

const portalApiUrl = process.env.PORTAL_API_URL ?? "http://localhost:1337";
const DEVICE_TOKEN_COOKIE = "cubica_device_token";

type JsonRecord = Record<string, unknown>;

export async function POST(request: NextRequest) {
  // The portal startup exchange is reachable before a runtime credential
  // exists, so it must share the same streaming ingress cap as runtime BFF
  // commands. Content-Length is not trusted by the shared reader.
  const bounded = await readBoundedBrowserRuntimeBody(request);
  if (!bounded.ok) return bounded.response;
  const input = parseJson(bounded.body);
  if (!isRecord(input) || !isNonEmptyString(input.token) || !isNonEmptyString(input.counter)) {
    return NextResponse.json({ ok: false, reason: "token and counter are required" }, { status: 400 });
  }

  const existingDeviceToken = request.cookies.get(DEVICE_TOKEN_COOKIE)?.value;
  const deviceToken = existingDeviceToken ?? randomBytes(16).toString("base64url");
  const upstream = await fetch(
    `${portalApiUrl.replace(/\/$/u, "")}/api/launch-sessions/resolve/${encodeURIComponent(input.token)}/${encodeURIComponent(input.counter)}/runtime-binding`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceToken })
    }
  );
  const payload = await upstream.json().catch(() => null) as unknown;
  if (!isRecord(payload)) {
    return NextResponse.json(
      { ok: false, reason: "Portal runtime binding returned an invalid response." },
      { status: upstream.ok ? 502 : upstream.status }
    );
  }

  const runtimeSession = isRecord(payload.runtimeSession) ? payload.runtimeSession : null;
  const credential = runtimeSession?.credential;
  const sessionId = runtimeSession?.sessionId;
  if (upstream.ok && (!isNonEmptyString(credential) || !isNonEmptyString(sessionId))) {
    return NextResponse.json(
      { ok: false, reason: "Portal runtime binding did not provide a protected session credential." },
      { status: 502 }
    );
  }

  const safePayload = runtimeSession === null
    ? payload
    : {
        ...payload,
        runtimeSession: Object.fromEntries(
          Object.entries(runtimeSession).filter(([key]) => key !== "credential")
        )
      };
  const response = NextResponse.json(safePayload, {
    status: upstream.status,
    headers: { "Cache-Control": "no-store" }
  });

  if (isNonEmptyString(credential) && isNonEmptyString(sessionId)) {
    setRuntimeCredentialCookie(response, sessionId, credential);
  }
  if (existingDeviceToken === undefined) {
    response.cookies.set(DEVICE_TOKEN_COOKIE, deviceToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/api/portal"
    });
  }

  return response;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
