/**
 * Small, presentation-only projection of the web UI authoring document.
 *
 * This intentionally does not validate or compile authoring JSON. The editor
 * needs a useful outline while a document is incomplete, so unknown values
 * remain visible as neutral nodes and dynamic strings are never evaluated.
 */
import type { JsonObject, JsonValue } from "@cubica/editor-engine";

export const EDITOR_WIREFRAME_MAX_DEPTH = 24;
export const EDITOR_WIREFRAME_MAX_NODES = 256;
export const EDITOR_WIREFRAME_MAX_SCREENS = 64;

export type EditorWireframeNodeKind =
  | "container"
  | "text"
  | "button"
  | "metric"
  | "asset"
  | "card"
  | "unknown";

export interface EditorWireframeNode {
  readonly id: string;
  readonly label: string;
  readonly kind: EditorWireframeNodeKind;
  readonly sourcePointer: string;
  readonly sourceFilePath: string;
  readonly children: readonly EditorWireframeNode[];
  /** A short authored value, retained for display without interpreting it. */
  readonly displayText?: string;
  /** Marks a node whose authored descendants were omitted by the projection budget. */
  readonly truncated?: boolean;
}

export interface EditorWireframeScreen {
  readonly id: string;
  readonly label: string;
  readonly sourcePointer: string;
  readonly nodes: readonly EditorWireframeNode[];
}

export interface EditorWireframeProjection {
  readonly title: string;
  readonly screens: readonly EditorWireframeScreen[];
  readonly entryScreenId: string | null;
  readonly truncated: boolean;
}

type JsonRecord = JsonObject;

