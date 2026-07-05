/**
 * Operation risk policy for editor ChangeSets (ADR-057 §4.5, §5; UX doc §6.6).
 *
 * Every agent-produced `EditorChangeSet` — whichever input channel it came from
 * (panel chat, session chat, region prompt, text mode) — must pass through ONE
 * risk classification before the shared dry-run / validation / undo-journal
 * pipeline. `classifyChangeSet` inspects the bounded operations in a ChangeSet
 * and returns the HIGHEST matching risk plus human-readable reasons:
 *
 *   - "safe":       replace of a leaf value (text, label, style, number).
 *   - "structural": add/remove of collection elements or object fields,
 *                   reordering, or file/text operations inside authoring/assets.
 *   - "dangerous":  changing an entity `id`, retargeting a reference, deleting an
 *                   entity that still has incoming references, or touching a file
 *                   outside authoring/assets. Dangerous changes require a human
 *                   approval envelope (ADR-047) before apply.
 *
 * Entity identity and "incoming reference" facts come exclusively from the
 * supplied `EditorEntityProjection` (ADR-052) — this module never builds its own
 * index. The engine stays game-agnostic and renderer-agnostic: identity and
 * reference fields are recognised by a generic naming convention, never by a
 * hardcoded game id or manifest-specific key list.
 *
 * The `reasons` strings are English to match the existing engine diagnostic
 * message convention (see `entity-projection.ts` / `change-set.ts`); the Russian
 * strings elsewhere in the engine belong to the human-facing prompt projection,
 * which is a different artifact.
 */
import { isPlainJsonObject } from "./shared.ts";
import { lastPointerSegmentOrRoot } from "./json-pointer-patch.ts";
import { isSameOrDescendantPointer } from "./semantics.ts";
import type {
  ChangeRisk,
  ClassifyChangeSetResult,
  EditorChangeSet,
  EditorEntity,
  EditorEntityProjection,
  JsonPatchOperation,
  JsonValue
} from "./types.ts";

/** Total order used to keep the highest risk seen so far ("max risk wins"). */
const RISK_ORDER: Readonly<Record<ChangeRisk, number>> = {
  safe: 0,
  structural: 1,
  dangerous: 2
};

/**
 * Classifies the operation risk of a bounded editor ChangeSet.
 *
 * The result is additive and deterministic: every operation is inspected, the
 * highest risk wins, and each operation that raised the risk above "safe"
 * contributes a deduplicated, human-readable reason for the summary and the
 * approval envelope.
 */
export function classifyChangeSet(
  changeSet: EditorChangeSet,
  projection: EditorEntityProjection
): ClassifyChangeSetResult {
  let risk: ChangeRisk = "safe";
  const reasons: string[] = [];

  /** Raises the running risk and records the reason once (deduplicated). */
  const escalate = (candidate: ChangeRisk, reason: string): void => {
    if (RISK_ORDER[candidate] > RISK_ORDER[risk]) {
      risk = candidate;
    }
    // Only collect reasons for noteworthy (non-safe) operations; a fully safe
    // ChangeSet intentionally returns an empty reasons list.
    if (candidate !== "safe" && !reasons.includes(reason)) {
      reasons.push(reason);
    }
  };

  for (const patch of changeSet.jsonPatches) {
    for (const operation of patch.operations) {
      classifyJsonPatchOperation(patch.filePath, operation, projection, escalate);
    }
  }

  for (const create of changeSet.fileCreates ?? []) {
    escalateFileOperation(create.filePath, "creates file", escalate);
  }
  for (const remove of changeSet.fileDeletes ?? []) {
    escalateFileOperation(remove.filePath, "deletes file", escalate);
  }
  for (const rename of changeSet.fileRenames ?? []) {
    escalateFileOperation(rename.fromFilePath, "renames file", escalate);
    escalateFileOperation(rename.toFilePath, "renames file to", escalate);
  }
  for (const textPatch of changeSet.textPatches ?? []) {
    escalateFileOperation(textPatch.filePath, "edits file text of", escalate);
  }

  return { risk, reasons };
}

