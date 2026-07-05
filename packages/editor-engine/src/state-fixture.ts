/**
 * State fixtures: schema id and semantic validation (ADR-057 §4.9, §9.3;
 * design-spec §2.5, §4). The deterministic manifest content hash PRODUCER
 * lives in the node-only module `state-fixture-hash.ts` (it needs
 * `node:crypto` and must stay out of this browser-reachable barrel path);
 * this module only COMPARES hash strings and stays browser-safe.
 *
 * A "state fixture" (фикстура состояния) is a pinned, named snapshot of runtime
 * game state that becomes a reviewable authoring artifact under
 * `games/<gameId>/authoring/fixtures/<fixtureId>.json`. It gives the editor
 * Design mode a reproducible state context and a starting point for a
 * playthrough. Runtime-api, player-web and the compiler never read fixture
 * files (ADR-057 §5 invariant); the editor passes the captured `state` into a
 * preview-only restore endpoint.
 *
 * This module stays framework-agnostic and game-agnostic. Structural validation
 * is delegated to Ajv against `state-fixture.schema.json` through the existing
 * `createSchemaRegistry` path (schema.ts) — this module never re-implements the
 * schema shape checks (ADR-025, CLAUDE.md §12). On top of that it adds two
 * semantic checks a JSON Schema cannot express:
 *   - `fixture-unknown-ref` (error): a `screenRef`/`stepRef` that no known
 *     screen or chronology step id matches;
 *   - `fixture-stale` (warning): a `manifestHash` that no longer matches the
 *     current authoring manifests.
 *
 * The known screen and step ids come from the engine's existing projections:
 * `buildManifestChronologyTimeline` (steps) and the `ui-screen-index` lens
 * subtree `/root/screens` (screens). Small collectors below bridge those
 * projections to plain id sets so the semantic validator stays a pure function.
 */
import { isPlainJsonObject, makeDiagnostic } from "./shared.ts";
import { appendPointerSegment, readJsonPointer } from "./json-pointer-patch.ts";
import type {
  DocumentDiagnostic,
  JsonValue,
  ManifestTimeline,
  TextLocationMap
} from "./types.ts";

/** Canonical schema id; must equal the `$id` in state-fixture.schema.json. */
export const STATE_FIXTURE_SCHEMA_ID = "https://cubica.platform/schemas/state-fixture.schema.json";

/** Registry code: fixture `manifestHash` differs from the current manifests. */
export const FIXTURE_STALE_DIAGNOSTIC_CODE = "fixture-stale";
/** Registry code: fixture `screenRef`/`stepRef` points at a non-existent id. */
export const FIXTURE_UNKNOWN_REF_DIAGNOSTIC_CODE = "fixture-unknown-ref";

/**
 * Collects the chronology step ids from a manifest timeline projection.
 *
 * Reuses `buildManifestChronologyTimeline` output (ADR-057) instead of walking
 * the manifest again, so fixture validation and the timeline agree on which
 * step ids exist.
 */
export function collectManifestChronologyStepIds(timeline: ManifestTimeline): readonly string[] {
  const stepIds: string[] = [];
  for (const entry of timeline.entries) {
    if (entry.kind === "step" && typeof entry.stepId === "string" && entry.stepId !== "") {
      stepIds.push(entry.stepId);
    }
  }
  return stepIds;
}

/**
 * Collects screen ids from an active-channel UI authoring/manifest document.
 *
 * Reads the `/root/screens` subtree — the same location the `ui-screen-index`
 * projection lens declares (entity-projection.ts) — so a fixture `screenRef` is
 * checked against exactly the screens the editor indexes for that channel.
 */
export function collectUiScreenIds(uiDocument: JsonValue | undefined): readonly string[] {
  if (uiDocument === undefined) {
    return [];
  }

  const screens = readJsonPointer(uiDocument, "/root/screens");
  if (!Array.isArray(screens)) {
    return [];
  }

  const screenIds: string[] = [];
  for (const screen of screens) {
    if (isPlainJsonObject(screen) && typeof screen.id === "string" && screen.id !== "") {
      screenIds.push(screen.id);
    }
  }
  return screenIds;
}

/** Inputs for {@link validateStateFixtureSemantics}. */
export interface ValidateStateFixtureSemanticsInput {
  /** Parsed fixture JSON. Structural validity is checked separately by Ajv. */
  readonly fixture: JsonValue;
  /** Screen ids of the active preview channel (see {@link collectUiScreenIds}). */
  readonly knownScreenIds: Iterable<string>;
  /** Chronology step ids (see {@link collectManifestChronologyStepIds}). */
  readonly knownStepIds: Iterable<string>;
  /** Deterministic hash of the current manifests (produced by `computeManifestContentHash` from `state-fixture-hash.ts`). */
  readonly currentManifestHash: string;
  /** Optional location map to attach source text ranges to diagnostics. */
  readonly locationMap?: TextLocationMap;
}

/**
 * Runs the fixture-specific semantic checks that JSON Schema cannot express.
 *
 * The function is pure and additive: it inspects only the fixture and the
 * supplied id sets / current hash, and returns `DocumentDiagnostic`s carrying
 * the registry `code` so UI layers can group and navigate by code. It assumes
 * the caller has already run Ajv structural validation; a non-object fixture
 * yields no semantic diagnostics (the schema error is authoritative there).
 */
export function validateStateFixtureSemantics(
  input: ValidateStateFixtureSemanticsInput
): readonly DocumentDiagnostic[] {
  const diagnostics: DocumentDiagnostic[] = [];
  const fixture = input.fixture;
  if (!isPlainJsonObject(fixture)) {
    return diagnostics;
  }

  const screenIds = new Set(input.knownScreenIds);
  const stepIds = new Set(input.knownStepIds);

  checkReference(fixture.screenRef, "screenRef", "UI screen", screenIds, diagnostics, input.locationMap);
  checkReference(fixture.stepRef, "stepRef", "chronology step", stepIds, diagnostics, input.locationMap);

  const manifestHash = fixture.manifestHash;
  if (typeof manifestHash === "string" && manifestHash !== input.currentManifestHash) {
    const pointer = appendPointerSegment("", "manifestHash");
    diagnostics.push(
      makeDiagnostic({
        severity: "warning",
        source: "semantic",
        code: FIXTURE_STALE_DIAGNOSTIC_CODE,
        pointer,
        message:
          `Fixture manifestHash ${manifestHash} does not match the current manifests ` +
          `(${input.currentManifestHash}); the fixture may no longer restore correctly.`,
        range: input.locationMap?.get(pointer)
      })
    );
  }

  return diagnostics;
}

/** Emits a `fixture-unknown-ref` error when a present reference id is unknown. */
function checkReference(
  value: JsonValue | undefined,
  field: "screenRef" | "stepRef",
  kind: string,
  knownIds: ReadonlySet<string>,
  diagnostics: DocumentDiagnostic[],
  locationMap: TextLocationMap | undefined
): void {
  // Absent optional reference: nothing to check (a fixture may bind to only a
  // screen or only a step). A non-string value is a schema error, not ours.
  if (typeof value !== "string" || knownIds.has(value)) {
    return;
  }

  const pointer = appendPointerSegment("", field);
  diagnostics.push(
    makeDiagnostic({
      severity: "error",
      source: "semantic",
      code: FIXTURE_UNKNOWN_REF_DIAGNOSTIC_CODE,
      pointer,
      message: `Fixture ${field} "${value}" does not match any ${kind} id.`,
      range: locationMap?.get(pointer)
    })
  );
}
