// @vitest-environment node
/** Focused security tests for the Player Web runtime credential boundary. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import playerWebConfig from "../../next.config";
import { POST as resolvePortalRuntimeSession } from "../../app/api/portal/runtime-session/route";
import { POST as importPrivateInviteSession } from "../../app/api/runtime/sessions/import/route";
import { POST as createRuntimeSession } from "../../app/api/runtime/sessions/route";
import { GET as subscribeRuntimeSessionEvents } from "../../app/api/runtime/sessions/[sessionId]/events/route";
import { POST as restorePreviewRuntimeSession } from "../../app/api/runtime/sessions/[sessionId]/route";
import { GET as downloadPublicJournal } from "../../app/api/runtime/sessions/[sessionId]/public-journal/route";
import {
  browserSessionResponse,
  forwardAuthenticatedRuntimeRequest,
  forwardAuthenticatedRuntimeDownloadRequest,
  proxyRuntimeResponse,
  proxyPublicJournalResponse,
  readBoundedBrowserRuntimeBody,
  runtimeCredentialCookieIsSecure,
  runtimeCredentialCookieName
} from "../../app/api/runtime/_shared";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("runtime BFF credential handoff", () => {
  const privateInvite = {
    credential: `ses_${"a".repeat(43)}`
  } as const;

  const importRequest = (body: string | Record<string, unknown>): NextRequest => new NextRequest(
    "http://player-web.local/api/runtime/sessions/import",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body)
    }
  );

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

  it("rejects private-invite preview content at the BFF canonical boundary", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest("http://player-web.local/api/runtime/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gameId: "neutral-game",
        contentSourceId: "preview-source",
        accessMode: "private-invite"
      })
    });

    const response = await createRuntimeSession(request);

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
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

  it("allows an insecure production cookie only for an explicitly enabled loopback E2E origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CUBICA_ALLOW_INSECURE_LOCAL_RUNTIME_COOKIE", "1");

    expect(runtimeCredentialCookieIsSecure(new Request("http://localhost:3300/api/runtime/sessions"))).toBe(false);
    expect(runtimeCredentialCookieIsSecure(new Request("http://127.0.0.1:3300/api/runtime/sessions"))).toBe(false);
    expect(runtimeCredentialCookieIsSecure(new Request("http://player.example.test/api/runtime/sessions"))).toBe(true);
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

  it("downloads exact journal bytes with the matching credential and strict headers", async () => {
    const journal = JSON.stringify({
      format: "cubica.public-gameplay-journal",
      schemaVersion: "1.0.0",
      summary: "Публичное событие 🚂",
      entries: [{ data: { label: "Привет, мир" } }]
    });
    const bytes = new TextEncoder().encode(journal);
    const fetchMock = vi.fn().mockResolvedValue(new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="journal.json"',
        "Cache-Control": "no-store",
        "Set-Cookie": "runtime-secret=must-not-cross",
        "X-Runtime-Internal": "must-not-cross"
      }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const cookieName = runtimeCredentialCookieName("session/1");
    const request = new NextRequest("http://player-web.local/api/runtime/sessions/session%2F1/public-journal", {
      headers: { Cookie: `${cookieName}=secret-bearer` }
    });

    const response = await downloadPublicJournal(request, {
      params: Promise.resolve({ sessionId: "session/1" })
    });

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="journal.json"');
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("X-Runtime-Internal")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/sessions/session%2F1/public-journal" }),
      expect.objectContaining({ method: "GET" })
    );
    const upstreamInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(upstreamInit.headers).get("Authorization")).toBe("Bearer secret-bearer");
  });

  it("does not fetch a journal without its session credential", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest("http://player-web.local/api/runtime/sessions/session-1/public-journal");

    const response = await forwardAuthenticatedRuntimeDownloadRequest(
      request,
      "session-1",
      "/sessions/session-1/public-journal"
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves error bytes while dropping invalid or unexpected download headers", async () => {
    const bytes = new TextEncoder().encode('{"error":"Ошибка 🚫"}');
    const response = await proxyPublicJournalResponse(new Response(bytes, {
      status: 503,
      headers: {
        "Content-Type": "text/plain",
        "Content-Disposition": "inline; filename=secret.txt",
        "Cache-Control": "public, max-age=60",
        "X-Principal-Id": "must-not-cross"
      }
    }));

    expect(response.status).toBe(503);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Principal-Id")).toBeNull();
  });

  it("restores preview state through the active session's HttpOnly credential", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ sessionId: "session-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const cookieName = runtimeCredentialCookieName("session-1");
    const body = JSON.stringify({
      state: { public: { ready: true } },
      version: { stateVersion: 0, lastEventSequence: 0 },
      targetEventSequence: 0,
      reason: "editor-preview-rollback"
    });
    const request = new NextRequest("http://player-web.local/api/runtime/sessions/session-1", {
      method: "POST",
      headers: {
        Cookie: `${cookieName}=secret-bearer`,
        "Content-Type": "application/json"
      },
      body
    });

    const response = await restorePreviewRuntimeSession(request, {
      params: Promise.resolve({ sessionId: "session-1" })
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/sessions/session-1/preview-restore" }),
      expect.objectContaining({ method: "POST", body })
    );
    const upstreamInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(upstreamInit.headers).get("Authorization")).toBe("Bearer secret-bearer");
  });

  it("preserves runtime's 403 when an invite participant attempts preview restore", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const cookieName = runtimeCredentialCookieName("session-1");
    const request = new NextRequest("http://player-web.local/api/runtime/sessions/session-1", {
      method: "POST",
      headers: {
        Cookie: `${cookieName}=participant-bearer`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ state: {}, version: { stateVersion: 0, lastEventSequence: 0 } })
    });

    const response = await restorePreviewRuntimeSession(request, {
      params: Promise.resolve({ sessionId: "session-1" })
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("Set-Cookie")).toBeNull();
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

  it.each([
    ["malformed JSON", "{"],
    ["invalid invite shape", JSON.stringify({ sessionId: "session-1", invite: { seatId: "seat-2" } })]
  ])("rejects %s before contacting runtime for private invite import", async (_label, body) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await importPrivateInviteSession(importRequest(body));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized private invite import body with 413 before parsing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const oversized = JSON.stringify({
      sessionId: "session-1",
      invite: { ...privateInvite, credential: `ses_${"a".repeat(256 * 1024)}` }
    });

    const response = await importPrivateInviteSession(importRequest(oversized));

    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("imports the canonical invite shape, strips private fields and sets the session cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      sessionId: "session-1",
      gameId: "neutral-game",
      participants: [{ seatId: "seat-2", playerId: "player-2", joinState: "private-invite" }],
      credential: "upstream-secret-must-not-win",
      privateInvites: [privateInvite],
      state: { public: {}, secret: {} }
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await importPrivateInviteSession(importRequest({
      sessionId: "session-1",
      invite: privateInvite
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).not.toHaveProperty("credential");
    expect(payload).not.toHaveProperty("privateInvites");
    expect(payload).toMatchObject({ sessionId: "session-1", gameId: "neutral-game" });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${runtimeCredentialCookieName("session-1")}=${privateInvite.credential}`);
    expect(cookie).toMatch(/HttpOnly/iu);
    expect(cookie).toMatch(/SameSite=strict/iu);
    expect(cookie).toContain("Path=/api/runtime");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/sessions/session-1" }),
      expect.objectContaining({ method: "GET" })
    );
    const upstreamInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(upstreamInit.headers).get("Authorization")).toBe(`Bearer ${privateInvite.credential}`);
  });

  it("fails closed instead of replacing a different credential cookie", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const cookieName = runtimeCredentialCookieName("session-1");
    const request = new NextRequest("http://player-web.local/api/runtime/sessions/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${cookieName}=ses_${"b".repeat(43)}`
      },
      body: JSON.stringify({ sessionId: "session-1", invite: privateInvite })
    });

    const response = await importPrivateInviteSession(request);

    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats importing the exact credential already in the cookie as idempotent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      sessionId: "session-1",
      gameId: "neutral-game",
      participants: [{ seatId: "seat-2", playerId: "player-2", joinState: "private-invite" }],
      state: { public: {} }
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const cookieName = runtimeCredentialCookieName("session-1");
    const request = new NextRequest("http://player-web.local/api/runtime/sessions/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${cookieName}=${privateInvite.credential}`
      },
      body: JSON.stringify({ sessionId: "session-1", invite: privateInvite })
    });

    const response = await importPrivateInviteSession(request);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    [401, 401],
    [403, 401],
    [429, 429],
    [500, 500]
  ])("maps private invite upstream HTTP %s to the browser status %s", async (upstreamStatus, expectedStatus) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "internal detail" }), {
      status: upstreamStatus,
      headers: { "Set-Cookie": "runtime-secret=must-not-cross" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await importPrivateInviteSession(importRequest({
      sessionId: "session-1",
      invite: privateInvite
    }));

    expect(response.status).toBe(expectedStatus);
    expect(await response.json()).toEqual({ error: "Invite link is not available." });
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("returns 401 when the SSE credential cookie is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest("http://player-web.local/api/runtime/sessions/session-1/events");

    const response = await subscribeRuntimeSessionEvents(request, {
      params: Promise.resolve({ sessionId: "session-1" })
    });

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([429, 503])("returns safe JSON and no-store when the upstream SSE request fails with %s", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "secret upstream detail" }), {
      status,
      headers: {
        "Content-Type": "text/event-stream",
        ...(status === 429 ? { "Retry-After": "1" } : {}),
        "Set-Cookie": "runtime-secret=must-not-cross",
        "X-Internal": "must-not-cross"
      }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const cookieName = runtimeCredentialCookieName("session-1");
    const request = new NextRequest("http://player-web.local/api/runtime/sessions/session-1/events", {
      headers: { Cookie: `${cookieName}=secret-bearer` }
    });

    const response = await subscribeRuntimeSessionEvents(request, {
      params: Promise.resolve({ sessionId: "session-1" })
    });

    expect(response.status).toBe(status);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("X-Internal")).toBeNull();
    expect(response.headers.get("Retry-After")).toBe(status === 429 ? "1" : null);
    expect(await response.json()).toEqual({ error: "Session event stream is unavailable." });
  });

  it("preserves a successful SSE body as a stream with event-stream and no-store headers", async () => {
    const upstreamBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          `event: version\ndata: ${JSON.stringify({ stateVersion: 2, lastEventSequence: 4 })}\n\n`
        ));
        controller.close();
      }
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(upstreamBody, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "private",
        "Set-Cookie": "runtime-secret=must-not-cross"
      }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const cookieName = runtimeCredentialCookieName("session-1");
    const request = new NextRequest("http://player-web.local/api/runtime/sessions/session-1/events", {
      headers: { Cookie: `${cookieName}=secret-bearer` }
    });

    const response = await subscribeRuntimeSessionEvents(request, {
      params: Promise.resolve({ sessionId: "session-1" })
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Connection")).toBe("keep-alive");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(await response.text()).toContain("event: version");
    const upstreamInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(upstreamInit.headers).get("Authorization")).toBe("Bearer secret-bearer");
    expect(new Headers(upstreamInit.headers).get("Accept")).toBe("text/event-stream");
  });
});
