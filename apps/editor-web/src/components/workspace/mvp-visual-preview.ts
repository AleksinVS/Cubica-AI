import { applyJsonPatch, isPlainJsonObject, readJsonPointer, type EditorChangeSet, type JsonValue, type PreviewEntityDescriptor } from "@cubica/editor-engine";
import type { EditorPreviewTemporaryLayerRequest } from "@cubica/contracts-session";
import { toRepositoryAuthoringFilePath } from "./workspace-helpers";

type VisualPatch = EditorPreviewTemporaryLayerRequest["patches"][number];
const textProperties = new Set(["html", "caption", "text", "title", "summary"]);
const geometryProperties = new Set(["width", "height", "transform"]);

/** Only exact visible property ownership may become a temporary renderer value. */
export function projectMvpVisualChange(
  change: EditorChangeSet,
  documents: ReadonlyMap<string, string>,
  entities: readonly PreviewEntityDescriptor[],
  gameId: string
): VisualPatch[] | undefined {
  if (change.textPatches?.length || change.fileCreates?.length || change.fileDeletes?.length || change.fileRenames?.length) return undefined;
  const result: VisualPatch[] = [];
  for (const patch of change.jsonPatches) {
    const text = documents.get(patch.filePath);
    if (text === undefined) return undefined;
    let document: JsonValue;
    try {
      document = JSON.parse(text) as JsonValue;
      applyJsonPatch(document, patch.operations);
    } catch { return undefined; }
    for (const op of patch.operations) {
      if (op.op === "test") continue;
      if (op.op !== "add" && op.op !== "replace") return undefined;
      if (/\/(?:_label|_prompt|_promptTemplate)(?:\/|$)/u.test(op.path)) continue;
      // Parent creation emitted by the semantic interpreter has no visible effect.
      if (isPlainJsonObject(op.value) && Object.keys(op.value).length === 0 && /\/(?:props|style)$/u.test(op.path)) continue;
      const writes: { path: string; value: JsonValue }[] = [];
      if (op.path.endsWith("/style") && isPlainJsonObject(op.value)) {
        const before = readJsonPointer(document, op.path);
        if (before !== undefined && !isPlainJsonObject(before)) return undefined;
        const nextStyle = op.value;
        if (isPlainJsonObject(before) && Object.keys(before).some(key => !(key in nextStyle))) return undefined;
        for (const [key, value] of Object.entries(op.value)) {
          if (isPlainJsonObject(before) && JSON.stringify(before[key]) === JSON.stringify(value)) continue;
          if (!geometryProperties.has(key)) return undefined;
          writes.push({ path: `${op.path}/${key}`, value });
        }
      } else writes.push({ path: op.path, value: op.value });
      for (const write of writes) {
        let matched = false;
        for (const entity of entities) {
          if (!entity.visible || entity.runtimePointer === undefined) continue;
          const metadata = entity.metadata;
          const sourceFile = typeof metadata?.sourceFile === "string" ? toRepositoryAuthoringFilePath(metadata.sourceFile, gameId) : undefined;
          const binding = isPlainJsonObject(metadata?.textBinding) ? metadata.textBinding : undefined;
          let property: string | undefined;
          let owner: string | undefined;
          const geometry = write.path.slice((entity.authoringPointer ?? "").length + 7);
          if (sourceFile === patch.filePath && entity.authoringPointer !== undefined && write.path.startsWith(`${entity.authoringPointer}/style/`) && geometryProperties.has(geometry)) {
            property = geometry;
            owner = `${entity.runtimePointer}/style/${property}`;
          } else if (sourceFile === patch.filePath && entity.authoringPointer !== undefined && write.path.startsWith(`${entity.authoringPointer}/props/`)) {
            const key = write.path.slice(entity.authoringPointer.length + 7);
            if (textProperties.has(key) && binding === undefined) { property = key; owner = `${entity.runtimePointer}/props/${key}`; }
          } else if (binding !== undefined && typeof binding.contentSourceFile === "string" &&
              toRepositoryAuthoringFilePath(binding.contentSourceFile, gameId) === patch.filePath &&
              binding.contentSourcePointer === write.path && typeof binding.contentRuntimePointer === "string" &&
              typeof binding.prop === "string" && textProperties.has(binding.prop)) {
            property = binding.prop; owner = binding.contentRuntimePointer;
          } else if (sourceFile === patch.filePath && entity.authoringPointer === write.path &&
              (typeof metadata?.contentRuntimePointer === "string" || entity.runtimePointer.startsWith("/content/")) && textProperties.has(write.path.split("/").at(-1) ?? "")) {
            property = write.path.split("/").at(-1); owner = typeof metadata?.contentRuntimePointer === "string" ? metadata.contentRuntimePointer : entity.runtimePointer;
          }
          if (property === undefined || owner === undefined) continue;
          const value = write.value;
          if (geometryProperties.has(property)) {
            if (property === "transform" ? typeof value !== "string" || !/^translate\(-?\d+(?:\.\d+)?px,\s*-?\d+(?:\.\d+)?px\) rotate\(-?\d+(?:\.\d+)?deg\)$/u.test(value)
              : typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 16384) return undefined;
          } else if (typeof value !== "string" || value.length > 10000 || /\{\{/u.test(value)) return undefined;
          result.push({ operationId: change.id, runtimePointer: entity.runtimePointer, ownerRuntimePointer: owner,
            property: property as VisualPatch["property"], value: value as string | number });
          matched = true;
        }
        if (!matched) return undefined;
      }
    }
  }
  return result.length > 0 && result.length <= 100 ? result : undefined;
}
