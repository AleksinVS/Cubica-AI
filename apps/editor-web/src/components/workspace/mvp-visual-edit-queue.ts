import {
  applyJsonPatch,
  isPlainJsonObject,
  parseJsonPointer,
  readJsonPointer,
  type EditorChangeSet,
  type JsonPatchOperation,
  type JsonValue
} from "@cubica/editor-engine";

export type MvpVisualEditStatus = "queued" | "inflight" | "confirmed" | "rejected" | "conflict";

export interface MvpVisualEditEntry {
  readonly operationId: string;
  readonly contextKey: string;
  readonly changeSet: EditorChangeSet;
  readonly status: MvpVisualEditStatus;
  readonly reason?: string;
}

export interface MvpVisualEditRequest {
  readonly operationId: string;
  readonly contextKey: string;
  readonly changeSet: EditorChangeSet;
  readonly baseDocuments: ReadonlyMap<string, string>;
}

interface ReadCondition {
  readonly path: string;
  readonly exists: boolean;
  readonly value?: JsonValue;
  readonly objectParent?: boolean;
}

interface PatchStep {
  readonly filePath: string;
  readonly conditions: readonly ReadCondition[];
  readonly write?: Extract<JsonPatchOperation, { readonly op: "add" | "replace" }>;
}

interface InternalEntry {
  readonly operationId: string;
  readonly contextKey: string;
  readonly changeSet: EditorChangeSet;
  status: MvpVisualEditStatus;
  reason?: string;
  readonly steps: readonly PatchStep[];
}

const identityKeys = ["_id", "id"] as const;
// These are the authoring instance type and definition inheritance edge.
// Missing keys are reads too: adding one can change the resolved property owner.
const dependencyKeys = ["_type", "type", "_extends"] as const;

function equalJson(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => equalJson(value, right[index]));
  }
  if (isPlainJsonObject(left) || isPlainJsonObject(right)) {
    if (!isPlainJsonObject(left) || !isPlainJsonObject(right)) return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && equalJson(left[key], right[key]));
  }
  return false;
}

function condition(root: JsonValue, path: string): ReadCondition {
  const value = readJsonPointer(root, path);
  return value === undefined ? { path, exists: false } : { path, exists: true, value };
}

function conditionMatches(root: JsonValue, expected: ReadCondition): boolean {
  const actual = condition(root, expected.path);
  if (expected.objectParent) return isPlainJsonObject(actual.value);
  return actual.exists === expected.exists && (!expected.exists || equalJson(actual.value, expected.value));
}

