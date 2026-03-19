// ./config/cron-tasks.js
module.exports = {
    archivePurchases: {
      task: async ({ strapi }) => {
        const now = new Date();
        strapi.log.info(`[Cron] Checking for expired month purchases at ${now.toISOString()}`);
  
        const purchasesToArchive = await strapi.db.query('api::purchase.purchase').findMany({
          where: {
            package_type:  { $in: ['day', 'month'] },
            end_date: { $lt: now },
            archived: { $in: [false, null] },
          },
        });
        
  
        strapi.log.info(`[Cron] Found ${purchasesToArchive.length} expired month and day purchases`);
  
        for (const purchase of purchasesToArchive) {
          await strapi.db.query('api::purchase.purchase').update({
            where: { id: purchase.id },
            data: { archived: true },
          });
          strapi.log.info(`[Cron] expired purchase ID: ${purchase.id}`);
        }
      },
      options: {
        rule: "0 * * * * *", // every minute
      },
    },
  };
  