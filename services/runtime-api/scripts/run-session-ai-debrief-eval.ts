import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020Lib from "ajv/dist/2020.js";
import addFormatsLib from "ajv-formats";
import {
  sessionAiDebriefSchema,
  type SessionAiDebriefArtifact,
  type SessionAiDebriefSections
} from "@cubica/contracts-ai";
import type { GameManifestAiDebriefProfile } from "@cubica/contracts-manifest";
import type { PortablePublicGameplayJournal } from "@cubica/contracts-session";
import { validateGameManifestAiDebriefProfile } from "../src/modules/content/manifestValidation.ts";
import { assertSessionAiDebriefSectionsSemantics } from "../src/modules/ai/sessionAiDebriefEvaluation.ts";
import {
  createSessionAiDebriefMethodologySha256,
  createSessionAiDebriefPromptSha256
} from "../src/modules/ai/sessionAiDebriefProvider.ts";

const Ajv2020 = (Ajv2020Lib as any).default || Ajv2020Lib;
const addFormats = (addFormatsLib as any).default || addFormatsLib;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../tests/fixtures/session-ai-debrief");
const maxFixtureBytes = 512 * 1024;
const maxScenarioCount = 10;
const allowedFixtureFiles = new Set([
  "cmt-public-journal.json",
  "neutral-public-journal.json",
  "null-journal.json",
  "methodology.json",
  "scenarios.json",
  "eval-input.schema.json"
]);

const validateJournal = ajv.compile(
  JSON.parse(await readFile(path.resolve(fixtureRoot, "../../../../../docs/architecture/schemas/public-gameplay-journal.schema.json"), "utf8"))
);
const validateArtifact = ajv.compile(sessionAiDebriefSchema as object);
const validateEvalInput = ajv.compile(
  await readFixtureJson<Record<string, unknown>>("eval-input.schema.json")
);

type ExpectedResult = {
  journalSchema: "pass" | "fail";
  responseSchema: "pass" | "fail";
  semantics: "pass" | "fail" | "not-run";
  quality: "pass" | "fail";
};

type EvalInput = {
  readonly format: "cubica.session-ai-debrief-eval-input";
  readonly schemaVersion: "1.0.0";
  readonly methodology: string;
  readonly qualityRubric: {
    readonly id: string;
    readonly description: string;
    readonly prohibitedPatterns: string[];
    readonly humanReviewRequired: true;
    readonly limitation: string;
  };
  readonly scenarios: Array<{
    readonly id: string;
    readonly journal: string;
    readonly expected: ExpectedResult;
    readonly sections: unknown;
  }>;
};

