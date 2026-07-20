/** Isolated strict JSON Schema 2020-12 validators for Mechanics publication contracts. */

const fs = require("node:fs");
const path = require("node:path");
const Ajv2020Lib = require("ajv/dist/2020");

const Ajv2020 = Ajv2020Lib.default || Ajv2020Lib;
const repoRoot = path.resolve(__dirname, "..", "..");
const mechanicsSchemaPath = path.join(repoRoot, "docs", "architecture", "schemas", "mechanics-plan.schema.json");
const gameIntentSchemaPath = path.join(repoRoot, "docs", "architecture", "schemas", "game-intent.schema.json");
const operationCatalogSchemaPath = path.join(
  repoRoot,
  "docs",
  "architecture",
  "schemas",
  "mechanics-operation-catalog.schema.json"
);
const mechanicsBootstrapSchemaPath = path.join(
  repoRoot,
  "docs",
  "architecture",
  "schemas",
  "mechanics-bootstrap.schema.json"
);
const MECHANICS_SCHEMA_ID = "https://cubica.platform/schemas/mechanics-plan.v1alpha1.json";
const GAME_INTENT_SCHEMA_ID = "https://cubica.platform/schemas/game-intent.v1.json";
const OPERATION_CATALOG_SCHEMA_ID = "https://cubica.platform/schemas/mechanics-operation-catalog.v1.json";
const MECHANICS_BOOTSTRAP_SCHEMA_ID = "https://cubica.platform/schemas/mechanics-bootstrap.v1.json";

function buildMechanicsAjv2020() {
  return buildStrictAjv2020(mechanicsSchemaPath);
}

/**
 * Build one isolated draft-2020-12 registry.
 *
 * Draft 2020-12 is not backwards compatible with draft-07 in one Ajv
 * instance. Keeping these contracts in dedicated registries prevents an
 * unrelated legacy manifest schema from changing their interpretation.
 */
function buildStrictAjv2020(schemaPath) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    validateSchema: true,
    loadSchema: undefined,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false
  });
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  if (!ajv.validateSchema(schema)) {
    throw new Error(`Invalid JSON Schema ${schemaPath}: ${formatAjvErrors(ajv.errors)}`);
  }
  ajv.addSchema(schema);
  return ajv;
}

let shared;
function getMechanicsAjv2020() {
  if (!shared) shared = buildMechanicsAjv2020();
  return shared;
}

function validateMechanicsSchema(mechanics, ajv = getMechanicsAjv2020()) {
  return validateRegisteredSchema(mechanics, ajv, MECHANICS_SCHEMA_ID);
}

let sharedGameIntent;
function getGameIntentAjv2020() {
  if (!sharedGameIntent) sharedGameIntent = buildStrictAjv2020(gameIntentSchemaPath);
  return sharedGameIntent;
}

/** Validate only the published Game Intent action catalog. */
function validateGameIntentSchema(actions, ajv = getGameIntentAjv2020()) {
  return validateRegisteredSchema(actions, ajv, GAME_INTENT_SCHEMA_ID);
}

let sharedOperationCatalog;
function getOperationCatalogAjv2020() {
  if (!sharedOperationCatalog) sharedOperationCatalog = buildStrictAjv2020(operationCatalogSchemaPath);
  return sharedOperationCatalog;
}

/** Validate the executable-operation catalog before registry construction. */
function validateOperationCatalogSchema(catalog, ajv = getOperationCatalogAjv2020()) {
  return validateRegisteredSchema(catalog, ajv, OPERATION_CATALOG_SCHEMA_ID);
}

let sharedMechanicsBootstrap;
function getMechanicsBootstrapAjv2020() {
  if (!sharedMechanicsBootstrap) sharedMechanicsBootstrap = buildStrictAjv2020(mechanicsBootstrapSchemaPath);
  return sharedMechanicsBootstrap;
}

/**
 * Validate only the inert fields needed to select a versioned full validator.
 *
 * Plans and state intentionally remain opaque at this stage, preventing a
 * historic package from being rejected by the current full schema before its
 * exact registered profile has been selected.
 */
function validateMechanicsBootstrapSchema(manifest, ajv = getMechanicsBootstrapAjv2020()) {
  return validateRegisteredSchema(manifest, ajv, MECHANICS_BOOTSTRAP_SCHEMA_ID);
}

function validateRegisteredSchema(value, ajv, schemaId) {
  const validate = ajv.getSchema(schemaId);
  if (!validate) throw new Error(`JSON Schema is not registered: ${schemaId}`);
  const valid = validate(value);
  return {
    valid: Boolean(valid),
    errors: (validate.errors || []).map((error) => ({
      pointer: error.instancePath || "",
      keyword: error.keyword,
      message: error.message || error.keyword,
      params: error.params || {}
    }))
  };
}

function formatAjvErrors(errors) {
  return (errors || []).map((error) => `${error.instancePath || "/"} ${error.message || error.keyword}`).join("; ");
}

module.exports = {
  GAME_INTENT_SCHEMA_ID,
  MECHANICS_BOOTSTRAP_SCHEMA_ID,
  MECHANICS_SCHEMA_ID,
  OPERATION_CATALOG_SCHEMA_ID,
  buildMechanicsAjv2020,
  buildStrictAjv2020,
  gameIntentSchemaPath,
  getGameIntentAjv2020,
  getMechanicsAjv2020,
  getMechanicsBootstrapAjv2020,
  getOperationCatalogAjv2020,
  mechanicsSchemaPath,
  mechanicsBootstrapSchemaPath,
  operationCatalogSchemaPath,
  validateGameIntentSchema,
  validateMechanicsSchema,
  validateMechanicsBootstrapSchema,
  validateOperationCatalogSchema
};
