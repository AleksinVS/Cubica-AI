/**
 * Server-side CopilotKit runtime route for the Cubica editor assistant.
 *
 * The browser talks only to this app-local endpoint. The route connects through
 * HttpAgent either to the built-in local AG-UI backend or to an external
 * production backend configured through CUBICA_EDITOR_AGENT_AG_UI_URL. Bearer
 * tokens stay server-side. If the runtime flag is disabled, the route returns
 * 404 so a disabled-by-default UI cannot accidentally start agent traffic.
 */
import { HttpAgent } from "@ag-ui/client";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint
} from "@copilotkit/runtime";
import { type NextRequest } from "next/server";

import { EDITOR_AUTHORING_ASSISTANT_ID } from "@/lib/agent-assistant-registry";

export const runtime = "nodejs";

const endpoint = "/api/copilotkit";

process.env.COPILOTKIT_TELEMETRY_DISABLED ??= "true";

export async function POST(request: NextRequest) {
  if (!isEditorAgentRuntimeEnabled()) {
    return Response.json({ error: "Editor agent runtime is disabled." }, { status: 404 });
  }

  const backendReadiness = getAgUiBackendReadiness(request);
  if (!backendReadiness.ok) {
    return Response.json({ error: backendReadiness.message, code: backendReadiness.reason }, { status: 503 });
  }

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime: createEditorCopilotRuntime(backendReadiness.backend),
    serviceAdapter: new ExperimentalEmptyAdapter(),
    endpoint,
    properties: {
      agentId: EDITOR_AUTHORING_ASSISTANT_ID,
      ownerApp: "apps/editor-web"
    }
  });

  return handleRequest(request);
}

export function GET() {
  const backendReadiness = getAgUiBackendReadiness();
  const backend = backendReadiness.ok ? backendReadiness.backend : undefined;
  return Response.json({
    ok: isEditorAgentRuntimeEnabled(),
    endpoint,
    agentId: EDITOR_AUTHORING_ASSISTANT_ID,
    agUiBackendConfigured: isEditorAgentRuntimeEnabled() && backend !== undefined,
    agUiBackendMode: backend?.mode ?? backendReadiness.mode,
    agUiBackendAuthRequired: backendReadiness.authRequired,
    agUiBackendAuthConfigured: backendReadiness.authConfigured,
    agUiBackendBlockedReason: backendReadiness.ok ? undefined : backendReadiness.reason
  });
}

function createEditorCopilotRuntime(
  agUiBackend: { readonly url: string; readonly mode: "external" | "local" } | undefined
): CopilotRuntime {
  if (agUiBackend === undefined) {
    return new CopilotRuntime({
      agents: {}
    });
  }

  return new CopilotRuntime({
    agents: {
      [EDITOR_AUTHORING_ASSISTANT_ID]: new HttpAgent({
        url: agUiBackend.url,
        headers: getAgUiBackendHeaders(agUiBackend.mode),
        agentId: EDITOR_AUTHORING_ASSISTANT_ID,
        description: "Cubica editor authoring assistant"
      })
    },
    debug: process.env.CUBICA_EDITOR_AGENT_DEBUG === "1"
  });
}

function isEditorAgentRuntimeEnabled(): boolean {
  const value = process.env.CUBICA_EDITOR_AGENT_RUNTIME;
  return value === "1" || value === "true";
}

function getAgUiBackendUrl(): string | undefined {
  const value = process.env.CUBICA_EDITOR_AGENT_AG_UI_URL?.trim();
  return value === "" ? undefined : value;
}

type AgUiBackendReadiness =
  | {
      readonly ok: true;
      readonly backend: { readonly url: string; readonly mode: "external" | "local" } | undefined;
      readonly mode?: "external" | "local";
      readonly authRequired: boolean;
      readonly authConfigured: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: "external-auth-missing";
      readonly message: string;
      readonly mode: "external";
      readonly authRequired: true;
      readonly authConfigured: false;
    };

function getAgUiBackendReadiness(request?: NextRequest): AgUiBackendReadiness {
  const configuredUrl = getAgUiBackendUrl();
  if (configuredUrl !== undefined) {
    const authConfigured = hasAgUiBackendAuthToken();
    if (isProductionAgentBackendMode() && !authConfigured) {
      return {
        ok: false,
        reason: "external-auth-missing",
        message: "External AG-UI backend requires CUBICA_EDITOR_AGENT_AG_UI_TOKEN in production mode.",
        mode: "external",
        authRequired: true,
        authConfigured: false
      };
    }

    return {
      ok: true,
      backend: { url: configuredUrl, mode: "external" },
      mode: "external",
      authRequired: isProductionAgentBackendMode(),
      authConfigured
    };
  }

  if (!isLocalAgUiBackendEnabled()) {
    return {
      ok: true,
      backend: undefined,
      authRequired: false,
      authConfigured: false
    };
  }

  const baseUrl = request === undefined ? "http://127.0.0.1:3000" : request.nextUrl.origin;
  return {
    ok: true,
    backend: {
      url: new URL("/api/editor/agent/ag-ui", baseUrl).toString(),
      mode: "local"
    },
    mode: "local",
    authRequired: false,
    authConfigured: false
  };
}

function isLocalAgUiBackendEnabled(): boolean {
  return process.env.CUBICA_EDITOR_AGENT_LOCAL_BACKEND !== "0";
}

function isProductionAgentBackendMode(): boolean {
  const explicit = process.env.CUBICA_EDITOR_AGENT_PRODUCTION?.trim();
  if (explicit !== undefined && explicit !== "") {
    return explicit === "1" || explicit === "true";
  }
  return process.env.NODE_ENV === "production";
}

function hasAgUiBackendAuthToken(): boolean {
  const token = process.env.CUBICA_EDITOR_AGENT_AG_UI_TOKEN?.trim();
  return token !== undefined && token !== "";
}

function getAgUiBackendHeaders(mode: "external" | "local"): Record<string, string> {
  const headers: Record<string, string> = {
    "x-cubica-agent-id": EDITOR_AUTHORING_ASSISTANT_ID,
    "x-cubica-agent-backend-mode": mode
  };
  const token = process.env.CUBICA_EDITOR_AGENT_AG_UI_TOKEN?.trim();
  if (token !== undefined && token !== "") {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}
