/**
 * Returned-intent interpreter (ADR-057 §4.4, §5; editor-preview-first-ux §6;
 * design-spec §2.2). This is the CORE, framework-agnostic, network-free half of
 * text-mode editing. Phase 4.2 adds the text-mode UI and the LLM agent call; this
 * module (Phase 4.1) only turns a returned text into a `ReturnedIntentResult`.
 *
 * The prompt projection is a HAND-ROLLED, YAML-like text with Russian labels; it
 * is deliberately NOT round-tripped by a generic YAML parser (ADR-049 §11). So
 * the deterministic fast path is a line-by-line ALIGNMENT of the author's
 * returned text against the ORIGINAL projection, guided by the projection's own
 * per-line source map (`FacetSourceMap`, built in `entity-projection.ts`). The
 * author's returned text is a COMMAND to interpret, never data to apply
 * mechanically — so anything the interpreter cannot account for deterministically
 * is deferred whole to the agent (ADR-057 §4.4). Silent dropping of any changed
 * fragment is forbidden (ADR-057 §5): every fragment lands in one of three report
 * buckets (`applied` / `recognized-no-change` / `unrecognized`).
 *
 * Processing order (design-spec §2.2, verbatim):
 *   1. prompt-stale: compare captured vs fresh source hashes; diverged → stop.
 *   2. fast path: if every divergence is only the VALUE of a known key (or one
 *      unambiguous collection-item deletion) → build a deterministic ChangeSet.
 *   3. otherwise → agent path (`changeSet: null`); the caller forwards context.
 *   4. deletion semantics: a removed collection element means "delete"; a removed
 *      scalar property defaults to "keep" (`recognized-no-change`). Conservative.
 *   5. line report: every changed/added/removed fragment is bucketed; an empty
 *      report over a non-empty diff is an interpreter error (thrown here).
 *   6. the result is NOT applied here; Phase 4.2 runs it through the shared
 *      risk → dry-run → validation → undo-journal pipeline.
 */
import { jsonValuesEqual } from "./shared.ts";
import type {
  EditorChangeSet,
  EditorChangeSetJsonPatch,
  FacetSourceLine,
  InterpretationLineReport,
  JsonPatchOperation,
  JsonValue,
  ReturnedIntentInput,
  ReturnedIntentResult
} from "./types.ts";

/** Options that supply the interpreter with its live environment. */
export interface InterpretReturnedIntentOptions {
  /**
   * Fresh source hashes by file path, recomputed from the LIVE authoring
   * documents at interpretation time. The prompt-stale check (ADR-049 §10)
   * compares them against `input.sourceHashes` (captured when the projection was
   * built and carried back with the returned intent). Omitted → the check is
   * skipped, because the caller has no fresh hashes to compare against.
   *
   * NOTE (design-spec §2.2): `ReturnedIntentInput` is kept verbatim (5 fields),
   * so the fresh hashes arrive here as a separate, optional argument rather than
   * by mutating the round-tripped input contract.
   */
  readonly currentSourceHashes?: Record<string, string>;
}

/**
 * Interprets an author's returned prompt text into a deterministic ChangeSet
 * (fast path) or an agent signal, plus a per-line report. Pure and network-free.
 */
export function interpretReturnedIntent(
  input: ReturnedIntentInput,
  options: InterpretReturnedIntentOptions = {}
): ReturnedIntentResult {
  // Step 1 — prompt-stale. A stale projection must never be auto-applied; the
  // caller re-projects (or re-asks) before interpreting again.
  if (isPromptStale(input.sourceHashes, options.currentSourceHashes)) {
    return { changeSet: null, report: [], path: "agent", stale: true };
  }

  // No-intent guard. An empty/whitespace return carries nothing to interpret.
  // Reading a cleared editor as "delete everything" is exactly the mechanical
  // mass-application the ADR forbids, so treat it as a deterministic no-op.
  if (input.returnedText.trim() === "") {
    return { changeSet: null, report: [], path: "deterministic" };
  }

  const projLines = splitProjectionLines(input.projectionYaml);
  const retLines = splitProjectionLines(input.returnedText);
  const map = input.facetSourceMap.lines;

  const diff = diffLines(projLines, retLines);
  const changed = diff.some((op) => op.kind !== "equal");
  if (!changed) {
    // Identical text (only formatting-neutral round-trip): nothing to do.
    return { changeSet: null, report: [], path: "deterministic" };
  }

  const analysis = analyzeDiff({ diff, projLines, retLines, map });
  const report = buildReport(analysis, diff, projLines, retLines);

  // Step 5 — silent-ignore guard: a non-empty diff must produce a non-empty
  // report. Reaching here with an empty report is an interpreter bug.
  if (report.length === 0) {
    throw new Error("interpretReturnedIntent produced an empty report for a non-empty diff (silent-ignore guard).");
  }

  if (analysis.path === "agent") {
    return { changeSet: null, report, path: "agent" };
  }

  const changeSet = buildChangeSet(analysis, input.entityId);
  return { changeSet, report, path: "deterministic" };
}

