/**
 * Tests for the returned-intent interpreter (ADR-057 §4.4, §5; design-spec §2.2,
 * §6). Two layers:
 *
 *   1. An eval-fixture corpus (`tests/fixtures/returned-intent/*.json`, ADR-038
 *      replay/eval contour): each fixture builds a real prompt projection, applies
 *      a small text transform to it, runs the interpreter, and asserts the path,
 *      the three-bucket report counts, and the deterministic ChangeSet. Adding a
 *      case is one JSON file — no test code changes.
 *   2. Targeted unit tests for the source-map contract and the report invariants
 *      that the corpus format cannot express directly.
 *
 * Everything is game-neutral and network-free.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildEditorEntityProjection,
  buildEditorEntityYamlProjection,
  interpretReturnedIntent,
  type EditorEntityProjectionDocument,
  type InterpretationLineReport,
  type JsonPatchOperation,
  type JsonValue,
  type ReturnedIntentResult
} from "../src/index.ts";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "returned-intent");

/** One text transform applied to the generated projection to produce the returned text. */
type FixtureTransform =
  | { readonly kind: "replace-in-line"; readonly anchor: string; readonly from: string; readonly to: string }
  | { readonly kind: "append-to-line"; readonly anchor: string; readonly text: string }
  | { readonly kind: "delete-line"; readonly anchor: string }
  | { readonly kind: "delete-block"; readonly anchor: string; readonly before?: number }
  | { readonly kind: "append"; readonly text: string }
  | { readonly kind: "clear" }
  | { readonly kind: "identity" };

interface Fixture {
  readonly description: string;
  readonly documents: readonly EditorEntityProjectionDocument[];
  readonly entityId: string;
  readonly sourceHashes: Record<string, string>;
  readonly currentSourceHashes?: Record<string, string>;
  readonly transform: readonly FixtureTransform[];
  readonly expect: {
    readonly path: "deterministic" | "agent";
    readonly stale: boolean;
    readonly buckets: Record<InterpretationLineReport["bucket"], number>;
    readonly changeSetNull?: boolean;
    readonly changeSet?: { readonly ops: readonly JsonPatchOperation[] };
  };
}

/** Applies the fixture transforms to the projection text to build the returned text. */
function applyTransforms(text: string, transforms: readonly FixtureTransform[]): string {
  if (transforms.some((transform) => transform.kind === "clear")) {
    return "";
  }
  const lines = text.split("\n");
  const findLine = (anchor: string): number => {
    const index = lines.findIndex((line) => line.includes(anchor));
    if (index === -1) {
      throw new Error(`Fixture anchor not found in projection: ${anchor}`);
    }
    return index;
  };

  for (const transform of transforms) {
    switch (transform.kind) {
      case "identity":
        break;
      case "replace-in-line": {
        const index = findLine(transform.anchor);
        lines[index] = lines[index].replace(transform.from, transform.to);
        break;
      }
      case "append-to-line": {
        const index = findLine(transform.anchor);
        lines[index] = `${lines[index]}${transform.text}`;
        break;
      }
      case "delete-line": {
        lines.splice(findLine(transform.anchor), 1);
        break;
      }
      case "delete-block": {
        const index = findLine(transform.anchor);
        const before = transform.before ?? 0;
        lines.splice(index - before, before + 1);
        break;
      }
      case "append": {
        // Insert a new content line before the terminating empty line so the
        // result still ends with a single newline, matching the projection.
        if (lines[lines.length - 1] === "") {
          lines.splice(lines.length - 1, 0, transform.text);
        } else {
          lines.push(transform.text);
        }
        break;
      }
    }
  }
  return lines.join("\n");
}

/** Flattens a ChangeSet's JSON patches into a sortable multiset of operations. */
function flattenOps(result: ReturnedIntentResult): JsonPatchOperation[] {
  return (result.changeSet?.jsonPatches ?? []).flatMap((patch) => [...patch.operations]);
}

function sortOps(ops: readonly JsonPatchOperation[]): JsonPatchOperation[] {
  return [...ops].sort((left, right) => `${left.op} ${left.path}`.localeCompare(`${right.op} ${right.path}`));
}

