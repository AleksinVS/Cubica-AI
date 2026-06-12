import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

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
});
