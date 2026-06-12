/**
 * Normalizes AG-UI protocol events for Cubica UI state.
 *
 * AG-UI state is assistant runtime state. This adapter never applies
 * STATE_SNAPSHOT or STATE_DELTA to Cubica manifests, editor sessions, runtime
 * sessions, licenses or project files. Mutations must be represented as Cubica
 * commands such as EditorChangeSet and pass Cubica validation gates.
 */
import { EventType, type BaseEvent } from "@ag-ui/core";
import type { CubicaAgentEvent } from "@cubica/contracts-ai";

export type NormalizedAgUiEvent = CubicaAgentEvent;

const canonicalStatePathPattern = /^\/?(manifest|authoring|runtime|session|license|licenses|projectFiles|project|worktree|gameState|state\/secret)(\/|$)/u;

export function normalizeAgUiEvent(event: BaseEvent | { readonly type?: unknown; readonly [key: string]: unknown }): NormalizedAgUiEvent {
  const type = typeof event.type === "string" ? event.type : "UNKNOWN";

  switch (type) {
    case EventType.RUN_STARTED:
      return {
        kind: "run",
        phase: "started",
        runId: readString(event, "runId"),
        threadId: readString(event, "threadId"),
        canMutateCanonicalState: false
      };
    case EventType.RUN_FINISHED:
      return {
        kind: "run",
        phase: "finished",
        runId: readString(event, "runId"),
        threadId: readString(event, "threadId"),
        canMutateCanonicalState: false
      };
    case EventType.RUN_ERROR:
      return {
        kind: "error",
        message: readString(event, "message") ?? "AG-UI run error.",
        code: readString(event, "code"),
        canMutateCanonicalState: false
      };
    case EventType.TEXT_MESSAGE_START:
      return { kind: "text", phase: "start", messageId: readString(event, "messageId"), canMutateCanonicalState: false };
    case EventType.TEXT_MESSAGE_CONTENT:
      return {
        kind: "text",
        phase: "content",
        messageId: readString(event, "messageId"),
        delta: readString(event, "delta"),
        canMutateCanonicalState: false
      };
    case EventType.TEXT_MESSAGE_END:
      return { kind: "text", phase: "end", messageId: readString(event, "messageId"), canMutateCanonicalState: false };
    case EventType.TEXT_MESSAGE_CHUNK:
      return {
        kind: "text",
        phase: "chunk",
        messageId: readString(event, "messageId"),
        delta: readString(event, "delta"),
        canMutateCanonicalState: false
      };
    case EventType.TOOL_CALL_START:
      return {
        kind: "tool",
        phase: "start",
        toolCallId: readString(event, "toolCallId"),
        toolCallName: readString(event, "toolCallName"),
        canMutateCanonicalState: false
      };
    case EventType.TOOL_CALL_ARGS:
      return {
        kind: "tool",
        phase: "args",
        toolCallId: readString(event, "toolCallId"),
        argsDelta: readString(event, "delta"),
        canMutateCanonicalState: false
      };
    case EventType.TOOL_CALL_END:
      return { kind: "tool", phase: "end", toolCallId: readString(event, "toolCallId"), canMutateCanonicalState: false };
    case EventType.TOOL_CALL_RESULT:
      return {
        kind: "tool",
        phase: "result",
        toolCallId: readString(event, "toolCallId"),
        content: readString(event, "content"),
        canMutateCanonicalState: false
      };
    case EventType.TOOL_CALL_CHUNK:
      return {
        kind: "tool",
        phase: "chunk",
        toolCallId: readString(event, "toolCallId"),
        toolCallName: readString(event, "toolCallName"),
        canMutateCanonicalState: false
      };
    case EventType.STATE_SNAPSHOT:
      return {
        kind: "state",
        phase: "snapshot",
        statePolicy: "assistant-state-only",
        unsafeCanonicalPaths: [],
        canMutateCanonicalState: false
      };
    case EventType.STATE_DELTA: {
      const unsafeCanonicalPaths = collectUnsafeCanonicalDeltaPaths(readArray(event, "delta"));
      return {
        kind: "state",
        phase: "delta",
        statePolicy: unsafeCanonicalPaths.length === 0 ? "assistant-state-only" : "unsafe-canonical-path-rejected",
        unsafeCanonicalPaths,
        canMutateCanonicalState: false
      };
    }
    case EventType.MESSAGES_SNAPSHOT:
      return { kind: "messages", eventType: type, canMutateCanonicalState: false };
    case EventType.ACTIVITY_SNAPSHOT:
    case EventType.ACTIVITY_DELTA:
      return { kind: "activity", eventType: type, canMutateCanonicalState: false };
    case EventType.CUSTOM:
      return { kind: "custom", eventType: type, canMutateCanonicalState: false };
    default:
      return { kind: "unknown", eventType: type, canMutateCanonicalState: false };
  }
}

export function collectUnsafeCanonicalDeltaPaths(delta: readonly unknown[]): readonly string[] {
  return delta
    .map((operation) => (isPlainRecord(operation) && typeof operation.path === "string" ? operation.path : undefined))
    .filter((path): path is string => path !== undefined && isUnsafeCanonicalDeltaPath(path));
}

export function normalizeAgUiTranscript(
  events: readonly (BaseEvent | { readonly type?: unknown; readonly [key: string]: unknown })[]
): readonly CubicaAgentEvent[] {
  return events.map((event) => normalizeAgUiEvent(event));
}

export function isUnsafeCanonicalDeltaPath(path: string): boolean {
  return canonicalStatePathPattern.test(path.replace(/^\/assistant/u, ""));
}

function readString(source: { readonly [key: string]: unknown }, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

function readArray(source: { readonly [key: string]: unknown }, key: string): readonly unknown[] {
  const value = source[key];
  return Array.isArray(value) ? value : [];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
