/**
 * Grouping-aware entity tree for the preview-first editor (ADR-057 §4.6,
 * editor-preview-first-ux §7).
 *
 * `buildEntityTreeViewModel` (in `tree-view.ts`) projects ONE authoring document
 * into a nesting tree. This module adds the two AUTHOR-FACING groupings that sit
 * on top of the PROJECT-level `EditorEntityProjection` (game + UI facets across
 * documents; ADR-052):
 *
 * - **"По экранам" (byScreen)** — an outliner: the top level is every screen of
 *   the active channel; inside a screen the nesting mirrors the display
 *   (UI-component tree); non-visual entities BOUND to the screen (a step that
 *   targets it, an action wired into it) live in a collapsed "Логика экрана"
 *   subgroup. The active screen carries an auto-reveal flag.
 * - **"По типам" (byType)** — an inventory: the top level is the prototypes/types;
 *   each type header holds its instances (with a location breadcrumb); an instance
 *   expands into its UI structure and nested foreign instances are marked as
 *   occurrences.
 *
 * INVARIANTS (shared with `tree-view.ts`):
 * - The model is immutable and framework-agnostic; nothing here renders.
 * - NODE identity ≠ ENTITY identity: one entity surfaces at several nodes
 *   ("вхождения"/occurrences); every occurrence shares one `entityId` and exactly
 *   ONE node per entity is `primary` for the current grouping.
 * - Entity links, kinds and diagnostics come ONLY from the projection; this module
 *   never builds its own entity index. The authoring `documents` are read only for
 *   the DECLARATIVE fields the projection does not carry (`_type` for the
 *   type/prototype bucket, `_decorative` for the decorative flag).
 */
import { isPlainJsonObject, shortTypeName, titleFromToken, truncate } from "./shared.ts";
import { parseJsonPointer, readJsonPointer } from "./json-pointer-patch.ts";
import type {
  BuildEntityGroupingTreeViewModelInput,
  EditorEntity,
  EditorEntityProjection,
  EditorEntityProjectionDocument,
  JsonValue,
  TreeViewModel,
  TreeViewNode,
  TreeViewNodeDiagnosticSeverityCounts,
  TreeViewNodeGroupingRole,
  TreeViewNodeOccurrenceKind
} from "./types.ts";

/**
 * Builds the grouped entity tree for the requested grouping.
 *
 * The output is a standard `TreeViewModel` — the same shape the other tree
 * builders return — so a UI layer can reuse one renderer. `nodesByEntityId` is
 * always populated (this tree is entity-aware), and selecting an entity by id
 * finds every one of its occurrence nodes.
 */
export function buildEntityGroupingTreeViewModel(input: BuildEntityGroupingTreeViewModelInput): TreeViewModel {
  const context = createGroupingContext(input);
  const rootPlan = input.grouping === "byScreen" ? planByScreen(context) : planByType(context);
  return finalizeGroupingTree(rootPlan, input.maxValuePreviewLength);
}

// ---------------------------------------------------------------------------
// Shared context: the entity forest + declarative-field readers.
// ---------------------------------------------------------------------------

/**
 * A NodePlan is the mutable intermediate the two planners emit. It is finalized
 * into an immutable `TreeViewNode` in a second pass, which is where
 * `occurrenceKind` is resolved (so the "first appearance is primary" rule for
 * byScreen can run in document pre-order).
 */
interface GroupingNodePlan {
  /** Suffix appended to the parent id to make a tree-unique node id. */
  readonly idSuffix: string;
  readonly pointer: string;
  readonly parentPointer: string | undefined;
  readonly label: string;
  readonly valuePreview: string;
  readonly entityId?: string;
  /**
   * Explicit occurrence decision. `true` = this node is the entity's canonical
   * `primary` position; `false` = a forced `occurrence`. `undefined` defers to
   * the "first appearance in pre-order is primary" rule (used by byScreen, where
   * the nesting position IS the canonical position).
   */
  readonly primaryHint?: boolean;
  readonly entityKind?: EditorEntity["kind"];
  readonly groupingRole?: TreeViewNodeGroupingRole;
  readonly isNonVisual?: boolean;
  readonly isDecorative?: boolean;
  readonly isActiveContext?: boolean;
  readonly locationBreadcrumb?: readonly string[];
  readonly diagnosticSeverityCounts?: TreeViewNodeDiagnosticSeverityCounts;
  readonly children: readonly GroupingNodePlan[];
}

