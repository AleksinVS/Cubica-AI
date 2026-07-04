/**
 * Local authoring prototype extraction (ADR-050).
 *
 * Finds repeated authoring object shapes that could become a shared local
 * prototype/definition, and builds an extraction proposal plus the JSON Patch
 * ChangeSet that would apply it. The comparison is structural: variant fields
 * (ids, labels, prompts, coordinates) are ignored while stable discriminators
 * (kind, type, handler, ...) keep their literal values. Extraction is never
 * applied here — the proposal only records the mandatory validation gates so
 * editor-web or CI can run schema/compiler/runtime-diff checks before apply.
 */
import { cloneJsonValue, hashEditorText, isPlainJsonObject, jsonValuesEqual, makeDiagnostic } from "./shared.ts";
import { appendPointerSegment, jsonPointerExists, lastPointerSegment, parseJsonPointer, readJsonPointer } from "./json-pointer-patch.ts";
import { isDefinitionPointer, isSameOrDescendantPointer } from "./semantics.ts";
import type {
  CreatePrototypeExtractionProposalInput,
  CreatePrototypeExtractionProposalResult,
  DiscoverPrototypeExtractionCandidatesInput,
  DiscoverPrototypeExtractionCandidatesResult,
  EditorChangeSet,
  JsonObject,
  JsonPatchOperation,
  JsonValue,
  PrototypeExtractionProposal,
  PrototypeExtractionRisk,
  PrototypeExtractionScore
} from "./types.ts";

/**
 * Finds repeated authoring object shapes that can become local prototypes.
 *
 * The comparison is structural: variant fields such as ids, labels, prompts and
 * text are ignored by key name, while stable discriminator fields such as
 * `kind`, `type`, `handler` and `templateId` keep their literal values. The
 * result is only a candidate list; applying extraction still requires an
 * explicit proposal and dry-run.
 */
