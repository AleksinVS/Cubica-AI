// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "../../app/api/runtime/sessions/[sessionId]/facilitator-debrief/route";
import { runtimeCredentialCookieName } from "../../app/api/runtime/_shared";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const context = (sessionId: string) => ({ params: Promise.resolve({ sessionId }) });

describe("facilitator debrief Player BFF", () => {
  it("GETs through the session cookie and encodes the upstream path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest("http://player-web.local/api/runtime/sessions/session%2F1/facilitator-debrief", {
      headers: { Cookie: `${runtimeCredentialCookieName("session/1")}=secret-bearer` }
    });

    const response = await GET(request, context("session/1"));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/sessions/session%2F1/facilitator-debrief" }),
      expect.objectContaining({ method: "GET" })
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer secret-bearer");
  });

  it("does not call runtime without the matching credential", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(
      new NextRequest("http://player-web.local/api/runtime/sessions/session-1/facilitator-debrief"),
      context("session-1")
    );
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs only the canonical expectedStateVersion body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const cookie = `${runtimeCredentialCookieName("session-1")}=secret-bearer`;
    const request = new NextRequest("http://player-web.local/api/runtime/sessions/session-1/facilitator-debrief", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ expectedStateVersion: 7 })
    });

    const response = await POST(request, context("session-1"));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/sessions/session-1/facilitator-debrief" }),
      expect.objectContaining({ method: "POST", body: JSON.stringify({ expectedStateVersion: 7 }) })
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer secret-bearer");
  });

  it.each([
    { label: "invalid JSON", body: "not-json" },
    { label: "extra field", body: JSON.stringify({ expectedStateVersion: 7, retry: true }) },
    { label: "negative version", body: JSON.stringify({ expectedStateVersion: -1 }) },
    { label: "missing version", body: JSON.stringify({}) }
  ])("rejects $label before runtime", async ({ body }) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest("http://player-web.local/api/runtime/sessions/session-1/facilitator-debrief", {
      method: "POST",
      headers: { Cookie: `${runtimeCredentialCookieName("session-1")}=secret-bearer` },
      body
    });

    const response = await POST(request, context("session-1"));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed route params before reading credentials", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(
      new NextRequest("http://player-web.local/api/runtime/sessions//facilitator-debrief"),
      context(" ")
    );
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
