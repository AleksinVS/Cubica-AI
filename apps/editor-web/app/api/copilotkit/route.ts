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
import { getAgUiBackendHeaders, getAgUiBackendReadiness } from "@/lib/editor-copilot-runtime-backend";

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
    runtime: createEditorCopilotRuntime(backendReadiness.backend, request),
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
  agUiBackend: { readonly url: string; readonly mode: "external" | "local" } | undefined,
  request?: Pick<Request, "headers" | "url">
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
        headers: getAgUiBackendHeaders(agUiBackend.mode, request),
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
