"use strict";

module.exports = {
    routes: [
        {
            method: "PUT",
            path: "/orders/:documentId/status",
            handler: "order.updateOrderStatus",
            config: {
            }
        }
    ]
};