function sourceConditions(root: JsonValue, test: Extract<JsonPatchOperation, { readonly op: "test" }>, writes: readonly string[]): ReadCondition[] {
  const related = writes.filter((path) => path.startsWith(`${test.path}/`));
  const source = readJsonPointer(root, test.path);
  if (related.length === 0 || !isPlainJsonObject(source)) return [condition(root, test.path)];

  const conditions: ReadCondition[] = [];
  for (const writePath of related) {
    const writeSegments = parseJsonPointer(writePath);
    const sourceSegments = parseJsonPointer(test.path);
    let nodePath = test.path;
    let foundIdentity = false;
    for (let index = sourceSegments.length; index < writeSegments.length; index += 1) {
      const node = readJsonPointer(root, nodePath);
      if (isPlainJsonObject(node)) {
        for (const key of [...identityKeys, ...dependencyKeys]) {
          conditions.push(condition(root, `${nodePath}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`));
          if (Object.hasOwn(node, key) && identityKeys.some((candidate) => candidate === key)) foundIdentity = true;
        }
      }
      const segment = writeSegments[index];
      nodePath += `/${segment.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    }
    // An indexed entity without a stable key cannot be proved to be the same
    // target after a sibling insertion or replacement. Keep its broad guard.
    if (sourceSegments.some((segment) => /^\d+$/u.test(segment)) && !foundIdentity) return [condition(root, test.path)];
  }
  return conditions;
}

function parseDocuments(documents: ReadonlyMap<string, string>): Map<string, JsonValue> {
  return new Map([...documents].map(([path, text]) => [path, JSON.parse(text) as JsonValue]));
}

function captureSteps(changeSet: EditorChangeSet, documents: ReadonlyMap<string, string>): readonly PatchStep[] {
  if ((changeSet.textPatches?.length ?? 0) + (changeSet.fileCreates?.length ?? 0) +
      (changeSet.fileDeletes?.length ?? 0) + (changeSet.fileRenames?.length ?? 0) > 0 || changeSet.jsonPatches.length === 0) {
    throw new Error("The visual edit queue accepts JSON patches only.");
  }
  const values = parseDocuments(documents);
  const steps: PatchStep[] = [];
  const definitionReads = new Set<string>();
  let writeCount = 0;
  for (const patch of changeSet.jsonPatches) {
    let current = values.get(patch.filePath);
    if (current === undefined) throw new Error(`Missing authoring document: ${patch.filePath}`);
    if (!definitionReads.has(patch.filePath)) {
      definitionReads.add(patch.filePath);
      // A local visual override may have been calculated from inherited
      // defaults. Without a dependency graph, any definition change is unsafe.
      if (readJsonPointer(current, "/_definitions") !== undefined) {
        steps.push({ filePath: patch.filePath, conditions: [condition(current, "/_definitions")] });
      }
    }
    const writePaths = patch.operations.filter((op) => op.op !== "test").map((op) => op.path);
    for (const operation of patch.operations) {
      if (operation.op === "test") {
        // Preserve the original exact test at capture time. The broad source
        // guard is narrowed only for later rebasing of independent fields.
        current = applyJsonPatch(current, [operation]);
        steps.push({ filePath: patch.filePath, conditions: sourceConditions(current, operation, writePaths) });
        continue;
      }
      if (operation.op === "remove" || operation.path === "") {
        throw new Error("The visual edit queue accepts only scalar or style add/replace writes.");
      }
      const targetKey = parseJsonPointer(operation.path).at(-1);
      const objectWrite = typeof operation.value === "object" && operation.value !== null;
      const emptyContainerCreation = operation.op === "add" && isPlainJsonObject(operation.value) &&
        Object.keys(operation.value).length === 0 && (targetKey === "props" || targetKey === "style");
      if (objectWrite && !emptyContainerCreation && (!isPlainJsonObject(operation.value) || targetKey !== "style")) {
        throw new Error("The visual edit queue accepts only scalar or style add/replace writes.");
      }
      const parentPath = operation.path.slice(0, operation.path.lastIndexOf("/"));
      const parent = readJsonPointer(current, parentPath);
      if (!isPlainJsonObject(parent)) throw new Error(`Visual edit target must be an object member: ${operation.path}`);
      const prior = condition(current, operation.path);
      if (emptyContainerCreation && prior.exists) throw new Error(`Visual edit parent already exists: ${operation.path}`);
      if (operation.op === "replace" && !prior.exists) throw new Error(`Visual edit target is missing: ${operation.path}`);
      current = applyJsonPatch(current, [operation]);
      steps.push({ filePath: patch.filePath, conditions: [{ path: parentPath, exists: true, objectParent: true }, prior], write: operation });
      writeCount += 1;
    }
    values.set(patch.filePath, current);
  }
  if (writeCount === 0) throw new Error("Visual edit has no writes.");
  return steps;
}

function rebase(entry: InternalEntry, documents: ReadonlyMap<string, string>): {
  readonly changeSet: EditorChangeSet;
  readonly documents: ReadonlyMap<string, string>;
} {
  const values = parseDocuments(documents);
  const patches = new Map<string, JsonPatchOperation[]>();
  for (const step of entry.steps) {
    let current = values.get(step.filePath);
    if (current === undefined) throw new Error(`Missing authoring document: ${step.filePath}`);
    const operations = patches.get(step.filePath) ?? [];
    for (const expected of step.conditions) {
      if (!conditionMatches(current, expected)) throw new Error(`Read dependency changed: ${step.filePath}#${expected.path || "/"}`);
      if (expected.exists && !expected.objectParent) operations.push({ op: "test", path: expected.path, value: expected.value as JsonValue });
    }
    if (step.write !== undefined) {
      current = applyJsonPatch(current, [step.write]);
      operations.push(step.write);
      values.set(step.filePath, current);
    }
    patches.set(step.filePath, operations);
  }
  const projected = new Map(documents);
  for (const filePath of patches.keys()) projected.set(filePath, `${JSON.stringify(values.get(filePath), null, 2)}\n`);
  return {
    changeSet: { ...entry.changeSet, jsonPatches: [...patches].map(([filePath, operations]) => ({ filePath, operations })) },
    documents: projected
  };
}

