/**
 * Non-production post-response product-context shadow integration.
 *
 * This module is server-only by construction: it receives a locally attested
 * Portal bearer, extracts only the latest user string and assistant text that
 * the local backend itself emitted, and writes solely through the isolated
 * shadow coordinator. Errors are intentionally returned as content-free
 * outcomes to the caller and never affect the primary AG-UI response.
 */
import { createHash } from "node:crypto";
import {
  HttpModelGateway,
  PostgresConversationStore,
  ShadowCoordinator,
  safeShadowDatabaseUrl,
  validateProductKnowledgeContract,
  type ShadowAuthorizationReceipt,
  type ShadowAuthorizationAuthority,
  type ShadowCoordinatorResult
} from "@cubica/product-context";
import { Pool } from "pg";

import {
  readVerifiedLocalProductContextIdentity,
  type ProductContextForwardedIdentity
} from "@/lib/product-context-shadow-forwarding";

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/u;
const MAX_PORTAL_RESPONSE_BYTES = 64 * 1024;
const PORTAL_AUTHORIZATION_TIMEOUT_MS = 5_000;

export type ProductContextShadowReceipt = ShadowAuthorizationReceipt;

interface ShadowConfig {
  readonly portalUrl: string;
  readonly databaseUrl: string;
  readonly modelGatewayUrl: string;
  readonly modelGatewayToken: string;
  readonly retentionMs: number;
  readonly modelTimeoutMs: number;
  readonly maxModelRequestBytes: number;
  readonly maxModelResponseBytes: number;
}

export interface ProductContextShadowTurn {
  readonly threadId: string;
  readonly runId: string;
  readonly userMessageId: string;
  readonly assistantMessageId: string;
  readonly userText: string;
  readonly assistantText: string;
}

export interface ProductContextShadowJob {
  readonly identity: ProductContextForwardedIdentity;
  readonly candidate: ProductContextShadowTurn;
  readonly config: ShadowConfig;
}

export interface ProductContextShadowDependencies {
  readonly authorize?: (job: ProductContextShadowJob) => Promise<unknown>;
  readonly createCoordinator?: (job: ProductContextShadowJob, authority: ShadowAuthorizationAuthority) => Pick<ShadowCoordinator, "run">;
}

export function buildProductContextShadowJob(
  headers: Headers,
  candidate: ProductContextShadowTurn | null,
  env: NodeJS.ProcessEnv = process.env
): ProductContextShadowJob | null {
  const identity = readVerifiedLocalProductContextIdentity(headers, env);
  const config = readConfig(env);
  return identity && candidate && config ? { identity, candidate, config } : null;
}

export async function runProductContextShadowPostResponse(
  job: ProductContextShadowJob,
  dependencies: ProductContextShadowDependencies = {}
): Promise<ShadowCoordinatorResult | null> {
  const authorize = dependencies.authorize ?? authorizeThroughPortal;
  const initialCandidate = await authorize(job);
  const initial = validateProductKnowledgeContract<ShadowAuthorizationReceipt>("ShadowAuthorizationReceipt", initialCandidate);
  if (!initial.ok) return null;

  const authority: ShadowAuthorizationAuthority = {
    timeoutMs: PORTAL_AUTHORIZATION_TIMEOUT_MS,
    current: async () => authorize(job)
  };
  const coordinator = dependencies.createCoordinator?.(job, authority) ?? createCoordinator(job, authority);
  const ids = deriveServerRefs(initial.value, job.candidate);
  return coordinator.run({
    authorizationReceipt: initial.value,
    threadRef: ids.threadRef,
    stableTurnKey: ids.stableTurnKey,
    userBytes: new TextEncoder().encode(job.candidate.userText),
    agentBytes: new TextEncoder().encode(job.candidate.assistantText)
  });
}

function createCoordinator(job: ProductContextShadowJob, authority: ShadowAuthorizationAuthority): ShadowCoordinator {
  const pool = getPool(job.config.databaseUrl);
  return new ShadowCoordinator(
    new PostgresConversationStore(pool),
    authority,
    new HttpModelGateway({
      endpoint: job.config.modelGatewayUrl,
      bearerToken: job.config.modelGatewayToken,
      timeoutMs: job.config.modelTimeoutMs,
      maxRequestBytes: job.config.maxModelRequestBytes,
      maxResponseBytes: job.config.maxModelResponseBytes
    }),
    { enabled: true, environment: process.env.CUBICA_DEPLOYMENT_TIER ?? "", retentionMs: job.config.retentionMs }
  );
}

