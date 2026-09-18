import type {
  SessionAiDebriefSections,
  SessionAiDebriefUsage
} from "@cubica/contracts-ai";
import { createHash } from "node:crypto";
import { sessionAiDebriefSchema } from "@cubica/contracts-ai";
import type { GameManifestAiDebriefProfile } from "@cubica/contracts-manifest";
import Ajv2020Lib from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import addFormatsLib from "ajv-formats";
import { HttpError } from "../errors.ts";
import { canonicalizeJson } from "../content/canonicalJson.ts";
import type { SessionAiDebriefFailureCode } from "./sessionAiDebriefStore.ts";

/** Closed, provider-content-free parser diagnostics for manual proof failures. */
export const SESSION_AI_DEBRIEF_PROVIDER_FAILURE_STAGES = [
  "response_envelope",
  "model_identity",
  "choice_count",
  "finish_reason",
  "message_shape",
  "content_json",
  "content_schema",
  "usage_shape",
  "usage_total",
  "provider_refusal"
] as const;
export type SessionAiDebriefProviderFailureStage =
  typeof SESSION_AI_DEBRIEF_PROVIDER_FAILURE_STAGES[number];
const sessionAiDebriefProviderFailureStageSet: ReadonlySet<string> =
  new Set(SESSION_AI_DEBRIEF_PROVIDER_FAILURE_STAGES);

export function isSessionAiDebriefProviderFailureStage(
  value: unknown
): value is SessionAiDebriefProviderFailureStage {
  return typeof value === "string" && sessionAiDebriefProviderFailureStageSet.has(value);
}

export function sanitizeSessionAiDebriefProviderFailureStage(
  value: unknown
): SessionAiDebriefProviderFailureStage | undefined {
  return isSessionAiDebriefProviderFailureStage(value) ? value : undefined;
}

export const SESSION_AI_DEBRIEF_PROMPT_VERSION = "debrief-v1";
export const ZAI_SESSION_AI_DEBRIEF_TEST_PROMPT_VERSION = "debrief-zai-json-mode-v1";
export const MAX_SESSION_AI_DEBRIEF_INPUT_BYTES = 1024 * 1024;
export const MAX_SESSION_AI_DEBRIEF_OUTPUT_BYTES = 256 * 1024;
export const MAX_SESSION_AI_DEBRIEF_OUTPUT_TOKENS = 4_000;
const ZAI_GENERAL_API_BASE_URL = "https://api.z.ai/api/paas/v4";
const ZAI_CODING_PLAN_BASE_URL = "https://api.z.ai/api/coding/paas/v4";
export const ZAI_SESSION_AI_DEBRIEF_TEST_MODEL = "glm-5.3-flash";
const ZAI_APPROVED_SYNTHETIC_INPUT_SHA256 =
  "sha256:eab1429cb2d384ba46f2e8398c23a8c6b4cde199a7621276d4f81ed344b786c9";

const Ajv2020 = (Ajv2020Lib as any).default || Ajv2020Lib;
const addFormats = (addFormatsLib as any).default || addFormatsLib;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const sectionsSchema = {
  $schema: sessionAiDebriefSchema.$schema,
  $defs: sessionAiDebriefSchema.$defs,
  $ref: "#/$defs/SessionAiDebriefSections"
};
const validateSections = ajv.compile(sectionsSchema as object) as ValidateFunction<SessionAiDebriefSections>;

export interface SessionAiDebriefProviderInput {
  document: {
    format: "cubica.session-ai-debrief-input";
    schemaVersion: "1.0.0";
    methodology: GameManifestAiDebriefProfile;
    journal: unknown;
  };
  /** Exact canonical UTF-8 text stored, hashed and sent as the provider input. */
  canonicalInput: string;
}

export interface SessionAiDebriefProviderResult {
  sections: SessionAiDebriefSections;
  usage: SessionAiDebriefUsage;
}

export interface SessionAiDebriefProvider {
  readonly provider: "openai";
  readonly model: string;
  readonly promptVersion: string;
  assertReady(methodology: GameManifestAiDebriefProfile): void;
  generate(input: SessionAiDebriefProviderInput): Promise<SessionAiDebriefProviderResult>;
}

