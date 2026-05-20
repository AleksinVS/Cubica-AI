'use strict';

/**
 * Custom launch-session routes.
 *
 * The copy and active endpoints require a logged-in consultant. The resolver is
 * public because players open copied portal URLs without a Strapi account.
 */

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/launch-sessions/copy-link',
      handler: 'launch-session.copyLink',
      config: {},
    },
    {
      method: 'GET',
      path: '/launch-sessions/resolve/:token/:counter',
      handler: 'launch-session.resolve',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/launch-sessions/resolve/:token/:counter/runtime-binding',
      handler: 'launch-session.runtimeBinding',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/launch-sessions/active',
      handler: 'launch-session.active',
      config: {},
    },
  ],
};