// --------------------------------------------------------------------------
// Step 1 — prompt-stale
// --------------------------------------------------------------------------

/**
 * True when any file's captured hash diverges from its fresh hash. Files present
 * in the captured set but missing from the fresh set count as diverged (the
 * source disappeared). When no fresh hashes are supplied the check is skipped.
 */
function isPromptStale(
  captured: Record<string, string>,
  fresh: Record<string, string> | undefined
): boolean {
  if (fresh === undefined) {
    return false;
  }
  for (const [filePath, capturedHash] of Object.entries(captured)) {
    if (fresh[filePath] !== capturedHash) {
      return true;
    }
  }
  return false;
}

// --------------------------------------------------------------------------
// Line diff (LCS)
// --------------------------------------------------------------------------

type DiffOp =
  | { readonly kind: "equal"; readonly pi: number; readonly ri: number }
  | { readonly kind: "delete"; readonly pi: number }
  | { readonly kind: "insert"; readonly ri: number };

/**
 * Splits projection/returned text into lines, dropping the single trailing empty
 * line produced by the projection's terminating `\n` so the line count matches
 * the source map exactly.
 */
function splitProjectionLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/**
 * Classic longest-common-subsequence line diff. Equal lines are matched; the
 * remainder becomes deletes (present only in the projection) and inserts
 * (present only in the returned text). Ties prefer `delete` before `insert`, so
 * a single changed line surfaces as an adjacent delete→insert pair. Projection
 * sizes are tiny (tens of lines), so the O(n·m) table is fine.
 */
function diffLines(a: readonly string[], b: readonly string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: "equal", pi: i, ri: j });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: "delete", pi: i });
      i += 1;
    } else {
      ops.push({ kind: "insert", ri: j });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ kind: "delete", pi: i });
    i += 1;
  }
  while (j < m) {
    ops.push({ kind: "insert", ri: j });
    j += 1;
  }
  return ops;
}

/** A maximal run of consecutive non-equal ops, between two `equal` boundaries. */
interface DiffRun {
  readonly deletes: number[];
  readonly inserts: number[];
}

function buildRuns(diff: readonly DiffOp[]): DiffRun[] {
  const runs: DiffRun[] = [];
  let current: DiffRun | null = null;
  for (const op of diff) {
    if (op.kind === "equal") {
      current = null;
      continue;
    }
    if (current === null) {
      current = { deletes: [], inserts: [] };
      runs.push(current);
    }
    if (op.kind === "delete") {
      current.deletes.push(op.pi);
    } else {
      current.inserts.push(op.ri);
    }
  }
  return runs;
}

// --------------------------------------------------------------------------
// Diff analysis
// --------------------------------------------------------------------------

/** A recognized value edit of one known scalar key. */
interface ValueEdit {
  readonly pi: number;
  readonly ri: number;
  readonly filePath: string;
  readonly pointer: string;
  readonly value: JsonValue;
  /** `false` when the parsed new value equals the old one (cosmetic edit only). */
  readonly changed: boolean;
}

/** Outcome of classifying the whole diff (before path/bucket assignment). */
interface DiffAnalysis {
  readonly path: "deterministic" | "agent";
  readonly valueEdits: readonly ValueEdit[];
  /** Deleted scalar properties → default keep (`recognized-no-change`). */
  readonly scalarDeletes: readonly number[];
  /** Deleted structural lines (facet/section/header/branch) → unrecognized. */
  readonly structuralDeletes: readonly number[];
  /** Broken array blocks: a partly-edited collection item → unrecognized. */
  readonly brokenDeletes: readonly number[];
  /** Cleanly, fully deleted collection item blocks (each carries its remove target). */
  readonly blocks: readonly CollectionBlock[];
  /** `true` only when exactly one clean block deletion is the sole real change. */
  readonly blockApplies: boolean;
  /** Failed value edits (prefix matched but value could not be typed) → unrecognized. */
  readonly badEdits: readonly { readonly pi: number; readonly ri: number }[];
  /** Inserted lines that map to nothing → unrecognized. */
  readonly inserts: readonly number[];
  /** Inserts consumed as the "after" side of a value edit / bad edit. */
  readonly consumedInserts: ReadonlySet<number>;
  /** Deleted lines skipped in the report because a block start already covers them. */
  readonly skippedDeletes: ReadonlySet<number>;
}