/** Stable UTF-16 code-unit ordering is independent of the host locale. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Cannot canonicalize undefined");
  return serialized;
}

function compareCodeUnits(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function sha256(value: unknown): string {
  // Missing candidate fields are hashed as JSON null so malformed scenarios
  // still receive deterministic per-scenario results.
  return `sha256:${createHash("sha256").update(canonicalJson(value === undefined ? null : value), "utf8").digest("hex")}`;
}

async function readFixtureJson<T>(name: string): Promise<T> {
  if (!allowedFixtureFiles.has(name) || name.includes("..") || name.includes(path.sep)) {
    throw new Error(`Unexpected fixture path: ${name}`);
  }
  const filePath = path.resolve(fixtureRoot, name);
  if (path.dirname(filePath) !== fixtureRoot) throw new Error(`Fixture traversal rejected: ${name}`);
  const metadata = await stat(filePath);
  if (!metadata.isFile()) throw new Error(`Fixture is not a regular file: ${name}`);
  if (metadata.size > maxFixtureBytes) {
    throw new Error(`Fixture exceeds ${maxFixtureBytes} bytes: ${name}`);
  }
  const contents = await readFile(filePath, "utf8");
  return JSON.parse(contents) as T;
}

function buildArtifact(
  scenarioIndex: number,
  journal: PortablePublicGameplayJournal,
  sections: unknown,
  profile: GameManifestAiDebriefProfile
): SessionAiDebriefArtifact {
  return {
    format: "cubica.session-ai-debrief",
    schemaVersion: "1.0.0",
    artifactId: `00000000-0000-4000-8000-${String(scenarioIndex + 1).padStart(12, "0")}`,
    requestId: `00000000-0000-4000-9000-${String(scenarioIndex + 1).padStart(12, "0")}`,
    sessionId: journal.sessionId,
    gameId: journal.gameId,
    status: "draft",
    createdAt: "2026-09-04T12:00:00.000Z",
    provenance: {
      throughEventSequence: journal.throughEventSequence,
      journalSha256: sha256(journal),
      methodologyVersion: profile.methodologyVersion,
      promptVersion: "debrief-v1",
      provider: "openai",
      model: "offline-eval-2026-09-04",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    },
    sections: sections as SessionAiDebriefSections,
    outputSha256: sha256(sections)
  };
}

function runQualityRubric(
  sections: unknown,
  rubric: EvalInput["qualityRubric"]
): { status: "pass" | "fail"; matchedPatterns: string[]; humanReviewRequired: true } {
  const text = (JSON.stringify(sections) ?? String(sections)).toLocaleLowerCase("ru-RU");
  const matchedPatterns = rubric.prohibitedPatterns.filter((pattern) =>
    text.includes(pattern.toLocaleLowerCase("ru-RU"))
  );
  return {
    status: matchedPatterns.length === 0 ? "pass" : "fail",
    matchedPatterns,
    humanReviewRequired: true
  };
}

export async function runSessionAiDebriefEval(): Promise<{
  format: "cubica.session-ai-debrief-eval-result";
  schemaVersion: "1.0.0";
  offline: true;
  humanReviewRequired: true;
  passed: boolean;
  approvalInputs: {
    methodologyVersion: string;
    methodologySha256: string;
    promptSha256: string;
    corpusSha256: string;
  };
  scenarios: unknown[];
}> {
  const inputRaw = await readFixtureJson<unknown>("scenarios.json");
  if (!validateEvalInput(inputRaw)) {
    throw new Error(`Eval input failed its eval-only schema: ${JSON.stringify(validateEvalInput.errors ?? [])}`);
  }
  const input = inputRaw as EvalInput;
  if (input.scenarios.length === 0 || input.scenarios.length > maxScenarioCount) {
    throw new Error(`Scenario count must be between 1 and ${maxScenarioCount}`);
  }
  const scenarioIds = input.scenarios.map((scenario) => scenario.id);
  const expectedScenarioIds = new Set([
    "cmt-grounded-valid",
    "neutral-grounded-valid",
    "unknown-evidence-fails-closed",
    "shape-mixing-fails-schema",
    "required-evidence-absent-fails-schema",
    "methodology-limit-overflow",
    "forbidden-personnel-assessment-quality-fails",
    "null-journal-fails-per-scenario",
    "missing-sections-fails-per-scenario"
  ]);
  if (new Set(scenarioIds).size !== scenarioIds.length) {
    throw new Error("Eval input scenario ids must be non-empty and unique");
  }
  const missingIds = [...expectedScenarioIds].filter((id) => !scenarioIds.includes(id));
  const unexpectedIds = scenarioIds.filter((id) => !expectedScenarioIds.has(id));
  if (missingIds.length > 0 || unexpectedIds.length > 0 || scenarioIds.length !== expectedScenarioIds.size) {
    throw new Error(`Eval input scenario coverage mismatch: missing=${missingIds.join(",")}; unexpected=${unexpectedIds.join(",")}`);
  }
  const profileRaw = await readFixtureJson<unknown>(input.methodology);
  if (!validateGameManifestAiDebriefProfile(profileRaw)) {
    throw new Error("Methodology fixture failed the canonical manifest profile schema");
  }
  const profile = profileRaw as GameManifestAiDebriefProfile;
  const journals = new Map<string, unknown>();
  const results: unknown[] = [];

  for (const [index, scenario] of input.scenarios.entries()) {
    const journal = journals.get(scenario.journal) ?? await readFixtureJson<unknown>(scenario.journal);
    journals.set(scenario.journal, journal);
    const journalValid = validateJournal(journal);
    const artifactJournal = journalValid
      ? journal as PortablePublicGameplayJournal
      : {
          format: "cubica.public-gameplay-journal",
          schemaVersion: "1.0.0",
          sessionId: `invalid-journal-${index + 1}`,
          gameId: "neutral-game",
          lifecycle: "active",
          sessionCreatedAt: "2026-09-04T10:00:00.000Z",
          throughEventSequence: 0,
          entries: []
        } satisfies PortablePublicGameplayJournal;
    const artifact = buildArtifact(index, artifactJournal, scenario.sections, profile);
    const responseValid = validateArtifact(artifact);
    let semantics: ExpectedResult["semantics"] = "not-run";
    let semanticError: string | undefined;
    if (journalValid && responseValid) {
      try {
        // AJV has established the canonical journal shape on this branch;
        // narrow only after that successful validation before calling the
        // shared semantic checker.
        const validatedJournal = journal as PortablePublicGameplayJournal;
        assertSessionAiDebriefSectionsSemantics(artifact.sections, validatedJournal, profile);
        semantics = "pass";
      } catch (error) {
        semantics = "fail";
        semanticError = error instanceof Error ? error.message : String(error);
      }
    }
    const rubric = runQualityRubric(scenario.sections, input.qualityRubric);
    const observed: ExpectedResult = {
      journalSchema: journalValid ? "pass" : "fail",
      responseSchema: responseValid ? "pass" : "fail",
      semantics,
      quality: rubric.status
    };
    const passed = canonicalJson(observed) === canonicalJson(scenario.expected);
    results.push({
      id: scenario.id,
      expected: scenario.expected,
      observed,
      passed,
      provenance: { methodologyVersion: artifact.provenance.methodologyVersion },
      ...(semanticError === undefined ? {} : { semanticError }),
      journalSchemaErrors: journalValid ? [] : (validateJournal.errors ?? []).slice(0, 3),
      schemaErrors: responseValid ? [] : (validateArtifact.errors ?? []).slice(0, 3),
      qualityRubric: {
        id: input.qualityRubric.id,
        matchedPatterns: rubric.matchedPatterns,
        humanReviewRequired: true,
        limitation: input.qualityRubric.limitation
      }
    });
  }

  const sortedJournals = Object.fromEntries(
    [...journals.entries()].sort(([left], [right]) => compareCodeUnits(left, right))
  );
  const corpusSha256 = sha256({
    format: input.format,
    schemaVersion: input.schemaVersion,
    methodology: profile,
    qualityRubric: input.qualityRubric,
    scenarios: input.scenarios,
    journals: sortedJournals
  });

  return {
    format: "cubica.session-ai-debrief-eval-result",
    schemaVersion: "1.0.0",
    offline: true,
    humanReviewRequired: true,
    passed: results.every((result) => (result as { passed: boolean }).passed),
    approvalInputs: {
      methodologyVersion: profile.methodologyVersion,
      methodologySha256: createSessionAiDebriefMethodologySha256(profile),
      promptSha256: createSessionAiDebriefPromptSha256(profile),
      corpusSha256
    },
    scenarios: results
  };
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runSessionAiDebriefEval();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
