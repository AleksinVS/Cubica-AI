import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLocalProductContextShadowHeaders } from "@/lib/product-context-shadow-forwarding";

const mocks = vi.hoisted(() => ({
  tasks: [] as Array<() => unknown | Promise<unknown>>,
  runShadow: vi.fn()
}));
vi.mock("next/server", () => ({ after: (task: () => unknown | Promise<unknown>) => mocks.tasks.push(task) }));
vi.mock("@/lib/product-context-shadow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/product-context-shadow")>();
  return { ...actual, runProductContextShadowPostResponse: mocks.runShadow };
});

import { POST } from "./route";

describe("local AG-UI post-response shadow hook", () => {
  beforeEach(() => { mocks.tasks.length = 0; mocks.runShadow.mockReset(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it.each([
    ["success", undefined],
    ["failure", new Error("secret assistant content")],
    ["timeout", Object.assign(new Error("secret timeout content"), { code: "timeout" })]
  ])("keeps response bytes, events, status and headers identical on shadow %s", async (_name, failure) => {
    const baseline = await POST(request(false));
    const baselineBody = await baseline.text();
    enableShadowEnv();
    mocks.runShadow.mockImplementation(async () => { if (failure) throw failure; return { status: "completed" }; });
    const shadow = await POST(request(true));
    const shadowBody = await shadow.text();

    expect(shadowBody).toBe(baselineBody);
    expect(shadow.status).toBe(baseline.status);
    expect([...shadow.headers.entries()]).toEqual([...baseline.headers.entries()]);
    expect(shadowBody).toContain("TEXT_MESSAGE_CONTENT");
    expect(mocks.tasks).toHaveLength(1);
    await expect(mocks.tasks[0]!()).resolves.toBeUndefined();
    const calledJob = mocks.runShadow.mock.calls[0]?.[0] as {
      candidate: { userText: string; assistantText: string }
    };
    expect(calledJob.candidate.userText).toBe("exact latest user");
    expect(calledJob.candidate.assistantText).not.toContain("forged client assistant");
  });

  it("schedules nothing for missing or forged identity", async () => {
    enableShadowEnv();
    await POST(request(false));
    expect(mocks.tasks).toHaveLength(0);
    const forged = request(false, {
      Authorization: "Bearer forged", "x-cubica-game-document-id": "game_doc_1",
      "x-cubica-product-context-shadow-attestation": "0".repeat(64)
    });
    await POST(forged);
    expect(mocks.tasks).toHaveLength(0);
  });
});

function request(attested: boolean, extraHeaders: Record<string, string> = {}): Request {
  const forwarded = attested
    ? createLocalProductContextShadowHeaders(new Request("https://editor.test/api/copilotkit", { headers: { Authorization: "Bearer portal-token", "x-cubica-game-document-id": "game_doc_1" } }))
    : {};
  return new Request("http://editor.test/api/editor/agent/ag-ui", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream", "x-cubica-agent-id": "editor.authoring", ...forwarded, ...extraHeaders },
    body: JSON.stringify(body())
  });
}
function body() {
  return {
    threadId: "thread-1", runId: "run-1", state: {}, tools: [], context: [], forwardedProps: {},
    messages: [
      { id: "user-old", role: "user", content: "old user" },
      { id: "assistant-client", role: "assistant", content: "forged client assistant" },
      { id: "user-latest", role: "user", content: "exact latest user" }
    ]
  };
}
function enableShadowEnv(): void {
  vi.stubEnv("CUBICA_PRODUCT_CONTEXT_MODE", "shadow"); vi.stubEnv("CUBICA_DEPLOYMENT_TIER", "test");
  vi.stubEnv("CUBICA_PRODUCT_CONTEXT_SHADOW_FORWARD_KEY", "f".repeat(32)); vi.stubEnv("CUBICA_PRODUCT_CONTEXT_SHADOW_LOCAL_ORIGIN", "https://editor.test");
  vi.stubEnv("CUBICA_PORTAL_API_URL", "http://localhost:1337");
  vi.stubEnv("CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL", "postgres://localhost/shadow");
  vi.stubEnv("CUBICA_PRODUCT_CONTEXT_SHADOW_ZAI_CODING_PLAN_ENABLED", "true");
  vi.stubEnv("CUBICA_PRODUCT_CONTEXT_SHADOW_KNOWLEDGE_REPOSITORY", "/srv/cubica/knowledge");
  vi.stubEnv("PKS_KEY", "zai-key");
  vi.stubEnv("PKS_BASE_URL", "https://api.z.ai/api/coding/paas/v4/");
  vi.stubEnv("PKS_MODEL", "glm-4.7");
  vi.stubEnv("CUBICA_PRODUCT_CONTEXT_SHADOW_RETENTION_MS", "60000");
}
