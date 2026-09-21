import Ajv2020Lib from "ajv/dist/2020.js";
import addFormatsLib from "ajv-formats";
import type { ValidateFunction } from "ajv";
import type { DebugSessionControlRequest } from "./generated/debug-session-control-request.ts";
import type { SaveDebugCheckpointRequest } from "./generated/save-debug-checkpoint-request.ts";
import type { DebugSessionControlResponse } from "./generated/debug-session-control-response.ts";
import type { DebugCheckpointListResponse } from "./generated/debug-checkpoint-list-response.ts";
import type { DebugCheckpointMetadata as WireDebugCheckpointMetadata } from "./generated/debug-checkpoint-metadata.ts";
import type { EditorDebugBridgeRequest } from "./generated/editor-debug-bridge-request.ts";
import type { EditorDebugBridgeResponse } from "./generated/editor-debug-bridge-response.ts";
import type { EditorPreviewContentRefreshRequest } from "./generated/editor-preview-content-refresh-request.ts";
import type { EditorPreviewContentRefreshResponse } from "./generated/editor-preview-content-refresh-response.ts";
import type { EditorPreviewSceneRequest } from "./generated/editor-preview-scene-request.ts";
import type { EditorPreviewSceneResponse } from "./generated/editor-preview-scene-response.ts";
import type { PlayerPreviewEntitiesMessage } from "./generated/player-preview-entities-message.ts";
import type { EditorPreviewPrototypeRequest } from "./generated/editor-preview-prototype-request.ts";
import type { EditorPreviewPrototypeResponse } from "./generated/editor-preview-prototype-response.ts";
import type { EditorPrototypePreviewRequest } from "./generated/editor-prototype-preview-request.ts";
import type { EditorPrototypePreviewResponse } from "./generated/editor-prototype-preview-response.ts";
import { debugSessionControlRequestSchema } from "./generated/debug-session-control-request.schema.ts";
import { debugSessionControlResponseSchema } from "./generated/debug-session-control-response.schema.ts";
import { saveDebugCheckpointRequestSchema } from "./generated/save-debug-checkpoint-request.schema.ts";
import { debugCheckpointListResponseSchema } from "./generated/debug-checkpoint-list-response.schema.ts";
import { debugCheckpointMetadataSchema } from "./generated/debug-checkpoint-metadata.schema.ts";
import { editorDebugBridgeRequestSchema } from "./generated/editor-debug-bridge-request.schema.ts";
import { editorDebugBridgeResponseSchema } from "./generated/editor-debug-bridge-response.schema.ts";
import { editorPreviewContentRefreshRequestSchema } from "./generated/editor-preview-content-refresh-request.schema.ts";
import { editorPreviewContentRefreshResponseSchema } from "./generated/editor-preview-content-refresh-response.schema.ts";
import { editorPreviewSceneRequestSchema } from "./generated/editor-preview-scene-request.schema.ts";
import { editorPreviewSceneResponseSchema } from "./generated/editor-preview-scene-response.schema.ts";
import { playerPreviewEntitiesMessageSchema } from "./generated/player-preview-entities-message.schema.ts";
import { editorPreviewPrototypeRequestSchema } from "./generated/editor-preview-prototype-request.schema.ts";
import { editorPreviewPrototypeResponseSchema } from "./generated/editor-preview-prototype-response.schema.ts";
import { editorPrototypePreviewRequestSchema } from "./generated/editor-prototype-preview-request.schema.ts";
import { editorPrototypePreviewResponseSchema } from "./generated/editor-prototype-preview-response.schema.ts";

