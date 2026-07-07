/**
 * UI tests for the agent intent queue panel (ADR-057 §4.11; UX §9.5; design-spec
 * §2.4, §4). Rendered with react-dom/client + act, matching the other workspace
 * panel tests.
 *
 * Coverage: the queue lists intents with plain-Russian statuses; a running intent
 * exposes cancel; a `stale` intent exposes the author's apply-anyway / cancel
 * choice; an empty queue renders nothing.
 */
import React, { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IntentQueuePanel } from "./intent-queue-panel.tsx";
import type { IntentQueueEntry } from "@cubica/editor-engine";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | undefined;
let root: Root | undefined;

function render(element: ReactElement): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(element);
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = undefined;
  root = undefined;
});

function entry(overrides: Partial<IntentQueueEntry> & { readonly id: string; readonly status: IntentQueueEntry["status"] }): IntentQueueEntry {
  return {
    baseJournalSeq: 0,
    readPointers: ["games/demo/authoring/game.authoring.json/root/a"],
    writePointers: ["games/demo/authoring/game.authoring.json/root/a"],
    ...overrides
  };
}

describe("IntentQueuePanel", () => {
  it("renders nothing when the queue is empty", () => {
    render(<IntentQueuePanel intents={[]} onCancelIntent={vi.fn()} onResolveStaleIntent={vi.fn()} />);
    expect(container?.querySelector("[data-testid='intent-queue']")).toBeNull();
  });

  it("lists intents with plain-Russian statuses", () => {
    render(
      <IntentQueuePanel
        intents={[entry({ id: "a", status: "running" }), entry({ id: "b", status: "pending" })]}
        onCancelIntent={vi.fn()}
        onResolveStaleIntent={vi.fn()}
      />
    );
    const items = container?.querySelectorAll("[data-testid='intent-queue-item']");
    expect(items?.length).toBe(2);
    expect(container?.textContent).toContain("выполняется");
    expect(container?.textContent).toContain("ожидает");
  });

  it("cancels a running intent through onCancelIntent", () => {
    const onCancel = vi.fn();
    render(<IntentQueuePanel intents={[entry({ id: "a", status: "running" })]} onCancelIntent={onCancel} onResolveStaleIntent={vi.fn()} />);
    const cancel = container?.querySelector(".intent-queue-cancel") as HTMLButtonElement | null;
    expect(cancel).not.toBeNull();
    act(() => {
      cancel?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalledWith("a");
  });

  it("offers the author apply-anyway / cancel choice for a stale intent", () => {
    const onResolve = vi.fn();
    render(<IntentQueuePanel intents={[entry({ id: "a", status: "stale" })]} onCancelIntent={vi.fn()} onResolveStaleIntent={onResolve} />);
    expect(container?.textContent).toContain("устарел");
    const buttons = container?.querySelectorAll(".intent-queue-stale-choice button");
    expect(buttons?.length).toBe(2);
    act(() => {
      (buttons?.[0] as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onResolve).toHaveBeenCalledWith("a", "apply");
    act(() => {
      (buttons?.[1] as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onResolve).toHaveBeenCalledWith("a", "cancel");
  });

  it("shows no cancel affordance for terminal intents", () => {
    render(<IntentQueuePanel intents={[entry({ id: "a", status: "done" })]} onCancelIntent={vi.fn()} onResolveStaleIntent={vi.fn()} />);
    expect(container?.querySelector(".intent-queue-cancel")).toBeNull();
    expect(container?.querySelector(".intent-queue-stale-choice")).toBeNull();
    expect(container?.textContent).toContain("готово");
  });
});
