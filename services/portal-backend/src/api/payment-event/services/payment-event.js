'use strict';

/**
 * payment-event service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::payment-event.payment-event');
