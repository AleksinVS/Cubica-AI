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
  CUBICA_PRODUCT_CONTEXT_SHADOW_PORTAL_USER_ID: '7',
  CUBICA_PRODUCT_CONTEXT_SHADOW_GAME_DOCUMENT_ID: 'game-1',
  CUBICA_PRODUCT_CONTEXT_SHADOW_DEVELOPER_ROLE_ID: '2',
};

function strapiWith({ portalUser = null, game = null } = {}) {
  return {
    db: {
      query: (uid) => ({
        findOne: async () => uid === 'plugin::users-permissions.user' ? portalUser : game,
      }),
    },
  };
}

test('denies missing or blocked authenticated Portal user', async () => {
  const missing = await authorizeProductContextShadow({ strapi: strapiWith(), body: {}, env: enabledEnv });
  const blocked = await authorizeProductContextShadow({
    strapi: strapiWith({ portalUser: { id: 7, blocked: true, role: { id: 2 } } }),
    user: { id: 7 }, body: { gameDocumentId: 'game-1' }, env: enabledEnv,
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
    { ...enabledEnv, CUBICA_PRODUCT_CONTEXT_SHADOW_PORTAL_USER_ID: '' },
    { ...enabledEnv, CUBICA_PRODUCT_CONTEXT_SHADOW_GAME_DOCUMENT_ID: '' },
    { ...enabledEnv, CUBICA_PRODUCT_CONTEXT_SHADOW_DEVELOPER_ROLE_ID: '' },
  ];
  for (const env of variants) {
    const result = await authorizeProductContextShadow({
      strapi: strapiWith(), user: { id: 7 }, body: { gameDocumentId: 'game-1' }, env,
    });
    assert.notEqual(result.status, 200);
  }
});

test('rejects forged identity, role and extra request fields', async () => {
  for (const extra of [{ principalId: 'victim' }, { playerId: 'victim' }, { role_scope: 'developer' }]) {
    const result = await authorizeProductContextShadow({
      strapi: strapiWith(), user: { id: 7 },
      body: { gameDocumentId: 'game-1', ...extra }, env: enabledEnv,
    });
    assert.equal(result.status, 400);
  }
});

test('denies a game not owned by the authenticated user', async () => {
  const result = await authorizeProductContextShadow({
    strapi: strapiWith({
      portalUser: { id: 7, role: { id: 2 } },
      game: { documentId: 'game-1', developed_by: { id: 8 } },
    }),
    user: { id: 7 }, body: { gameDocumentId: 'game-1' }, env: enabledEnv,
  });
  assert.equal(result.status, 403);
  assert.equal(result.body.reason, 'game_not_owned');
});

test('returns a bounded receipt without raw identity or secrets for an owned game', async () => {
  const now = new Date('2026-08-09T12:00:00.000Z');
  const result = await authorizeProductContextShadow({
    strapi: strapiWith({
      portalUser: { id: 7, updatedAt: 'user-rev-3', role: { id: 2 } },
      game: { documentId: 'game-1', updatedAt: 'rev-7', developed_by: { id: 7 } },
    }),
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

test('allows only the one server-configured Portal user', async () => {
  const result = await authorizeProductContextShadow({
    strapi: strapiWith({ portalUser: { id: 8, role: { id: 2 } } }),
    user: { id: 8 }, body: { gameDocumentId: 'game-1' }, env: enabledEnv,
  });
  assert.equal(result.status, 403);
  assert.equal(result.body.reason, 'shadow_subject_not_allowed');
});

test('allows only the one server-configured game document', async () => {
  const result = await authorizeProductContextShadow({
    strapi: strapiWith({ portalUser: { id: 7, role: { id: 2 } } }),
    user: { id: 7 }, body: { gameDocumentId: 'game-2' }, env: enabledEnv,
  });
  assert.equal(result.status, 403);
  assert.equal(result.body.reason, 'shadow_game_not_allowed');
});

test('denies a configured user whose authoritative role is not the developer role', async () => {
  const result = await authorizeProductContextShadow({
    strapi: strapiWith({ portalUser: { id: 7, role: { id: 3 } } }),
    user: { id: 7 }, body: { gameDocumentId: 'game-1' }, env: enabledEnv,
  });
  assert.equal(result.status, 403);
  assert.equal(result.body.reason, 'developer_role_required');
});

test('denies the next authorization immediately after the developer role is changed', async () => {
  const portalUser = { id: 7, updatedAt: 'user-rev-1', role: { id: 2 } };
  const strapi = strapiWith({
    portalUser,
    game: { documentId: 'game-1', updatedAt: 'game-rev-1', developed_by: { id: 7 } },
  });
  const first = await authorizeProductContextShadow({
    strapi, user: { id: 7 }, body: { gameDocumentId: 'game-1' }, env: enabledEnv,
  });
  assert.equal(first.status, 200);

  portalUser.role = { id: 3 };
  const changed = await authorizeProductContextShadow({
    strapi, user: { id: 7, role: { id: 2 } }, body: { gameDocumentId: 'game-1' }, env: enabledEnv,
  });
  assert.equal(changed.status, 403);
  assert.equal(changed.body.reason, 'developer_role_required');
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