interface GroupingContext {
  readonly projection: EditorEntityProjection;
  readonly activeChannel?: string;
  readonly activeScreenEntityId?: string;
  /** All in-scope entities (UI filtered to the active channel; all game/logic kept). */
  readonly entities: readonly EditorEntity[];
  /** Direct children of an entity by nearest-ancestor pointer nesting. */
  readonly childrenByParentId: ReadonlyMap<string, readonly EditorEntity[]>;
  /** Nearest ancestor entity, or undefined for a forest root. */
  readonly parentById: ReadonlyMap<string, EditorEntity | undefined>;
  /** Reads the raw authoring object an entity points at (for `_type`/`_decorative`). */
  readonly readEntityNode: (entity: EditorEntity) => JsonValue | undefined;
  /** Reads a whole authoring document (pointer ""), used for `_definitions`. */
  readonly readDocumentRoot: (filePath: string) => JsonValue | undefined;
}

function createGroupingContext(input: BuildEntityGroupingTreeViewModelInput): GroupingContext {
  const { projection, activeChannel } = input;
  const docByPath = new Map<string, JsonValue | undefined>(
    input.documents.map((document: EditorEntityProjectionDocument) => [document.filePath, document.json])
  );
  const readEntityNode = (entity: EditorEntity): JsonValue | undefined => {
    const json = docByPath.get(entity.primarySource.filePath);
    return json === undefined ? undefined : readJsonPointer(json, entity.primarySource.pointer);
  };

  // Scope: keep all non-UI (game/logic) entities; keep UI entities only for the
  // active channel so a multi-channel projection does not double the inventory.
  const entities = projection.entities.filter(
    (entity) =>
      entity.primarySource.documentKind !== "ui" ||
      activeChannel === undefined ||
      entity.primarySource.channel === activeChannel
  );

  // Nearest-ancestor entity forest by JSON Pointer nesting within one file. A
  // component's parent is the deepest entity whose pointer is a proper prefix.
  const parentById = new Map<string, EditorEntity | undefined>();
  const childrenByParentId = new Map<string, EditorEntity[]>();
  for (const entity of entities) {
    let parent: EditorEntity | undefined;
    for (const candidate of entities) {
      if (candidate === entity || candidate.primarySource.filePath !== entity.primarySource.filePath) {
        continue;
      }
      const prefix = `${candidate.primarySource.pointer}/`;
      if (
        entity.primarySource.pointer.startsWith(prefix) &&
        (parent === undefined || candidate.primarySource.pointer.length > parent.primarySource.pointer.length)
      ) {
        parent = candidate;
      }
    }
    parentById.set(entity.entityId, parent);
    if (parent !== undefined) {
      const siblings = childrenByParentId.get(parent.entityId);
      if (siblings === undefined) {
        childrenByParentId.set(parent.entityId, [entity]);
      } else {
        siblings.push(entity);
      }
    }
  }
  for (const siblings of childrenByParentId.values()) {
    siblings.sort(compareEntities);
  }

  return {
    projection,
    activeChannel,
    activeScreenEntityId: input.activeScreenEntityId,
    entities,
    childrenByParentId,
    parentById,
    readEntityNode,
    readDocumentRoot: (filePath: string) => docByPath.get(filePath)
  };
}

// ---------------------------------------------------------------------------
// Grouping: "По экранам" (outliner).
// ---------------------------------------------------------------------------

