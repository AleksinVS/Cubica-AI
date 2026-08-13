/**
 * Non-production post-response product-context shadow integration.
 *
 * This module is server-only by construction: it receives a locally attested
 * Portal bearer, extracts only the latest user string and assistant text that
 * the local backend itself emitted, and durably enqueues them. The bearer is
 * used only for this bounded authorization call and is never persisted.
 */
import { createHash } from "node:crypto";
import {
  enqueueShadowTurn,
  PostgresConversationStore,
  hasSecretLikeText,
  safeShadowDatabaseUrl,
  validateProductKnowledgeContract,
  type ShadowAuthorizationReceipt,
  type AtomicShadowEnqueueStore,
  type ShadowRunRecord
} from "@cubica/product-context";
import { Pool } from "pg";

import {
  readVerifiedLocalProductContextIdentity,
  type ProductContextForwardedIdentity
} from "@/lib/product-context-shadow-forwarding";

const MAX_PORTAL_RESPONSE_BYTES = 64 * 1024;
const PORTAL_AUTHORIZATION_TIMEOUT_MS = 5_000;

export type ProductContextShadowReceipt = ShadowAuthorizationReceipt;

interface ShadowConfig {
  readonly portalUrl: string;
  readonly databaseUrl: string;
  readonly deploymentTier: string;
  readonly retentionMs: number;
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
  readonly createStore?: (job: ProductContextShadowJob) => AtomicShadowEnqueueStore;
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
): Promise<ShadowRunRecord | null> {
  // Conversation secrets are rejected before Portal authorization or storage.
  if (hasSecretLikeText(job.candidate.userText) || hasSecretLikeText(job.candidate.assistantText)) return null;
  const authorize = dependencies.authorize ?? authorizeThroughPortal;
  const initialCandidate = await authorize(job);
  const initial = validateProductKnowledgeContract<ShadowAuthorizationReceipt>("ShadowAuthorizationReceipt", initialCandidate);
  if (!initial.ok) return null;

  const ids = deriveServerRefs(initial.value, job.candidate);
  const now = new Date();
  if (Date.parse(initial.value.issued_at) > now.getTime() || Date.parse(initial.value.expires_at) <= now.getTime()) return null;
  const store = dependencies.createStore?.(job) ?? new PostgresConversationStore(getPool(job.config.databaseUrl));
  return enqueueShadowTurn(store, {
    receipt: initial.value,
    threadRef: ids.threadRef,
    stableTurnKey: ids.stableTurnKey,
    userBytes: new TextEncoder().encode(job.candidate.userText),
    agentBytes: new TextEncoder().encode(job.candidate.assistantText),
    retainedUntil: new Date(now.getTime() + job.config.retentionMs),
    now
  });
}

async function authorizeThroughPortal(job: ProductContextShadowJob): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PORTAL_AUTHORIZATION_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetch(job.config.portalUrl, {
      method: "POST",
      redirect: "error",
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
  const enabled = env.CUBICA_PRODUCT_CONTEXT_SHADOW_ZAI_CODING_PLAN_ENABLED === "true";
  const retentionMs = boundedInteger(env.CUBICA_PRODUCT_CONTEXT_SHADOW_RETENTION_MS, 1, 7 * 24 * 60 * 60 * 1000);
  const deploymentTier = env.CUBICA_DEPLOYMENT_TIER ?? "";
  if (!portalBase || !databaseUrl || !enabled || !["test", "staging"].includes(deploymentTier) || retentionMs === null) return null;
  return {
    portalUrl: new URL("/api/product-context/shadow-authorization", portalBase).toString(),
    databaseUrl, deploymentTier, retentionMs
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
function digest(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }

let poolSingleton: { readonly databaseUrl: string; readonly pool: Pool } | undefined;
function getPool(databaseUrl: string): Pool {
  if (poolSingleton && poolSingleton.databaseUrl !== databaseUrl) throw new Error("Shadow database configuration changed during process lifetime.");
  if (!poolSingleton) {
    poolSingleton = {
      databaseUrl,
      pool: new Pool({
        connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 2_000,
        idleTimeoutMillis: 10_000, statement_timeout: 1_500,
        lock_timeout: 1_000, allowExitOnIdle: true
      })
    };
  }
  return poolSingleton.pool;
}
