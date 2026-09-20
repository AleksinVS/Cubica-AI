import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { DebugCheckpointMetadata, DebugSessionControlResponse } from "@cubica/contracts-session";
import { EditorDebugChannel, type EditorDebugCommand } from "@/lib/editor-debug-channel";
import { forgetDebugOrigin, readDebugOrigins, rememberDebugOrigin } from "@/lib/editor-debug-catalog";

export interface MvpSavedState extends DebugCheckpointMetadata {
  readonly sourceSessionId: string;
}

export function savedStateUnavailableReason(state: DebugCheckpointMetadata): string | undefined {
  if (state.compatibility === "compatible") return undefined;
  if (state.compatibility === "unavailable") return "Не удалось проверить совместимость. Подготовьте текущую игру и повторите проверку.";
  const reasons: Record<NonNullable<DebugCheckpointMetadata["compatibilityReason"]>, string> = {
    "state-model": "Состояние противоречит текущей модели игры.",
    participants: "Изменились ограничения состава игроков.",
    schedule: "Изменились запланированные игровые действия.",
    "storage-bindings": "Изменилась структура игровых данных.",
    "content-unavailable": "Текущая игра недоступна.",
    "rules-unavailable": "Исходная модель недоступна для сравнения.",
    "runtime-policy": "Текущую игру пока нельзя запустить."
  };
  return state.compatibilityReason ? reasons[state.compatibilityReason] : "Состояние несовместимо с текущей моделью игры.";
}