/** UI-structural kinds — the ones whose nesting IS the display (§7). */
function isUiStructuralKind(kind: EditorEntity["kind"]): boolean {
  return kind === "ui-component" || kind === "ui-screen" || kind === "ui-root";
}

/** Direct child entities that participate in UI nesting, in document order. */
function uiChildEntities(context: GroupingContext, parentEntityId: string): readonly EditorEntity[] {
  return (context.childrenByParentId.get(parentEntityId) ?? []).filter((child) => isUiStructuralKind(child.kind));
}

function planByScreen(context: GroupingContext): GroupingNodePlan {
  const screens = context.entities
    .filter((entity) => entity.kind === "ui-screen")
    .sort(compareEntities);
  const activeScreenId = context.activeScreenEntityId ?? screens[0]?.entityId;

  const screenPlans = screens.map((screen) => {
    // The display nesting: recurse the UI-component subtree of the screen.
    const uiChildren = uiChildEntities(context, screen.entityId).map((child) => planScreenComponent(context, child));

    // "Логика экрана": non-visual entities bound to this screen (a view facet
    // targeting the screen subtree), e.g. steps that target the screen.
    const logicChildren = collectScreenLogicEntities(context, screen).map((entity) =>
      planEntityLeaf(context, entity, {
        idSuffix: `/logic:${entity.entityId}`,
        isNonVisual: true
      })
    );
    const logicGroup: GroupingNodePlan[] =
      logicChildren.length === 0
        ? []
        : [
            {
              idSuffix: "/screen-logic",
              pointer: "",
              parentPointer: screen.primarySource.pointer,
              label: "Логика экрана",
              valuePreview: `${logicChildren.length}`,
              groupingRole: "screen-logic",
              isNonVisual: true,
              children: logicChildren
            }
          ];

    return {
      idSuffix: `/screen:${screen.entityId}`,
      pointer: screen.primarySource.pointer,
      parentPointer: "",
      label: screen.label,
      valuePreview: shortTypeName(screen.kind),
      entityId: screen.entityId,
      entityKind: screen.kind,
      isActiveContext: screen.entityId === activeScreenId ? true : undefined,
      diagnosticSeverityCounts: severityCountsFor(context, screen.entityId),
      children: [...uiChildren, ...logicGroup]
    } satisfies GroupingNodePlan;
  });

  return {
    idSuffix: "$screens",
    pointer: "",
    parentPointer: undefined,
    label: "Экраны",
    valuePreview: `${screens.length}`,
    children: screenPlans
  };
}

/**
 * Plans one UI-component node inside the byScreen outliner. The node's identity
 * is the GAME entity it references, if any (editor-preview-first-ux §7); otherwise
 * the UI element is its own object. Occurrence resolution is deferred to the
 * pre-order pass, so the FIRST place a referenced game entity appears becomes its
 * `primary` and later screens become occurrences ("тот же объект").
 */
function planScreenComponent(context: GroupingContext, entity: EditorEntity): GroupingNodePlan {
  const referenced = resolveReferencedGameEntity(context, entity);
  const nodeEntityId = referenced?.entityId ?? entity.entityId;
  const node = context.readEntityNode(entity);
  const children = uiChildEntities(context, entity.entityId).map((child) => planScreenComponent(context, child));

  return {
    idSuffix: `/ui:${entity.primarySource.pointer}`,
    pointer: entity.primarySource.pointer,
    parentPointer: context.parentById.get(entity.entityId)?.primarySource.pointer ?? "",
    label: entity.label,
    valuePreview: shortTypeName(referenced?.kind ?? entity.kind),
    entityId: nodeEntityId,
    entityKind: entity.kind,
    isDecorative: isDecorative(node) ? true : undefined,
    diagnosticSeverityCounts: severityCountsFor(context, nodeEntityId),
    children
  };
}

// ---------------------------------------------------------------------------
// Grouping: "По типам" (inventory).
// ---------------------------------------------------------------------------

