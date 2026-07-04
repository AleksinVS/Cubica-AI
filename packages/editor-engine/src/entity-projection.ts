/**
 * Editor entity projection (ADR-052) plus manifest chronology timeline.
 *
 * The entity projection is an in-memory index over one or more authoring
 * documents (game/ui). It records SOURCE POINTERS and derived labels, never
 * nested copies of authoring objects, so rebuilding or discarding it can never
 * change gameplay or UI output. It also cross-links steps to their actions,
 * content, and UI screens, emitting diagnostics for unresolved or ambiguous
 * links. The YAML projection renders a compact, human-facing view for prompt
 * assembly, and the timeline builder derives flow/step chronology.
 */
import { isPlainJsonObject, isScalar, normalizeToken, titleFromToken } from "./shared.ts";
import { appendPointerSegment, buildJsonPointer, lastPointerSegmentOrRoot, readJsonPointer } from "./json-pointer-patch.ts";
import { isSameOrDescendantPointer, resolveEntityTreeLabel } from "./semantics.ts";
import type {
  BuildEditorEntityProjectionInput,
  BuildEditorEntityYamlProjectionInput,
  BuildManifestTimelineInput,
  DiagnosticSeverity,
  EditorEntity,
  EditorEntityDocumentKind,
  EditorEntityFacetKind,
  EditorEntityFieldDictionaryEntry,
  EditorEntityKind,
  EditorEntityProjection,
  EditorEntityProjectionDiagnostic,
  EditorEntityProjectionDiagnosticCode,
  EditorEntityProjectionDocument,
  EditorEntitySourcePointer,
  EditorEntityYamlProjection,
  JsonObject,
  JsonValue,
  ManifestTimeline,
  ManifestTimelineEntry,
  PreviewEntityDescriptor
} from "./types.ts";

/**
 * Builds the project-level editor entity projection accepted in ADR-052.
 *
 * The projection is intentionally an in-memory index. It stores source pointers
 * and derived labels, never nested copies of authoring objects, so deleting or
 * rebuilding it cannot change gameplay or UI output.
 */
export function buildEditorEntityProjection(input: BuildEditorEntityProjectionInput): EditorEntityProjection {
  const documents = input.documents.map(normalizeEditorEntityDocument);
  const sourceHashes = buildProjectionSourceHashes(documents);
  const diagnostics: EditorEntityProjectionDiagnostic[] = [];
  const builders = new Map<string, MutableEditorEntityBuilder>();
  const actionRefsById = collectActionRefsById(documents);
  const contentRefsById = collectContentRefsById(documents);
  const uiScreenRefsById = collectUiScreenRefsById(documents);

  for (const document of documents) {
    const expectedHash = input.expectedSourceHashes?.[document.filePath];
    if (expectedHash !== undefined && document.sourceHash !== undefined && expectedHash !== document.sourceHash) {
      diagnostics.push({
        severity: "warning",
        code: "stale-source-hash",
        source: createProjectionSourcePointer(document, "", "document"),
        message: `Projection input hash for ${document.filePath} changed.`
      });
    }
  }

  for (const document of documents.filter((candidate) => candidate.documentKind === "game")) {
    collectGameEditorEntities(document, builders, diagnostics, actionRefsById, contentRefsById, uiScreenRefsById);
  }

  for (const document of documents.filter((candidate) => candidate.documentKind === "ui")) {
    collectUiEditorEntities(document, builders, actionRefsById);
  }

  attachPreviewEntityFacets(input.previewEntities ?? [], documents, builders);

  const entities = [...builders.values()]
    .map(finalizeEditorEntityBuilder)
    .sort((left, right) => left.entityId.localeCompare(right.entityId));
  const entityById = new Map(entities.map((entity) => [entity.entityId, entity]));
  const entitiesBySourcePointer = buildEntitiesBySourcePointer(entities);
  const entityDiagnostics = entities.flatMap((entity) => entity.diagnostics);

  return {
    projectionVersion: 1,
    gameId: input.gameId,
    sourceHashes,
    entities,
    entityById,
    entitiesBySourcePointer,
    diagnostics: [...diagnostics, ...entityDiagnostics]
  };
}

/**
 * Creates a compact YAML-like, human-facing projection for prompt assembly.
 *
 * Technical keys such as `_type`, `_label`, `_prompt` and `$schema` are hidden
 * by default. A field dictionary can still explicitly mark a technical key as
 * meaningful when product UX needs it.
 *
 * NOTE: test-only export (LEGACY-0018): no production consumer imports this
 * builder yet; it is exercised by `tests/index.test.ts`, so it stays exported.
 */
