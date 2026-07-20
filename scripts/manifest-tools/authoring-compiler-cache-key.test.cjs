/**
 * Regression test for transitive Mechanics inputs in the compile-cache key.
 *
 * Generated manifests contain exact module locks derived from two trusted code
 * corpora: the shared execution kernel and the operation execution corpus. A
 * warm cache must therefore miss when either corpus changes, even when the
 * authoring document, schemas and compiler source stay unchanged. This neutral
 * unit test exercises only the pure key builder; it never edits real runtime,
 * authoring or cache files.
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const { computeCacheKeyPrefix } = require("./authoring-compiler.cjs");

const BASE_INPUTS = Object.freeze({
  formatVersion: 1,
  compilerHash: "compiler-fingerprint",
  schemasHash: "schemas-fingerprint",
  sharedKernelHash: "shared-kernel-fingerprint-a",
  executionCorpusHash: "execution-corpus-fingerprint-a"
});

test("compile-cache prefix depends independently on both Mechanics corpus fingerprints", () => {
  const baseline = computeCacheKeyPrefix(BASE_INPUTS);
  const repeated = computeCacheKeyPrefix({ ...BASE_INPUTS });
  const changedSharedKernel = computeCacheKeyPrefix({
    ...BASE_INPUTS,
    sharedKernelHash: "shared-kernel-fingerprint-b"
  });
  const changedExecutionCorpus = computeCacheKeyPrefix({
    ...BASE_INPUTS,
    executionCorpusHash: "execution-corpus-fingerprint-b"
  });

  assert.equal(repeated, baseline, "identical compile inputs must keep a stable cache key");
  assert.notEqual(
    changedSharedKernel,
    baseline,
    "changing the shared execution kernel must invalidate the compile cache"
  );
  assert.notEqual(
    changedExecutionCorpus,
    baseline,
    "changing the operation execution corpus must invalidate the compile cache"
  );
});
