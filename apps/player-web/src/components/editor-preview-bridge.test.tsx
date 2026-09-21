import { render, waitFor } from "@testing-library/react";
import React, { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerFacingContent } from "@cubica/contracts-manifest";
import { withPreviewContentOrigin } from "@/lib/preview-content-origin";

import { useEditorPreviewBridge, type EditorPreviewBridgeOptions } from "./editor-preview-bridge";
import { UiComponentNode } from "./manifest/ui-component-node";

function BridgeHarness({ options, withEntity = false, withDirectBinding = false, enclosingItemPointer }: {
  readonly options: EditorPreviewBridgeOptions;
  readonly withEntity?: boolean;
  readonly withDirectBinding?: boolean;
  readonly enclosingItemPointer?: string;
}) {
  const rootRef = useRef<HTMLElement>(null);
  useEditorPreviewBridge(rootRef, options);
  const selected = withPreviewContentOrigin({ id: "i0", title: "Opening" }, {
    runtimePointer: "/content/data/infos/1", fields: ["title"]
  });
  const content: PlayerFacingContent = {
    gameId: "neutral-preview", version: "1.0.0", name: "Neutral preview",
    description: "Preview origin fixture", locale: "en-US",
    playerConfig: { min: 1, max: 1 }, actions: [], mockups: [],
    content: { data: { infos: [{ id: "i0", title: "Opening" }, selected] } }
  };
  return <main ref={rootRef}>{withEntity ? <span
    data-preview-runtime-pointer="/screens/scene-a/root/children/0"
    data-preview-entity-id="card:source-3"
    data-preview-content-runtime-pointer="/content/data/cards/3"
  /> : null}{withDirectBinding ? <UiComponentNode
    component={{ type: "richTextComponent", props: { html: "{{currentInfo.title}}" } }}
    metrics={{}} onAction={() => undefined} screenKey="scene-a" editorPreviewMode
    runtimePointer="/screens/scene-a/root/children/1"
    previewContentRuntimePointer={enclosingItemPointer}
    gameState={{ currentInfo: selected }} content={content}
  /> : null}</main>;
}

