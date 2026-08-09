'use strict';

/**
 * Pure authorization boundary for the non-production product-context shadow.
 *
 * Portal is allowed to attest its own authenticated user and game ownership,
 * but this temporary receipt deliberately does not claim to be Cubica's future
 * cross-application identity. The HMAC makes the subject stable inside one
 * test environment and unlinkable after that environment's key is destroyed.
 */

const { createHash, createHmac } = require('node:crypto');

const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const ALLOWED_TIERS = new Set(['test', 'staging']);
const RECEIPT_TTL_MS = 5 * 60 * 1000;

async function authorizeProductContextShadow({ strapi, user, body, env = process.env, now = new Date() }) {
  if (!user?.id || user.blocked === true) {
    return deny(401, 'authentication_required');
  }

  const config = readShadowAuthorizationConfig(env);
  if (!config.ok) {
    return deny(404, config.reason);
  }

  if (!isExactGameRequest(body)) {
    return deny(400, 'invalid_request');
  }

  const game = await strapi.db.query('api::game.game').findOne({
    where: { documentId: body.gameDocumentId },
    populate: { developed_by: true },
  });
  if (!game) {
    return deny(404, 'game_not_found');
  }
  if (!game.developed_by || String(game.developed_by.id) !== String(user.id)) {
    return deny(403, 'game_not_owned');
  }

  const issuedAt = new Date(now);
  const expiresAt = new Date(issuedAt.getTime() + RECEIPT_TTL_MS);
  const appliesTo = `cubica://game-project/${encodeURIComponent(game.documentId)}`;
  const shadowPrincipalRef = buildShadowPrincipalRef(config.bindingKey, user.id);
  const decisionBasis = {
    shadow_principal_ref: shadowPrincipalRef,
    role_scope: 'developer',
    applies_to: [appliesTo],
    access_policy_ref: 'portal-owned-game-developer-v1',
    access_policy_revision: String(game.updatedAt || game.documentId),
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
  return { ok: true, bindingKey, externalProcessingRevision };
}

function isExactGameRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const keys = Object.keys(body);
  return keys.length === 1 && keys[0] === 'gameDocumentId' && DOCUMENT_ID_PATTERN.test(body.gameDocumentId);
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
  buildShadowPrincipalRef,
  readShadowAuthorizationConfig,
};