/** A fully-deleted collection item block plus its authoring remove target. */
interface CollectionBlock {
  readonly start: number;
  readonly span: readonly number[];
  readonly filePath: string;
  readonly pointer: string;
}

/** True when a source line renders an editable scalar value. */
function isEditableLine(line: FacetSourceLine | undefined): line is FacetSourceLine & { valueStart: number } {
  return line !== undefined && line.valueStart !== undefined;
}

function analyzeDiff(context: {
  readonly diff: readonly DiffOp[];
  readonly projLines: readonly string[];
  readonly retLines: readonly string[];
  readonly map: readonly FacetSourceLine[];
}): DiffAnalysis {
  const { diff, projLines, retLines, map } = context;
  const runs = buildRuns(diff);

  const valueEdits: ValueEdit[] = [];
  const badEdits: { pi: number; ri: number }[] = [];
  const consumedInserts = new Set<number>();
  const editedDeletes = new Set<number>();

  // Pair value edits WITHIN each run: an editable deleted line whose returned
  // counterpart keeps the exact same key/label prefix and only changes the value
  // text. Pairing runs first so an edited array scalar is a value edit, not a
  // deletion; unpaired array lines fall through to block detection below.
  for (const run of runs) {
    for (const pi of run.deletes) {
      const line = map[pi];
      if (!isEditableLine(line)) {
        continue;
      }
      const ri = run.inserts.find((candidate) => !consumedInserts.has(candidate) && prefixMatches(line, projLines[pi], retLines[candidate]));
      if (ri === undefined) {
        continue;
      }
      consumedInserts.add(ri);
      editedDeletes.add(pi);

      const origText = projLines[pi].slice(line.valueStart);
      const nextText = retLines[ri].slice(line.valueStart);
      const parsed = parseEditedScalar(origText, nextText);
      if (!parsed.ok) {
        badEdits.push({ pi, ri });
        continue;
      }
      const origParsed = parseProjectedScalar(origText);
      const changed = !(origParsed.ok && jsonValuesEqual(origParsed.value, parsed.value));
      valueEdits.push({ pi, ri, filePath: line.filePath ?? "", pointer: line.pointer ?? "", value: parsed.value, changed });
    }
  }

  // Remaining (unpaired) deletes: detect fully-deleted collection-item blocks,
  // then classify the rest as scalar-property deletions or structural deletions.
  const leftoverDeletes = runs.flatMap((run) => run.deletes).filter((pi) => !editedDeletes.has(pi));
  const leftoverSet = new Set(leftoverDeletes);
  const blocks: CollectionBlock[] = [];
  const brokenDeletes: number[] = [];
  const scalarDeletes: number[] = [];
  const structuralDeletes: number[] = [];
  const skippedDeletes = new Set<number>();
  const processed = new Set<number>();

  for (const pi of [...leftoverDeletes].sort((left, right) => left - right)) {
    if (processed.has(pi)) {
      continue;
    }
    const line = map[pi];
    if (line !== undefined && (line.kind === "array-scalar" || line.kind === "array-branch")) {
      const span = arrayItemSpan(map, pi);
      const clean = span.every((k) => leftoverSet.has(k));
      for (const k of span) {
        processed.add(k);
      }
      if (clean) {
        blocks.push({ start: pi, span, filePath: line.filePath ?? "", pointer: line.pointer ?? "" });
        for (const k of span) {
          if (k !== pi) {
            skippedDeletes.add(k);
          }
        }
      } else {
        // A collection item whose lines were only partly deleted/edited: too
        // ambiguous for a deterministic remove — hand the whole thing to the agent.
        for (const k of span) {
          if (leftoverSet.has(k)) {
            brokenDeletes.push(k);
            if (k !== pi) {
              skippedDeletes.add(k);
            }
          }
        }
      }
      continue;
    }

    processed.add(pi);
    if (line !== undefined && line.kind === "field-scalar") {
      scalarDeletes.push(pi);
    } else {
      structuralDeletes.push(pi);
    }
  }

  const inserts = runs.flatMap((run) => run.inserts).filter((ri) => !consumedInserts.has(ri));
  const realValueEdits = valueEdits.filter((edit) => edit.changed);

  // A single clean block deletion may be applied deterministically only when it
  // is the SOLE real change (cosmetic value edits and scalar-property deletions
  // are "no change" and may coexist). Anything else keeps it out of the fast path.
  const blockApplies =
    blocks.length === 1 &&
    realValueEdits.length === 0 &&
    inserts.length === 0 &&
    structuralDeletes.length === 0 &&
    badEdits.length === 0 &&
    brokenDeletes.length === 0;

  const blocksUnrecognized = blocks.length > 0 && !blockApplies;
  const unrecognizedExists =
    inserts.length > 0 || structuralDeletes.length > 0 || badEdits.length > 0 || brokenDeletes.length > 0 || blocksUnrecognized;

  return {
    path: unrecognizedExists ? "agent" : "deterministic",
    valueEdits,
    scalarDeletes,
    structuralDeletes,
    brokenDeletes,
    blocks,
    blockApplies,
    badEdits,
    inserts,
    consumedInserts,
    skippedDeletes
  };
}

