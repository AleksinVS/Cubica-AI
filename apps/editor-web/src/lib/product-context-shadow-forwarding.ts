/**
 * Server-only attestation for forwarding Portal credentials to local AG-UI.
 *
 * The browser-facing CopilotKit route is the only component allowed to copy
 * the current bearer and game document ID. A keyed receipt prevents a caller
 * from bypassing that route and forging the two headers directly on AG-UI.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const GAME_DOCUMENT_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const ALLOWED_TIERS = new Set(["test", "staging"]);
const ATTESTATION_HEADER = "x-cubica-product-context-shadow-attestation";

export interface ProductContextForwardedIdentity {
  readonly authorization: string;
  readonly gameDocumentId: string;
}

export function createLocalProductContextShadowHeaders(
  request: Pick<Request, "headers" | "url">,
  env: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  if (getLocalProductContextShadowOrigin(request, env) === null) return {};
  const identity = readIdentity(request.headers);
  const key = readForwardingKey(env);
  if (!identity || !key) return {};
  return {
    Authorization: identity.authorization,
    "x-cubica-game-document-id": identity.gameDocumentId,
    [ATTESTATION_HEADER]: sign(identity, key)
  };
}

/** Returns the explicit local origin only when it exactly matches this request. */
export function getLocalProductContextShadowOrigin(
  request: Pick<Request, "headers" | "url">,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (!isShadowMode(env) || !readIdentity(request.headers) || !readForwardingKey(env)) return null;
  const configured = safeLocalOrigin(env.CUBICA_PRODUCT_CONTEXT_SHADOW_LOCAL_ORIGIN);
  if (!configured) return null;
  try { return new URL(request.url).origin === configured ? configured : null; }
  catch { return null; }
}

export function readVerifiedLocalProductContextIdentity(
  headers: Headers,
  env: NodeJS.ProcessEnv = process.env
): ProductContextForwardedIdentity | null {
  if (!isShadowMode(env)) return null;
  const identity = readIdentity(headers);
  const key = readForwardingKey(env);
  const supplied = headers.get(ATTESTATION_HEADER);
  if (!identity || !key || !supplied || !/^[a-f0-9]{64}$/u.test(supplied)) return null;
  const expected = sign(identity, key);
  return timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex")) ? identity : null;
}

export function isShadowMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CUBICA_PRODUCT_CONTEXT_MODE === "shadow" && ALLOWED_TIERS.has(env.CUBICA_DEPLOYMENT_TIER ?? "");
}

function readIdentity(headers: Headers): ProductContextForwardedIdentity | null {
  const authorization = headers.get("authorization")?.trim();
  const gameDocumentId = headers.get("x-cubica-game-document-id")?.trim();
  if (!authorization || !/^Bearer [^\s]+$/u.test(authorization) || !gameDocumentId || !GAME_DOCUMENT_ID.test(gameDocumentId)) return null;
  return { authorization, gameDocumentId };
}

function readForwardingKey(env: NodeJS.ProcessEnv): string | null {
  const key = env.CUBICA_PRODUCT_CONTEXT_SHADOW_FORWARD_KEY ?? "";
  return Buffer.byteLength(key, "utf8") >= 32 ? key : null;
}

function safeLocalOrigin(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? "");
    const loopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.protocol === "https:" || (url.protocol === "http:" && loopback) ? url.origin : null;
  } catch { return null; }
}

function sign(identity: ProductContextForwardedIdentity, key: string): string {
  return createHmac("sha256", key)
    .update("cubica-product-context-shadow-forward/v1\0", "utf8")
    .update(identity.authorization, "utf8")
    .update("\0", "utf8")
    .update(identity.gameDocumentId, "utf8")
    .digest("hex");
}
