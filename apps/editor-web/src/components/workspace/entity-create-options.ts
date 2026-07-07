/**
 * Enumerates the types and prototypes a new entity (or prototype) can be created
 * from (ADR-057 §4.10; editor-preview-first-ux §9.1; design-spec §2.8, §3.1;
 * Phase 6.2a, part B).
 *
 * The «+» create menu in the entity tree offers a compact, searchable list of
 * TYPES and local PROTOTYPES. Both are read DECLARATIVELY from the authoring
 * documents themselves — no hardcoded type list, no game id — so the editor stays
 * game-agnostic (CLAUDE.md §10):
 *   - PROTOTYPES are the keys of every document's `_definitions` map (ADR-050).
 *   - TYPES are the distinct `_type` values used by concrete instances that have
 *     no matching local prototype (they resolve to a platform/base type).
 *
 * "Visuality" (does the type get a UI facet?) is the SAME declarative
 * `_requiresView` flag `entity-operations.ts` reads, evaluated for the active
 * channel; a type with no declaring definition is treated as non-visual.
 */
import type { EditorEntityProjectionDocument, JsonValue } from "@cubica/editor-engine";

/** One selectable option in the create menu: a type or a local prototype. */
export interface EntityTypeOption {
  /** The `_type` / `_definitions` key used as `typeOrPrototype` / `baseType`. */
  readonly key: string;
  /** Display label (the key's last dotted segment, humanized minimally). */
  readonly label: string;
  /** Whether this option is a local prototype or a bare/platform type. */
  readonly kind: "prototype" | "type";
  /** True when the type declares `_requiresView` for the active channel. */
  readonly isVisual: boolean;
}

function isObject(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `true`/`{channels:[...]}` interpretation of `_requiresView` for a channel. */
function requiresViewInChannel(requiresView: JsonValue | undefined, channel: string | undefined): boolean {
  if (requiresView === true) {
    return true;
  }
  if (isObject(requiresView) && Array.isArray(requiresView.channels)) {
    return channel !== undefined && requiresView.channels.includes(channel);
  }
  return false;
}

/** Last dotted segment of a type key, for example `ui.MetricBar` → `MetricBar`. */
function shortLabel(key: string): string {
  const parts = key.split(".");
  return parts[parts.length - 1] ?? key;
}

/**
 * Collects the distinct `_type` values used by concrete instances (outside any
 * `_definitions` subtree) across a document's JSON. These become "type" options
 * when they are not already a local prototype key.
 */
function collectInstanceTypes(json: JsonValue, into: Set<string>): void {
  const visit = (value: JsonValue, insideDefinitions: boolean): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, insideDefinitions);
      }
      return;
    }
    if (!isObject(value)) {
      return;
    }
    if (!insideDefinitions && typeof value._type === "string") {
      into.add(value._type);
    }
    for (const [key, child] of Object.entries(value)) {
      visit(child, insideDefinitions || key === "_definitions");
    }
  };
  visit(json, false);
}

/**
 * Builds the create-menu options from the project's authoring documents.
 * Prototypes win over bare types when a key appears as both; results are sorted
 * by label so the menu is stable (recency/frequency ordering is a later refinement
 * — the list itself is the primary path, design-spec §3.1).
 */
export function collectEntityTypeOptions(input: {
  readonly documents: readonly EditorEntityProjectionDocument[];
  readonly channel: string | undefined;
}): readonly EntityTypeOption[] {
  const prototypeVisualByKey = new Map<string, boolean>();
  const instanceTypes = new Set<string>();

  for (const document of input.documents) {
    if (!isObject(document.json)) {
      continue;
    }
    const definitions = document.json._definitions;
    if (isObject(definitions)) {
      for (const [key, definition] of Object.entries(definitions)) {
        const isVisual = isObject(definition) && requiresViewInChannel(definition._requiresView, input.channel);
        prototypeVisualByKey.set(key, (prototypeVisualByKey.get(key) ?? false) || isVisual);
      }
    }
    collectInstanceTypes(document.json, instanceTypes);
  }

  const options: EntityTypeOption[] = [];
  for (const [key, isVisual] of prototypeVisualByKey) {
    options.push({ key, label: shortLabel(key), kind: "prototype", isVisual });
  }
  for (const key of instanceTypes) {
    if (prototypeVisualByKey.has(key)) {
      continue;
    }
    // A bare type is visual only if some prototype extending it declares a view;
    // without a declaring definition it is treated as non-visual (game-agnostic).
    options.push({ key, label: shortLabel(key), kind: "type", isVisual: false });
  }

  return options.sort((left, right) => left.label.localeCompare(right.label) || left.key.localeCompare(right.key));
}