function planByType(context: GroupingContext): GroupingNodePlan {
  // Bucket every in-scope entity by its declared type key so every entity —
  // visual or not, prototyped or not — is reachable (editor-preview-first-ux §2.1).
  const byTypeKey = new Map<string, EditorEntity[]>();
  for (const entity of context.entities) {
    const key = typeKeyOf(context, entity);
    const bucket = byTypeKey.get(key);
    if (bucket === undefined) {
      byTypeKey.set(key, [entity]);
    } else {
      bucket.push(entity);
    }
  }

  const typeKeys = [...byTypeKey.keys()].sort((left, right) => left.localeCompare(right));
  const headerPlans = typeKeys.map((typeKey) => {
    const members = [...(byTypeKey.get(typeKey) ?? [])].sort(compareEntities);
    const nonVisual = members.every((member) => isNonVisualEntity(member));
    // Each instance is the entity's canonical (primary) home under its type; its
    // children expand the UI structure as occurrences.
    const instancePlans = members.map((member) => ({
      idSuffix: `/instance:${member.entityId}`,
      pointer: member.primarySource.pointer,
      parentPointer: "",
      label: member.label,
      valuePreview: shortTypeName(member.kind),
      entityId: member.entityId,
      primaryHint: true,
      entityKind: member.kind,
      isNonVisual: nonVisual ? true : undefined,
      isDecorative: isDecorative(context.readEntityNode(member)) ? true : undefined,
      locationBreadcrumb: locationBreadcrumb(context, member),
      diagnosticSeverityCounts: severityCountsFor(context, member.entityId),
      children: planInstanceStructure(context, member)
    } satisfies GroupingNodePlan));

    return {
      idSuffix: `/type:${typeKey}`,
      pointer: "",
      parentPointer: "",
      label: typeHeaderLabel(context, typeKey, members),
      valuePreview: `${members.length}`,
      groupingRole: "prototype",
      isNonVisual: nonVisual ? true : undefined,
      children: instancePlans
    } satisfies GroupingNodePlan;
  });

  return {
    idSuffix: "$types",
    pointer: "",
    parentPointer: undefined,
    label: "Типы",
    valuePreview: `${typeKeys.length}`,
    children: headerPlans
  };
}

/**
 * Expands an instance into its UI substructure. Every descendant entity is a
 * forced `occurrence` here (its `primary` lives under its own type header), which
 * is exactly the "вложенные чужие экземпляры — occurrence" rule.
 */
function planInstanceStructure(context: GroupingContext, entity: EditorEntity): readonly GroupingNodePlan[] {
  return uiChildEntities(context, entity.entityId).map((child) => ({
    idSuffix: `/occ:${child.primarySource.pointer}`,
    pointer: child.primarySource.pointer,
    parentPointer: entity.primarySource.pointer,
    label: child.label,
    valuePreview: shortTypeName(child.kind),
    entityId: child.entityId,
    primaryHint: false,
    entityKind: child.kind,
    isNonVisual: isNonVisualEntity(child) ? true : undefined,
    isDecorative: isDecorative(context.readEntityNode(child)) ? true : undefined,
    diagnosticSeverityCounts: severityCountsFor(context, child.entityId),
    children: planInstanceStructure(context, child)
  } satisfies GroupingNodePlan));
}

// ---------------------------------------------------------------------------
// Small planners and declarative-field helpers.
// ---------------------------------------------------------------------------

function planEntityLeaf(
  context: GroupingContext,
  entity: EditorEntity,
  overrides: { readonly idSuffix: string; readonly isNonVisual?: boolean }
): GroupingNodePlan {
  return {
    idSuffix: overrides.idSuffix,
    pointer: entity.primarySource.pointer,
    parentPointer: "",
    label: entity.label,
    valuePreview: shortTypeName(entity.kind),
    entityId: entity.entityId,
    entityKind: entity.kind,
    isNonVisual: overrides.isNonVisual ? true : undefined,
    diagnosticSeverityCounts: severityCountsFor(context, entity.entityId),
    children: []
  };
}

