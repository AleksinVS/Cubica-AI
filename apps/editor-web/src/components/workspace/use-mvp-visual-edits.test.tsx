import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { applyJsonPatch, type EditorChangeSet, type JsonValue, type PreviewEntityDescriptor } from "@cubica/editor-engine";
import { useMvpVisualEdits } from "./use-mvp-visual-edits";
const file = "ui/web/manifest.authoring.json";
const initial = new Map([[file, JSON.stringify({ root: { item: { id: "title", props: { html: "Old" } } } })]]);
const entity: PreviewEntityDescriptor = { entityId: "title", authoringPointer: "/root/item", runtimePointer: "/screens/0/components/0",
  label: "Title", semanticRole: "ui", bounds: { x: 0, y: 0, width: 100, height: 30 }, visible: true, selectable: true,
  metadata: { sourceFile: `games/sample/authoring/${file}`, previewContext: { sessionId: "s", compileRevision: "r", scene: { screenId: "first" } } } };
function edit(id: string, docs: ReadonlyMap<string,string>, value: string): EditorChangeSet {
  const root = JSON.parse(docs.get(file)!);
  return { id, summary: id, jsonPatches: [{ filePath: file, operations: [{ op: "test", path: "/root/item", value: root.root.item },
    { op: "replace", path: "/root/item/props/html", value }] }] };
}
function apply(change: EditorChangeSet, docs: ReadonlyMap<string,string>) {
  return new Map([[file, JSON.stringify(applyJsonPatch(JSON.parse(docs.get(file)!) as JsonValue, change.jsonPatches[0].operations))]]);
}
describe("responsive visual edit integration", () => {
  it("clears a cancelled candidate when visual editing becomes enabled again", () => {
    const postMessage = vi.fn();
    const commit = vi.fn(async () => ({ ok: true, documents: initial }));
    const props = (enabled: boolean) => ({ enabled, isPaused: () => true, contextKey: "editor", documentRevision: "initial", documents: initial,
      gameId: "sample", entities: [entity], previewUrl: "http://localhost:3300",
      frame: { current: { contentWindow: { postMessage } } as unknown as HTMLIFrameElement }, commit });
    const { result, rerender } = renderHook((input) => useMvpVisualEdits(input), { initialProps: props(true) });
    act(() => result.current.candidate(edit("candidate", initial, "Candidate")));
    expect(postMessage.mock.calls.at(-1)?.[0].patches.at(-1).value).toBe("Candidate");
    act(() => rerender(props(false)));
    const sentWhileEnabled = postMessage.mock.calls.length;
    act(() => result.current.candidate(undefined));
    expect(postMessage).toHaveBeenCalledTimes(sentWhileEnabled);
    act(() => rerender(props(true)));
    expect(postMessage.mock.calls.at(-1)?.[0].patches).toEqual([]);
  });

  it("retains a confirmed candidate until a failed preview build is manually refreshed", () => {
    const postMessage = vi.fn();
    const commit = vi.fn(async () => ({ ok: true, documents: initial }));
    const props = (documents: ReadonlyMap<string, string>, documentRevision: string) => ({
      enabled: true, isPaused: () => true, contextKey: "editor", documentRevision, documents,
      gameId: "sample", entities: [entity], previewUrl: "http://localhost:3300",
      frame: { current: { contentWindow: { postMessage } } as unknown as HTMLIFrameElement }, commit
    });
    const { result, rerender } = renderHook((input) => useMvpVisualEdits(input), { initialProps: props(initial, "initial") });
    const change = edit("candidate", initial, "Candidate");
    act(() => result.current.candidate(change));
    expect(postMessage.mock.calls.at(-1)?.[0].patches.at(-1).value).toBe("Candidate");
    act(() => rerender(props(apply(change, initial), "confirmed")));
    const posted = postMessage.mock.calls.length;
    act(() => result.current.settleCandidateAfterConfirm("other", false));
    expect(postMessage).toHaveBeenCalledTimes(posted);
    expect(result.current.needsPreviewRefresh).toBe(false);
    act(() => result.current.settleCandidateAfterConfirm("candidate", false));
    expect(result.current.needsPreviewRefresh).toBe(true);
    expect(result.current.pendingCount).toBe(1);
    expect(postMessage.mock.calls.at(-1)?.[0].patches.at(-1).value).toBe("Candidate");
    act(() => result.current.markPreviewCurrent());
    expect(result.current.needsPreviewRefresh).toBe(false);
    expect(result.current.pendingCount).toBe(0);
    expect(postMessage.mock.calls.at(-1)?.[0].patches).toEqual([]);
  });

  it("blocks play for a confirmed candidate that cannot use the temporary layer", () => {
    const commit = vi.fn(async () => ({ ok: true, documents: initial }));
    const { result } = renderHook(() => useMvpVisualEdits({ enabled: true, isPaused: () => true, contextKey: "editor", documentRevision: "initial", documents: initial,
      gameId: "sample", entities: [entity], previewUrl: null, frame: { current: null }, commit }));
    const value = JSON.parse(initial.get(file)!).root.item;
    const unsupported: EditorChangeSet = { id: "unsupported", summary: "rule", jsonPatches: [{ filePath: file,
      operations: [{ op: "test", path: "/root/item", value }, { op: "add", path: "/root/item/_prompt", value: "New rule" }] }] };
    act(() => result.current.candidate(unsupported));
    act(() => result.current.settleCandidateAfterConfirm("unsupported", false));
    expect(result.current.needsPreviewRefresh).toBe(true);
    expect(result.current.pendingCount).toBe(1);
    act(() => result.current.markPreviewCurrent());
    expect(result.current.pendingCount).toBe(0);
  });

  it("clears a confirmed candidate once its preview is current", () => {
    const postMessage = vi.fn();
    const commit = vi.fn(async () => ({ ok: true, documents: initial }));
    const { result } = renderHook(() => useMvpVisualEdits({ enabled: true, isPaused: () => true, contextKey: "editor", documentRevision: "initial", documents: initial,
      gameId: "sample", entities: [entity], previewUrl: "http://localhost:3300",
      frame: { current: { contentWindow: { postMessage } } as unknown as HTMLIFrameElement }, commit }));
    act(() => result.current.candidate(edit("candidate", initial, "Candidate")));
    act(() => result.current.settleCandidateAfterConfirm("candidate", true));
    expect(result.current.needsPreviewRefresh).toBe(false);
    expect(result.current.pendingCount).toBe(0);
    expect(postMessage.mock.calls.at(-1)?.[0].patches).toEqual([]);
  });

  it("posts the real visual value before commit and preserves B over acknowledgement A", async () => {
    const postMessage = vi.fn();
    let resolve!: (value: { ok: boolean; documents: ReadonlyMap<string,string> }) => void;
    const commit = vi.fn(() => new Promise<{ok:boolean;documents:ReadonlyMap<string,string>}>(done => { resolve = done; }));
    const { result } = renderHook(() => useMvpVisualEdits({ enabled: true, isPaused: () => true, contextKey: "editor", documentRevision: "initial", documents: initial,
      gameId: "sample", entities: [entity], previewUrl: "http://localhost:3300", frame: { current: { contentWindow: { postMessage } } as unknown as HTMLIFrameElement }, commit }));
    const a = edit("A", initial, "A");
    act(() => { expect(result.current.enqueue(a)).toBe(true); });
    expect(postMessage.mock.calls.at(-1)?.[0].patches.at(-1).value).toBe("A");
    act(() => { expect(result.current.enqueue(edit("B", result.current.projectedDocuments, "B"))).toBe(true); });
    expect(commit).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ ok: true, documents: apply(a, initial) }));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(2));
    expect(postMessage.mock.calls.at(-1)?.[0].patches.at(-1).value).toBe("B");
    expect(JSON.parse(result.current.projectedDocuments.get(file)!).root.item.props.html).toBe("B");
  });
  it("retains an uncertain request and retries with the same operation identity", async () => {
    const commit = vi.fn().mockRejectedValueOnce(new Error("connection lost")).mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useMvpVisualEdits({ enabled: true, isPaused: () => true, contextKey: "editor", documentRevision: "initial", documents: initial,
      gameId: "sample", entities: [entity], previewUrl: null, frame: { current: null }, commit }));
    act(() => { result.current.enqueue(edit("A", initial, "A")); });
    await waitFor(() => expect(result.current.displayError).toContain("connection lost"));
    expect(result.current.pendingCount).toBe(1);
    expect(result.current.failedDrafts).toHaveLength(0);
    act(() => result.current.retry());
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(2));
    expect(commit.mock.calls[1][0]).toEqual(commit.mock.calls[0][0]);
  });

  it("keeps confirmed source values visible after a failed preview build, including newer B", async () => {
    const postMessage = vi.fn();
    const resolve = new Map<string, (value: { ok: boolean; documents: ReadonlyMap<string, string>; previewReady: boolean }) => void>();
    const commit = vi.fn((change: EditorChangeSet) => new Promise<{ ok: boolean; documents: ReadonlyMap<string, string>; previewReady: boolean }>(done => {
      resolve.set(change.id, done);
    }));
    const { result } = renderHook(() => useMvpVisualEdits({ enabled: true, isPaused: () => true, contextKey: "editor", documentRevision: "initial", documents: initial,
      gameId: "sample", entities: [entity], previewUrl: "http://localhost:3300", frame: { current: { contentWindow: { postMessage } } as unknown as HTMLIFrameElement }, commit }));
    const a = edit("A", initial, "A");
    act(() => { result.current.enqueue(a); });
    const b = edit("B", result.current.projectedDocuments, "B");
    act(() => { result.current.enqueue(b); });
    await act(async () => resolve.get("A")!({ ok: true, documents: apply(a, initial), previewReady: false }));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(2));
    expect(result.current.needsPreviewRefresh).toBe(true);
    expect(result.current.pendingCount).toBe(2);
    expect(postMessage.mock.calls.at(-1)?.[0].patches.at(-1).value).toBe("B");
    await act(async () => resolve.get("B")!({ ok: true, documents: apply(b, apply(a, initial)), previewReady: false }));
    expect(result.current.pendingCount).toBe(2);
    expect(postMessage.mock.calls.at(-1)?.[0].patches.at(-1).value).toBe("B");
    act(() => result.current.markPreviewCurrent());
    expect(result.current.needsPreviewRefresh).toBe(false);
    expect(result.current.pendingCount).toBe(0);
    expect(postMessage.mock.calls.at(-1)?.[0].patches).toEqual([]);
  });

  it("runs a new editor context while the old request remains in flight", async () => {
    const other = new Map([[file, JSON.stringify({ root: { item: { id: "title", props: { html: "Other" } } } })]]);
    let resolveA!: (value: { ok: boolean; documents: ReadonlyMap<string, string> }) => void;
    let resolveB!: (value: { ok: boolean; documents: ReadonlyMap<string, string> }) => void;
    const commitA = vi.fn(() => new Promise<{ ok: boolean; documents: ReadonlyMap<string, string> }>(done => { resolveA = done; }));
    const commitB = vi.fn(() => new Promise<{ ok: boolean; documents: ReadonlyMap<string, string> }>(done => { resolveB = done; }));
    const props = (contextKey: string, documents: ReadonlyMap<string, string>, commit: typeof commitA) => ({
      enabled: true, isPaused: () => true, contextKey, documentRevision: contextKey, documents,
      gameId: "sample", entities: [entity], previewUrl: null, frame: { current: null }, commit
    });
    const { result, rerender } = renderHook((input) => useMvpVisualEdits(input), { initialProps: props("A", initial, commitA) });
    const a = edit("A", initial, "A");
    act(() => { result.current.enqueue(a); });
    expect(commitA).toHaveBeenCalledTimes(1);
    act(() => rerender(props("B", other, commitB)));
    expect(result.current.pendingCount).toBe(0);
    const b = edit("B", other, "B");
    act(() => { result.current.enqueue(b); });
    expect(commitB).toHaveBeenCalledTimes(1);
    await act(async () => resolveA({ ok: true, documents: apply(a, initial) }));
    expect(result.current.pendingCount).toBe(1);
    expect(JSON.parse(result.current.projectedDocuments.get(file)!).root.item.props.html).toBe("B");
    await act(async () => resolveB({ ok: true, documents: apply(b, other) }));
    expect(result.current.pendingCount).toBe(0);
  });

  it("allows a rejected draft notice to be closed without changing its queue status", async () => {
    const commit = vi.fn().mockResolvedValue({ ok: false, documents: initial, reason: "Validation failed" });
    const { result } = renderHook(() => useMvpVisualEdits({ enabled: true, isPaused: () => true, contextKey: "editor", documentRevision: "initial", documents: initial,
      gameId: "sample", entities: [entity], previewUrl: null, frame: { current: null }, commit }));
    act(() => { result.current.enqueue(edit("A", initial, "A")); });
    await waitFor(() => expect(result.current.failedDrafts).toHaveLength(1));
    act(() => result.current.dismiss("A"));
    expect(result.current.failedDrafts).toHaveLength(0);
    expect(result.current.pendingCount).toBe(0);
  });
});
