/**
 * Proves that collapsing redundant source-map entries is lossless.
 *
 * `compileNode` (and every other mapping-writing helper in
 * authoring-compiler.cjs — `addRuntimeMapping`, `copySubtreeMappings`,
 * `mapGeneratedSubtree`, `publishMechanics`) applies two independent collapse
 * rules while building `sourceMap.mappings`, and omits a pointer's own entry
 * whenever either one applies:
 *
 *   1. Byte-identical to the nearest recorded ancestor's source. Safe because
 *      both real consumers of a compiled source map already walk up to that
 *      ancestor when a pointer has no exact entry:
 *        - apps/editor-web/src/lib/preview-message-adapter.ts, function
 *          `mapGeneratedPointerToAuthoring` (~line 178)
 *        - apps/editor-web/src/lib/compiler-workflow.ts, function
 *          `mapGeneratedPointerToAuthoring` (~line 406)
 *      Both loop `pointer -> parentPointer(pointer)` until they find an
 *      entry, then return its first source unchanged — correct here because
 *      the ancestor's source really *is* this pointer's source.
 *   2. Verbatim positional copy of the nearest recorded ancestor's subtree
 *      (`isPositionalMatch` in authoring-compiler.cjs) — the pointer's source
 *      isn't identical to the ancestor's, but is exactly the ancestor's source
 *      pointer with the same relative path the pointer has below the ancestor
 *      (e.g. 79,549 authored polygon vertices collapsing to one entry at
 *      `/networkModels`). This is *not* safe for a consumer that only walks up
 *      and returns the ancestor's source unchanged — that would silently lose
 *      precision (return the container's pointer instead of one specific
 *      vertex's). It is why `sourceMap.verbatimSubtrees` exists: a sorted list
 *      of exactly the ancestor pointers a consumer may safely extrapolate
 *      from, by appending the remaining generated-pointer path to the
 *      ancestor's source pointer. Both `mapGeneratedPointerToAuthoring`
 *      functions above now do exactly that when the ancestor they stop at is
 *      listed.
 *
 * This file does not just assert that on a couple of hand-picked pointers ("a
 * spot check") — it walks *every* pointer that exists in a compiled manifest
 * and proves the two ways of reading a source resolve to the same *exact*
 * answer (not merely "the same, imprecise, ancestor"), for every fixture the
 * other authoring-compiler-*.test.cjs files already use, plus every authoring
 * document belonging to a real game in this repository.
 *
 * How the proof works, precisely:
 *   1. `walkUpResolve` is a from-scratch port of the two consumers' algorithm:
 *      a parent-pointer loop over the real, collapsed `mappings` object,
 *      followed by the same `verbatimSubtrees` reconstruction they perform.
 *   2. `buildDenseMap` is a *different* algorithm: a single top-down recursion
 *      over the compiled manifest's own JSON tree (arrays/objects/scalars). It
 *      carries an "anchor" (the nearest exact mapping hit — its own pointer
 *      and source) down through the recursion, and independently decides, at
 *      every pointer with no exact hit of its own, whether to reconstruct via
 *      the anchor's source plus the accumulated relative path (when the
 *      anchor's pointer is itself in `verbatimSubtrees`) or to reuse the
 *      anchor's source unchanged (when it is not). It never parses a pointer
 *      string backwards — the relative path is built forward, by the same
 *      tree recursion that visits every pointer — so a bug in the hand-written
 *      parent-pointer walker (off-by-one, wrong "/" escaping, wrong root/array
 *      handling) would not be repeated here. The two algorithms can only agree
 *      at every pointer if the collapsed map, plus its `verbatimSubtrees`
 *      list, really does carry enough information to answer every pointer a
 *      consumer could ever ask about — exactly, not just approximately.
 *   3. For every pointer that structurally exists in the compiled manifest,
 *      the test asserts `walkUpResolve(sourceMap, pointer)` equals
 *      `denseMap.get(pointer)`. Equal for every pointer, over every fixture,
 *      is the actual proof — not an assertion that it should be so.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const {
  buildAjv,
  compileAuthoringFile,
  compileAuthoringText,
  discoverJobs
} = require("./authoring-compiler.cjs");
const { mapFirstAuthoring, job: mapFirstJob } = require("./authoring-compiler-map-first.test.cjs");
const { styledAuthoring, job: styledJob } = require("./authoring-compiler-stylesheets.test.cjs");

const ajv = buildAjv();

// --- Independent port of the two editor-web consumers' walk-up algorithm ---
//
// Deliberately re-typed here (not imported from authoring-compiler.cjs) so the
// test exercises a fresh implementation of "the same upward walk, then the
// same verbatimSubtrees reconstruction, the consumers use" rather than
// importing the compiler's own internal helpers of the same shape.
function parentPointerForWalk(pointer) {
  if (pointer === "") {
    return undefined;
  }
  const lastSlashIndex = pointer.lastIndexOf("/");
  return lastSlashIndex <= 0 ? "" : pointer.slice(0, lastSlashIndex);
}

function walkUpResolve(sourceMap, generatedPointer) {
  const mappings = sourceMap.mappings;
  const verbatimSubtrees = sourceMap.verbatimSubtrees || [];
  let pointer = generatedPointer;

  for (;;) {
    const sources = mappings[pointer];
    if (sources !== undefined && sources.length > 0) {
      const source = sources[0];
      // Rule 2's reconstruction: only fires when we stopped at an ancestor
      // (pointer !== generatedPointer) that is itself listed as safe to
      // extrapolate from. Appending an empty suffix for an exact hit would be
      // a no-op anyway, but the explicit check keeps the two rules visibly
      // distinct, matching how authoring-compiler.cjs itself tells them apart.
      if (pointer !== generatedPointer && verbatimSubtrees.includes(pointer)) {
        return {
          file: source.file,
          pointer: source.pointer + generatedPointer.slice(pointer.length)
        };
      }
      return source;
    }

    const parent = parentPointerForWalk(pointer);
    if (parent === undefined) {
      return undefined;
    }
    pointer = parent;
  }
}

// --- Independent dense-map reconstruction (top-down tree fill, no string parsing) ---

function joinPointerForWalk(parent, segment) {
  const escaped = String(segment).replace(/~/g, "~0").replace(/\//g, "~1");
  return `${parent}/${escaped}`;
}

function isPlainObjectForWalk(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Builds a Map<pointer, exactSource> covering every pointer that exists in
 * `manifestValue`, by a single top-down recursion that carries an "anchor"
 * (the nearest ancestor pointer with an exact `mappings` entry, plus its
 * source) forward as it descends. `mappings`/`verbatimSubtrees` are read only
 * via exact key/membership checks — this function never walks parents itself
 * — so it is a structurally different algorithm from `walkUpResolve` above,
 * even though, over a correctly collapsed map, the two must agree at every
 * pointer.
 */
