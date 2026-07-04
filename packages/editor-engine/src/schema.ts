/**
 * JSON Schema validation and semantic diagnostics.
 *
 * Structural validation is delegated to Ajv, a standards-based JSON Schema
 * validator, so JSON Schema stays the single source of truth for manifest shape
 * (ADR-025) — this module never re-implements schema shape checks by hand. On
 * top of schema validation it adds a few authoring-specific semantic checks
 * (duplicate collection ids, unresolved local `$ref`s, missing `_label` on
 * tree-visible entities) that a JSON Schema cannot express.
 */
import AjvModule, { type AnySchema, type ErrorObject, type Options as AjvOptions } from "ajv";
import addFormatsModule from "ajv-formats";
import { isPlainJsonObject, makeDiagnostic } from "./shared.ts";
import { appendPointerSegment, localReferenceToPointer, readJsonPointer } from "./json-pointer-patch.ts";
import { isTreeVisibleSemanticEntity } from "./semantics.ts";
import type {
  DiagnosticSource,
  DocumentDiagnostic,
  DocumentSnapshot,
  JsonObject,
  JsonValue,
  SchemaRegistry,
  SchemaRegistryOptions,
  TextLocationMap,
  ValidateDocumentOptions,
  ValidateJsonValueOptions
} from "./types.ts";

// Minimal structural view of the Ajv surface the registry actually uses. Keeping
// it local avoids leaking Ajv-specific types into the public editor contracts.
type AjvValidationFunction = {
  (data: unknown): boolean | Promise<unknown>;
  readonly errors?: readonly ErrorObject[] | null;
};

interface LocalAjvInstance {
  removeSchema(schemaKeyRef?: string | RegExp | AnySchema): LocalAjvInstance;
  addSchema(schema: AnySchema, key?: string): LocalAjvInstance;
  getSchema(keyRef: string): AjvValidationFunction | undefined;
}

type LocalAjvConstructor = new (options?: AjvOptions) => LocalAjvInstance;

/**
 * Creates a local JSON Schema registry.
 *
 * Ajv performs the standards-based structural validation. The registry does
 * not configure remote schema loading, which keeps authoring validation
 * deterministic and tied to schemas explicitly registered by the caller.
 */
export function createSchemaRegistry(options: SchemaRegistryOptions = {}): SchemaRegistry {
  const AjvConstructor =
    (AjvModule as unknown as { readonly default?: LocalAjvConstructor }).default ??
    (AjvModule as unknown as LocalAjvConstructor);
  // Strict Ajv mode keeps JSON Schema the single source of truth (ADR-025):
  // unknown keywords/formats and malformed schemas fail fast instead of being
  // silently ignored. allowUnionTypes accepts valid `type: [...]` unions (e.g.
  // ui-manifest uiStyle.width). Callers may still override via ajvOptions, but
  // the strict default means editor-registered schemas are validated the same
  // way as the runtime/contract validators. ajv-formats is registered below so
  // standard formats (uri, date-time, ...) are recognised under strict mode.
  // strictRequired is disabled because the manifest/authoring schemas the editor
  // registers use standard declarative idioms — conditional `then: {required}`,
  // "at least one of" (`anyOf` of `{required:[x]}`) and "must be absent"
  // (`not: {required:[x]}`) — where the property is defined at the parent level
  // or intentionally forbidden and cannot be re-listed locally. `required` is
  // still fully enforced; only the authoring lint is relaxed. Documented bounded
  // exception in LEGACY-0016.
  const ajv = new AjvConstructor({
    allErrors: true,
    strict: true,
    allowUnionTypes: true,
    strictRequired: false,
    ...options.ajvOptions
  });
  const addFormats =
    (addFormatsModule as unknown as { readonly default?: (instance: LocalAjvInstance) => void }).default ??
    (addFormatsModule as unknown as (instance: LocalAjvInstance) => void);
  addFormats(ajv);
  const registered = new Set<string>();

  return {
    registerSchema(schemaId, schema) {
      ajv.removeSchema(schemaId);
      ajv.addSchema(schema, schemaId);
      registered.add(schemaId);
    },
    hasSchema(schemaId) {
      return registered.has(schemaId) || ajv.getSchema(schemaId) !== undefined;
    },
    validateValue(input) {
      const validate = ajv.getSchema(input.schemaId);
      if (validate === undefined) {
        return [
          makeDiagnostic({
            source: "schema",
            pointer: "",
            message: `Schema is not registered: ${input.schemaId}`
          })
        ];
      }

      const valid = validate(input.value);
      if (valid instanceof Promise) {
        return [
          makeDiagnostic({
            source: "schema",
            pointer: "",
            message: `Async schema validation is not supported by the local editor registry: ${input.schemaId}`
          })
        ];
      }

      if (valid) {
        return [];
      }

      return [...(validate.errors ?? [])].map((error: ErrorObject) =>
        diagnosticFromAjvError(error, input.schemaId, input.locationMap, input.source ?? "schema")
      );
    },
    validateDocument(snapshot, schemaId) {
      if (snapshot.json === undefined) {
        return snapshot.diagnostics;
      }

      return this.validateValue({
        schemaId,
        value: snapshot.json,
        locationMap: snapshot.locationMap
      });
    }
  };
}

/** Runs syntax, optional schema, and optional semantic validation for a snapshot. */
export function validateDocument(
  snapshot: DocumentSnapshot,
  options: ValidateDocumentOptions = {}
): readonly DocumentDiagnostic[] {
  const diagnostics: DocumentDiagnostic[] = [...snapshot.diagnostics];

  if (snapshot.json === undefined) {
    return diagnostics;
  }

  if (options.schemaRegistry !== undefined && options.schemaId !== undefined) {
    diagnostics.push(...options.schemaRegistry.validateDocument(snapshot, options.schemaId));
  }

  if (options.includeSemanticDiagnostics ?? true) {
    diagnostics.push(...collectSemanticDiagnostics(snapshot.json, snapshot.locationMap));
  }

  return diagnostics;
}

