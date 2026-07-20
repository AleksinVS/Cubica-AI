// @vitest-environment node
/** Focused security tests for the Player Web runtime credential boundary. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import playerWebConfig from "../../next.config";
import { POST as resolvePortalRuntimeSession } from "../../app/api/portal/runtime-session/route";
import {
  browserSessionResponse,
  forwardAuthenticatedRuntimeRequest,
  proxyRuntimeResponse,
  readBoundedBrowserRuntimeBody,
  runtimeCredentialCookieName
} from "../../app/api/runtime/_shared";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("runtime BFF credential handoff", () => {
  it("keeps every browser runtime path behind an explicit local route handler", async () => {
    const configuredRewrites = playerWebConfig.rewrites === undefined
      ? []
      : await playerWebConfig.rewrites();
    const rewriteGroups = Array.isArray(configuredRewrites)
      ? configuredRewrites
      : [
          ...(configuredRewrites.beforeFiles ?? []),
          ...(configuredRewrites.afterFiles ?? []),
          ...(configuredRewrites.fallback ?? [])
        ];

    expect(
      rewriteGroups.filter((rewrite) => rewrite.source.startsWith("/api/runtime"))
    ).toEqual([]);
  });

  it("moves create-session credential into a session-scoped HttpOnly cookie", async () => {
    const response = await browserSessionResponse(new Response(JSON.stringify({
      sessionId: "session-1",
      gameId: "neutral",
      credential: "secret-bearer",
      version: { sessionId: "session-1", stateVersion: 0, lastEventSequence: 0 },
      state: { public: {}, secret: {} },
      actionAvailability: []
    }), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    }));

    expect(await response.json()).not.toHaveProperty("credential");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${runtimeCredentialCookieName("session-1")}=secret-bearer`);
    expect(cookie).toMatch(/HttpOnly/iu);
    expect(cookie).toMatch(/SameSite=strict/iu);
    expect(cookie).toContain("Path=/api/runtime");
    expect(cookie).toContain("Max-Age=2592000");
  });

  it("rejects a declared body above the ingress cap before reading it", async () => {
    const request = new Request("http://player-web.local/api/runtime/actions", {
      method: "POST",
      headers: { "Content-Length": "9" },
      body: "{}"
    });

    const result = await readBoundedBrowserRuntimeBody(request, 8);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });

  it("enforces the streaming cap when Content-Length is absent or deceptive", async () => {
    const missing = new Request("http://player-web.local/api/runtime/actions", {
      method: "POST",
      body: "123456789"
    });
    const missingResult = await readBoundedBrowserRuntimeBody(missing, 8);
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) expect(missingResult.response.status).toBe(413);

    const deceptive = new Request("http://player-web.local/api/runtime/actions", {
      method: "POST",
      headers: { "Content-Length": "2" },
      body: "123456789"
    });
    const deceptiveResult = await readBoundedBrowserRuntimeBody(deceptive, 8);
    expect(deceptiveResult.ok).toBe(false);
    if (!deceptiveResult.ok) expect(deceptiveResult.response.status).toBe(413);
  });

  it("adds the matching bearer only inside the server-side proxy", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const cookieName = runtimeCredentialCookieName("session-1");
    const request = new NextRequest("http://player-web.local/api/runtime/actions", {
      headers: { Cookie: `${cookieName}=secret-bearer` }
    });

    const response = await forwardAuthenticatedRuntimeRequest(
      request,
      "session-1",
      "/actions",
      { method: "POST", body: "{}" }
    );

    expect(response.status).toBe(200);
    const upstreamInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(upstreamInit.headers).get("Authorization")).toBe("Bearer secret-bearer");
  });

  it("forwards only canonical action timing diagnostics from runtime", async () => {
    const response = await proxyRuntimeResponse(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Server-Timing": [
          "total;dur=6",
          "dispatch;dur=1.2",
          "action-availability;dur=3.000",
          "projection;dur=2",
          "scheduler;dur=0.5"
        ].join(", "),
        "Set-Cookie": "runtime-secret=must-not-cross",
        "X-Runtime-Internal": "must-not-cross"
      }
    }));

    expect(response.headers.get("Server-Timing")).toBe([
      "dispatch;dur=1.200",
      "scheduler;dur=0.500",
      "projection;dur=2.000",
      "action-availability;dur=3.000",
      "total;dur=6.000"
    ].join(", "));
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("X-Runtime-Internal")).toBeNull();
  });

  it("drops the complete timing header when it contains an unknown metric", async () => {
    const response = await proxyRuntimeResponse(new Response("{}", {
      headers: {
        "Server-Timing": [
          "dispatch;dur=1.000",
          "projection;dur=2.000",
          "action-availability;dur=3.000",
          "total;dur=6.000",
          "session-secret;dur=1.000"
        ].join(", ")
      }
    }));

    expect(response.headers.get("Server-Timing")).toBeNull();
  });

  it("does not call runtime when the session credential is absent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest("http://player-web.local/api/runtime/actions");

    const response = await forwardAuthenticatedRuntimeRequest(
      request,
      "session-1",
      "/actions",
      { method: "POST", body: "{}" }
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caps portal startup bodies even when Content-Length is absent or deceptive", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const oversizedBody = "x".repeat(256 * 1024 + 1);

    const missingLength = new NextRequest("http://player-web.local/api/portal/runtime-session", {
      method: "POST",
      body: oversizedBody
    });
    const missingResponse = await resolvePortalRuntimeSession(missingLength);
    expect(missingResponse.status).toBe(413);

    const deceptiveLength = new NextRequest("http://player-web.local/api/portal/runtime-session", {
      method: "POST",
      headers: { "Content-Length": "2" },
      body: oversizedBody
    });
    const deceptiveResponse = await resolvePortalRuntimeSession(deceptiveLength);
    expect(deceptiveResponse.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