/** Synthetic-fixture proof seam; it cannot be injected into the persisted runtime service. */
export interface ZaiSessionAiDebriefTestProvider {
  readonly provider: "zai";
  readonly model: typeof ZAI_SESSION_AI_DEBRIEF_TEST_MODEL;
  readonly promptVersion: typeof ZAI_SESSION_AI_DEBRIEF_TEST_PROMPT_VERSION;
  assertReady(methodology: GameManifestAiDebriefProfile): void;
  generate(input: SessionAiDebriefProviderInput): Promise<SessionAiDebriefProviderResult>;
}

export class SessionAiDebriefProviderError extends HttpError {
  readonly failureCode: SessionAiDebriefFailureCode;
  readonly failureStage?: SessionAiDebriefProviderFailureStage;

  constructor(
    failureCode: SessionAiDebriefFailureCode,
    statusCode: number,
    message: string,
    failureStage?: SessionAiDebriefProviderFailureStage
  ) {
    super(statusCode, message, failureCode.toUpperCase());
    this.failureCode = failureCode;
    this.failureStage = sanitizeSessionAiDebriefProviderFailureStage(failureStage);
  }
}

export interface OpenAiSessionAiDebriefEnvironment {
  CUBICA_AI_DEBRIEF_ENABLED?: string;
  CUBICA_AI_DEBRIEF_MODEL?: string;
  CUBICA_AI_DEBRIEF_EVAL_APPROVED_MODEL?: string;
  CUBICA_AI_DEBRIEF_EVAL_APPROVED_PROMPT_VERSION?: string;
  CUBICA_AI_DEBRIEF_EVAL_APPROVED_METHODOLOGY_VERSION?: string;
  CUBICA_AI_DEBRIEF_EVAL_APPROVED_PROMPT_SHA256?: string;
  CUBICA_AI_DEBRIEF_EVAL_APPROVED_METHODOLOGY_SHA256?: string;
  CUBICA_AI_DEBRIEF_EVAL_APPROVED_CORPUS_SHA256?: string;
  CUBICA_AI_DEBRIEF_EVAL_APPROVAL_SHA256?: string;
  CUBICA_OPENAI_DATA_RETENTION?: string;
  OPENAI_API_KEY?: string;
  CUBICA_AI_DEBRIEF_TIMEOUT_MS?: string;
}

export interface ZaiSessionAiDebriefTestEnvironment {
  ZAI_API_KEY?: string;
  ZAI_BASE_URL?: string;
  CUBICA_AI_DEBRIEF_TIMEOUT_MS?: string;
}

export function createOpenAiSessionAiDebriefProvider(
  environment: OpenAiSessionAiDebriefEnvironment = process.env,
  fetchImplementation: typeof fetch = fetch
): SessionAiDebriefProvider {
  const readinessError = validateEnvironment(environment);
  const model = environment.CUBICA_AI_DEBRIEF_MODEL?.trim() ?? "unconfigured-model";
  const timeoutMs = parseTimeout(environment.CUBICA_AI_DEBRIEF_TIMEOUT_MS);
  const apiKey = environment.OPENAI_API_KEY?.trim() ?? "";

  return {
    provider: "openai",
    model,
    promptVersion: SESSION_AI_DEBRIEF_PROMPT_VERSION,
    assertReady(methodology) {
      if (readinessError !== undefined) {
        throw new HttpError(503, readinessError, "AI_DEBRIEF_NOT_CONFIGURED");
      }
      if (
        methodology.methodologyVersion !== environment.CUBICA_AI_DEBRIEF_EVAL_APPROVED_METHODOLOGY_VERSION ||
        createSessionAiDebriefMethodologySha256(methodology) !==
          environment.CUBICA_AI_DEBRIEF_EVAL_APPROVED_METHODOLOGY_SHA256 ||
        createSessionAiDebriefPromptSha256(methodology) !==
          environment.CUBICA_AI_DEBRIEF_EVAL_APPROVED_PROMPT_SHA256
      ) {
        throw new HttpError(
          503,
          "AI debrief generation requires eval approval for the exact published methodology and prompt.",
          "AI_DEBRIEF_NOT_CONFIGURED"
        );
      }
    },
    async generate(input) {
      this.assertReady(input.document.methodology);
      assertCanonicalProviderInput(input);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImplementation("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model,
            store: false,
            instructions: buildInstructions(input.document.methodology),
            input: input.canonicalInput,
            max_output_tokens: MAX_SESSION_AI_DEBRIEF_OUTPUT_TOKENS,
            truncation: "disabled",
            text: {
              format: {
                type: "json_schema",
                name: "cubica_session_ai_debrief",
                strict: true,
                schema: sectionsSchema
              }
            }
          }),
          signal: controller.signal
        });
        if (response.status === 429) {
          throw providerFailure("provider_rate_limited", 503, "The AI debrief provider rate limit was reached.");
        }
        if (response.status >= 400 && response.status < 500) {
          throw providerFailure("provider_rejected", 502, "The AI debrief provider rejected the request.");
        }
        if (!response.ok) {
          throw providerFailure("provider_unavailable", 503, "The AI debrief provider is unavailable.");
        }

        const bodyText = await readBoundedResponseText(response, MAX_SESSION_AI_DEBRIEF_OUTPUT_BYTES);
        let body: unknown;
        try {
          body = JSON.parse(bodyText);
        } catch {
          throw providerFailure(
            "provider_malformed",
            502,
            "The AI debrief provider returned malformed JSON.",
            "response_envelope"
          );
        }
        return parseProviderResponse(body, model);
      } catch (error) {
        if (error instanceof SessionAiDebriefProviderError) throw error;
        if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          throw providerFailure("provider_timeout", 504, "The AI debrief provider timed out.");
        }
        throw providerFailure("provider_unavailable", 503, "The AI debrief provider is unavailable.");
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

