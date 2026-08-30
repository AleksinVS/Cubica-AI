const localCorsOrigins = [
  'http://localhost:3000',
  'http://localhost:3002',
  'http://localhost:3010',
  'http://127.0.0.1:3203',
];

function allowedCorsOrigins() {
  return [
    process.env.PORTAL_PUBLIC_URL,
    process.env.PLAYER_PUBLIC_URL,
    process.env.STRAPI_ADMIN_BACKEND_URL,
    process.env.PORTAL_TEST_CORS_ORIGIN,
    ...localCorsOrigins,
  ].filter(Boolean);
}

module.exports = [
  'strapi::errors',
  'strapi::security',
  {
    name: 'strapi::cors',
    config: {
      origin: (ctx) => {
        const origin = ctx.request.header.origin;
        const allowedOrigins = allowedCorsOrigins();

        if (allowedOrigins.includes(origin)) {
          return origin;
        }

        // Return a known invalid string that won't match anything, but still prevents .split crash
        return 'null'; // << Important: Strapi treats it as a string, avoids .split crash
      },
      credentials: true,
    },
  },

  {
    name: 'global::private-network-header',
    resolve: './src/middlewares/private-network-header',
  },
  'strapi::logger',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
