/**
 * Tests for state fixtures (ADR-057 §4.9, §9.3; design-spec §2.5, §4, §6).
 *
 * Two layers, matching the slice contract:
 *   - Contract (Ajv): the real `state-fixture.schema.json` is registered in the
 *     engine schema registry and exercised against a valid fixture plus the
 *     three canonical failure shapes (missing required, extra property, wrong
 *     type). JSON Schema stays the single source of truth (CLAUDE.md §12).
 *   - Unit (semantic): the framework-agnostic checks the schema cannot express —
 *     unknown `screenRef`/`stepRef` (error `fixture-unknown-ref`), stale
 *     `manifestHash` (warning `fixture-stale`), and a fresh, well-referenced
 *     fixture (clean). Plus the deterministic hash and the projection collectors.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FIXTURE_STALE_DIAGNOSTIC_CODE,
  FIXTURE_UNKNOWN_REF_DIAGNOSTIC_CODE,
  STATE_FIXTURE_SCHEMA_ID,
  buildManifestChronologyTimeline,
  collectManifestChronologyStepIds,
  collectUiScreenIds,
  computeManifestContentHash,
  createDocumentStore,
  createSchemaRegistry,
  validateStateFixtureSemantics,
  type JsonSchema,
  type JsonValue,
  type SchemaRegistry
} from "../src/index.ts";

const stateFixtureSchema = JSON.parse(
  readFileSync(new URL("../../../docs/architecture/schemas/state-fixture.schema.json", import.meta.url), "utf8")
) as JsonSchema;

/** A well-formed manifest hash to reuse across the schema and semantic cases. */
const CURRENT_HASH = computeManifestContentHash([
  { path: "games/demo/authoring/game.authoring.json", content: "{\"a\":1}" }
]);

/** Canonical valid fixture used as the base for the failure variants. */
const validFixture = {
  id: "day4-route-choice",
  _label: "День 4, выбор маршрута",
  screenRef: "route-choice",
  stepRef: "i12",
  state: { stage: "day4", metrics: { food: 3 } },
  manifestHash: CURRENT_HASH,
  sourceTraceRef: ".tmp/editor-playthroughs/trace-1#7",
  note: "pinned at the route choice"
} as const;

function registryWithSchema(): SchemaRegistry {
  const registry = createSchemaRegistry();
  registry.registerSchema(STATE_FIXTURE_SCHEMA_ID, stateFixtureSchema);
  return registry;
}

function schemaDiagnostics(value: JsonValue): readonly { readonly pointer: string; readonly message: string }[] {
  return registryWithSchema().validateValue({ schemaId: STATE_FIXTURE_SCHEMA_ID, value });
}

describe("state-fixture Ajv contract", () => {
  it("accepts a valid fixture", () => {
    expect(schemaDiagnostics(validFixture)).toEqual([]);
  });

  it("accepts a fixture bound to only a step (optional screenRef omitted)", () => {
    const { screenRef, ...withoutScreen } = validFixture;
    expect(schemaDiagnostics(withoutScreen)).toEqual([]);
  });

  it("rejects a missing required field", () => {
    const { manifestHash, ...withoutHash } = validFixture;
    const diagnostics = schemaDiagnostics(withoutHash);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((diagnostic) => diagnostic.pointer === "/manifestHash")).toBe(true);
  });

  it("rejects an unknown extra property (additionalProperties: false)", () => {
    const diagnostics = schemaDiagnostics({ ...validFixture, bogusField: true });
    expect(diagnostics.some((diagnostic) => diagnostic.pointer === "/bogusField")).toBe(true);
  });

  it("rejects a wrong value type", () => {
    const diagnostics = schemaDiagnostics({ ...validFixture, state: "not-an-object" });
    expect(diagnostics.some((diagnostic) => diagnostic.pointer === "/state")).toBe(true);
  });

  it("rejects a malformed manifestHash", () => {
    const diagnostics = schemaDiagnostics({ ...validFixture, manifestHash: "not-a-hash" });
    expect(diagnostics.some((diagnostic) => diagnostic.pointer === "/manifestHash")).toBe(true);
  });
});

describe("computeManifestContentHash", () => {
  it("produces a sha256-<hex> string", () => {
    expect(CURRENT_HASH).toMatch(/^sha256-[0-9a-f]{64}$/u);
  });

  it("is independent of file order but sensitive to content", () => {
    const forward = computeManifestContentHash([
      { path: "a.json", content: "1" },
      { path: "b.json", content: "2" }
    ]);
    const reversed = computeManifestContentHash([
      { path: "b.json", content: "2" },
      { path: "a.json", content: "1" }
    ]);
    const changed = computeManifestContentHash([
      { path: "a.json", content: "1" },
      { path: "b.json", content: "9" }
    ]);
    expect(forward).toBe(reversed);
    expect(forward).not.toBe(changed);
  });
});

describe("projection id collectors", () => {
  it("collects chronology step ids from the timeline projection", () => {
    const snapshot = createDocumentStore({
      filePath: "timeline.game.authoring.json",
      text: JSON.stringify({
        root: {
          logic: {
            flows: [{ id: "main", steps: [{ id: "i11" }, { id: "i12" }] }]
          }
        }
      })
    }).snapshot();

    const timeline = buildManifestChronologyTimeline({ snapshot });
    expect(collectManifestChronologyStepIds(timeline)).toEqual(["i11", "i12"]);
  });

  it("collects screen ids from the ui-screen-index subtree", () => {
    const uiDocument: JsonValue = {
      root: { screens: [{ id: "route-choice" }, { id: "camp" }, { notAScreen: true }] }
    };
    expect(collectUiScreenIds(uiDocument)).toEqual(["route-choice", "camp"]);
    expect(collectUiScreenIds(undefined)).toEqual([]);
  });
});

describe("validateStateFixtureSemantics", () => {
  const context = {
    knownScreenIds: ["route-choice", "camp"],
    knownStepIds: ["i11", "i12"],
    currentManifestHash: CURRENT_HASH
  };

  it("returns no diagnostics for a fresh, well-referenced fixture", () => {
    expect(validateStateFixtureSemantics({ fixture: validFixture, ...context })).toEqual([]);
  });

  it("flags an unknown screenRef as a fixture-unknown-ref error", () => {
    const diagnostics = validateStateFixtureSemantics({
      fixture: { ...validFixture, screenRef: "ghost-screen" },
      ...context
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: "error",
      code: FIXTURE_UNKNOWN_REF_DIAGNOSTIC_CODE,
      pointer: "/screenRef"
    });
  });

  it("flags an unknown stepRef as a fixture-unknown-ref error", () => {
    const diagnostics = validateStateFixtureSemantics({
      fixture: { ...validFixture, stepRef: "i99" },
      ...context
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: "error",
      code: FIXTURE_UNKNOWN_REF_DIAGNOSTIC_CODE,
      pointer: "/stepRef"
    });
  });

  it("flags a stale manifestHash as a fixture-stale warning", () => {
    const diagnostics = validateStateFixtureSemantics({
      fixture: { ...validFixture, manifestHash: computeManifestContentHash([{ path: "x", content: "y" }]) },
      ...context
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: "warning",
      code: FIXTURE_STALE_DIAGNOSTIC_CODE,
      pointer: "/manifestHash"
    });
  });

  it("ignores absent optional references", () => {
    const { screenRef, stepRef, ...bareFixture } = validFixture;
    expect(validateStateFixtureSemantics({ fixture: bareFixture, ...context })).toEqual([]);
  });
});
