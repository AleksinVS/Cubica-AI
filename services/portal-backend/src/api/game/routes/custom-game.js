module.exports = {
    routes: [
        {
            method: 'PUT',
            path: '/games/:documentId/update',
            handler: 'game.updateGameFields',
        },
        {
            method: 'GET',
            path: '/games/:slug',
            handler: 'game.findOneBySlug',
        }
    ],
};