export function buildEditorEntityYamlProjection(input: BuildEditorEntityYamlProjectionInput): EditorEntityYamlProjection {
  const documents = input.documents.map(normalizeEditorEntityDocument);
  const documentsByPath = new Map(documents.map((document) => [document.filePath, document]));
  const maxDepth = Math.max(1, input.maxDepth ?? 4);
  const hiddenTechnicalPointers: EditorEntitySourcePointer[] = [];
  const diagnostics: EditorEntityProjectionDiagnostic[] = [];
  const lines = [`Сущность: ${formatYamlScalar(input.entity.label)}`, `Тип: ${formatYamlScalar(input.entity.kind)}`];

  for (const facetKind of orderedEditorEntityFacetKinds) {
    const facetSources = input.entity.facets[facetKind] ?? [];
    if (facetSources.length === 0) {
      continue;
    }

    lines.push(`${editorEntityFacetLabel(facetKind)}:`);
    for (const source of facetSources) {
      const document = documentsByPath.get(source.filePath);
      const value = document?.json === undefined ? undefined : readJsonPointer(document.json, source.pointer);
      if (value === undefined) {
        diagnostics.push({
          severity: "warning",
          code: "unresolved-source-pointer",
          source,
          message: `Cannot build YAML projection because ${source.filePath}#${source.pointer} does not resolve.`
        });
        lines.push(`  - ${formatYamlScalar(source.label ?? source.role ?? source.pointer)}: "[unavailable]"`);
        continue;
      }

      const sectionLabel = source.label ?? source.role ?? titleFromToken(lastPointerSegmentOrRoot(source.pointer));
      lines.push(`  - ${formatYamlScalar(sectionLabel)}:`);
      appendMeaningfulYamlLines({
        lines,
        value,
        pointer: source.pointer,
        indent: 6,
        fieldDictionary: input.fieldDictionary ?? [],
        hiddenTechnicalPointers,
        hiddenSourceBase: source,
        maxDepth
      });
    }
  }

  for (const hidden of hiddenTechnicalPointers) {
    diagnostics.push({
      severity: "warning",
      code: "hidden-technical-field",
      source: hidden,
      message: `Technical field ${hidden.filePath}#${hidden.pointer} is hidden from the user-facing YAML projection.`
    });
  }

  return {
    text: `${lines.join("\n")}\n`,
    hiddenTechnicalPointers,
    diagnostics
  };
}

/** Builds timeline entries from authoring v2 `root.logic.flows[].steps[]`. */
export function buildManifestChronologyTimeline(input: BuildManifestTimelineInput): ManifestTimeline {
  const snapshot = input.snapshot;
  const entries: ManifestTimelineEntry[] = [];
  const rootEntryIds: string[] = [];

  if (snapshot.json === undefined) {
    return createManifestTimeline(entries, rootEntryIds);
  }

  const flows = readJsonPointer(snapshot.json, "/root/logic/flows");
  if (!Array.isArray(flows)) {
    return createManifestTimeline(entries, rootEntryIds);
  }

  flows.forEach((flow, flowIndex) => {
    if (!isPlainJsonObject(flow)) {
      return;
    }

    const flowPointer = buildJsonPointer(["root", "logic", "flows", String(flowIndex)]);
    const flowId = readStringProperty(flow, "id") ?? `flow-${flowIndex}`;
    const flowEntry: ManifestTimelineEntry = {
      id: flowPointer,
      pointer: flowPointer,
      kind: "flow",
      label: resolveEntityTreeLabel(flow, flowPointer),
      order: flowIndex,
      flowId,
      actionIds: []
    };
    entries.push(flowEntry);
    rootEntryIds.push(flowEntry.id);

    const steps = flow.steps;
    if (!Array.isArray(steps)) {
      return;
    }

    steps.forEach((step, stepIndex) => {
      if (!isPlainJsonObject(step)) {
        return;
      }

      const stepPointer = appendPointerSegment(appendPointerSegment(flowPointer, "steps"), String(stepIndex));
      entries.push({
        id: stepPointer,
        pointer: stepPointer,
        kind: "step",
        label: resolveEntityTreeLabel(step, stepPointer),
        order: stepIndex,
        parentId: flowEntry.id,
        flowId,
        stepId: readStringProperty(step, "id") ?? `step-${stepIndex}`,
        screenId: readStringProperty(step, "screenId"),
        actionIds: readStringArrayProperty(step, "actionIds"),
        nextStepId: readStringProperty(step, "next")
      });
    });
  });

  return createManifestTimeline(entries, rootEntryIds);
}

const orderedEditorEntityFacetKinds: readonly EditorEntityFacetKind[] = ["logic", "content", "state", "view", "design", "plugin"];

type NormalizedEditorEntityProjectionDocument = EditorEntityProjectionDocument & {
  readonly documentKind: EditorEntityDocumentKind;
};

interface MutableEditorEntityBuilder {
  readonly entityId: string;
  readonly kind: EditorEntityKind;
  readonly label: string;
  readonly primarySource: EditorEntitySourcePointer;
  readonly facets: Map<EditorEntityFacetKind, EditorEntitySourcePointer[]>;
  readonly diagnostics: EditorEntityProjectionDiagnostic[];
}

