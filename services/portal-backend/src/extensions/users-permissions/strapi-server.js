'use strict';

const bcrypt = require('bcryptjs');

module.exports = (plugin) => {
    const customRoutes = [
        {
            method: 'POST',
            path: '/user/change-password',
            handler: 'auth.changePasswordSecure',
            config: {
                policies: [],
            },
        },
    ];

    const originalAuthFactory = plugin.controllers.auth;

    plugin.controllers.auth = ({ strapi }) => {
        const original = originalAuthFactory({ strapi });

        original.changePasswordSecure = async (ctx) => {
            const userId = ctx.state.user?.id;
            const { currentPassword, newPassword } = ctx.request.body;

            if (!userId) {
                return ctx.unauthorized('User not authenticated');
            }

            if (!currentPassword || !newPassword) {
                return ctx.badRequest('Current and new password are required');
            }

            // Find the user
            const user = await strapi.db
                .query('plugin::users-permissions.user')
                .findOne({ where: { id: userId } });

            if (!user) {
                return ctx.notFound('User not found');
            }

            // Check current password
            const isValid = await bcrypt.compare(currentPassword, user.password);
            if (!isValid) {
                return ctx.unauthorized('Текущий пароль введён неверно');
            }

            // Hash the new password manually
            const salt = await bcrypt.genSalt(10);
            const hashed = await bcrypt.hash(newPassword, salt);

            // Update the password
            await strapi.db
                .query('plugin::users-permissions.user')
                .update({
                    where: { id: userId },
                    data: { password: hashed },
                });

            ctx.send({ message: 'Пароль успешно обновлён' });
        };

        return original;
    };

    plugin.routes['content-api'].routes.push(...customRoutes);

    return plugin;
};