/**
 * The GAME entity a UI element references (identity discipline UI → game,
 * ADR-057 §4.2). The projection records this as a `view` facet on the game entity
 * whose source pointer equals the UI element's pointer, so we read it back from
 * `entitiesBySourcePointer`. Steps/flows/roots are excluded: they reference
 * screens (game → ui), which is the opposite direction.
 */
function resolveReferencedGameEntity(context: GroupingContext, uiEntity: EditorEntity): EditorEntity | undefined {
  const key = `${uiEntity.primarySource.filePath}#${uiEntity.primarySource.pointer}`;
  const candidates = context.projection.entitiesBySourcePointer.get(key) ?? [];
  // The projection attaches a game entity's `view` facet to EVERY ancestor
  // component that contains the nested link, so several nodes on one path match.
  // Keep only the entity this node OWNS — the deepest node, i.e. the one whose
  // direct UI children do NOT also carry the same view facet — so a referenced
  // action binds to the leaf that declares it, not to its wrapping containers.
  const uiChildPointers = new Set(
    uiChildEntities(context, uiEntity.entityId)
      .filter((child) => child.primarySource.filePath === uiEntity.primarySource.filePath)
      .map((child) => child.primarySource.pointer)
  );
  const referenced = candidates.filter((candidate) => {
    if (
      candidate.entityId === uiEntity.entityId ||
      candidate.primarySource.documentKind !== "game" ||
      candidate.kind === "game-step" ||
      candidate.kind === "game-flow" ||
      candidate.kind === "game-root"
    ) {
      return false;
    }
    const viewPointers = (candidate.facets.view ?? [])
      .filter((view) => view.filePath === uiEntity.primarySource.filePath)
      .map((view) => view.pointer);
    return !viewPointers.some((pointer) => uiChildPointers.has(pointer));
  });
  if (referenced.length === 0) {
    return undefined;
  }
  return referenced.reduce((lowest, candidate) =>
    candidate.entityId.localeCompare(lowest.entityId) < 0 ? candidate : lowest
  );
}

/**
 * Non-visual entities bound to a screen: game/logic entities with a `view` facet
 * whose source pointer lies inside the screen's subtree (editor-preview-first-ux
 * §2.1). Ordered deterministically.
 */
function collectScreenLogicEntities(context: GroupingContext, screen: EditorEntity): readonly EditorEntity[] {
  const screenFile = screen.primarySource.filePath;
  const screenPointer = screen.primarySource.pointer;
  const result: EditorEntity[] = [];
  for (const entity of context.entities) {
    if (!isNonVisualEntity(entity)) {
      continue;
    }
    const views = entity.facets.view ?? [];
    const bound = views.some(
      (view) =>
        view.filePath === screenFile &&
        (view.pointer === screenPointer || view.pointer.startsWith(`${screenPointer}/`))
    );
    if (bound) {
      result.push(entity);
    }
  }
  return result.sort(compareEntities);
}

/** The type/prototype bucket key: the declared `_type`, else a kind sentinel. */
function typeKeyOf(context: GroupingContext, entity: EditorEntity): string {
  const node = context.readEntityNode(entity);
  if (isPlainJsonObject(node) && typeof node._type === "string" && node._type.trim() !== "") {
    return node._type.trim();
  }
  return `#kind:${entity.kind}`;
}

/**
 * Human label for a type header: the reusable prototype's `_label` from
 * `_definitions` when the type key names one, otherwise a humanized type name.
 */
