import fs from "node:fs";
import Ajv2020Lib from "ajv/dist/2020.js";
import addFormatsLib from "ajv-formats";
import type { PortablePublicGameplayJournal } from "../src/index.ts";

const Ajv2020 = (Ajv2020Lib as any).default || Ajv2020Lib;
const addFormats = (addFormatsLib as any).default || addFormatsLib;

const schema = JSON.parse(fs.readFileSync(new URL(
  "../../../../docs/architecture/schemas/public-gameplay-journal.schema.json",
  import.meta.url
), "utf8")) as object;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema) as ((value: unknown) => value is PortablePublicGameplayJournal) & {
  errors?: unknown;
};

const validJournal = {
  format: "cubica.public-gameplay-journal",
  schemaVersion: "1.0.0",
  sessionId: "session-neutral",
  gameId: "neutral-fixture",
  lifecycle: "active",
  sessionCreatedAt: "2026-08-12T08:00:00.000Z",
  throughEventSequence: 3,
  entries: [
    {
      eventId: "evt-public-1",
      sequence: 1,
      eventType: "round.started",
      occurredAt: "2026-08-12T08:01:00.000Z",
      summary: "Round started",
      data: { round: 1, tags: ["training", null] },
      metricChanges: [{ metricId: "progress", before: 0, after: 1 }]
    },
    {
      eventId: "evt-public-3",
      sequence: 3,
      eventType: "choice.confirmed",
      occurredAt: "2026-08-12T08:02:00.000Z",
      summary: { text: "Choice confirmed" },
      data: { choiceId: "option-a", accepted: true }
    }
  ]
} satisfies PortablePublicGameplayJournal;

describe("portable public gameplay journal schema", () => {
  it("accepts a neutral journal with sequence gaps and nested public JSON", () => {
    expect(validate(validJournal), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects protected envelope fields and unknown top-level fields", () => {
    const protectedEntry = structuredClone(validJournal) as Record<string, unknown>;
    const entries = protectedEntry.entries as Array<Record<string, unknown>>;
    entries[0].commandId = "cli_protected";
    expect(validate(protectedEntry)).toBe(false);

    const protectedRoot = { ...validJournal, bundleHash: "cubica-bundle-v1:sha256:secret" };
    expect(validate(protectedRoot)).toBe(false);
  });

  it("requires archivedAt only for archived documents", () => {
    expect(validate({ ...validJournal, archivedAt: "2026-08-12T09:00:00.000Z" })).toBe(false);
    expect(validate({ ...validJournal, lifecycle: "archived" })).toBe(false);
    expect(validate({
      ...validJournal,
      lifecycle: "archived",
      archivedAt: "2026-08-12T09:00:00.000Z"
    })).toBe(true);
  });

  it("rejects invalid timestamps and non-JSON values", () => {
    expect(validate({ ...validJournal, sessionCreatedAt: "yesterday" })).toBe(false);
    const withUndefined = structuredClone(validJournal) as Record<string, unknown>;
    const entries = withUndefined.entries as Array<Record<string, unknown>>;
    entries[0].summary = undefined;
    expect(validate(withUndefined)).toBe(false);
  });
});