/** Validates a parsed JSON value without requiring a DocumentStore. */
export function validateJsonValue(
  value: JsonValue,
  options: ValidateJsonValueOptions = {}
): readonly DocumentDiagnostic[] {
  const diagnostics: DocumentDiagnostic[] = [];

  if (options.schemaRegistry !== undefined && options.schemaId !== undefined) {
    diagnostics.push(
      ...options.schemaRegistry.validateValue({
        schemaId: options.schemaId,
        value,
        locationMap: options.locationMap
      })
    );
  }

  if (options.includeSemanticDiagnostics ?? true) {
    diagnostics.push(...collectSemanticDiagnostics(value, options.locationMap));
  }

  return diagnostics;
}

function collectSemanticDiagnostics(
  root: JsonValue,
  locationMap: TextLocationMap | undefined
): readonly DocumentDiagnostic[] {
  const diagnostics: DocumentDiagnostic[] = [];

  const visit = (value: JsonValue, pointer: string): void => {
    if (Array.isArray(value)) {
      checkArrayCollectionIds(value, pointer, diagnostics, locationMap);
      value.forEach((item, index) => {
        visit(item, appendPointerSegment(pointer, String(index)));
      });
      return;
    }

    if (!isPlainJsonObject(value)) {
      return;
    }

    checkObjectCollectionIds(value, pointer, diagnostics, locationMap);

    if (typeof value.$ref === "string") {
      const refPointer = localReferenceToPointer(value.$ref);
      if (refPointer !== undefined && readJsonPointer(root, refPointer) === undefined) {
        const diagnosticPointer = appendPointerSegment(pointer, "$ref");
        diagnostics.push(
          makeDiagnostic({
            source: "semantic",
            pointer: diagnosticPointer,
            message: `Local reference does not resolve: ${value.$ref}`,
            range: locationMap?.get(diagnosticPointer)
          })
        );
      }
    }

    if (isTreeVisibleSemanticEntity(value, pointer)) {
      const label = value._label;
      if (typeof label !== "string" || label.trim() === "") {
        const diagnosticPointer = appendPointerSegment(pointer, "_label");
        diagnostics.push(
          makeDiagnostic({
            source: "semantic",
            pointer: diagnosticPointer,
            message: `Tree-visible semantic entity must define a non-empty _label.`,
            range: locationMap?.get(diagnosticPointer)
          })
        );
      }
    }

    for (const [key, child] of Object.entries(value)) {
      visit(child, appendPointerSegment(pointer, key));
    }
  };

  visit(root, "");
  return diagnostics;
}

function checkArrayCollectionIds(
  value: readonly JsonValue[],
  pointer: string,
  diagnostics: DocumentDiagnostic[],
  locationMap: TextLocationMap | undefined
): void {
  const seen = new Map<string, string>();

  value.forEach((item, index) => {
    if (!isPlainJsonObject(item) || typeof item.id !== "string") {
      return;
    }

    const itemPointer = appendPointerSegment(pointer, String(index));
    const idPointer = appendPointerSegment(itemPointer, "id");
    addDuplicateIdDiagnostic(item.id, idPointer, seen, diagnostics, locationMap);
  });
}

function checkObjectCollectionIds(
  value: JsonObject,
  pointer: string,
  diagnostics: DocumentDiagnostic[],
  locationMap: TextLocationMap | undefined
): void {
  const seen = new Map<string, string>();

  for (const [key, child] of Object.entries(value)) {
    if (!isPlainJsonObject(child) || typeof child.id !== "string") {
      continue;
    }

    const idPointer = appendPointerSegment(appendPointerSegment(pointer, key), "id");
    addDuplicateIdDiagnostic(child.id, idPointer, seen, diagnostics, locationMap);
  }
}

function addDuplicateIdDiagnostic(
  id: string,
  idPointer: string,
  seen: Map<string, string>,
  diagnostics: DocumentDiagnostic[],
  locationMap: TextLocationMap | undefined
): void {
  const firstPointer = seen.get(id);
  if (firstPointer === undefined) {
    seen.set(id, idPointer);
    return;
  }

  diagnostics.push(
    makeDiagnostic({
      source: "semantic",
      pointer: idPointer,
      message: `Duplicate id "${id}" in the same collection. First occurrence: ${firstPointer}.`,
      range: locationMap?.get(idPointer)
    })
  );
}

function diagnosticFromAjvError(
  error: ErrorObject,
  schemaId: string,
  locationMap: TextLocationMap | undefined,
  source: DiagnosticSource
): DocumentDiagnostic {
  const pointer = pointerFromAjvError(error);
  return makeDiagnostic({
    source,
    pointer,
    message: `${schemaId}: ${error.message ?? error.keyword}`,
    range: locationMap?.get(pointer)
  });
}

function pointerFromAjvError(error: ErrorObject): string {
  if (error.keyword === "required" && typeof error.params.missingProperty === "string") {
    return appendPointerSegment(error.instancePath, error.params.missingProperty);
  }

  if (error.keyword === "additionalProperties" && typeof error.params.additionalProperty === "string") {
    return appendPointerSegment(error.instancePath, error.params.additionalProperty);
  }

  if (error.keyword === "propertyNames" && typeof error.propertyName === "string") {
    return appendPointerSegment(error.instancePath, error.propertyName);
  }

  return error.instancePath || "";
}
