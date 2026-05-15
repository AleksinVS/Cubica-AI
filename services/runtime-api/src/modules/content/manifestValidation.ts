import AjvLib from "ajv";
import addFormatsLib from "ajv-formats";
import ajvErrorsLib from "ajv-errors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { GameManifest } from "@cubica/contracts-manifest";
import { ManifestValidationError } from "../errors.ts";

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

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
ajvErrors(ajv);

const validate = ajv.compile(gameManifestSchema);

export function validateGameManifest(manifest: unknown): GameManifest {
  const isValid = validate(manifest);
  if (!isValid) {
    const errors = validate.errors
      ?.map((e: any) => `${e.instancePath} ${e.message}`)
      .join(", ");
    throw new ManifestValidationError(`Schema validation failed: ${errors}`);
  }

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

  return manifest as GameManifest;
}
