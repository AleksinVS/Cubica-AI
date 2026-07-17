/**
 * Validates one action's untrusted parameters and resolves schema-declared
 * resource references. JSON Schema owns the accepted shape; the imperative
 * reference lookup only enforces live-state invariants JSON Schema cannot see.
 */
import Ajv2020Lib from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import type {
  RuntimeManifestActionDefinition,
  RuntimeResolvedReference
} from "@cubica/contracts-runtime";
import { RequestValidationError } from "../errors.ts";

type RuntimeState = Record<string, unknown>;
type JsonRecord = Record<string, unknown>;

type AjvConstructor = new (options?: Record<string, unknown>) => {
  addKeyword: (definition: Record<string, unknown>) => void;
  compile: (schema: unknown) => ValidateFunction;
};
const Ajv2020 = (Ajv2020Lib as unknown as { default?: AjvConstructor }).default ??
  (Ajv2020Lib as unknown as AjvConstructor);
// Parameter schemas are part of the Game Intent 2020-12 contract. Keeping a
// dedicated strict validator prevents accidental mixing with draft-07 manifest
// schemas and rejects every undeclared schema keyword at compilation time.
const ajv = new Ajv2020({ allErrors: true, strict: true });
// `x-cubica-ref` is a schema annotation. Ajv validates its schema when the
// manifest loads; live object existence is checked below against session state.
ajv.addKeyword({ keyword: "x-cubica-ref", schemaType: "object", valid: true });

const validatorCache = new WeakMap<object, ValidateFunction>();
const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const compileValidator = (schema: JsonRecord): ValidateFunction => {
  const cached = validatorCache.get(schema);
  if (cached) {
    return cached;
  }
  const validator = ajv.compile(schema);
  validatorCache.set(schema, validator);
  return validator;
};