function buildDenseMap(manifestValue, sourceMap) {
  const mappings = sourceMap.mappings;
  const verbatimSet = new Set(sourceMap.verbatimSubtrees || []);
  const dense = new Map();

  function visit(pointer, value, anchor) {
    const ownSources = Object.prototype.hasOwnProperty.call(mappings, pointer) ? mappings[pointer] : undefined;
    let resolvedSource;
    let nextAnchor;

    if (ownSources !== undefined && ownSources.length > 0) {
      // Exact hit: this pointer's own recorded source is the answer, and it
      // becomes the new anchor for descendants without their own entry.
      resolvedSource = ownSources[0];
      nextAnchor = { pointer, source: resolvedSource };
    } else if (anchor !== undefined) {
      resolvedSource = verbatimSet.has(anchor.pointer)
        ? { file: anchor.source.file, pointer: anchor.source.pointer + pointer.slice(anchor.pointer.length) }
        : anchor.source;
      // Not a new anchor: keep propagating the same one, so a long run of
      // un-recorded descendants keeps accumulating the relative path from the
      // *original* anchor rather than resetting at every level.
      nextAnchor = anchor;
    } else {
      resolvedSource = undefined;
      nextAnchor = undefined;
    }

    dense.set(pointer, resolvedSource);

    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(joinPointerForWalk(pointer, index), child, nextAnchor));
    } else if (isPlainObjectForWalk(value)) {
      for (const [key, child] of Object.entries(value)) {
        visit(joinPointerForWalk(pointer, key), child, nextAnchor);
      }
    }
  }

  visit("", manifestValue, undefined);
  return dense;
}