export function discoverPrototypeExtractionCandidates(
  input: DiscoverPrototypeExtractionCandidatesInput
): DiscoverPrototypeExtractionCandidatesResult {
  if (input.snapshot.json === undefined) {
    return {
      ok: false,
      candidates: [],
      diagnostics: [
        makeDiagnostic({
          source: "prototype-extraction",
          pointer: "",
          message: "Cannot discover prototype candidates while the authoring document has invalid JSON."
        })
      ]
    };
  }

  const rootPointer = input.rootPointer ?? (jsonPointerExists(input.snapshot.json, "/root") ? "/root" : "");
  const rootValue = readJsonPointer(input.snapshot.json, rootPointer);
  if (rootValue === undefined) {
    return {
      ok: false,
      candidates: [],
      diagnostics: [
        makeDiagnostic({
          source: "prototype-extraction",
          pointer: rootPointer,
          message: `Prototype discovery root does not exist: ${rootPointer || "/"}`
        })
      ]
    };
  }

  const variantKeys = prototypeVariantKeySet(input.knownVariantKeys);
  const excludedPointers = new Set(["/_definitions", ...(input.excludedPointers ?? [])]);
  const minRepeatCount = input.minRepeatCount ?? 2;
  const minObjectFieldCount = input.minObjectFieldCount ?? 2;
  const groups = new Map<
    string,
    {
      readonly normalizedShape: JsonValue;
      readonly pointers: string[];
      readonly values: JsonObject[];
    }
  >();

  const visit = (value: JsonValue, pointer: string): void => {
    if (isExcludedPrototypePointer(pointer, excludedPointers)) {
      return;
    }

    if (isPlainJsonObject(value)) {
      const normalizedShape = normalizePrototypeShape(value, variantKeys);
      if (countPrototypeFields(normalizedShape) >= minObjectFieldCount && pointer !== rootPointer) {
        const signature = stableJsonSignature(normalizedShape);
        const group = groups.get(signature) ?? { normalizedShape, pointers: [], values: [] };
        group.pointers.push(pointer);
        group.values.push(value);
        groups.set(signature, group);
      }

      for (const [key, child] of Object.entries(value)) {
        visit(child, appendPointerSegment(pointer, key));
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((child, index) => {
        visit(child, appendPointerSegment(pointer, String(index)));
      });
    }
  };

  visit(rootValue, rootPointer);

  const candidates = [...groups.entries()]
    .filter(([, group]) => group.pointers.length >= minRepeatCount)
    .map(([signature, group]) => {
      const commonBody = buildPrototypeCommonBody(group.values, variantKeys);
      const overrideFieldCount = group.values.reduce(
        (total, value) => total + countPrototypeFields(diffPrototypeOverride(value, commonBody, undefined)),
        0
      );
      return {
        signature,
        pointers: group.pointers,
        normalizedShape: group.normalizedShape,
        score: buildPrototypeExtractionScore({
          repetitionCount: group.pointers.length,
          commonFieldCount: countPrototypeFields(commonBody),
          overrideFieldCount
        })
      };
    })
    .sort((left, right) => {
      if (right.score.repetitionCount !== left.score.repetitionCount) {
        return right.score.repetitionCount - left.score.repetitionCount;
      }
      return right.score.commonFieldCount - left.score.commonFieldCount;
    });

  return {
    ok: true,
    candidates,
    diagnostics: []
  };
}

/**
 * Builds a local game-level prototype extraction proposal and its ChangeSet.
 *
 * The proposal does not compile manifests itself. Instead it records the
 * mandatory gates from ADR-050 so editor-web or CI can run JSON Schema,
 * compiler, runtime diff and source-map checks before apply.
 */
export function createPrototypeExtractionProposal(
  input: CreatePrototypeExtractionProposalInput
): CreatePrototypeExtractionProposalResult {
  if (input.snapshot.json === undefined) {
    return rejectPrototypeExtraction("", "Cannot create a prototype proposal while the authoring document has invalid JSON.");
  }

  const definitionType = input.definitionType.trim();
  if (definitionType === "") {
    return rejectPrototypeExtraction("/_definitions", "Prototype definition type must be a non-empty string.");
  }

  if (input.definitionSemantics.trim() === "") {
    return rejectPrototypeExtraction("/_definitions", "Prototype definition must include non-empty _semantics.");
  }

  const definitionPointer = appendPointerSegment("/_definitions", definitionType);
  if (jsonPointerExists(input.snapshot.json, definitionPointer)) {
    return rejectPrototypeExtraction(definitionPointer, `Prototype definition already exists: ${definitionType}`);
  }

  const sourcePointers = uniquePrototypePointers(input.sourcePointers);
  if (sourcePointers.length < 2) {
    return rejectPrototypeExtraction("", "Prototype extraction requires at least two source pointers.");
  }

  const sourceValues: JsonObject[] = [];
  for (const pointer of sourcePointers) {
    const value = readJsonPointer(input.snapshot.json, pointer);
    if (!isPlainJsonObject(value)) {
      return rejectPrototypeExtraction(pointer, `Prototype source must point to a JSON object: ${pointer || "/"}`);
    }
    if (isDefinitionPointer(pointer)) {
      return rejectPrototypeExtraction(pointer, "Prototype extraction sources must be concrete authoring instances, not _definitions.");
    }
    sourceValues.push(value);
  }

  const inheritedType = commonPrototypeType(sourceValues);
  if (inheritedType === "mixed") {
    return rejectPrototypeExtraction(
      "",
      "Prototype extraction cannot merge sources with different _type values. Extract each semantic type separately."
    );
  }

  const variantKeys = prototypeVariantKeySet(input.knownVariantKeys);
  const commonBody = buildPrototypeCommonBody(sourceValues, variantKeys);
  if (countPrototypeFields(commonBody) === 0) {
    return rejectPrototypeExtraction(
      "",
      "Prototype extraction found no stable common body after removing known variant fields."
    );
  }

  const definition = buildPrototypeDefinition({
    inheritedType,
    definitionSemantics: input.definitionSemantics,
    promptTemplate: input.promptTemplate,
    commonBody
  });
  const instanceOverrides = sourceValues.map((value, index) => {
    const sourcePointer = sourcePointers[index] as string;
    const replacement = buildPrototypeInstanceReplacement({
      original: value,
      commonBody,
      definitionType,
      inheritedType
    });
    return {
      sourcePointer,
      replacement,
      overridePointers: collectOverridePointers(replacement, sourcePointer)
    };
  });
  const overrideFieldCount = instanceOverrides.reduce(
    (total, override) => total + Math.max(0, countPrototypeFields(override.replacement) - 1),
    0
  );
  const score = buildPrototypeExtractionScore({
    repetitionCount: sourcePointers.length,
    commonFieldCount: countPrototypeFields(commonBody),
    overrideFieldCount
  });
  const operations: JsonPatchOperation[] = [
    ...definitionPatchOperations(input.snapshot.json, definitionPointer, definition),
    ...sourcePointers.flatMap((pointer, index) => [
      { op: "test" as const, path: pointer, value: sourceValues[index] as JsonValue },
      { op: "replace" as const, path: pointer, value: instanceOverrides[index]?.replacement as JsonValue }
    ])
  ];

  const proposalId = input.proposalId ?? `prototype-extraction:${hashPrototypeProposalId(sourcePointers, definitionType)}`;
  const changeSet: EditorChangeSet = {
    id: input.changeSetId ?? `${proposalId}:change-set`,
    intentId: input.intentId,
    summary: `Extract local authoring prototype ${definitionType} from ${sourcePointers.length} instance(s).`,
    jsonPatches: [
      {
        filePath: input.snapshot.filePath,
        operations
      }
    ],
    textPatches: [],
    fileCreates: [],
    fileDeletes: [],
    fileRenames: []
  };
  const proposal: PrototypeExtractionProposal = {
    id: proposalId,
    classification: input.classification ?? "game-level",
    definitionType,
    definitionPointer,
    definition,
    commonBody,
    sourcePointers,
    knownVariantKeys: [...variantKeys].sort(),
    instanceOverrides,
    score,
    expectedRuntimeDiff: input.expectedRuntimeDiff ?? "must-be-zero",
    sourceMapImpact: {
      requiresPointerExistenceCheck: true,
      affectedPointers: sourcePointers
    },
    validationGates: [
      "authoring-json-schema",
      "editor-change-set-dry-run",
      "compiler-dry-run",
      "generated-runtime-schema",
      "authoring-only-leakage-scan",
      "canonical-runtime-diff",
      "source-map-pointer-existence",
      "manual-approval"
    ],
    changeSet
  };

  return {
    ok: true,
    proposal,
    diagnostics: []
  };
}

const defaultPrototypeVariantKeys = [
  "_label",
  "_prompt",
  "_semantics",
  "actionId",
  "asset",
  "body",
  "caption",
  "description",
  "id",
  "key",
  "label",
  "left",
  "name",
  "order",
  "slug",
  "src",
  "target",
  "targetId",
  "text",
  "title",
  "top",
  "x",
  "y"
] as const;

const stablePrototypeLiteralKeys = new Set([
  "_type",
  "channel",
  "component",
  "effect",
  "handler",
  "kind",
  "layout",
  "method",
  "mode",
  "scope",
  "templateId",
  "type",
  "variant"
]);

function rejectPrototypeExtraction(pointer: string, message: string): CreatePrototypeExtractionProposalResult {
  return {
    ok: false,
    diagnostics: [
      makeDiagnostic({
        source: "prototype-extraction",
        pointer,
        message
      })
    ]
  };
}

function prototypeVariantKeySet(extraKeys: readonly string[] | undefined): ReadonlySet<string> {
  return new Set([...defaultPrototypeVariantKeys, ...(extraKeys ?? [])]);
}

function isExcludedPrototypePointer(pointer: string, excludedPointers: ReadonlySet<string>): boolean {
  for (const excludedPointer of excludedPointers) {
    if (isSameOrDescendantPointer(pointer, excludedPointer)) {
      return true;
    }
  }
  return false;
}

function normalizePrototypeShape(value: JsonValue, variantKeys: ReadonlySet<string>, keyHint = ""): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => normalizePrototypeShape(item, variantKeys));
  }

  if (isPlainJsonObject(value)) {
    const normalized: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
      if (variantKeys.has(key)) {
        continue;
      }
      normalized[key] = normalizePrototypeShape(child, variantKeys, key);
    }
    return normalized;
  }

  if (stablePrototypeLiteralKeys.has(keyHint)) {
    return value;
  }

  return {
    $scalar: value === null ? "null" : typeof value
  };
}

