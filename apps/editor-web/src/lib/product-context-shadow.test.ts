import { afterEach, describe, expect, it, vi } from "vitest";

import { buildProductContextShadowJob, runProductContextShadowPostResponse, type ProductContextShadowReceipt } from "./product-context-shadow";
import { createLocalProductContextShadowHeaders } from "./product-context-shadow-forwarding";

const receipt: ProductContextShadowReceipt = {
  schema_version: "1.0.0", decision: "allow", shadow_principal_ref: "cubica://shadow-principal/v1/demo",
  role_scope: "developer", applies_to: ["cubica://game-project/game_doc_1"], access_policy_ref: "access",
  access_policy_revision: "1", retention_policy_ref: "retention", retention_policy_revision: "1",
  external_processing_policy_ref: "external", external_processing_policy_revision: "1",
  authorization_revision: `sha256:${"a".repeat(64)}`, issued_at: "2026-08-09T11:00:00Z", expires_at: "2099-08-09T13:00:00Z"
};

describe("product-context shadow durable enqueue", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("stores only the latest user string and server-emitted assistant text without model work", async () => {
    const job = jobFor(configuredEnv());
    const captured: Array<Record<string, unknown>> = [];
    const authorize = vi.fn(async () => receipt);
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    const result = await runProductContextShadowPostResponse(job, { authorize, createStore: () => enqueueStore(captured) });

    expect(result).toMatchObject({ status: "pending", receipt });
    expect(authorize).toHaveBeenCalledOnce();
    expect(providerFetch).not.toHaveBeenCalled();
    const sent = captured[0]! as { userBytes: Uint8Array; agentBytes: Uint8Array; threadRef: string; stableTurnKey: string };
    expect(new TextDecoder().decode(sent.userBytes)).toBe("latest exact user");
    expect(new TextDecoder().decode(sent.agentBytes)).toBe("server exact assistant");
    expect(sent.threadRef).toMatch(/^cubica:\/\/shadow-thread\/v1\/[a-f0-9]{64}$/u);
    expect(sent.stableTurnKey).toMatch(/^shadow-turn-v1:[a-f0-9]{64}$/u);
    expect(JSON.stringify(captured)).not.toContain("portal-token");
  });

  it("fails closed for default-off, forged forwarding, production, or unsafe database transport", () => {
    expect(buildProductContextShadowJob(new Headers(), candidate(), { NODE_ENV: "test" })).toBeNull();
    const env = configuredEnv();
    expect(buildProductContextShadowJob(new Headers({ Authorization: "Bearer forged", "x-cubica-game-document-id": "game_doc_1", "x-cubica-product-context-shadow-attestation": "0".repeat(64) }), candidate(), env)).toBeNull();
    const headers = forwarded(env);
    expect(buildProductContextShadowJob(headers, candidate(), { ...env, CUBICA_DEPLOYMENT_TIER: "production" })).toBeNull();
    expect(buildProductContextShadowJob(headers, candidate(), { ...env, CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL: "postgresql://db.internal/shadow" })).toBeNull();
    expect(buildProductContextShadowJob(headers, candidate(), { ...env, CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL: "postgresql://db.internal/shadow?sslmode=verify-full" })).not.toBeNull();
  });

  it("rejects message secrets before Portal authorization or storage", async () => {
    const env = configuredEnv();
    const authorize = vi.fn(); const createStore = vi.fn();
    const secret = buildProductContextShadowJob(forwarded(env), { ...candidate(), userText: "api_key=abcdefghijklmnop1234" }, env)!;
    await expect(runProductContextShadowPostResponse(secret, { authorize, createStore })).resolves.toBeNull();
    expect(authorize).not.toHaveBeenCalled(); expect(createStore).not.toHaveBeenCalled();
  });

  it("calls Portal once with bearer and game, then enqueues without retaining bearer", async () => {
    const env = configuredEnv(); const job = jobFor(env); const captured: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(receipt), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await runProductContextShadowPostResponse(job, { createStore: () => enqueueStore(captured) });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:1337/api/product-context/shadow-authorization");
    expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ gameDocumentId: "game_doc_1" }) });
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer portal-token");
    expect(JSON.stringify(captured)).not.toContain("portal-token");
  });
});

function enqueueStore(captured: Array<Record<string, unknown>>) {
  return {
    appendExactTurnAndCreateRun: vi.fn(async (input: Record<string, unknown>, auth: ProductContextShadowReceipt) => {
      captured.push(input);
      const request = input.gatewayRequest as { messages: Array<Record<string, unknown>> };
      const [user, agent] = request.messages;
      return { runId:"shadowrun_test",ownerRef:auth.shadow_principal_ref,threadRef:String(input.threadRef),stableTurnKey:String(input.stableTurnKey),authorizationRevision:auth.authorization_revision,receipt:auth,userMessageRef:String(user!.message_ref),userMessageRevision:String(user!.revision),userMessageHash:String(user!.content_hash),agentMessageRef:String(agent!.message_ref),agentMessageRevision:String(agent!.revision),agentMessageHash:String(agent!.content_hash),status:"pending",outcome:null,requestId:null,result:null,leaseExpiresAt:null,retainedUntil:(input.retainedUntil as Date).toISOString() };
    })
  } as never;
}
function jobFor(env: NodeJS.ProcessEnv) { return buildProductContextShadowJob(forwarded(env), candidate(), env)!; }
function forwarded(env: NodeJS.ProcessEnv) { return new Headers(createLocalProductContextShadowHeaders(new Request("https://editor.test", { headers: { Authorization:"Bearer portal-token", "x-cubica-game-document-id":"game_doc_1" } }), env)); }
function configuredEnv(): NodeJS.ProcessEnv { return { NODE_ENV:"test",CUBICA_PRODUCT_CONTEXT_MODE:"shadow",CUBICA_DEPLOYMENT_TIER:"test",CUBICA_PRODUCT_CONTEXT_SHADOW_FORWARD_KEY:"f".repeat(32),CUBICA_PRODUCT_CONTEXT_SHADOW_LOCAL_ORIGIN:"https://editor.test",CUBICA_PORTAL_API_URL:"http://localhost:1337",CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL:"postgres://localhost/shadow",CUBICA_PRODUCT_CONTEXT_SHADOW_ZAI_CODING_PLAN_ENABLED:"true",CUBICA_PRODUCT_CONTEXT_SHADOW_RETENTION_MS:"60000" }; }
function candidate() { return { threadId:"thread-1",runId:"run-1",userMessageId:"user-latest",assistantMessageId:"server-message",userText:"latest exact user",assistantText:"server exact assistant" }; }
