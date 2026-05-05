import type { SessionSnapshot } from "@/lib/game-content-resolvers";

export type ActionSnapshot = SessionSnapshot;

async function parseJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

/**
 * Создаёт новую игровую сессию через runtime-api.
 */
export async function createNewSession(gameId: string, playerId: string): Promise<SessionSnapshot> {
  const response = await fetch("/api/runtime/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId, playerId })
  });
  if (!response.ok) {
    throw new Error(`Failed to create session: ${response.status}`);
  }
  return parseJson<SessionSnapshot>(response);
}

/**
 * Возобновляет существующую сессию по её идентификатору.
 */
export async function resumeSession(sessionId: string): Promise<SessionSnapshot> {
  const response = await fetch(`/api/runtime/sessions/${sessionId}`);
  if (!response.ok) {
    throw new Error(`Failed to resume session: ${response.status}`);
  }
  return parseJson<SessionSnapshot>(response);
}

/**
 * Отправляет игровое действие в runtime-api и возвращает обновлённое состояние.
 */
export async function dispatchAction(
  sessionId: string,
  playerId: string,
  actionId: string,
  payload: Record<string, unknown> = {}
): Promise<ActionSnapshot> {
  const response = await fetch("/api/runtime/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, playerId, actionId, payload })
  });
  if (!response.ok) {
    const errorPayload = (await parseJson<Record<string, unknown>>(response)) as { error?: string };
    throw new Error(errorPayload.error ?? `Action "${actionId}" failed`);
  }
  return parseJson<ActionSnapshot>(response);
}
