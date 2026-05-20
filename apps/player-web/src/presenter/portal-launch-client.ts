import type { SessionSnapshot } from "@/lib/game-content-resolvers";

/**
 * Browser-side client for portal launch binding.
 *
 * Player Web remains a game renderer. When opened from a portal launch URL, it
 * asks the portal backend which runtime-api session belongs to this link and
 * device. This prevents stale localStorage sessions from leaking across links.
 */

const PORTAL_API_URL = process.env.NEXT_PUBLIC_PORTAL_API_URL ?? "http://localhost:1337";
const DEVICE_TOKEN_COOKIE = "cubica_device_token";

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

function randomToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  const prefix = `${name}=`;
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  return match ? decodeURIComponent(match.slice(prefix.length)) : null;
}

function writeCookie(name: string, value: string): void {
  if (typeof document === "undefined") {
    return;
  }

  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=31536000`;
}

export function getOrCreateDeviceToken(): string {
  const existing = readCookie(DEVICE_TOKEN_COOKIE);

  if (existing) {
    return existing;
  }

  const next = randomToken();
  writeCookie(DEVICE_TOKEN_COOKIE, next);
  return next;
}

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
  context: PortalLaunchContext,
  playerId: string
): Promise<SessionSnapshot> {
  const response = await fetch(
    `${PORTAL_API_URL.replace(/\/$/, "")}/api/launch-sessions/resolve/${encodeURIComponent(context.token)}/${encodeURIComponent(context.counter)}/runtime-binding`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceToken: getOrCreateDeviceToken(),
        playerId,
      }),
    }
  );
  const payload = (await response.json().catch(() => null)) as RuntimeBindingResponse | null;

  if (!response.ok || !payload?.ok || !payload.runtimeSession) {
    throw new Error(payload?.reason || `Failed to bind portal launch session: ${response.status}`);
  }

  return payload.runtimeSession;
}