/** One serialized authoring queue per editor context; confirmed texts stay separate from optimistic projections. */
export function createMvpVisualEditQueue(contextKey: string, confirmedDocuments: ReadonlyMap<string, string>) {
  let activeContext = contextKey;
  const confirmedByContext = new Map<string, ReadonlyMap<string, string>>([[contextKey, new Map(confirmedDocuments)]]);
  const entries: InternalEntry[] = [];
  const inflightByContext = new Map<string, MvpVisualEditRequest>();

  function inflightEntry(operationId: string): [string, MvpVisualEditRequest] | undefined {
    return [...inflightByContext].find(([, request]) => request.operationId === operationId);
  }

  function projectedFor(context: string): ReadonlyMap<string, string> {
    let projected = new Map(confirmedByContext.get(context) ?? []);
    for (const entry of entries) {
      if (entry.contextKey !== context || entry.status === "confirmed" || entry.status === "rejected" || entry.status === "conflict") continue;
      try {
        projected = new Map(rebase(entry, projected).documents);
      } catch (error) {
        if (entry.status !== "inflight") entry.status = "conflict";
        entry.reason = error instanceof Error ? error.message : String(error);
      }
    }
    return projected;
  }

  return {
    enqueue(changeSet: EditorChangeSet): MvpVisualEditEntry {
      if (entries.some((entry) => entry.operationId === changeSet.id)) throw new Error(`Duplicate operationId: ${changeSet.id}`);
      const draft = structuredClone(changeSet);
      const steps = captureSteps(draft, projectedFor(activeContext));
      const entry: InternalEntry = { operationId: draft.id, contextKey: activeContext, changeSet: draft, status: "queued", steps };
      entries.push(entry);
      return { ...entry };
    },
    next(): MvpVisualEditRequest | undefined {
      const inflight = inflightByContext.get(activeContext);
      if (inflight !== undefined) return inflight;
      for (const entry of entries) {
        if (entry.status !== "queued" || entry.contextKey !== activeContext) continue;
        const baseDocuments = confirmedByContext.get(entry.contextKey);
        if (baseDocuments === undefined) continue;
        // Re-evaluate against the latest confirmed base, excluding all drafts.
        // Earlier queued edits must go first; otherwise a later edit could be
        // sent against a base that never contained its read dependencies.
        const earlier = entries.some((candidate) => candidate.contextKey === entry.contextKey &&
          candidate.status === "queued" && entries.indexOf(candidate) < entries.indexOf(entry));
        if (earlier) continue;
        try {
          const rebased = rebase(entry, baseDocuments);
          entry.status = "inflight";
          const request = { operationId: entry.operationId, contextKey: entry.contextKey,
            changeSet: rebased.changeSet, baseDocuments: new Map(baseDocuments) };
          inflightByContext.set(entry.contextKey, request);
          return request;
        } catch (error) {
          entry.status = "conflict";
          entry.reason = error instanceof Error ? error.message : String(error);
        }
      }
      return undefined;
    },
    acknowledge(operationId: string, serverDocuments: ReadonlyMap<string, string>): void {
      const found = inflightEntry(operationId);
      if (found === undefined) throw new Error(`Unexpected acknowledgement: ${operationId}`);
      const entry = entries.find((candidate) => candidate.operationId === operationId) as InternalEntry;
      confirmedByContext.set(entry.contextKey, new Map(serverDocuments));
      entry.status = "confirmed";
      entry.reason = undefined;
      inflightByContext.delete(found[0]);
      projectedFor(entry.contextKey);
    },
    reject(operationId: string, reason = "Authoring edit rejected"): void {
      const found = inflightEntry(operationId);
      if (found === undefined) throw new Error(`Unexpected rejection: ${operationId}`);
      const entry = entries.find((candidate) => candidate.operationId === operationId) as InternalEntry;
      entry.status = "rejected";
      entry.reason = reason;
      inflightByContext.delete(found[0]);
      projectedFor(entry.contextKey);
    },
    dismiss(operationId: string, reason = "Draft dismissed"): void {
      const entry = entries.find((candidate) => candidate.operationId === operationId);
      if (entry === undefined || (entry.status !== "queued" && entry.status !== "conflict")) {
        throw new Error(`Cannot dismiss visual edit: ${operationId}`);
      }
      entry.status = "rejected";
      entry.reason = reason;
      projectedFor(entry.contextKey);
    },
    retryConflict(operationId: string): boolean {
      const entry = entries.find((candidate) => candidate.operationId === operationId);
      if (entry === undefined || entry.status !== "conflict") throw new Error(`No conflicted visual edit: ${operationId}`);
      // Retry never retargets the draft. It only rechecks its original reads.
      const projected = projectedFor(entry.contextKey);
      try {
        rebase(entry, projected);
        entry.status = "queued";
        entry.reason = undefined;
        return true;
      } catch {
        return false;
      }
    },
    updateConfirmedDocuments(documents: ReadonlyMap<string, string>): void {
      confirmedByContext.set(activeContext, new Map(documents));
      projectedFor(activeContext);
    },
    setContext(nextContextKey: string, documents: ReadonlyMap<string, string>): void {
      activeContext = nextContextKey;
      confirmedByContext.set(nextContextKey, new Map(documents));
      projectedFor(nextContextKey);
    },
    get projectedDocuments(): ReadonlyMap<string, string> { return projectedFor(activeContext); },
    get entries(): readonly MvpVisualEditEntry[] { return entries.map(({ steps: _steps, ...entry }) => ({ ...entry })); },
    get pending(): readonly MvpVisualEditEntry[] {
      return this.entries.filter((entry) => entry.contextKey === activeContext &&
        (entry.status === "queued" || entry.status === "inflight" || entry.status === "conflict"));
    }
  };
}
