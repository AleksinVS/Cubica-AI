import type { SessionSnapshot } from "@/lib/game-content-resolvers";

/**
 * Browser-side client for the server-owned portal launch exchange.
 *
 * Launch secrets are resolved by Player Web's BFF. The browser receives only
 * the safe runtime snapshot; the runtime bearer and stable device token are
 * stored as HttpOnly cookies by the route handler.
 */

export type PortalLaunchContext = {
  token: string;
  counter: string;
  gameId?: string;
};

type RuntimeBindingResponse = {
  ok: boolean;
  reason?: string;
  runtimeSessionId?: string;
  runtimeSession?: SessionSnapshot;
};

export function readPortalLaunchContext(): PortalLaunchContext | null {
  if (typeof window === "undefined") {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const token = params.get("launchToken");
  const counter = params.get("launchCounter");

  if (!token || !counter) {
    return null;
  }

  return {
    token,
    counter,
    gameId: params.get("gameId") ?? undefined,
  };
}

export function launchScopedStorageKey(baseKey: string, context: PortalLaunchContext): string {
  return `${baseKey}:launch:${context.token}:${context.counter}`;
}

export async function bindPortalLaunchSession(
  context: PortalLaunchContext
): Promise<SessionSnapshot> {
  const response = await fetch("/api/portal/runtime-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      token: context.token,
      counter: context.counter
    })
  });
  const payload = (await response.json().catch(() => null)) as RuntimeBindingResponse | null;

  if (!response.ok || !payload?.ok || !payload.runtimeSession) {
    throw new Error(payload?.reason || `Failed to bind portal launch session: ${response.status}`);
  }

  return payload.runtimeSession;
}
