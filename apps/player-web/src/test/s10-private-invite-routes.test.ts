import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runtimeCredentialCookieName } from "../../app/api/runtime/_shared";

const { requestRuntime } = vi.hoisted(() => ({ requestRuntime: vi.fn() }));
vi.mock("../../app/api/runtime/_shared", async () => {
  const actual = await vi.importActual<typeof import("../../app/api/runtime/_shared")>("../../app/api/runtime/_shared");
  return { ...actual, requestRuntime };
});

describe("S10 private invite BFF", () => {
  beforeEach(() => requestRuntime.mockReset());

  it("forwards seat recovery through the existing HttpOnly session credential", async () => {
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({ seatId: "p2", playerId: "p2", inviteToken: "opaque", expiresAt: "2026-01-01T00:00:00Z" }), { status: 201 }));
    vi.stubGlobal("fetch", upstream);
    const { POST } = await import("../../app/api/runtime/sessions/[sessionId]/seat-recovery-invites/route");
    const request = new NextRequest("http://localhost/api/runtime/sessions/s1/seat-recovery-invites", { method: "POST", body: JSON.stringify({ seatId: "p2" }) });
    request.cookies.set(runtimeCredentialCookieName("s1"), "session-secret");
    const response = await POST(request, { params: Promise.resolve({ sessionId: "s1" }) });
    expect(response.status).toBe(201);
    expect(upstream).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/sessions/s1/seat-recovery-invites" }), expect.objectContaining({ body: JSON.stringify({ seatId: "p2" }) }));
    expect(new Headers(upstream.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe("Bearer session-secret");
    expect(await response.json()).toEqual(expect.objectContaining({ seatId: "p2" }));
  });

  it("rejects an oversized recovery body before contacting runtime", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const { POST } = await import("../../app/api/runtime/sessions/[sessionId]/seat-recovery-invites/route");
    const response = await POST(new NextRequest("http://localhost/api/runtime/sessions/s1/seat-recovery-invites", { method: "POST", body: "x".repeat(256 * 1024 + 1) }), { params: Promise.resolve({ sessionId: "s1" }) });
    expect(response.status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("requires the session cookie and preserves upstream recovery errors", async () => {
    const upstream = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "seat is not recoverable" }), { status: 409, headers: { "content-type": "application/problem+json" } }));
    vi.stubGlobal("fetch", upstream);
    const { POST } = await import("../../app/api/runtime/sessions/[sessionId]/seat-recovery-invites/route");
    const missing = await POST(new NextRequest("http://localhost/api/runtime/sessions/s1/seat-recovery-invites", { method: "POST", body: JSON.stringify({ seatId: "p2" }) }), { params: Promise.resolve({ sessionId: "s1" }) });
    expect(missing.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();

    const request = new NextRequest("http://localhost/api/runtime/sessions/s1/seat-recovery-invites", { method: "POST", body: JSON.stringify({ seatId: "p2" }) });
    request.cookies.set(runtimeCredentialCookieName("s1"), "session-secret");
    const error = await POST(request, { params: Promise.resolve({ sessionId: "s1" }) });
    expect(error.status).toBe(409);
    await expect(error.json()).resolves.toEqual({ error: "seat is not recoverable" });
    expect(error.headers.get("set-cookie")).toBeNull();
  });

  it("claims without forwarding a browser bearer and redacts durable credential", async () => {
    requestRuntime.mockResolvedValue(new Response(JSON.stringify({ sessionId: "s1", credential: "ses_secret", participants: [] }), { status: 200 }));
    const { POST } = await import("../../app/api/runtime/sessions/[sessionId]/private-invite-claims/route");
    const response = await POST(new NextRequest("http://localhost/api/runtime/sessions/s1/private-invite-claims", { method: "POST", body: JSON.stringify({ inviteToken: "tok" }) }), { params: Promise.resolve({ sessionId: "s1" }) });
    expect(requestRuntime).toHaveBeenCalledWith("/sessions/s1/private-invite-claims", expect.objectContaining({ body: JSON.stringify({ inviteToken: "tok" }) }));
    expect((requestRuntime.mock.calls[0][1].headers as Record<string, string>).Authorization).toBeUndefined();
    expect(await response.json()).not.toHaveProperty("credential");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("Path=/api/runtime");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=strict");
    expect(cookie).toContain("ses_secret");
    expect(cookie).not.toContain("tok");
  });

  it("fails closed when claim response is bound to another session", async () => {
    requestRuntime.mockResolvedValue(new Response(JSON.stringify({ sessionId: "other", credential: "ses_secret" }), { status: 200 }));
    const { POST } = await import("../../app/api/runtime/sessions/[sessionId]/private-invite-claims/route");
    const response = await POST(new NextRequest("http://localhost/api/runtime/sessions/s1/private-invite-claims", { method: "POST", body: "{}" }), { params: Promise.resolve({ sessionId: "s1" }) });
    expect(response.status).toBe(502);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("forwards an existing cookie as same-principal recovery proof and replaces it only on success", async () => {
    requestRuntime.mockResolvedValue(new Response(JSON.stringify({
      sessionId: "s1",
      credential: "replacement-credential",
      participants: []
    }), { status: 200 }));
    const { POST } = await import("../../app/api/runtime/sessions/[sessionId]/private-invite-claims/route");
    const request = new NextRequest("http://localhost/api/runtime/sessions/s1/private-invite-claims", {
      method: "POST",
      body: JSON.stringify({ inviteToken: "tok" })
    });
    request.cookies.set(runtimeCredentialCookieName("s1"), "existing-credential");

    const response = await POST(request, { params: Promise.resolve({ sessionId: "s1" }) });
    expect(response.status).toBe(200);
    const forwarded = requestRuntime.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(forwarded.headers).get("Authorization")).toBe("Bearer existing-credential");
    expect(response.headers.get("set-cookie")).toContain("replacement-credential");
    expect(await response.json()).not.toHaveProperty("credential");
  });

  it("rejects an oversized claim body before contacting runtime", async () => {
    const { POST } = await import("../../app/api/runtime/sessions/[sessionId]/private-invite-claims/route");
    const response = await POST(new NextRequest("http://localhost/api/runtime/sessions/s1/private-invite-claims", {
      method: "POST",
      body: "x".repeat(256 * 1024 + 1)
    }), { params: Promise.resolve({ sessionId: "s1" }) });

    expect(response.status).toBe(413);
    expect(requestRuntime).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("authenticates SSE upstream and preserves an unbuffered event stream", async () => {
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("event: version\\ndata: {}\\n\\n")); } });
    requestRuntime.mockResolvedValue(new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }));
    const { GET } = await import("../../app/api/runtime/sessions/[sessionId]/events/route");
    const request = new NextRequest("http://localhost/api/runtime/sessions/s1/events");
    request.cookies.set(runtimeCredentialCookieName("s1"), "ses_secret");
    const response = await GET(request, { params: Promise.resolve({ sessionId: "s1" }) });
    expect(response.status).toBe(200);
    expect((requestRuntime.mock.calls[0][1].headers as Record<string, string>).Authorization).toBe("Bearer ses_secret");
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.body).toBe(stream);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("keeps JSON error semantics for non-success SSE responses without setting cookies", async () => {
    requestRuntime.mockResolvedValue(new Response(JSON.stringify({ error: "Runtime unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json" }
    }));
    const { GET } = await import("../../app/api/runtime/sessions/[sessionId]/events/route");
    const request = new NextRequest("http://localhost/api/runtime/sessions/s1/events");
    request.cookies.set(runtimeCredentialCookieName("s1"), "ses_secret");

    const response = await GET(request, { params: Promise.resolve({ sessionId: "s1" }) });
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toEqual({ error: "Runtime unavailable" });
  });
});
