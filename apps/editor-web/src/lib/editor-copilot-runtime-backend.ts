/**
 * Server-side AG-UI backend selection and credential separation for Editor.
 *
 * Keeping this outside the Next.js route module lets tests inspect the policy
 * without exporting unsupported fields from the HTTP route itself.
 */
import type { NextRequest } from "next/server";

import { EDITOR_AUTHORING_ASSISTANT_ID } from "@/lib/agent-assistant-registry";
import {
  createLocalProductContextShadowHeaders,
  getLocalProductContextShadowOrigin
} from "@/lib/product-context-shadow-forwarding";

export type AgUiBackendReadiness =
  | {
      readonly ok: true;
      readonly backend: { readonly url: string; readonly mode: "external" | "local" } | undefined;
      readonly mode?: "external" | "local";
      readonly authRequired: boolean;
      readonly authConfigured: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: "external-auth-missing" | "external-url-invalid" | "local-origin-invalid" | "local-origin-mismatch";
      readonly message: string;
      readonly mode: "external" | "local";
      readonly authRequired: boolean;
      readonly authConfigured: boolean;
    };

export function getAgUiBackendReadiness(request?: NextRequest): AgUiBackendReadiness {
  const configuredUrl = process.env.CUBICA_EDITOR_AGENT_AG_UI_URL?.trim() || undefined;
  if (configuredUrl !== undefined) {
    const safeUrl = safeBackendEndpoint(configuredUrl);
    const authConfigured = hasAgUiBackendAuthToken();
    if (safeUrl === null) {
      return {
        ok: false,
        reason: "external-url-invalid",
        message: "External AG-UI backend requires HTTPS or loopback HTTP without embedded credentials.",
        mode: "external",
        authRequired: isProductionAgentBackendMode(),
        authConfigured
      };
    }
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
      backend: { url: safeUrl, mode: "external" },
      mode: "external",
      authRequired: isProductionAgentBackendMode(),
      authConfigured
    };
  }

  if (process.env.CUBICA_EDITOR_AGENT_LOCAL_BACKEND === "0") {
    return { ok: true, backend: undefined, authRequired: false, authConfigured: false };
  }

  const shadowRequested = process.env.CUBICA_PRODUCT_CONTEXT_MODE === "shadow";
  const trustedShadowOrigin = request !== undefined && shadowRequested
    ? getLocalProductContextShadowOrigin(request)
    : null;
  if (request !== undefined && shadowRequested && trustedShadowOrigin === null) {
    return {
      ok: false,
      reason: "local-origin-mismatch",
      message: "Local AG-UI request origin does not match the configured shadow origin.",
      mode: "local",
      authRequired: false,
      authConfigured: false
    };
  }
  const configuredLocalOrigin = request === undefined
    ? "http://127.0.0.1:3000"
    : shadowRequested
      ? trustedShadowOrigin
      : request.nextUrl.origin;
  const baseUrl = configuredLocalOrigin === null ? null : safeBackendOrigin(configuredLocalOrigin);
  if (baseUrl === null) {
    return {
      ok: false,
      reason: "local-origin-invalid",
      message: "Local AG-UI backend requires an explicit HTTPS or loopback origin.",
      mode: "local",
      authRequired: false,
      authConfigured: false
    };
  }
  return {
    ok: true,
    backend: { url: new URL("/api/editor/agent/ag-ui", baseUrl).toString(), mode: "local" },
    mode: "local",
    authRequired: false,
    authConfigured: false
  };
}

export function getAgUiBackendHeaders(
  mode: "external" | "local",
  request?: Pick<Request, "headers" | "url">
): Record<string, string> {
  const headers: Record<string, string> = {
    "x-cubica-agent-id": EDITOR_AUTHORING_ASSISTANT_ID,
    "x-cubica-agent-backend-mode": mode
  };
  if (mode === "local" && request !== undefined) {
    Object.assign(headers, createLocalProductContextShadowHeaders(request));
  }
  const token = mode === "external" ? process.env.CUBICA_EDITOR_AGENT_AG_UI_TOKEN?.trim() : undefined;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function isProductionAgentBackendMode(): boolean {
  const explicit = process.env.CUBICA_EDITOR_AGENT_PRODUCTION?.trim();
  if (explicit) return explicit === "1" || explicit === "true";
  return process.env.NODE_ENV === "production";
}

function hasAgUiBackendAuthToken(): boolean {
  return Boolean(process.env.CUBICA_EDITOR_AGENT_AG_UI_TOKEN?.trim());
}

function safeBackendEndpoint(value: string): string | null {
  try {
    const url = new URL(value);
    const loopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    if (url.username || url.password || url.hash) return null;
    return url.protocol === "https:" || (url.protocol === "http:" && loopback) ? url.toString() : null;
  } catch { return null; }
}

function safeBackendOrigin(value: string): string | null {
  const endpoint = safeBackendEndpoint(value);
  if (endpoint === null) return null;
  const url = new URL(endpoint);
  return url.pathname === "/" && !url.search ? url.origin : null;
}
