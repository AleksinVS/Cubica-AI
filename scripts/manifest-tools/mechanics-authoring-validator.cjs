/**
 * Strict JSON Schema 2020-12 validation for authoring-only Mechanics input.
 *
 * Runtime Mechanics and its authoring layer deliberately share one Ajv 2020
 * instance here: authoring references the canonical runtime `$defs` for every
 * value that survives lowering. The ordinary manifest compiler remains on its
 * separate draft-07 instance because Ajv cannot mix those dialects safely.
 */

const fs = require("node:fs");
const path = require("node:path");
const Ajv2020Lib = require("ajv/dist/2020");

const Ajv2020 = Ajv2020Lib.default || Ajv2020Lib;
const repoRoot = path.resolve(__dirname, "..", "..");
const mechanicsSchemaPath = path.join(repoRoot, "docs", "architecture", "schemas", "mechanics-plan.schema.json");
const mechanicsAuthoringSchemaPath = path.join(repoRoot, "docs", "architecture", "schemas", "mechanics-authoring.schema.json");
const MECHANICS_SCHEMA_ID = "https://cubica.platform/schemas/mechanics-plan.v1alpha1.json";
const MECHANICS_AUTHORING_SCHEMA_ID = "https://cubica.platform/schemas/mechanics-authoring.v1alpha1.json";

const MACRO_INPUT_SCHEMA_REFS = Object.freeze({
  identifier: `${MECHANICS_SCHEMA_ID}#/$defs/identifier`,
  "value-expression": `${MECHANICS_SCHEMA_ID}#/$defs/valueExpression`,
  "state-ref": `${MECHANICS_SCHEMA_ID}#/$defs/stateRef`,
  json: `${MECHANICS_SCHEMA_ID}#/$defs/jsonValue`
});

function buildMechanicsAuthoringAjv2020() {
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
  ajv.addSchema(JSON.parse(fs.readFileSync(mechanicsSchemaPath, "utf8")));
  ajv.addSchema(JSON.parse(fs.readFileSync(mechanicsAuthoringSchemaPath, "utf8")));
  return ajv;
}

let shared;
function getMechanicsAuthoringAjv2020() {
  if (!shared) shared = buildMechanicsAuthoringAjv2020();
  return shared;
}

function normalizedErrors(validate) {
  return (validate.errors || []).map((error) => ({
    pointer: error.instancePath || "",
    keyword: error.keyword,
    message: error.message || error.keyword,
    params: error.params || {}
  }));
}

/** Validate the complete pre-lowering authoring tree. */
function validateMechanicsAuthoringSchema(mechanics, ajv = getMechanicsAuthoringAjv2020()) {
  const validate = ajv.getSchema(MECHANICS_AUTHORING_SCHEMA_ID);
  if (!validate) throw new Error(`Mechanics authoring schema is not registered: ${MECHANICS_AUTHORING_SCHEMA_ID}`);
  const valid = validate(mechanics);
  return { valid: Boolean(valid), errors: normalizedErrors(validate) };
}

/**
 * Validate one supplied macro argument against the canonical runtime `$def`
 * selected by its declaration. Keeping these validators schema-backed avoids
 * a second, imperative interpretation of identifier/expression/state shapes.
 */
function validateMacroInput(kind, value, ajv = getMechanicsAuthoringAjv2020()) {
  const schemaRef = MACRO_INPUT_SCHEMA_REFS[kind];
  if (!schemaRef) throw new Error(`Unknown Mechanics macro input kind "${String(kind)}"`);
  const validate = ajv.getSchema(schemaRef);
  if (!validate) throw new Error(`Mechanics macro input schema is not registered: ${schemaRef}`);
  const valid = validate(value);
  return { valid: Boolean(valid), errors: normalizedErrors(validate), schemaRef };
}

module.exports = {
  MACRO_INPUT_SCHEMA_REFS,
  MECHANICS_AUTHORING_SCHEMA_ID,
  buildMechanicsAuthoringAjv2020,
  getMechanicsAuthoringAjv2020,
  mechanicsAuthoringSchemaPath,
  validateMacroInput,
  validateMechanicsAuthoringSchema
};