/**
 * The inclusive line indices of the collection item that STARTS at `pi`: `pi`
 * itself plus every following projection line more deeply indented than it
 * (its nested fields/sub-items). Used to decide whether an item was deleted in
 * full (clean) or only in part (broken).
 */
function arrayItemSpan(map: readonly FacetSourceLine[], pi: number): number[] {
  const indent = map[pi]?.indent ?? 0;
  const span = [pi];
  for (let k = pi + 1; k < map.length; k += 1) {
    if ((map[k]?.indent ?? -1) > indent) {
      span.push(k);
    } else {
      break;
    }
  }
  return span;
}

/** True when a returned line keeps the exact key/label prefix of the projection line. */
function prefixMatches(line: FacetSourceLine & { valueStart: number }, projLine: string, retLine: string): boolean {
  if (retLine.length < line.valueStart) {
    return false;
  }
  return projLine.slice(0, line.valueStart) === retLine.slice(0, line.valueStart);
}

// --------------------------------------------------------------------------
// Scalar value parsing (reverse of `formatYamlScalar`)
// --------------------------------------------------------------------------

type ParseResult = { readonly ok: true; readonly value: JsonValue } | { readonly ok: false };

/**
 * Parses a projected scalar's text back into a JSON value. The projection formats
 * strings with `JSON.stringify` (double-quoted) and other scalars via `String`,
 * so `JSON.parse` inverts every value the projection itself emits.
 */
function parseProjectedScalar(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed === "") {
    return { ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) as JsonValue };
  } catch {
    return { ok: false };
  }
}

/**
 * Parses the AUTHOR-edited value text of a scalar line.
 *
 * If the text parses as JSON (a quoted string, number, boolean, or null) that
 * value is used. If it does not parse but the ORIGINAL value was a string, the
 * raw trimmed text is kept as a string — a non-technical author routinely edits
 * inside a quoted value and may drop the quotes, and a string field must stay a
 * string. Any other unparsable text would silently change the value's type, so
 * it is rejected (`ok:false`) and deferred to the agent.
 */
function parseEditedScalar(origText: string, nextText: string): ParseResult {
  const parsed = parseProjectedScalar(nextText);
  if (parsed.ok) {
    return parsed;
  }
  if (origText.trim().startsWith("\"")) {
    return { ok: true, value: nextText.trim() };
  }
  return { ok: false };
}

// --------------------------------------------------------------------------
// Report + ChangeSet assembly
// --------------------------------------------------------------------------

/**
 * Builds the per-line report by walking the diff in order and emitting exactly
 * one bucketed fragment per accountable change. On the agent path every
 * would-be-applied fragment is downgraded to `recognized-no-change` (the
 * interpreter applies nothing; the agent handles the whole return), so `applied`
 * appears only on the deterministic path — keeping the invariant
 * `applied ⇔ a ChangeSet op exists`.
 */
