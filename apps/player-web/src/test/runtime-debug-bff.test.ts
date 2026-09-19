// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST, DELETE } from "../../app/api/runtime/sessions/[sessionId]/debug/[[...operation]]/route";
import { runtimeCredentialCookieName } from "../../app/api/runtime/_shared";

afterEach(() => { vi.unstubAllGlobals(); });

function request(method: string, authenticated = true, body?: string) {
  return new NextRequest("http://localhost/api/runtime/sessions/origin/debug", {
    method,
    headers: {
      ...(authenticated ? { cookie: `${runtimeCredentialCookieName("origin")}=origin-secret` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(body === undefined ? {} : { body })
  });
}

function context(operation?: string[]) {
  return { params: Promise.resolve({ sessionId: "origin", operation }) };
}

describe("debug BFF", () => {
  it("requires the origin session credential before contacting runtime", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request("POST", false), context(["pause"]));
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards only allowlisted routes with the server cookie credential", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ paused: true })));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request("POST", true, '{"expectedStateVersion":4}'), context(["pause"]));
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe("/sessions/origin/debug/pause");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer origin-secret");
    expect(init.body).toBe('{"expectedStateVersion":4}');
    const unknown = await GET(request("GET"), context(["checkpoints", "saved", "raw"]));
    expect(unknown.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("forwards checkpoint CRUD through origin authentication and installs restored credential only in HttpOnly cookie", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL) => String(url).endsWith("/restore")
      ? new Response(JSON.stringify({ sessionId: "restored", credential: "new-secret", debugPaused: true, state: { public: {} } }))
      : new Response(JSON.stringify({ checkpoints: [] })));
    vi.stubGlobal("fetch", fetchMock);
    const listed = await GET(request("GET"), context(["checkpoints"]));
    expect(listed.status).toBe(200);
    const saved = await POST(request("POST", true, '{"label":"First turn"}'), context(["checkpoints"]));
    expect(saved.status).toBe(200);
    const deleted = await DELETE(request("DELETE"), context(["checkpoints", "saved"]));
    expect(deleted.status).toBe(200);
    const restored = await POST(request("POST"), context(["checkpoints", "saved", "restore"]));
    expect(restored.status).toBe(200);
    const body = await restored.json();
    expect(body).toMatchObject({ sessionId: "restored", debugPaused: true });
    expect(body).not.toHaveProperty("credential");
    expect(restored.headers.get("set-cookie")).toContain(runtimeCredentialCookieName("restored"));
    expect(restored.headers.get("set-cookie")).toContain("HttpOnly");
    expect(restored.headers.get("set-cookie")).not.toContain(runtimeCredentialCookieName("origin"));
    expect(fetchMock.mock.calls.every(([, init]) => new Headers(init.headers).get("Authorization") === "Bearer origin-secret")).toBe(true);
  });

  it("rejects oversized commands before forwarding", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request("POST", true, "x".repeat(4097)), context(["pause"]));
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
