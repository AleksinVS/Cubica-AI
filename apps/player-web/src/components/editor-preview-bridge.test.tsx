import { render } from "@testing-library/react";
import React, { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useEditorPreviewBridge, type EditorPreviewBridgeOptions } from "./editor-preview-bridge";

function BridgeHarness({ options }: { readonly options: EditorPreviewBridgeOptions }) {
  const rootRef = useRef<HTMLElement>(null);
  useEditorPreviewBridge(rootRef, options);
  return <main ref={rootRef} />;
}

describe("useEditorPreviewBridge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([undefined, "not an origin"])("does not post preview data without a confirmed editor origin", (parentOrigin) => {
    const postMessage = vi.spyOn(window.parent, "postMessage").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => undefined);

    render(<BridgeHarness options={{ enabled: true, parentOrigin, refreshSignal: "initial" }} />);

    expect(postMessage).not.toHaveBeenCalled();
  });

  it("posts to a confirmed editor origin so the existing preview exchange remains available", () => {
    // happy-dom models parent as this same window. Replace the transport so this
    // test asserts the target selected by the bridge rather than its same-window
    // origin policy, which a real cross-origin iframe does not have.
    const postMessage = vi.spyOn(window.parent, "postMessage").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => undefined);

    render(<BridgeHarness options={{ enabled: true, parentOrigin: "https://editor.example.test", refreshSignal: "initial" }} />);

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "previewEntities" }), "https://editor.example.test");
  });

  it("reposts a snapshot only for a versioned request from the confirmed editor parent", () => {
    const postMessage = vi.spyOn(window.parent, "postMessage").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => undefined);

    render(
      <BridgeHarness
        options={{
          enabled: true,
          parentOrigin: "https://editor.example.test",
          refreshSignal: "initial",
          sessionSnapshot: {
            sessionId: "session-1",
            gameId: "example",
            version: { sessionId: "session-1", stateVersion: 0, lastEventSequence: 0 },
            state: { public: { ready: true } }
          }
        }}
      />
    );
    postMessage.mockClear();

    window.dispatchEvent(new MessageEvent("message", {
      source: window.parent,
      origin: "https://attacker.example.test",
      data: { source: "cubica-editor-web", type: "requestPreviewSnapshot", version: 1 }
    }));
    expect(postMessage).not.toHaveBeenCalled();

    window.dispatchEvent(new MessageEvent("message", {
      source: window.parent,
      origin: "https://editor.example.test",
      data: { source: "cubica-editor-web", type: "requestPreviewSnapshot", version: 1 }
    }));
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "previewSessionSnapshot", sessionId: "session-1" }),
      "https://editor.example.test"
    );
  });

  it("restores only the active session for the confirmed editor parent", async () => {
    const postMessage = vi.spyOn(window.parent, "postMessage").mockImplementation(() => undefined);
    const onRestorePreviewSession = vi.fn().mockResolvedValue({
      sessionId: "session-1",
      gameId: "example",
      version: { sessionId: "session-1", stateVersion: 2, lastEventSequence: 1 },
      state: { public: { ready: true } }
    });
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => undefined);

    render(
      <BridgeHarness
        options={{
          enabled: true,
          parentOrigin: "https://editor.example.test",
          refreshSignal: "initial",
          sessionSnapshot: {
            sessionId: "session-1",
            gameId: "example",
            version: { sessionId: "session-1", stateVersion: 1, lastEventSequence: 1 },
            state: { public: { ready: true } }
          },
          onRestorePreviewSession
        }}
      />
    );
    postMessage.mockClear();

    const validRequest = {
      source: "cubica-editor-web",
      type: "restorePreviewSession",
      protocolVersion: 1,
      requestId: "restore-1",
      sessionId: "session-1",
      state: { public: { ready: true } },
      version: { stateVersion: 0, lastEventSequence: 0 },
      targetEventSequence: 0
    };
    window.dispatchEvent(new MessageEvent("message", {
      source: window.parent,
      origin: "https://attacker.example.test",
      data: validRequest
    }));
    window.dispatchEvent(new MessageEvent("message", {
      source: window.parent,
      origin: "https://editor.example.test",
      data: { ...validRequest, sessionId: "session-2" }
    }));
    expect(onRestorePreviewSession).not.toHaveBeenCalled();

    window.dispatchEvent(new MessageEvent("message", {
      source: window.parent,
      origin: "https://editor.example.test",
      data: validRequest
    }));
    await vi.waitFor(() => expect(onRestorePreviewSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      state: { public: { ready: true } },
      version: { stateVersion: 0, lastEventSequence: 0 },
      targetEventSequence: 0
    }));
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "previewRestoreResult",
        requestId: "restore-1",
        ok: true,
        sessionVersion: { sessionId: "session-1", stateVersion: 2, lastEventSequence: 1 }
      }),
      "https://editor.example.test"
    );
  });
});
