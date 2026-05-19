'use strict';

/**
 * Launch-session controller.
 *
 * Controllers only parse HTTP input and map service results to Strapi/Koa
 * responses. Business rules live in the launch-session service and in the pure
 * helper under src/utils.
 */

const { createCoreController } = require('@strapi/strapi').factories;

function requestPayload(ctx) {
  return ctx.request.body?.data || ctx.request.body || {};
}

module.exports = createCoreController('api::launch-session.launch-session', ({ strapi }) => ({
  async copyLink(ctx) {
    const user = ctx.state.user;

    if (!user?.id) {
      return ctx.send({ ok: false, reason: 'Authentication required' }, 401);
    }

    const { purchaseId, linkId } = requestPayload(ctx);

    if ((!purchaseId && !linkId) || (purchaseId && linkId)) {
      return ctx.badRequest('Exactly one of purchaseId or linkId is required');
    }

    const result = await strapi.service('api::launch-session.launch-session').copyLink({
      user,
      purchaseId,
      linkId,
    });

    if (!result.ok) {
      const status = result.httpStatus || 400;
      return ctx.send(result, status);
    }

    return ctx.send(result);
  },

  async resolve(ctx) {
    const { token, counter } = ctx.params;

    if (!token || !counter) {
      return ctx.badRequest('token and counter are required');
    }

    const result = await strapi.service('api::launch-session.launch-session').resolve({
      token,
      counter,
    });

    if (!result.ok && result.httpStatus === 404) {
      return ctx.notFound(result.reason || 'Launch session not found');
    }

    return ctx.send(result, result.httpStatus || 200);
  },

  async active(ctx) {
    const user = ctx.state.user;

    if (!user?.id) {
      return ctx.send({ ok: false, reason: 'Authentication required' }, 401);
    }

    const result = await strapi.service('api::launch-session.launch-session').active({
      user,
      purchaseId: ctx.query.purchaseId,
      linkId: ctx.query.linkId,
    });

    if (!result.ok) {
      return ctx.send(result, result.httpStatus || 400);
    }

    return ctx.send(result);
  },
}));
