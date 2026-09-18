# Session AI debrief replay fixtures

These are bounded, deterministic eval inputs. `cmt-public-journal.json` is a
synthetic **CMT-shaped** public journal, not a recording of a played session.
Its event types, summaries, and data fields are copied from the public journal
assertions in:

- `games/cards-money-trains/tools/cargo-settlement-lifecycle.test.mjs`
  (`cargo.loaded` and `cargo.delivered`);
- `games/cards-money-trains/game.manifest.json` (the generated public event
  declarations and journal endpoint);
- `services/runtime-api/tests/postgres-session-store.test.ts` (the
  `${sessionId}:${sequence}` event-id convention).

The CMT object ids (`cargo-source-row-005`, `technical-wagon-white-1`,
`technical-locomotive-purple-1`, `terminal-1`, and `terminal-9`) are the exact
ids used by the CMT cargo lifecycle fixture. The journal envelope and dates are
eval-only values. No claim is made that these events were recorded together in
production.

`methodology.json` is an exact copy of `content.aiDebrief` from
`games/cards-money-trains/game.manifest.json`; the focused eval test fails on
methodology drift. `neutral-public-journal.json` supplies a non-game-specific journal for the
neutral cases. `null-journal.json` and the missing `sections` field in
`scenarios.json` are malformed-input cases; the runner reports them per
scenario rather than aborting the matrix. `eval-input.schema.json` is an
eval-only schema and is not a public product contract. The runner creates the
schema-backed artifact envelope and computes deterministic hashes from each
input.

The forbidden-assessment case uses a deterministic pre-screen checklist. It is
an intentionally conservative quality gate, not proof of semantic safety;
facilitator review remains required.
