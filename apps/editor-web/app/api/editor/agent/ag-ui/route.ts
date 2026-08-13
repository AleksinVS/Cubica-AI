/**
 * Local AG-UI endpoint for the editor authoring assistant.
 *
 * CopilotKit talks to this route through @ag-ui/client HttpAgent. The route
 * returns Server-Sent Events (SSE, a one-way HTTP stream) encoded as AG-UI
 * protocol events. It is a deterministic local backend for development and
 * baseline verification; production can replace it with an external AG-UI
 * service through CUBICA_EDITOR_AGENT_AG_UI_URL.
 */
import { EventEncoder } from "@ag-ui/encoder";
import { EventType, RunAgentInputSchema, type BaseEvent, type RunAgentInput } from "@ag-ui/core";

import { EDITOR_AUTHORING_ASSISTANT_ID } from "@/lib/agent-assistant-registry";
import { createLocalEditorAgentEvents } from "@/lib/editor-agent-local-backend";
import {
  buildProductContextShadowJob,
  runProductContextShadowPostResponse,
  type ProductContextShadowTurn
} from "@/lib/product-context-shadow";

export const runtime = "nodejs";
// POST awaits only bounded Portal authorization and durable enqueue. Provider
// and Git latency belongs to the independent worker process.
export const maxDuration = 15;

const textEncoder = new TextEncoder();

export function GET() {
  return Response.json({
    ok: true,
    agentId: EDITOR_AUTHORING_ASSISTANT_ID,
    protocol: "ag-ui",
    backendMode: "local"
  });
}

export async function POST(request: Request) {
  if (request.headers.get("x-cubica-agent-id") !== EDITOR_AUTHORING_ASSISTANT_ID) {
    return Response.json({ error: "Unknown editor agent." }, { status: 403 });
  }

  const body = (await request.json().catch(() => undefined)) as unknown;
  const parsed = RunAgentInputSchema.safeParse(body);
  const encoder = new EventEncoder({ accept: request.headers.get("accept") ?? undefined });
  const events = parsed.success
    ? createLocalEditorAgentEvents(parsed.data)
    : [
        {
          type: EventType.RUN_ERROR,
          message: "Invalid AG-UI RunAgentInput.",
          code: "CUBICA_AGENT_INVALID_INPUT"
        } satisfies BaseEvent
      ];

  const response = new Response(encodeEvents(encoder, events), {
    headers: {
      "cache-control": "no-cache, no-transform",
      "content-type": encoder.getContentType(),
      "x-cubica-agent-id": EDITOR_AUTHORING_ASSISTANT_ID,
      "x-cubica-agent-backend-mode": "local"
    }
  });
  if (parsed.success) {
    const job = buildProductContextShadowJob(request.headers, extractProductContextShadowTurn(parsed.data, events));
    if (job !== null) {
      // The response bytes are already fixed, but the durable queue row must
      // exist before control returns: a post-response callback can disappear
      // when the web process is terminated immediately after the request.
      try { await runProductContextShadowPostResponse(job); }
      catch { /* Shadow is observational and must never alter or disclose the primary turn. */ }
    }
  }
  return response;
}

function extractProductContextShadowTurn(input: RunAgentInput, events: readonly BaseEvent[]): ProductContextShadowTurn | null {
  if (!validShadowId(input.threadId) || !validShadowId(input.runId)) return null;
  let user: { id: string; content: string } | null = null;
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index];
    if (message?.role === "user" && typeof message.content === "string" && validShadowId(message.id)) {
      user = { id: message.id, content: message.content };
      break;
    }
  }
  if (!user) return null;

  let activeId: string | null = null;
  let activeText = "";
  let completed: { id: string; text: string } | null = null;
  for (const event of events) {
    const value = event as BaseEvent & { readonly messageId?: unknown; readonly role?: unknown; readonly delta?: unknown };
    if (event.type === EventType.TEXT_MESSAGE_START && value.role === "assistant" && typeof value.messageId === "string" && validShadowId(value.messageId)) {
      activeId = value.messageId;
      activeText = "";
    } else if (event.type === EventType.TEXT_MESSAGE_CONTENT && activeId !== null && value.messageId === activeId && typeof value.delta === "string") {
      activeText += value.delta;
    } else if (event.type === EventType.TEXT_MESSAGE_END && activeId !== null && value.messageId === activeId) {
      completed = { id: activeId, text: activeText };
      activeId = null;
      activeText = "";
    }
  }
  return completed === null ? null : {
    threadId: input.threadId,
    runId: input.runId,
    userMessageId: user.id,
    assistantMessageId: completed.id,
    userText: user.content,
    assistantText: completed.text
  };
}

function validShadowId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,160}$/u.test(value);
}

function encodeEvents(encoder: EventEncoder, events: readonly BaseEvent[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(textEncoder.encode(encoder.encode(event)));
      }
      controller.close();
    }
  });
}