const Ajv2020 = (Ajv2020Lib as any).default || Ajv2020Lib;
const addFormats = (addFormatsLib as any).default || addFormatsLib;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
// The canonical UI component schema has a conditional required field in an
// allOf branch. Ajv's strictRequired lint rejects that valid shape; validation
// itself remains strict and unchanged for prototype component payloads.
const uiComponentAjv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
addFormats(uiComponentAjv);
const control = ajv.compile(debugSessionControlRequestSchema as object) as ValidateFunction<DebugSessionControlRequest>;
const save = ajv.compile(saveDebugCheckpointRequestSchema as object) as ValidateFunction<SaveDebugCheckpointRequest>;
const controlResponse = ajv.compile(debugSessionControlResponseSchema as object) as ValidateFunction<DebugSessionControlResponse>;
const metadata = ajv.compile(debugCheckpointMetadataSchema as object) as ValidateFunction<WireDebugCheckpointMetadata>;
const list = ajv.compile(debugCheckpointListResponseSchema as object) as ValidateFunction<DebugCheckpointListResponse>;
const bridgeRequest = ajv.compile(editorDebugBridgeRequestSchema as object) as ValidateFunction<EditorDebugBridgeRequest>;
const bridgeResponse = ajv.compile(editorDebugBridgeResponseSchema as object) as ValidateFunction<EditorDebugBridgeResponse>;
const previewRefreshRequest = ajv.compile(editorPreviewContentRefreshRequestSchema as object) as ValidateFunction<EditorPreviewContentRefreshRequest>;
const previewRefreshResponse = ajv.compile(editorPreviewContentRefreshResponseSchema as object) as ValidateFunction<EditorPreviewContentRefreshResponse>;
const previewSceneRequest = ajv.compile(editorPreviewSceneRequestSchema as object) as ValidateFunction<EditorPreviewSceneRequest>;
const previewSceneResponse = ajv.compile(editorPreviewSceneResponseSchema as object) as ValidateFunction<EditorPreviewSceneResponse>;
const previewEntitiesMessage = ajv.compile(playerPreviewEntitiesMessageSchema as object) as ValidateFunction<PlayerPreviewEntitiesMessage>;
const previewPrototypeRequest = uiComponentAjv.compile(editorPreviewPrototypeRequestSchema as object) as ValidateFunction<EditorPreviewPrototypeRequest>;
const previewPrototypeResponse = ajv.compile(editorPreviewPrototypeResponseSchema as object) as ValidateFunction<EditorPreviewPrototypeResponse>;
const prototypePreviewRequest = ajv.compile(editorPrototypePreviewRequestSchema as object) as ValidateFunction<EditorPrototypePreviewRequest>;
const prototypePreviewResponse = uiComponentAjv.compile(editorPrototypePreviewResponseSchema as object) as ValidateFunction<EditorPrototypePreviewResponse>;

export function validateDebugSessionControlRequest(value: unknown): value is DebugSessionControlRequest {
  return control(value);
}

export function validateSaveDebugCheckpointRequest(value: unknown): value is SaveDebugCheckpointRequest {
  return save(value);
}

export function validateDebugSessionControlResponse(value: unknown): value is DebugSessionControlResponse {
  return controlResponse(value);
}

export function validateDebugCheckpointMetadata(value: unknown): value is WireDebugCheckpointMetadata {
  return metadata(value);
}

export function validateDebugCheckpointListResponse(value: unknown): value is DebugCheckpointListResponse {
  return list(value);
}

export function validateEditorDebugBridgeRequest(value: unknown): value is EditorDebugBridgeRequest {
  return bridgeRequest(value);
}

export function validateEditorDebugBridgeResponse(value: unknown): value is EditorDebugBridgeResponse {
  return bridgeResponse(value);
}

export function validateEditorPreviewContentRefreshRequest(value: unknown): value is EditorPreviewContentRefreshRequest {
  return previewRefreshRequest(value);
}

export function validateEditorPreviewContentRefreshResponse(value: unknown): value is EditorPreviewContentRefreshResponse {
  return previewRefreshResponse(value);
}

export function validateEditorPreviewSceneRequest(value: unknown): value is EditorPreviewSceneRequest {
  return previewSceneRequest(value);
}

export function validateEditorPreviewSceneResponse(value: unknown): value is EditorPreviewSceneResponse {
  return previewSceneResponse(value);
}

export function validatePlayerPreviewEntitiesMessage(value: unknown): value is PlayerPreviewEntitiesMessage {
  return previewEntitiesMessage(value);
}

export function validateEditorPreviewPrototypeRequest(value: unknown): value is EditorPreviewPrototypeRequest {
  return previewPrototypeRequest(value);
}

export function validateEditorPreviewPrototypeResponse(value: unknown): value is EditorPreviewPrototypeResponse {
  return previewPrototypeResponse(value);
}

export function validateEditorPrototypePreviewRequest(value: unknown): value is EditorPrototypePreviewRequest {
  return prototypePreviewRequest(value);
}

export function validateEditorPrototypePreviewResponse(value: unknown): value is EditorPrototypePreviewResponse {
  return prototypePreviewResponse(value);
}
