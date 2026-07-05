/**
 * Node-only manifest content hashing for state fixtures (ADR-057 §4.9).
 *
 * This module intentionally lives OUTSIDE the package barrel (`index.ts`):
 * it imports `node:crypto`, and the barrel is reachable from browser bundles
 * (editor-web client components import runtime values from it), so re-exporting
 * this function there breaks `next build` with an unresolvable `node:crypto`
 * scheme. Server-side consumers import it through the dedicated subpath
 * `@cubica/editor-engine/state-fixture-hash` (see package.json `exports`).
 *
 * The semantic fixture validation itself (`state-fixture.ts`) is pure and
 * browser-safe: it only COMPARES hash strings. Producing the hash is an
 * editor-host (Node) concern — fixtures are captured and re-hashed where the
 * authoring files are read from disk, never inside the player or the browser
 * bundle.
 */
import { createHash } from "node:crypto";

/** One authoring manifest file contributing to the deterministic content hash. */
export interface ManifestContentFile {
  /** Repository-relative path; used both as sort key and hash input. */
  readonly path: string;
  /** Verbatim file text at capture time. */
  readonly content: string;
}

/**
 * Computes the deterministic content hash of a game's authoring manifests.
 *
 * Rule (stable across machines and runs): sort the files by `path`, then feed a
 * single SHA-256 the concatenation of `${path}\n${content}\n` for each file in
 * that order, and format the digest as `sha256-<hex>`. Sorting by path makes the
 * result independent of input order; including the path guards against two files
 * swapping content. The output matches the `^sha256-[0-9a-f]{64}$` pattern the
 * fixture schema requires for `manifestHash`.
 */
export function computeManifestContentHash(files: readonly ManifestContentFile[]): string {
  const sorted = [...files].sort((left, right) => {
    if (left.path < right.path) {
      return -1;
    }
    return left.path > right.path ? 1 : 0;
  });

  const hash = createHash("sha256");
  for (const file of sorted) {
    hash.update(`${file.path}\n${file.content}\n`);
  }

  return `sha256-${hash.digest("hex")}`;
}