const formatValidationErrors = (validator: ValidateFunction): string =>
  (validator.errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");

/** Validate params before role checks and guards, as required by ADR-061. */
export const validateActionParameters = (
  definition: RuntimeManifestActionDefinition,
  inputParams: Record<string, unknown> | undefined
): Record<string, unknown> => {
  const schema = definition.paramsSchema;
  if (!schema) {
    const params = inputParams ?? {};
    // The public command envelope always carries `params`. For older or
    // hand-built definitions that omit paramsSchema, absence means the same
    // strict empty-object schema the compiler now materializes—not that any
    // caller-supplied field is accepted.
    if (Object.keys(params).length > 0) {
      throw new RequestValidationError(`Action "${definition.actionId}" does not accept params`);
    }
    return params;
  }

  const params = inputParams ?? {};
  for (const key of Object.keys(params)) {
    if (forbiddenKeys.has(key)) {
      throw new RequestValidationError(`Action params contain a forbidden property name`);
    }
  }

  const validator = compileValidator(schema);
  if (!validator(params)) {
    throw new RequestValidationError(
      `Action "${definition.actionId}" params failed schema validation: ${formatValidationErrors(validator)}`
    );
  }
  return params;
};

interface ReferenceAnnotation {
  kind: "object" | "action-resource";
  collection: string;
  network?: string;
  allowedTypes?: Array<string>;
  visibility: "public" | "secret";
}

const readReferenceAnnotations = (
  definition: RuntimeManifestActionDefinition
): Array<[string, ReferenceAnnotation]> => {
  const properties = isRecord(definition.paramsSchema?.properties)
    ? definition.paramsSchema.properties
    : {};
  const result: Array<[string, ReferenceAnnotation]> = [];
  for (const [paramName, propertySchema] of Object.entries(properties)) {
    if (!isRecord(propertySchema) || !isRecord(propertySchema["x-cubica-ref"])) {
      continue;
    }
    result.push([paramName, propertySchema["x-cubica-ref"] as unknown as ReferenceAnnotation]);
  }
  return result;
};

/**
 * Validate a bounded subset of action parameters using the action's own JSON
 * Schema declarations.
 *
 * Road preview uses this for endpoint references only: accepting contribution
 * or other action fields here would blur the boundary between a read-only
 * estimate and the later authoritative command. Reusing the declared property
 * schemas also prevents a second, imperative definition of valid references.
 */
export const validateActionReferenceParameterSubset = (
  definition: RuntimeManifestActionDefinition,
  inputParams: Record<string, unknown> | undefined,
  parameterNames: ReadonlyArray<string>,
  options: { requiredVisibility?: "public" | "secret" } = {}
): Record<string, unknown> => {
  const uniqueNames = [...new Set(parameterNames)];
  if (uniqueNames.length !== parameterNames.length || uniqueNames.length === 0) {
    throw new RequestValidationError("Action preview must declare a non-empty set of distinct reference parameters");
  }
  const sourceProperties = isRecord(definition.paramsSchema?.properties)
    ? definition.paramsSchema.properties
    : {};
  const selectedProperties: JsonRecord = {};
  for (const parameterName of uniqueNames) {
    if (forbiddenKeys.has(parameterName)) {
      throw new RequestValidationError("Action preview declares a forbidden reference parameter name");
    }
    const propertySchema = sourceProperties[parameterName];
    const reference = isRecord(propertySchema) && isRecord(propertySchema["x-cubica-ref"])
      ? propertySchema["x-cubica-ref"]
      : undefined;
    if (!reference) {
      throw new RequestValidationError(
        `Action parameter "${parameterName}" is not a schema-declared resource reference`
      );
    }
    if (options.requiredVisibility && reference.visibility !== options.requiredVisibility) {
      throw new RequestValidationError(
        `Action parameter "${parameterName}" is not declared for ${options.requiredVisibility} preview visibility`
      );
    }
    selectedProperties[parameterName] = propertySchema;
  }

  const params = inputParams ?? {};
  for (const key of Object.keys(params)) {
    if (forbiddenKeys.has(key)) {
      throw new RequestValidationError("Action preview params contain a forbidden property name");
    }
  }
  const validator = compileValidator({
    type: "object",
    additionalProperties: false,
    properties: selectedProperties,
    required: uniqueNames
  });
  if (!validator(params)) {
    throw new RequestValidationError(
      `Action "${definition.actionId}" preview params failed schema validation: ${formatValidationErrors(validator)}`
    );
  }
  return params;
};

const resolveReferenceRecord = (
  state: RuntimeState,
  annotation: ReferenceAnnotation,
  id: string
): JsonRecord | undefined => {
  const rawVisibilityRoot = state[annotation.visibility];
  const visibilityRoot: JsonRecord = isRecord(rawVisibilityRoot) ? rawVisibilityRoot : {};
  const registryRoot = annotation.kind === "object"
    ? (isRecord(visibilityRoot.objects) ? visibilityRoot.objects : {})
    : (isRecord(visibilityRoot.actionResources) ? visibilityRoot.actionResources : {});
  const rawCollection = registryRoot[annotation.collection];
  const collection: JsonRecord = isRecord(rawCollection) ? rawCollection : {};
  const resource = collection[id];
  return isRecord(resource) ? resource : undefined;
};

/**
 * Resolve opaque ids only inside the collection declared by `x-cubica-ref`.
 * Error messages deliberately do not distinguish missing, secret, wrong-type,
 * or wrong-network resources, which avoids leaking closed state.
 */
export const resolveActionReferences = (
  definition: RuntimeManifestActionDefinition,
  params: Record<string, unknown>,
  state: RuntimeState,
  onlyParameterNames?: ReadonlyArray<string>
): Record<string, RuntimeResolvedReference> => {
  const resolved: Record<string, RuntimeResolvedReference> = {};
  const selectedNames = onlyParameterNames ? new Set(onlyParameterNames) : undefined;
  for (const [paramName, annotation] of readReferenceAnnotations(definition)) {
    if (selectedNames && !selectedNames.has(paramName)) {
      continue;
    }
    const rawId = params[paramName];
    const id = typeof rawId === "string" ? rawId : undefined;
    const resource = id === undefined ? undefined : resolveReferenceRecord(state, annotation, id);
    const objectType = typeof resource?.objectType === "string" ? resource.objectType : undefined;
    const attributes = isRecord(resource?.attributes) ? resource.attributes : {};
    const allowedType = annotation.allowedTypes === undefined ||
      (objectType !== undefined && annotation.allowedTypes.includes(objectType));
    const allowedNetwork = annotation.network === undefined || attributes.networkId === annotation.network;

    if (id === undefined || !resource || !allowedType || !allowedNetwork) {
      throw new RequestValidationError(`Action parameter "${paramName}" does not reference an available resource`);
    }

    resolved[paramName] = {
      paramName,
      id,
      kind: annotation.kind,
      collection: annotation.collection,
      visibility: annotation.visibility,
      network: annotation.network,
      objectType
    };
  }
  return resolved;
};