function countBuckets(report: readonly InterpretationLineReport[]): Record<InterpretationLineReport["bucket"], number> {
  const counts = { applied: 0, "recognized-no-change": 0, unrecognized: 0 };
  for (const line of report) {
    counts[line.bucket] += 1;
  }
  return counts;
}

function loadFixtures(): { readonly name: string; readonly fixture: Fixture }[] {
  return readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith(".json") && !file.startsWith("."))
    .sort()
    .map((file) => ({ name: file, fixture: JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf8")) as Fixture }));
}

describe("interpretReturnedIntent eval fixtures", () => {
  for (const { name, fixture } of loadFixtures()) {
    it(`${name}: ${fixture.description}`, () => {
      const projection = buildEditorEntityProjection({ documents: fixture.documents });
      const entity = projection.entityById.get(fixture.entityId);
      expect(entity, `entity ${fixture.entityId} must exist in the fixture projection`).toBeDefined();
      if (entity === undefined) {
        return;
      }

      const yaml = buildEditorEntityYamlProjection({ entity, documents: fixture.documents });
      const returnedText = applyTransforms(yaml.text, fixture.transform);

      const result = interpretReturnedIntent(
        {
          projectionYaml: yaml.text,
          returnedText,
          facetSourceMap: yaml.facetSourceMap,
          sourceHashes: fixture.sourceHashes,
          entityId: fixture.entityId
        },
        fixture.currentSourceHashes === undefined ? {} : { currentSourceHashes: fixture.currentSourceHashes }
      );

      expect(result.path).toBe(fixture.expect.path);
      expect(result.stale ?? false).toBe(fixture.expect.stale);
      expect(countBuckets(result.report)).toEqual(fixture.expect.buckets);

      // Report accounting: bucket counts sum to the report length (no orphan entries),
      // and every "applied" entry names a target pointer (design-spec §2.2).
      expect(result.report.length).toBe(
        fixture.expect.buckets.applied + fixture.expect.buckets["recognized-no-change"] + fixture.expect.buckets.unrecognized
      );
      for (const line of result.report) {
        if (line.bucket === "applied") {
          expect(line.targetPointer).toBeTypeOf("string");
        }
      }

      if (fixture.expect.changeSetNull) {
        expect(result.changeSet).toBeNull();
      }
      if (fixture.expect.changeSet !== undefined) {
        expect(result.changeSet).not.toBeNull();
        expect(sortOps(flattenOps(result))).toEqual(sortOps(fixture.expect.changeSet.ops));
        // Every applied target pointer must be an op path in the ChangeSet.
        const opPaths = new Set(flattenOps(result).map((op) => op.path));
        for (const line of result.report) {
          if (line.bucket === "applied") {
            expect(opPaths.has(line.targetPointer ?? "")).toBe(true);
          }
        }
      }
    });
  }
});

// A tiny game manifest reused by the unit tests (not fixtures).
const UNIT_FILE = "games/unit/authoring/game.authoring.json";
const unitGame = {
  _manifestType: "game",
  root: {
    logic: { flows: [{ id: "main", steps: [{ id: "s1", _label: "Шаг", _type: "game.Step", title: "Заголовок" }] }], actions: [] }
  }
} satisfies JsonValue;

function buildStepProjection(): {
  readonly yamlText: string;
  readonly facetSourceMap: ReturnType<typeof buildEditorEntityYamlProjection>["facetSourceMap"];
  readonly hidden: readonly string[];
} {
  const projection = buildEditorEntityProjection({ documents: [{ filePath: UNIT_FILE, json: unitGame }] });
  const entity = projection.entityById.get("game-step:s1");
  if (entity === undefined) {
    throw new Error("Expected the unit step entity.");
  }
  const yaml = buildEditorEntityYamlProjection({ entity, documents: [{ filePath: UNIT_FILE, json: unitGame }] });
  return { yamlText: yaml.text, facetSourceMap: yaml.facetSourceMap, hidden: yaml.hiddenTechnicalPointers.map((pointer) => pointer.pointer) };
}

describe("facetSourceMap contract", () => {
  it("emits exactly one source line per projection line and hides technical fields", () => {
    const { yamlText, facetSourceMap, hidden } = buildStepProjection();
    const contentLines = yamlText.split("\n");
    contentLines.pop(); // drop the trailing empty line from the terminating newline
    expect(facetSourceMap.lines.length).toBe(contentLines.length);
    facetSourceMap.lines.forEach((line, index) => {
      expect(line.line).toBe(index);
    });

    // Technical fields (`_type`/`_label`) are hidden, never projected, and thus
    // never carry a source-map line (they only appear in hiddenTechnicalPointers).
    expect(yamlText).not.toContain("_type");
    expect(hidden.some((pointer) => pointer.endsWith("/_type"))).toBe(true);
    const editablePointers = facetSourceMap.lines.filter((line) => line.valueStart !== undefined).map((line) => line.pointer);
    expect(editablePointers).toContain("/root/logic/flows/0/steps/0/title");
    expect(editablePointers.every((pointer) => pointer !== undefined && !pointer.endsWith("/_type"))).toBe(true);
  });

  it("records valueStart at the column where a scalar value begins", () => {
    const { yamlText, facetSourceMap } = buildStepProjection();
    const lines = yamlText.split("\n");
    const titleLine = facetSourceMap.lines.find((line) => line.pointer === "/root/logic/flows/0/steps/0/title");
    expect(titleLine?.valueStart).toBeTypeOf("number");
    // Slicing the projection line at valueStart yields exactly the encoded value.
    expect(lines[titleLine?.line ?? -1].slice(titleLine?.valueStart ?? 0)).toBe(JSON.stringify("Заголовок"));
  });
});

describe("interpretReturnedIntent invariants", () => {
  it("short-circuits on prompt-stale before computing any diff", () => {
    const { yamlText, facetSourceMap } = buildStepProjection();
    const result = interpretReturnedIntent(
      {
        projectionYaml: yamlText,
        returnedText: yamlText.replace("Заголовок", "Другой"),
        facetSourceMap,
        sourceHashes: { [UNIT_FILE]: "captured" },
        entityId: "game-step:s1"
      },
      { currentSourceHashes: { [UNIT_FILE]: "fresh-and-different" } }
    );
    expect(result.stale).toBe(true);
    expect(result.path).toBe("agent");
    expect(result.changeSet).toBeNull();
    expect(result.report).toEqual([]);
  });

  it("treats identical returned text as a deterministic no-op", () => {
    const { yamlText, facetSourceMap } = buildStepProjection();
    const result = interpretReturnedIntent({
      projectionYaml: yamlText,
      returnedText: yamlText,
      facetSourceMap,
      sourceHashes: { [UNIT_FILE]: "captured" },
      entityId: "game-step:s1"
    });
    expect(result.path).toBe("deterministic");
    expect(result.changeSet).toBeNull();
    expect(result.report).toEqual([]);
  });

  it("never marks a fragment applied on the agent path", () => {
    const { yamlText, facetSourceMap } = buildStepProjection();
    // A value edit PLUS unrecognized appended text: the whole return defers to the
    // agent, so the recognized value edit must NOT be reported as applied.
    const edited = `${yamlText.replace("Заголовок", "Новый")}Свободный текст без ключа\n`;
    const result = interpretReturnedIntent({
      projectionYaml: yamlText,
      returnedText: edited,
      facetSourceMap,
      sourceHashes: { [UNIT_FILE]: "captured" },
      entityId: "game-step:s1"
    });
    expect(result.path).toBe("agent");
    expect(result.changeSet).toBeNull();
    expect(result.report.some((line) => line.bucket === "applied")).toBe(false);
    expect(result.report.some((line) => line.bucket === "unrecognized")).toBe(true);
    // No silent ignore: the recognized value edit is still surfaced.
    expect(result.report.some((line) => line.bucket === "recognized-no-change")).toBe(true);
  });
});