function normalizeEditorEntityDocument(document: EditorEntityProjectionDocument): NormalizedEditorEntityProjectionDocument {
  const inferredKind = document.documentKind ?? inferEditorEntityDocumentKind(document.json);
  return {
    ...document,
    documentKind: inferredKind,
    channel: document.channel ?? inferEditorEntityDocumentChannel(document.json)
  };
}

function inferEditorEntityDocumentKind(json: JsonValue | undefined): EditorEntityDocumentKind {
  if (!isPlainJsonObject(json)) {
    return "unknown";
  }

  const manifestType = typeof json._manifestType === "string" ? json._manifestType : undefined;
  if (manifestType === "game" || manifestType === "ui") {
    return manifestType;
  }

  if (manifestType === "design") {
    return "design";
  }

  return "unknown";
}

function inferEditorEntityDocumentChannel(json: JsonValue | undefined): string | undefined {
  if (!isPlainJsonObject(json)) {
    return undefined;
  }

  return typeof json._channel === "string" && json._channel.trim() !== "" ? json._channel.trim() : undefined;
}

function buildProjectionSourceHashes(
  documents: readonly NormalizedEditorEntityProjectionDocument[]
): Readonly<Record<string, string>> {
  const sourceHashes: Record<string, string> = {};
  for (const document of documents) {
    if (document.sourceHash !== undefined) {
      sourceHashes[document.filePath] = document.sourceHash;
    }
  }
  return sourceHashes;
}

function collectGameEditorEntities(
  document: NormalizedEditorEntityProjectionDocument,
  builders: Map<string, MutableEditorEntityBuilder>,
  diagnostics: EditorEntityProjectionDiagnostic[],
  actionRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>,
  contentRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>,
  uiScreenRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>
): void {
  const root = document.json === undefined ? undefined : readJsonPointer(document.json, "/root");
  if (isPlainJsonObject(root)) {
    const rootSource = createProjectionSourcePointer(document, "/root", "game-root", resolveEntityTreeLabel(root, "/root"));
    const rootEntity = ensureEditorEntityBuilder(builders, {
      entityId: editorEntityId("game-root", document.filePath, "/root", readStringProperty(root, "id")),
      kind: "game-root",
      label: rootSource.label ?? "Game",
      primarySource: rootSource
    });
    addEditorEntityFacet(rootEntity, "logic", rootSource);
  }

  collectGameFlowAndStepEntities(document, builders, diagnostics, actionRefsById, contentRefsById, uiScreenRefsById);
  collectGameActionEntities(document, builders, contentRefsById);
  collectGameMetricEntities(document, builders);
  collectGameStateModelEntities(document, builders);
}

function collectGameFlowAndStepEntities(
  document: NormalizedEditorEntityProjectionDocument,
  builders: Map<string, MutableEditorEntityBuilder>,
  diagnostics: EditorEntityProjectionDiagnostic[],
  actionRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>,
  contentRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>,
  uiScreenRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>
): void {
  if (document.json === undefined) {
    return;
  }

  const flows = readJsonPointer(document.json, "/root/logic/flows");
  if (!Array.isArray(flows)) {
    return;
  }

  flows.forEach((flow, flowIndex) => {
    if (!isPlainJsonObject(flow)) {
      return;
    }

    const flowPointer = buildJsonPointer(["root", "logic", "flows", String(flowIndex)]);
    const flowSource = createProjectionSourcePointer(document, flowPointer, "flow", resolveEntityTreeLabel(flow, flowPointer));
    const flowEntity = ensureEditorEntityBuilder(builders, {
      entityId: editorEntityId("game-flow", document.filePath, flowPointer, readStringProperty(flow, "id")),
      kind: "game-flow",
      label: flowSource.label ?? "Flow",
      primarySource: flowSource
    });
    addEditorEntityFacet(flowEntity, "logic", flowSource);

    const steps = flow.steps;
    if (!Array.isArray(steps)) {
      return;
    }

    steps.forEach((step, stepIndex) => {
      if (!isPlainJsonObject(step)) {
        return;
      }

      const stepPointer = appendPointerSegment(appendPointerSegment(flowPointer, "steps"), String(stepIndex));
      const stepSource = createProjectionSourcePointer(document, stepPointer, "step", resolveEntityTreeLabel(step, stepPointer));
      const stepEntity = ensureEditorEntityBuilder(builders, {
        entityId: editorEntityId("game-step", document.filePath, stepPointer, readStringProperty(step, "id")),
        kind: "game-step",
        label: stepSource.label ?? "Step",
        primarySource: stepSource
      });
      addEditorEntityFacet(stepEntity, "logic", stepSource);

      for (const actionId of collectLinkIds(step, ["actionId", "actionIds"])) {
        const actionRefs = actionRefsById.get(actionId) ?? [];
        if (actionRefs.length === 0) {
          const diagnostic = createProjectionDiagnostic(
            "warning",
            "unresolved-action-link",
            stepSource,
            `Step ${stepSource.label ?? stepPointer} references missing action ${actionId}.`
          );
          stepEntity.diagnostics.push(diagnostic);
          continue;
        }

        for (const actionRef of actionRefs) {
          addEditorEntityFacet(stepEntity, "logic", actionRef);
        }
      }

      for (const contentId of collectLinkIds(step, ["activeInfoId", "cardId", "choiceId", "contentId", "infoId"])) {
        const contentRefs = contentRefsById.get(contentId) ?? [];
        if (contentRefs.length === 0) {
          stepEntity.diagnostics.push(
            createProjectionDiagnostic(
              "warning",
              "unresolved-source-pointer",
              stepSource,
              `Step ${stepSource.label ?? stepPointer} references missing content ${contentId}.`
            )
          );
          continue;
        }

        for (const contentRef of contentRefs) {
          addEditorEntityFacet(stepEntity, "content", contentRef);
        }
      }

      const screenIds = collectLinkIds(step, ["screenId", "screen_id"]);
      for (const screenId of screenIds) {
        const viewRefs = uiScreenRefsById.get(screenId) ?? [];
        if (viewRefs.length === 0) {
          const diagnostic = createProjectionDiagnostic(
            "warning",
            "unresolved-view-link",
            stepSource,
            `Step ${stepSource.label ?? stepPointer} references missing UI screen ${screenId}.`
          );
          stepEntity.diagnostics.push(diagnostic);
          continue;
        }

        if (hasDuplicateProjectionChannels(viewRefs)) {
          const diagnostic = createProjectionDiagnostic(
            "warning",
            "ambiguous-view-link",
            stepSource,
            `Step ${stepSource.label ?? stepPointer} resolves screen ${screenId} to multiple screens in the same channel.`
          );
          stepEntity.diagnostics.push(diagnostic);
        }

        for (const viewRef of viewRefs) {
          addEditorEntityFacet(stepEntity, "view", viewRef);
        }
      }
    });
  });
}

