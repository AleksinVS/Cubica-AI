module.exports = [
  'strapi::errors',
  'strapi::security',
  {
    name: 'strapi::cors',
    config: {
      origin: (ctx) => {
        const origin = ctx.request.header.origin;

        const allowedOrigins = [
          'http://localhost:3000',
          'http://45.32.22.80:12345',
        ];

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
