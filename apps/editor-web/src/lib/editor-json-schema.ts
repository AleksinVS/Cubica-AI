/**
 * Local JSON schema registry for editor-web.
 *
 * These schemas are imported from the canonical architecture contracts and
 * registered in Monaco and @cubica/editor-engine. Remote schema loading stays
 * disabled so diagnostics are deterministic and do not depend on network state.
 */
import { createSchemaRegistry, type JsonSchema, type JsonValue, type SchemaRegistry } from "@cubica/editor-engine";

import gameAuthoringSchemaV2 from "../../../../docs/architecture/schemas/game-authoring-v2.schema.json";
import manifestAuthoringCommonSchema from "../../../../docs/architecture/schemas/manifest-authoring-common.schema.json";
import uiAuthoringSchemaV2 from "../../../../docs/architecture/schemas/ui-authoring-v2.schema.json";

export const gameAuthoringSchemaId = "https://cubica.platform/schemas/game-authoring.v2.json";
export const uiAuthoringSchemaId = "https://cubica.platform/schemas/ui-authoring.v2.json";
export const manifestAuthoringCommonSchemaId = "https://cubica.platform/schemas/manifest-authoring-common.schema.json";

export interface LocalAuthoringSchema {
  readonly uri: string;
  readonly schema: JsonSchema;
}

export const localAuthoringSchemas: readonly LocalAuthoringSchema[] = [
  { uri: manifestAuthoringCommonSchemaId, schema: manifestAuthoringCommonSchema as JsonSchema },
  { uri: gameAuthoringSchemaId, schema: gameAuthoringSchemaV2 as JsonSchema },
  { uri: uiAuthoringSchemaId, schema: uiAuthoringSchemaV2 as JsonSchema }
];

export function registerLocalAuthoringSchemas(registry: SchemaRegistry): void {
  for (const item of localAuthoringSchemas) {
    registry.registerSchema(item.uri, item.schema);
  }
}

// Process-wide reused registry for authoring validation. Building the registry
// and compiling its Ajv validators costs ~137 ms (profiling-baseline §2.1), so a
// fresh registry per request wasted that on every keystroke. The registry is
// registered once and only ever read afterwards (validateDocument does not
// re-register), so reuse across requests is safe.
let sharedAuthoringSchemaRegistry: SchemaRegistry | undefined;

/** Returns a shared authoring schema registry, building it once per process. */
export function getSharedAuthoringSchemaRegistry(): SchemaRegistry {
  if (sharedAuthoringSchemaRegistry === undefined) {
    const registry = createSchemaRegistry();
    registerLocalAuthoringSchemas(registry);
    sharedAuthoringSchemaRegistry = registry;
  }
  return sharedAuthoringSchemaRegistry;
}

export function schemaIdForAuthoringDocument(filePath: string, json: JsonValue | undefined): string | undefined {
  if (isJsonObject(json)) {
    if (json._manifestType === "ui") {
      return uiAuthoringSchemaId;
    }

    if (json._manifestType === "game") {
      return gameAuthoringSchemaId;
    }
  }

  return filePath.includes("/ui/") || filePath.startsWith("ui/") ? uiAuthoringSchemaId : gameAuthoringSchemaId;
}

function isJsonObject(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