function typeHeaderLabel(context: GroupingContext, typeKey: string, members: readonly EditorEntity[]): string {
  if (typeKey.startsWith("#kind:")) {
    return titleFromToken(typeKey.replace("#kind:", ""));
  }
  // `_definitions` is a top-level container in the authoring document; when the
  // type key names a reusable prototype, prefer its human `_label`.
  if (members.length > 0) {
    const docJson = context.readDocumentRoot(members[0].primarySource.filePath);
    const definitions = isPlainJsonObject(docJson) ? docJson._definitions : undefined;
    if (isPlainJsonObject(definitions)) {
      const definition = definitions[typeKey];
      if (isPlainJsonObject(definition) && typeof definition._label === "string" && definition._label.trim() !== "") {
        return definition._label.trim();
      }
    }
  }
  return shortTypeName(typeKey);
}

/**
 * Location breadcrumb for a byType instance: the labels of its container
 * ancestors (screen, flow, or a NAMED parent instance), outermost first
 * (editor-preview-first-ux §7). Anonymous structural wrappers are skipped so the
 * crumb stays short, e.g. `["Экран Маршрут"]` or `["Экран Маршрут", "Карточка"]`.
 */
function locationBreadcrumb(context: GroupingContext, entity: EditorEntity): readonly string[] {
  const crumbs: string[] = [];
  let current = context.parentById.get(entity.entityId);
  while (current !== undefined) {
    const named = !current.entityId.includes("#");
    if (current.kind === "ui-screen" || current.kind === "game-flow" || named) {
      crumbs.push(current.label);
    }
    current = context.parentById.get(current.entityId);
  }
  crumbs.reverse();
  return crumbs;
}

/** A UI element declared decorative in the authoring manifest (`_decorative`). */
function isDecorative(node: JsonValue | undefined): boolean {
  return isPlainJsonObject(node) && node._decorative === true;
}

/** Non-visual = not a UI-channel entity (rule, metric, action, step, flow, ...). */
function isNonVisualEntity(entity: EditorEntity): boolean {
  return entity.primarySource.documentKind !== "ui";
}

/** Per-entity projection diagnostic counts by severity, or undefined when none. */
function severityCountsFor(
  context: GroupingContext,
  entityId: string
): TreeViewNodeDiagnosticSeverityCounts | undefined {
  const entity = context.projection.entityById.get(entityId);
  if (entity === undefined || entity.diagnostics.length === 0) {
    return undefined;
  }
  let error = 0;
  let warning = 0;
  for (const diagnostic of entity.diagnostics) {
    if (diagnostic.severity === "error") {
      error += 1;
    } else {
      warning += 1;
    }
  }
  return { error, warning };
}

/** Deterministic order: file path, then numeric-aware JSON Pointer (document order). */
function compareEntities(left: EditorEntity, right: EditorEntity): number {
  if (left.primarySource.filePath !== right.primarySource.filePath) {
    return left.primarySource.filePath < right.primarySource.filePath ? -1 : 1;
  }
  return comparePointers(left.primarySource.pointer, right.primarySource.pointer);
}

function comparePointers(left: string, right: string): number {
  const leftSegments = parseJsonPointer(left);
  const rightSegments = parseJsonPointer(right);
  const shared = Math.min(leftSegments.length, rightSegments.length);
  for (let index = 0; index < shared; index += 1) {
    const leftSegment = leftSegments[index];
    const rightSegment = rightSegments[index];
    const leftNumber = Number(leftSegment);
    const rightNumber = Number(rightSegment);
    const bothNumeric =
      leftSegment !== "" &&
      rightSegment !== "" &&
      Number.isInteger(leftNumber) &&
      Number.isInteger(rightNumber) &&
      String(leftNumber) === leftSegment &&
      String(rightNumber) === rightSegment;
    if (bothNumeric) {
      if (leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
      }
    } else if (leftSegment !== rightSegment) {
      return leftSegment < rightSegment ? -1 : 1;
    }
  }
  return leftSegments.length - rightSegments.length;
}

// ---------------------------------------------------------------------------
// Finalization: plans -> immutable TreeViewModel.
// ---------------------------------------------------------------------------

