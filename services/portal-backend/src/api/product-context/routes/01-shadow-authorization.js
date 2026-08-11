'use strict';

const SHADOW_CONTROLLER_UID = 'api::product-context.product-context';

/**
 * Authentication is intentionally not disabled: Strapi must populate
 * `ctx.state.user` before the controller can attest a shadow subject.
 */

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/product-context/shadow-authorization',
      // A function handler prevents Strapi from adding a second role-permission
      // scope while keeping its JWT authentication middleware enabled.
      handler: (ctx) => global.strapi.controller(SHADOW_CONTROLLER_UID).shadowAuthorization(ctx),
      config: {},
    },
  ],
};
