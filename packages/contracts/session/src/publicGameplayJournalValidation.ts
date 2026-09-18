import Ajv2020Lib from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import addFormatsLib from "ajv-formats";
import type { PortablePublicGameplayJournal } from "./generated/public-gameplay-journal.ts";
import { publicGameplayJournalSchema } from "./generated/public-gameplay-journal.schema.ts";

const Ajv2020 = (Ajv2020Lib as any).default || Ajv2020Lib;
const addFormats = (addFormatsLib as any).default || addFormatsLib;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const validateJournal = ajv.compile(publicGameplayJournalSchema as object) as
  ValidateFunction<PortablePublicGameplayJournal>;

/** Validate a portable public journal against its canonical cross-platform schema. */
export function validatePortablePublicGameplayJournal(
  value: unknown
): value is PortablePublicGameplayJournal {
  return validateJournal(value);
}