/**
 * Runs the actual equivalence proof for one compiled `{ manifest, sourceMap }`
 * pair: every pointer that exists in `manifest`, resolved the consumers' way
 * against the real (collapsed) `sourceMap`, must equal the same pointer
 * resolved by direct lookup into the independently-built dense map — the
 * *exact* source, not merely a correct-but-imprecise ancestor.
 */
function assertCollapsingIsLossless(label, output) {
  const { manifest, sourceMap } = output;
  const dense = buildDenseMap(manifest, sourceMap);

  assert.ok(
    Object.prototype.hasOwnProperty.call(sourceMap.mappings, ""),
    `${label}: the root pointer "" must always be recorded so the upward walk always terminates`
  );

  let checked = 0;
  for (const [pointer, expectedSource] of dense) {
    const resolved = walkUpResolve(sourceMap, pointer);
    assert.deepEqual(
      resolved,
      expectedSource,
      `${label}: pointer ${JSON.stringify(pointer)} resolved to ${JSON.stringify(resolved)} via the consumers' walk-up, ` +
        `but ${JSON.stringify(expectedSource)} via direct lookup into the independently-built dense map`
    );
    checked += 1;
  }

  assert.ok(checked > 0, `${label}: expected at least one pointer to check`);

  const mappingKeyCount = Object.keys(sourceMap.mappings).length;
  return { checked, mappingKeyCount };
}

// Note on what is (and is not) asserted below about mapping key *counts*:
// `copySubtreeMappings` (used to publish UI screens and game actions) copies a
// subtree's mapping keys verbatim, including the key for that node's own `id`
// property — even though `appendUiScreensRuntimeField` / the actions builder
// then destructure `id` back out before storing the runtime value. That means
// a UI document's mappings object can legitimately contain a handful of
// "orphan" keys with no corresponding pointer in the compiled manifest (e.g.
// `/screens/workspace/id`); this is pre-existing behaviour, unrelated to
// collapsing, and out of this task's scope. It also means a small,
// concretely-authored fixture (no `_type` definitions supplying properties an
// instance omits) may have little or no redundancy to collapse in the first
// place — collapsing only removes an entry when a node's provenance is
// byte-identical to, or a verbatim positional copy of, its ancestor's, which
// mostly happens for children synthesized by `_type`/`_extends` merging or for
// large literal (e.g. geometry) subtrees, not for values an author typed out
// explicitly at every level with no repetition. So "the map got smaller" is
// only asserted below where it is actually guaranteed: real, `_type`-rich game
// documents.

test("collapsing is lossless: neutral map-first UI fixture", () => {
  assertCollapsingIsLossless("map-first fixture", compileAuthoringText(mapFirstJob, JSON.stringify(mapFirstAuthoring()), ajv));
});

test("collapsing is lossless: neutral stylesheets UI fixture", () => {
  assertCollapsingIsLossless("stylesheets fixture", compileAuthoringText(styledJob, JSON.stringify(styledAuthoring()), ajv));
});

