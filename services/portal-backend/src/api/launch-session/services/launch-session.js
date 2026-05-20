'use strict';

/**
 * Launch-session service.
 *
 * This service owns portal launch behavior: copying a launch URL, resolving it
 * to a runtime session placeholder, and listing active launch sessions. It does
 * not know about Antarctica rules; game identity is treated as relational data.
 */

const { createHash, randomUUID } = require('crypto');
const { createCoreService } = require('@strapi/strapi').factories;
const {
  buildLaunchWindow,
  getRuntimeBindingType,
  getSessionStatus,
} = require('../../../utils/portal-launch-rules');

const LAUNCH_SESSION_UID = 'api::launch-session.launch-session';
const RUNTIME_SESSION_BINDING_UID = 'api::runtime-session-binding.runtime-session-binding';
const SESSION_EVENT_UID = 'api::session-launch-event.session-launch-event';
const PURCHASE_UID = 'api::purchase.purchase';
const LINK_UID = 'api::link.link';

function cleanBaseUrl(value, fallback) {
  return (value || fallback).replace(/\/+$/, '');
}

function portalBaseUrl() {
  return cleanBaseUrl(process.env.PORTAL_PUBLIC_URL, 'http://localhost:3000');
}

function buildPortalUrl(token, counter) {
  return `${portalBaseUrl()}/launch/${token}::${counter}`;
}

function runtimeGameId(session) {
  return session.game?.slug || session.game?.documentId || session.game?.id;
}

function runtimeUrls(session) {
  const playerBase = cleanBaseUrl(process.env.PLAYER_PUBLIC_URL, `${portalBaseUrl()}/player`);
  const journalBase = cleanBaseUrl(process.env.JOURNAL_PUBLIC_URL, `${portalBaseUrl()}/journal`);
  const gameId = runtimeGameId(session);
  const suffix = `launchToken=${encodeURIComponent(session.token)}&launchCounter=${encodeURIComponent(session.counter)}`;
  const gameQuery = gameId ? `&gameId=${encodeURIComponent(gameId)}` : '';

  return {
    playerUrl: `${playerBase}?${suffix}${gameQuery}`,
    adminUrl: `${portalBaseUrl()}/launch/${session.token}::${session.counter}/admin`,
    journalUrl: `${journalBase}?${suffix}${gameQuery}`,
  };
}

function relationId(entity) {
  return entity?.id || null;
}

function connectRelation(entity) {
  const id = relationId(entity);
  return id ? { connect: [{ id }] } : undefined;
}

function numericId(value) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number(value);
  }

  return null;
}

function pickPackageType({ link, purchase }) {
  return link?.type || purchase?.package_type;
}

function pickStartDate({ link, purchase }) {
  return link?.start_date || purchase?.start_date || null;
}

function pickEndDate({ link, purchase }) {
  return link?.end_date || purchase?.end_date || null;
}

function publicSession(session) {
  const urls = runtimeUrls(session);

  return {
    id: session.documentId || session.id,
    token: session.token,
    counter: session.counter,
    status: session.status,
    packageType: session.package_type,
    startsAt: session.starts_at,
    expiresAt: session.expires_at,
    runtimeSessionId: session.runtime_session_id || null,
    launchCount: session.launch_count || 0,
    portalUrl: session.portal_url || buildPortalUrl(session.token, session.counter),
    ...urls,
  };
}

function runtimeBaseUrl() {
  return cleanBaseUrl(process.env.RUNTIME_API_URL, 'http://localhost:3001');
}

function hashDeviceToken(deviceToken) {
  if (!deviceToken) {
    return null;
  }

  return createHash('sha256').update(String(deviceToken)).digest('hex');
}

function runtimeBindingKey({ session, bindingType, deviceTokenHash }) {
  const devicePart = bindingType === 'device' ? deviceTokenHash : 'shared';
  return `${session.id}:${bindingType}:${devicePart}`;
}

function isUniqueConstraintError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('unique') || message.includes('duplicate');
}

async function readRuntimeJson(response) {
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message = payload?.error || payload?.message || `Runtime API request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function createRuntimeSession({ gameId, playerId }) {
  const response = await fetch(`${runtimeBaseUrl()}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, playerId }),
  });

  return readRuntimeJson(response);
}

