/**
 * Neutral contract tests for canonical replay fingerprints.
 *
 * The fixture intentionally has no game identifiers: it proves that the
 * platform ignores only approved wall-clock audit paths and detects every
 * other gameplay difference.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeReplayState,
  createCanonicalReplayFingerprint
} from "../src/modules/runtime/replayFingerprint.ts";

const state = (auditAt: string, lastUpdatedAt: string) => ({
  public: {
    log: [{ kind: "move", at: auditAt, nested: { at: "gameplay-time" } }],
    result: { score: 7 }
  },
  runtime: {
    lastUpdatedAt,
    nested: { lastUpdatedAt: "gameplay-clock" }
  },
  other: { at: "meaningful", lastUpdatedAt: "also-meaningful" }
});

test("canonical replay fingerprint ignores only approved wall-clock audit paths", () => {
  const first = state("2026-07-12T10:00:00.000Z", "2026-07-12T10:00:01.000Z");
  const second = state("2026-07-12T11:00:00.000Z", "2026-07-12T11:00:01.000Z");

  assert.equal(
    createCanonicalReplayFingerprint(first),
    createCanonicalReplayFingerprint(second)
  );
  assert.equal(first.public.log[0].at, "2026-07-12T10:00:00.000Z", "canonicalization mutated the source state");
});

test("canonical replay fingerprint is stable across object insertion order", () => {
  const fingerprint = createCanonicalReplayFingerprint({ public: { result: { a: 1, b: 2 } } });
  assert.equal(fingerprint, createCanonicalReplayFingerprint({ public: { result: { b: 2, a: 1 } } }));
  assert.match(fingerprint, /^cubica-replay-state-v1:sha256:[a-f0-9]{64}$/u);
});

test("same-named fields outside approved audit paths remain gameplay-significant", () => {
  const baseline = state("2026-07-12T10:00:00.000Z", "2026-07-12T10:00:01.000Z");
  const changed = structuredClone(baseline);
  changed.public.log[0].nested.at = "changed-gameplay-time";

  assert.notEqual(
    createCanonicalReplayFingerprint(baseline),
    createCanonicalReplayFingerprint(changed)
  );
  assert.deepEqual(
    canonicalizeReplayState(baseline),
    canonicalizeReplayState(structuredClone(baseline))
  );
});

test("array order and hidden future state remain fingerprint-significant", () => {
  const baseline = {
    public: { queue: ["a", "b"] },
    secret: { decks: { events: ["card-1", "card-2"] }, random: { state: [1, 2, 3, 4] } }
  };
  assert.notEqual(
    createCanonicalReplayFingerprint(baseline),
    createCanonicalReplayFingerprint({ ...baseline, public: { queue: ["b", "a"] } })
  );
  assert.notEqual(
    createCanonicalReplayFingerprint(baseline),
    createCanonicalReplayFingerprint({
      ...baseline,
      secret: { ...baseline.secret, decks: { events: ["card-2", "card-1"] } }
    })
  );
});

test("non-JSON replay values are rejected instead of being silently normalized", () => {
  assert.throws(() => createCanonicalReplayFingerprint({ score: Number.NaN }), /finite JSON numbers/);
  assert.throws(() => createCanonicalReplayFingerprint({ score: 1n }), /non-JSON value/);
  assert.throws(() => createCanonicalReplayFingerprint({ score: undefined }), /non-JSON value/);
  assert.throws(() => createCanonicalReplayFingerprint({ when: new Date() }), /non-JSON value/);
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.throws(() => createCanonicalReplayFingerprint(circular), /circular references/);
});
