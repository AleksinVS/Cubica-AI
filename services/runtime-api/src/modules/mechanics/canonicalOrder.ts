/** Compare stable entity identifiers by UTF-8 bytes, independent of locale. */
export function compareCanonicalIds(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
