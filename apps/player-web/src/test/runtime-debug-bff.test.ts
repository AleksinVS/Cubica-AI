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

  it("rejects all checkpoint operations even with a valid browser cookie while AB3 is open", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const responses = await Promise.all([
      GET(request("GET"), context(["checkpoints"])),
      POST(request("POST"), context(["checkpoints"])),
      DELETE(request("DELETE"), context(["checkpoints", "saved"])),
      POST(request("POST"), context(["checkpoints", "saved", "restore"]))
    ]);
    expect(responses.map(response => response.status)).toEqual([404, 404, 404, 404]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized commands before forwarding", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request("POST", true, "x".repeat(4097)), context(["pause"]));
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
