import Ajv2020Lib from "ajv/dist/2020.js";
import addFormatsLib from "ajv-formats";
import type { ErrorObject, ValidateFunction } from "ajv";
import type {
  FacilitatorDebriefGenerationRequest,
  FacilitatorDebriefResponse
} from "./generated/facilitator-debrief.ts";
import { facilitatorDebriefSchema } from "./generated/facilitator-debrief.schema.ts";

const Ajv2020 = (Ajv2020Lib as any).default || Ajv2020Lib;
const addFormats = (addFormatsLib as any).default || addFormatsLib;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateResponse = ajv.compile(
  facilitatorDebriefSchema as object
) as ValidateFunction<FacilitatorDebriefResponse>;
const generationRequestSchema = {
  ...facilitatorDebriefSchema.$defs.FacilitatorDebriefGenerationRequest,
  $schema: facilitatorDebriefSchema.$schema,
  $id: "https://cubica.ai/schemas/session/facilitator-debrief-generation-request.schema.json"
};
const validateGenerationRequest = ajv.compile(
  generationRequestSchema as object
) as ValidateFunction<FacilitatorDebriefGenerationRequest>;

export function validateFacilitatorDebriefResponseShape(
  value: unknown
): value is FacilitatorDebriefResponse {
  return validateResponse(value);
}

export function validateFacilitatorDebriefGenerationRequestShape(
  value: unknown
): value is FacilitatorDebriefGenerationRequest {
  return validateGenerationRequest(value);
}

export function getFacilitatorDebriefContractErrors(
  kind: "response" | "generation-request"
): ReadonlyArray<ErrorObject> {
  return [...(kind === "response" ? validateResponse.errors : validateGenerationRequest.errors) ?? []];
}