function isRecord(value: JsonValue | undefined): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function escapePointerToken(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function childPointer(pointer: string, key: string | number): string {
  return `${pointer}/${escapePointerToken(String(key))}`;
}

function authoredProps(value: JsonRecord): JsonRecord {
  return isRecord(value.props) ? value.props : {};
}

function componentType(value: JsonRecord): string {
  return stringValue(value.type) ?? stringValue(value._type) ?? "unknown";
}

function displayValue(value: JsonValue | undefined): string | undefined {
  return stringValue(value);
}

/**
 * Picks only human-facing text fields. In particular, this returns bindings
 * such as `{{choice.title}}` literally instead of attempting to resolve them.
 */
function authoredDisplayText(value: JsonRecord): string | undefined {
  const props = authoredProps(value);
  return displayValue(value._label)
    ?? displayValue(props.caption)
    ?? displayValue(props.text)
    ?? displayValue(props.title)
    ?? displayValue(props.summary)
    ?? displayValue(props.html)
    ?? displayValue(value.title);
}

function firstPropString(value: JsonRecord, predicate: (candidate: string) => boolean): string | undefined {
  const props = authoredProps(value);
  for (const key of Object.keys(props)) {
    const candidate = props[key];
    if (typeof candidate === "string" && predicate(candidate)) return candidate.trim();
  }
  return undefined;
}

function bindingReference(value: JsonRecord): string | undefined {
  return firstPropString(value, (candidate) => candidate.includes("{{"));
}

function assetReference(value: JsonRecord): string | undefined {
  return firstPropString(value, (candidate) => candidate.startsWith("asset:") || candidate.startsWith("/"));
}

function hasAssetReference(value: JsonRecord): boolean {
  const props = authoredProps(value);
  return [props.asset, props.image, props.backgroundImage, props.src]
    .some((candidate) => typeof candidate === "string" && candidate.trim() !== "");
}

function nodeKind(value: JsonRecord, displayText: string | undefined): EditorWireframeNodeKind {
  const type = componentType(value).toLowerCase();
  if (hasAssetReference(value) || type.includes("image") || type.includes("asset")) return "asset";
  if (type.includes("button") || type.includes("action")) return "button";
  if (type.includes("metric") || type.includes("variable")) return "metric";
  if (type.includes("card")) return "card";
  if (type.includes("text") || type.includes("label") || type.includes("rich")) return "text";
  if (
    type.includes("screen")
    || type.includes("area")
    || type.includes("container")
    || type.includes("panel")
    || type.includes("layout")
    || Array.isArray(value.children)
  ) return "container";
  if (displayText !== undefined || type !== "unknown") return "unknown";
  return "unknown";
}

function fallbackLabel(value: JsonRecord, type: string, index: number): string {
  const id = stringValue(value.id);
  if (id !== undefined) return id;
  if (type !== "unknown") return type;
  return `Компонент ${index + 1}`;
}

/**
 * Builds an editor-only wireframe for `root.screens`. It is deliberately
 * forgiving: malformed screens are skipped, while malformed child values are
 * represented by no executable behavior and the remaining tree stays useful.
 */
export function projectEditorWireframe(
  document: JsonValue,
  sourceFilePath: string
): EditorWireframeProjection {
  const manifest = isRecord(document) ? document : {};
  const hasRoot = isRecord(manifest.root);
  const root = hasRoot ? manifest.root as JsonRecord : manifest;
  const rootPointer = hasRoot ? "/root" : "";
  const screenValues = Array.isArray(root.screens) ? root.screens : [];
  const entryPoint = stringValue(root.entry_point);
  const title = stringValue(root._label) ?? stringValue(manifest._label) ?? "Структурный макет";
  let nodeCount = 0;
  let truncated = false;
  let truncationMarkerEmitted = false;

  function incompleteNode(pointer: string, index: number): EditorWireframeNode | undefined {
    if (nodeCount >= EDITOR_WIREFRAME_MAX_NODES - 1) {
      if (truncationMarkerEmitted) return undefined;
      truncationMarkerEmitted = true;
      return truncationNode(pointer, index);
    }
    nodeCount += 1;
    return {
      id: `incomplete-${index}`,
      label: "Незавершённый элемент",
      kind: "unknown",
      sourcePointer: pointer,
      sourceFilePath,
      children: []
    };
  }

  function truncationNode(pointer: string, index: number): EditorWireframeNode {
    truncated = true;
    return {
      id: `truncated-${index}`,
      label: "Структура сокращена",
      kind: "unknown",
      sourcePointer: pointer,
      sourceFilePath,
      children: [],
      truncated: true
    };
  }

  function visit(value: JsonValue | undefined, pointer: string, index: number, depth: number): EditorWireframeNode | undefined {
    if (!isRecord(value)) return incompleteNode(pointer, index);
    if (nodeCount >= EDITOR_WIREFRAME_MAX_NODES - 1) {
      if (truncationMarkerEmitted) return undefined;
      truncationMarkerEmitted = true;
      return truncationNode(pointer, index);
    }
    nodeCount += 1;

    const type = componentType(value);
    const authoredText = authoredDisplayText(value);
    const bindingText = bindingReference(value);
    const assetText = assetReference(value);
    const detailText = bindingText ?? assetText;
    const label = authoredText
      ?? detailText
      ?? fallbackLabel(value, type, index);
    const childValues = Array.isArray(value.children) ? value.children : [];
    const children: EditorWireframeNode[] = [];
    let nodeTruncated = false;
    if (depth >= EDITOR_WIREFRAME_MAX_DEPTH && childValues.length > 0) {
      nodeTruncated = true;
      truncated = true;
    } else {
      for (let childIndex = 0; childIndex < childValues.length; childIndex += 1) {
        const child = childValues[childIndex];
        const childNode = visit(child, childPointer(childPointer(pointer, "children"), childIndex), childIndex, depth + 1);
        if (childNode !== undefined) children.push(childNode);
        if (truncationMarkerEmitted) {
          nodeTruncated = true;
          break;
        }
      }
      nodeTruncated = nodeTruncated || children.some((child) => child.truncated === true);
    }

    const kind = authoredText === undefined && bindingText !== undefined
      ? "unknown"
      : nodeKind(value, authoredText);
    return {
      id: stringValue(value.id) ?? `${type.replace(/[^a-zA-Z0-9_-]+/g, "-") || "node"}-${index}`,
      label,
      kind,
      sourcePointer: pointer,
      sourceFilePath,
      children,
      ...(detailText !== undefined && detailText !== label ? { displayText: detailText } : {}),
      ...(nodeTruncated ? { truncated: true } : {})
    };
  }

  const screens: EditorWireframeScreen[] = [];
  const screenLimit = Math.min(screenValues.length, EDITOR_WIREFRAME_MAX_SCREENS);
  for (let index = 0; index < screenLimit; index += 1) {
    const candidate = screenValues[index];
    if (!isRecord(candidate)) continue;
    const id = stringValue(candidate.id) ?? `screen-${index + 1}`;
    const screenPointer = childPointer(childPointer(rootPointer, "screens"), index);
    const screenLabel = stringValue(candidate._label) ?? stringValue(candidate.title) ?? id;
    const rootValue = candidate.root;
    const rootNode = visit(rootValue, childPointer(screenPointer, "root"), 0, 0);
    screens.push({
      id,
      label: screenLabel,
      sourcePointer: screenPointer,
      nodes: rootNode === undefined ? [] : [rootNode]
    });
  }
  if (screenValues.length > screenLimit) truncated = true;

  const entryScreenId = screens.some((screen) => screen.id === entryPoint)
    ? entryPoint ?? null
    : screens[0]?.id ?? null;

  return { title, screens, entryScreenId, truncated };
}
