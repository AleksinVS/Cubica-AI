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
import { debugSessionControlRequestSchema } from "./generated/debug-session-control-request.schema.ts";
import { debugSessionControlResponseSchema } from "./generated/debug-session-control-response.schema.ts";
import { saveDebugCheckpointRequestSchema } from "./generated/save-debug-checkpoint-request.schema.ts";
import { debugCheckpointListResponseSchema } from "./generated/debug-checkpoint-list-response.schema.ts";
import { debugCheckpointMetadataSchema } from "./generated/debug-checkpoint-metadata.schema.ts";
import { editorDebugBridgeRequestSchema } from "./generated/editor-debug-bridge-request.schema.ts";
import { editorDebugBridgeResponseSchema } from "./generated/editor-debug-bridge-response.schema.ts";

const Ajv2020 = (Ajv2020Lib as any).default || Ajv2020Lib;
const addFormats = (addFormatsLib as any).default || addFormatsLib;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const control = ajv.compile(debugSessionControlRequestSchema as object) as ValidateFunction<DebugSessionControlRequest>;
const save = ajv.compile(saveDebugCheckpointRequestSchema as object) as ValidateFunction<SaveDebugCheckpointRequest>;
const controlResponse = ajv.compile(debugSessionControlResponseSchema as object) as ValidateFunction<DebugSessionControlResponse>;
const metadata = ajv.compile(debugCheckpointMetadataSchema as object) as ValidateFunction<WireDebugCheckpointMetadata>;
const list = ajv.compile(debugCheckpointListResponseSchema as object) as ValidateFunction<DebugCheckpointListResponse>;
const bridgeRequest = ajv.compile(editorDebugBridgeRequestSchema as object) as ValidateFunction<EditorDebugBridgeRequest>;
const bridgeResponse = ajv.compile(editorDebugBridgeResponseSchema as object) as ValidateFunction<EditorDebugBridgeResponse>;

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
