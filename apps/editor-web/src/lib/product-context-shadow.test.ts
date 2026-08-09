import { afterEach, describe, expect, it, vi } from "vitest";

import { buildProductContextShadowJob, runProductContextShadowPostResponse, type ProductContextShadowJob, type ProductContextShadowReceipt } from "./product-context-shadow";
import { createLocalProductContextShadowHeaders } from "./product-context-shadow-forwarding";

const receipt: ProductContextShadowReceipt = {
  schema_version: "1.0.0", decision: "allow", shadow_principal_ref: "cubica://shadow-principal/v1/demo",
    role_scope: "developer", applies_to: ["cubica://game-project/game_doc_1"], access_policy_ref: "access",
  access_policy_revision: "1", retention_policy_ref: "retention", retention_policy_revision: "1",
  external_processing_policy_ref: "external", external_processing_policy_revision: "1",
  authorization_revision: `sha256:${"a".repeat(64)}`, issued_at: "2026-08-09T11:00:00Z", expires_at: "2026-08-09T13:00:00Z"
};

describe("product-context shadow post-response job", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("uses only the latest user string and server-emitted assistant text", async () => {
    const env = configuredEnv();
    const forwarded = createLocalProductContextShadowHeaders(new Request("https://editor.test", {
      headers: { Authorization: "Bearer portal-token", "x-cubica-game-document-id": "game_doc_1" }
    }), env);
    const job = buildProductContextShadowJob(new Headers(forwarded), candidate(), env);
    expect(job).not.toBeNull();
    const authorize = vi.fn(async () => receipt);
    const run = vi.fn(async (value: unknown) => ({ status: "completed", runId: "shadowrun_1", result: null, duplicate: false }));
    const createCoordinator = vi.fn((_job: ProductContextShadowJob, authority, receivedReceipt, requestBinding) => ({
      run: async (value: unknown) => {
        expect(receivedReceipt).toEqual(receipt);
        expect(requestBinding).toEqual({
          authorizationRevision: receipt.authorization_revision,
          shadowPrincipalRef: receipt.shadow_principal_ref,
          gameRef: receipt.applies_to[0],
          accessPolicyRef: receipt.access_policy_ref,
          accessPolicyRevision: receipt.access_policy_revision,
          retentionPolicyRef: receipt.retention_policy_ref,
          retentionPolicyRevision: receipt.retention_policy_revision,
          externalProcessingPolicyRef: receipt.external_processing_policy_ref,
          externalProcessingPolicyRevision: receipt.external_processing_policy_revision
        });
        expect(_job.config.knowledgeRepository).toBe("/srv/cubica/knowledge");
        expect(_job.config.deploymentTier).toBe("test");
        await authority.current(receipt);
        return run(value) as never;
      }
    }));

    await runProductContextShadowPostResponse(job!, {
      authorize,
      createCoordinator
    });

    expect(authorize).toHaveBeenCalledTimes(2);
    expect(createCoordinator).toHaveBeenCalledWith(job, expect.anything(), receipt, expect.anything());
    const sent = run.mock.calls[0]![0] as { userBytes: Uint8Array; agentBytes: Uint8Array; threadRef: string; stableTurnKey: string };
    expect(new TextDecoder().decode(sent.userBytes)).toBe("latest exact user");
    expect(new TextDecoder().decode(sent.agentBytes)).toBe("server exact assistant");
    expect(JSON.stringify(sent)).not.toContain("client supplied assistant");
    expect(JSON.stringify(sent)).not.toContain("old user");
    expect(sent.threadRef).toMatch(/^cubica:\/\/shadow-thread\/v1\/[a-f0-9]{64}$/u);
    expect(sent.stableTurnKey).toMatch(/^shadow-turn-v1:[a-f0-9]{64}$/u);
  });

  it("returns no job for default-off, missing configuration or forged forwarding", () => {
    expect(buildProductContextShadowJob(new Headers(), candidate(), { NODE_ENV: "test" })).toBeNull();
    const env = configuredEnv();
    expect(buildProductContextShadowJob(new Headers({
      Authorization: "Bearer forged", "x-cubica-game-document-id": "game_doc_1",
      "x-cubica-product-context-shadow-attestation": "0".repeat(64)
    }), candidate(), env)).toBeNull();
    expect(buildProductContextShadowJob(new Headers(), candidate(), { ...env, CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL: "" })).toBeNull();
    expect(buildProductContextShadowJob(new Headers(), candidate(), { ...env, CUBICA_PRODUCT_CONTEXT_SHADOW_ZAI_CODING_PLAN_ENABLED: undefined })).toBeNull();
    expect(buildProductContextShadowJob(new Headers(), candidate(), { ...env, PKS_KEY: "" })).toBeNull();
    expect(buildProductContextShadowJob(new Headers(), candidate(), { ...env, CUBICA_PRODUCT_CONTEXT_SHADOW_KNOWLEDGE_REPOSITORY: "relative/repository" })).toBeNull();
    expect(buildProductContextShadowJob(new Headers(), candidate(), { ...env, PKS_BASE_URL: "https://api.z.ai/api/coding/paas/v4/other/" })).toBeNull();
    expect(buildProductContextShadowJob(new Headers(), candidate(), { ...env, PKS_MODEL: "other-model" })).toBeNull();
  });

  it("requires transport encryption for a non-loopback PostgreSQL connection", () => {
    const env = configuredEnv();
    const forwarded = createLocalProductContextShadowHeaders(new Request("https://editor.test", {
      headers: { Authorization: "Bearer portal-token", "x-cubica-game-document-id": "game_doc_1" }
    }), env);
    expect(buildProductContextShadowJob(new Headers(forwarded), candidate(), {
      ...env,
      CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL: "postgresql://db.internal/shadow"
    })).toBeNull();
    expect(buildProductContextShadowJob(new Headers(forwarded), candidate(), {
      ...env,
      CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL: "postgresql://db.internal/shadow?sslmode=require"
    })).toBeNull();
    expect(buildProductContextShadowJob(new Headers(forwarded), candidate(), {
      ...env,
      CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL: "postgresql://db.internal/shadow?sslmode=verify-full"
    })).not.toBeNull();
    expect(buildProductContextShadowJob(new Headers(forwarded), candidate(), {
      ...env,
      CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL: "postgresql://db.internal/shadow?sslmode=verify-full&host=attacker.example"
    })).toBeNull();
  });

  it("does not log content or credentials when authorization fails", async () => {
    const env = configuredEnv();
    const forwarded = createLocalProductContextShadowHeaders(new Request("https://editor.test", {
      headers: { Authorization: "Bearer secret-token", "x-cubica-game-document-id": "game_doc_1" }
    }), env);
    const job = buildProductContextShadowJob(new Headers(forwarded), candidate(), env)!;
    const logs = [vi.spyOn(console, "log").mockImplementation(() => undefined), vi.spyOn(console, "warn").mockImplementation(() => undefined), vi.spyOn(console, "error").mockImplementation(() => undefined)];
    await expect(runProductContextShadowPostResponse(job, { authorize: async () => { throw new Error("latest exact user secret-token"); } })).rejects.toThrow();
    expect(logs.flatMap((spy) => spy.mock.calls)).toEqual([]);
  });

  it("rejects message secrets before Portal authorization or gateway preload", async () => {
    const env = configuredEnv();
    const forwarded = createLocalProductContextShadowHeaders(new Request("https://editor.test", {
      headers: { Authorization: "Bearer portal-token", "x-cubica-game-document-id": "game_doc_1" }
    }), env);
    const job = buildProductContextShadowJob(new Headers(forwarded), {
      ...candidate(), userText: "api_key=abcdefghijklmnop1234"
    }, env)!;
    const authorize = vi.fn();
    const createCoordinator = vi.fn();

    await expect(runProductContextShadowPostResponse(job, { authorize, createCoordinator })).resolves.toBeNull();
    const agentSecretJob = buildProductContextShadowJob(new Headers(forwarded), {
      ...candidate(), assistantText: "password=abcdefghijklmnop1234"
    }, env)!;
    await expect(runProductContextShadowPostResponse(agentSecretJob, { authorize, createCoordinator })).resolves.toBeNull();
    expect(authorize).not.toHaveBeenCalled();
    expect(createCoordinator).not.toHaveBeenCalled();
  });

  it("awaits preload outside the coordinator run, then denies on fresh authorization without provider fetch", async () => {
    const env = configuredEnv();
    const forwarded = createLocalProductContextShadowHeaders(new Request("https://editor.test", {
      headers: { Authorization: "Bearer portal-token", "x-cubica-game-document-id": "game_doc_1" }
    }), env);
    const job = buildProductContextShadowJob(new Headers(forwarded), candidate(), env)!;
    let releasePreload!: () => void;
    const preload = new Promise<void>((resolve) => { releasePreload = resolve; });
    const revoked = { ...receipt, authorization_revision: `sha256:${"b".repeat(64)}` };
    const authorize = vi.fn(async () => authorize.mock.calls.length === 1 ? receipt : revoked);
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);
    const createCoordinator = vi.fn(async (_job, authority) => {
      await preload;
      return {
        run: async () => {
          const fresh = await authority.current(receipt);
          return fresh === revoked
            ? { status: "denied" as const, runId: null, outcome: "authorization_changed" as const }
            : { status: "disabled" as const };
        }
      };
    });

    const pending = runProductContextShadowPostResponse(job, { authorize, createCoordinator });
    await vi.waitFor(() => expect(createCoordinator).toHaveBeenCalledOnce());
    expect(authorize).toHaveBeenCalledOnce();
    expect(providerFetch).not.toHaveBeenCalled();
    releasePreload();
    await expect(pending).resolves.toMatchObject({ status: "denied", outcome: "authorization_changed" });
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("calls the exact Portal endpoint with only bearer and game, then reauthorizes", async () => {
    const env = configuredEnv();
    const forwarded = createLocalProductContextShadowHeaders(new Request("https://editor.test", {
      headers: { Authorization: "Bearer portal-token", "x-cubica-game-document-id": "game_doc_1" }
    }), env);
    const job = buildProductContextShadowJob(new Headers(forwarded), candidate(), env)!;
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(receipt), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await runProductContextShadowPostResponse(job, {
      createCoordinator: (_job, authority) => ({
        run: async () => {
          await authority.current(receipt);
          return { status: "disabled" };
        }
      })
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe("http://localhost:1337/api/product-context/shadow-authorization");
      expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ gameDocumentId: "game_doc_1" }) });
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer portal-token");
    }
  });
});

function configuredEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    CUBICA_PRODUCT_CONTEXT_MODE: "shadow", CUBICA_DEPLOYMENT_TIER: "test",
    CUBICA_PRODUCT_CONTEXT_SHADOW_FORWARD_KEY: "f".repeat(32), CUBICA_PRODUCT_CONTEXT_SHADOW_LOCAL_ORIGIN: "https://editor.test",
    CUBICA_PORTAL_API_URL: "http://localhost:1337",
    CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL: "postgres://localhost/shadow",
    CUBICA_PRODUCT_CONTEXT_SHADOW_ZAI_CODING_PLAN_ENABLED: "true",
    CUBICA_PRODUCT_CONTEXT_SHADOW_KNOWLEDGE_REPOSITORY: "/srv/cubica/knowledge",
    PKS_KEY: "zai-key",
    PKS_BASE_URL: "https://api.z.ai/api/coding/paas/v4/",
    PKS_MODEL: "glm-4.7",
    CUBICA_PRODUCT_CONTEXT_SHADOW_RETENTION_MS: "60000"
  };
}
function candidate() {
  return {
    threadId: "thread-1", runId: "run-1", userMessageId: "user-latest",
    assistantMessageId: "server-message", userText: "latest exact user",
    assistantText: "server exact assistant"
  };
}
