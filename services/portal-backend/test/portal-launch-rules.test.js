'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildLaunchWindow,
  getMoscowDayBounds,
  getSessionStatus,
} = require('../src/utils/portal-launch-rules');

test('getMoscowDayBounds returns UTC bounds for a Moscow calendar day', () => {
  const bounds = getMoscowDayBounds('2026-05-19');

  assert.equal(bounds.start.toISOString(), '2026-05-18T21:00:00.000Z');
  assert.equal(bounds.end.toISOString(), '2026-05-19T20:59:59.999Z');
});

test('day launch window is active inside the Moscow day', () => {
  const result = buildLaunchWindow({
    packageType: 'day',
    startDate: '2026-05-19',
    now: new Date('2026-05-19T10:00:00.000Z'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'active');
  assert.equal(result.startsAt.toISOString(), '2026-05-18T21:00:00.000Z');
  assert.equal(result.expiresAt.toISOString(), '2026-05-19T20:59:59.999Z');
});

test('day launch window is pending before the Moscow day starts', () => {
  const result = buildLaunchWindow({
    packageType: 'day',
    startDate: '2026-05-19',
    now: new Date('2026-05-18T20:59:59.000Z'),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'pending');
});

test('month launch window is capped to 48 hours', () => {
  const result = buildLaunchWindow({
    packageType: 'month',
    startDate: '2026-05-01',
    endDate: '2026-05-31',
    now: new Date('2026-05-19T06:00:00.000Z'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.expiresAt.toISOString(), '2026-05-21T06:00:00.000Z');
});

test('month launch window never extends beyond subscription end', () => {
  const result = buildLaunchWindow({
    packageType: 'month',
    startDate: '2026-05-01',
    endDate: '2026-05-20',
    now: new Date('2026-05-19T20:00:00.000Z'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.expiresAt.toISOString(), '2026-05-20T20:59:59.999Z');
});

test('closed and expired sessions are not resolvable', () => {
  assert.deepEqual(
    getSessionStatus({ status: 'completed' }, new Date('2026-05-19T10:00:00.000Z')),
    {
      ok: false,
      status: 'completed',
      reason: 'Launch session is closed',
    }
  );

  const expired = getSessionStatus(
    {
      status: 'active',
      expires_at: '2026-05-19T09:59:59.000Z',
    },
    new Date('2026-05-19T10:00:00.000Z')
  );

  assert.equal(expired.ok, false);
  assert.equal(expired.status, 'expired');
});
