import {
  buildSemanticEntityProjection,
  hashEditorText,
  isPlainJsonObject,
  readJsonPointer,
  type EditorEntityProjectionDocument,
  type PreviewEntityDescriptor,
  type SemanticEntityProjection,
  type SemanticFacet
} from "@cubica/editor-engine";
import type { EntitySourceCapture } from "./entity-source-text-mode";
import type { MvpElementSource } from "./mvp-element-operations";
import { toRepositoryAuthoringFilePath } from "./workspace-helpers";

interface ProvenFacet extends SemanticFacet { readonly proof: "content-owner" | "metric-owner" }

/** This is a source-map/provenance reader, never an id, value, or text matcher. */
export function mvpProvenFacets(
  descriptor: PreviewEntityDescriptor | undefined,
  documents: readonly EditorEntityProjectionDocument[],
  gameId: string
): readonly ProvenFacet[] {
  const metadata = descriptor?.metadata;
  const binding = isPlainJsonObject(metadata?.textBinding) ? metadata.textBinding : undefined;
  const candidates: { kind: ProvenFacet["kind"]; file: unknown; pointer: unknown; proof: ProvenFacet["proof"] }[] = [
    { kind: "content", file: metadata?.contentOwnerSourceFile, pointer: metadata?.contentOwnerSourcePointer, proof: "content-owner" },
    { kind: "state", file: binding?.metricSourceFile, pointer: binding?.metricSourcePointer, proof: "metric-owner" }
  ];
  const result: ProvenFacet[] = [];
  for (const candidate of candidates) {
    if (typeof candidate.file !== "string" || typeof candidate.pointer !== "string") continue;
    const filePath = toRepositoryAuthoringFilePath(candidate.file, gameId);
    if (filePath === undefined) continue;
    const document = documents.find((item) => item.filePath === filePath && item.documentKind === "game");
    if (document?.json === undefined || !candidate.pointer.startsWith("/root/content/")) continue;
    const sourceValue = readJsonPointer(document.json, candidate.pointer);
    if (sourceValue === undefined) continue;
    const pointer = candidate.pointer;
    const value = readJsonPointer(document.json, pointer);
    if (!isPlainJsonObject(value)) continue;
    if (!result.some((item) => item.kind === candidate.kind && item.filePath === filePath && item.pointer === pointer)) {
      result.push({ kind: candidate.kind, filePath, pointer, proof: candidate.proof });
    }
  }
  return result;
}

export interface MvpSemanticCapture extends EntitySourceCapture {
  readonly semantic: SemanticEntityProjection;
  readonly mode: "instance" | "prototype";
  readonly contextKey: string;
}

export function captureMvpSemanticSource(input: {
  readonly source: MvpElementSource;
  readonly mode: "instance" | "prototype";
  readonly documents: readonly EditorEntityProjectionDocument[];
  readonly liveTexts: ReadonlyMap<string, string>;
  readonly descriptor?: PreviewEntityDescriptor;
  readonly gameId: string;
  readonly contextKey: string;
}): MvpSemanticCapture | undefined {
  const documents = input.documents.flatMap((document) => {
    const text = input.liveTexts.get(document.filePath);
    if (text === undefined) return [];
    try { return [{ ...document, json: JSON.parse(text) as EditorEntityProjectionDocument["json"] }]; }
    catch { return []; }
  });
  const targetDocument = documents.find((document) => document.filePath === input.source.filePath);
  if (targetDocument?.json === undefined || !isPlainJsonObject(readJsonPointer(targetDocument.json, input.source.pointer))) return undefined;
  const facets = input.mode === "instance" ? mvpProvenFacets(input.descriptor, documents, input.gameId) : [];
  const semantic = buildSemanticEntityProjection({
    mode: input.mode, target: { filePath: input.source.filePath, pointer: input.source.pointer },
    targetFacet: targetDocument.documentKind === "game" && input.source.pointer.startsWith("/root/content/") ? "content" : undefined,
    documents, facets
  });
  const filePaths = new Set([input.source.filePath, ...facets.map((facet) => facet.filePath), ...semantic.properties.map((property) => property.owner.filePath)]);
  const sourceHashes: Record<string, string> = {};
  for (const filePath of filePaths) {
    const text = input.liveTexts.get(filePath);
    if (text === undefined) return undefined;
    sourceHashes[filePath] = hashEditorText(text);
  }
  return {
    entityId: `mvp-semantic:${input.mode}:${input.source.filePath}#${input.source.pointer}`,
    projectionYaml: semantic.text,
    facetSourceMap: semantic.facetSourceMap,
    sourceHashes,
    semantic,
    mode: input.mode,
    contextKey: input.contextKey
  };
}