function stableJsonSignature(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonSignature).join(",")}]`;
  }

  if (isPlainJsonObject(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJsonSignature(child)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function uniquePrototypePointers(pointers: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const pointer of pointers) {
    parseJsonPointer(pointer);
    if (!seen.has(pointer)) {
      seen.add(pointer);
      result.push(pointer);
    }
  }
  return result;
}

function commonPrototypeType(values: readonly JsonObject[]): string | undefined | "mixed" {
  const types = values.map((value) => value._type).filter((value): value is string => typeof value === "string");
  if (types.length === 0) {
    return undefined;
  }
  if (types.length !== values.length) {
    return "mixed";
  }
  const [first] = types;
  return types.every((type) => type === first) ? first : "mixed";
}

function buildPrototypeCommonBody(values: readonly JsonObject[], variantKeys: ReadonlySet<string>): JsonObject {
  const common = commonPrototypeValue(values as readonly JsonValue[], variantKeys);
  if (!isPlainJsonObject(common)) {
    return {};
  }

  const { _type: _type, ...withoutType } = common as Record<string, JsonValue>;
  return withoutType;
}

function commonPrototypeValue(values: readonly JsonValue[], variantKeys: ReadonlySet<string>, keyHint = ""): JsonValue | undefined {
  const [first] = values;
  if (first === undefined || variantKeys.has(keyHint)) {
    return undefined;
  }

  if (values.every((value) => jsonValuesEqual(value, first))) {
    return cloneJsonValue(first);
  }

  if (values.every(isPlainJsonObject)) {
    const objects = values as readonly JsonObject[];
    const commonKeys = Object.keys(objects[0] ?? {})
      .filter((key) => !variantKeys.has(key))
      .filter((key) => objects.every((object) => Object.hasOwn(object, key)))
      .sort();
    const common: Record<string, JsonValue> = {};
    for (const key of commonKeys) {
      const child = commonPrototypeValue(
        objects.map((object) => object[key] as JsonValue),
        variantKeys,
        key
      );
      if (child !== undefined) {
        common[key] = child;
      }
    }
    return Object.keys(common).length === 0 ? undefined : common;
  }

  return undefined;
}

function buildPrototypeDefinition(input: {
  readonly inheritedType: string | undefined;
  readonly definitionSemantics: string;
  readonly promptTemplate: JsonObject | undefined;
  readonly commonBody: JsonObject;
}): JsonObject {
  const definition: Record<string, JsonValue> = {
    _semantics: input.definitionSemantics.trim()
  };
  if (input.inheritedType !== undefined) {
    definition._extends = input.inheritedType;
  }
  if (input.promptTemplate !== undefined) {
    definition._promptTemplate = input.promptTemplate;
  }

  for (const [key, value] of Object.entries(input.commonBody)) {
    definition[key] = value;
  }
  return definition;
}

function buildPrototypeInstanceReplacement(input: {
  readonly original: JsonObject;
  readonly commonBody: JsonObject;
  readonly definitionType: string;
  readonly inheritedType: string | undefined;
}): JsonObject {
  const replacement: Record<string, JsonValue> = {
    _type: input.definitionType
  };
  const override = diffPrototypeOverride(input.original, input.commonBody, input.inheritedType);
  for (const [key, value] of Object.entries(override)) {
    replacement[key] = value;
  }
  return replacement;
}

function diffPrototypeOverride(original: JsonObject, commonBody: JsonObject, inheritedType: string | undefined): JsonObject {
  const override: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(original)) {
    if (key === "_type" && inheritedType !== undefined && value === inheritedType) {
      continue;
    }

    const commonValue = commonBody[key];
    if (commonValue === undefined) {
      override[key] = value;
      continue;
    }

    if (stablePrototypeLiteralKeys.has(key)) {
      override[key] = value;
      continue;
    }

    if (jsonValuesEqual(value, commonValue)) {
      continue;
    }

    if (isPlainJsonObject(value) && isPlainJsonObject(commonValue)) {
      const childOverride = diffPrototypeOverride(value, commonValue, undefined);
      if (Object.keys(childOverride).length > 0) {
        override[key] = childOverride;
      }
      continue;
    }

    override[key] = value;
  }
  return override;
}

function collectOverridePointers(value: JsonObject, sourcePointer: string): readonly string[] {
  const pointers: string[] = [];
  const visit = (child: JsonValue, pointer: string): void => {
    if (!isPlainJsonObject(child) && !Array.isArray(child)) {
      pointers.push(pointer);
      return;
    }

    if (isPlainJsonObject(child)) {
      for (const [key, nested] of Object.entries(child)) {
        if (key === "_type") {
          continue;
        }
        visit(nested, appendPointerSegment(pointer, key));
      }
      return;
    }

    child.forEach((nested, index) => visit(nested, appendPointerSegment(pointer, String(index))));
  };

  visit(value, sourcePointer);
  return pointers;
}

function definitionPatchOperations(root: JsonValue, definitionPointer: string, definition: JsonObject): readonly JsonPatchOperation[] {
  if (!jsonPointerExists(root, "/_definitions")) {
    return [
      {
        op: "add",
        path: "/_definitions",
        value: {
          [lastPointerSegment(definitionPointer)]: definition
        }
      }
    ];
  }

  return [
    {
      op: "add",
      path: definitionPointer,
      value: definition
    }
  ];
}

function buildPrototypeExtractionScore(input: {
  readonly repetitionCount: number;
  readonly commonFieldCount: number;
  readonly overrideFieldCount: number;
}): PrototypeExtractionScore {
  const totalFields = input.commonFieldCount + input.overrideFieldCount;
  const sharedFieldRatio = totalFields === 0 ? 0 : Number((input.commonFieldCount / totalFields).toFixed(3));
  const readabilityRisk: PrototypeExtractionRisk =
    sharedFieldRatio < 0.35 || input.overrideFieldCount > input.commonFieldCount * 2 ? "high" : sharedFieldRatio < 0.55 ? "medium" : "low";
  const overExtractionRisk: PrototypeExtractionRisk =
    input.repetitionCount < 3 && sharedFieldRatio < 0.65 ? "high" : input.repetitionCount < 3 ? "medium" : "low";

  return {
    repetitionCount: input.repetitionCount,
    commonFieldCount: input.commonFieldCount,
    overrideFieldCount: input.overrideFieldCount,
    sharedFieldRatio,
    readabilityRisk,
    overExtractionRisk,
    summary: `${input.repetitionCount} instance(s), ${input.commonFieldCount} shared field(s), ${input.overrideFieldCount} override field(s), shared ratio ${sharedFieldRatio}.`
  };
}

function countPrototypeFields(value: JsonValue | undefined): number {
  if (value === undefined) {
    return 0;
  }

  if (Array.isArray(value)) {
    return value.reduce((total, child) => total + countPrototypeFields(child), 0);
  }

  if (isPlainJsonObject(value)) {
    return Object.values(value).reduce<number>((total, child) => total + 1 + countPrototypeFields(child), 0);
  }

  return 1;
}

function hashPrototypeProposalId(sourcePointers: readonly string[], definitionType: string): string {
  return hashEditorText(`${definitionType}\n${sourcePointers.join("\n")}`);
}
