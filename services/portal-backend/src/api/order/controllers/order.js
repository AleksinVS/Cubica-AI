'use strict';

/**
 * Order controller.
 *
 * This controller contains the normal order flow, Robokassa payment callbacks,
 * and a guarded payment stub for test environments. The payment stub is generic:
 * it works with any game found by documentId or slug and does not encode
 * concrete game names in platform logic.
 */

const { createCoreController } = require('@strapi/strapi').factories;
const crypto = require('crypto');

const ORDER_STATUSES = {
    PENDING: 'pending',
    PAID: 'paid',
};

const PACKAGE_TYPES = new Set(['one-time', 'day', 'month']);

function isPaymentStubEnabled() {
    return process.env.PAYMENT_STUB_ENABLED === 'true';
}

function normalizePrice(price) {
    if (price === undefined || price === null || price === '') {
        return null;
    }

    const numericPrice = Number(price);

    return Number.isFinite(numericPrice) && numericPrice >= 0 ? numericPrice : null;
}

/**
 * Resolve a game for purchase by stable public identity.
 *
 * `documentId` is the Strapi v5 public identifier, while `slug` is convenient
 * for portal clients and seed data. Both paths return the internal numeric id
 * because existing relations in this service are stored through Strapi ids.
 */
async function findGameByDocumentIdOrSlug(strapi, { gameDocumentId, gameSlug }) {
    if (gameDocumentId) {
        return strapi.db.query("api::game.game").findOne({
            where: { documentId: gameDocumentId },
        });
    }

    if (gameSlug) {
        return strapi.db.query("api::game.game").findOne({
            where: { slug: gameSlug },
        });
    }

    return null;
}

async function createPurchaseForPaidOrder(strapi, order) {
    const existing = await strapi.db.query("api::purchase.purchase").findOne({
        where: { order: order.id },
    });

    if (existing) {
        return existing;
    }

    return strapi.service("api::purchase.purchase").create({
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
}


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
            const orderStatus = ORDER_STATUSES.PENDING;


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

    async createPaymentStub(ctx) {
        try {
            if (!isPaymentStubEnabled()) {
                return ctx.forbidden("Payment stub is disabled.");
            }

            const user = ctx.state.user;

            if (!user) {
                return ctx.send({
                    success: false,
                    message: "You must be logged in to create a payment stub order.",
                    error_code: "AUTHENTICATION_REQUIRED"
                }, 401);
            }

            const { gameDocumentId, gameSlug, packageType, startDate, endDate, price } = ctx.request.body || {};

            if (!gameDocumentId && !gameSlug) {
                return ctx.badRequest("Missing gameDocumentId or gameSlug.");
            }

            if (!PACKAGE_TYPES.has(packageType)) {
                return ctx.badRequest("Invalid packageType.");
            }

            const normalizedPrice = normalizePrice(price);

            if (normalizedPrice === null) {
                return ctx.badRequest("Invalid price.");
            }

            const game = await findGameByDocumentIdOrSlug(strapi, { gameDocumentId, gameSlug });

            if (!game) {
                return ctx.notFound("Game not found.");
            }

            // The stub intentionally mirrors the post-payment state: paid order
            // plus purchase. Robokassa remains the production payment path.
            const order = await strapi.service("api::order.order").create({
                data: {
                    users_permissions_user: user.id,
                    game: game.id,
                    package_type: packageType,
                    start_date: startDate || null,
                    end_date: endDate || null,
                    price: normalizedPrice,
                    order_status: ORDER_STATUSES.PAID,
                    publishedAt: new Date(),
                },
                populate: ["users_permissions_user", "game"],
            });

            const orderWithRelations = order.users_permissions_user && order.game
                ? order
                : await strapi.db.query("api::order.order").findOne({
                    where: { id: order.id },
                    populate: ["users_permissions_user", "game"],
                });

            const purchase = await createPurchaseForPaidOrder(strapi, orderWithRelations);

            return ctx.send({
                order: {
                    documentId: order.documentId,
                    status: ORDER_STATUSES.PAID,
                },
                purchase: {
                    documentId: purchase.documentId,
                    status: ORDER_STATUSES.PAID,
                },
                status: ORDER_STATUSES.PAID,
            }, 201);
        } catch (error) {
            strapi.log.error("Payment stub creation failed:", error);

            return ctx.send({
                success: false,
                message: "An error occurred while creating the payment stub order.",
                error_code: "PAYMENT_STUB_FAILED",
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

        if (order.order_status === ORDER_STATUSES.PAID) {
            return ctx.send(`OK${InvId}`); // already processed
        }

        await strapi.db.query("api::order.order").update({
            where: { id: order.id },
            data: { order_status: ORDER_STATUSES.PAID }
        });

        if (!order.users_permissions_user || !order.users_permissions_user.id) {
            strapi.log.warn(`Order ${order.id} is missing a user relation`);
            return ctx.badRequest("Order must have a user.");
        }

        if (!order.game || !order.game.id) {
            strapi.log.warn(`Order ${order.id} is missing a game relation`);
            return ctx.badRequest("Order must have a game.");
        }

        
        try {
            strapi.log.info(`Attempting to create purchase for order: ${JSON.stringify({
                orderId: order.id,
                documentId: order.documentId,
                userId: order.users_permissions_user?.id,
                gameId: order.game?.id
            })}`);

            const purchase = await createPurchaseForPaidOrder(strapi, order);

            strapi.log.info(`Purchase successfully created for order ${order.id}`);
            strapi.log.debug("Purchase object:", purchase);
        } catch (err) {
            strapi.log.error("Error creating purchase:", err);
        }

        return ctx.send(`OK${InvId}`);
    }



}));
