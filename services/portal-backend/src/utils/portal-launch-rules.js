'use strict';

/**
 * Pure launch-session date and status rules for the portal backend.
 *
 * The helpers in this file intentionally do not import Strapi. They are used by
 * the custom Strapi service, but can also be tested with node:test without a
 * database. "Launch session" means a portal-owned start record that may later
 * create exactly one runtime game session.
 */

const MS_PER_HOUR = 60 * 60 * 1000;
const MOSCOW_UTC_OFFSET_HOURS = 3;
const MOSCOW_UTC_OFFSET_MS = MOSCOW_UTC_OFFSET_HOURS * MS_PER_HOUR;

const PACKAGE_TYPES = new Set(['one-time', 'day', 'month']);
const CLOSED_STATUSES = new Set(['completed', 'archived', 'revoked']);
const MULTIPLAYER_GAME_TYPES = new Set(['multiplayer', 'multi_player', 'team', 'командная']);

function asDate(value, fieldName = 'date') {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }

  return date;
}

function parseDateParts(dateInput, fieldName) {
  if (typeof dateInput === 'string') {
    const match = dateInput.match(/^(\d{4})-(\d{2})-(\d{2})/);

    if (match) {
      return {
        year: Number(match[1]),
        monthIndex: Number(match[2]) - 1,
        day: Number(match[3]),
      };
    }
  }

  const date = asDate(dateInput, fieldName);
  const moscowTimestamp = date.getTime() + MOSCOW_UTC_OFFSET_MS;
  const moscowDate = new Date(moscowTimestamp);

  return {
    year: moscowDate.getUTCFullYear(),
    monthIndex: moscowDate.getUTCMonth(),
    day: moscowDate.getUTCDate(),
  };
}

/**
 * Returns UTC timestamps for the calendar day in Moscow.
 *
 * Moscow currently has a fixed UTC+03:00 offset. The portal uses this helper so
 * "day" packages expire by the customer's business day, not by the server's
 * local timezone.
 */
function getMoscowDayBounds(dateInput) {
  if (!dateInput) {
    throw new Error('Moscow day bounds require a date');
  }

  const { year, monthIndex, day } = parseDateParts(dateInput, 'Moscow day');
  const start = new Date(Date.UTC(year, monthIndex, day, 0, 0, 0, 0) - MOSCOW_UTC_OFFSET_MS);
  const end = new Date(Date.UTC(year, monthIndex, day + 1, 0, 0, 0, 0) - MOSCOW_UTC_OFFSET_MS - 1);

  return { start, end };
}

function addHours(dateInput, hours) {
  return new Date(asDate(dateInput, 'date').getTime() + hours * MS_PER_HOUR);
}

function minDate(...values) {
  const dates = values.filter(Boolean).map((value) => asDate(value));

  if (dates.length === 0) {
    return null;
  }

  return dates.reduce((min, current) => (current.getTime() < min.getTime() ? current : min));
}

function formatRuleResult(ok, status, reason, extra = {}) {
  return { ok, status, reason, ...extra };
}

/**
 * Calculates the validity window for a launch session created from a purchase
 * or link. Month sessions are capped to 48 hours and never extend beyond the
 * subscription end date.
 */
function buildLaunchWindow({ packageType, startDate, endDate, now = new Date() }) {
  const current = asDate(now, 'now');

  if (!PACKAGE_TYPES.has(packageType)) {
    return formatRuleResult(false, 'rejected', 'Unsupported package type');
  }

  if (packageType === 'one-time') {
    return formatRuleResult(true, 'active', 'One-time launch session is reusable', {
      startsAt: current,
      expiresAt: null,
    });
  }

  if (packageType === 'day') {
    if (!startDate) {
      return formatRuleResult(false, 'rejected', 'Day package requires start_date');
    }

    const bounds = getMoscowDayBounds(startDate);

    if (current.getTime() < bounds.start.getTime()) {
      return formatRuleResult(false, 'pending', 'Day package has not started yet', {
        startsAt: bounds.start,
        expiresAt: bounds.end,
      });
    }

    if (current.getTime() > bounds.end.getTime()) {
      return formatRuleResult(false, 'expired', 'Day package has expired', {
        startsAt: bounds.start,
        expiresAt: bounds.end,
      });
    }

    return formatRuleResult(true, 'active', 'Day package is active in Moscow timezone', {
      startsAt: bounds.start,
      expiresAt: bounds.end,
    });
  }

  const subscriptionStart = startDate ? getMoscowDayBounds(startDate).start : null;
  const subscriptionEnd = endDate ? getMoscowDayBounds(endDate).end : null;

  if (subscriptionStart && current.getTime() < subscriptionStart.getTime()) {
    return formatRuleResult(false, 'pending', 'Month package has not started yet', {
      startsAt: subscriptionStart,
      expiresAt: subscriptionEnd,
    });
  }

  if (subscriptionEnd && current.getTime() > subscriptionEnd.getTime()) {
    return formatRuleResult(false, 'expired', 'Month package has expired', {
      startsAt: subscriptionStart,
      expiresAt: subscriptionEnd,
    });
  }

  return formatRuleResult(true, 'active', 'Month launch session is active for up to 48 hours', {
    startsAt: current,
    expiresAt: minDate(addHours(current, 48), subscriptionEnd),
  });
}

/**
 * Checks whether an existing launch session may resolve to a runtime session.
 */
function getSessionStatus(session, now = new Date()) {
  const current = asDate(now, 'now');
  const status = session?.status || 'active';

  if (!session) {
    return formatRuleResult(false, 'missing', 'Launch session was not found');
  }

  if (CLOSED_STATUSES.has(status)) {
    return formatRuleResult(false, status, 'Launch session is closed');
  }

  const startsAt = asDate(session.starts_at || session.startsAt, 'starts_at');
  const expiresAt = asDate(session.expires_at || session.expiresAt, 'expires_at');

  if (startsAt && current.getTime() < startsAt.getTime()) {
    return formatRuleResult(false, 'pending', 'Launch session has not started yet');
  }

  if (expiresAt && current.getTime() > expiresAt.getTime()) {
    return formatRuleResult(false, 'expired', 'Launch session has expired');
  }

  return formatRuleResult(true, status === 'created' ? 'active' : status, 'Launch session is active');
}

/**
 * Chooses how a portal launch session maps to runtime game state.
 *
 * "shared" means everyone opening the launch session gets the same runtime
 * session. "device" means each browser/device gets its own runtime session
 * inside the same launch session.
 */
function getRuntimeBindingType({ packageType, gameType }) {
  if (packageType === 'one-time') {
    return 'shared';
  }

  const normalizedGameType = String(gameType || '').toLowerCase();

  if (MULTIPLAYER_GAME_TYPES.has(normalizedGameType)) {
    return 'shared';
  }

  return 'device';
}

module.exports = {
  addHours,
  buildLaunchWindow,
  getMoscowDayBounds,
  getRuntimeBindingType,
  getSessionStatus,
  minDate,
};