export function useMvpDebugSession(input: {
  catalogKey: string;
  previewUrl: string | null;
  sessionId: string | undefined;
  iframeRef: RefObject<HTMLIFrameElement>;
  onRestored: (sessionId: string) => void;
}) {
  const channelRef = useRef<EditorDebugChannel | null>(null);
  const actionRef = useRef<symbol | null>(null);
  const generation = useRef(0);
  const inputRef = useRef(input);
  inputRef.current = input;
  const [status, setStatus] = useState<DebugSessionControlResponse | null>(null);
  const [savedStates, setSavedStates] = useState<MvpSavedState[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incompatibleState, setIncompatibleState] = useState<{ state: MvpSavedState; reason: string } | null>(null);

  useEffect(() => { setSavedStates([]); setIncompatibleState(null); }, [input.catalogKey]);

  useEffect(() => {
    generation.current++;
    setStatus(null);
    setBusy(false);
    actionRef.current = null;
    if (input.previewUrl === null) return;
    const channel = new EditorDebugChannel(() => input.iframeRef.current?.contentWindow ?? null, new URL(input.previewUrl).origin);
    channelRef.current = channel;
    return () => {
      generation.current++;
      channel.close();
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [input.previewUrl, input.iframeRef, input.catalogKey]);

  const request = useCallback(async (command: EditorDebugCommand) => {
    const channel = channelRef.current;
    if (channel === null) throw new Error("Сначала подготовьте предпросмотр игры.");
    const response = await channel.request(command);
    if (channel !== channelRef.current) throw new Error("Предпросмотр изменился. Повторите действие.");
    if (!response.ok) throw new Error(response.error);
    return response;
  }, []);

  const readStatus = useCallback(async (sessionId: string) => {
    const response = await request({ operation: "status", sessionId });
    if (response.operation !== "status") throw new Error("Сервер не подтвердил состояние отладки.");
    if (inputRef.current.sessionId === sessionId) {
      setStatus(current => current?.sessionId === sessionId && current.version.stateVersion > response.data.version.stateVersion
        ? current : response.data);
    }
    return response.data;
  }, [request]);

  const refreshSavedStates = useCallback(async (sessionId: string) => {
    const key = inputRef.current.catalogKey;
    const response = await request({ operation: "list", sessionId });
    if (response.operation !== "list") throw new Error("Не удалось прочитать сохранённые состояния.");
    if (key !== inputRef.current.catalogKey) return;
    setSavedStates(current => [
      ...current.filter(item => item.sourceSessionId !== sessionId),
      ...response.data.checkpoints.map(item => ({ ...item, sourceSessionId: sessionId }))
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    // An authoritative empty list, never a timeout or unavailable source, permits pruning the hint.
    if (response.data.checkpoints.length === 0) forgetDebugOrigin(key, sessionId);
    return response.data.checkpoints.map(item => ({ ...item, sourceSessionId: sessionId }));
  }, [request]);

  const refreshCatalog = useCallback(async () => {
    const stamp = generation.current;
    const current = inputRef.current.sessionId;
    if (!current) return;
    const origins = [...new Set([current, ...readDebugOrigins(inputRef.current.catalogKey)])];
    let failed = false;
    for (const origin of origins) {
      if (stamp !== generation.current) return;
      try { await refreshSavedStates(origin); }
      catch {
        if (stamp !== generation.current) return;
        failed = true;
        setSavedStates(states => states.map(state => state.sourceSessionId === origin
          ? { ...state, compatibility: "unavailable", compatibilityReason: "content-unavailable" } : state));
      }
    }
    if (failed) throw new Error("Часть сохранений сейчас недоступна. Они сохранены на сервере; повторите проверку после подключения игры.");
  }, [refreshSavedStates]);

  useEffect(() => {
    const sessionId = input.sessionId;
    if (sessionId === undefined || channelRef.current === null) return;
    let cancelled = false;
    setError(null);
    void readStatus(sessionId).then(() => { if (!cancelled) return refreshCatalog(); }).catch(cause => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Отладка недоступна.");
    });
    const poll = setInterval(() => {
      if (!actionRef.current) void readStatus(sessionId).catch(() => {});
    }, 5_000);
    return () => { cancelled = true; clearInterval(poll); };
  }, [input.sessionId, input.previewUrl, input.catalogKey, readStatus, refreshCatalog]);

  const perform = useCallback(async (run: () => Promise<void>): Promise<boolean> => {
    if (actionRef.current) return false;
    const action = Symbol();
    const stamp = generation.current;
    actionRef.current = action;
    setBusy(true);
    setError(null);
    try { await run(); return stamp === generation.current; }
    catch (cause) {
      if (stamp === generation.current) setError(cause instanceof Error ? cause.message : "Действие не выполнено.");
      return false;
    }
    finally {
      if (actionRef.current === action) { actionRef.current = null; setBusy(false); }
    }
  }, []);

  const changePause = useCallback(async (paused: boolean): Promise<void> => {
    const sessionId = inputRef.current.sessionId;
    if (sessionId === undefined) throw new Error("Дождитесь подключения игры.");
    const current = await readStatus(sessionId);
    if (inputRef.current.sessionId !== sessionId) throw new Error("Предпросмотр изменился. Повторите действие.");
    if (current.paused === paused) return;
    const response = await request({ operation: paused ? "pause" : "resume", sessionId,
      payload: { expectedStateVersion: current.version.stateVersion } });
    if (response.operation !== "pause" && response.operation !== "resume") throw new Error("Действие не подтверждено сервером.");
    if (inputRef.current.sessionId === sessionId) setStatus(response.data);
  }, [readStatus, request]);

  return {
    status: status?.sessionId === input.sessionId ? status : null,
    savedStates, busy, error, incompatibleState,
    dismissIncompatibleState: () => setIncompatibleState(null),
    dismissError: () => setError(null),
    refresh: () => perform(refreshCatalog),
    setPaused: (paused: boolean) => perform(() => changePause(paused)),
    save: (label: string) => perform(async () => {
      await changePause(true);
      const { sessionId, catalogKey } = inputRef.current;
      if (!sessionId) throw new Error("Дождитесь подключения игры.");
      rememberDebugOrigin(catalogKey, sessionId);
      await request({ operation: "save", sessionId, payload: { label } });
      await refreshSavedStates(sessionId);
    }),
    restore: (state: MvpSavedState) => perform(async () => {
      setIncompatibleState(null);
      const current = (await refreshSavedStates(state.sourceSessionId))?.find(item => item.checkpointId === state.checkpointId);
      if (current === undefined) throw new Error("Снимок больше недоступен. Список обновлён.");
      const reason = savedStateUnavailableReason(current);
      if (current.compatibility === "incompatible") {
        setIncompatibleState({ state: current, reason: reason ?? "Состояние несовместимо с текущей моделью игры." });
        return;
      }
      if (reason) throw new Error(reason);
      await changePause(true);
      const response = await request({ operation: "restore", sessionId: state.sourceSessionId, checkpointId: state.checkpointId });
      if (response.operation !== "restore") throw new Error("Сохранённое состояние не восстановлено.");
      inputRef.current.onRestored(response.data.sessionId);
      setStatus(response.data);
    }),
    deleteState: (state: MvpSavedState) => perform(async () => {
      await request({ operation: "delete", sessionId: state.sourceSessionId, checkpointId: state.checkpointId });
      await refreshSavedStates(state.sourceSessionId);
      setIncompatibleState(null);
    })
  };
}
