import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GameManifestAiDebriefProfile } from "@cubica/contracts-manifest";
import {
  validatePortablePublicGameplayJournal,
  type PortablePublicGameplayJournal
} from "@cubica/contracts-session";
import { canonicalizeJson } from "../src/modules/content/canonicalJson.ts";
import { validateGameManifestAiDebriefProfile } from "../src/modules/content/manifestValidation.ts";
import { assertSessionAiDebriefSectionsSemantics } from "../src/modules/ai/sessionAiDebriefEvaluation.ts";
import {
  createSessionAiDebriefMethodologySha256,
  createZaiSessionAiDebriefTestPromptSha256,
  createZaiSessionAiDebriefTestProvider,
  sanitizeSessionAiDebriefProviderFailureStage,
  SessionAiDebriefProviderError,
  ZAI_SESSION_AI_DEBRIEF_TEST_MODEL
} from "../src/modules/ai/sessionAiDebriefProvider.ts";
import { runSessionAiDebriefEval } from "./run-session-ai-debrief-eval.ts";

const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../tests/fixtures/session-ai-debrief"
);
const MAX_FIXTURE_BYTES = 512 * 1024;
const EXPECTED_METHODOLOGY_SHA256 =
  "sha256:d733296b2b7612b7fa0496bd916c3ca107d37a6257e9e6879f45123594fe65ce";
const EXPECTED_JOURNAL_SHA256 =
  "sha256:1e8ca3b15ef2644c58203d81d4a8161be8c1f55ec717b66ad14bce6f923cc0d8";

async function readFixedFixture(name: "cmt-public-journal.json" | "methodology.json"): Promise<unknown> {
  const filePath = path.join(fixtureRoot, name);
  const metadata = await stat(filePath);
  if (!metadata.isFile() || metadata.size > MAX_FIXTURE_BYTES) {
    throw new Error(`Synthetic proof fixture is missing or exceeds ${MAX_FIXTURE_BYTES} bytes: ${name}`);
  }
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

function sha256Text(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

async function main(): Promise<void> {
  const offlineEval = await runSessionAiDebriefEval();
  if (!offlineEval.passed) throw new Error("Offline debrief eval must pass before the live synthetic proof.");

  const methodologyRaw = await readFixedFixture("methodology.json");
  if (sha256Text(canonicalizeJson(methodologyRaw)) !== EXPECTED_METHODOLOGY_SHA256) {
    throw new Error("The synthetic proof methodology changed and requires explicit re-approval.");
  }
  if (!validateGameManifestAiDebriefProfile(methodologyRaw)) {
    throw new Error("The fixed synthetic methodology failed the canonical manifest schema.");
  }
  const methodology = methodologyRaw as GameManifestAiDebriefProfile;

  const journalRaw = await readFixedFixture("cmt-public-journal.json");
  if (sha256Text(canonicalizeJson(journalRaw)) !== EXPECTED_JOURNAL_SHA256) {
    throw new Error("The synthetic proof journal changed and requires explicit re-approval.");
  }
  if (!validatePortablePublicGameplayJournal(journalRaw)) {
    throw new Error("The fixed synthetic journal failed the canonical public journal schema.");
  }
  const journal = journalRaw as PortablePublicGameplayJournal;
  if (
    journal.sessionId !== "cmt-eval-session" ||
    journal.gameId !== "cards-money-trains" ||
    journal.lifecycle !== "archived"
  ) {
    throw new Error("The live proof accepts only the fixed archived synthetic CMT fixture.");
  }

  const document = {
    format: "cubica.session-ai-debrief-input",
    schemaVersion: "1.0.0",
    methodology,
    journal
  } as const;
  const canonicalInput = canonicalizeJson(document);
  const provider = createZaiSessionAiDebriefTestProvider();
  provider.assertReady(methodology);
  const generated = await provider.generate({ document, canonicalInput });
  assertSessionAiDebriefSectionsSemantics(generated.sections, journal, methodology);

  process.stdout.write(`${JSON.stringify({
    format: "cubica.session-ai-debrief-live-proof",
    schemaVersion: "1.0.0",
    passed: true,
    dataScope: "checked-in-synthetic-cmt-fixture-only",
    humanReviewRequired: true,
    provider: provider.provider,
    model: provider.model,
    promptVersion: provider.promptVersion,
    methodologyVersion: methodology.methodologyVersion,
    methodologySha256: createSessionAiDebriefMethodologySha256(methodology),
    promptSha256: createZaiSessionAiDebriefTestPromptSha256(methodology),
    corpusSha256: offlineEval.approvalInputs.corpusSha256,
    inputSha256: sha256Text(canonicalInput),
    outputSha256: sha256Text(canonicalizeJson(generated.sections)),
    counts: {
      facts: generated.sections.facts.length,
      interpretations: generated.sections.interpretations.length,
      facilitatorQuestions: generated.sections.facilitatorQuestions.length
    },
    usage: generated.usage
  }, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  const providerError = error instanceof SessionAiDebriefProviderError ? error : undefined;
  const failureStage = sanitizeSessionAiDebriefProviderFailureStage(providerError?.failureStage);
  process.stderr.write(`${JSON.stringify({
    format: "cubica.session-ai-debrief-live-proof",
    schemaVersion: "1.0.0",
    passed: false,
    dataScope: "checked-in-synthetic-cmt-fixture-only",
    provider: "zai",
    model: ZAI_SESSION_AI_DEBRIEF_TEST_MODEL,
    failureCode: providerError?.failureCode ?? "proof_failed",
    failureStage
  })}\n`);
  process.exitCode = 1;
}
