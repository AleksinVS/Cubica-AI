import { encodeJsonPointerSegment, type EditorChangeSet, type JsonObject, type JsonValue, type PreviewRect } from "@cubica/editor-engine";

export interface MvpElementSource {
  readonly filePath: string;
  readonly pointer: string;
  readonly value: JsonObject;
}

export type MvpGeometryGesture =
  | { readonly kind: "move"; readonly dx: number; readonly dy: number }
  | { readonly kind: "resize"; readonly dx: number; readonly dy: number }
  | { readonly kind: "rotate"; readonly degrees: number };

const canonicalTransform = /^translate\((-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px\) rotate\((-?\d+(?:\.\d+)?)deg\)$/u;

function objectValue(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: number): number {
  return Math.round(value * 10) / 10;
}

export function geometrySupport(source: MvpElementSource | undefined): string | undefined {
  if (source === undefined) return "Для этого элемента не найден редактируемый источник.";
  if (source.value._type === "interactiveBoardSurface" || source.value.type === "interactiveBoardSurface") {
    return "Поле игры рисуется отдельно; измените его через описание или исходный файл.";
  }
  const style = source.value.style;
  if (style !== undefined && !objectValue(style)) return "Стиль элемента имеет неподдерживаемый формат.";
  const transform = style?.transform;
  if (transform !== undefined && (typeof transform !== "string" || !canonicalTransform.test(transform))) {
    return "Текущее преобразование не поддерживает ручное перемещение. Используйте описание элемента.";
  }
  for (const dimension of [style?.width, style?.height]) {
    if (dimension !== undefined && readPixels(dimension) === undefined) return "Размер задан в неподдерживаемых единицах. Используйте пиксели или описание элемента.";
  }
  return undefined;
}

function readPixels(value: JsonValue): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 16384) return value;
  if (typeof value === "string" && /^\d+(?:\.\d+)?px$/u.test(value)) {
    const parsed = Number.parseFloat(value);
    if (parsed >= 1 && parsed <= 16384) return parsed;
  }
  return undefined;
}

function changeSet(source: MvpElementSource, field: string, nextValue: JsonValue | undefined, summary: string): EditorChangeSet {
  const exists = Object.hasOwn(source.value, field);
  const fieldPointer = `${source.pointer}/${encodeJsonPointerSegment(field)}`;
  const operations: EditorChangeSet["jsonPatches"][number]["operations"] = [
    { op: "test", path: source.pointer, value: source.value },
    ...(nextValue === undefined
      ? exists ? [{ op: "remove" as const, path: fieldPointer }] : []
      : [{ op: exists ? "replace" as const : "add" as const, path: fieldPointer, value: nextValue }])
  ];
  return {
    id: `mvp-element-${crypto.randomUUID()}`,
    summary,
    jsonPatches: [{ filePath: source.filePath, operations }]
  };
}

export function buildMvpElementNameChangeSet(source: MvpElementSource, name: string): EditorChangeSet | undefined {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed === source.value._label) return undefined;
  return changeSet(source, "_label", trimmed, `Название элемента: ${trimmed}`);
}

export function buildMvpElementAuthorPromptChangeSet(source: MvpElementSource, raw: string): EditorChangeSet | undefined {
  const trimmed = raw.trim();
  const existing = objectValue(source.value._prompt) ? source.value._prompt : undefined;
  if (trimmed === (typeof existing?.raw === "string" ? existing.raw : "")) return undefined;
  return changeSet(source, "_prompt", trimmed === "" ? undefined : {
    status: "draft",
    raw: trimmed,
    source: "user",
    language: "ru",
    updatedAt: new Date().toISOString()
  }, trimmed === "" ? "Удалено авторское описание элемента" : "Обновлено авторское описание элемента");
}

export function buildMvpGeometryChangeSet(
  source: MvpElementSource,
  bounds: PreviewRect,
  gesture: MvpGeometryGesture
): EditorChangeSet | undefined {
  if (geometrySupport(source) !== undefined) return undefined;
  const style = objectValue(source.value.style) ? source.value.style : {};
  const oldTransform = typeof style.transform === "string" ? canonicalTransform.exec(style.transform) : undefined;
  let x = oldTransform == null ? 0 : Number(oldTransform[1]);
  let y = oldTransform == null ? 0 : Number(oldTransform[2]);
  let angle = oldTransform == null ? 0 : Number(oldTransform[3]);
  const nextStyle: Record<string, JsonValue> = { ...style };
  if (gesture.kind === "move") {
    x = Math.max(-100000, Math.min(100000, finite(x + gesture.dx)));
    y = Math.max(-100000, Math.min(100000, finite(y + gesture.dy)));
  } else if (gesture.kind === "rotate") {
    angle = finite((angle + gesture.degrees) % 360);
  } else {
    const width = style.width === undefined ? bounds.width : readPixels(style.width);
    const height = style.height === undefined ? bounds.height : readPixels(style.height);
    if (width === undefined || height === undefined) return undefined;
    nextStyle.width = Math.max(12, Math.min(16384, finite(width + gesture.dx)));
    nextStyle.height = Math.max(12, Math.min(16384, finite(height + gesture.dy)));
  }
  if (gesture.kind !== "resize") nextStyle.transform = `translate(${x}px, ${y}px) rotate(${angle}deg)`;
  if (JSON.stringify(nextStyle) === JSON.stringify(style)) return undefined;
  return changeSet(source, "style", nextStyle, gesture.kind === "move" ? "Элемент перемещён" : gesture.kind === "resize" ? "Размер элемента изменён" : "Элемент повёрнут");
}

export function isMvpMetadataOnlyChangeSet(changeSet: EditorChangeSet): boolean {
  if ((changeSet.textPatches?.length ?? 0) > 0 || (changeSet.fileCreates?.length ?? 0) > 0 ||
      (changeSet.fileDeletes?.length ?? 0) > 0 || (changeSet.fileRenames?.length ?? 0) > 0) return false;
  const writes = changeSet.jsonPatches.flatMap((patch) => patch.operations).filter((operation) => operation.op !== "test");
  return writes.length > 0 && writes.every((operation) => /\/(?:_label|_prompt|_semantics)(?:\/|$)/u.test(operation.path));
}