/** Classifies a single JSON Patch operation against the entity projection. */
function classifyJsonPatchOperation(
  filePath: string,
  operation: JsonPatchOperation,
  projection: EditorEntityProjection,
  escalate: (candidate: ChangeRisk, reason: string) => void
): void {
  // `test` operations are read-only guards; they never mutate the document.
  if (operation.op === "test") {
    return;
  }

  const key = lastPointerSegmentOrRoot(operation.path);

  if (operation.op === "replace") {
    if (isIdentityField(key)) {
      escalate("dangerous", `changes identity field ${filePath}#${operation.path}`);
    } else if (isReferenceField(key)) {
      escalate("dangerous", `retargets reference ${filePath}#${operation.path}`);
    } else if (isContainerValue(operation.value)) {
      // Replacing a whole object/array can add or drop members; treat as
      // structural rather than a leaf value edit.
      escalate("structural", `replaces the whole structure at ${filePath}#${operation.path}`);
    } else {
      escalate("safe", "");
    }
    return;
  }

  if (operation.op === "add") {
    if (isIdentityField(key)) {
      escalate("dangerous", `assigns identity field ${filePath}#${operation.path}`);
    } else {
      escalate("structural", `adds ${filePath}#${operation.path}`);
    }
    return;
  }

  // op === "remove": removing a collection element or field is structural, but
  // removing an entity that still has incoming references is dangerous.
  const removed = removedEntityIncomingReferences(projection, filePath, operation.path);
  if (removed.hasIncoming) {
    escalate(
      "dangerous",
      `removes entity "${removed.label}" (${filePath}#${operation.path}) with ${removed.count} incoming reference(s)`
    );
  } else {
    escalate("structural", `removes ${filePath}#${operation.path}`);
  }
}

/** Classifies a whole-file or free-form-text operation by its location. */
function escalateFileOperation(
  filePath: string,
  action: string,
  escalate: (candidate: ChangeRisk, reason: string) => void
): void {
  if (isWithinAuthoringOrAssets(filePath)) {
    escalate("structural", `${action} ${filePath} inside authoring/assets`);
  } else {
    escalate("dangerous", `${action} ${filePath} outside authoring/assets`);
  }
}

/** An authoring identity field: its value is an entity's own id, not a link. */
function isIdentityField(key: string): boolean {
  return key === "id" || key === "_id";
}

/** camelCase reference suffix, e.g. `actionId`, `screenId`, `contentRef`. */
const CAMEL_REFERENCE_SUFFIX = /[a-z0-9](Id|Ids|Ref|Refs)$/;
/** snake_case reference suffix, e.g. `screen_id`, `action_ids`. */
const SNAKE_REFERENCE_SUFFIX = /_(id|ids|ref|refs)$/;

/**
 * A reference (link) field points at another entity's id. Detection is by a
 * generic naming convention so the engine stays game-agnostic. The bare
 * identity fields (`id`, `_id`) are excluded because they carry the owner's own
 * id, not a link to something else. The lowercase/underscore boundary before the
 * suffix avoids false positives such as `grid` or `valid`.
 */
function isReferenceField(key: string): boolean {
  if (isIdentityField(key)) {
    return false;
  }
  return CAMEL_REFERENCE_SUFFIX.test(key) || SNAKE_REFERENCE_SUFFIX.test(key);
}

/** True when the replacement value is a whole object or array, not a scalar. */
function isContainerValue(value: JsonValue): boolean {
  return Array.isArray(value) || isPlainJsonObject(value);
}

/**
 * A path is "inside authoring/assets" when any of its segments is `authoring`
 * or `assets` (for example `games/<id>/authoring/...` or `.../assets/...`). Any
 * other location is out of the safe editing surface and escalates to dangerous.
 */
function isWithinAuthoringOrAssets(filePath: string): boolean {
  const segments = filePath.split("/").filter((segment) => segment !== "");
  return segments.includes("authoring") || segments.includes("assets");
}

/**
 * Uses the entity projection to decide whether a removed pointer deletes an
 * entity that still has incoming references from OTHER entities.
 *
 * An entity is considered removed when its primary source pointer is the removed
 * pointer or lies below it (so removing a container also removes the entities it
 * holds). Incoming references are read from `entitiesBySourcePointer`, which maps
 * a source pointer to every entity that lists it among its sources — the owner
 * plus any entity that references it as a facet. Referrers are those entities
 * with a different `entityId` than the removed entity.
 */
function removedEntityIncomingReferences(
  projection: EditorEntityProjection,
  filePath: string,
  removedPointer: string
): { readonly hasIncoming: boolean; readonly label: string; readonly count: number } {
  let hasIncoming = false;
  let label = "";
  let count = 0;

  for (const entity of projection.entities) {
    const primary = entity.primarySource;
    if (primary.filePath !== filePath || !isSameOrDescendantPointer(primary.pointer, removedPointer)) {
      continue;
    }

    const referrers = incomingReferrers(projection, entity);
    if (referrers.length > 0) {
      hasIncoming = true;
      count += referrers.length;
      if (label === "") {
        label = entity.label;
      }
    }
  }

  return { hasIncoming, label, count };
}

/** Entities (other than the entity itself) that reference its primary source. */
function incomingReferrers(projection: EditorEntityProjection, entity: EditorEntity): readonly EditorEntity[] {
  const key = `${entity.primarySource.filePath}#${entity.primarySource.pointer}`;
  const holders = projection.entitiesBySourcePointer.get(key) ?? [];
  return holders.filter((candidate) => candidate.entityId !== entity.entityId);
}