function finalizeGroupingTree(rootPlan: GroupingNodePlan, maxValuePreviewLength: number | undefined): TreeViewModel {
  const maxPreview = Math.max(12, maxValuePreviewLength ?? 80);

  // Pass 1: assign occurrenceKind in PRE-ORDER, so the first appearance of an
  // entity id with no explicit hint becomes its single `primary` (byScreen).
  const occurrenceByPlan = new Map<GroupingNodePlan, TreeViewNodeOccurrenceKind>();
  const claimedPrimaryIds = new Set<string>();
  const assignOccurrence = (plan: GroupingNodePlan): void => {
    let occurrenceKind: TreeViewNodeOccurrenceKind = "primary";
    if (plan.entityId !== undefined) {
      if (plan.primaryHint === false) {
        occurrenceKind = "occurrence";
      } else if (plan.primaryHint === true) {
        occurrenceKind = "primary";
      } else {
        occurrenceKind = claimedPrimaryIds.has(plan.entityId) ? "occurrence" : "primary";
      }
      if (occurrenceKind === "primary") {
        claimedPrimaryIds.add(plan.entityId);
      }
    }
    occurrenceByPlan.set(plan, occurrenceKind);
    for (const child of plan.children) {
      assignOccurrence(child);
    }
  };
  assignOccurrence(rootPlan);

  // Pass 2: build immutable nodes (children first, so `children` can be readonly).
  const buildNode = (plan: GroupingNodePlan, parentId: string): TreeViewNode => {
    const id = `${parentId}${plan.idSuffix}`;
    const children = plan.children.map((child) => buildNode(child, id));
    const directCount = plan.diagnosticSeverityCounts
      ? plan.diagnosticSeverityCounts.error + plan.diagnosticSeverityCounts.warning
      : 0;
    const subtreeDiagnosticCount =
      directCount + children.reduce((sum, child) => sum + child.subtreeDiagnosticCount, 0);
    return {
      id,
      entityId: plan.entityId,
      occurrenceKind: occurrenceByPlan.get(plan) ?? "primary",
      pointer: plan.pointer,
      parentPointer: plan.parentPointer,
      label: plan.label,
      kind: plan.parentPointer === undefined ? "document" : "object",
      valueType: "object",
      valuePreview: truncate(plan.valuePreview, maxPreview),
      childCount: children.length,
      diagnostics: [],
      subtreeDiagnosticCount,
      graphNodeId: undefined,
      entityKind: plan.entityKind,
      groupingRole: plan.groupingRole,
      isNonVisual: plan.isNonVisual,
      isDecorative: plan.isDecorative,
      isActiveContext: plan.isActiveContext,
      locationBreadcrumb: plan.locationBreadcrumb,
      diagnosticSeverityCounts: plan.diagnosticSeverityCounts,
      actions: { canSetValue: false, readOnly: plan.parentPointer === undefined },
      children
    };
  };
  const root = buildNode(rootPlan, "");

  // Pass 3: collect the flat/index views in PRE-ORDER. `nodeByPointer` prefers the
  // primary node when a pointer surfaces at several occurrences (byType).
  const flatNodes: TreeViewNode[] = [];
  const nodeByPointer = new Map<string, TreeViewNode>();
  const nodesByEntityId = new Map<string, TreeViewNode[]>();
  const visit = (node: TreeViewNode): void => {
    flatNodes.push(node);
    if (node.pointer !== "") {
      const existing = nodeByPointer.get(node.pointer);
      if (existing === undefined || (existing.occurrenceKind === "occurrence" && node.occurrenceKind === "primary")) {
        nodeByPointer.set(node.pointer, node);
      }
    }
    if (node.entityId !== undefined) {
      const group = nodesByEntityId.get(node.entityId);
      if (group === undefined) {
        nodesByEntityId.set(node.entityId, [node]);
      } else {
        group.push(node);
      }
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(root);

  return { root, flatNodes, nodeByPointer, nodesByEntityId };
}
