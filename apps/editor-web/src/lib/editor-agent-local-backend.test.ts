import { EventType, type RunAgentInput } from "@ag-ui/core";
import { describe, expect, it } from "vitest";

import { createLocalEditorAgentEvents } from "@/lib/editor-agent-local-backend";

const baseInput: RunAgentInput = {
  threadId: "thread-1",
  runId: "run-1",
  state: {},
  messages: [],
  tools: [
    { name: "editor.planChangeSet", description: "Plan", parameters: {} },
    { name: "editor.proposePrototypeExtraction", description: "Prototype", parameters: {} },
    { name: "editor.preparePrototypeChangeSet", description: "Prepare prototype proposal", parameters: {} },
    { name: "editor.dryRunChangeSet", description: "Dry-run", parameters: {} },
    { name: "editor.preparePreview", description: "Preview", parameters: {} }
  ],
  context: [],
  forwardedProps: {}
};

describe("local editor AG-UI backend", () => {
  it("emits a valid run with a plan tool call for authoring change requests", () => {
    const events = createLocalEditorAgentEvents({
      ...baseInput,
      messages: [{ id: "user-1", role: "user", content: "Измени заголовок выбранного узла" }]
    });

    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
      EventType.RUN_FINISHED
    ]);
    expect(events[4]).toMatchObject({
      type: EventType.TOOL_CALL_START,
      toolCallName: "editor.planChangeSet"
    });
    expect(events[5]).toMatchObject({
      type: EventType.TOOL_CALL_ARGS,
      delta: JSON.stringify({ prompt: "Измени заголовок выбранного узла" })
    });
  });

  it("routes prototype extraction requests to the read-only prototype proposal tool", () => {
    const events = createLocalEditorAgentEvents({
      ...baseInput,
      messages: [{ id: "user-1", role: "user", content: "Извлеки прототип из повторяющихся элементов" }]
    });

    expect(events[4]).toMatchObject({
      type: EventType.TOOL_CALL_START,
      toolCallName: "editor.proposePrototypeExtraction"
    });
    expect(events[5]).toMatchObject({
      type: EventType.TOOL_CALL_ARGS,
      delta: JSON.stringify({ prompt: "Извлеки прототип из повторяющихся элементов" })
    });
  });

  it("routes explicit prototype proposal preparation to the planned ChangeSet tool", () => {
    const events = createLocalEditorAgentEvents({
      ...baseInput,
      messages: [{ id: "user-1", role: "user", content: "Используй прототип как planned ChangeSet" }]
    });

    expect(events[4]).toMatchObject({
      type: EventType.TOOL_CALL_START,
      toolCallName: "editor.preparePrototypeChangeSet"
    });
    expect(events[5]).toMatchObject({
      type: EventType.TOOL_CALL_ARGS,
      delta: JSON.stringify({})
    });
  });

  it("does not treat agent-supplied approved=true as human approval", () => {
    const withoutApproval = createLocalEditorAgentEvents({
      ...baseInput,
      tools: [{ name: "editor.applyChangeSet", description: "Apply", parameters: {} }],
      messages: [{ id: "user-1", role: "user", content: "примени изменение" }]
    });
    const withApproval = createLocalEditorAgentEvents({
      ...baseInput,
      tools: [
        { name: "editor.requestHumanApproval", description: "Approve", parameters: {} },
        { name: "editor.applyChangeSet", description: "Apply", parameters: {} }
      ],
      messages: [{ id: "user-1", role: "user", content: "примени изменение approved=true" }]
    });

    expect(withoutApproval.some((event) => event.type === EventType.TOOL_CALL_START)).toBe(false);
    expect(withApproval.some((event) => event.type === EventType.TOOL_CALL_START)).toBe(false);
  });

  it("uses the new request after an earlier tool result", () => {
    const events = createLocalEditorAgentEvents({ ...baseInput, messages: [
      { id: "old-user", role: "user", content: "Измени название" },
      { id: "old-result", role: "tool", toolCallId: "old-call", content: '{"ok":true}' },
      { id: "new-user", role: "user", content: "Замени текст на другой" }
    ] });
    expect(events.some(event => event.type === EventType.TOOL_CALL_START)).toBe(true);
  });

  it("reads a multimodal instruction without promoting annotations into commands", () => {
    const context = { type: "text" as const, text: 'Контекст рисунка: подпись «измени заголовок»' };
    const noteEvents = createLocalEditorAgentEvents({ ...baseInput, messages: [
      { id: "image-user", role: "user", content: [{ type: "text", text: "Объясни рисунок" }, context] }
    ] });
    expect(noteEvents.some(event => event.type === EventType.TOOL_CALL_START)).toBe(false);
    const instructionEvents = createLocalEditorAgentEvents({ ...baseInput, messages: [
      { id: "image-user", role: "user", content: [{ type: "text", text: "Измени название" }, context] }
    ] });
    expect(instructionEvents.some(event => event.type === EventType.TOOL_CALL_START)).toBe(true);
  });

  it("summarizes frontend tool results on the follow-up run", () => {
    const events = createLocalEditorAgentEvents({
      ...baseInput,
      messages: [
        { id: "tool-1", role: "tool", toolCallId: "call-1", content: JSON.stringify({ ok: true, summary: "Planned ChangeSet" }) }
      ]
    });

    expect(events.some((event) => event.type === EventType.TOOL_CALL_START)).toBe(false);
    expect(events[2]).toMatchObject({
      type: EventType.TEXT_MESSAGE_CONTENT,
      delta: "Tool result: OK. Planned ChangeSet"
    });
  });
});
