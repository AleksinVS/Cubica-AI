'use strict';

/**
 * Pure authorization boundary for the non-production product-context shadow.
 *
 * Portal is allowed to attest its own authenticated user and game ownership,
 * but this temporary receipt deliberately does not claim to be Cubica's future
 * cross-application identity. The HMAC makes the subject stable inside one
 * test environment and unlinkable after that environment's key is destroyed.
 */

const { createHash, createHmac, timingSafeEqual } = require('node:crypto');

const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const NUMERIC_ID_PATTERN = /^[1-9][0-9]{0,18}$/u;
const ALLOWED_TIERS = new Set(['test', 'staging']);
const RECEIPT_TTL_MS = 5 * 60 * 1000;
const WORKER_CLOCK_SKEW_MS = 60 * 1000;

async function authorizeProductContextShadow({ strapi, user, body, env = process.env, now = new Date() }) {
  if (!user?.id) {
    return deny(401, 'authentication_required');
  }

  const config = readShadowAuthorizationConfig(env);
  if (!config.ok) {
    return deny(404, config.reason);
  }

  if (!isExactGameRequest(body)) {
    return deny(400, 'invalid_request');
  }
  if (String(user.id) !== config.portalUserId) {
    return deny(403, 'shadow_subject_not_allowed');
  }
  if (body.gameDocumentId !== config.gameDocumentId) {
    return deny(403, 'shadow_game_not_allowed');
  }

  // The authenticated principal proves only who made the request. Role and
  // blocked state are reread from Portal storage so revocation takes effect on
  // every receipt and cannot be supplied by the request body.
  const portalUser = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: user.id },
    populate: { role: true },
  });
  if (!portalUser || String(portalUser.id) !== config.portalUserId || portalUser.blocked === true) {
    return deny(401, 'authentication_required');
  }
  if (!portalUser.role || String(portalUser.role.id) !== config.developerRoleId) {
    return deny(403, 'developer_role_required');
  }

  const game = await strapi.db.query('api::game.game').findOne({
    where: { documentId: config.gameDocumentId },
    populate: { developed_by: true },
  });
  if (!game || game.documentId !== config.gameDocumentId) {
    return deny(404, 'game_not_found');
  }
  if (!game.developed_by || String(game.developed_by.id) !== config.portalUserId) {
    return deny(403, 'game_not_owned');
  }

  const issuedAt = new Date(now);
  const expiresAt = new Date(issuedAt.getTime() + RECEIPT_TTL_MS);
  const appliesTo = `cubica://game-project/${encodeURIComponent(game.documentId)}`;
  const shadowPrincipalRef = buildShadowPrincipalRef(config.bindingKey, portalUser.id);
  const decisionBasis = {
    shadow_principal_ref: shadowPrincipalRef,
    role_scope: 'developer',
    applies_to: [appliesTo],
    access_policy_ref: 'portal-owned-game-developer-v1',
    access_policy_revision: `sha256:${sha256(canonicalJson({
      game_updated_at: String(game.updatedAt || game.documentId),
      portal_user_updated_at: String(portalUser.updatedAt || portalUser.id),
      developer_role_id: config.developerRoleId,
    }))}`,
    retention_policy_ref: 'product-context-shadow-7d-v1',
    retention_policy_revision: '1',
    external_processing_policy_ref: 'product-context-shadow-explicit-allow-v1',
    external_processing_policy_revision: config.externalProcessingRevision,
  };

  return {
    ok: true,
    status: 200,
    body: {
      schema_version: '1.0.0',
      decision: 'allow',
      ...decisionBasis,
      authorization_revision: `sha256:${sha256(canonicalJson(decisionBasis))}`,
      issued_at: issuedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    },
  };
}

/** Reauthorizes a queued run from a separately authenticated worker, never a bearer. */
async function reauthorizeProductContextShadowWorker({ strapi, body, signature, env = process.env, now = new Date() }) {
  const config = readShadowAuthorizationConfig(env);
  if (!config.ok) return deny(404, config.reason);
  const key = env.CUBICA_PRODUCT_CONTEXT_SHADOW_REAUTHORIZATION_KEY || '';
  if (Buffer.byteLength(key, 'utf8') < 32) return deny(404, 'worker_reauthorization_disabled');
  if (!isExactWorkerRequest(body)) return deny(400, 'invalid_request');
  const issuedAt = Date.parse(body.issuedAt);
  if (!Number.isFinite(issuedAt) || Math.abs(new Date(now).getTime() - issuedAt) > WORKER_CLOCK_SKEW_MS) return deny(401, 'worker_request_expired');
  const expectedPrincipal = buildShadowPrincipalRef(config.bindingKey, config.portalUserId);
  if (body.gameDocumentId !== config.gameDocumentId || body.shadowPrincipalRef !== expectedPrincipal) return deny(403, 'worker_binding_changed');
  const expected = createHmac('sha256', key).update(workerSignaturePayload(body), 'utf8').digest('hex');
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/u.test(signature) ||
      !timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) return deny(401, 'worker_signature_invalid');
  return authorizeProductContextShadow({
    strapi,
    // Keep the configured identifier lossless; Strapi accepts its decimal
    // representation and JavaScript numbers cannot represent every allowed DB id.
    user: { id: config.portalUserId },
    body: { gameDocumentId: config.gameDocumentId },
    env,
    now,
  });
}