function buildReport(
  analysis: DiffAnalysis,
  diff: readonly DiffOp[],
  projLines: readonly string[],
  retLines: readonly string[]
): InterpretationLineReport[] {
  const deterministic = analysis.path === "deterministic";

  const editByDelete = new Map<number, ValueEdit>();
  for (const edit of analysis.valueEdits) {
    editByDelete.set(edit.pi, edit);
  }
  const badByDelete = new Map<number, number>();
  for (const bad of analysis.badEdits) {
    badByDelete.set(bad.pi, bad.ri);
  }
  const blockByStart = new Map<number, CollectionBlock>();
  for (const block of analysis.blocks) {
    blockByStart.set(block.start, block);
  }
  const scalarDeleteSet = new Set(analysis.scalarDeletes);
  const structuralDeleteSet = new Set(analysis.structuralDeletes);
  const brokenDeleteSet = new Set(analysis.brokenDeletes);

  const report: InterpretationLineReport[] = [];
  for (const op of diff) {
    if (op.kind === "insert") {
      if (analysis.consumedInserts.has(op.ri)) {
        continue;
      }
      report.push({ fragment: retLines[op.ri].trim(), bucket: "unrecognized" });
      continue;
    }
    if (op.kind !== "delete") {
      continue;
    }
    const pi = op.pi;

    const edit = editByDelete.get(pi);
    if (edit !== undefined) {
      if (deterministic && edit.changed) {
        report.push({ fragment: retLines[edit.ri].trim(), bucket: "applied", targetPointer: edit.pointer });
      } else {
        report.push({ fragment: retLines[edit.ri].trim(), bucket: "recognized-no-change" });
      }
      continue;
    }

    const badRi = badByDelete.get(pi);
    if (badRi !== undefined) {
      report.push({ fragment: retLines[badRi].trim(), bucket: "unrecognized" });
      continue;
    }

    const block = blockByStart.get(pi);
    if (block !== undefined) {
      if (deterministic && analysis.blockApplies) {
        report.push({ fragment: projLines[pi].trim(), bucket: "applied", targetPointer: block.pointer });
      } else {
        report.push({ fragment: projLines[pi].trim(), bucket: "unrecognized" });
      }
      continue;
    }

    if (analysis.skippedDeletes.has(pi)) {
      continue; // A descendant line already covered by its block's report entry.
    }
    if (scalarDeleteSet.has(pi)) {
      report.push({ fragment: projLines[pi].trim(), bucket: "recognized-no-change" });
      continue;
    }
    if (structuralDeleteSet.has(pi) || brokenDeleteSet.has(pi)) {
      report.push({ fragment: projLines[pi].trim(), bucket: "unrecognized" });
      continue;
    }
    // Unreachable in practice, but never silently drop a fragment (ADR-057 §5).
    report.push({ fragment: projLines[pi].trim(), bucket: "unrecognized" });
  }

  return report;
}

/**
 * Assembles the deterministic ChangeSet from the analysis. Contains either value
 * replaces (one per changed value edit) OR a single collection-item remove, never
 * both — the analysis only marks `blockApplies` when no value edit coexists — so
 * op ordering never needs to reason about array-index shifting. Returns `null`
 * when there are no operations (for example only scalar-property deletions, which
 * default to "keep" and produce no op).
 */
function buildChangeSet(analysis: DiffAnalysis, entityId: string): EditorChangeSet | null {
  const opsByFile = new Map<string, JsonPatchOperation[]>();
  const pushOp = (filePath: string, operation: JsonPatchOperation): void => {
    const existing = opsByFile.get(filePath);
    if (existing === undefined) {
      opsByFile.set(filePath, [operation]);
    } else {
      existing.push(operation);
    }
  };

  let replaceCount = 0;
  for (const edit of analysis.valueEdits) {
    if (edit.changed) {
      pushOp(edit.filePath, { op: "replace", path: edit.pointer, value: edit.value });
      replaceCount += 1;
    }
  }

  let removeCount = 0;
  if (analysis.blockApplies && analysis.blocks.length === 1) {
    const block = analysis.blocks[0];
    pushOp(block.filePath, { op: "remove", path: block.pointer });
    removeCount += 1;
  }

  if (opsByFile.size === 0) {
    return null;
  }

  const jsonPatches: EditorChangeSetJsonPatch[] = [...opsByFile.entries()].map(([filePath, operations]) => ({ filePath, operations }));
  const summaryParts: string[] = [];
  if (replaceCount > 0) {
    summaryParts.push(`${replaceCount} field value(s)`);
  }
  if (removeCount > 0) {
    summaryParts.push(`${removeCount} collection item(s) removed`);
  }
  return {
    id: `returned-intent:${entityId}`,
    summary: `Interpreted text edit for ${entityId}: ${summaryParts.join(", ")}`,
    jsonPatches
  };
}
