#!/usr/bin/env node
/**
 * Validates the current Runtime API OpenAPI contract.
 *
 * ADR-051 applies API First while `services/runtime-api` is still a modular
 * monolith. This script keeps that contract honest without adding a YAML or
 * OpenAPI parser dependency: `runtime-api-openapi.yaml` uses the
 * JSON-compatible YAML profile, so built-in JSON parsing is enough for the
 * first contract gate.
 */

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const openApiPath = path.join(repoRoot, "docs/architecture/runtime-api-openapi.yaml");
const httpServerPath = path.join(repoRoot, "services/runtime-api/src/modules/player-api/httpServer.ts");

const expectedOperations = [
  { method: "get", path: "/health", operationId: "getHealth", tag: "Admin", marker: 'requestUrl.pathname === "/health"' },
  { method: "get", path: "/readiness", operationId: "getReadiness", tag: "Admin", marker: 'requestUrl.pathname === "/readiness"' },
  { method: "post", path: "/content/reload", operationId: "reloadContent", tag: "Content", marker: 'requestUrl.pathname === "/content/reload"' },
  {
    method: "get",
    path: "/content-sources/{contentSourceId}/plugin-bundles/{pluginId}/{contentHash}.mjs",
    operationId: "getPreviewPluginBundle",
    tag: "EditorPreview",
    marker: "content-sources"
  },
  {
    method: "get",
    path: "/published-plugin-bundles/{gameId}/{pluginId}/{contentHash}.mjs",
    operationId: "getPublishedPluginBundle",
    tag: "Content",
    marker: "published-plugin-bundles"
  },
  {
    method: "get",
    path: "/game-assets/{gameId}/index.json",
    operationId: "getGameAssetIndex",
    tag: "Content",
    marker: "gameAssetIndexMatch"
  },
  {
    method: "get",
    path: "/game-assets/{gameId}/{assetId}/{contentHash}.{extension}",
    operationId: "getGameAssetFile",
    tag: "Content",
    marker: "gameAssetFileMatch"
  },
  {
    method: "get",
    path: "/game-stylesheets/{gameId}/{stylesheetId}/{contentHash}.css",
    operationId: "getGameStylesheet",
    tag: "Content",
    marker: "gameStylesheetMatch"
  },
  {
    method: "get",
    path: "/games/{gameId}/player-content",
    operationId: "getPlayerContent",
    tag: "PlayerContent",
    marker: "player-content"
  },
  {
    method: "get",
    path: "/games/{gameId}/readiness",
    operationId: "getGameReadiness",
    tag: "PlayerContent",
    marker: "gameReadinessMatch"
  },
  { method: "post", path: "/sessions", operationId: "createSession", tag: "Sessions", marker: 'requestUrl.pathname === "/sessions"' },
  {
    method: "get",
    path: "/sessions/{sessionId}",
    operationId: "getSession",
    tag: "Sessions",
    marker: 'requestUrl.pathname.startsWith("/sessions/")'
  },
  {
    method: "get",
    path: "/sessions/{sessionId}/events",
    operationId: "streamSessionVersionNotifications",
    tag: "Sessions",
    marker: "sessionEventsMatch"
  },
  {
    method: "get",
    path: "/sessions/{sessionId}/public-journal",
    operationId: "getPublicGameplayJournal",
    tag: "Sessions",
    marker: "public-journal"
  },
  {
    method: "post",
    path: "/sessions/{sessionId}/ai-debriefs",
    operationId: "generateSessionAiDebrief",
    tag: "SessionAiDebrief",
    marker: "generateAiDebriefMatch"
  },
  {
    method: "get",
    path: "/sessions/{sessionId}/ai-debriefs/latest",
    operationId: "getLatestSessionAiDebrief",
    tag: "SessionAiDebrief",
    marker: "latestAiDebriefMatch"
  },
  {
    method: "post",
    path: "/sessions/{sessionId}/ai-debriefs/{artifactId}/confirm",
    operationId: "confirmSessionAiDebrief",
    tag: "SessionAiDebrief",
    marker: "confirmAiDebriefMatch"
  },
  {
    method: "post",
    path: "/sessions/{sessionId}/preview-restore",
    operationId: "restorePreviewSession",
    tag: "EditorPreview",
    marker: "preview-restore"
  },
  { method: "get", path: "/sessions/{sessionId}/debug", operationId: "getDebugSessionControl", tag: "EditorPreview", marker: "debugControlMatch" },
  { method: "post", path: "/sessions/{sessionId}/debug/pause", operationId: "pauseDebugSession", tag: "EditorPreview", marker: "debugToggleMatch" },
  { method: "post", path: "/sessions/{sessionId}/debug/resume", operationId: "resumeDebugSession", tag: "EditorPreview", marker: "debugToggleMatch" },
  { method: "get", path: "/sessions/{sessionId}/debug/checkpoints", operationId: "listDebugCheckpoints", tag: "EditorPreview", marker: "debugCheckpointsMatch" },
  { method: "post", path: "/sessions/{sessionId}/debug/checkpoints", operationId: "saveDebugCheckpoint", tag: "EditorPreview", marker: "debugCheckpointsMatch" },
  { method: "delete", path: "/sessions/{sessionId}/debug/checkpoints/{checkpointId}", operationId: "deleteDebugCheckpoint", tag: "EditorPreview", marker: "debugCheckpointMatch" },
  { method: "post", path: "/sessions/{sessionId}/debug/checkpoints/{checkpointId}/restore", operationId: "restoreDebugCheckpoint", tag: "EditorPreview", marker: "debugRestoreMatch" },
  { method: "post", path: "/actions", operationId: "dispatchAction", tag: "RuntimeActions", marker: 'requestUrl.pathname === "/actions"' },
  {
    method: "post",
    path: "/action-previews/transport-road",
    operationId: "previewTransportRoad",
    tag: "RuntimeActions",
    marker: 'requestUrl.pathname === "/action-previews/transport-road"'
  },
  { method: "post", path: "/agent-turns", operationId: "runAgentTurn", tag: "AgentRuntime", marker: 'requestUrl.pathname === "/agent-turns"' }
];

