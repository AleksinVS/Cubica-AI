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

  it("rejects a claim when the browser already has the session credential cookie", async () => {
    const { POST } = await import("../../app/api/runtime/sessions/[sessionId]/private-invite-claims/route");
    const request = new NextRequest("http://localhost/api/runtime/sessions/s1/private-invite-claims", {
      method: "POST",
      body: JSON.stringify({ inviteToken: "tok" })
    });
    request.cookies.set(runtimeCredentialCookieName("s1"), "existing-credential");

    const response = await POST(request, { params: Promise.resolve({ sessionId: "s1" }) });
    expect(response.status).toBe(409);
    expect(requestRuntime).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
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
