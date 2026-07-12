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
    method: "post",
    path: "/sessions/{sessionId}/preview-restore",
    operationId: "restorePreviewSession",
    tag: "EditorPreview",
    marker: "preview-restore"
  },
  { method: "post", path: "/actions", operationId: "dispatchAction", tag: "RuntimeActions", marker: 'requestUrl.pathname === "/actions"' },
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
    if (resolveJsonPointer(spec, ref) === undefined) {
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
    "AgentTurnRequest",
    "AgentTurnResponse",
    "ContentReloadRequest",
    "ContentReloadResponse",
    "CreateSessionRequest",
    "DispatchActionRequest",
    "ErrorResponse",
    "GameReadinessResponse",
    "HealthResponse",
    "PlayerFacingContent",
    "ReadinessResponse",
    "RestorePreviewSessionRequest",
    "RestorePreviewSessionResponse",
    "SessionResponse",
    "SessionStateVersion"
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
  const schema = spec.components.schemas.DispatchActionRequest;
  if (!Array.isArray(schema.required) || !schema.required.includes("expectedStateVersion")) {
    fail("DispatchActionRequest must require expectedStateVersion");
  }
  const version = schema.properties?.expectedStateVersion;
  if (version?.type !== "integer" || version.minimum !== 0) {
    fail("DispatchActionRequest.expectedStateVersion must be an integer with minimum 0");
  }
  const conflict = spec.paths?.["/actions"]?.post?.responses?.["409"];
  if (conflict?.$ref !== "#/components/responses/Conflict") {
    fail("POST /actions must document the shared 409 Conflict response");
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
  console.log("validate-runtime-api-openapi: OK");
} catch (error) {
  console.error("validate-runtime-api-openapi: failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
