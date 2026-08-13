import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Lib from "ajv/dist/2020.js";
import addFormatsLib from "ajv-formats";
import type {
  PortablePublicGameplayJournal,
  PortablePublicGameplayJournalEntry,
  SessionEventRecord,
  SessionRecord
} from "@cubica/contracts-session";
import { HttpError } from "../errors.ts";

export const MAX_PUBLIC_JOURNAL_ENTRIES = 65_536;
const MAX_SERIALIZED_BYTES = 32 * 1024 * 1024;
const Ajv2020 = (Ajv2020Lib as any).default || Ajv2020Lib;
const addFormats = (addFormatsLib as any).default || addFormatsLib;
const schemaPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../docs/architecture/schemas/public-gameplay-journal.schema.json"
);
const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema) as (value: unknown) => boolean;

/**
 * Build the deliberately narrow public projection from durable events.
 * JSON Schema owns field shape; the checks below are cross-entry and lifecycle
 * invariants that cannot be expressed by the journal schema alone.
 */
export function buildPublicGameplayJournal<TState>(input: {
  session: SessionRecord<TState>;
  events: ReadonlyArray<SessionEventRecord>;
  lifecycle: "active" | "archived";
  archivedAt?: Date;
}): PortablePublicGameplayJournal {
  const throughEventSequence = input.session.version.lastEventSequence;
  const entries = input.events
    .filter((event) => event.audience === "public" && event.sequence <= throughEventSequence)
    .map(toPublicEntry);

  if (entries.length > MAX_PUBLIC_JOURNAL_ENTRIES) {
    throw new HttpError(
      413,
      `Public gameplay journal exceeds the ${MAX_PUBLIC_JOURNAL_ENTRIES}-entry limit.`,
      "PUBLIC_JOURNAL_TOO_LARGE"
    );
  }

  const journal: PortablePublicGameplayJournal = {
    format: "cubica.public-gameplay-journal",
    schemaVersion: "1.0.0",
    sessionId: input.session.sessionId,
    gameId: input.session.gameId,
    lifecycle: input.lifecycle,
    sessionCreatedAt: toIso(input.session.createdAt),
    throughEventSequence,
    entries
  };
  if (input.lifecycle === "archived") {
    if (input.archivedAt === undefined) {
      throw invalidJournal("Archived journal is missing its lifecycle boundary.");
    }
    journal.archivedAt = toIso(input.archivedAt);
  } else if (input.archivedAt !== undefined) {
    throw invalidJournal("Active journal cannot contain an archive timestamp.");
  }

  if (!validateSchema(journal)) {
    throw invalidJournal("Public gameplay journal failed schema validation.");
  }
  assertJournalSemantics(journal, input.events, input.session.sessionId);
  return journal;
}

/** Serialize once so the byte limit is measured on exactly what HTTP sends. */
export function serializePublicGameplayJournal(journal: PortablePublicGameplayJournal): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(journal);
  } catch {
    throw invalidJournal("Public gameplay journal contains a non-JSON value.");
  }
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > MAX_SERIALIZED_BYTES) {
    throw new HttpError(
      413,
      `Public gameplay journal exceeds the ${MAX_SERIALIZED_BYTES}-byte limit.`,
      "PUBLIC_JOURNAL_TOO_LARGE"
    );
  }
  return serialized;
}

function toPublicEntry(event: SessionEventRecord): PortablePublicGameplayJournalEntry {
  const entry: PortablePublicGameplayJournalEntry = {
    eventId: event.eventId,
    sequence: event.sequence,
    eventType: event.eventType,
    occurredAt: toIso(event.createdAt),
    summary: event.summary as PortablePublicGameplayJournalEntry["summary"],
    data: event.data as PortablePublicGameplayJournalEntry["data"]
  };
  if (event.metricChanges !== undefined) {
    entry.metricChanges = event.metricChanges.map((change) => ({
      metricId: change.metricId,
      before: change.before,
      after: change.after
    }));
  }
  return entry;
}

function assertJournalSemantics(
  journal: PortablePublicGameplayJournal,
  sourceEvents: ReadonlyArray<SessionEventRecord>,
  sessionId: string
): void {
  const eventIds = new Set<string>();
  let previousSequence = 0;
  for (const entry of journal.entries) {
    if (entry.sequence <= previousSequence) {
      throw invalidJournal("Public gameplay journal event sequences must be strictly increasing.");
    }
    if (eventIds.has(entry.eventId)) {
      throw invalidJournal("Public gameplay journal event ids must be unique.");
    }
    eventIds.add(entry.eventId);
    previousSequence = entry.sequence;
  }
  if (previousSequence > journal.throughEventSequence) {
    throw invalidJournal("Public gameplay journal exceeds its version boundary.");
  }
  if (sourceEvents.some((event) => event.sessionId !== sessionId)) {
    throw invalidJournal("Public gameplay journal contains an event from another session.");
  }
  if (journal.lifecycle === "archived" && journal.archivedAt === undefined) {
    throw invalidJournal("Archived journal must include archivedAt.");
  }
  if (journal.lifecycle === "active" && journal.archivedAt !== undefined) {
    throw invalidJournal("Active journal must not include archivedAt.");
  }
}

function toIso(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw invalidJournal("Public gameplay journal contains an invalid timestamp.");
  }
  return value.toISOString();
}

function invalidJournal(message: string): HttpError {
  return new HttpError(500, message, "PUBLIC_JOURNAL_INVALID");
}
