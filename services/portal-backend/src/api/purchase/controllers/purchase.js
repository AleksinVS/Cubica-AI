"use strict";

const { createCoreController } = require("@strapi/strapi").factories;
const jwt = require("jsonwebtoken");

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

/*
    async createPurchase(ctx) {

        // Extract documentId from the request body
        const { documentId } = ctx.request.body.data || {};

        if (!documentId) {
            console.warn("Missing documentId.");
            return ctx.badRequest("documentId is required.");
        }



        // Query the purchase using documentId through strapi.documents()
        const order = await strapi.documents("api::order.order").findOne({
            documentId,  // Use the documentId to query the order
            fields: ["order_status", "package_type", "start_date", "end_date"], // Fields to retrieve
            populate: ["users_permissions_user", "game"]
        });


        
        // Use strapi.documents() to fetch the correct order document
        //const order = await strapi.documents("api::order.order").findOne({
         //   filters: { documentId },  // Correct usage for Strapi 5
          //  fields: ["order_status"],
          ///  populate: ["users_permissions_user"]  // Ensures user relation is fetched
        //}); 


        if (!order) {
            console.warn(` Order not found for documentId: ${documentId}`);
            return ctx.notFound("Order not found.");
        }



        // return ctx.send({ message: "Order exists and belongs to a user.", order });



        const userId = order.users_permissions_user?.id;
        const gameId = order.game?.id;


        // Create a purchase entry. FIX! IT ADDS EMTY ENRIES into PURCHASES
        // CREATE A NEW PURCHASE RECORD WITH CORRECT RELATIONS
        const newPurchase = await strapi.service("api::purchase.purchase").create({
            data: {
                documentId,
                purchaseDate: new Date(),
                users_permissions_user: userId,  // change from many to many to one to many
                game: gameId,  // change from many to many to one to many
                order: order.id, //Must use id { id: order.id 
                package_type: order.package_type,
                start_date: order.start_date,
                end_date: order.end_date


            }
        });

        // Update order status to PAID if purchase is successfully created

        await strapi.db.query("api::order.order").update({
            where: { id: order.id },
            data: {
                order_status: "paid"
            }
        });


        return ctx.send({ message: "Purchase created successfully.", purchase: newPurchase });


    }
*/



}));
