"use strict";

module.exports = {
    routes: [
        {
            method: "POST",
            path: "/links/generate",
            handler: "link.generate",
            config: {
            }
        }
    ]
};
