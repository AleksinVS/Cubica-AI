'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

function loadWithStrapiFactories(modulePath, factories) {
  const resolvedPath = require.resolve(modulePath);
  const originalLoad = Module._load;

  delete require.cache[resolvedPath];
  Module._load = function load(request, parent, isMain) {
    if (request === '@strapi/strapi') {
      return { factories };
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(resolvedPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[resolvedPath];
  }
}

function createOrderController(strapi) {
  const definition = loadWithStrapiFactories(
    '../src/api/order/controllers/order',
    {
      createCoreController(uid, extendController) {
        return { uid, extendController };
      },
    }
  );

  assert.equal(definition.uid, 'api::order.order');
  return definition.extendController({ strapi });
}

function loadCoreRouterDeclaration(modulePath) {
  return loadWithStrapiFactories(modulePath, {
    createCoreRouter(uid, options) {
      return { uid, options };
    },
  });
}

function setEnvironmentVariable(t, key, value) {
  const previousValue = process.env[key];

  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }

  t.after(() => {
    if (previousValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previousValue;
    }
  });
}

function signPaymentResult(outSum, invId, secret) {
  return crypto
    .createHash('sha256')
    .update(`${outSum}:${invId}:${secret}`)
    .digest('hex');
}

test('payment-link generation rejects unauthenticated requests before querying orders', async () => {
  let queryCount = 0;
  const controller = createOrderController({
    db: {
      query() {
        queryCount += 1;
        throw new Error('Unauthenticated requests must not query the database');
      },
    },
  });
  let response;
  const ctx = {
    request: { query: { documentId: 'order-document-id' } },
    state: {},
    send(body, status = 200) {
      response = { body, status };
      return response;
    },
  };

  await controller.generatePaymentLink(ctx);

  assert.equal(queryCount, 0);
  assert.equal(response.status, 401);
  assert.equal(response.body.error_code, 'AUTHENTICATION_REQUIRED');
});

test('payment stub requires both the server gate and a pre-existing authenticated user', async (t) => {
  const previousValue = process.env.PAYMENT_STUB_ENABLED;
  t.after(() => {
    if (previousValue === undefined) {
      delete process.env.PAYMENT_STUB_ENABLED;
    } else {
      process.env.PAYMENT_STUB_ENABLED = previousValue;
    }
  });

  const controller = createOrderController({});
  let forbiddenMessage;
  process.env.PAYMENT_STUB_ENABLED = 'false';
  await controller.createPaymentStub({
    state: {},
    forbidden(message) {
      forbiddenMessage = message;
      return { status: 403, message };
    },
  });
  assert.equal(forbiddenMessage, 'Payment stub is disabled.');

  let response;
  process.env.PAYMENT_STUB_ENABLED = 'true';
  await controller.createPaymentStub({
    request: { body: {} },
    state: {},
    send(body, status = 200) {
      response = { body, status };
      return response;
    },
  });
  assert.equal(response.status, 401);
  assert.equal(response.body.error_code, 'AUTHENTICATION_REQUIRED');
});

test('payment-link generation masks absent and foreign orders behind the same not-found response', async () => {
  const lookups = [];
  const controller = createOrderController({
    db: {
      query(uid) {
        assert.equal(uid, 'api::order.order');
        return {
          async findOne(options) {
            lookups.push(options);
            return null;
          },
        };
      },
    },
  });
  const notFoundResponses = [];

  for (const documentId of ['missing-order', 'foreign-order']) {
    const ctx = {
      request: { query: { documentId } },
      state: { user: { id: 42 } },
      notFound(message) {
        const response = { status: 404, message };
        notFoundResponses.push(response);
        return response;
      },
    };

    const result = await controller.generatePaymentLink(ctx);
    assert.deepEqual(result, { status: 404, message: 'Order not found' });
  }

  assert.deepEqual(lookups, [
    {
      where: {
        documentId: 'missing-order',
        users_permissions_user: { id: 42 },
      },
      populate: ['game'],
    },
    {
      where: {
        documentId: 'foreign-order',
        users_permissions_user: { id: 42 },
      },
      populate: ['game'],
    },
  ]);
  assert.deepEqual(notFoundResponses[0], notFoundResponses[1]);
});

test('payment-link generation signs only an order selected with its authoritative owner', async (t) => {
  const previousEnvironment = {
    ROBO_MERCHANT_LOGIN: process.env.ROBO_MERCHANT_LOGIN,
    ROBO_PASSWORD1: process.env.ROBO_PASSWORD1,
    ROBO_PAYMENT_SUCCESS_URL: process.env.ROBO_PAYMENT_SUCCESS_URL,
    ROBO_PAYMENT_FAIL_URL: process.env.ROBO_PAYMENT_FAIL_URL,
  };
  Object.assign(process.env, {
    ROBO_MERCHANT_LOGIN: 'merchant',
    ROBO_PASSWORD1: 'password-one',
    ROBO_PAYMENT_SUCCESS_URL: 'https://portal.example/success',
    ROBO_PAYMENT_FAIL_URL: 'https://portal.example/fail',
  });
  t.after(() => {
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  let orderLookup;
  let paymentEvent;
  const controller = createOrderController({
    db: {
      query(uid) {
        if (uid === 'api::order.order') {
          return {
            async findOne(options) {
              orderLookup = options;
              return {
                id: 17,
                documentId: 'owned-order',
                price: 1250,
                game: { title: 'Owned Game' },
              };
            },
          };
        }

        assert.equal(uid, 'api::payment-event.payment-event');
        return {
          async create(options) {
            paymentEvent = options;
            return { id: 1 };
          },
        };
      },
    },
    log: {
      error() {},
    },
  });
  let response;
  const ctx = {
    request: { query: { documentId: 'owned-order' } },
    state: { user: { id: 42 } },
    send(body, status = 200) {
      response = { body, status };
      return response;
    },
  };

  await controller.generatePaymentLink(ctx);

  assert.deepEqual(orderLookup, {
    where: {
      documentId: 'owned-order',
      users_permissions_user: { id: 42 },
    },
    populate: ['game'],
  });
  assert.equal(response.status, 200);
  const paymentUrl = new URL(response.body.url);
  assert.equal(paymentUrl.searchParams.get('MerchantLogin'), 'merchant');
  assert.equal(paymentUrl.searchParams.get('InvoiceID'), '17');
  assert.match(paymentUrl.searchParams.get('SignatureValue'), /^[a-f0-9]{64}$/);
  assert.equal(paymentEvent.data.order, 17);
});

test('payment callback fails closed without the server secret and performs no database access', async (t) => {
  setEnvironmentVariable(t, 'ROBO_PASSWORD2', undefined);
  let databaseAccessCount = 0;
  const controller = createOrderController({
    db: {
      query() {
        databaseAccessCount += 1;
        throw new Error('Missing callback configuration must fail before database access');
      },
    },
    log: {
      error() {},
    },
  });
  let response;

  await controller.handlePaymentResult({
    request: {
      body: {
        OutSum: '1250.00',
        InvId: '17',
        SignatureValue: 'a'.repeat(64),
      },
    },
    internalServerError(message) {
      response = { status: 500, message };
      return response;
    },
  });

  assert.equal(databaseAccessCount, 0);
  assert.deepEqual(response, {
    status: 500,
    message: 'Payment callback is not configured',
  });
});

test('payment callback rejects malformed or non-canonical scalar inputs before database access', async (t) => {
  setEnvironmentVariable(t, 'ROBO_PASSWORD2', 'callback-secret');
  let databaseAccessCount = 0;
  const controller = createOrderController({
    db: {
      query() {
        databaseAccessCount += 1;
        throw new Error('Malformed callback data must fail before database access');
      },
    },
    log: {
      warn() {},
    },
  });
  const validSignatureShape = 'a'.repeat(64);
  const malformedBodies = [
    { OutSum: '01.00', InvId: '17', SignatureValue: validSignatureShape },
    { OutSum: '1.234', InvId: '17', SignatureValue: validSignatureShape },
    { OutSum: '1234567890123.00', InvId: '17', SignatureValue: validSignatureShape },
    { OutSum: [], InvId: '17', SignatureValue: validSignatureShape },
    { OutSum: '1250.00', InvId: '017', SignatureValue: validSignatureShape },
    { OutSum: '1250.00', InvId: '0', SignatureValue: validSignatureShape },
    { OutSum: '1250.00', InvId: '9007199254740992', SignatureValue: validSignatureShape },
    { OutSum: '1250.00', InvId: '17', SignatureValue: 'abc' },
    { OutSum: '1250.00', InvId: '17', SignatureValue: [] },
  ];

  for (const body of malformedBodies) {
    const result = await controller.handlePaymentResult({
      request: { body },
      badRequest(message) {
        return { status: 400, message };
      },
    });

    assert.deepEqual(result, {
      status: 400,
      message: 'Invalid payment callback payload',
    });
  }

  assert.equal(databaseAccessCount, 0);
});

test('payment callback rejects a wrong signature before querying or updating an order', async (t) => {
  setEnvironmentVariable(t, 'ROBO_PASSWORD2', 'callback-secret');
  let databaseAccessCount = 0;
  let updateCount = 0;
  const controller = createOrderController({
    db: {
      query() {
        databaseAccessCount += 1;
        return {
          async update() {
            updateCount += 1;
          },
        };
      },
    },
    log: {
      warn() {},
    },
  });

  const result = await controller.handlePaymentResult({
    request: {
      body: {
        OutSum: '1250.00',
        InvId: '17',
        SignatureValue: '0'.repeat(64),
      },
    },
    badRequest(message) {
      return { status: 400, message };
    },
  });

  assert.deepEqual(result, { status: 400, message: 'Invalid signature' });
  assert.equal(databaseAccessCount, 0);
  assert.equal(updateCount, 0);
});

test('correctly signed payment callback marks the order paid and creates its purchase', async (t) => {
  const secret = 'callback-secret';
  const outSum = '1250.00';
  const invId = '17';
  setEnvironmentVariable(t, 'ROBO_PASSWORD2', secret);

  const order = {
    id: 17,
    documentId: 'owned-order',
    order_status: 'pending',
    package_type: 'one-time',
    start_date: null,
    end_date: null,
    users_permissions_user: { id: 42 },
    game: { id: 23 },
  };
  let orderLookup;
  let orderUpdate;
  let paymentEvent;
  let purchaseCreate;
  const controller = createOrderController({
    db: {
      query(uid) {
        if (uid === 'api::order.order') {
          return {
            async findOne(options) {
              orderLookup = options;
              return order;
            },
            async update(options) {
              orderUpdate = options;
              return { ...order, order_status: 'paid' };
            },
          };
        }

        if (uid === 'api::payment-event.payment-event') {
          return {
            async create(options) {
              paymentEvent = options;
              return { id: 91 };
            },
          };
        }

        assert.equal(uid, 'api::purchase.purchase');
        return {
          async findOne(options) {
            assert.deepEqual(options, { where: { order: 17 } });
            return null;
          },
        };
      },
    },
    service(uid) {
      assert.equal(uid, 'api::purchase.purchase');
      return {
        async create(options) {
          purchaseCreate = options;
          return { id: 92, documentId: 'purchase-document-id' };
        },
      };
    },
    log: {
      info() {},
      debug() {},
      error() {},
      warn() {},
    },
  });

  const result = await controller.handlePaymentResult({
    request: {
      url: '/api/robokassa/result',
      body: {
        OutSum: outSum,
        InvId: invId,
        SignatureValue: signPaymentResult(outSum, invId, secret),
      },
    },
    send(body, status = 200) {
      return { status, body };
    },
  });

  assert.deepEqual(orderLookup, {
    where: { id: 17 },
    populate: ['users_permissions_user', 'game'],
  });
  assert.deepEqual(orderUpdate, {
    where: { id: 17 },
    data: { order_status: 'paid' },
  });
  assert.equal(paymentEvent.data.order, 17);
  assert.deepEqual(purchaseCreate.data, {
    purchaseDate: purchaseCreate.data.purchaseDate,
    users_permissions_user: 42,
    game: 23,
    order: 17,
    package_type: 'one-time',
    start_date: null,
    end_date: null,
  });
  assert.ok(purchaseCreate.data.purchaseDate instanceof Date);
  assert.deepEqual(result, { status: 200, body: 'OK17' });
});

test('correctly signed callback for an already-paid order remains idempotent', async (t) => {
  const secret = 'callback-secret';
  const outSum = 1250;
  const invId = 17;
  setEnvironmentVariable(t, 'ROBO_PASSWORD2', secret);

  let updateCount = 0;
  let purchaseAccessCount = 0;
  let paymentEventCount = 0;
  const controller = createOrderController({
    db: {
      query(uid) {
        if (uid === 'api::order.order') {
          return {
            async findOne() {
              return {
                id: 17,
                order_status: 'paid',
                users_permissions_user: { id: 42 },
                game: { id: 23 },
              };
            },
            async update() {
              updateCount += 1;
            },
          };
        }

        if (uid === 'api::payment-event.payment-event') {
          return {
            async create() {
              paymentEventCount += 1;
            },
          };
        }

        purchaseAccessCount += 1;
        throw new Error('Idempotent callback must not access purchases');
      },
    },
    service() {
      purchaseAccessCount += 1;
      throw new Error('Idempotent callback must not create a purchase');
    },
    log: {
      info() {},
      error() {},
      warn() {},
    },
  });

  const result = await controller.handlePaymentResult({
    request: {
      url: '/api/robokassa/result',
      body: {
        OutSum: outSum,
        InvId: invId,
        SignatureValue: signPaymentResult(outSum, invId, secret).toUpperCase(),
      },
    },
    send(body, status = 200) {
      return { status, body };
    },
  });

  assert.deepEqual(result, { status: 200, body: 'OK17' });
  assert.equal(paymentEventCount, 1);
  assert.equal(updateCount, 0);
  assert.equal(purchaseAccessCount, 0);
});

test('order controller and custom routes expose no arbitrary status mutation', () => {
  const controller = createOrderController({});
  assert.equal(Object.hasOwn(controller, 'updateOrderStatus'), false);

  const routesDirectory = path.join(__dirname, '../src/api/order/routes');
  const customRoutes = fs
    .readdirSync(routesDirectory)
    .filter((fileName) => fileName !== 'order.js' && fileName.endsWith('.js'))
    .flatMap((fileName) => require(path.join(routesDirectory, fileName)).routes);

  assert.equal(
    customRoutes.some((route) => route.handler === 'order.updateOrderStatus'),
    false
  );
  assert.equal(
    customRoutes.some((route) => route.method === 'PUT' && route.path.includes('/status')),
    false
  );
  assert.deepEqual(
    customRoutes.map((route) => route.handler).sort(),
    [
      'order.createPaymentStub',
      'order.generatePaymentLink',
      'order.handlePaymentResult',
    ]
  );
});

test('core routers fail closed for order, purchase, and link records', () => {
  assert.deepEqual(loadCoreRouterDeclaration('../src/api/order/routes/order'), {
    uid: 'api::order.order',
    options: { only: ['create'] },
  });
  assert.deepEqual(loadCoreRouterDeclaration('../src/api/purchase/routes/02-core-purchase'), {
    uid: 'api::purchase.purchase',
    options: { only: [] },
  });
  assert.deepEqual(loadCoreRouterDeclaration('../src/api/link/routes/link'), {
    uid: 'api::link.link',
    options: { only: [] },
  });
});

test('owned purchase and link flows retain only their explicit custom routes', () => {
  const purchaseRoutes = require('../src/api/purchase/routes/01-custom-purchase').routes;
  const linkRoutes = require('../src/api/link/routes/01-custom-link').routes;

  assert.deepEqual(
    purchaseRoutes.map(({ method, path: routePath, handler }) => ({
      method,
      path: routePath,
      handler,
    })),
    [
      {
        method: 'GET',
        path: '/purchases',
        handler: 'purchase.findUserPurchases',
      },
    ]
  );
  assert.deepEqual(
    linkRoutes.map(({ method, path: routePath, handler }) => ({
      method,
      path: routePath,
      handler,
    })),
    [
      {
        method: 'POST',
        path: '/links/generate',
        handler: 'link.generate',
      },
    ]
  );
});

test('additional test CORS origin is denied by default and allowed only from the environment', (t) => {
  const previousValue = process.env.PORTAL_TEST_CORS_ORIGIN;
  t.after(() => {
    if (previousValue === undefined) {
      delete process.env.PORTAL_TEST_CORS_ORIGIN;
    } else {
      process.env.PORTAL_TEST_CORS_ORIGIN = previousValue;
    }
  });

  const testOrigin = 'http://test-host.example:12345';
  const cors = require('../config/middlewares').find(
    (middleware) => middleware?.name === 'strapi::cors'
  );
  const ctx = { request: { header: { origin: testOrigin } } };

  delete process.env.PORTAL_TEST_CORS_ORIGIN;
  assert.equal(cors.config.origin(ctx), 'null');

  process.env.PORTAL_TEST_CORS_ORIGIN = testOrigin;
  assert.equal(cors.config.origin(ctx), testOrigin);
});
