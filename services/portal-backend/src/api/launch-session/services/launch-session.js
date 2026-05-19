'use strict';

/**
 * Launch-session service.
 *
 * This service owns portal launch behavior: copying a launch URL, resolving it
 * to a runtime session placeholder, and listing active launch sessions. It does
 * not know about Antarctica rules; game identity is treated as relational data.
 */

const { randomUUID } = require('crypto');
const { createCoreService } = require('@strapi/strapi').factories;
const {
  buildLaunchWindow,
  getSessionStatus,
} = require('../../../utils/portal-launch-rules');

const LAUNCH_SESSION_UID = 'api::launch-session.launch-session';
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
  return `${portalBaseUrl()}/launch/${token}/${counter}`;
}

function runtimeUrls(runtimeSessionId, session) {
  const playerBase = cleanBaseUrl(process.env.PLAYER_PUBLIC_URL, `${portalBaseUrl()}/player`);
  const adminBase = cleanBaseUrl(process.env.ADMIN_PUBLIC_URL, `${portalBaseUrl()}/admin`);
  const journalBase = cleanBaseUrl(process.env.JOURNAL_PUBLIC_URL, `${portalBaseUrl()}/journal`);
  const gameId = session.game?.documentId || session.game?.slug || session.game?.id;
  const suffix = `runtimeSessionId=${encodeURIComponent(runtimeSessionId)}`;
  const gameQuery = gameId ? `&gameId=${encodeURIComponent(gameId)}` : '';

  return {
    playerUrl: `${playerBase}?${suffix}${gameQuery}`,
    adminUrl: `${adminBase}?${suffix}${gameQuery}`,
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
  const urls = session.runtime_session_id ? runtimeUrls(session.runtime_session_id, session) : {};

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

    let session = await strapi.db.query(LAUNCH_SESSION_UID).findOne({
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

    if (!session.runtime_session_id) {
      const runtimeSessionId = randomUUID();
      const urls = runtimeUrls(runtimeSessionId, session);

      session = await strapi.db.query(LAUNCH_SESSION_UID).update({
        where: { id: session.id },
        data: {
          runtime_session_id: runtimeSessionId,
          runtime_created_at: new Date(),
          launch_count: (session.launch_count || 0) + 1,
          player_url: urls.playerUrl,
          admin_url: urls.adminUrl,
          journal_url: urls.journalUrl,
        },
        populate: {
          purchase: true,
          link: true,
          game: true,
          users_permissions_user: true,
        },
      });

      await this.recordEvent({
        eventType: 'runtime-created',
        session,
        purchase: session.purchase,
        link: session.link,
        game: session.game,
        user: session.users_permissions_user,
        message: 'Created runtime session placeholder',
        metadata: { runtimeSessionId },
      });
    }

    return {
      ok: true,
      status: 'active',
      ...publicSession(session),
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