async function resumeRuntimeSession(runtimeSessionId) {
  const response = await fetch(`${runtimeBaseUrl()}/sessions/${encodeURIComponent(runtimeSessionId)}`);
  return readRuntimeJson(response);
}

module.exports = createCoreService(LAUNCH_SESSION_UID, ({ strapi }) => ({
  async findOwnedPurchase({ purchaseId, userId }) {
    const baseWhere = {
      users_permissions_user: { id: userId },
      archived: { $in: [false, null] },
    };
    const id = numericId(purchaseId);
    const identityWhere = id ? { id } : { documentId: purchaseId };

    return strapi.db.query(PURCHASE_UID).findOne({
      where: { ...baseWhere, ...identityWhere },
      populate: {
        game: true,
        users_permissions_user: true,
      },
    });
  },

  async findOwnedLink({ linkId, userId }) {
    const id = numericId(linkId);
    const identityWhere = id ? { id } : { documentId: linkId };

    return strapi.db.query(LINK_UID).findOne({
      where: {
        ...identityWhere,
        users_permissions_user: { id: userId },
        expired: { $in: [false, null] },
      },
      populate: {
        game: true,
        purchase: {
          populate: {
            game: true,
            users_permissions_user: true,
          },
        },
        users_permissions_user: true,
      },
    });
  },

  async recordEvent({ eventType, session, purchase, link, game, user, message, metadata }) {
    try {
      await strapi.db.query(SESSION_EVENT_UID).create({
        data: {
          event_type: eventType,
          occurred_at: new Date(),
          message,
          metadata: metadata || {},
          launch_session: connectRelation(session),
          purchase: connectRelation(purchase),
          link: connectRelation(link),
          game: connectRelation(game),
          users_permissions_user: connectRelation(user),
        },
      });
    } catch (error) {
      strapi.log.warn(`[launch-session] Failed to record ${eventType} event: ${error.message}`);
    }
  },

  async nextCounter(purchase) {
    const lastSession = await strapi.db.query(LAUNCH_SESSION_UID).findMany({
      where: {
        purchase: { id: purchase.id },
      },
      orderBy: { counter: 'desc' },
      limit: 1,
    });

    return (lastSession[0]?.counter || 0) + 1;
  },

  async findOneTimeSession(purchase) {
    return strapi.db.query(LAUNCH_SESSION_UID).findOne({
      where: {
        purchase: { id: purchase.id },
        package_type: 'one-time',
      },
      orderBy: { counter: 'asc' },
      populate: {
        purchase: true,
        link: true,
        game: true,
        users_permissions_user: true,
      },
    });
  },

  async findSessionByTokenCounter({ token, counter }) {
    const numericCounter = numericId(counter);

    if (!numericCounter) {
      return null;
    }

    return strapi.db.query(LAUNCH_SESSION_UID).findOne({
      where: {
        token,
        counter: numericCounter,
      },
      populate: {
        purchase: true,
        link: true,
        game: true,
        users_permissions_user: true,
      },
    });
  },

  async createLaunchSession({ packageType, window, purchase, link, game, user, sourceType }) {
    const token = randomUUID();
    const counter = await this.nextCounter(purchase);
    const portalUrl = buildPortalUrl(token, counter);

    return strapi.db.query(LAUNCH_SESSION_UID).create({
      data: {
        token,
        counter,
        status: 'active',
        package_type: packageType,
        starts_at: window.startsAt,
        expires_at: window.expiresAt,
        launch_count: 0,
        source_type: sourceType,
        portal_url: portalUrl,
        purchase: connectRelation(purchase),
        link: connectRelation(link),
        game: connectRelation(game),
        users_permissions_user: connectRelation(user),
      },
      populate: {
        purchase: true,
        link: true,
        game: true,
        users_permissions_user: true,
      },
    });
  },

  async resolveSource({ user, purchaseId, linkId }) {
    if (purchaseId) {
      const purchase = await this.findOwnedPurchase({ purchaseId, userId: user.id });

      if (!purchase) {
        return { ok: false, httpStatus: 404, reason: 'Purchase not found' };
      }

      return {
        ok: true,
        purchase,
        link: null,
        game: purchase.game,
        packageType: pickPackageType({ purchase }),
        startDate: pickStartDate({ purchase }),
        endDate: pickEndDate({ purchase }),
        sourceType: 'purchase',
      };
    }

    const link = await this.findOwnedLink({ linkId, userId: user.id });

    if (!link) {
      return { ok: false, httpStatus: 404, reason: 'Link not found' };
    }

    const purchase = link.purchase;

    if (!purchase) {
      return { ok: false, httpStatus: 409, reason: 'Link is not connected to a purchase' };
    }

    return {
      ok: true,
      purchase,
      link,
      game: link.game || purchase.game,
      packageType: pickPackageType({ link, purchase }),
      startDate: pickStartDate({ link, purchase }),
      endDate: pickEndDate({ link, purchase }),
      sourceType: 'link',
    };
  },

  async copyLink({ user, purchaseId, linkId }) {
    const source = await this.resolveSource({ user, purchaseId, linkId });

    if (!source.ok) {
      return source;
    }

    const window = buildLaunchWindow({
      packageType: source.packageType,
      startDate: source.startDate,
      endDate: source.endDate,
    });

    if (!window.ok) {
      await this.recordEvent({
        eventType: 'rejected',
        purchase: source.purchase,
        link: source.link,
        game: source.game,
        user,
        message: window.reason,
        metadata: { status: window.status },
      });

      return {
        ok: false,
        httpStatus: window.status === 'pending' ? 409 : 400,
        status: window.status,
        reason: window.reason,
      };
    }

    let session = null;
    let reused = false;

    if (source.packageType === 'one-time') {
      session = await this.findOneTimeSession(source.purchase);
      reused = Boolean(session);
    }

    if (!session) {
      session = await this.createLaunchSession({
        packageType: source.packageType,
        window,
        purchase: source.purchase,
        link: source.link,
        game: source.game,
        user,
        sourceType: source.sourceType,
      });
    }

    await this.recordEvent({
      eventType: 'copy-link',
      session,
      purchase: source.purchase,
      link: source.link,
      game: source.game,
      user,
      message: reused ? 'Reused one-time launch session' : 'Created launch session from copied link',
      metadata: { reused },
    });

    return {
      ok: true,
      status: session.status,
      reused,
      url: session.portal_url || buildPortalUrl(session.token, session.counter),
      launchSession: publicSession(session),
    };
  },

  async resolve({ token, counter }) {
    const numericCounter = numericId(counter);

    if (!numericCounter) {
      return { ok: false, httpStatus: 400, status: 'rejected', reason: 'Invalid counter' };
    }

    const session = await this.findSessionByTokenCounter({ token, counter: numericCounter });

    if (!session) {
      return { ok: false, httpStatus: 404, status: 'missing', reason: 'Launch session not found' };
    }

    const status = getSessionStatus(session);

    await this.recordEvent({
      eventType: status.ok ? 'resolve' : 'rejected',
      session,
      purchase: session.purchase,
      link: session.link,
      game: session.game,
      user: session.users_permissions_user,
      message: status.reason,
      metadata: { status: status.status },
    });

    if (!status.ok) {
      return {
        ok: false,
        httpStatus: status.status === 'expired' ? 410 : 409,
        status: status.status,
        reason: status.reason,
        runtimeSessionId: session.runtime_session_id || null,
      };
    }

    return {
      ok: true,
      status: 'active',
      ...publicSession(session),
    };
  },

  async findBinding({ session, bindingType, deviceTokenHash }) {
    const bindingKey = runtimeBindingKey({ session, bindingType, deviceTokenHash });
    const where = {
      launch_session: { id: session.id },
      binding_type: bindingType,
      status: 'active',
    };

    if (bindingType === 'device') {
      where.device_token_hash = deviceTokenHash;
    }

    const currentBinding = await strapi.db.query(RUNTIME_SESSION_BINDING_UID).findOne({
      where: {
        binding_key: bindingKey,
        status: 'active',
      },
      populate: {
        launch_session: true,
        purchase: true,
        game: true,
        users_permissions_user: true,
      },
    });

    if (currentBinding) {
      return currentBinding;
    }

    return strapi.db.query(RUNTIME_SESSION_BINDING_UID).findOne({
      where,
      populate: {
        launch_session: true,
        purchase: true,
        game: true,
        users_permissions_user: true,
      },
    });
  },

  async runtimeSnapshotOrNull(runtimeSessionId) {
    if (!runtimeSessionId) {
      return null;
    }

    try {
      return await resumeRuntimeSession(runtimeSessionId);
    } catch (error) {
      if (error.status === 404) {
        return null;
      }

      throw error;
    }
  },

  async createRuntimeBinding({ session, bindingType, deviceTokenHash, playerId }) {
    const gameId = runtimeGameId(session);

    if (!gameId) {
      return { ok: false, httpStatus: 409, status: 'rejected', reason: 'Launch session is not connected to a game' };
    }

    const runtimeSession = await createRuntimeSession({
      gameId,
      playerId: playerId || `portal-${session.id}`,
    });
    const urls = runtimeUrls(session);
    const binding = await strapi.db.query(RUNTIME_SESSION_BINDING_UID).create({
      data: {
        binding_key: runtimeBindingKey({ session, bindingType, deviceTokenHash }),
        binding_type: bindingType,
        device_token_hash: deviceTokenHash,
        runtime_session_id: runtimeSession.sessionId,
        status: 'active',
        last_seen_at: new Date(),
        launch_session: connectRelation(session),
        purchase: connectRelation(session.purchase),
        game: connectRelation(session.game),
        users_permissions_user: connectRelation(session.users_permissions_user),
      },
      populate: {
        launch_session: true,
        purchase: true,
        game: true,
        users_permissions_user: true,
      },
    });

    const launchSessionPatch = {
      player_url: urls.playerUrl,
      admin_url: urls.adminUrl,
      journal_url: urls.journalUrl,
    };

    if (bindingType === 'shared') {
      launchSessionPatch.runtime_session_id = runtimeSession.sessionId;
      launchSessionPatch.runtime_created_at = new Date();
    }

    await strapi.db.connection('launch_sessions')
      .where({ id: session.id })
      .update({
        ...launchSessionPatch,
        launch_count: strapi.db.connection.raw('COALESCE(launch_count, 0) + 1'),
      });

    return { binding, runtimeSession, created: true };
  },

  async updateBindingRuntime({ binding, runtimeSession, session }) {
    const updated = await strapi.db.query(RUNTIME_SESSION_BINDING_UID).update({
      where: { id: binding.id },
      data: {
        runtime_session_id: runtimeSession.sessionId,
        last_seen_at: new Date(),
      },
      populate: {
        launch_session: true,
        purchase: true,
        game: true,
        users_permissions_user: true,
      },
    });

    await strapi.db.connection('launch_sessions')
      .where({ id: session.id })
      .update({
        launch_count: strapi.db.connection.raw('COALESCE(launch_count, 0) + 1'),
        ...(binding.binding_type === 'shared'
          ? {
            runtime_session_id: runtimeSession.sessionId,
            runtime_created_at: new Date(),
          }
          : {}),
      });

    return updated;
  },

  async bindRuntime({ token, counter, deviceToken, playerId }) {
    const session = await this.findSessionByTokenCounter({ token, counter });

    if (!session) {
      return { ok: false, httpStatus: 404, status: 'missing', reason: 'Launch session not found' };
    }

    const status = getSessionStatus(session);

    if (!status.ok) {
      await this.recordEvent({
        eventType: 'rejected',
        session,
        purchase: session.purchase,
        link: session.link,
        game: session.game,
        user: session.users_permissions_user,
        message: status.reason,
        metadata: { status: status.status, phase: 'runtime-binding' },
      });

      return {
        ok: false,
        httpStatus: status.status === 'expired' ? 410 : 409,
        status: status.status,
        reason: status.reason,
      };
    }

    const bindingType = getRuntimeBindingType({
      packageType: session.package_type,
      gameType: session.game?.game_type,
    });
    const deviceTokenHash = bindingType === 'device' ? hashDeviceToken(deviceToken) : null;

    if (bindingType === 'device' && !deviceTokenHash) {
      return { ok: false, httpStatus: 400, status: 'rejected', reason: 'Device token is required for this launch session' };
    }

    let binding = await this.findBinding({ session, bindingType, deviceTokenHash });

    if (binding) {
      const resumed = await this.runtimeSnapshotOrNull(binding.runtime_session_id);

      if (resumed) {
        await strapi.db.query(RUNTIME_SESSION_BINDING_UID).update({
          where: { id: binding.id },
          data: { last_seen_at: new Date() },
        });
        await this.recordEvent({
          eventType: 'binding-resumed',
          session,
          purchase: session.purchase,
          link: session.link,
          game: session.game,
          user: session.users_permissions_user,
          message: 'Resumed runtime session binding',
          metadata: { bindingType, runtimeSessionId: binding.runtime_session_id },
        });

        return {
          ok: true,
          status: 'active',
          bindingType,
          runtimeSessionId: binding.runtime_session_id,
          runtimeSession: resumed,
          launchSession: publicSession(session),
        };
      }

      const gameId = runtimeGameId(session);

      if (!gameId) {
        return { ok: false, httpStatus: 409, status: 'rejected', reason: 'Launch session is not connected to a game' };
      }

      const runtimeSession = await createRuntimeSession({
        gameId,
        playerId: playerId || `portal-${session.id}`,
      });
      binding = await this.updateBindingRuntime({ binding, runtimeSession, session });

      await this.recordEvent({
        eventType: 'runtime-created',
        session,
        purchase: session.purchase,
        link: session.link,
        game: session.game,
        user: session.users_permissions_user,
        message: 'Recreated stale runtime session binding',
        metadata: { bindingType, runtimeSessionId: runtimeSession.sessionId },
      });

      return {
        ok: true,
        status: 'active',
        bindingType,
        runtimeSessionId: runtimeSession.sessionId,
        runtimeSession,
        launchSession: publicSession(session),
      };
    }

    let created;

    try {
      created = await this.createRuntimeBinding({
        session,
        bindingType,
        deviceTokenHash,
        playerId,
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      binding = await this.findBinding({ session, bindingType, deviceTokenHash });

      if (!binding) {
        throw error;
      }

      const resumed = await this.runtimeSnapshotOrNull(binding.runtime_session_id);

      if (resumed) {
        return {
          ok: true,
          status: 'active',
          bindingType,
          runtimeSessionId: binding.runtime_session_id,
          runtimeSession: resumed,
          launchSession: publicSession(session),
        };
      }

      throw error;
    }

    if (!created.ok && created.ok === false) {
      return created;
    }

    await this.recordEvent({
      eventType: 'binding-created',
      session,
      purchase: session.purchase,
      link: session.link,
      game: session.game,
      user: session.users_permissions_user,
      message: 'Created runtime session binding',
      metadata: { bindingType, runtimeSessionId: created.runtimeSession.sessionId },
    });

    return {
      ok: true,
      status: 'active',
      bindingType,
      runtimeSessionId: created.runtimeSession.sessionId,
      runtimeSession: created.runtimeSession,
      launchSession: publicSession(session),
    };
  },

  async active({ user, purchaseId, linkId }) {
    const where = {
      users_permissions_user: { id: user.id },
      status: 'active',
    };

    if (purchaseId) {
      const id = numericId(purchaseId);
      where.purchase = id ? { id } : { documentId: purchaseId };
    }

    if (linkId) {
      const id = numericId(linkId);
      where.link = id ? { id } : { documentId: linkId };
    }

    const sessions = await strapi.db.query(LAUNCH_SESSION_UID).findMany({
      where,
      orderBy: { createdAt: 'desc' },
      populate: {
        purchase: true,
        link: true,
        game: true,
      },
    });

    const activeSessions = sessions.filter((session) => getSessionStatus(session).ok);

    return {
      ok: true,
      sessions: activeSessions.map(publicSession),
    };
  },
}));