function collectGameActionEntities(
  document: NormalizedEditorEntityProjectionDocument,
  builders: Map<string, MutableEditorEntityBuilder>,
  contentRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>
): void {
  if (document.json === undefined) {
    return;
  }

  const actions = readJsonPointer(document.json, "/root/logic/actions");
  if (!Array.isArray(actions)) {
    return;
  }

  actions.forEach((action, index) => {
    if (!isPlainJsonObject(action)) {
      return;
    }

    const pointer = buildJsonPointer(["root", "logic", "actions", String(index)]);
    const source = createProjectionSourcePointer(document, pointer, "action", resolveEntityTreeLabel(action, pointer));
    const entity = ensureEditorEntityBuilder(builders, {
      entityId: editorEntityId("game-action", document.filePath, pointer, readStringProperty(action, "id")),
      kind: "game-action",
      label: source.label ?? "Action",
      primarySource: source
    });
    addEditorEntityFacet(entity, "logic", source);

    for (const objectId of collectNestedLinkIds(action, ["objectId"])) {
      const contentRefs = contentRefsById.get(objectId) ?? [];
      for (const contentRef of contentRefs) {
        addEditorEntityFacet(entity, "content", contentRef);
      }
    }
  });
}

function collectGameMetricEntities(
  document: NormalizedEditorEntityProjectionDocument,
  builders: Map<string, MutableEditorEntityBuilder>
): void {
  if (document.json === undefined) {
    return;
  }

  const metricsPointer = "/root/state/public/metrics";
  const metrics = readJsonPointer(document.json, metricsPointer);
  if (!isPlainJsonObject(metrics)) {
    return;
  }

  for (const [key] of Object.entries(metrics)) {
    const pointer = appendPointerSegment(metricsPointer, key);
    const source = createProjectionSourcePointer(document, pointer, "metric", titleFromToken(key));
    const entity = ensureEditorEntityBuilder(builders, {
      entityId: editorEntityId("metric", document.filePath, pointer, key),
      kind: "metric",
      label: source.label ?? titleFromToken(key),
      primarySource: source
    });
    addEditorEntityFacet(entity, "state", source);
  }
}

function collectGameStateModelEntities(
  document: NormalizedEditorEntityProjectionDocument,
  builders: Map<string, MutableEditorEntityBuilder>
): void {
  if (document.json === undefined) {
    return;
  }

  const objectTypesPointer = "/root/objectTypes";
  const objectTypes = readJsonPointer(document.json, objectTypesPointer);
  if (!isPlainJsonObject(objectTypes)) {
    return;
  }

  for (const [key, value] of Object.entries(objectTypes)) {
    const pointer = appendPointerSegment(objectTypesPointer, key);
    const label = isPlainJsonObject(value) ? resolveEntityTreeLabel(value, pointer) : titleFromToken(key);
    const source = createProjectionSourcePointer(document, pointer, "object-type", label);
    const entity = ensureEditorEntityBuilder(builders, {
      entityId: editorEntityId("state-model", document.filePath, pointer, key),
      kind: "state-model",
      label: source.label ?? titleFromToken(key),
      primarySource: source
    });
    addEditorEntityFacet(entity, "state", source);
  }
}

