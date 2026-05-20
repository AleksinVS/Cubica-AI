'use strict';

/**
 * Runtime-session-binding service.
 *
 * The launch-session service owns binding orchestration for the test VPS, but
 * Strapi still needs a core service so the content type is registered normally.
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::runtime-session-binding.runtime-session-binding');
