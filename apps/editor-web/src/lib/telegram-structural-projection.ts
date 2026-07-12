/**
 * Framework-free projection of a Telegram UI authoring manifest.
 *
 * The editor needs a readable structural preview, not a Telegram client and not
 * a runtime transport model.  This module therefore reads only the ordinary
 * channel-specific UI document and preserves JSON Pointers back to every shown
 * authoring node.  Keeping the projection free of React and Telegram SDK imports
 * makes the renderer boundary easy to test and reuse.
 */
import type { JsonObject, JsonValue } from "@cubica/editor-engine";

export interface TelegramStructuralAction {
  readonly id: string;
  readonly label: string;
  readonly command?: string;
  readonly sourcePointer: string;
  readonly sourceFilePath: string;
}

export interface TelegramStructuralMessage {
  readonly id: string;
  readonly kind: "message" | "helper" | "unknown";
  readonly label: string;
  readonly text: string;
  readonly sourcePointer: string;
  readonly sourceFilePath: string;
  readonly componentType: string;
  readonly actions: readonly TelegramStructuralAction[];
}

export interface TelegramStructuralProjection {
  readonly title: string;
  readonly messages: readonly TelegramStructuralMessage[];
}

type JsonRecord = JsonObject;

function isRecord(value: JsonValue | undefined): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function escapePointerToken(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function childPointer(pointer: string, key: string | number): string {
  return `${pointer}/${escapePointerToken(String(key))}`;
}

function componentLabel(component: JsonRecord, type: string): string {
  return text(component._label) ?? text(component.id) ?? type;
}

function projectAction(component: JsonRecord, pointer: string, index: number, sourceFilePath: string): TelegramStructuralAction {
  const props = isRecord(component.props) ? component.props : {};
  const actions = isRecord(component.actions) ? component.actions : {};
  const onClick = isRecord(actions.onClick) ? actions.onClick : {};
  return {
    id: text(component.id) ?? `action-${index}`,
    label: text(props.caption) ?? text(props.label) ?? componentLabel(component, "Действие"),
    ...(text(onClick.command) !== undefined ? { command: text(onClick.command) } : {}),
    sourcePointer: pointer,
    sourceFilePath
  };
}

/**
 * Builds the minimal message feed used by the editor's Telegram viewer.
 * Unknown leaf components remain visible as diagnostic cards: silently dropping
 * them would make an incomplete preview look valid to an author.
 */
export function projectTelegramAuthoringManifest(document: JsonValue, sourceFilePath = ""): TelegramStructuralProjection {
  const manifest = isRecord(document) ? document : {};
  const root = isRecord(manifest.root) ? manifest.root : manifest;
  const screens = Array.isArray(root.screens) ? root.screens : [];
  const entryPoint = text(root.entry_point);
  const selectedScreenIndex = Math.max(
    0,
    screens.findIndex((candidate) => isRecord(candidate) && text(candidate.id) === entryPoint)
  );
  const screen = isRecord(screens[selectedScreenIndex]) ? screens[selectedScreenIndex] : undefined;
  const screenPointer = childPointer("/root/screens", selectedScreenIndex);
  const messages: Array<TelegramStructuralMessage & { actions: TelegramStructuralAction[] }> = [];
  const looseActions: TelegramStructuralAction[] = [];

  function visit(value: JsonValue | undefined, pointer: string): void {
    if (!isRecord(value)) return;
    const type = text(value.type) ?? text(value._type) ?? "unknown";
    const props = isRecord(value.props) ? value.props : {};
    const normalizedType = type.toLowerCase();

    if (normalizedType.includes("button")) {
      const action = projectAction(value, pointer, looseActions.length, sourceFilePath);
      const target = messages.at(-1);
      if (target === undefined) looseActions.push(action);
      else target.actions.push(action);
    } else if (normalizedType.includes("message") || normalizedType.includes("helper")) {
      messages.push({
        id: text(value.id) ?? `message-${messages.length}`,
        kind: normalizedType.includes("helper") ? "helper" : "message",
        label: componentLabel(value, type),
        text: text(props.text) ?? text(props.caption) ?? componentLabel(value, type),
        sourcePointer: pointer,
        sourceFilePath,
        componentType: type,
        actions: []
      });
    }

    const children = Array.isArray(value.children) ? value.children : [];
    children.forEach((child, index) => visit(child, childPointer(childPointer(pointer, "children"), index)));

    // Containers are structural only. An unrecognised leaf is shown explicitly,
    // with its source pointer, so schema evolution does not hide author content.
    const isContainer = normalizedType.includes("screen") || normalizedType.includes("area") || normalizedType.includes("container");
    if (children.length === 0 && !normalizedType.includes("button") && !normalizedType.includes("message") && !normalizedType.includes("helper") && !isContainer) {
      messages.push({
        id: text(value.id) ?? `unknown-${messages.length}`,
        kind: "unknown",
        label: componentLabel(value, type),
        text: `Компонент «${type}» пока не поддерживается структурным просмотром.`,
        sourcePointer: pointer,
        sourceFilePath,
        componentType: type,
        actions: []
      });
    }
  }

  if (screen !== undefined) visit(screen.root, childPointer(screenPointer, "root"));
  if (looseActions.length > 0) {
    messages.push({
      id: "standalone-actions",
      kind: "helper",
      label: "Доступные действия",
      text: "Действия без предшествующего сообщения",
      sourcePointer: screenPointer,
      sourceFilePath,
      componentType: "action-group",
      actions: looseActions
    });
  }

  return {
    title: screen === undefined ? "Telegram" : text(screen.title) ?? text(screen._label) ?? "Telegram",
    messages
  };
}