function collectUiEditorEntities(
  document: NormalizedEditorEntityProjectionDocument,
  builders: Map<string, MutableEditorEntityBuilder>,
  actionRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>
): void {
  if (document.json === undefined) {
    return;
  }

  const root = readJsonPointer(document.json, "/root");
  if (isPlainJsonObject(root)) {
    const rootSource = createProjectionSourcePointer(document, "/root", "ui-root", resolveEntityTreeLabel(root, "/root"));
    const rootEntity = ensureEditorEntityBuilder(builders, {
      entityId: editorEntityId("ui-root", document.filePath, "/root", readStringProperty(root, "id")),
      kind: "ui-root",
      label: rootSource.label ?? "UI",
      primarySource: rootSource
    });
    addEditorEntityFacet(rootEntity, "view", rootSource);
  }

  const screens = readJsonPointer(document.json, "/root/screens");
  if (!Array.isArray(screens)) {
    return;
  }

  screens.forEach((screen, screenIndex) => {
    if (!isPlainJsonObject(screen)) {
      return;
    }

    const screenPointer = buildJsonPointer(["root", "screens", String(screenIndex)]);
    const screenSource = createProjectionSourcePointer(document, screenPointer, "screen", resolveEntityTreeLabel(screen, screenPointer));
    const screenEntity = ensureEditorEntityBuilder(builders, {
      entityId: editorEntityId("ui-screen", document.filePath, screenPointer, readStringProperty(screen, "id")),
      kind: "ui-screen",
      label: screenSource.label ?? "Screen",
      primarySource: screenSource
    });
    addEditorEntityFacet(screenEntity, "view", screenSource);
    collectUiComponentEntities(document, builders, actionRefsById, screenPointer, screenEntity);
  });
}

function collectUiComponentEntities(
  document: NormalizedEditorEntityProjectionDocument,
  builders: Map<string, MutableEditorEntityBuilder>,
  actionRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>,
  rootPointer: string,
  screenEntity: MutableEditorEntityBuilder
): void {
  const visit = (value: JsonValue, pointer: string): void => {
    if (!isPlainJsonObject(value)) {
      return;
    }

    if (pointer !== rootPointer && isUiComponentLike(value)) {
      const source = createProjectionSourcePointer(document, pointer, "component", resolveEntityTreeLabel(value, pointer));
      const entity = ensureEditorEntityBuilder(builders, {
        entityId: editorEntityId("ui-component", document.filePath, pointer, readStringProperty(value, "id")),
        kind: "ui-component",
        label: source.label ?? "Component",
        primarySource: source
      });
      addEditorEntityFacet(entity, "view", source);
      addEditorEntityFacet(screenEntity, "view", source);

      for (const actionId of collectNestedLinkIds(value, ["actionId"])) {
        const actionRefs = actionRefsById.get(actionId) ?? [];
        for (const actionRef of actionRefs) {
          const actionEntity = builders.get(editorEntityId("game-action", actionRef.filePath, actionRef.pointer, actionId));
          if (actionEntity !== undefined) {
            addEditorEntityFacet(actionEntity, "view", source);
          }
        }
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith("_")) {
        continue;
      }
      if (Array.isArray(child)) {
        child.forEach((item, index) => visit(item, appendPointerSegment(appendPointerSegment(pointer, key), String(index))));
      } else {
        visit(child, appendPointerSegment(pointer, key));
      }
    }
  };

  const root = document.json === undefined ? undefined : readJsonPointer(document.json, rootPointer);
  if (root !== undefined) {
    visit(root, rootPointer);
  }
}

function attachPreviewEntityFacets(
  previewEntities: readonly PreviewEntityDescriptor[],
  documents: readonly NormalizedEditorEntityProjectionDocument[],
  builders: Map<string, MutableEditorEntityBuilder>
): void {
  if (previewEntities.length === 0) {
    return;
  }

  for (const previewEntity of previewEntities) {
    const source = findProjectionSourceForPreviewPointer(previewEntity.authoringPointer, documents, builders);
    if (source === undefined) {
      continue;
    }

    const owner = findProjectionOwnerForSourcePointer(source, builders);
    if (owner === undefined) {
      continue;
    }

    addEditorEntityFacet(owner, "view", {
      ...source,
      pointer: previewEntity.authoringPointer,
      label: previewEntity.label,
      role: `preview:${previewEntity.semanticRole}`
    });
  }
}

function collectActionRefsById(
  documents: readonly NormalizedEditorEntityProjectionDocument[]
): ReadonlyMap<string, readonly EditorEntitySourcePointer[]> {
  const refs = new Map<string, EditorEntitySourcePointer[]>();
  for (const document of documents) {
    if (document.documentKind !== "game" || document.json === undefined) {
      continue;
    }

    const actions = readJsonPointer(document.json, "/root/logic/actions");
    if (!Array.isArray(actions)) {
      continue;
    }

    actions.forEach((action, index) => {
      if (!isPlainJsonObject(action)) {
        return;
      }

      const actionId = readStringProperty(action, "id");
      if (actionId === undefined) {
        return;
      }

      const pointer = buildJsonPointer(["root", "logic", "actions", String(index)]);
      pushProjectionRef(refs, actionId, createProjectionSourcePointer(document, pointer, "action", resolveEntityTreeLabel(action, pointer)));
    });
  }

  return refs;
}

