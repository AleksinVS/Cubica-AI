'use strict';

/**
 * order controller
 */

const { createCoreController } = require('@strapi/strapi').factories;
const crypto = require('crypto');


module.exports = createCoreController('api::order.order', ({ strapi }) => ({
    async create(ctx) {
        try {
            const { gameDocumentId, packageType, startDate, endDate, price } = ctx.request.body;
            const user = ctx.state.user; // Get AUTHENTICATED user 

            if (!user) {
                return ctx.send({
                    success: false,
                    message: "You must be logged in to create an order.",
                    error_code: "AUTHENTICATION_REQUIRED"
                }, 401);
            }

            // Fetch the game using documentId
            const game = await strapi.db.query("api::game.game").findOne({
                where: { documentId: gameDocumentId },  // Searching by documentId
            });

            if (!game) {
                return ctx.send({
                    success: false,
                    message: "Game not found.",
                    error_code: "GAME_NOT_FOUND"
                }, 404);
            }

            // Set default order status 
            const orderStatus = "pending";


            // Create new order in strapi. I use game.id when saving the order because relations require id (not docuemntId)
            const newOrder = await strapi.service("api::order.order").create({
                data: {
                    users_permissions_user: user.id,
                    game: { id: game.id },  // id this time, not document_id
                    package_type: packageType,
                    start_date: startDate || null,
                    end_date: endDate || null,
                    price: price,
                    order_status: orderStatus,
                },
            });



            /* unnecessary, as documentID should be a part of newOrder
            // Fetch the newly created order to get documentId
            const createdOrder = await strapi.db.query("api::order.order").findOne({
                where: { id: newOrder.id }, // Use id to retrieve documentId
            }); */


            return ctx.send({
                message: "Order created successfully",
                order: {
                    documentId: newOrder.documentId, // Use documentId
                    ...newOrder, // Include all other fields
                },
            });
        }
        catch (error) {
            console.error("Order Creation Error:", error);

            return ctx.send({
                success: false,
                message: "An error occurred while creating the order.",
                error_code: "ORDER_CREATION_FAILED",
                details: error.message || "Unknown error"
            }, 500);
        }
    },

    async updateOrderStatus(ctx) {
        const { orderDocumentId, status } = ctx.request.body;

        if (!orderDocumentId || !status) {
            return ctx.badRequest("Missing orderDocumentId or status.");
        }

        const order = await strapi.db.query("api::order.order").findOne({
            where: { documentId: orderDocumentId }
        });

        if (!order) {
            return ctx.notFound("Order not found.");
        }

        // Update order status
        order.order_status = status;
        await strapi.db.query("api::order.order").update({
            where: { documentId: orderDocumentId },
            data: { order_status: status }
        });

        return ctx.send({ message: `Order status updated to ${status}.` });
    },


    async generatePaymentLink(ctx) {
        const { documentId } = ctx.request.query;

        if (!documentId) {
            return ctx.badRequest("Missing documentId");
        }

        // Fetch the order by documentId
        const order = await strapi.db.query('api::order.order').findOne({
            where: { documentId },
            populate: ['game'],
        });

        if (!order) {
            return ctx.notFound("Order not found");
        }

        const outSum = Number(order.price).toFixed(2);
        const gameName = order.game?.title || "Покупка игры"; // fallback just in case
        const invId = order.id;


        const merchantLogin = process.env.ROBO_MERCHANT_LOGIN;
        const password1 = process.env.ROBO_PASSWORD1;
        const successUrl = process.env.ROBO_PAYMENT_SUCCESS_URL;
        const failUrl = process.env.ROBO_PAYMENT_FAIL_URL;


        // Create SHA256 signature: MerchantLogin:OutSum:InvId:Password1
        const signatureBase = `${merchantLogin}:${outSum}:${invId}:${password1}`;
        const signatureValue = crypto
            .createHash('sha256')
            .update(signatureBase)
            .digest('hex');

        const robokassaUrl = `https://auth.robokassa.ru/Merchant/Index.aspx?` +
            `MerchantLogin=${merchantLogin}` +
            `&OutSum=${outSum}` +
            `&InvoiceID=${invId}` +
            `&Description=${encodeURIComponent(gameName)}` +
            `&SignatureValue=${signatureValue}` +
            `&IsTest=1` +
            `&SuccessURL=${encodeURIComponent(successUrl)}` +
            `&FailURL=${encodeURIComponent(failUrl)}`;


        try {
            await strapi.db.query("api::payment-event.payment-event").create({
                data: {
                    direction: "sent",
                    endpoint: "https://auth.robokassa.ru/Merchant/Index.aspx",
                    payload: JSON.stringify({
                        MerchantLogin: merchantLogin,
                        OutSum: outSum,
                        InvoiceID: invId,
                        Description: gameName,
                        SignatureValue: signatureValue,
                        SuccessURL: successUrl,
                        FailURL: failUrl
                    }),
                    order: order.id,
                    publishedAt: new Date(),
                },
            });
        } catch (err) {
            strapi.log.error("Error logging sent payment_event:", err);
        }


        return ctx.send({ url: robokassaUrl });
    },


    async handlePaymentResult(ctx) {
        const { OutSum, InvId, SignatureValue } = ctx.request.body;

        const password2 = process.env.ROBO_PASSWORD2;
        const expectedSignature = crypto
            .createHash("sha256")
            .update(`${OutSum}:${InvId}:${password2}`)
            .digest("hex");

        const orderId = parseInt(InvId);
        const isValid = expectedSignature.toUpperCase() === SignatureValue?.toUpperCase();

        // Continue with order and purchase logic
        const order = await strapi.db.query("api::order.order").findOne({
            where: { id: orderId },
            populate: ["users_permissions_user", "game"]
        });


        // Log the payment event no matter what
        try {
            const createdEvent = await strapi.db.query("api::payment-event.payment-event").create({
                data: {
                    direction: "received",
                    endpoint: ctx.request.url,
                    payload: JSON.stringify(ctx.request.body),
                    order: orderId,
                    publishedAt: new Date(), // if draft & publish is enabled
                },
            });

            strapi.log.info("payment_event created:", createdEvent);
        } catch (err) {
            strapi.log.error("Error creating payment_event:", err);
        }

        // Only proceed if signature is valid
        if (!isValid) {
            strapi.log.warn("Invalid Robokassa signature");
            return ctx.badRequest("Invalid signature");
        }


        if (!order) {
            return ctx.notFound("Order not found");
        }

        if (order.order_status === "paid") {
            return ctx.send(`OK${InvId}`); // already processed
        }

        await strapi.db.query("api::order.order").update({
            where: { id: order.id },
            data: { order_status: "paid" }
        });

        if (!order.users_permissions_user || !order.users_permissions_user.id) {
            strapi.log.warn(`Order ${order.id} is missing a user relation`);
            return ctx.badRequest("Order must have a user.");
        }

        if (!order.game || !order.game.id) {
            strapi.log.warn(`Order ${order.id} is missing a game relation`);
            return ctx.badRequest("Order must have a game.");
        }

        
        const existing = await strapi.db.query("api::purchase.purchase").findOne({
            where: { order: order.id },
          });
          
          if (existing) {
            strapi.log.info(`Purchase already exists for order ${order.id}, skipping creation.`);
            return ctx.send(`OK${InvId}`); // Considered successful
          }
          

        try {
            strapi.log.info(`Attempting to create purchase for order: ${JSON.stringify({
                orderId: order.id,
                documentId: order.documentId,
                userId: order.users_permissions_user?.id,
                gameId: order.game?.id
            })}`);

            const purchase = await strapi.service("api::purchase.purchase").create({
                data: {
                    purchaseDate: new Date(),
                    users_permissions_user: order.users_permissions_user.id,
                    game: order.game.id,
                    order: order.id,
                    package_type: order.package_type,
                    start_date: order.start_date,
                    end_date: order.end_date
                }
            });

            strapi.log.info(`Purchase successfully created for order ${order.id}`);
            strapi.log.debug("Purchase object:", purchase);
        } catch (err) {
            strapi.log.error("Error creating purchase:", err);
        }

        return ctx.send(`OK${InvId}`);
    }



}));