const historicalSpecPaths = [
  "docs/architecture/router-openapi.yaml",
  "docs/architecture/engine-api.yaml",
  "docs/architecture/repository-openapi.yaml"
];

function fail(message) {
  throw new Error(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function parseOpenApi() {
  const raw = fs.readFileSync(openApiPath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`runtime-api-openapi.yaml must stay in JSON-compatible YAML profile: ${error.message}`);
  }
}

function objectEntries(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value)
    : [];
}

function collectRefs(value, refs = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRefs(item, refs);
    }
    return refs;
  }
  if (!value || typeof value !== "object") {
    return refs;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "$ref" && typeof child === "string") {
      refs.push(child);
      continue;
    }
    collectRefs(child, refs);
  }
  return refs;
}

function resolveJsonPointer(root, pointer) {
  if (!pointer.startsWith("#/")) {
    return undefined;
  }

  const parts = pointer
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current = root;
  for (const part of parts) {
    if (current === null || typeof current !== "object" || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function resolveSchemaReference(spec, reference) {
  if (reference.startsWith("#/")) {
    return resolveJsonPointer(spec, reference);
  }
  const [relativeFile, fragment] = reference.split("#", 2);
  const canonicalUiComponentSchemaId = "https://cubica.platform/schemas/ui-manifest.v1.json";
  const absolutePath = relativeFile === canonicalUiComponentSchemaId
    ? path.resolve(path.dirname(openApiPath), "schemas/ui-manifest.schema.json")
    : path.resolve(path.dirname(openApiPath), relativeFile);
  let external;
  try {
    external = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    fail(`Unable to read external OpenAPI schema ${reference}: ${error.message}`);
  }
  if (relativeFile === canonicalUiComponentSchemaId && external.$id !== canonicalUiComponentSchemaId) {
    fail("Canonical UI component schema id changed.");
  }
  return fragment === undefined || fragment === ""
    ? external
    : resolveJsonPointer(external, `#${fragment}`);
}

function pathParameters(pathTemplate) {
  return [...pathTemplate.matchAll(/\{([^}]+)\}/gu)].map((match) => match[1]);
}

function dereferenceParameter(spec, parameterOrRef) {
  if (parameterOrRef && typeof parameterOrRef === "object" && typeof parameterOrRef.$ref === "string") {
    return resolveJsonPointer(spec, parameterOrRef.$ref);
  }
  return parameterOrRef;
}

function validatePathParameters(spec, pathTemplate, operation) {
  const requiredParameters = pathParameters(pathTemplate);
  const parameters = Array.isArray(operation.parameters) ? operation.parameters : [];

  for (const parameterName of requiredParameters) {
    const parameter = parameters
      .map((candidate) => dereferenceParameter(spec, candidate))
      .find((candidate) => candidate?.in === "path" && candidate?.name === parameterName);
    if (!parameter) {
      fail(`${operation.operationId} is missing path parameter "${parameterName}"`);
    }
    if (parameter.required !== true) {
      fail(`${operation.operationId} path parameter "${parameterName}" must be required`);
    }
  }
}

function validateSpecShape(spec) {
  if (spec.openapi !== "3.1.0") {
    fail(`Expected openapi 3.1.0, got ${String(spec.openapi)}`);
  }
  if (spec["x-cubica-contract-status"] !== "current-implemented-contract") {
    fail("runtime-api-openapi.yaml must be marked as current-implemented-contract");
  }
  if (spec["x-cubica-yaml-profile"] !== "json-compatible-yaml") {
    fail("runtime-api-openapi.yaml must declare x-cubica-yaml-profile=json-compatible-yaml");
  }
  if (!spec.info?.title || !spec.info?.version) {
    fail("OpenAPI info.title and info.version are required");
  }
  if (!spec.paths || typeof spec.paths !== "object" || Array.isArray(spec.paths)) {
    fail("OpenAPI paths object is required");
  }
  if (!spec.components?.schemas || typeof spec.components.schemas !== "object") {
    fail("OpenAPI components.schemas object is required");
  }
}

function validateOperations(spec) {
  const declaredTags = new Set((spec.tags ?? []).map((tag) => tag.name));
  const expectedPaths = new Set(expectedOperations.map((operation) => operation.path));
  const actualPaths = new Set(Object.keys(spec.paths));
  const operationIds = new Set();

  for (const actualPath of actualPaths) {
    if (!expectedPaths.has(actualPath)) {
      fail(`Unexpected runtime-api OpenAPI path: ${actualPath}`);
    }
  }

  for (const expected of expectedOperations) {
    const pathItem = spec.paths[expected.path];
    if (!pathItem) {
      fail(`Missing OpenAPI path: ${expected.path}`);
    }

    const operation = pathItem[expected.method];
    if (!operation) {
      fail(`Missing OpenAPI operation: ${expected.method.toUpperCase()} ${expected.path}`);
    }
    if (operation.operationId !== expected.operationId) {
      fail(`${expected.method.toUpperCase()} ${expected.path} operationId must be ${expected.operationId}`);
    }
    if (!Array.isArray(operation.tags) || !operation.tags.includes(expected.tag)) {
      fail(`${expected.operationId} must include tag ${expected.tag}`);
    }
    for (const tag of operation.tags) {
      if (!declaredTags.has(tag)) {
        fail(`${expected.operationId} uses undeclared tag ${tag}`);
      }
    }
    if (!operation["x-cubica-scope"]) {
      fail(`${expected.operationId} must declare x-cubica-scope`);
    }
    if (!operation.responses || Object.keys(operation.responses).length === 0) {
      fail(`${expected.operationId} must declare responses`);
    }
    if (operationIds.has(operation.operationId)) {
      fail(`Duplicate operationId: ${operation.operationId}`);
    }
    operationIds.add(operation.operationId);
    validatePathParameters(spec, expected.path, operation);
  }
}

function validateRefs(spec) {
  for (const ref of collectRefs(spec)) {
    if (resolveSchemaReference(spec, ref) === undefined) {
      fail(`Unresolved OpenAPI reference: ${ref}`);
    }
  }
}

function validateRuntimeRouteMarkers() {
  const source = fs.readFileSync(httpServerPath, "utf8");
  for (const expected of expectedOperations) {
    if (!source.includes(expected.marker)) {
      fail(`httpServer.ts marker for ${expected.method.toUpperCase()} ${expected.path} was not found: ${expected.marker}`);
    }
  }
}

function validateHistoricalSpecs() {
  for (const relativePath of historicalSpecPaths) {
    const text = read(relativePath);
    if (!text.includes("x-cubica-contract-status: future-extraction-reference")) {
      fail(`${relativePath} must be marked as future-extraction-reference`);
    }
    if (!text.includes("x-cubica-current-implementation: false")) {
      fail(`${relativePath} must state x-cubica-current-implementation: false`);
    }
  }
}

function validateSchemaCoverage(spec) {
  const requiredSchemas = [
    "ActionResponse",
    "AgentControl",
    "AgentTurnRequest",
    "AgentTurnResponse",
    "ContentReloadRequest",
    "ContentReloadResponse",
    "CreateSessionRequest",
    "CreatedSessionResponse",
    "DebugSessionControlRequest",
    "DebugSessionControlResponse",
    "SaveDebugCheckpointRequest",
    "DebugCheckpointMetadata",
    "DebugCheckpointListResponse",
    "EditorDebugBridgeRequest",
    "EditorDebugBridgeResponse",
    "DispatchActionRequest",
    "ErrorResponse",
    "GameReadinessResponse",
    "HealthResponse",
    "PlayerFacingContent",
    "PortablePublicGameplayJournal",
    "SessionAiDebriefArtifact",
    "SessionAiDebriefGenerateRequest",
    "SessionAiDebriefConfirmRequest",
    "PrivateSessionInvite",
    "PrivateSessionInvites",
    "PublicCommandReceipt",
    "ReadinessResponse",
    "RestorePreviewSessionRequest",
    "RestorePreviewSessionResponse",
    "SessionResponse",
    "SessionParticipant",
    "SessionParticipants",
    "SessionCredential",
    "SessionRole",
    "SessionStateVersion",
    "SessionVersionNotification",
    "TransportRoadPreviewRequest",
    "TransportRoadPreviewResponse"
  ];

  for (const schemaName of requiredSchemas) {
    if (!spec.components.schemas[schemaName]) {
      fail(`Missing required runtime-api contract schema: ${schemaName}`);
    }
  }

  const pathOperationCount = objectEntries(spec.paths)
    .flatMap(([, pathItem]) => objectEntries(pathItem))
    .filter(([method]) => ["get", "post", "put", "patch", "delete"].includes(method)).length;
  if (pathOperationCount !== expectedOperations.length) {
    fail(`Expected ${expectedOperations.length} runtime-api operations, found ${pathOperationCount}`);
  }
}

/**
 * Keep the duplicate-action safety contract from drifting out of OpenAPI.
 * Generic schema coverage alone would still pass if this one required field or
 * its conflict response were accidentally removed.
 */
function validateActionConcurrencyContract(spec) {
  const requestSchemaOrRef = spec.components.schemas.DispatchActionRequest;
  const schema = typeof requestSchemaOrRef?.$ref === "string"
    ? resolveSchemaReference(spec, requestSchemaOrRef.$ref)
    : requestSchemaOrRef;
  if (!Array.isArray(schema.required) || !schema.required.includes("expectedStateVersion")) {
    fail("DispatchActionRequest must require expectedStateVersion");
  }
  const version = schema.properties?.expectedStateVersion;
  if (version?.type !== "integer" || version.minimum !== 0) {
    fail("DispatchActionRequest.expectedStateVersion must be an integer with minimum 0");
  }
  for (const requiredField of ["sessionId", "actionId", "commandId", "params"]) {
    if (!schema.required.includes(requiredField)) {
      fail(`DispatchActionRequest must require ${requiredField}`);
    }
  }
  if (schema.additionalProperties !== false) {
    fail("DispatchActionRequest must be a closed transport envelope");
  }
  if (schema.properties?.commandId?.pattern !== "^cli_[A-Za-z0-9_-]{22}$") {
    fail("DispatchActionRequest.commandId must use the external cli_ profile");
  }
  if (schema.properties?.playerId !== undefined || schema.properties?.payload !== undefined) {
    fail("DispatchActionRequest must not expose trusted playerId or legacy payload");
  }
  const conflict = spec.paths?.["/actions"]?.post?.responses?.["409"];
  if (conflict?.$ref !== "#/components/responses/Conflict") {
    fail("POST /actions must document the shared 409 Conflict response");
  }

  const agentConflict = spec.paths?.["/agent-turns"]?.post?.responses?.["409"];
  if (agentConflict?.$ref !== "#/components/responses/Conflict") {
    fail("POST /agent-turns must document the shared 409 Conflict response");
  }

  const previewSchema = spec.components.schemas.TransportRoadPreviewRequest;
  if (!Array.isArray(previewSchema.required) || !previewSchema.required.includes("expectedStateVersion")) {
    fail("TransportRoadPreviewRequest must require expectedStateVersion");
  }
  const previewVersion = previewSchema.properties?.expectedStateVersion;
  if (previewVersion?.type !== "integer" || previewVersion.minimum !== 0) {
    fail("TransportRoadPreviewRequest.expectedStateVersion must be an integer with minimum 0");
  }
  const previewConflict = spec.paths?.["/action-previews/transport-road"]?.post?.responses?.["409"];
  if (previewConflict?.$ref !== "#/components/responses/Conflict") {
    fail("POST /action-previews/transport-road must document the shared 409 Conflict response");
  }
}

/** Locks small but security-relevant response and editor-preview shapes. */
function validatePreciseRuntimeShapes(spec) {
  if (JSON.stringify(spec.components.schemas.SessionRole?.enum) !==
      JSON.stringify(["player", "facilitator", "assistant", "observer"])) {
    fail("SessionRole must remain the exact authenticated principal role vocabulary");
  }
  const planHash = spec.components.schemas.PublicCommandReceipt?.properties?.planHash;
  if (planHash?.pattern !== "^sha256:[a-f0-9]{64}$") {
    fail("PublicCommandReceipt.planHash must use the sha256:<64 lowercase hex> profile");
  }

  const participant = spec.components.schemas.SessionParticipant;
  if (
    participant?.additionalProperties !== false ||
    JSON.stringify(participant.required) !== JSON.stringify(["seatId", "playerId", "kind", "joinState"]) ||
    JSON.stringify(participant.properties?.kind?.enum) !== JSON.stringify(["human", "agent"]) ||
    JSON.stringify(participant.properties?.joinState?.enum) !==
      JSON.stringify(["local", "private-invite"])
  ) {
    fail("SessionParticipant must remain the exact closed authoritative seat shape");
  }
  const participantRef = "#/components/schemas/SessionParticipants";
  const viewerRoleRef = "#/components/schemas/SessionRole";
  for (const schemaName of [
    "ActionResponse",
    "AgentTurnResponse",
    "CreatedSessionResponse",
    "RestorePreviewSessionResponse",
    "SessionResponse"
  ]) {
    const responseSchema = spec.components.schemas[schemaName];
    if (!responseSchema.required?.includes("participants") ||
        responseSchema.properties?.participants?.$ref !== participantRef) {
      fail(`${schemaName} must require authoritative session participants`);
    }
    if (responseSchema.properties?.viewerRole?.$ref !== viewerRoleRef) {
      fail(`${schemaName} must expose the authenticated principal's trusted viewerRole`);
    }
  }

  const agentControl = spec.components.schemas.AgentControl;
  if (
    agentControl?.additionalProperties !== false ||
    JSON.stringify(agentControl.required) !== JSON.stringify(["playerId", "status", "reasonCode"]) ||
    agentControl.properties?.playerId?.$ref !== "#/components/schemas/PlayerId" ||
    JSON.stringify(agentControl.properties?.status?.enum) !==
      JSON.stringify(["paused", "facilitatorTakeover"]) ||
    JSON.stringify(agentControl.properties?.reasonCode?.enum) !==
      JSON.stringify(["runtimeUnavailable", "invalidAttemptLimit", "fallbackUnavailable", "stepLimit"])
  ) {
    fail("AgentControl must remain the exact approved closed public status shape");
  }
  for (const schemaName of ["ActionResponse", "CreatedSessionResponse", "SessionResponse"]) {
    if (spec.components.schemas[schemaName]?.properties?.agentControl?.$ref !==
        "#/components/schemas/AgentControl") {
      fail(`${schemaName} must expose optional AgentControl`);
    }
  }

  const bundle = spec.components.schemas.LocalPlayerWebPluginBundle;
  const required = new Set(Array.isArray(bundle?.required) ? bundle.required : []);
  for (const field of ["gameId", "pluginId", "apiVersion", "target", "contentHash", "filePath"]) {
    if (!required.has(field)) {
      fail(`LocalPlayerWebPluginBundle must require ${field}`);
    }
  }
  if (required.has("scope")) {
    fail("LocalPlayerWebPluginBundle.scope must remain optional because the parser defaults it to preview");
  }
  if (bundle?.properties?.scope?.const !== "preview") {
    fail("LocalPlayerWebPluginBundle.scope must allow only preview");
  }
  if (bundle?.properties?.apiVersion?.minLength !== 1 || bundle?.properties?.filePath?.minLength !== 1) {
    fail("LocalPlayerWebPluginBundle apiVersion and filePath must be non-empty strings");
  }
  if (bundle?.properties?.file !== undefined) {
    fail("LocalPlayerWebPluginBundle must use parser field filePath, not legacy file");
  }

  const stylesheetResponse = spec.paths?.["/game-stylesheets/{gameId}/{stylesheetId}/{contentHash}.css"]
    ?.get?.responses?.["200"];
  if (stylesheetResponse?.content?.["text/css"]?.schema?.type !== "string") {
    fail("GET game stylesheet must document a text/css string response");
  }
  const stylesheetId = spec.components?.parameters?.StylesheetId;
  if (stylesheetId?.schema?.pattern !== "^[a-z0-9][a-z0-9-]{0,63}$") {
    fail("StylesheetId must match the runtime route's bounded identifier profile");
  }
}

function validateSessionTrustContract(spec) {
  if (spec.components?.securitySchemes?.SessionBearer?.scheme !== "bearer") {
    fail("OpenAPI must declare the SessionBearer HTTP security scheme");
  }
  for (const [pathTemplate, method] of [
    ["/sessions/{sessionId}", "get"],
    ["/sessions/{sessionId}/events", "get"],
    ["/sessions/{sessionId}/public-journal", "get"],
    ["/sessions/{sessionId}/preview-restore", "post"],
    ["/sessions/{sessionId}/debug", "get"],
    ["/sessions/{sessionId}/debug/pause", "post"],
    ["/sessions/{sessionId}/debug/resume", "post"],
    ["/sessions/{sessionId}/debug/checkpoints", "get"],
    ["/sessions/{sessionId}/debug/checkpoints", "post"],
    ["/sessions/{sessionId}/debug/checkpoints/{checkpointId}", "delete"],
    ["/sessions/{sessionId}/debug/checkpoints/{checkpointId}/restore", "post"],
    ["/actions", "post"],
    ["/action-previews/transport-road", "post"],
    ["/agent-turns", "post"]
  ]) {
    const operation = spec.paths?.[pathTemplate]?.[method];
    if (!Array.isArray(operation?.security) || operation.security[0]?.SessionBearer === undefined) {
      fail(`${method.toUpperCase()} ${pathTemplate} must require SessionBearer authentication`);
    }
    if (operation.responses?.["401"]?.$ref !== "#/components/responses/Unauthorized") {
      fail(`${method.toUpperCase()} ${pathTemplate} must document 401 Unauthorized`);
    }
  }

  const create = spec.components.schemas.CreateSessionRequest;
  if (
    create.properties?.playerId !== undefined ||
    create.properties?.participants !== undefined ||
    create.additionalProperties !== false
  ) {
    fail("CreateSessionRequest must not accept client-selected playerId or unknown fields");
  }
  const agentSeatCount = create.properties?.agentSeatCount;
  if (agentSeatCount?.type !== "integer" || agentSeatCount.minimum !== 0 || agentSeatCount.maximum !== 64) {
    fail("CreateSessionRequest.agentSeatCount must be an optional bounded non-negative integer");
  }
  const participantCount = create.properties?.participantCount;
  if (participantCount?.type !== "integer" || participantCount.minimum !== 1) {
    fail("CreateSessionRequest.participantCount must remain an optional positive integer");
  }
  const accessMode = create.properties?.accessMode;
  if (
    JSON.stringify(accessMode?.enum) !== JSON.stringify(["local", "private-invite"]) ||
    accessMode.default !== "local"
  ) {
    fail("CreateSessionRequest.accessMode must preserve local default and allow only private-invite");
  }
  const privateAgentExclusion = Array.isArray(create.allOf) && create.allOf.some((constraint) =>
    constraint?.not?.required?.includes("accessMode") &&
    constraint.not.required.includes("agentSeatCount") &&
    constraint.not.properties?.accessMode?.const === "private-invite" &&
    constraint.not.properties?.agentSeatCount?.minimum === 1
  );
  if (!privateAgentExclusion) {
    fail("CreateSessionRequest must reject private-invite sessions with positive agentSeatCount");
  }
  const privatePreviewExclusion = Array.isArray(create.allOf) && create.allOf.some((constraint) =>
    constraint?.not?.required?.includes("accessMode") &&
    constraint.not.required.includes("contentSourceId") &&
    constraint.not.properties?.accessMode?.const === "private-invite"
  );
  if (!privatePreviewExclusion) {
    fail("CreateSessionRequest must reject private-invite sessions with contentSourceId");
  }

  const invite = spec.components.schemas.PrivateSessionInvite;
  if (
    invite?.additionalProperties !== false ||
    JSON.stringify(invite.required) !== JSON.stringify(["credential"]) ||
    Object.keys(invite.properties ?? {}).length !== 1 ||
    invite.properties?.credential?.$ref !== "#/components/schemas/SessionCredential"
  ) {
    fail("PrivateSessionInvite must remain the exact closed credential-only capability shape");
  }
  if (
    spec.components.schemas.PrivateSessionInvites?.minItems !== 1 ||
    spec.components.schemas.PrivateSessionInvites?.items?.$ref !==
      "#/components/schemas/PrivateSessionInvite"
  ) {
    fail("PrivateSessionInvites must be a non-empty collection of canonical PrivateSessionInvite entries");
  }
  if (spec.components.schemas.CreatedSessionResponse?.properties?.privateInvites?.$ref !==
      "#/components/schemas/PrivateSessionInvites") {
    fail("CreatedSessionResponse must expose optional creation-only privateInvites");
  }
  for (const schemaName of [
    "ActionResponse",
    "AgentTurnResponse",
    "RestorePreviewSessionResponse",
    "SessionResponse"
  ]) {
    const properties = spec.components.schemas[schemaName]?.properties;
    if (properties?.credential !== undefined || properties?.privateInvites !== undefined) {
      fail(`${schemaName} must not expose creation-only session credentials`);
    }
  }

  const notification = spec.components.schemas.SessionVersionNotification;
  if (
    notification?.additionalProperties !== false ||
    JSON.stringify(notification.required) !== JSON.stringify(["stateVersion", "lastEventSequence"]) ||
    notification.properties?.stateVersion?.type !== "integer" ||
    notification.properties.stateVersion.minimum !== 0 ||
    notification.properties?.lastEventSequence?.type !== "integer" ||
    notification.properties.lastEventSequence.minimum !== 0
  ) {
    fail("SessionVersionNotification must remain the exact closed non-negative cursor shape");
  }
  const eventStream = spec.paths?.["/sessions/{sessionId}/events"]?.get?.responses?.["200"]
    ?.content?.["text/event-stream"]?.schema;
  if (eventStream?.$ref !== "#/components/schemas/SessionVersionNotification") {
    fail("GET session events must stream canonical SessionVersionNotification payloads");
  }
  if (spec.paths?.["/sessions/{sessionId}/events"]?.get?.responses?.["429"]?.$ref !==
      "#/components/responses/TooManyRequests") {
    fail("GET session events must declare bounded-capacity HTTP 429");
  }
  const retryAfter = spec.components.responses?.TooManyRequests?.headers?.["Retry-After"];
  if (
    retryAfter?.required !== true ||
    retryAfter.schema?.type !== "integer" ||
    retryAfter.schema.minimum !== 1
  ) {
    fail("TooManyRequests must require a positive integer Retry-After header");
  }
  const preview = spec.components.schemas.TransportRoadPreviewRequest;
  if (preview.properties?.playerId !== undefined) {
    fail("Protected preview requests must not accept client-selected playerId");
  }
}

function validatePublicJournalContract(spec) {
  const schema = spec.components.schemas.PortablePublicGameplayJournal;
  if (schema?.$ref !== "./schemas/public-gameplay-journal.schema.json") {
    fail("PortablePublicGameplayJournal must reference the canonical public journal schema");
  }
  const operation = spec.paths?.["/sessions/{sessionId}/public-journal"]?.get;
  if (operation?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref !==
      "./schemas/public-gameplay-journal.schema.json") {
    fail("GET public journal must return the canonical public journal schema");
  }
  if (operation?.responses?.["413"]?.$ref !== "#/components/responses/PayloadTooLarge") {
    fail("GET public journal must document the explicit 413 response");
  }
  if (operation?.responses?.["401"]?.$ref !== "#/components/responses/Unauthorized") {
    fail("GET public journal must document 401 Unauthorized");
  }
}

function validateSessionAiDebriefContract(spec) {
  const canonicalRef = "./schemas/session-ai-debrief.schema.json";
  const methodologyRef = "./schemas/game-manifest.schema.json#/definitions/GameManifestAiDebriefProfile";
  if (spec.components.schemas.SessionAiDebriefArtifact?.$ref !== canonicalRef) {
    fail("SessionAiDebriefArtifact must reference the canonical AI debrief schema");
  }
  if (spec.components.schemas.PlayerFacingContent?.properties?.aiDebrief?.$ref !== methodologyRef) {
    fail("PlayerFacingContent.aiDebrief must reference the canonical published methodology profile");
  }
  const operations = [
    spec.paths?.["/sessions/{sessionId}/ai-debriefs"]?.post,
    spec.paths?.["/sessions/{sessionId}/ai-debriefs/latest"]?.get,
    spec.paths?.["/sessions/{sessionId}/ai-debriefs/{artifactId}/confirm"]?.post
  ];
  for (const operation of operations) {
    if (operation?.security?.[0]?.SessionBearer === undefined) {
      fail("Every session AI debrief operation must require SessionBearer");
    }
    if (operation?.responses?.[operation.operationId === "generateSessionAiDebrief" ? "201" : "200"]
        ?.content?.["application/json"]?.schema?.$ref !== canonicalRef) {
      fail(`${operation?.operationId ?? "AI debrief operation"} must return the canonical artifact schema`);
    }
    if (operation?.responses?.["401"]?.$ref !== "#/components/responses/Unauthorized" ||
        operation?.responses?.["403"]?.$ref !== "#/components/responses/Forbidden") {
      fail(`${operation?.operationId ?? "AI debrief operation"} must document authentication and facilitator authorization`);
    }
  }
  if (operations[0]?.responses?.["504"]?.$ref !== "#/components/responses/GatewayTimeout") {
    fail("AI debrief generation must document the bounded provider timeout as 504");
  }
}

function validateEditorDebugContract(spec) {
  const schemas = spec.components.schemas;
  const checkpointBase = "/sessions/{sessionId}/debug/checkpoints";
  const operations = [
    ["/sessions/{sessionId}/debug", "get", "200", "DebugSessionControlResponse"],
    ["/sessions/{sessionId}/debug/pause", "post", "200", "DebugSessionControlResponse"],
    ["/sessions/{sessionId}/debug/resume", "post", "200", "DebugSessionControlResponse"],
    [checkpointBase, "get", "200", "DebugCheckpointListResponse"],
    [checkpointBase, "post", "201", "DebugCheckpointMetadata"],
    [`${checkpointBase}/{checkpointId}/restore`, "post", "201", "CreatedSessionResponse"]
  ];
  for (const [pathTemplate, method, status, schemaName] of operations) {
    const operation = spec.paths[pathTemplate]?.[method];
    if (operation?.["x-cubica-scope"] !== "editor-preview" ||
        operation.responses?.[status]?.content?.["application/json"]?.schema?.$ref !==
          `#/components/schemas/${schemaName}`) {
      fail(`${method.toUpperCase()} ${pathTemplate} must return its canonical editor-preview response`);
    }
  }
  const deletion = spec.paths[`${checkpointBase}/{checkpointId}`]?.delete;
  if (deletion?.["x-cubica-scope"] !== "editor-preview" || deletion.responses?.["204"] === undefined) {
    fail("Checkpoint deletion must remain a scoped, body-free 204 operation");
  }
  for (const [pathTemplate, schemaName] of [
    ["/sessions/{sessionId}/debug/pause", "DebugSessionControlRequest"],
    ["/sessions/{sessionId}/debug/resume", "DebugSessionControlRequest"],
    [checkpointBase, "SaveDebugCheckpointRequest"]
  ]) {
    if (spec.paths[pathTemplate]?.post?.requestBody?.$ref !== `#/components/requestBodies/${schemaName}`) {
      fail(`POST ${pathTemplate} must use ${schemaName}`);
    }
  }
  for (const [pathTemplate, method] of [
    ["/sessions/{sessionId}/debug", "get"],
    ["/sessions/{sessionId}/debug/pause", "post"],
    ["/sessions/{sessionId}/debug/resume", "post"],
    [checkpointBase, "get"],
    [checkpointBase, "post"],
    [`${checkpointBase}/{checkpointId}`, "delete"],
    [`${checkpointBase}/{checkpointId}/restore`, "post"]
  ]) {
    if (spec.paths[pathTemplate]?.[method]?.responses?.["403"]?.$ref !==
        "#/components/responses/Forbidden") {
      fail(`${method.toUpperCase()} ${pathTemplate} must document controller authorization`);
    }
  }
  const metadata = schemas.DebugCheckpointMetadata;
  const allowedMetadata = ["checkpointId", "compatibility", "compatibilityReason", "createdAt", "label", "sourceStateVersion"];
  const requiredMetadata = ["checkpointId", "compatibility", "createdAt", "label", "sourceStateVersion"];
  if (metadata?.type !== "object" || metadata.additionalProperties !== false ||
      JSON.stringify(Object.keys(metadata.properties ?? {}).sort()) !== JSON.stringify(allowedMetadata) ||
      JSON.stringify([...(metadata.required ?? [])].sort()) !== JSON.stringify(requiredMetadata) ||
      metadata.properties.checkpointId?.format !== "uuid" ||
      metadata.properties.createdAt?.type !== "string" ||
      metadata.properties.createdAt?.format !== "date-time" ||
      metadata.properties.sourceStateVersion?.minimum !== 0 ||
      JSON.stringify(metadata.properties.compatibility?.enum) !== JSON.stringify(["compatible", "incompatible", "unavailable"]) ||
      JSON.stringify(metadata.properties.compatibilityReason?.enum) !== JSON.stringify([
        "state-model", "participants", "schedule", "storage-bindings", "content-unavailable", "rules-unavailable", "runtime-policy"
      ])) {
    fail("DebugCheckpointMetadata must expose only the closed public metadata shape");
  }
  const list = schemas.DebugCheckpointListResponse;
  if (list?.additionalProperties !== false ||
      JSON.stringify(list.required) !== JSON.stringify(["checkpoints"]) ||
      list.properties?.checkpoints?.type !== "array" ||
      list.properties.checkpoints.maxItems !== 20 ||
      list.properties.checkpoints.items?.$ref !== "#/components/schemas/DebugCheckpointMetadata") {
    fail("DebugCheckpointListResponse must contain at most 20 public metadata records");
  }
  const control = schemas.DebugSessionControlResponse;
  if (control?.additionalProperties !== false ||
      JSON.stringify(Object.keys(control.properties ?? {}).sort()) !==
        JSON.stringify(["paused", "sessionId", "version"]) ||
      JSON.stringify([...(control.required ?? [])].sort()) !==
        JSON.stringify(["paused", "sessionId", "version"])) {
    fail("DebugSessionControlResponse must not expose protected state");
  }
}

try {
  const spec = parseOpenApi();
  validateSpecShape(spec);
  validateOperations(spec);
  validateRefs(spec);
  validateRuntimeRouteMarkers();
  validateHistoricalSpecs();
  validateSchemaCoverage(spec);
  validateActionConcurrencyContract(spec);
  validateSessionTrustContract(spec);
  validatePreciseRuntimeShapes(spec);
  validatePublicJournalContract(spec);
  validateSessionAiDebriefContract(spec);
  validateEditorDebugContract(spec);
  console.log("validate-runtime-api-openapi: OK");
} catch (error) {
  console.error("validate-runtime-api-openapi: failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
