/**
 * Thin REST client for the editor's Next.js API routes.
 *
 * Every function here wraps a single `fetch` against an `/api/editor/*` route,
 * throws an `Error` with the server-provided message on a non-2xx response, and
 * returns the typed JSON body. Keeping all network calls in one module isolates
 * transport concerns from the `EditorWorkspace` state logic. `toPrototypeAuditNotice`
 * lives here because it maps a fetched audit-status response into the notice
 * record consumed by the UI.
 */
import type { EditorPatchIntent, JsonValue } from "@cubica/editor-engine";

import type { PrototypeAuditNoticeRecord } from "@/components/prototype-audit-notice";

import type {
  AuthoringFileDocument,
  AuthoringListResult,
  EditorLayoutDocument,
  EditorLayoutDocumentBody,
  EditorSessionListResult,
  EditorWorkflowResponse,
  AiPatchPlanResponse,
  GameAssetListResult,
  PinStateFixtureResult,
  PrototypeAuditStatusResponse,
  PrototypeExtractionWorkflowResponse,
  StateFixtureListResult,
  UploadGameAssetResult
} from "./types.ts";

export async function fetchAuthoringList(gameId: string | null, sessionId?: string): Promise<AuthoringListResult> {
  const params = new URLSearchParams();
  if (gameId !== null && gameId !== "") {
    params.set("gameId", gameId);
  }
  if (sessionId !== undefined) {
    params.set("sessionId", sessionId);
  }

  const response = await fetch(`/api/editor/files?${params.toString()}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { readonly error?: string };
    throw new Error(body.error ?? `File list failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as AuthoringListResult;
}

export async function createEditorSession(gameId: string | null): Promise<EditorSessionListResult> {
  const response = await fetch("/api/editor/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gameId })
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { readonly error?: string };
    throw new Error(body.error ?? `Session open failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as EditorSessionListResult;
}

export async function requestAiChangeSet(
  intent: EditorPatchIntent,
  targets: readonly {
    readonly filePath: string;
    readonly pointer: string;
    readonly label?: string;
    readonly value: JsonValue;
  }[]
): Promise<AiPatchPlanResponse> {
  const response = await fetch("/api/editor/ai/patch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ intent, targets })
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { readonly error?: string };
    throw new Error(payload.error ?? `AI patch planner failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as AiPatchPlanResponse;
}

export async function requestPrototypeExtractionProposal(input: {
  readonly gameId: string;
  readonly filePath: string;
  readonly text: string;
  readonly sessionId?: string;
  readonly sourcePointers?: readonly string[];
  readonly definitionType?: string;
  readonly definitionSemantics?: string;
}): Promise<PrototypeExtractionWorkflowResponse> {
  const response = await fetch("/api/editor/prototype-extraction", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { readonly error?: string };
    throw new Error(payload.error ?? `Prototype extraction proposal failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as PrototypeExtractionWorkflowResponse;
}

export async function fetchPrototypeAuditStatus(): Promise<PrototypeAuditStatusResponse> {
  const response = await fetch("/api/editor/prototype-audit/status", { cache: "no-store" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { readonly error?: string };
    throw new Error(payload.error ?? `Prototype audit status failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as PrototypeAuditStatusResponse;
}

/** Maps a prototype-audit status response into the UI notice record. */
export function toPrototypeAuditNotice(response: PrototypeAuditStatusResponse): PrototypeAuditNoticeRecord | null {
  if (response.notification === null) {
    return null;
  }

  return {
    notification: response.notification,
    message: response.message,
    lastCompletedAt: response.status?.lastCompletedAt,
    llmStatus: response.status?.llmStatus,
    reportUrl: response.status?.reportUrl,
    reportPath: response.status?.reportPath,
    workflowUrl: response.status?.workflowUrl,
    summary: response.status?.summary
  };
}

export async function fetchAuthoringFile(gameId: string, filePath: string, sessionId?: string): Promise<AuthoringFileDocument> {
  const params = new URLSearchParams({ gameId, filePath });
  if (sessionId !== undefined) {
    params.set("sessionId", sessionId);
  }
  const response = await fetch(`/api/editor/file?${params.toString()}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { readonly error?: string };
    throw new Error(body.error ?? `File open failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as AuthoringFileDocument;
}

export async function fetchEditorLayout(gameId: string, filePath: string, sessionId?: string): Promise<EditorLayoutDocument> {
  const params = new URLSearchParams({ gameId, filePath });
  if (sessionId !== undefined) {
    params.set("sessionId", sessionId);
  }
  const response = await fetch(`/api/editor/layout?${params.toString()}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { readonly error?: string };
    throw new Error(body.error ?? `Layout open failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as EditorLayoutDocument;
}

export async function saveEditorLayout(
  gameId: string,
  filePath: string,
  layout: EditorLayoutDocumentBody,
  versionHash: string | undefined,
  sessionId?: string
): Promise<EditorLayoutDocument> {
  const response = await fetch("/api/editor/layout", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      gameId,
      filePath,
      layout,
      versionHash,
      sessionId
    })
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { readonly error?: string };
    throw new Error(payload.error ?? `Layout save failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as EditorLayoutDocument;
}

/** Lists the game's pinned state fixtures with their `fixture-stale` verdict (ADR-057 §9.3). */
export async function fetchStateFixtures(gameId: string, sessionId?: string): Promise<StateFixtureListResult> {
  const params = new URLSearchParams({ gameId });
  if (sessionId !== undefined) {
    params.set("sessionId", sessionId);
  }
  const response = await fetch(`/api/editor/fixtures?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { readonly error?: string };
    throw new Error(body.error ?? `Fixture listing failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as StateFixtureListResult;
}

/** Pins the current preview state as a new fixture (server stamps the manifest hash). */
export async function pinStateFixture(input: {
  readonly gameId: string;
  readonly sessionId?: string;
  readonly id: string;
  readonly label: string;
  readonly state: Record<string, unknown>;
  readonly screenRef?: string;
  readonly stepRef?: string;
  readonly sourceTraceRef?: string;
  readonly note?: string;
}): Promise<PinStateFixtureResult> {
  const response = await fetch("/api/editor/fixtures", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { readonly error?: string };
    throw new Error(body.error ?? `Pinning a fixture failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as PinStateFixtureResult;
}

/** Outcome of persisting sibling facets of a multi-document apply (Phase 6.2a). */
export interface ApplyEditorSiblingDocumentsResult {
  readonly ok: boolean;
  readonly files: readonly { readonly filePath: string; readonly versionHash: string }[];
}

/**
 * Persists the SIBLING documents of a multi-document EditorChangeSet into the
 * session worktree (ADR-057 §4.10, §5). The active document stays in-memory; only
 * the other touched authoring files are written here. Throws on any failure so the
 * caller applies NOTHING (atomicity: siblings are written only after every touched
 * document has already dry-run/validated cleanly on the client).
 */
export async function applyEditorSiblingDocuments(input: {
  readonly gameId: string;
  readonly sessionId?: string;
  readonly files: readonly { readonly filePath: string; readonly text: string }[];
}): Promise<ApplyEditorSiblingDocumentsResult> {
  const response = await fetch("/api/editor/apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { readonly error?: string };
    throw new Error(body.error ?? `Applying entity operation failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as ApplyEditorSiblingDocumentsResult;
}

/** Lists the game's assets with their type, usage counter, and orphan flag (ADR-057 §9.4). */
export async function fetchGameAssets(gameId: string, sessionId?: string): Promise<GameAssetListResult> {
  const params = new URLSearchParams({ gameId });
  if (sessionId !== undefined) {
    params.set("sessionId", sessionId);
  }
  const response = await fetch(`/api/editor/assets?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { readonly error?: string };
    throw new Error(body.error ?? `Asset listing failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as GameAssetListResult;
}

/** Uploads one asset (base64) into the session worktree; it commits on the next Save. */
export async function uploadGameAsset(input: {
  readonly gameId: string;
  readonly sessionId?: string;
  readonly filePath: string;
  readonly contentBase64: string;
}): Promise<UploadGameAssetResult> {
  const response = await fetch("/api/editor/assets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { readonly error?: string };
    throw new Error(body.error ?? `Asset upload failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as UploadGameAssetResult;
}

/** Builds the content-stream URL for an asset thumbnail/preview `<img src>`. */
export function gameAssetContentUrl(gameId: string, assetPath: string, sessionId?: string): string {
  const params = new URLSearchParams({ gameId, path: assetPath });
  if (sessionId !== undefined) {
    params.set("sessionId", sessionId);
  }
  return `/api/editor/assets/content?${params.toString()}`;
}

export async function postEditorWorkflow(path: string, body: Record<string, unknown>): Promise<EditorWorkflowResponse> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { readonly error?: string };
    throw new Error(payload.error ?? `${path} failed with HTTP ${response.status}.`);
  }

  return (await response.json()) as EditorWorkflowResponse;
}
