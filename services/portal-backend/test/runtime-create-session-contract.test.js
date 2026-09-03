'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const createSessionRequestValidatorUrl = pathToFileURL(path.join(
  __dirname,
  '../../../packages/contracts/session/src/createSessionRequestValidation.ts'
)).href;

function createLaunchSessionService(strapi) {
  const modulePath = '../src/api/launch-session/services/launch-session';
  const resolvedPath = require.resolve(modulePath);
  const originalLoad = Module._load;

  delete require.cache[resolvedPath];
  Module._load = function load(request, parent, isMain) {
    if (request === '@strapi/strapi') {
      return {
        factories: {
          createCoreService(uid, extendService) {
            return { uid, extendService };
          },
        },
      };
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const definition = require(resolvedPath);
    assert.equal(definition.uid, 'api::launch-session.launch-session');
    return definition.extendService({ strapi });
  } finally {
    Module._load = originalLoad;
    delete require.cache[resolvedPath];
  }
}

test('first Portal launch sends the exact Runtime CreateSessionRequest', async (t) => {
  const {
    getCreateSessionRequestValidationErrors,
    validateCreateSessionRequestShape,
  } = await import(createSessionRequestValidatorUrl);
  const previousRuntimeApiUrl = process.env.RUNTIME_API_URL;
  const originalFetch = global.fetch;
  const requests = [];
  const bindingCreates = [];
  const launchUpdates = [];

  process.env.RUNTIME_API_URL = 'https://runtime.example.test/';
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, options, body });

    assert.equal(
      validateCreateSessionRequestShape(body),
      true,
      JSON.stringify(getCreateSessionRequestValidationErrors())
    );
    return new Response(JSON.stringify({ sessionId: 'runtime-session-1' }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  t.after(() => {
    global.fetch = originalFetch;
    if (previousRuntimeApiUrl === undefined) {
      delete process.env.RUNTIME_API_URL;
    } else {
      process.env.RUNTIME_API_URL = previousRuntimeApiUrl;
    }
  });

  const connection = (table) => {
    assert.equal(table, 'launch_sessions');
    return {
      where(where) {
        assert.deepEqual(where, { id: 42 });
        return {
          async update(patch) {
            launchUpdates.push(patch);
          },
        };
      },
    };
  };
  connection.raw = (expression) => ({ raw: expression });

  const service = createLaunchSessionService({
    db: {
      connection,
      query(uid) {
        assert.equal(uid, 'api::runtime-session-binding.runtime-session-binding');
        return {
          async create(input) {
            bindingCreates.push(input);
            return { id: 7, ...input.data };
          },
        };
      },
    },
  });
  const session = {
    id: 42,
    token: 'launch-token',
    counter: 1,
    status: 'active',
    package_type: 'one-time',
    game: { id: 5, slug: 'neutral-game' },
    purchase: { id: 9 },
    users_permissions_user: { id: 11 },
  };
  service.findSessionByTokenCounter = async () => session;
  service.findBinding = async () => null;
  service.recordEvent = async () => {};

  const result = await service.bindRuntime({
    token: session.token,
    counter: session.counter,
    playerId: 'untrusted-request-player',
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://runtime.example.test/sessions');
  assert.equal(requests[0].options.method, 'POST');
  assert.deepEqual(requests[0].options.headers, { 'Content-Type': 'application/json' });
  assert.deepEqual(requests[0].body, { gameId: 'neutral-game' });
  assert.equal(validateCreateSessionRequestShape({
    ...requests[0].body,
    playerId: 'untrusted-request-player',
  }), false);
  assert.equal(
    getCreateSessionRequestValidationErrors().some((error) => error.keyword === 'additionalProperties'),
    true
  );
  assert.equal(bindingCreates.length, 1);
  assert.equal(launchUpdates.length, 1);
  assert.equal(result.ok, true);
  assert.equal(result.bindingType, 'shared');
  assert.equal(result.runtimeSession.sessionId, 'runtime-session-1');
});
