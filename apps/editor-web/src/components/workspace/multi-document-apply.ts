/**
 * Compatibility re-export for the browser workspace.
 *
 * The `EditorChangeSet` contract is already MULTI-FILE (its `jsonPatches` may
 * carry a `filePath` per patch), but the editor previously applied only the
 * ACTIVE document and deferred the rest with a diagnostic. Entity creation
 * (ADR-057 §4.10) is an ATOMIC cross-manifest operation — a game facet in the
 * game manifest plus a UI facet in the channel manifest — so it produces one
 * ChangeSet touching TWO files at once.
 *
 * This module is the ATOMICITY PRE-CHECK for such a ChangeSet: it dry-runs EVERY
 * touched document (not just the active one) in memory and validates each against
 * its own JSON Schema BEFORE anything is written anywhere. If ANY document fails
 * (missing text, invalid patch, schema/semantic error), the whole result is
 * `ok: false` and the caller must apply NOTHING — no silent half-applied facet
 * split (ADR-057 §5 "молчаливая потеря запрещена").
 *
 * It is FRAMEWORK-AGNOSTIC and PURE (no React, no I/O): each file is dry-run with
 * the SAME engine gate the single-document path uses (`dryRunEditorChangeSet`),
 * fed a ChangeSet SLICE that contains only that one file's patches — so the
 * engine's own "touches N files outside the active document" refusal never fires
 * and the core 6.1 gate stays untouched. That makes it directly unit-testable.
 */
export { dryRunMultiDocumentChangeSet } from "@cubica/editor-engine";
export type {
  DryRunMultiDocumentChangeSetInput,
  MultiDocumentDryRunResult
} from "@cubica/editor-engine";
