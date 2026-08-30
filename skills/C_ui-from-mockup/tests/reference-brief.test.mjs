/**
 * Contract tests for the information a static reference image cannot carry.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { validateBrief } from "../scripts/validate-reference-brief.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const TMP = path.join(ROOT, ".tmp/ui-reference-brief-tests");

function hash(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function validBrief(referencePath) {
  return {
    $schema: "https://cubica.local/schemas/ui-reference-brief.v1.json",
    schemaVersion: "1.0",
    scope: "screen",
    mode: "pixel-parity",
    target: { surface: "test" },
    references: [{ id: "desktop", path: referencePath, sha256: hash(referencePath), state: "default" }],
    states: [{ id: "default", source: "observed", description: "Default" }],
    interactions: [],
    responsiveRules: [{ regionId: "main", behavior: "stack", source: "inferred" }],
    semantics: [],
    uncertainties: [{
      id: "layout",
      question: "Order?",
      impact: "implementation",
      resolution: "agent",
      decision: "Preserve reading order",
    }],
    acceptance: [{ id: "visual", kind: "visual", description: "Matches reference" }],
  };
}

before(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
});

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test("accepts a complete screen brief with verified reference hash", async () => {
  const referencePath = path.join(TMP, "reference.png");
  fs.writeFileSync(referencePath, "fixture");
  const briefPath = path.join(TMP, "brief.json");
  fs.writeFileSync(briefPath, JSON.stringify(validBrief(referencePath)));
  assert.equal((await validateBrief(briefPath)).valid, true);
});

test("rejects architecture decisions assigned to the agent", async () => {
  const referencePath = path.join(TMP, "architecture.png");
  fs.writeFileSync(referencePath, "fixture");
  const brief = validBrief(referencePath);
  brief.uncertainties[0].impact = "architecture";
  const briefPath = path.join(TMP, "architecture-brief.json");
  fs.writeFileSync(briefPath, JSON.stringify(brief));
  const result = await validateBrief(briefPath);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /может решить только PM/);
});

test("patch scope requires reusable inventory, profile, and scan manifest", async () => {
  const referencePath = path.join(TMP, "patch.png");
  fs.writeFileSync(referencePath, "fixture");
  const brief = validBrief(referencePath);
  brief.scope = "patch";
  brief.responsiveRules = [];
  const briefPath = path.join(TMP, "patch-brief.json");
  fs.writeFileSync(briefPath, JSON.stringify(brief));
  const result = await validateBrief(briefPath);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /reuse/);
});