function collectContentRefsById(
  documents: readonly NormalizedEditorEntityProjectionDocument[]
): ReadonlyMap<string, readonly EditorEntitySourcePointer[]> {
  const refs = new Map<string, EditorEntitySourcePointer[]>();
  for (const document of documents) {
    if (document.documentKind !== "game" || document.json === undefined) {
      continue;
    }

    const content = readJsonPointer(document.json, "/root/content");
    if (content === undefined) {
      continue;
    }

    visitProjectionJson(content, "/root/content", (value, pointer) => {
      if (!isPlainJsonObject(value)) {
        return;
      }

      const id = readStringProperty(value, "id");
      if (id === undefined) {
        return;
      }

      pushProjectionRef(refs, id, createProjectionSourcePointer(document, pointer, "content", resolveEntityTreeLabel(value, pointer)));
    });
  }

  return refs;
}

function collectUiScreenRefsById(
  documents: readonly NormalizedEditorEntityProjectionDocument[]
): ReadonlyMap<string, readonly EditorEntitySourcePointer[]> {
  const refs = new Map<string, EditorEntitySourcePointer[]>();
  for (const document of documents) {
    if (document.documentKind !== "ui" || document.json === undefined) {
      continue;
    }

    const screens = readJsonPointer(document.json, "/root/screens");
    if (!Array.isArray(screens)) {
      continue;
    }

    screens.forEach((screen, index) => {
      if (!isPlainJsonObject(screen)) {
        return;
      }

      const screenId = readStringProperty(screen, "id");
      if (screenId === undefined) {
        return;
      }

      const pointer = buildJsonPointer(["root", "screens", String(index)]);
      pushProjectionRef(refs, screenId, createProjectionSourcePointer(document, pointer, "screen", resolveEntityTreeLabel(screen, pointer)));
    });
  }

  return refs;
}

function visitProjectionJson(value: JsonValue, pointer: string, visitor: (value: JsonValue, pointer: string) => void): void {
  visitor(value, pointer);

  if (Array.isArray(value)) {
    value.forEach((item, index) => visitProjectionJson(item, appendPointerSegment(pointer, String(index)), visitor));
    return;
  }

  if (!isPlainJsonObject(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    visitProjectionJson(child, appendPointerSegment(pointer, key), visitor);
  }
}

function pushProjectionRef(
  refs: Map<string, EditorEntitySourcePointer[]>,
  id: string,
  ref: EditorEntitySourcePointer
): void {
  const existing = refs.get(id);
  if (existing === undefined) {
    refs.set(id, [ref]);
  } else {
    existing.push(ref);
  }
}

function ensureEditorEntityBuilder(
  builders: Map<string, MutableEditorEntityBuilder>,
  input: {
    readonly entityId: string;
    readonly kind: EditorEntityKind;
    readonly label: string;
    readonly primarySource: EditorEntitySourcePointer;
  }
): MutableEditorEntityBuilder {
  const existing = builders.get(input.entityId);
  if (existing !== undefined) {
    return existing;
  }

  const builder: MutableEditorEntityBuilder = {
    entityId: input.entityId,
    kind: input.kind,
    label: input.label,
    primarySource: input.primarySource,
    facets: new Map(),
    diagnostics: []
  };
  builders.set(input.entityId, builder);
  return builder;
}

function addEditorEntityFacet(
  entity: MutableEditorEntityBuilder,
  facetKind: EditorEntityFacetKind,
  source: EditorEntitySourcePointer
): void {
  const existing = entity.facets.get(facetKind) ?? [];
  if (existing.some((candidate) => sourcePointerKey(candidate) === sourcePointerKey(source))) {
    return;
  }

  entity.facets.set(facetKind, [...existing, source]);
}

function finalizeEditorEntityBuilder(builder: MutableEditorEntityBuilder): EditorEntity {
  const facets: Partial<Record<EditorEntityFacetKind, readonly EditorEntitySourcePointer[]>> = {};
  for (const facetKind of orderedEditorEntityFacetKinds) {
    const values = builder.facets.get(facetKind);
    if (values !== undefined && values.length > 0) {
      facets[facetKind] = values;
    }
  }

  return {
    entityId: builder.entityId,
    kind: builder.kind,
    label: builder.label,
    primarySource: builder.primarySource,
    facets,
    diagnostics: builder.diagnostics
  };
}

function buildEntitiesBySourcePointer(entities: readonly EditorEntity[]): ReadonlyMap<string, readonly EditorEntity[]> {
  const result = new Map<string, EditorEntity[]>();
  for (const entity of entities) {
    for (const source of collectEntitySourcePointers(entity)) {
      const key = sourcePointerKey(source);
      const existing = result.get(key);
      if (existing === undefined) {
        result.set(key, [entity]);
      } else if (!existing.some((candidate) => candidate.entityId === entity.entityId)) {
        existing.push(entity);
      }
    }
  }

  return result;
}

function collectEntitySourcePointers(entity: EditorEntity): readonly EditorEntitySourcePointer[] {
  const sources = [entity.primarySource];
  for (const facetKind of orderedEditorEntityFacetKinds) {
    sources.push(...(entity.facets[facetKind] ?? []));
  }
  return sources;
}

function createProjectionSourcePointer(
  document: NormalizedEditorEntityProjectionDocument,
  pointer: string,
  role: string,
  label?: string
): EditorEntitySourcePointer {
  return {
    filePath: document.filePath,
    pointer,
    documentKind: document.documentKind,
    channel: document.channel,
    role,
    label
  };
}

function createProjectionDiagnostic(
  severity: DiagnosticSeverity,
  code: EditorEntityProjectionDiagnosticCode,
  source: EditorEntitySourcePointer,
  message: string,
  target?: EditorEntitySourcePointer
): EditorEntityProjectionDiagnostic {
  return {
    severity,
    code,
    source,
    target,
    message
  };
}

function editorEntityId(kind: EditorEntityKind, filePath: string, pointer: string, explicitId: string | undefined): string {
  const stablePart = explicitId === undefined || explicitId.trim() === "" ? `${filePath}#${pointer}` : explicitId.trim();
  return `${kind}:${stablePart}`;
}

function sourcePointerKey(source: EditorEntitySourcePointer): string {
  return `${source.filePath}#${source.pointer}`;
}

function collectLinkIds(value: JsonObject, keys: readonly string[]): readonly string[] {
  const ids: string[] = [];
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim() !== "") {
      ids.push(candidate.trim());
    } else if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (typeof item === "string" && item.trim() !== "") {
          ids.push(item.trim());
        }
      }
    }
  }
  return [...new Set(ids)];
}

