'use strict';

/**
 * Authenticated Portal adapter for the non-production product-context shadow.
 * The controller never trusts identity or role fields from the request body.
 */

const { createCoreController } = require('@strapi/strapi').factories;
const { authorizeProductContextShadow } = require('../../../utils/product-context-shadow-authorization');

module.exports = createCoreController('api::game.game', ({ strapi }) => ({
  async shadowAuthorization(ctx) {
    const result = await authorizeProductContextShadow({
      strapi,
      user: ctx.state.user,
      body: ctx.request.body?.data || ctx.request.body || {},
    });
    return ctx.send(result.body, result.status);
  },
}));
