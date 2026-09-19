import type {
  EditorMutationConfirmedResponse,
  EditorMutationPreparedResponse,
  EditorMutationRequest
} from "@cubica/editor-engine";

/** The server alone computes and writes the effect represented by a ChangeSet. */
export async function postEditorMutation(
  request: EditorMutationRequest
): Promise<EditorMutationPreparedResponse | EditorMutationConfirmedResponse> {
  const response = await fetch("/api/editor/apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });
  const body = await response.json().catch(() => ({})) as {
    readonly status?: string;
    readonly error?: string;
    readonly summary?: string;
    readonly diagnostics?: readonly { readonly message: string }[];
  };
  if (!response.ok) {
    throw new Error(body.diagnostics?.[0]?.message ?? body.error ?? body.summary ?? `Editor mutation failed with HTTP ${response.status}.`);
  }
  if (request.action === "prepare" && body.status === "prepared") {
    return body as EditorMutationPreparedResponse;
  }
  if (request.action !== "prepare" && (body.status === "confirmed" || body.status === "direct")) {
    return body as EditorMutationConfirmedResponse;
  }
  throw new Error("Editor mutation returned an unexpected response.");
}
