import AjvLib from "ajv";
import addFormatsLib from "ajv-formats";
import ajvErrorsLib from "ajv-errors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { GameManifest, GameManifestTransportNetworkModel } from "@cubica/contracts-manifest";
import { ManifestValidationError } from "../errors.ts";
import { compileRegionRoadPlanning } from "../runtime/regionRoadPlanner.ts";

const Ajv = (AjvLib as any).default || AjvLib;
const addFormats = (addFormatsLib as any).default || addFormatsLib;
const ajvErrors = (ajvErrorsLib as any).default || ajvErrorsLib;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Construct path to the schema document. Since runtime-api runs from services/runtime-api, we need to go up.
// Or we can assume it's bundled. For now, we will read it from the repository relative path during development.
const schemaPath = path.resolve(__dirname, "../../../../../docs/architecture/schemas/game-manifest.schema.json");
const schemaSource = fs.readFileSync(schemaPath, "utf8");
const gameManifestSchema = JSON.parse(schemaSource);

// Strict Ajv mode keeps JSON Schema the single source of truth (ADR-025):
// unknown keywords, malformed schemas and unknown formats fail fast instead of
// being silently ignored. Two principled relaxations are applied because the
// canonical schemas legitimately need them, not to hide defects:
//  - allowUnionTypes: schemas use `type: ["string", "number"]`-style unions
//    (e.g. ui-manifest uiStyle.width), which are valid JSON Schema.
//  - ajv-formats: registers standard formats (uri, date-time, ...) so `format`
//    keywords are recognised under strict mode rather than rejected as unknown.
//  - strictRequired: false — game-manifest.schema.json uses standard declarative
//    idioms where a `required` keyword sits in a subschema that does not itself
//    list the property in `properties`: "at least one of" via
//    `anyOf: [{required:[a]}, {required:[b]}, ...]` (timeline.set effect) and
//    "must be absent" via `not: {required:["card"]}` (legacy guard removal). The
//    property is defined at the parent level (or intentionally forbidden), so it
//    cannot be re-listed locally. strictRequired is only an authoring lint; the
//    `required` constraint is still fully enforced, so data validation is NOT
//    weakened. Documented bounded exception in LEGACY-0016.
const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true, strictRequired: false });
addFormats(ajv);
ajvErrors(ajv);

const validate = ajv.compile(gameManifestSchema);

type JsonRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Cross-key checks complement JSON Schema only where draft-07 cannot express
 * that a declared id must name a sibling map entry. Shape validation remains
 * exclusively owned by the canonical schema above.
 */
