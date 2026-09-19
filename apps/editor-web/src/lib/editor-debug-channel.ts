import {
  validateEditorDebugBridgeRequest,
  validateEditorDebugBridgeResponse,
  type EditorDebugBridgeRequest,
  type EditorDebugBridgeResponse
} from "@cubica/contracts-session";

type CommandOf<T> = T extends EditorDebugBridgeRequest
  ? Omit<T, "source" | "type" | "protocolVersion" | "requestId"> : never;
export type EditorDebugCommand = CommandOf<EditorDebugBridgeRequest>;

/** Correlates confirmed runtime commands with the exact mounted player frame. */
export class EditorDebugChannel {
  private readonly pending = new Map<string, {
    command: EditorDebugBridgeRequest;
    resolve: (response: EditorDebugBridgeResponse) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private closed = false;

  constructor(
    private readonly frame: () => Window | null,
    private readonly origin: string,
    private readonly timeoutMs = 30_000
  ) {
    window.addEventListener("message", this.receive);
  }

  request(input: EditorDebugCommand): Promise<EditorDebugBridgeResponse> {
    const frame = this.frame();
    if (this.closed || frame === null) return Promise.reject(new Error("Предпросмотр ещё не подключён."));
    const command = {
      ...input, source: "cubica-editor-web", type: "debugSession", protocolVersion: 1,
      requestId: crypto.randomUUID()
    };
    if (!validateEditorDebugBridgeRequest(command)) return Promise.reject(new Error("Некорректная команда отладки."));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(command.requestId);
        reject(new Error("Сервер не подтвердил действие. Проверьте состояние и повторите попытку."));
      }, this.timeoutMs);
      this.pending.set(command.requestId, { command, resolve, reject, timeout });
      try { frame.postMessage(command, this.origin); }
      catch {
        clearTimeout(timeout);
        this.pending.delete(command.requestId);
        reject(new Error("Не удалось отправить команду предпросмотру."));
      }
    });
  }

  close(): void {
    this.closed = true;
    window.removeEventListener("message", this.receive);
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(new Error("Подключение предпросмотра изменилось."));
    }
    this.pending.clear();
  }

  private readonly receive = (event: MessageEvent): void => {
    if (event.source !== this.frame() || event.origin !== this.origin ||
      !validateEditorDebugBridgeResponse(event.data)) return;
    const response = event.data;
    const entry = this.pending.get(response.requestId);
    if (entry === undefined || response.sessionId !== entry.command.sessionId ||
      (response.ok && response.operation !== entry.command.operation)) return;
    if (response.ok && (response.operation === "status" || response.operation === "pause" || response.operation === "resume") &&
      (response.data.sessionId !== entry.command.sessionId || response.data.version.sessionId !== entry.command.sessionId)) return;
    if (response.ok && response.operation === "restore" &&
      (response.data.sessionId === entry.command.sessionId || response.data.version.sessionId !== response.data.sessionId || !response.data.paused)) return;
    clearTimeout(entry.timeout);
    this.pending.delete(response.requestId);
    if (!response.ok) entry.reject(new Error(response.error));
    else entry.resolve(response);
  };
}
