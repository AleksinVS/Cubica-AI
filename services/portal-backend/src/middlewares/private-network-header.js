'use strict';

module.exports = (config, { strapi }) => {
  return async (ctx, next) => {
    if (ctx.request.method === 'OPTIONS') {
      ctx.set('Access-Control-Allow-Private-Network', 'true');
    }

    await next();
  };
};


