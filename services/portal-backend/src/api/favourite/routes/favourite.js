module.exports = {
    routes: [
        {
            method: "GET",
            path: "/favourites/:userDocumentId",
            handler: "favourite.getFavorites",
            config: { policies: [], auth: false }
        },
        {
            method: "POST",
            path: "/favourites/add",
            handler: "favourite.addFavorite",
            config: { policies: [], auth: false }
        },
        {
            method: "POST",
            path: "/favourites/remove",
            handler: "favourite.removeFavorite",
            config: { policies: [], auth: false }
        }
    ]
};


