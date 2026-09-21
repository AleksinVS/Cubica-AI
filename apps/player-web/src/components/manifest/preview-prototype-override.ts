import type { GameUiComponent, GameUiPanelDefinition, GameUiScreenDefinition } from "@cubica/contracts-manifest";

type Definition = GameUiScreenDefinition | GameUiPanelDefinition;

/** Replace one existing compiled UI subtree in memory, preserving every ancestor and sibling. */
export function withPreviewPrototypeOverride<T extends Definition>(
  definition: T,
  rootRuntimePointer: string,
  targetRuntimePointer: string,
  replacement: GameUiComponent
): T | undefined {
  if (targetRuntimePointer !== rootRuntimePointer &&
      !targetRuntimePointer.startsWith(`${rootRuntimePointer}/children/`)) return undefined;
  const suffix = targetRuntimePointer.slice(rootRuntimePointer.length);
  const segments = suffix === "" ? [] : suffix.slice(1).split("/");
  if (segments.length % 2 !== 0) return undefined;
  const indexes: number[] = [];
  for (let i = 0; i < segments.length; i += 2) {
    if (segments[i] !== "children" || !/^(?:0|[1-9][0-9]*)$/u.test(segments[i + 1])) return undefined;
    const index = Number(segments[i + 1]);
    if (!Number.isSafeInteger(index)) return undefined;
    indexes.push(index);
  }
  const root = replaceAt(definition.root, indexes, replacement);
  return root === undefined ? undefined : { ...definition, root } as T;
}

function replaceAt(
  current: GameUiComponent,
  indexes: readonly number[],
  replacement: GameUiComponent
): GameUiComponent | undefined {
  if (indexes.length === 0) {
    // A prototype can change defaults and its own children, but not silently
    // replace the selected component with a different UI kind.
    return current.type === replacement.type ? replacement : undefined;
  }
  const [index, ...rest] = indexes;
  if (!current.children || index >= current.children.length) return undefined;
  const child = replaceAt(current.children[index], rest, replacement);
  if (child === undefined) return undefined;
  const children = [...current.children];
  children[index] = child;
  return { ...current, children };
}

export function previewScreenRootPointer(screenKey: string): string {
  return `/screens/${escapeSegment(screenKey)}/root`;
}

export function previewPanelRootPointer(panelKey: string): string {
  return `/panels/${escapeSegment(panelKey)}/root`;
}

function escapeSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
