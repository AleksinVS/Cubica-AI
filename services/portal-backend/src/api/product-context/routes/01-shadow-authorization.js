'use strict';

/**
 * Authentication is intentionally not disabled: Strapi must populate
 * `ctx.state.user` before the controller can attest a shadow subject.
 */

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/product-context/shadow-authorization',
      handler: 'product-context.shadowAuthorization',
      config: {},
    },
  ],
};