/**
 * Create the manually invoked GLM-5.3-Flash proof adapter.
 *
 * Z.AI documents JSON mode but not provider-enforced JSON Schema. The exact
 * schema is therefore included in the system instruction and still validated
 * locally before any result can pass this boundary.
 */
export function createZaiSessionAiDebriefTestProvider(
  environment: ZaiSessionAiDebriefTestEnvironment = process.env,
  fetchImplementation: typeof fetch = fetch
): ZaiSessionAiDebriefTestProvider {
  const apiKey = environment.ZAI_API_KEY?.trim() ?? "";
  const timeoutMs = parseTimeout(environment.CUBICA_AI_DEBRIEF_TIMEOUT_MS);
  const chatCompletionsUrl = resolveZaiTestChatCompletionsUrl(environment.ZAI_BASE_URL);

  return {
    provider: "zai",
    model: ZAI_SESSION_AI_DEBRIEF_TEST_MODEL,
    promptVersion: ZAI_SESSION_AI_DEBRIEF_TEST_PROMPT_VERSION,
    assertReady() {
      if (apiKey.length < 16) {
        throw new HttpError(
          503,
          "The synthetic Z.AI debrief proof requires a server-side credential.",
          "AI_DEBRIEF_TEST_NOT_CONFIGURED"
        );
      }
    },
    async generate(input) {
      this.assertReady(input.document.methodology);
      assertCanonicalProviderInput(input);
      if (sha256Text(input.canonicalInput) !== ZAI_APPROVED_SYNTHETIC_INPUT_SHA256) {
        throw new HttpError(
          400,
          "The Z.AI proof accepts only the approved fixed synthetic fixture.",
          "AI_DEBRIEF_TEST_INPUT_NOT_APPROVED"
        );
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImplementation(chatCompletionsUrl, {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: ZAI_SESSION_AI_DEBRIEF_TEST_MODEL,
            messages: [
              { role: "system", content: buildZaiTestInstructions(input.document.methodology) },
              { role: "user", content: input.canonicalInput }
            ],
            thinking: { type: "disabled" },
            response_format: { type: "json_object" },
            stream: false,
            temperature: 0,
            max_tokens: MAX_SESSION_AI_DEBRIEF_OUTPUT_TOKENS
          }),
          signal: controller.signal
        });
        if (response.status === 429) {
          throw providerFailure("provider_rate_limited", 503, "The AI debrief test provider rate limit was reached.");
        }
        if (response.status >= 400 && response.status < 500) {
          throw providerFailure("provider_rejected", 502, "The AI debrief test provider rejected the request.");
        }
        if (!response.ok) {
          throw providerFailure("provider_unavailable", 503, "The AI debrief test provider is unavailable.");
        }
        const bodyText = await readBoundedResponseText(response, MAX_SESSION_AI_DEBRIEF_OUTPUT_BYTES);
        let body: unknown;
        try {
          body = JSON.parse(bodyText);
        } catch {
          throw providerFailure(
            "provider_malformed",
            502,
            "The AI debrief test provider returned malformed JSON.",
            "response_envelope"
          );
        }
        return parseZaiProviderResponse(body);
      } catch (error) {
        if (error instanceof SessionAiDebriefProviderError) throw error;
        if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
          throw providerFailure("provider_timeout", 504, "The AI debrief test provider timed out.");
        }
        throw providerFailure("provider_unavailable", 503, "The AI debrief test provider is unavailable.");
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

function resolveZaiTestChatCompletionsUrl(configuredBaseUrl: string | undefined): string {
  const baseUrl = (configuredBaseUrl?.trim() || ZAI_GENERAL_API_BASE_URL).replace(/\/+$/u, "");
  if (baseUrl !== ZAI_GENERAL_API_BASE_URL && baseUrl !== ZAI_CODING_PLAN_BASE_URL) {
    throw new HttpError(
      503,
      "The synthetic Z.AI proof requires an approved official API base URL.",
      "AI_DEBRIEF_TEST_NOT_CONFIGURED"
    );
  }
  return `${baseUrl}/chat/completions`;
}

function validateEnvironment(environment: OpenAiSessionAiDebriefEnvironment): string | undefined {
  if (environment.CUBICA_AI_DEBRIEF_ENABLED !== "true") {
    return "AI debrief generation is disabled in this environment.";
  }
  const retention = environment.CUBICA_OPENAI_DATA_RETENTION;
  if (retention !== "modified-abuse-monitoring" && retention !== "zero-data-retention") {
    return "AI debrief generation requires an approved OpenAI data-retention profile.";
  }
  if ((environment.OPENAI_API_KEY?.trim().length ?? 0) < 16) {
    return "AI debrief generation requires a server-side OpenAI credential.";
  }
  const model = environment.CUBICA_AI_DEBRIEF_MODEL?.trim() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}-\d{4}-\d{2}-\d{2}$/u.test(model)) {
    return "AI debrief generation requires an exact dated OpenAI model snapshot.";
  }
  const approvedModel = environment.CUBICA_AI_DEBRIEF_EVAL_APPROVED_MODEL?.trim() ?? "";
  const approvedPromptVersion = environment.CUBICA_AI_DEBRIEF_EVAL_APPROVED_PROMPT_VERSION?.trim() ?? "";
  const approvedMethodologyVersion =
    environment.CUBICA_AI_DEBRIEF_EVAL_APPROVED_METHODOLOGY_VERSION?.trim() ?? "";
  const approvedPromptSha256 = environment.CUBICA_AI_DEBRIEF_EVAL_APPROVED_PROMPT_SHA256?.trim() ?? "";
  const approvedMethodologySha256 =
    environment.CUBICA_AI_DEBRIEF_EVAL_APPROVED_METHODOLOGY_SHA256?.trim() ?? "";
  const approvedCorpusSha256 = environment.CUBICA_AI_DEBRIEF_EVAL_APPROVED_CORPUS_SHA256?.trim() ?? "";
  const approvalSha256 = environment.CUBICA_AI_DEBRIEF_EVAL_APPROVAL_SHA256?.trim() ?? "";
  if (
    approvedModel !== model ||
    approvedPromptVersion !== SESSION_AI_DEBRIEF_PROMPT_VERSION ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(approvedMethodologyVersion) ||
    !/^sha256:[a-f0-9]{64}$/u.test(approvedPromptSha256) ||
    !/^sha256:[a-f0-9]{64}$/u.test(approvedMethodologySha256) ||
    !/^sha256:[a-f0-9]{64}$/u.test(approvedCorpusSha256) ||
    approvalSha256 !== createEvalApprovalSha256({
      model: approvedModel,
      promptVersion: approvedPromptVersion,
      methodologyVersion: approvedMethodologyVersion,
      promptSha256: approvedPromptSha256,
      methodologySha256: approvedMethodologySha256,
      corpusSha256: approvedCorpusSha256
    })
  ) {
    return "AI debrief generation requires eval approval bound to the exact model, prompt, methodology and corpus.";
  }
  return undefined;
}

