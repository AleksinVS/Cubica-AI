import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMvpDebugSession, type MvpSavedState } from "./use-mvp-debug-session";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/editor-debug-channel", () => ({ EditorDebugChannel: class { request = request; close() {} } }));
vi.mock("@/lib/editor-debug-catalog", () => ({ readDebugOrigins: () => [], rememberDebugOrigin: vi.fn(), forgetDebugOrigin: vi.fn() }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const original = { checkpointId: "snapshot", sourceSessionId: "session", label: "Проверка", createdAt: "2026-09-20T00:00:00Z", compatibility: "compatible" } as MvpSavedState;
const status = { sessionId: "session", paused: true, version: { sessionId: "session", stateVersion: 1 } };

describe("saved-state compatibility on selection", () => {
  let root: Root;
  let container: HTMLDivElement;
  let current: ReturnType<typeof useMvpDebugSession>;
  let listed: MvpSavedState;
  const onRestored = vi.fn();

  function Harness() {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    current = useMvpDebugSession({ catalogKey: "test", previewUrl: "http://localhost:3300", sessionId: "session", iframeRef, onRestored });
    return null;
  }

  beforeEach(async () => {
    listed = original;
    request.mockReset();
    onRestored.mockClear();
    request.mockImplementation(async (command: { operation: string }) => ({
      ok: true, operation: command.operation,
      data: command.operation === "list" ? { checkpoints: [listed] }
        : command.operation === "restore" ? { ...status, sessionId: "restored" } : status
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => { root = createRoot(container); root.render(<Harness />); });
    request.mockClear();
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it("checks a fresh catalog and offers deletion when a previously compatible snapshot now conflicts", async () => {
    listed = { ...original, compatibility: "incompatible", compatibilityReason: "state-model" };
    await act(async () => { await current.restore(original); });
    expect(request.mock.calls.map(([command]) => command.operation)).toEqual(["list"]);
    expect(current.incompatibleState?.state.checkpointId).toBe("snapshot");
    expect(current.incompatibleState?.reason).toContain("модели игры");
    expect(onRestored).not.toHaveBeenCalled();
  });

  it("allows a formerly incompatible snapshot when the fresh check succeeds", async () => {
    await act(async () => { await current.restore({ ...original, compatibility: "incompatible", compatibilityReason: "state-model" }); });
    expect(request.mock.calls.map(([command]) => command.operation)).toEqual(["list", "status", "restore"]);
    expect(onRestored).toHaveBeenCalledWith("restored");
    expect(current.incompatibleState).toBeNull();
  });

  it("does not offer deletion for an unavailable comparison or network failure", async () => {
    listed = { ...original, compatibility: "unavailable", compatibilityReason: "content-unavailable" };
    await act(async () => { await current.restore(original); });
    expect(current.error).toContain("Не удалось проверить совместимость");
    expect(current.incompatibleState).toBeNull();
    request.mockRejectedValueOnce(new Error("Нет подключения"));
    await act(async () => { await current.restore(original); });
    expect(current.error).toBe("Нет подключения");
    expect(current.incompatibleState).toBeNull();
    expect(onRestored).not.toHaveBeenCalled();
  });
});