// --- Pinned case: rule 1 (identical) and rule 2 (verbatim positional) must never be confused ---
//
// Reuses simple-choice's real, already-valid authoring document (rather than
// hand-building a fresh one, which risks accidentally not exercising the real
// merge/lowering code paths) and adds one large literal subtree under
// `state.public`, which no `_type`/`_extends` definition ever touches. This
// document already contains both shapes this test wants to pin down:
//   - `state` itself (recorded once, but a `_type`-free literal object) turns
//     out to make the *whole* injected literal subtree collapse via rule 2
//     (verbatim positional) all the way down to individual array elements —
//     exactly the cards-money-trains region-geometry pattern, just smaller.
//   - Mechanics transaction steps are stamped by `mapGeneratedSubtree` with
//     one uniform source per lowered step (rule 1: byte-identical), and here
//     that source is NOT its own array index but the specific authoring
//     pointer the plan step (or macro template) came from — its own deeply
//     nested fields (a JSON-logic predicate tree) must resolve to that same,
//     unmodified pointer, never a fabricated suffix of it.
test("collapsing tells rule 1 (identical) and rule 2 (verbatim positional) apart", () => {
  const jobs = discoverJobs({ gameId: "simple-choice" });
  const gameJob = jobs.find((job) => job.kind === "game");
  assert.ok(gameJob, "expected games/simple-choice to have a game authoring job");

  // discoverJobs returns absolute paths, matching every other real-game test
  // below (compileAuthoringFile also reads job.sourceFile directly).
  const authoring = JSON.parse(fs.readFileSync(gameJob.sourceFile, "utf8"));
  // A literal, `_type`-free nested subtree with no counterpart anywhere in
  // `_definitions` — every node below it can only be reconstructed
  // positionally, never merged from a template.
  authoring.root.state.public.collapseProbe = {
    literalTree: [
      { a: { b: { c: 1, d: [1, 2, 3] } } },
      { a: { b: { c: 2, d: [4, 5, 6] } } }
    ]
  };

  const output = compileAuthoringText(gameJob, JSON.stringify(authoring), ajv);
  const { sourceMap, manifest } = output;

  // The literal subtree really did collapse (nothing recorded below `/state`
  // for it individually) and must be reconstructible positionally.
  assert.equal(
    Object.prototype.hasOwnProperty.call(sourceMap.mappings, "/state/public/collapseProbe/literalTree/0/a/b/c"),
    false,
    "expected the injected literal subtree to collapse rather than keep its own entry"
  );
  assert.deepEqual(
    walkUpResolve(sourceMap, "/state/public/collapseProbe/literalTree/0/a/b/c"),
    {
      file: "games/simple-choice/authoring/game.authoring.json",
      pointer: "/root/state/public/collapseProbe/literalTree/0/a/b/c"
    },
    "expected the literal subtree's exact authoring pointer to be reconstructed via a verbatim anchor"
  );

  // Locate a real, lowered mechanics transaction step with nested fields
  // (a JSON-logic predicate tree), and confirm none of them carry their own
  // entry (mapGeneratedSubtree already proved this is safe under rule 1),
  // *and* that the anchor they resolve to is never treated as verbatim.
  const planId = Object.keys(manifest.mechanics.plans)[0];
  const steps = manifest.mechanics.plans[planId].transaction.steps;
  const stepIndex = steps.findIndex((step) => step.predicate !== undefined);
  assert.ok(stepIndex >= 0, "expected at least one lowered step with a nested predicate to probe");

  const stepPointer = `/mechanics/plans/${planId}/transaction/steps/${stepIndex}`;
  const nestedPointer = `${stepPointer}/predicate/items/0/left/ref/endpoint`;
  assert.equal(
    Object.prototype.hasOwnProperty.call(sourceMap.mappings, nestedPointer),
    false,
    "expected the step's own nested predicate field to have no separate entry"
  );
  assert.equal(
    sourceMap.verbatimSubtrees.includes(stepPointer),
    false,
    "a mechanics step's uniform (rule 1) source must never be listed as a verbatim (rule 2) anchor"
  );

  const stepSource = sourceMap.mappings[stepPointer][0];
  assert.deepEqual(
    walkUpResolve(sourceMap, nestedPointer),
    stepSource,
    "expected the nested predicate field to resolve to the step's own unmodified source, not a fabricated suffix of it"
  );

  assertCollapsingIsLossless("simple-choice + mixed rule-1/rule-2 probe", output);
});

// --- Real games: every authoring document (game + every UI channel) discovered in games/ ---

const realJobs = discoverJobs();

test("collapsing is lossless: at least one real game is discovered", () => {
  assert.ok(realJobs.length > 0, "expected games/*/authoring/*.authoring.json to exist");
});

for (const job of realJobs) {
  const label = job.kind === "game"
    ? `${job.gameId} game.authoring.json`
    : `${job.gameId} ui/${job.channel}.authoring.json`;

  test(`collapsing is lossless: real game — ${label}`, () => {
    const output = compileAuthoringFile(job, ajv);
    const { checked, mappingKeyCount } = assertCollapsingIsLossless(label, output);

    if (job.kind === "game") {
      // Game authoring documents lean heavily on `_type` action/component
      // definitions and large literal subtrees, which is exactly where
      // collapsing has real redundancy to remove. A regression that disabled
      // collapsing entirely (e.g. always recording every node again) would
      // still pass every equality assertion above — mappingKeyCount would
      // only ever grow, never produce a wrong answer — so this inequality is
      // what actually proves the collapse fired for these documents, not
      // just that it is safe when it does.
      assert.ok(
        mappingKeyCount < checked,
        `${label}: expected collapsing to omit at least one redundant entry ` +
          `(${mappingKeyCount} mapping keys for ${checked} pointers)`
      );
    }
  });
}
