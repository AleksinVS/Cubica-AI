"use strict";

const { createCoreController } = require("@strapi/strapi").factories;
module.exports = createCoreController("api::purchase.purchase", ({ strapi }) => ({
    async findUserPurchases(ctx) {
        let user = ctx.state.user;

        if (!user || !user.id) {
            console.warn("Unauthorized access - No user found.");
            return ctx.forbidden("You must be logged in to view your purchases.");
        }

        const fullUser = await strapi.db.query("plugin::users-permissions.user").findOne({
            where: { id: user.id },  // Fetching by ID but retrieving documentId
            select: ["documentId", "id", "email"]
        });

        const documentId = fullUser?.document_id || fullUser?.documentId;

        if (!documentId) {
            console.warn(" User does not have a document_id.");
            return ctx.forbidden("User must have a valid document_id.");
        }

        const purchases = await strapi.db.query("api::purchase.purchase").findMany({
            where: {
                users_permissions_user: user.id
            },
            select: ["documentId", "purchaseDate", "package_type", "start_date", "end_date"],
            populate: {
                game: true,
                links: true
            }
        });

        return ctx.send({ purchases });
    },
}));