function readShadowAuthorizationConfig(env) {
  if (env.CUBICA_PRODUCT_CONTEXT_SHADOW_AUTHORIZATION !== 'true') {
    return { ok: false, reason: 'shadow_disabled' };
  }
  if (!ALLOWED_TIERS.has(env.CUBICA_DEPLOYMENT_TIER)) {
    return { ok: false, reason: 'nonproduction_tier_required' };
  }
  const bindingKey = env.CUBICA_PRODUCT_CONTEXT_SHADOW_BINDING_KEY || '';
  if (Buffer.byteLength(bindingKey, 'utf8') < 32) {
    return { ok: false, reason: 'shadow_binding_key_missing' };
  }
  if (env.CUBICA_PRODUCT_CONTEXT_SHADOW_EXTERNAL_PROCESSING !== 'allow') {
    return { ok: false, reason: 'external_processing_denied' };
  }
  const externalProcessingRevision = env.CUBICA_PRODUCT_CONTEXT_SHADOW_POLICY_REVISION || '';
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(externalProcessingRevision)) {
    return { ok: false, reason: 'external_processing_policy_unknown' };
  }
  const portalUserId = env.CUBICA_PRODUCT_CONTEXT_SHADOW_PORTAL_USER_ID || '';
  if (!NUMERIC_ID_PATTERN.test(portalUserId)) {
    return { ok: false, reason: 'shadow_portal_user_unknown' };
  }
  const gameDocumentId = env.CUBICA_PRODUCT_CONTEXT_SHADOW_GAME_DOCUMENT_ID || '';
  if (!DOCUMENT_ID_PATTERN.test(gameDocumentId)) {
    return { ok: false, reason: 'shadow_game_unknown' };
  }
  const developerRoleId = env.CUBICA_PRODUCT_CONTEXT_SHADOW_DEVELOPER_ROLE_ID || '';
  if (!NUMERIC_ID_PATTERN.test(developerRoleId)) {
    return { ok: false, reason: 'shadow_developer_role_unknown' };
  }
  return { ok: true, bindingKey, externalProcessingRevision, portalUserId, gameDocumentId, developerRoleId };
}

function isExactGameRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const keys = Object.keys(body);
  return keys.length === 1 && keys[0] === 'gameDocumentId' && DOCUMENT_ID_PATTERN.test(body.gameDocumentId);
}

function isExactWorkerRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const keys = Object.keys(body).sort();
  return JSON.stringify(keys) === JSON.stringify(['authorizationRevision', 'gameDocumentId', 'issuedAt', 'shadowPrincipalRef']) &&
    DOCUMENT_ID_PATTERN.test(body.gameDocumentId) &&
    /^cubica:\/\/shadow-principal\/v1\/[a-f0-9]{64}$/u.test(body.shadowPrincipalRef) &&
    /^sha256:[a-f0-9]{64}$/u.test(body.authorizationRevision) &&
    typeof body.issuedAt === 'string';
}

function workerSignaturePayload(body) {
  return ['cubica-product-context-shadow-worker-reauthorization/v1', body.shadowPrincipalRef,
    body.gameDocumentId, body.authorizationRevision, body.issuedAt].join('\0');
}

function buildShadowPrincipalRef(bindingKey, userId) {
  const digest = createHmac('sha256', bindingKey)
    .update(`cubica-portal-shadow-subject-v1\0${String(userId)}`, 'utf8')
    .digest('hex');
  return `cubica://shadow-principal/v1/${digest}`;
}

function canonicalJson(value) {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function deny(status, reason) {
  return { ok: false, status, body: { error: 'Product-context shadow authorization denied.', reason } };
}

module.exports = {
  authorizeProductContextShadow,
  reauthorizeProductContextShadowWorker,
  buildShadowPrincipalRef,
  readShadowAuthorizationConfig,
  workerSignaturePayload,
};
