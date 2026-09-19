import {
  validateEditorDebugBridgeResponse,
  type EditorDebugBridgeRequest,
  type EditorDebugBridgeResponse
} from "@cubica/contracts-session";
import type { SessionSnapshot } from "@/lib/game-content-resolvers";

async function requestDebug(sessionId: string, suffix: string, method = "GET", body?: unknown): Promise<unknown> {
  const response = await fetch(`/api/runtime/sessions/${encodeURIComponent(sessionId)}/debug${suffix}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  });
  if (!response.ok) {
    // Debug errors are bounded product messages; upstream details can include
    // protected implementation data and are not forwarded to the parent frame.
    throw new Error(response.status === 409
      ? "Состояние изменилось. Обновите отладку и повторите действие."
      : response.status === 401 || response.status === 403
        ? "Управление этой отладочной сессией недоступно."
        : response.status === 404
          ? "Сохранённое состояние больше недоступно."
          : "Не удалось выполнить команду отладки. Повторите попытку.");
  }
  return response.status === 204 ? null : response.json();
}

/** Only the player receives the ordinary projected snapshot; BFF retains the credential. */
export async function restoreDebugCheckpoint(sessionId: string, checkpointId: string): Promise<SessionSnapshot> {
  return await requestDebug(sessionId, `/checkpoints/${encodeURIComponent(checkpointId)}/restore`, "POST") as SessionSnapshot;
}

export async function runEditorDebugCommand(
  command: EditorDebugBridgeRequest,
  restore: (sessionId: string, checkpointId: string) => Promise<SessionSnapshot>
): Promise<EditorDebugBridgeResponse> {
  const envelope = {
    source: "cubica-player-web", type: "debugSessionResult", protocolVersion: 1,
    requestId: command.requestId, sessionId: command.sessionId
  } as const;
  try {
    let data: unknown;
    switch (command.operation) {
      case "status": data = await requestDebug(command.sessionId, ""); break;
      case "pause":
      case "resume": data = await requestDebug(command.sessionId, `/${command.operation}`, "POST", command.payload); break;
      case "list": data = await requestDebug(command.sessionId, "/checkpoints"); break;
      case "save": data = await requestDebug(command.sessionId, "/checkpoints", "POST", command.payload); break;
      case "delete": data = await requestDebug(command.sessionId, `/checkpoints/${encodeURIComponent(command.checkpointId)}`, "DELETE"); break;
      case "restore": {
        const snapshot = await restore(command.sessionId, command.checkpointId);
        if (snapshot.debugPaused !== true || snapshot.sessionId === command.sessionId) {
          throw new Error("Сервер не подтвердил новую сессию в паузе.");
        }
        // Confirm the restored session is ready before parent navigation.
        data = await requestDebug(snapshot.sessionId, "");
        break;
      }
    }
    const response = { ...envelope, ok: true, operation: command.operation, data };
    if (!validateEditorDebugBridgeResponse(response)) throw new Error("Ответ отладки не соответствует ожидаемому формату.");
    if (response.ok && (response.operation === "status" || response.operation === "pause" || response.operation === "resume") &&
      (response.data.sessionId !== command.sessionId || response.data.version.sessionId !== command.sessionId)) {
      throw new Error("Ответ относится к другой отладочной сессии.");
    }
    if (response.ok && response.operation === "restore" &&
      (response.data.sessionId === command.sessionId || response.data.version.sessionId !== response.data.sessionId || !response.data.paused)) {
      throw new Error("Сервер не подтвердил восстановление отдельной сессии в паузе.");
    }
    return response;
  } catch (error) {
    return { ...envelope, ok: false, error: (error instanceof Error ? error.message : "Команда отладки не выполнена.").slice(0, 500) };
  }
}
