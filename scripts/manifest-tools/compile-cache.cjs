/**
 * Level-3 compile cache and telemetry for the ADR-030 authoring compiler.
 *
 * WHAT THIS IS. A one-shot ("throwaway") disk cache: it stores the result of
 * compiling one authoring job (the runtime manifest plus its source map) keyed
 * by a summary hash of *all* inputs of that compile. Reading a hit avoids the
 * expensive recompile; a miss recompiles and repopulates.
 *
 * ARCHITECTURAL INVARIANTS (ADR-057 §5, editor-preview-first-ux.md §10).
 *   - The cache is NEVER a source of truth and NEVER an input to compilation or
 *     runtime. It only memoises a pure function of authoring inputs.
 *   - Any mismatch, missing/partial file, or corruption results in a SILENT
 *     miss and a normal recompile — never a user-facing error. So callers treat
 *     read failures as "not cached".
 *   - Cache files live only under `.tmp/` (outside Git); deleting them is always
 *     safe.
 *
 * CONCURRENCY. Several worker threads (or separate processes) may compile in
 * parallel. Writes are atomic (temp file + rename) so a reader never observes a
 * half-written file, and two writers of the same key produce byte-identical
 * content (same inputs -> same output), so a race cannot corrupt an entry.
 */

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

// Bumping this version invalidates every previously written cache entry. It is
// mixed into the key prefix so the format of the stored payload can evolve
// without ever reading a stale-shaped file.
const COMPILE_CACHE_FORMAT_VERSION = 1;

/** SHA-256 hex digest of a string; the single hashing primitive used for keys. */
function hashText(text) {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Decides whether the compile cache is active for this run.
 *
 * WHERE THE CACHE IS ON BY DEFAULT AND WHERE IT IS NOT:
 *   - Explicit env `CUBICA_COMPILE_CACHE` always wins: "1"/"true" force it on,
 *     "0"/"false" force it off.
 *   - Otherwise the default is ON for normal compilation and OFF for the CI
 *     drift-check (`--check`). The drift-check must compile honestly so a cache
 *     can never mask a compiler behaviour change; write/hot-path runs benefit
 *     from warm reuse. (The compiler source hash is part of the key too, so even
 *     an explicitly enabled cache cannot hide a compiler change — but honest by
 *     default keeps CI unambiguous.)
 */
function resolveCompileCacheEnabled({ check = false } = {}) {
  const env = process.env.CUBICA_COMPILE_CACHE;
  if (env === "1" || env === "true") {
    return true;
  }
  if (env === "0" || env === "false") {
    return false;
  }
  return !check;
}

function cacheFilePath(cacheDir, key) {
  return path.join(cacheDir, `${key}.json`);
}

/**
 * Reads a cache entry, returning `{ manifest, sourceMap }` on a clean hit or
 * `null` on any miss/corruption. Never throws: the cache is one-shot, so a bad
 * read simply becomes a recompile.
 */
function readCacheEntry(cacheDir, key) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFilePath(cacheDir, key), "utf8"));
    if (parsed && typeof parsed === "object" && parsed.manifest !== undefined && parsed.sourceMap !== undefined) {
      return { manifest: parsed.manifest, sourceMap: parsed.sourceMap };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Atomically writes a cache entry. Writes to a unique temp file first, then
 * renames it into place (rename is atomic on a single filesystem). Failures are
 * swallowed — a cache that cannot be written must not fail the compile.
 */
function writeCacheEntry(cacheDir, key, payload) {
  const tempPath = path.join(
    cacheDir,
    `.${key}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  );
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(tempPath, `${JSON.stringify(payload)}\n`, "utf8");
    fs.renameSync(tempPath, cacheFilePath(cacheDir, key));
  } catch {
    // Best effort: remove the temp file if the rename never happened.
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // ignore
    }
  }
}

/**
 * Structured hit/miss + duration telemetry for a single compile run
 * (design-spec §5). Durations are milliseconds: read time on hits, compile time
 * on misses.
 */
function createCompileTelemetry() {
  let cacheHits = 0;
  let cacheMisses = 0;
  let hitReadMs = 0;
  let missCompileMs = 0;

  const round = (ms) => Math.round(ms * 1000) / 1000;

  return {
    recordHit(ms) {
      cacheHits += 1;
      hitReadMs += ms;
    },
    recordMiss(ms) {
      cacheMisses += 1;
      missCompileMs += ms;
    },
    snapshot() {
      return {
        cacheHits,
        cacheMisses,
        hitReadMs: round(hitReadMs),
        missCompileMs: round(missCompileMs)
      };
    }
  };
}

module.exports = {
  COMPILE_CACHE_FORMAT_VERSION,
  hashText,
  resolveCompileCacheEnabled,
  readCacheEntry,
  writeCacheEntry,
  createCompileTelemetry
};
