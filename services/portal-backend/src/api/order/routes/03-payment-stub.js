'use strict';

/**
 * Payment stub route.
 *
 * The stub is only for authenticated test/VPS flows. The controller also checks
 * PAYMENT_STUB_ENABLED so the route can exist safely while the feature is off.
 */

module.exports = {
    routes: [
        {
            method: 'POST',
            path: '/orders/payment-stub',
            handler: 'order.createPaymentStub',
            config: {},
        },
    ],
};
