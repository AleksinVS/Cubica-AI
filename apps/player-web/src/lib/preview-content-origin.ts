/** Optional, non-serializable evidence attached by the content producer. */
const originSymbol = Symbol.for("cubica.player.previewContentOrigin");

export interface PreviewContentOrigin {
  readonly runtimePointer: string;
  /** Only fields copied verbatim from this exact content object are eligible. */
  readonly fields: readonly string[];
}

/** Preserve an exact content origin across a game-owned presentation projection. */
export function withPreviewContentOrigin<T extends object>(
  value: T,
  origin: PreviewContentOrigin
): T {
  Object.defineProperty(value, originSymbol, { value: origin, enumerable: false });
  return value;
}

export function readPreviewContentOrigin(value: unknown): PreviewContentOrigin | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const origin = (value as Record<symbol, unknown>)[originSymbol];
  if (origin === null || typeof origin !== "object") return undefined;
  const record = origin as PreviewContentOrigin;
  return typeof record.runtimePointer === "string" && Array.isArray(record.fields) ? record : undefined;
}
