"use strict";


module.exports = {
    routes: [
        {
            method: "GET",
            path: "/purchases",
            handler: "purchase.findUserPurchases",
        },
    ],
};



