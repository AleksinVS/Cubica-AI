import AjvLib from "ajv";
import addFormatsLib from "ajv-formats";
import ajvErrorsLib from "ajv-errors";
import fs from "fs";
import { createRequire } from "node:module";
import path from "path";
import { fileURLToPath } from "url";
import type { GameManifest, GameManifestTransportNetworkModel } from "@cubica/contracts-manifest";
import { ManifestValidationError } from "../errors.ts";
import { compileRegionRoadPlanning } from "../runtime/regionRoadPlanner.ts";

const Ajv = (AjvLib as any).default || AjvLib;
const addFormats = (addFormatsLib as any).default || addFormatsLib;
const ajvErrors = (ajvErrorsLib as any).default || ajvErrorsLib;
const require = createRequire(import.meta.url);
const {
  validateGameIntentSchema,
  validateMechanicsBootstrapSchema,
  validateMechanicsSchema
} = require("../../../../../scripts/manifest-tools/mechanics-validator.cjs") as {
  validateGameIntentSchema: (value: unknown) => { valid: boolean; errors: Array<{ pointer: string; message: string }> };
  validateMechanicsBootstrapSchema: (value: unknown) => {
    valid: boolean;
    errors: Array<{ pointer: string; message: string }>;
  };
  validateMechanicsSchema: (value: unknown) => { valid: boolean; errors: Array<{ pointer: string; message: string }> };
};
const { MECHANICS_ARTIFACT_REGISTRY } = require("../../../../../scripts/manifest-tools/mechanics-modules.cjs") as {
  MECHANICS_ARTIFACT_REGISTRY: {
    resolveSet: (moduleLock: unknown) =>
      | {
          state: "available";
          validationProfileId: string;
          executorProfileId: string;
          modules: Map<string, unknown>;
        }
      | {
          state: "blocked" | "missing";
          alias?: string;
          reason: string;
          identity?: { moduleId?: unknown };
        };
  };
};
const {
  checkMechanicsBundle,
  turnSessionInitializationForManifest
} = require("../../../../../scripts/manifest-tools/mechanics-checker.cjs") as {
  checkMechanicsBundle: (value: unknown, options: {
    actions: unknown;
    initialState: unknown;
    turnSessionInitialization?: {
      minimumPlayers: unknown;
      maximumPlayers: unknown;
      phases: unknown[];
    };
    objectModels: unknown;
    networkModels: unknown;
  }) => unknown;
  turnSessionInitializationForManifest: (manifest: unknown) => {
    minimumPlayers: unknown;
    maximumPlayers: unknown;
    phases: unknown[];
  } | undefined;
};

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
//    `anyOf: [{required:[a]}, {required:[b]}, ...]` and "must be absent" via
//    `not: {required:["card"]}`. The
//    property is defined at the parent level (or intentionally forbidden), so it
//    cannot be re-listed locally. strictRequired is only an authoring lint; the
//    `required` constraint is still fully enforced, so data validation is NOT
//    weakened. Documented bounded exception in LEGACY-0016.
const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true, strictRequired: false });
addFormats(ajv);
ajvErrors(ajv);

const validate = ajv.compile(gameManifestSchema);
const CURRENT_MECHANICS_API_VERSION = "cubica.dev/mechanics/v1alpha1";
const CURRENT_MECHANICS_VALIDATION_PROFILE = "mechanics-v1alpha1-current";

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
      ["movement", "coupledCollection", "coupledObjectTypes"]
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
        const networkCollections = new Set([
          network?.nodeCollection,
          network?.edgeCollection,
          movement?.vehicleCollection,
          movement?.capacityCollection,
          movement?.coupledCollection
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

  }
};

export function validateGameManifest(manifest: unknown): GameManifest {
  // The bootstrap contract is deliberately checked before the current full
  // manifest schema. It reads no plan or state content; it only establishes
  // which trusted, exact validator/executor profile is allowed to inspect the
  // remainder of this package.
  const bootstrap = validateMechanicsBootstrapSchema(manifest);
  if (!bootstrap.valid) {
    throw new ManifestValidationError(
      `Mechanics bootstrap validation failed: ${bootstrap.errors
        .map((error) => `${error.pointer || "/"} ${error.message}`)
        .join("; ")}`
    );
  }
  const bootstrapManifest = manifest as {
    mechanics: {
      apiVersion: string;
      moduleLock: Record<string, unknown>;
    };
  };
  const selected = MECHANICS_ARTIFACT_REGISTRY.resolveSet(bootstrapManifest.mechanics.moduleLock);
  if (selected.state !== "available") {
    const moduleLabel = selected.identity?.moduleId ? ` for module "${String(selected.identity.moduleId)}"` : "";
    throw new ManifestValidationError(
      `Mechanics executor ${selected.state}${moduleLabel}: ${selected.reason}`
    );
  }
  if (
    bootstrapManifest.mechanics.apiVersion !== CURRENT_MECHANICS_API_VERSION ||
    selected.validationProfileId !== CURRENT_MECHANICS_VALIDATION_PROFILE
  ) {
    throw new ManifestValidationError(
      `Mechanics validation profile is not installed for apiVersion "${bootstrapManifest.mechanics.apiVersion}"`
    );
  }

  const isValid = validate(manifest);
  if (!isValid) {
    const errors = validate.errors
      ?.map((e: any) => `${e.instancePath} ${e.message}`)
      .join(", ");
    throw new ManifestValidationError(`Schema validation failed: ${errors}`);
  }

  const m = manifest as Record<string, unknown>;
  const gameIntentValidation = validateGameIntentSchema(m.actions);
  if (!gameIntentValidation.valid) {
    throw new ManifestValidationError(
      `Game Intent schema validation failed: ${gameIntentValidation.errors
        .map((error) => `${error.pointer || "/"} ${error.message}`)
        .join("; ")}`
    );
  }
  const mechanicsValidation = validateMechanicsSchema(m.mechanics);
  if (!mechanicsValidation.valid) {
    throw new ManifestValidationError(
      `Mechanics schema validation failed: ${mechanicsValidation.errors
        .map((error) => `${error.pointer || "/"} ${error.message}`)
        .join("; ")}`
    );
  }
  try {
    checkMechanicsBundle(m.mechanics, {
      actions: m.actions,
      initialState: m.state,
      // Keep runtime loading in exact parity with authoring compilation:
      // concrete participants and strict public turn fields do not exist in
      // the reusable template and are materialized before session persistence.
      turnSessionInitialization: turnSessionInitializationForManifest(m),
      objectModels: m.objectModels ?? {},
      networkModels: m.networkModels ?? {}
    });
  } catch (error) {
    throw new ManifestValidationError(
      `Mechanics semantic validation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  validateSemanticReferences(m);

  return manifest as GameManifest;
}