async function authorizeThroughPortal(job: ProductContextShadowJob): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PORTAL_AUTHORIZATION_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetch(job.config.portalUrl, {
      method: "POST",
      headers: { Authorization: job.identity.authorization, "content-type": "application/json" },
      body: JSON.stringify({ gameDocumentId: job.identity.gameDocumentId }),
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) return null;
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_PORTAL_RESPONSE_BYTES) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_PORTAL_RESPONSE_BYTES) return null;
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
    catch { return null; }
  } finally {
    clearTimeout(timer);
  }
}

function deriveServerRefs(receipt: ShadowAuthorizationReceipt, candidate: ProductContextShadowTurn) {
  const threadDigest = digest(`cubica-shadow-thread/v1\0${receipt.shadow_principal_ref}\0${candidate.threadId}`);
  const turnDigest = digest([
    "cubica-shadow-turn/v1", receipt.shadow_principal_ref, candidate.threadId,
    candidate.runId, candidate.userMessageId, candidate.assistantMessageId,
    digest(candidate.userText), digest(candidate.assistantText)
  ].join("\0"));
  return {
    threadRef: `cubica://shadow-thread/v1/${threadDigest}`,
    stableTurnKey: `shadow-turn-v1:${turnDigest}`
  };
}

function readConfig(env: NodeJS.ProcessEnv): ShadowConfig | null {
  const portalBase = safeHttpUrl(env.CUBICA_PORTAL_API_URL);
  const databaseUrl = safeShadowDatabaseUrl(env.CUBICA_PRODUCT_CONTEXT_SHADOW_DATABASE_URL);
  const modelGatewayUrl = safeHttpUrl(env.CUBICA_PRODUCT_CONTEXT_SHADOW_MODEL_GATEWAY_URL);
  const modelGatewayToken = env.CUBICA_PRODUCT_CONTEXT_SHADOW_MODEL_GATEWAY_TOKEN ?? "";
  const retentionMs = boundedInteger(env.CUBICA_PRODUCT_CONTEXT_SHADOW_RETENTION_MS, 1, 7 * 24 * 60 * 60 * 1000);
  if (!portalBase || !databaseUrl || !modelGatewayUrl || !modelGatewayToken || retentionMs === null) return null;
  return {
    portalUrl: new URL("/api/product-context/shadow-authorization", portalBase).toString(),
    databaseUrl, modelGatewayUrl, modelGatewayToken, retentionMs,
    modelTimeoutMs: boundedInteger(env.CUBICA_PRODUCT_CONTEXT_SHADOW_MODEL_TIMEOUT_MS, 1, 45_000) ?? 15_000,
    maxModelRequestBytes: boundedInteger(env.CUBICA_PRODUCT_CONTEXT_SHADOW_MODEL_MAX_REQUEST_BYTES, 1, 1024 * 1024) ?? 512 * 1024,
    maxModelResponseBytes: boundedInteger(env.CUBICA_PRODUCT_CONTEXT_SHADOW_MODEL_MAX_RESPONSE_BYTES, 1, 1024 * 1024) ?? 512 * 1024
  };
}

function safeHttpUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? "");
    const loopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    return url.protocol === "https:" || (url.protocol === "http:" && loopback) ? url.toString() : null;
  } catch { return null; }
}
function boundedInteger(value: string | undefined, min: number, max: number): number | null {
  if (value === undefined || !/^[0-9]+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}
function validId(value: unknown): value is string { return typeof value === "string" && ID_PATTERN.test(value); }
function digest(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }

let poolSingleton: { readonly databaseUrl: string; readonly pool: Pool } | undefined;
function getPool(databaseUrl: string): Pool {
  if (poolSingleton && poolSingleton.databaseUrl !== databaseUrl) throw new Error("Shadow database configuration changed during process lifetime.");
  if (!poolSingleton) {
    poolSingleton = {
      databaseUrl,
      pool: new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 2_000, idleTimeoutMillis: 10_000, allowExitOnIdle: true })
    };
  }
  return poolSingleton.pool;
}
