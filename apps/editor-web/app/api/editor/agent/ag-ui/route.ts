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
import { EventType, RunAgentInputSchema, type BaseEvent } from "@ag-ui/core";

import { EDITOR_AUTHORING_ASSISTANT_ID } from "@/lib/agent-assistant-registry";
import { createLocalEditorAgentEvents } from "@/lib/editor-agent-local-backend";

export const runtime = "nodejs";

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

  return new Response(encodeEvents(encoder, events), {
    headers: {
      "cache-control": "no-cache, no-transform",
      "content-type": encoder.getContentType(),
      "x-cubica-agent-id": EDITOR_AUTHORING_ASSISTANT_ID,
      "x-cubica-agent-backend-mode": "local"
    }
  });
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
