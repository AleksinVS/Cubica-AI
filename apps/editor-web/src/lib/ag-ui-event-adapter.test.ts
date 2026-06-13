import { EventType } from "@ag-ui/core";
import { describe, expect, it } from "vitest";

import { createLocalEditorAgentEvents } from "./editor-agent-local-backend";
import { collectUnsafeCanonicalDeltaPaths, normalizeAgUiEvent, normalizeAgUiTranscript } from "./ag-ui-event-adapter";

describe("AG-UI event adapter", () => {
  it("normalizes run and text events without canonical mutation rights", () => {
    expect(normalizeAgUiEvent({ type: EventType.RUN_STARTED, runId: "run-1", threadId: "thread-1" })).toEqual({
      kind: "run",
      phase: "started",
      runId: "run-1",
      threadId: "thread-1",
      canMutateCanonicalState: false
    });
    expect(normalizeAgUiEvent({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta: "hello" })).toEqual({
      kind: "text",
      phase: "content",
      messageId: "m1",
      delta: "hello",
      canMutateCanonicalState: false
    });
  });

  it("projects a text-only AG-UI transcript into Cubica agent events", () => {
    const transcript = normalizeAgUiTranscript([
      { type: EventType.RUN_STARTED, runId: "run-1", threadId: "thread-1" },
      { type: EventType.TEXT_MESSAGE_START, messageId: "message-1" },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "message-1", delta: "Готов помочь." },
      { type: EventType.TEXT_MESSAGE_END, messageId: "message-1" },
      { type: EventType.RUN_FINISHED, runId: "run-1", threadId: "thread-1" }
    ]);

    expect(transcript.map((event) => `${event.kind}:${event.kind === "error" ? "error" : "phase" in event ? event.phase : event.eventType}`)).toEqual([
      "run:started",
      "text:start",
      "text:content",
      "text:end",
      "run:finished"
    ]);
    expect(transcript.every((event) => event.canMutateCanonicalState === false)).toBe(true);
  });

  it("projects AG-UI tool call args and results into Cubica tool events", () => {
    const transcript = normalizeAgUiTranscript([
      { type: EventType.TOOL_CALL_START, toolCallId: "tool-1", toolCallName: "editor.planChangeSet" },
      { type: EventType.TOOL_CALL_ARGS, toolCallId: "tool-1", delta: JSON.stringify({ prompt: "Измени заголовок" }) },
      { type: EventType.TOOL_CALL_END, toolCallId: "tool-1" },
      {
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: "tool-1",
        content: JSON.stringify({ ok: true, toolName: "editor.planChangeSet", summary: "Planned" })
      }
    ]);

    expect(transcript).toMatchObject([
      { kind: "tool", phase: "start", toolCallId: "tool-1", toolCallName: "editor.planChangeSet" },
      { kind: "tool", phase: "args", toolCallId: "tool-1", argsDelta: JSON.stringify({ prompt: "Измени заголовок" }) },
      { kind: "tool", phase: "end", toolCallId: "tool-1" },
      { kind: "tool", phase: "result", toolCallId: "tool-1" }
    ]);
    expect(transcript.every((event) => event.canMutateCanonicalState === false)).toBe(true);
  });

  it("projects local backend tool transcripts without granting canonical mutation rights", () => {
    const events = createLocalEditorAgentEvents({
      threadId: "thread-1",
      runId: "run-1",
      state: {},
      messages: [{ id: "user-1", role: "user", content: "Измени заголовок выбранного узла" }],
      tools: [{ name: "editor.planChangeSet", description: "Plan", parameters: {} }],
      context: [],
      forwardedProps: {}
    });
    const transcript = normalizeAgUiTranscript(events);

    expect(transcript.map((event) => event.kind)).toEqual(["run", "text", "text", "text", "tool", "tool", "tool", "run"]);
    expect(transcript.find((event) => event.kind === "tool" && event.phase === "start")).toMatchObject({
      toolCallName: "editor.planChangeSet",
      canMutateCanonicalState: false
    });
    expect(transcript.every((event) => event.canMutateCanonicalState === false)).toBe(true);
  });

  it("projects local backend dry-run tool transcripts for production smoke reuse", () => {
    const events = createLocalEditorAgentEvents({
      threadId: "thread-1",
      runId: "run-dry",
      state: {},
      messages: [{ id: "user-1", role: "user", content: "проверь текущий ChangeSet" }],
      tools: [{ name: "editor.dryRunChangeSet", description: "Dry-run", parameters: {} }],
      context: [],
      forwardedProps: {}
    });
    const transcript = normalizeAgUiTranscript(events);

    expect(transcript.find((event) => event.kind === "tool" && event.phase === "start")).toMatchObject({
      toolCallName: "editor.dryRunChangeSet",
      canMutateCanonicalState: false
    });
    expect(transcript.find((event) => event.kind === "tool" && event.phase === "args")).toMatchObject({
      argsDelta: JSON.stringify({ prompt: "проверь текущий ChangeSet" })
    });
  });

  it("marks state snapshots as assistant-state-only", () => {
    expect(normalizeAgUiEvent({ type: EventType.STATE_SNAPSHOT, snapshot: { draft: true } })).toEqual({
      kind: "state",
      phase: "snapshot",
      statePolicy: "assistant-state-only",
      unsafeCanonicalPaths: [],
      canMutateCanonicalState: false
    });
  });

  it("rejects unsafe canonical paths in state deltas", () => {
    const event = normalizeAgUiEvent({
      type: EventType.STATE_DELTA,
      delta: [
        { op: "replace", path: "/assistant/progress", value: "thinking" },
        { op: "replace", path: "/manifest/root/title", value: "bad" },
        { op: "remove", path: "/state/secret/token" }
      ]
    });

    expect(event).toMatchObject({
      kind: "state",
      phase: "delta",
      statePolicy: "unsafe-canonical-path-rejected",
      unsafeCanonicalPaths: ["/manifest/root/title", "/state/secret/token"],
      canMutateCanonicalState: false
    });
  });

  it("keeps AG-UI custom events as adapter-owned diagnostics surface, not canonical state", () => {
    expect(normalizeAgUiEvent({ type: EventType.CUSTOM, name: "surfaceUpdate", payload: { html: "<script />" } })).toEqual({
      kind: "custom",
      eventType: EventType.CUSTOM,
      canMutateCanonicalState: false
    });
  });

  it("collects only JSON Patch-like paths that target Cubica canonical state", () => {
    expect(
      collectUnsafeCanonicalDeltaPaths([
        { op: "replace", path: "/assistant/draft" },
        { op: "replace", path: "/projectFiles/games/demo/game.manifest.json" },
        { op: "replace" },
        "not-an-operation"
      ])
    ).toEqual(["/projectFiles/games/demo/game.manifest.json"]);
  });
});
