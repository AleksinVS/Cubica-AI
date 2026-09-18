import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canonicalJson, runSessionAiDebriefEval } from "../scripts/run-session-ai-debrief-eval.ts";

test("eval methodology stays byte-for-byte equivalent to the published CMT profile", async () => {
  const published = JSON.parse(await readFile(
    new URL("../../../games/cards-money-trains/game.manifest.json", import.meta.url),
    "utf8"
  )) as { content?: { aiDebrief?: unknown } };
  const fixture = JSON.parse(await readFile(
    new URL("./fixtures/session-ai-debrief/methodology.json", import.meta.url),
    "utf8"
  ));
  assert.deepEqual(fixture, published.content?.aiDebrief);
});

test("offline session AI debrief replay/eval matrix is deterministic and fail-closed", async () => {
  const first = await runSessionAiDebriefEval();
  const second = await runSessionAiDebriefEval();
  assert.equal(first.passed, true, JSON.stringify(first, null, 2));
  assert.equal(first.offline, true);
  assert.equal(first.humanReviewRequired, true);
  assert.deepEqual(first, second);
  assert.equal(first.approvalInputs.methodologyVersion, "cmt-final-reflection-v1");
  assert.match(first.approvalInputs.methodologySha256, /^sha256:[a-f0-9]{64}$/u);
  assert.match(first.approvalInputs.promptSha256, /^sha256:[a-f0-9]{64}$/u);
  assert.match(first.approvalInputs.corpusSha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(first.scenarios.length, 9);
  assert.deepEqual(
    first.scenarios.map((scenario) => (scenario as { id: string }).id),
    [
      "cmt-grounded-valid",
      "neutral-grounded-valid",
      "unknown-evidence-fails-closed",
      "shape-mixing-fails-schema",
      "required-evidence-absent-fails-schema",
      "methodology-limit-overflow",
      "forbidden-personnel-assessment-quality-fails",
      "null-journal-fails-per-scenario",
      "missing-sections-fails-per-scenario"
    ]
  );
  assert.equal(new Set(first.scenarios.map((scenario) => (scenario as { id: string }).id)).size, 9);
  assert.equal(
    (first.scenarios[0] as { provenance: { methodologyVersion: string } }).provenance.methodologyVersion,
    "cmt-final-reflection-v1"
  );
  assert.deepEqual(
    canonicalJson({ "я": 1, "a": 2, "😀": 3 }),
    '{"a":2,"я":1,"😀":3}'
  );

  const byId = new Map(first.scenarios.map((scenario) => [
    (scenario as { id: string }).id,
    scenario as { observed: Record<string, string>; qualityRubric: { humanReviewRequired: true } }
  ]));
  assert.equal(byId.get("unknown-evidence-fails-closed")?.observed.semantics, "fail");
  assert.equal(byId.get("shape-mixing-fails-schema")?.observed.responseSchema, "fail");
  assert.equal(byId.get("required-evidence-absent-fails-schema")?.observed.responseSchema, "fail");
  assert.equal(byId.get("methodology-limit-overflow")?.observed.semantics, "fail");
  assert.equal(byId.get("forbidden-personnel-assessment-quality-fails")?.observed.quality, "fail");
  assert.equal(byId.get("forbidden-personnel-assessment-quality-fails")?.qualityRubric.humanReviewRequired, true);
  assert.equal(byId.get("null-journal-fails-per-scenario")?.observed.journalSchema, "fail");
  assert.equal(byId.get("null-journal-fails-per-scenario")?.observed.semantics, "not-run");
  assert.equal(byId.get("missing-sections-fails-per-scenario")?.observed.responseSchema, "fail");
});