describe("useEditorPreviewBridge", () => {
  it("admits debug commands only from the exact parent origin and canonical schema", async () => {
    vi.spyOn(window.parent, "postMessage").mockImplementation(() => undefined);
    const onDebugSession = vi.fn().mockResolvedValue({
      source: "cubica-player-web", type: "debugSessionResult", protocolVersion: 1,
      requestId: "debug-1", sessionId: "session-1", ok: false, error: "Unavailable"
    });
    const mounted = render(<BridgeHarness options={{
      enabled: true, parentOrigin: "https://editor.example.test", refreshSignal: "initial", onDebugSession
    }} />);
    const command = {
      source: "cubica-editor-web", type: "debugSession", protocolVersion: 1,
      requestId: "debug-1", sessionId: "session-1", operation: "pause", payload: { expectedStateVersion: 1 }
    };
    for (const [origin, data, source] of [
      ["https://attacker.example.test", command, window.parent],
      ["https://editor.example.test", { ...command, credential: "injected" }, window.parent],
      ["https://editor.example.test", command, null]
    ] as const) {
      window.dispatchEvent(new MessageEvent("message", { origin, data, source }));
    }
    expect(onDebugSession).not.toHaveBeenCalled();
    window.dispatchEvent(new MessageEvent("message", { origin: "https://editor.example.test", data: command, source: window.parent }));
    await vi.waitFor(() => expect(onDebugSession).toHaveBeenCalledOnce());
    expect(onDebugSession).toHaveBeenCalledWith(command);
    mounted.unmount();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("refreshes child bounds after nested layout and scroll without a root resize", () => {
    const observed = new Set<Element>();
    let notifyResize: (() => void) | undefined;
    class ChildResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = () => callback([], this as unknown as ResizeObserver);
      }
      observe(element: Element) { observed.add(element); }
      unobserve(element: Element) { observed.delete(element); }
      disconnect() { observed.clear(); }
    }
    vi.stubGlobal("ResizeObserver", ChildResizeObserver);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => undefined);
    const flushFrame = () => { for (const callback of frames.splice(0)) callback(0); };
    const postMessage = vi.spyOn(window.parent, "postMessage").mockImplementation(() => undefined);
    const mounted = render(<BridgeHarness withEntity options={{ enabled: true,
      parentOrigin: "https://editor.example.test", refreshSignal: "same",
      sessionSnapshot: { sessionId: "session-1",
        version: { sessionId: "session-1", stateVersion: 1, lastEventSequence: 0 }, state: { public: {} } }
    }} />);
    const child = mounted.container.querySelector<HTMLElement>("[data-preview-runtime-pointer]");
    if (!child) throw Error("Missing annotated child");
    let x = 10;
    child.getBoundingClientRect = () => ({ x, y: 20, left: x, top: 20,
      right: x + 80, bottom: 40, width: 80, height: 20, toJSON: () => ({}) });
    flushFrame();
    expect(observed.has(child)).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "previewSessionSnapshot" }), "https://editor.example.test");
    postMessage.mockClear();

    x = 140;
    notifyResize?.();
    notifyResize?.();
    expect(frames).toHaveLength(1);
    flushFrame();
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "previewEntities",
      entities: expect.arrayContaining([expect.objectContaining({ bounds: expect.objectContaining({ x: 140 }) })])
    }), "https://editor.example.test");

    expect(postMessage.mock.calls.some(([message]) => message.type === "previewSessionSnapshot")).toBe(false);
    postMessage.mockClear();
    x = 190;
    window.dispatchEvent(new Event("scroll"));
    flushFrame();
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "previewEntities",
      entities: expect.arrayContaining([expect.objectContaining({ bounds: expect.objectContaining({ x: 190 }) })])
    }), "https://editor.example.test");
    expect(postMessage.mock.calls.some(([message]) => message.type === "previewSessionSnapshot")).toBe(false);
  });

  it("registers a late annotated child and publishes it without changing root dimensions", async () => {
    const observed = new Set<Element>();
    class ChildResizeObserver {
      constructor(_callback: ResizeObserverCallback) {}
      observe(element: Element) { observed.add(element); }
      unobserve(element: Element) { observed.delete(element); }
      disconnect() { observed.clear(); }
    }
    vi.stubGlobal("ResizeObserver", ChildResizeObserver);
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) =>
      setTimeout(() => callback(0), 0) as unknown as number);
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => clearTimeout(id));
    const postMessage = vi.spyOn(window.parent, "postMessage").mockImplementation(() => undefined);
    const mounted = render(<BridgeHarness options={{ enabled: true,
      parentOrigin: "https://editor.example.test", refreshSignal: "same",
      sessionSnapshot: { sessionId: "session-1",
        version: { sessionId: "session-1", stateVersion: 1, lastEventSequence: 0 }, state: { public: {} } }
    }} />);
    const root = mounted.container.querySelector("main");
    if (!root) throw Error("Missing bridge root");
    const lateChild = document.createElement("span");
    lateChild.dataset.previewRuntimePointer = "/screens/scene-a/root/children/late";
    lateChild.dataset.previewEntityId = "late-plugin-child";
    lateChild.getBoundingClientRect = () => ({ x: 55, y: 30, left: 55, top: 30,
      right: 95, bottom: 50, width: 40, height: 20, toJSON: () => ({}) });
    root.append(lateChild);

    await waitFor(() => expect(observed.has(lateChild)).toBe(true));
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "previewEntities", entities: expect.arrayContaining([expect.objectContaining({
        entityId: "late-plugin-child", runtimePointer: "/screens/scene-a/root/children/late",
        bounds: expect.objectContaining({ x: 55 })
      })])
    }), "https://editor.example.test"));
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

    render(<BridgeHarness withEntity options={{ enabled: true, parentOrigin: "https://editor.example.test",
      refreshSignal: "initial", compileRevision: "compile-7", screenKey: "scene-a",
      scene: { screenId: "S2", stepIndex: 15 },
      sessionSnapshot: {
        sessionId: "session-1", version: { sessionId: "session-1", stateVersion: 3, lastEventSequence: 2 },
        state: { public: {} }
      } }} />);

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "previewEntities", version: 2,
      context: {
        sessionId: "session-1",
        sessionVersion: { sessionId: "session-1", stateVersion: 3, lastEventSequence: 2 },
        compileRevision: "compile-7", screenKey: "scene-a", scene: { screenId: "S2", stepIndex: 15 }
      },
      entities: expect.arrayContaining([expect.objectContaining({
        entityId: "card:source-3", contentRuntimePointer: "/content/data/cards/3"
      })])
    }), "https://editor.example.test");
  });

  it.each([undefined, "/content/data/cards/3"])("uses the displayed text's exact owner with enclosing item %s", (enclosingItemPointer) => {
    const postMessage = vi.spyOn(window.parent, "postMessage").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => undefined);
    render(<BridgeHarness withDirectBinding enclosingItemPointer={enclosingItemPointer} options={{ enabled: true,
      parentOrigin: "https://editor.example.test", refreshSignal: "initial", compileRevision: "compile-1",
      sessionSnapshot: { sessionId: "session-1",
        version: { sessionId: "session-1", stateVersion: 1, lastEventSequence: 0 }, state: { public: {} } }
    }} />);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "previewEntities", entities: expect.arrayContaining([expect.objectContaining({
        runtimePointer: "/screens/scene-a/root/children/1",
        contentRuntimePointer: "/content/data/infos/1",
        textBinding: { prop: "html", expression: "{{currentInfo.title}}",
          contentRuntimePointer: "/content/data/infos/1/title" }
      })])
    }), "https://editor.example.test");
  });

  it("publishes scene and compile changes even when the session version stays fixed", () => {
    const postMessage = vi.spyOn(window.parent, "postMessage").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => undefined);
    const sessionSnapshot = {
      sessionId: "session-1",
      version: { sessionId: "session-1", stateVersion: 3, lastEventSequence: 2 },
      state: { public: {} }
    };
    const common = { enabled: true, parentOrigin: "https://editor.example.test", refreshSignal: "same", sessionSnapshot };
    const mounted = render(<BridgeHarness options={{ ...common, compileRevision: "compile-1",
      screenKey: "scene-a", scene: { screenId: "S1", stepIndex: 1 } }} />);
    postMessage.mockClear();
    mounted.rerender(<BridgeHarness options={{ ...common, compileRevision: "compile-2",
      screenKey: "scene-b", scene: { screenId: "S2", stepIndex: 15 } }} />);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "previewEntities",
      context: expect.objectContaining({ compileRevision: "compile-2", screenKey: "scene-b",
        scene: { screenId: "S2", stepIndex: 15 } }) }), "https://editor.example.test");
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "previewEntities",
      context: expect.objectContaining({ compileRevision: "compile-1" }) }), expect.anything());
    postMessage.mockClear();
    mounted.rerender(<BridgeHarness options={{ ...common, compileRevision: "compile-2",
      screenKey: "scene-b", scene: { screenId: "S2", stepIndex: 15 },
      prototypePreview: { runtimePointer: "/screens/scene-b/root/children/0", requestId: "prototype-2" } }} />);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "previewEntities",
      context: expect.objectContaining({ prototypePreview: {
        runtimePointer: "/screens/scene-b/root/children/0", requestId: "prototype-2"
      } }) }), "https://editor.example.test");
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

  it("accepts refresh and scene commands only for the exact parent, schema, and live session", async () => {
    const postMessage = vi.spyOn(window.parent, "postMessage").mockImplementation(() => undefined);
    const onRefreshPreviewContent = vi.fn().mockResolvedValue({});
    const onShowPreviewScene = vi.fn().mockResolvedValue(undefined);
    const onShowPreviewPrototype = vi.fn().mockResolvedValue(undefined);
    const mounted = render(<BridgeHarness options={{ enabled: true, parentOrigin: "https://editor.example.test",
      refreshSignal: "initial", sessionSnapshot: {
        sessionId: "session-1", gameId: "example",
        version: { sessionId: "session-1", stateVersion: 1, lastEventSequence: 1 }, state: { public: {} }
      }, onRefreshPreviewContent, onShowPreviewScene, onShowPreviewPrototype }} />);
    const refresh = { source: "cubica-editor-web", type: "refreshPreviewContent", protocolVersion: 1,
      requestId: "refresh-1", sessionId: "session-1", revision: "revision-1" };
    const send = (data: unknown, origin = "https://editor.example.test") => window.dispatchEvent(new MessageEvent("message", {
      source: window.parent, origin, data
    }));
    send(refresh, "https://attacker.example.test");
    send({ ...refresh, sessionId: "session-2" });
    send({ ...refresh, credential: "injected" });
    expect(onRefreshPreviewContent).not.toHaveBeenCalled();
    send(refresh);
    await vi.waitFor(() => expect(onRefreshPreviewContent).toHaveBeenCalledOnce());
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "previewContentRefreshResult",
      requestId: "refresh-1", sessionId: "session-1", revision: "revision-1", ok: true }),
      "https://editor.example.test");

    const scene = { source: "cubica-editor-web", type: "showPreviewScene", protocolVersion: 1,
      requestId: "scene-1", sessionId: "session-1", selector: { screenId: "S2", stepIndex: 7 } };
    send({ ...scene, selector: { ...scene.selector, unknown: true } });
    expect(onShowPreviewScene).not.toHaveBeenCalled();
    send(scene);
    await vi.waitFor(() => expect(onShowPreviewScene).toHaveBeenCalledOnce());
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "previewSceneResult",
      requestId: "scene-1", sessionId: "session-1", ok: true }), "https://editor.example.test");
    const prototype = { source: "cubica-editor-web", type: "showPreviewPrototype", protocolVersion: 1,
      requestId: "prototype-1", sessionId: "session-1", runtimePointer: "/screens/team/root/children/0",
      component: { type: "richTextComponent", props: { html: "Prototype default" } } };
    send({ ...prototype, sessionId: "session-2" });
    send({ ...prototype, component: { type: "richTextComponent", props: { html: "Default" }, unknown: true } });
    expect(onShowPreviewPrototype).not.toHaveBeenCalled();
    send(prototype);
    await vi.waitFor(() => expect(onShowPreviewPrototype).toHaveBeenCalledWith(prototype));
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "previewPrototypeResult",
      requestId: "prototype-1", sessionId: "session-1", ok: true }), "https://editor.example.test");
    send({ ...prototype, requestId: "prototype-clear", component: null });
    await vi.waitFor(() => expect(onShowPreviewPrototype).toHaveBeenCalledTimes(2));
    mounted.unmount();
  });
});
