"use strict";

const { createCoreController } = require("@strapi/strapi").factories;

module.exports = createCoreController("api::favourite.favourite", ({ strapi }) => ({



    async addFavorite(ctx) {
        try {
            if (!ctx.request.body) {
                return ctx.badRequest("Request body is missing");
            }

            const { userDocumentId, gameDocumentId } = ctx.request.body;

            if (!userDocumentId || !gameDocumentId) {
                return ctx.badRequest("User Document ID and Game Document ID are required");
            }

            // Find user by document_id
            const user = await strapi.documents("plugin::users-permissions.user").findFirst({
                filters: { documentId: userDocumentId }
            });

            if (!user) {
                return ctx.badRequest("User not found");
            }
            // Find game by document_id
            const game = await strapi.documents("api::game.game").findFirst({
                filters: { documentId: gameDocumentId }
            });

            if (!game) {
                return ctx.badRequest("Game not found");
            }
            // Check if the favorite entry already exists
            const existingFavourite = await strapi.documents("api::favourite.favourite").findFirst({
                filters: {
                    users_permissions_users: { documentId: user.documentId },
                    games: { documentId: game.documentId }
                }
            });

            if (existingFavourite) {
                return ctx.badRequest("Game is already in favourites");
            }

            // Create the favourite entry WITH relations in one step
            const favourite = await strapi.documents("api::favourite.favourite").create({
                data: {
                    favouritedAt: new Date(),
                    users_permissions_users: [{ documentId: user.documentId }], // Correct way to link Many-to-Many relation
                    games: [{ documentId: game.documentId }]
                }
            });


            return ctx.send({ message: "Game added to favourites", favourite });

        } catch (err) {
            console.error("Error adding favourite:", err);
            ctx.throw(500, err);
        }
    },



    async removeFavorite(ctx) {
        try {
            const { userDocumentId, gameDocumentId } = ctx.request.body;

            if (!userDocumentId || !gameDocumentId) {
                console.error("Missing userDocumentId or gameDocumentId");
                return ctx.badRequest("User Document ID and Game Document ID are required");
            }

            // Find user by documentId
            const user = await strapi.documents("plugin::users-permissions.user").findFirst({
                filters: { documentId: userDocumentId }
            });

            if (!user) {
                console.error("User not found:", userDocumentId);
                return ctx.badRequest("User not found");
            }


            // Find game by documentId
            const game = await strapi.documents("api::game.game").findFirst({
                filters: { documentId: gameDocumentId }
            });

            if (!game) {
                console.error("Game not found:", gameDocumentId);
                return ctx.badRequest("Game not found");
            }


            // Find the favourite entry using user & game documentId
            const favourite = await strapi.documents("api::favourite.favourite").findFirst({
                filters: {
                    users_permissions_users: { documentId: user.documentId },
                    games: { documentId: game.documentId }
                },
                populate: ["users_permissions_users", "games"], // Ensure related data is retrieved
            });

            if (!favourite) {
                return ctx.notFound("No favourite entry found");
            }


            // Remove user & game from the favourite relation
            await strapi.documents("api::favourite.favourite").update({
                documentId: favourite.documentId,
                data: {
                    users_permissions_users: favourite.users_permissions_users
                        .filter((u) => u.documentId !== user.documentId) // Remove user from relation
                        .map((u) => ({ documentId: u.documentId })), // Ensure correct format

                    games: favourite.games
                        .filter((g) => g.documentId !== game.documentId) // Remove game from relation
                        .map((g) => ({ documentId: g.documentId })), // Ensure correct format
                },
            });

            // Check if the favourite still has linked users or games
            const updatedFavourite = await strapi.documents("api::favourite.favourite").findOne({
                documentId: favourite.documentId,
                populate: ["users_permissions_users", "games"],
            });

            if (
                updatedFavourite.users_permissions_users.length === 0 &&
                updatedFavourite.games.length === 0
            ) {
                // If no linked users or games remain, delete the favourite
                await strapi.documents("api::favourite.favourite").delete({
                    documentId: favourite.documentId
                });
            }

            return ctx.send({ message: "Game removed from favourites" });

        } catch (err) {
            console.error("Error removing favourite:", err);
            ctx.throw(500, err);
        }
    },

    async getFavorites(ctx) {
        try {
            const userDocumentId = ctx.params.userDocumentId;

            if (!userDocumentId) {
                return ctx.badRequest("User Document ID is required");
            }

            // Find user by documentId
            const user = await strapi.documents("plugin::users-permissions.user").findFirst({
                filters: { documentId: userDocumentId }
            });

            if (!user) {
                return ctx.badRequest("User not found");
            }


            // Get all favourite games for the user (using relations, not raw SQL)
            const favourites = await strapi.documents("api::favourite.favourite").findMany({
                filters: {
                    users_permissions_users: { documentId: user.documentId } // Correctly filter by user's documentId
                },
                populate: {
                    games: { fields: ["documentId", "title"] } // Retrieve related games
                }
            });

            if (!favourites || favourites.length === 0) {
                return ctx.send({ message: "No favourite games found", data: [] });
            }

            // Extract game data from favourites
            const favouriteGames = favourites.flatMap(fav =>
                fav.games.map(game => ({
                    gameDocumentId: game.documentId,
                    gameTitle: game.title
                }))
            );

            return ctx.send({ data: favouriteGames });

        } catch (err) {
            console.error("Error fetching favourites:", err);
            ctx.throw(500, err);
        }
    }
}));
