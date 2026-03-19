'use strict';

const { randomUUID } = require('crypto');
const GAMESERVER_URL = process.env.GAMESERVER_URL || 'https://cubica.gameserver.dev/play';

const { createCoreController } = require('@strapi/strapi').factories;


/* --- Small UTC helpers (no deps) --- */
function startOfDayUTC(dateInput) {
  const d = new Date(dateInput);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}
function endOfDayUTC(dateInput) {
  const d = new Date(dateInput);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}
function addHours(dateInput, hours) {
  return new Date(new Date(dateInput).getTime() + hours * 60 * 60 * 1000);
}


module.exports = createCoreController('api::link.link', ({ strapi }) => ({
  async generate(ctx) {
    const user = ctx.state.user;
    const { purchaseId } = ctx.request.body;

    if (!user || !purchaseId) {
      return ctx.badRequest("Missing user or purchase ID");
    }


    
    // Find the purchase by documentId
    /* UNSAFE!!! Any user who knows a purchaseId could fetch someone elses purchase
    const purchase = await strapi.db.query('api::purchase.purchase').findOne({
      where: { documentId: purchaseId },
      populate: { links: true, game: { select: ['id'] } },
      users_permissions_user: { connect: [{ id: user.id }] }, 
    });
    

    if (!purchase) {
      return ctx.notFound("Purchase not found");
    } */
   // Secure lookup: purchase must belong to the current user
   const purchase = await strapi.db.query('api::purchase.purchase').findOne({
  where: {
    documentId: purchaseId,
    users_permissions_user: { id: user.id }, 
  },
  populate: { links: true, game: { select: ['id'] } },
});
if (!purchase) return ctx.notFound('Purchase not found');


      const type = purchase.package_type;
    const now = new Date(); // single source of truth

    // Reuse one-time link if already exists
    if (type === 'one-time') {
      const existing = purchase.links?.find((link) => link.type === 'one-time');
      if (existing) {
        return { url: existing.url, linkId: existing.documentId };
      }
    }

    let linkStartDate = null;
    let linkEndDate = null;

    if (type === 'day') {
      // Require a start_date for day package
      if (!purchase.start_date) {
        return ctx.badRequest('Для дневного пакета требуется дата начала.');
      }

      const startDateUTC = startOfDayUTC(purchase.start_date);
      const endDateUTC = endOfDayUTC(purchase.start_date);

      if (now < startDateUTC) {
        return ctx.badRequest('Ссылка ещё не активна.');
      }
      if (now > endDateUTC) {
        return ctx.badRequest('Ссылка устарела.');
      }

      linkStartDate = startDateUTC;
      linkEndDate = endDateUTC;
    }

    else if (type === 'month') {
      // Optional subscription bounds respected if present
      const subscriptionStart = purchase.start_date ? startOfDayUTC(purchase.start_date) : null;
      const subscriptionEnd = purchase.end_date ? endOfDayUTC(purchase.end_date) : null;

      if (subscriptionStart && now < subscriptionStart) {
        return ctx.badRequest(
          'Подписка ещё не началась. Ссылка для месячной подписки создаётся не раньше старта.'
        );
      }
      if (subscriptionEnd && now > subscriptionEnd) {
        return ctx.badRequest('Срок действия покупки истёк.');
      }

      // Link is valid for 48 hours from "now", but never beyond subscription end (if any)
      const proposedEnd = addHours(now, 48);
      const cappedEnd =
        subscriptionEnd && proposedEnd.getTime() > subscriptionEnd.getTime()
          ? subscriptionEnd
          : proposedEnd;

      linkStartDate = now;
      linkEndDate = cappedEnd;
    }

    // one-time: no start/end date applied

    // 1) Fetch latest label for this purchase
    const lastLink = await strapi.db.query('api::link.link').findMany({
      where: { purchase: purchase.id },
      orderBy: { label: 'desc' },
      limit: 1,
    });
    const lastLabel = lastLink[0]?.label || 0;
    const label = lastLabel + 1;

    // 2) Generate token and URL
    const token = randomUUID();
    const url = `${GAMESERVER_URL}/${token}?label=${label}`;

    // 3) Create new link
    const newLink = await strapi.db.query('api::link.link').create({
      data: {
        token,
        type,
        url,
        label,
        start_date: linkStartDate,
        end_date: linkEndDate,
        purchase: { connect: [{ id: purchase.id }] },
        game: { connect: [{ id: purchase.game.id }] },
        users_permissions_user: { connect: [{ id: user.id }] },
      },
    });

    return {
      url: newLink.url,
      linkId: newLink.documentId,
    };
  },
}));