export function createEvalApprovalSha256(input: {
  model: string;
  promptVersion: string;
  methodologyVersion: string;
  promptSha256: string;
  methodologySha256: string;
  corpusSha256: string;
}): string {
  const exact = [
    input.model,
    input.promptVersion,
    input.methodologyVersion,
    input.promptSha256,
    input.methodologySha256,
    input.corpusSha256
  ].join("\n");
  return sha256Text(exact);
}

export function createSessionAiDebriefMethodologySha256(profile: GameManifestAiDebriefProfile): string {
  return sha256Text(canonicalizeJson(profile));
}

export function createSessionAiDebriefPromptSha256(profile: GameManifestAiDebriefProfile): string {
  return sha256Text(buildInstructions(profile));
}

export function createZaiSessionAiDebriefTestPromptSha256(
  profile: GameManifestAiDebriefProfile
): string {
  return sha256Text(buildZaiTestInstructions(profile));
}

function sha256Text(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function parseTimeout(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 45_000;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1_000 || parsed > 120_000) return 45_000;
  return parsed;
}

function buildInstructions(profile: GameManifestAiDebriefProfile): string {
  return [
    "You produce a facilitator debrief only from the supplied confirmed public gameplay journal.",
    `Write all statements and questions in ${profile.locale}.`,
    "Facts must be directly supported by the cited event ids. Never invent an event id.",
    "Keep interpretations explicitly tentative and separate from facts.",
    "Do not create psychological profiles, diagnoses, personnel recommendations, or hidden participant ratings.",
    "Return only the strict structured result requested by the response schema.",
    `Purpose: ${profile.purpose}`,
    `Methodology instructions:\n${profile.analysisInstructions.map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
    `Facilitator question guide:\n${profile.facilitatorQuestionGuide.map((item, index) => `${index + 1}. ${item}`).join("\n")}`,
    `Limits: at most ${profile.limits.maxFacts} facts, ${profile.limits.maxInterpretations} interpretations, and ${profile.limits.maxQuestions} questions.`
  ].join("\n\n");
}

function buildZaiTestInstructions(profile: GameManifestAiDebriefProfile): string {
  return [
    buildInstructions(profile),
    "The provider offers JSON mode rather than strict schema enforcement. Return exactly one JSON object that passes this JSON Schema; Cubica will reject the complete response on any mismatch:",
    JSON.stringify(sectionsSchema)
  ].join("\n\n");
}

function parseProviderResponse(value: unknown, requestedModel: string): SessionAiDebriefProviderResult {
  const body = requireRecord(value, "response_envelope");
  if (body.status !== "completed") {
    throw providerFailure(
      "provider_malformed",
      502,
      "The AI debrief provider did not complete the response.",
      "response_envelope"
    );
  }
  if (body.model !== requestedModel) {
    throw providerFailure(
      "provider_malformed",
      502,
      "The AI debrief provider did not complete the response.",
      "model_identity"
    );
  }
  if (!Array.isArray(body.output)) {
    throw providerFailure(
      "provider_malformed",
      502,
      "The AI debrief provider did not complete the response.",
      "response_envelope"
    );
  }
  const outputTexts: string[] = [];
  for (const item of body.output) {
    const message = requireRecord(item, "message_shape");
    if (message.type !== "message" || !Array.isArray(message.content)) continue;
    for (const contentItem of message.content) {
      const content = requireRecord(contentItem, "message_shape");
      if (content.type === "refusal") {
        throw providerFailure(
          "provider_rejected",
          502,
          "The AI debrief provider refused the request.",
          "provider_refusal"
        );
      }
      if (content.type === "output_text" && typeof content.text === "string") {
        outputTexts.push(content.text);
      }
    }
  }
  if (outputTexts.length !== 1) {
    throw providerFailure(
      "provider_malformed",
      502,
      "The AI debrief provider returned an ambiguous result.",
      "response_envelope"
    );
  }
  let sections: unknown;
  try {
    sections = JSON.parse(outputTexts[0]);
  } catch {
    throw providerFailure(
      "provider_malformed",
      502,
      "The AI debrief provider returned malformed structured output.",
      "content_json"
    );
  }
  if (!validateSections(sections)) {
    throw providerFailure(
      "provider_schema_invalid",
      502,
      "The AI debrief provider output failed schema validation.",
      "content_schema"
    );
  }
  const usage = requireRecord(body.usage, "usage_shape");
  const parsedUsage: SessionAiDebriefUsage = {
    inputTokens: requireTokenCount(usage.input_tokens, "usage_shape"),
    outputTokens: requireTokenCount(usage.output_tokens, "usage_shape"),
    totalTokens: requireTokenCount(usage.total_tokens, "usage_shape")
  };
  if (parsedUsage.totalTokens !== parsedUsage.inputTokens + parsedUsage.outputTokens) {
    throw providerFailure(
      "provider_malformed",
      502,
      "The AI debrief provider returned inconsistent usage.",
      "usage_total"
    );
  }
  return { sections, usage: parsedUsage };
}

function parseZaiProviderResponse(value: unknown): SessionAiDebriefProviderResult {
  const body = requireRecord(value, "response_envelope");
  if (body.model !== ZAI_SESSION_AI_DEBRIEF_TEST_MODEL) {
    throw providerFailure(
      "provider_malformed",
      502,
      "The AI debrief test provider returned an invalid result.",
      "model_identity"
    );
  }
  if (!Array.isArray(body.choices) || body.choices.length !== 1) {
    throw providerFailure(
      "provider_malformed",
      502,
      "The AI debrief test provider returned an invalid result.",
      "choice_count"
    );
  }
  const choice = requireRecord(body.choices[0], "response_envelope");
  if (choice.finish_reason === "sensitive") {
    throw providerFailure(
      "provider_rejected",
      502,
      "The AI debrief test provider refused the request.",
      "finish_reason"
    );
  }
  if (choice.finish_reason !== "stop") {
    throw providerFailure(
      "provider_malformed",
      502,
      "The AI debrief test provider did not complete the response.",
      "finish_reason"
    );
  }
  const message = requireRecord(choice.message, "message_shape");
  if (message.role !== "assistant" || typeof message.content !== "string") {
    throw providerFailure(
      "provider_malformed",
      502,
      "The AI debrief test provider returned an invalid message.",
      "message_shape"
    );
  }
  let sections: unknown;
  try {
    sections = JSON.parse(message.content);
  } catch {
    throw providerFailure(
      "provider_malformed",
      502,
      "The AI debrief test provider returned malformed structured output.",
      "content_json"
    );
  }
  if (!validateSections(sections)) {
    throw providerFailure(
      "provider_schema_invalid",
      502,
      "The AI debrief test provider output failed schema validation.",
      "content_schema"
    );
  }
  const usage = requireRecord(body.usage, "usage_shape");
  const parsedUsage: SessionAiDebriefUsage = {
    inputTokens: requireTokenCount(usage.prompt_tokens, "usage_shape"),
    outputTokens: requireTokenCount(usage.completion_tokens, "usage_shape"),
    totalTokens: requireTokenCount(usage.total_tokens, "usage_shape")
  };
  if (parsedUsage.totalTokens !== parsedUsage.inputTokens + parsedUsage.outputTokens) {
    throw providerFailure(
      "provider_malformed",
      502,
      "The AI debrief test provider returned inconsistent usage.",
      "usage_total"
    );
  }
  return { sections, usage: parsedUsage };
}

function assertCanonicalProviderInput(input: SessionAiDebriefProviderInput): void {
  if (input.canonicalInput !== canonicalizeJson(input.document)) {
    throw new HttpError(
      500,
      "AI debrief provider input failed its canonical integrity check.",
      "AI_DEBRIEF_INPUT_INTEGRITY"
    );
  }
}

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  if (response.body === null) {
    throw providerFailure(
      "provider_malformed",
      502,
      "The AI debrief provider returned an empty response.",
      "response_envelope"
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel("provider response exceeded the debrief byte limit");
        throw providerFailure(
          "provider_malformed",
          502,
          "The AI debrief provider response exceeded its byte limit.",
          "response_envelope"
        );
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function requireRecord(
  value: unknown,
  failureStage: SessionAiDebriefProviderFailureStage = "response_envelope"
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw providerFailure(
      "provider_malformed",
      502,
      "The AI debrief provider returned an invalid envelope.",
      failureStage
    );
  }
  return value as Record<string, unknown>;
}

function requireTokenCount(
  value: unknown,
  failureStage: SessionAiDebriefProviderFailureStage = "usage_shape"
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw providerFailure(
      "provider_malformed",
      502,
      "The AI debrief provider returned invalid usage.",
      failureStage
    );
  }
  return value as number;
}

function providerFailure(
  code: SessionAiDebriefFailureCode,
  statusCode: number,
  message: string,
  failureStage?: SessionAiDebriefProviderFailureStage
) {
  return new SessionAiDebriefProviderError(code, statusCode, message, failureStage);
}
