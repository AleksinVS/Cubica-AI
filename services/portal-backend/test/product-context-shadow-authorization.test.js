'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  authorizeProductContextShadow,
  buildShadowPrincipalRef,
} = require('../src/utils/product-context-shadow-authorization');
const shadowRoutes = require('../src/api/product-context/routes/01-shadow-authorization');

const enabledEnv = {
  CUBICA_PRODUCT_CONTEXT_SHADOW_AUTHORIZATION: 'true',
  CUBICA_DEPLOYMENT_TIER: 'test',
  CUBICA_PRODUCT_CONTEXT_SHADOW_BINDING_KEY: 'a'.repeat(32),
  CUBICA_PRODUCT_CONTEXT_SHADOW_EXTERNAL_PROCESSING: 'allow',
  CUBICA_PRODUCT_CONTEXT_SHADOW_POLICY_REVISION: 'test-policy-1',
};

function strapiWithGame(game) {
  return { db: { query: () => ({ findOne: async () => game }) } };
}

test('denies missing or blocked authenticated Portal user', async () => {
  const missing = await authorizeProductContextShadow({ strapi: strapiWithGame(null), body: {}, env: enabledEnv });
  const blocked = await authorizeProductContextShadow({
    strapi: strapiWithGame(null), user: { id: 1, blocked: true }, body: {}, env: enabledEnv,
  });
  assert.equal(missing.status, 401);
  assert.equal(blocked.status, 401);
});

test('fails closed unless every non-production and policy gate is explicit', async () => {
  const variants = [
    {},
    { ...enabledEnv, CUBICA_DEPLOYMENT_TIER: 'production' },
    { ...enabledEnv, CUBICA_PRODUCT_CONTEXT_SHADOW_BINDING_KEY: 'short' },
    { ...enabledEnv, CUBICA_PRODUCT_CONTEXT_SHADOW_EXTERNAL_PROCESSING: 'deny' },
    { ...enabledEnv, CUBICA_PRODUCT_CONTEXT_SHADOW_POLICY_REVISION: '' },
  ];
  for (const env of variants) {
    const result = await authorizeProductContextShadow({
      strapi: strapiWithGame(null), user: { id: 1 }, body: { gameDocumentId: 'game-1' }, env,
    });
    assert.notEqual(result.status, 200);
  }
});

test('rejects forged identity, role and extra request fields', async () => {
  for (const extra of [{ principalId: 'victim' }, { playerId: 'victim' }, { role_scope: 'developer' }]) {
    const result = await authorizeProductContextShadow({
      strapi: strapiWithGame(null), user: { id: 1 },
      body: { gameDocumentId: 'game-1', ...extra }, env: enabledEnv,
    });
    assert.equal(result.status, 400);
  }
});

test('denies a game not owned by the authenticated user', async () => {
  const result = await authorizeProductContextShadow({
    strapi: strapiWithGame({ documentId: 'game-1', developed_by: { id: 2 } }),
    user: { id: 1 }, body: { gameDocumentId: 'game-1' }, env: enabledEnv,
  });
  assert.equal(result.status, 403);
  assert.equal(result.body.reason, 'game_not_owned');
});

test('returns a bounded receipt without raw identity or secrets for an owned game', async () => {
  const now = new Date('2026-08-09T12:00:00.000Z');
  const result = await authorizeProductContextShadow({
    strapi: strapiWithGame({ documentId: 'game-1', updatedAt: 'rev-7', developed_by: { id: 7 } }),
    user: { id: 7 }, body: { gameDocumentId: 'game-1' }, env: enabledEnv, now,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.role_scope, 'developer');
  assert.deepEqual(result.body.applies_to, ['cubica://game-project/game-1']);
  assert.equal(result.body.shadow_principal_ref, buildShadowPrincipalRef(enabledEnv.CUBICA_PRODUCT_CONTEXT_SHADOW_BINDING_KEY, 7));
  assert.match(result.body.authorization_revision, /^sha256:[a-f0-9]{64}$/u);
  const serialized = JSON.stringify(result.body);
  assert.doesNotMatch(serialized, /"7"|aaaaaaaa/u);
});

test('binding is deterministic per user and separates users', () => {
  const key = enabledEnv.CUBICA_PRODUCT_CONTEXT_SHADOW_BINDING_KEY;
  assert.equal(buildShadowPrincipalRef(key, 1), buildShadowPrincipalRef(key, 1));
  assert.notEqual(buildShadowPrincipalRef(key, 1), buildShadowPrincipalRef(key, 2));
});

test('Strapi route keeps authentication enabled', () => {
  assert.equal(shadowRoutes.routes.length, 1);
  assert.notEqual(shadowRoutes.routes[0].config?.auth, false);
});
