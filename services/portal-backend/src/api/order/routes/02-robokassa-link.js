'use strict';

module.exports = {
    routes: [
        {
            method: 'GET',
            path: '/robokassa/payment-link',
            handler: 'order.generatePaymentLink',
            config: {

            },
        },
        {
            method: 'POST',
            path: '/robokassa/result',
            handler: 'order.handlePaymentResult',
            config: {
                auth: false,
            },
            body: {
                parser: true,
            },
        },
    ],
};