const validateSemanticReferences = (manifest: JsonRecord) => {
  const objectModels = isRecord(manifest.objectModels) ? manifest.objectModels : {};
  const networkModels = isRecord(manifest.networkModels) ? manifest.networkModels : {};
  for (const [networkId, rawNetwork] of Object.entries(networkModels)) {
    const network = rawNetwork as JsonRecord;
    if (network.roadPlanning !== undefined) {
      try {
        // JSON Schema owns the declared shape. This companion check verifies
        // the cross-field invariant that compiler-derived portals and hash
        // exactly match the sibling region polygons.
        compileRegionRoadPlanning(network as unknown as GameManifestTransportNetworkModel);
      } catch (error) {
        throw new ManifestValidationError(
          `Network "${networkId}" has invalid road-planning geometry: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
    for (const [field, collectionField] of [
      ["waypointObjectType", "nodeCollection"],
      ["edgeObjectType", "edgeCollection"]
    ] as const) {
      const objectType = network[field];
      const model = typeof objectType === "string" && isRecord(objectModels[objectType])
        ? objectModels[objectType]
        : undefined;
      if (!model || model.collection !== network[collectionField]) {
        throw new ManifestValidationError(
          `Network "${networkId}" ${field} must reference an object model in ${String(network[collectionField])}`
        );
      }
    }
    for (const [configField, collectionField, objectTypesField] of [
      ["movement", "vehicleCollection", "vehicleObjectTypes"],
      ["movement", "capacityCollection", "capacityObjectTypes"],
      ["movement", "coupledCollection", "coupledObjectTypes"],
      ["cargoDelivery", "wagonCollection", "wagonObjectTypes"],
      ["cargoDelivery", "cargoCollection", "cargoObjectTypes"]
    ] as const) {
      const config = isRecord(network[configField]) ? network[configField] as JsonRecord : undefined;
      if (!config) continue;
      const collection = config[collectionField];
      const objectTypes = config[objectTypesField];
      if (typeof collection !== "string" || !Array.isArray(objectTypes)) continue;
      for (const objectType of objectTypes) {
        const objectModel = typeof objectType === "string" && isRecord(objectModels[objectType])
          ? objectModels[objectType] as JsonRecord
          : undefined;
        if (!objectModel || objectModel.collection !== collection) {
          throw new ManifestValidationError(
            `Network "${networkId}" ${configField}.${objectTypesField} must reference object models in ${collection}`
          );
        }
      }
    }
  }

  const actions = isRecord(manifest.actions) ? manifest.actions : {};
  for (const [actionId, rawAction] of Object.entries(actions)) {
    if (!isRecord(rawAction)) continue;
    const paramsSchema = isRecord(rawAction.paramsSchema) ? rawAction.paramsSchema : {};
    const properties = isRecord(paramsSchema.properties) ? paramsSchema.properties : {};
    for (const [paramName, rawProperty] of Object.entries(properties)) {
      if (!isRecord(rawProperty) || !isRecord(rawProperty["x-cubica-ref"])) continue;
      const ref = rawProperty["x-cubica-ref"] as JsonRecord;
      if (typeof ref.network === "string") {
        const network = isRecord(networkModels[ref.network]) ? networkModels[ref.network] as JsonRecord : undefined;
        const movement = network && isRecord(network.movement) ? network.movement as JsonRecord : undefined;
        const cargoDelivery = network && isRecord(network.cargoDelivery)
          ? network.cargoDelivery as JsonRecord
          : undefined;
        const networkCollections = new Set([
          network?.nodeCollection,
          network?.edgeCollection,
          movement?.vehicleCollection,
          movement?.capacityCollection,
          movement?.coupledCollection,
          cargoDelivery?.wagonCollection,
          cargoDelivery?.cargoCollection
        ].filter((value): value is string => typeof value === "string"));
        if (!network || ref.visibility !== network.visibility || !networkCollections.has(String(ref.collection))) {
          throw new ManifestValidationError(
            `Action "${actionId}" param "${paramName}" references an unknown network collection`
          );
        }
      }
      if (ref.kind === "object" && Array.isArray(ref.allowedTypes)) {
        for (const objectType of ref.allowedTypes) {
          const model = typeof objectType === "string" && isRecord(objectModels[objectType])
            ? objectModels[objectType] as JsonRecord
            : undefined;
          if (!model || model.collection !== ref.collection) {
            throw new ManifestValidationError(
              `Action "${actionId}" param "${paramName}" allows an object type outside its collection`
            );
          }
        }
      }
    }

    const deterministic = isRecord(rawAction.deterministic) ? rawAction.deterministic : {};
    const effects = Array.isArray(deterministic.effects) ? deterministic.effects : [];
    for (const rawEffect of effects) {
      if (!isRecord(rawEffect) || ![
        "transport.road.build",
        "transport.waypoint.build",
        "transport.construction.activateDue",
        "transport.vehicle.move",
        "transport.cargo.deliver"
      ].includes(String(rawEffect.op))) continue;
      const network = typeof rawEffect.networkId === "string" && isRecord(networkModels[rawEffect.networkId])
        ? networkModels[rawEffect.networkId] as JsonRecord
        : undefined;
      if (!network) {
        throw new ManifestValidationError(`Action "${actionId}" references an unknown transport network`);
      }
      const movement = isRecord(network.movement) ? network.movement as JsonRecord : undefined;
      const cargoDelivery = isRecord(network.cargoDelivery) ? network.cargoDelivery as JsonRecord : undefined;
      const referenceParams = rawEffect.op === "transport.road.build"
        ? [[rawEffect.fromNodeParam, network.nodeCollection], [rawEffect.toNodeParam, network.nodeCollection]]
        : rawEffect.op === "transport.waypoint.build"
          ? [[rawEffect.edgeParam, network.edgeCollection]]
          : rawEffect.op === "transport.construction.activateDue"
            ? []
          : rawEffect.op === "transport.vehicle.move"
            ? [[rawEffect.vehicleParam, movement?.vehicleCollection], [rawEffect.edgeParam, network.edgeCollection]]
            : [[rawEffect.wagonParam, cargoDelivery?.wagonCollection], [rawEffect.cargoParam, cargoDelivery?.cargoCollection]];
      for (const [rawParamName, expectedCollection] of referenceParams) {
        const property = typeof rawParamName === "string" && isRecord(properties[rawParamName])
          ? properties[rawParamName] as JsonRecord
          : undefined;
        const ref = property && isRecord(property["x-cubica-ref"])
          ? property["x-cubica-ref"] as JsonRecord
          : undefined;
        if (!ref || ref.network !== rawEffect.networkId || ref.collection !== expectedCollection) {
          throw new ManifestValidationError(
            `Action "${actionId}" transport effect must use a matching x-cubica-ref parameter`
          );
        }
      }
    }
  }
};

export function validateGameManifest(manifest: unknown): GameManifest {
  const isValid = validate(manifest);
  if (!isValid) {
    const errors = validate.errors
      ?.map((e: any) => `${e.instancePath} ${e.message}`)
      .join(", ");
    throw new ManifestValidationError(`Schema validation failed: ${errors}`);
  }

  // Intentional imperative companion check (bounded exception, LEGACY-0016):
  // "an action's templateId must equal a key of the manifest `templates` object"
  // is a cross-key existence constraint. JSON Schema has no clean, standard way
  // to assert that a string value matches a *key* of a sibling object, so this
  // stays as an imperative check next to (not instead of) schema validation.
  // It never re-implements schema shape checks, so ADR-025 (schema as SSOT) holds.
  //
  // Cross-validate templateId references: every action referencing a template
  // must point to a template that actually exists in the manifest.
  const m = manifest as Record<string, unknown>;
  if (m.templates && typeof m.templates === "object" && m.actions && typeof m.actions === "object") {
    const templates = m.templates as Record<string, unknown>;
    const actions = m.actions as Record<string, unknown>;
    for (const [actionId, action] of Object.entries(actions)) {
      if (action && typeof action === "object" && !Array.isArray(action)) {
        const templateId = (action as Record<string, unknown>).templateId;
        if (typeof templateId === "string" && !(templateId in templates)) {
          throw new ManifestValidationError(
            `Action "${actionId}" references non-existent template "${templateId}"`
          );
        }
      }
    }
  }

  validateSemanticReferences(m);

  return manifest as GameManifest;
}