function collectNestedLinkIds(value: JsonValue, keys: readonly string[]): readonly string[] {
  const ids = new Set<string>();
  visitProjectionJson(value, "", (candidate) => {
    if (!isPlainJsonObject(candidate)) {
      return;
    }

    for (const id of collectLinkIds(candidate, keys)) {
      ids.add(id);
    }
  });
  return [...ids];
}

function hasDuplicateProjectionChannels(refs: readonly EditorEntitySourcePointer[]): boolean {
  const counts = new Map<string, number>();
  for (const ref of refs) {
    const key = `${ref.filePath}:${ref.channel ?? "default"}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count > 1);
}

function isUiComponentLike(value: JsonObject): boolean {
  const type = readStringProperty(value, "_type") ?? readStringProperty(value, "type");
  return type !== undefined && normalizeToken(type).includes("component");
}

function findProjectionSourceForPreviewPointer(
  authoringPointer: string,
  documents: readonly NormalizedEditorEntityProjectionDocument[],
  builders: ReadonlyMap<string, MutableEditorEntityBuilder>
): EditorEntitySourcePointer | undefined {
  for (const document of documents) {
    if (document.json === undefined || readJsonPointer(document.json, authoringPointer) === undefined) {
      continue;
    }

    const owner = [...builders.values()].find((entity) =>
      collectMutableEntitySourcePointers(entity).some((source) => source.filePath === document.filePath && isSameOrDescendantPointer(authoringPointer, source.pointer))
    );
    if (owner !== undefined) {
      return createProjectionSourcePointer(document, authoringPointer, "preview", owner.label);
    }
  }

  return undefined;
}

function findProjectionOwnerForSourcePointer(
  source: EditorEntitySourcePointer,
  builders: ReadonlyMap<string, MutableEditorEntityBuilder>
): MutableEditorEntityBuilder | undefined {
  return [...builders.values()].find((entity) =>
    collectMutableEntitySourcePointers(entity).some(
      (candidate) => candidate.filePath === source.filePath && isSameOrDescendantPointer(source.pointer, candidate.pointer)
    )
  );
}

function collectMutableEntitySourcePointers(entity: MutableEditorEntityBuilder): readonly EditorEntitySourcePointer[] {
  const sources = [entity.primarySource];
  for (const facetKind of orderedEditorEntityFacetKinds) {
    sources.push(...(entity.facets.get(facetKind) ?? []));
  }
  return sources;
}

function appendMeaningfulYamlLines(input: {
  readonly lines: string[];
  readonly value: JsonValue;
  readonly pointer: string;
  readonly indent: number;
  readonly fieldDictionary: readonly EditorEntityFieldDictionaryEntry[];
  readonly hiddenTechnicalPointers: EditorEntitySourcePointer[];
  readonly hiddenSourceBase: EditorEntitySourcePointer;
  readonly maxDepth: number;
}): void {
  if (input.maxDepth <= 0) {
    input.lines.push(`${" ".repeat(input.indent)}${formatYamlScalar(summarizeYamlValue(input.value))}`);
    return;
  }

  if (Array.isArray(input.value)) {
    if (input.value.length === 0) {
      input.lines.push(`${" ".repeat(input.indent)}[]`);
      return;
    }

    input.value.forEach((item, index) => {
      const childPointer = appendPointerSegment(input.pointer, String(index));
      if (isScalar(item) || item === null) {
        input.lines.push(`${" ".repeat(input.indent)}- ${formatYamlScalar(item)}`);
      } else {
        input.lines.push(`${" ".repeat(input.indent)}-`);
        appendMeaningfulYamlLines({ ...input, value: item, pointer: childPointer, indent: input.indent + 2, maxDepth: input.maxDepth - 1 });
      }
    });
    return;
  }

  if (!isPlainJsonObject(input.value)) {
    input.lines.push(`${" ".repeat(input.indent)}${formatYamlScalar(input.value)}`);
    return;
  }

  const entries = Object.entries(input.value).filter(([key]) => shouldIncludeMeaningfulYamlField(key, appendPointerSegment(input.pointer, key), input.fieldDictionary));
  if (entries.length === 0) {
    input.lines.push(`${" ".repeat(input.indent)}{}`);
  }

  for (const [key, child] of Object.entries(input.value)) {
    const childPointer = appendPointerSegment(input.pointer, key);
    if (!shouldIncludeMeaningfulYamlField(key, childPointer, input.fieldDictionary)) {
      if (isTechnicalProjectionField(key)) {
        input.hiddenTechnicalPointers.push({
          ...input.hiddenSourceBase,
          pointer: childPointer,
          role: key,
          label: resolveProjectionFieldLabel(key, childPointer, input.fieldDictionary)
        });
      }
      continue;
    }

    const label = resolveProjectionFieldLabel(key, childPointer, input.fieldDictionary);
    if (isScalar(child) || child === null) {
      input.lines.push(`${" ".repeat(input.indent)}${label}: ${formatYamlScalar(child)}`);
    } else {
      input.lines.push(`${" ".repeat(input.indent)}${label}:`);
      appendMeaningfulYamlLines({ ...input, value: child, pointer: childPointer, indent: input.indent + 2, maxDepth: input.maxDepth - 1 });
    }
  }
}

function shouldIncludeMeaningfulYamlField(
  key: string,
  pointer: string,
  fieldDictionary: readonly EditorEntityFieldDictionaryEntry[]
): boolean {
  const dictionaryEntry = resolveProjectionFieldDictionaryEntry(key, pointer, fieldDictionary);
  if (dictionaryEntry?.meaningful === false) {
    return false;
  }

  if (isTechnicalProjectionField(key)) {
    return dictionaryEntry?.meaningful === true;
  }

  return true;
}

function resolveProjectionFieldLabel(
  key: string,
  pointer: string,
  fieldDictionary: readonly EditorEntityFieldDictionaryEntry[]
): string {
  return resolveProjectionFieldDictionaryEntry(key, pointer, fieldDictionary)?.label ?? titleFromToken(key);
}

function resolveProjectionFieldDictionaryEntry(
  key: string,
  pointer: string,
  fieldDictionary: readonly EditorEntityFieldDictionaryEntry[]
): EditorEntityFieldDictionaryEntry | undefined {
  return fieldDictionary.find((entry) => entry.pointer === pointer) ?? fieldDictionary.find((entry) => entry.key === key);
}

function isTechnicalProjectionField(key: string): boolean {
  return key === "$schema" || key.startsWith("_");
}

function editorEntityFacetLabel(facetKind: EditorEntityFacetKind): string {
  switch (facetKind) {
    case "logic":
      return "Логика";
    case "content":
      return "Содержание";
    case "state":
      return "Состояние";
    case "view":
      return "Отображение";
    case "design":
      return "Дизайн";
    case "plugin":
      return "Плагин";
  }
}

function formatYamlScalar(value: JsonValue | string): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (value === null) {
    return "null";
  }

  if (Array.isArray(value) || isPlainJsonObject(value)) {
    return JSON.stringify(value);
  }

  return String(value);
}

function summarizeYamlValue(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `${value.length} items`;
  }

  if (isPlainJsonObject(value)) {
    return `${Object.keys(value).length} fields`;
  }

  return String(value);
}

function createManifestTimeline(
  entries: readonly ManifestTimelineEntry[],
  rootEntryIds: readonly string[]
): ManifestTimeline {
  return {
    entries,
    rootEntryIds,
    entryById: new Map(entries.map((entry) => [entry.id, entry]))
  };
}

function readStringProperty(value: JsonObject, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim() !== "" ? candidate : undefined;
}

function readStringArrayProperty(value: JsonObject, key: string): readonly string[] {
  const candidate = value[key];
  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}
