import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { getAgUiBackendHeaders, getAgUiBackendReadiness } from "@/lib/editor-copilot-runtime-backend";

import { GET, POST } from "./route";

describe("editor CopilotKit runtime route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed for external AG-UI backend without token in production mode", async () => {
    vi.stubEnv("CUBICA_EDITOR_AGENT_RUNTIME", "1");
    vi.stubEnv("CUBICA_EDITOR_AGENT_AG_UI_URL", "https://agent.example.test/ag-ui");
    vi.stubEnv("CUBICA_EDITOR_AGENT_AG_UI_TOKEN", "");
    vi.stubEnv("CUBICA_EDITOR_AGENT_PRODUCTION", "1");

    const response = GET();
    const body = await response.json();

    expect(body.ok).toBe(true);
    expect(body.agUiBackendConfigured).toBe(false);
    expect(body.agUiBackendMode).toBe("external");
    expect(body.agUiBackendAuthRequired).toBe(true);
    expect(body.agUiBackendAuthConfigured).toBe(false);
    expect(body.agUiBackendBlockedReason).toBe("external-auth-missing");
  });

  it("allows external AG-UI backend when production token is configured", async () => {
    vi.stubEnv("CUBICA_EDITOR_AGENT_RUNTIME", "1");
    vi.stubEnv("CUBICA_EDITOR_AGENT_AG_UI_URL", "https://agent.example.test/ag-ui");
    vi.stubEnv("CUBICA_EDITOR_AGENT_AG_UI_TOKEN", "secret-token");
    vi.stubEnv("CUBICA_EDITOR_AGENT_PRODUCTION", "1");

    const response = GET();
    const body = await response.json();

    expect(body.ok).toBe(true);
    expect(body.agUiBackendConfigured).toBe(true);
    expect(body.agUiBackendMode).toBe("external");
    expect(body.agUiBackendAuthRequired).toBe(true);
    expect(body.agUiBackendAuthConfigured).toBe(true);
    expect(body.agUiBackendBlockedReason).toBeUndefined();
  });

  it("rejects a non-loopback plaintext external backend even outside production", () => {
    vi.stubEnv("CUBICA_EDITOR_AGENT_AG_UI_URL", "http://agent.example.test/ag-ui");
    vi.stubEnv("CUBICA_EDITOR_AGENT_PRODUCTION", "0");
    expect(getAgUiBackendReadiness()).toMatchObject({ ok: false, reason: "external-url-invalid" });
  });

  it("keeps the current Editor request origin while product-context shadow is off", () => {
    const request = new NextRequest("http://localhost:4317/api/copilotkit");
    const readiness = getAgUiBackendReadiness(request);

    expect(readiness.ok && readiness.backend?.url).toBe("http://localhost:4317/api/editor/agent/ag-ui");
  });

  it("forwards the current Portal bearer and game only to the attested local backend", () => {
    vi.stubEnv("CUBICA_PRODUCT_CONTEXT_MODE", "shadow");
    vi.stubEnv("CUBICA_DEPLOYMENT_TIER", "test");
    vi.stubEnv("CUBICA_PRODUCT_CONTEXT_SHADOW_FORWARD_KEY", "f".repeat(32));
    vi.stubEnv("CUBICA_PRODUCT_CONTEXT_SHADOW_LOCAL_ORIGIN", "https://editor.test");
    vi.stubEnv("CUBICA_EDITOR_AGENT_AG_UI_TOKEN", "external-agent-token");
    const request = new Request("https://editor.test/api/copilotkit", {
      headers: { Authorization: "Bearer portal-user-token", "x-cubica-game-document-id": "game_doc_1" }
    });

    expect(getAgUiBackendHeaders("local", request)).toMatchObject({
      Authorization: "Bearer portal-user-token",
      "x-cubica-game-document-id": "game_doc_1"
    });
    expect(getAgUiBackendHeaders("external", request)).toEqual({
      "x-cubica-agent-id": "editor.authoring",
      "x-cubica-agent-backend-mode": "external",
      Authorization: "Bearer external-agent-token"
    });
  });

  it("is default-off and does not forward missing or malformed identity", () => {
    const request = new Request("http://editor.test/api/copilotkit", {
      headers: { Authorization: "Bearer portal-user-token", "x-cubica-game-document-id": "game_doc_1" }
    });
    expect(getAgUiBackendHeaders("local", request)).toEqual({
      "x-cubica-agent-id": "editor.authoring",
      "x-cubica-agent-backend-mode": "local"
    });

    vi.stubEnv("CUBICA_PRODUCT_CONTEXT_MODE", "shadow");
    vi.stubEnv("CUBICA_DEPLOYMENT_TIER", "test");
    vi.stubEnv("CUBICA_PRODUCT_CONTEXT_SHADOW_FORWARD_KEY", "f".repeat(32));
    vi.stubEnv("CUBICA_PRODUCT_CONTEXT_SHADOW_LOCAL_ORIGIN", "https://editor.test");
    expect(getAgUiBackendHeaders("local", new Request("http://editor.test", { headers: { Authorization: "forged" } }))).toEqual({
      "x-cubica-agent-id": "editor.authoring",
      "x-cubica-agent-backend-mode": "local"
    });
  });

  it("never forwards Portal authorization to an attacker-controlled request origin", () => {
    vi.stubEnv("CUBICA_PRODUCT_CONTEXT_MODE", "shadow");
    vi.stubEnv("CUBICA_DEPLOYMENT_TIER", "test");
    vi.stubEnv("CUBICA_PRODUCT_CONTEXT_SHADOW_FORWARD_KEY", "f".repeat(32));
    vi.stubEnv("CUBICA_PRODUCT_CONTEXT_SHADOW_LOCAL_ORIGIN", "https://editor.test");
    const identityHeaders = { Authorization: "Bearer portal-user-token", "x-cubica-game-document-id": "game_doc_1" };
    const hostile = new NextRequest("https://attacker.example/api/copilotkit", { headers: identityHeaders });
    expect(getAgUiBackendReadiness(hostile)).toMatchObject({ ok: false, reason: "local-origin-mismatch" });
    expect(getAgUiBackendHeaders("local", hostile)).toEqual({
      "x-cubica-agent-id": "editor.authoring",
      "x-cubica-agent-backend-mode": "local"
    });

    const trusted = new NextRequest("https://editor.test/api/copilotkit", { headers: identityHeaders });
    const readiness = getAgUiBackendReadiness(trusted);
    expect(readiness.ok && readiness.backend?.url).toBe("https://editor.test/api/editor/agent/ag-ui");
    expect(getAgUiBackendHeaders("local", trusted).Authorization).toBe("Bearer portal-user-token");
  });

  it.each([
    ["missing", undefined],
    ["malformed", "not-a-bearer"]
  ] as const)("keeps the main POST response identical with %s optional Portal authorization", async (_case, authorization) => {
    vi.stubEnv("CUBICA_EDITOR_AGENT_RUNTIME", "1");
    vi.stubEnv("CUBICA_DEPLOYMENT_TIER", "test");
    vi.stubEnv("CUBICA_PRODUCT_CONTEXT_SHADOW_FORWARD_KEY", "f".repeat(32));
    vi.stubEnv("CUBICA_PRODUCT_CONTEXT_SHADOW_LOCAL_ORIGIN", "https://editor.test");
    const request = () => new NextRequest("https://editor.test/api/copilotkit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cubica-game-document-id": "game_doc_1",
        ...(authorization === undefined ? {} : { Authorization: authorization })
      },
      body: JSON.stringify({})
    });

    const baseline = await POST(request());
    const baselineBody = await baseline.text();
    vi.stubEnv("CUBICA_PRODUCT_CONTEXT_MODE", "shadow");
    const shadow = await POST(request());

    expect(shadow.status).toBe(baseline.status);
    expect([...shadow.headers.entries()]).toEqual([...baseline.headers.entries()]);
    await expect(shadow.text()).resolves.toBe(baselineBody);
    expect(getAgUiBackendHeaders("local", request())).not.toHaveProperty("Authorization");
  });

  it("rejects a hostile origin before constructing an AG-UI request", async () => {
    vi.stubEnv("CUBICA_EDITOR_AGENT_RUNTIME", "1");
    vi.stubEnv("CUBICA_PRODUCT_CONTEXT_MODE", "shadow");
    vi.stubEnv("CUBICA_DEPLOYMENT_TIER", "test");
    vi.stubEnv("CUBICA_PRODUCT_CONTEXT_SHADOW_FORWARD_KEY", "f".repeat(32));
    vi.stubEnv("CUBICA_PRODUCT_CONTEXT_SHADOW_LOCAL_ORIGIN", "https://editor.test");
    const response = await POST(new NextRequest("https://attacker.example/api/copilotkit", {
      method: "POST",
      headers: { Authorization: "Bearer portal-user-token", "x-cubica-game-document-id": "game_doc_1" }
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "local-origin-mismatch" });
  });
});
